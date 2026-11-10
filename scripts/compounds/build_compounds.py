"""Turn the downloaded Nawy compounds (fetch_nawy.py) into what the maps read.
usage: python3 build_compounds.py <fetch dir> <public/compounds> [--no-images] [--all-images] [--no-logos]
Run once, then fit_master.py (it reads the images written here with --all-images), then again without it.
Only master plans whose placement was checked are published, as `plan`:
{kind, status, w, h, corners: {tl, tr, bl}, clip} like the official plans (src/lib/plans.ts), clip being the outline in
image pixels cut to the image box. status "verified": the plan's streets matched Google's road map (loop.py /
place_compound.py, <fetch dir>/place.json); "reviewed": checked by eye (scripts/compounds/reviewed.json entries with
check "ground" or "eye"). Every other drawing stays unpublished (no image, plan null): only the outline is drawn.
Developer logos (developerLogoUrl) go to <out>/logo/<devId>.webp (64 px), fetched once, one at a time; each compound
gets devId and devLogo (file name under logo/, or null).
Writes <out>/index.json: {compounds: [{id, name, nameAr, dev, devAr, area, areaAr, slug, bounds, ring, img, price}]} with
ring as [lat, lng] points (outline simplified to ~5 m) and bounds as [[south, west], [north, east]]; and
<out>/img/<id>.webp, the master plan at most 1400 px on its long side, for compounds that have one (img: true).
price is Nawy's lowest listed unit price in EGP (the developer's, else resale), null when it lists none.
A phase of a compound that has its own outline is left out: the parent already covers the ground.
"""
import sys, os, site
sys.path.append(site.getusersitepackages())  # usable with python3 -I (it reads downloaded files)
import json, math, glob
SRC, OUT = sys.argv[1:3]
IMAGES = "--no-images" not in sys.argv
ALL = "--all-images" in sys.argv
FITS = json.load(open(f"{SRC}/fits.json")) if os.path.exists(f"{SRC}/fits.json") else {}
# A person's review of the uncertain placements (review.py): a better placement, or "hide" for an image that is no site plan.
REVIEWED = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "reviewed.json")))
PLACE = json.load(open(f"{SRC}/place.json")) if os.path.exists(f"{SRC}/place.json") else {}
def fitted(cid):
    """The published placement, sizes in exported pixels except w, h (filled in from the image), or None."""
    r, p = REVIEWED.get(str(cid)), PLACE.get(str(cid))
    # "reject": seen not to fit (or no site plan) by eye after matching, always hidden. "hide": the earlier review
    # could not place it; a clear street match (verified) now overrides that.
    if r == "reject" or (r == "hide" and not (p and p.get("status") == "verified")): return None
    if isinstance(r, dict) and r.get("check") in ("ground", "eye"):
        f = FITS.get(str(cid), {})  # clip in exported pixels, unless the entry names the size it was made on (loop.py --accept)
        return {"kind": "reviewed", "status": "reviewed", "corners": r["corners"], "clip": r["clip"], "src_w": r.get("w") or f.get("w"), "src_h": r.get("h") or f.get("h"),
                "image": f"{SRC}/gallery/{r['image']}" if r.get("image") else None}
    if p and p.get("status") == "verified":
        return {"kind": "shape", "status": "verified", "corners": p["corners"], "clip": p["clip"], "src_w": p["W"], "src_h": p["H"],
                "image": p["image"] if p.get("gallery") is not None else None}
    return None
def clip_box(poly, W, H):
    """The clip outline cut to the image rectangle (Sutherland-Hodgman), rounded to whole pixels."""
    pts = [tuple(map(float, p)) for p in poly]
    for axis, lim, less in ((0, 0, False), (0, W, True), (1, 0, False), (1, H, True)):
        out = []
        for i in range(len(pts)):
            a, b = pts[i - 1], pts[i]
            ia = a[axis] <= lim if less else a[axis] >= lim; ib = b[axis] <= lim if less else b[axis] >= lim
            if ia != ib:
                t = (lim - a[axis]) / (b[axis] - a[axis]); out.append((a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])))
            if ib: out.append(b)
        pts = out
        if not pts: return []
    res = []
    for x, y in pts:
        q = [min(W, max(0, round(x))), min(H, max(0, round(y)))]
        if not res or q != res[-1]: res.append(q)
    return res if len(res) >= 3 else []
TOL_M, MAX_PX, MIN_PX, QUALITY = 5.0, 1400, 500, 72
def load(lang):
    out, p = [], 1
    while os.path.exists(f"{SRC}/list/{lang}_{p}.json"):
        out += json.load(open(f"{SRC}/list/{lang}_{p}.json"))["results"]; p += 1
    return out
def simplify(pts, tol):  # Douglas-Peucker on [x, y] metres, iterative
    keep = [False] * len(pts); keep[0] = keep[-1] = True; stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        if b - a < 2: continue
        (ax, ay), (bx, by) = pts[a], pts[b]; dx, dy = bx - ax, by - ay; n = math.hypot(dx, dy)
        best, at = 0.0, None
        for i in range(a + 1, b):
            px, py = pts[i]
            d = abs(dx * (py - ay) - dy * (px - ax)) / n if n else math.hypot(px - ax, py - ay)
            if d > best: best, at = d, i
        if best > tol: keep[at] = True; stack += [(a, at), (at, b)]
    return [i for i, k in enumerate(keep) if k]
def ring_of(geom):
    r = geom["coordinates"][0]
    if len(r) > 1 and r[0] == r[-1]: r = r[:-1]
    if len(r) < 3: return None
    lat0 = sum(p[1] for p in r) / len(r); kx, ky = 111320 * math.cos(math.radians(lat0)), 110540
    # Simplify as two open halves so the closing point is treated like any other.
    m = [[p[0] * kx, p[1] * ky] for p in r]; far = max(range(len(m)), key=lambda i: math.hypot(m[i][0] - m[0][0], m[i][1] - m[0][1]))
    idx = simplify(m[: far + 1], TOL_M) + [far + i for i in simplify(m[far:] + [m[0]], TOL_M)[1:-1]]
    out = [[round(r[i][1], 5), round(r[i][0], 5)] for i in idx]
    return out if len(out) >= 3 else None
en, ar = load("en"), {c["id"]: c for c in load("ar")}
outlined = {c["id"] for c in en if c.get("geometry")}
os.makedirs(f"{OUT}/img", exist_ok=True)
def fetch_logos():
    """{devId: "<devId>.webp"} for the developers of the compounds shown; missing logos fetched one at a time."""
    import time
    from urllib.request import Request, urlopen
    from PIL import Image
    raw, dst = f"{SRC}/logo_raw", f"{OUT}/logo"; os.makedirs(raw, exist_ok=True); os.makedirs(dst, exist_ok=True)
    urls = {}
    for c in en:
        if c.get("geometry") and c.get("developerId") is not None and c.get("developerLogoUrl"): urls.setdefault(c["developerId"], c["developerLogoUrl"])
    out, fetched = {}, 0
    for dev, url in sorted(urls.items()):
        f, d = f"{raw}/{dev}.img", f"{dst}/{dev}.webp"
        if not os.path.exists(f) and not os.path.exists(f + ".missing") and "--no-logos" not in sys.argv:
            try:
                time.sleep(1.0); fetched += 1
                with urlopen(Request(url.replace(" ", "%20"), headers={"User-Agent": "Mozilla/5.0"}), timeout=30) as r: data = r.read()
                open(f, "wb").write(data)
            except Exception as e:
                print("logo", dev, repr(e), flush=True)
                if "403" in repr(e) or "404" in repr(e): open(f + ".missing", "w").write(repr(e))  # not asked again
                continue
        if not os.path.exists(f): continue
        if not os.path.exists(d) or os.path.getmtime(d) < os.path.getmtime(f):
            try:
                im = Image.open(f); im = im.convert("RGBA"); bb = im.getbbox()
                if bb: im = im.crop(bb)
                im.thumbnail((64, 64), Image.LANCZOS); im.save(d, "WEBP", quality=85, method=6)
            except Exception as e: print("logo", dev, "unreadable", repr(e), flush=True); continue
        out[dev] = os.path.basename(d)
    for f in os.listdir(dst):
        if f not in out.values(): os.remove(f"{dst}/{f}")
    print(f"{len(out)} developer logos ({fetched} fetched)", flush=True)
    return out
logos = fetch_logos()
masters = {}
for f in glob.glob(f"{SRC}/master/*"):
    stem, ext = os.path.splitext(os.path.basename(f))
    if ext.lower() in (".jpg", ".jpeg", ".jfif", ".png", ".gif", ".webp") and stem.isdigit(): masters[int(stem)] = f
rows, no_geom, phases, bad_img, bytes_img, small = [], 0, 0, 0, 0, 0
wanted = set()
for c in sorted(en, key=lambda c: c["id"]):
    if not c.get("geometry"): no_geom += 1; continue
    if c.get("parentCompoundId") in outlined: phases += 1; continue
    ring = ring_of(c["geometry"])
    if not ring: no_geom += 1; continue
    a = ar.get(c["id"], {})
    img = False
    fit = fitted(c["id"])
    src_img = (fit or {}).get("image") or masters.get(c["id"])  # a gallery image when that is what was placed
    if src_img and (ALL or fit):
        dst = f"{OUT}/img/{c['id']}.webp"
        if IMAGES and not (os.path.exists(dst) and os.path.getmtime(dst) >= os.path.getmtime(src_img) and not (fit and fit.get("image"))):
            try:
                from PIL import Image
                im = Image.open(src_img)
                # Some "master plans" are thumbnails or stray photos: too small to read, so not worth showing.
                if max(im.size) < MIN_PX: small += 1; raise ValueError(f"only {im.size[0]}x{im.size[1]}")
                im = im.convert("RGBA" if im.mode in ("RGBA", "LA", "P") else "RGB")
                im.thumbnail((MAX_PX, MAX_PX), Image.LANCZOS); im.save(dst, "WEBP", quality=QUALITY, method=6)
            except Exception as e:
                bad_img += 1; print("bad image", c["id"], repr(e), flush=True)
            if bad_img and os.path.exists(dst) and max(Image.open(src_img).size) < MIN_PX: os.remove(dst)
        if os.path.exists(dst): img = True; wanted.add(os.path.basename(dst)); bytes_img += os.path.getsize(dst)
    pl = None
    if img and fit:
        from PIL import Image
        w, h = Image.open(f"{OUT}/img/{c['id']}.webp").size
        # clip is in the pixels of the image it was made on: the exported one (reviewed.json, fits.json) or the master (place.json)
        sw = fit["src_w"] or w; k = w / sw
        clip = clip_box([[x * k, y * k] for x, y in fit["clip"]], w, h)
        if clip: pl = {"kind": fit["kind"], "status": fit["status"], "w": w, "h": h, "corners": fit["corners"], "clip": clip}
    if not pl and not ALL:
        img = False; wanted.discard(f"{c['id']}.webp")
    dev = c.get("developerId"); logo = logos.get(dev)
    lats, lngs = [p[0] for p in ring], [p[1] for p in ring]
    plan = next((pl for pl in (c.get("developerPlan"), c.get("resalePlan")) if pl and pl.get("minPrice") and pl.get("currency") == "EGP"), None)
    rows.append({"id": c["id"], "name": c["name"].strip(), "nameAr": (a.get("name") or "").strip() or None,
                 "dev": (c.get("developerName") or "").strip() or None, "devAr": (a.get("developerName") or "").strip() or None,
                 "area": c.get("areaName"), "areaAr": a.get("areaName"), "slug": c["slug"],
                 "bounds": [[min(lats), min(lngs)], [max(lats), max(lngs)]], "ring": ring, "img": img, "plan": pl,
                 "devId": dev, "devLogo": logo,
                 "price": round(plan["minPrice"]) if plan else None})
for f in os.listdir(f"{OUT}/img"):
    if f not in wanted: os.remove(f"{OUT}/img/{f}")
bytes_img = sum(os.path.getsize(f"{OUT}/img/{f}") for f in wanted if os.path.exists(f"{OUT}/img/{f}"))
json.dump({"compounds": rows}, open(f"{OUT}/index.json", "w"), ensure_ascii=False, separators=(",", ":"))
st = {k: sum(1 for r in rows if r["plan"] and r["plan"]["status"] == k) for k in ("verified", "reviewed")}
print(f"{len(en)} listed; {len(rows)} written ({sum(r['img'] for r in rows)} master plans, {st['verified']} verified + {st['reviewed']} reviewed placed on the map, {sum(r['price'] is not None for r in rows)} with a price, {bytes_img / 1e6:.1f} MB of images); "
      f"{no_geom} without an outline, {phases} phases under their parent, {bad_img} unreadable images; "
      f"index.json {os.path.getsize(OUT + '/index.json') / 1024:.0f} KB, {sum(len(r['ring']) for r in rows)} points")
