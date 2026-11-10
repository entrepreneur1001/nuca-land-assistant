"""Turn the downloaded Nawy compounds (fetch_nawy.py) into what the maps read.
usage: python3 build_compounds.py <fetch dir> <public/compounds> [--no-images] [--all-images]
Run once, then fit_master.py (it reads the images written here with --all-images), then again without it: only
the master plans that were placed on the map (<fetch dir>/fits.json) are published, as `plan`:
{kind, w, h, corners: {tl, tr, bl}, clip} like the official plans (src/lib/plans.ts), clip being the outline in pixels.
Writes <out>/index.json: {compounds: [{id, name, nameAr, dev, devAr, area, areaAr, slug, bounds, ring, img, price}]} with
ring as [lat, lng] points (outline simplified to ~5 m) and bounds as [[south, west], [north, east]]; and
<out>/img/<id>.webp, the master plan at most 1400 px on its long side, for compounds that have one (img: true).
price is Nawy's lowest listed unit price in EGP (the developer's, else resale), null when it lists none.
A phase of a compound that has its own outline is left out: the parent already covers the ground.
"""
import sys, os, json, math, glob
SRC, OUT = sys.argv[1:3]
IMAGES = "--no-images" not in sys.argv
ALL = "--all-images" in sys.argv
FITS = json.load(open(f"{SRC}/fits.json")) if os.path.exists(f"{SRC}/fits.json") else {}
def fitted(cid): return FITS.get(str(cid))
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
    if c["id"] in masters and (ALL or fitted(c["id"])):
        dst = f"{OUT}/img/{c['id']}.webp"
        if IMAGES and not (os.path.exists(dst) and os.path.getmtime(dst) >= os.path.getmtime(masters[c["id"]])):
            try:
                from PIL import Image
                im = Image.open(masters[c["id"]])
                # Some "master plans" are thumbnails or stray photos: too small to read, so not worth showing.
                if max(im.size) < MIN_PX: small += 1; raise ValueError(f"only {im.size[0]}x{im.size[1]}")
                im = im.convert("RGBA" if im.mode in ("RGBA", "LA", "P") else "RGB")
                im.thumbnail((MAX_PX, MAX_PX), Image.LANCZOS); im.save(dst, "WEBP", quality=QUALITY, method=6)
            except Exception as e:
                bad_img += 1; print("bad image", c["id"], repr(e), flush=True)
            if bad_img and os.path.exists(dst) and max(Image.open(masters[c["id"]]).size) < MIN_PX: os.remove(dst)
        if os.path.exists(dst): img = True; wanted.add(os.path.basename(dst)); bytes_img += os.path.getsize(dst)
    lats, lngs = [p[0] for p in ring], [p[1] for p in ring]
    plan = next((pl for pl in (c.get("developerPlan"), c.get("resalePlan")) if pl and pl.get("minPrice") and pl.get("currency") == "EGP"), None)
    rows.append({"id": c["id"], "name": c["name"].strip(), "nameAr": (a.get("name") or "").strip() or None,
                 "dev": (c.get("developerName") or "").strip() or None, "devAr": (a.get("developerName") or "").strip() or None,
                 "area": c.get("areaName"), "areaAr": a.get("areaName"), "slug": c["slug"],
                 "bounds": [[min(lats), min(lngs)], [max(lats), max(lngs)]], "ring": ring, "img": img,
                 "plan": ({k: fitted(c["id"])[k] for k in ("kind", "w", "h", "corners", "clip")} if img and fitted(c["id"]) else None),
                 "price": round(plan["minPrice"]) if plan else None})
for f in os.listdir(f"{OUT}/img"):
    if f not in wanted: os.remove(f"{OUT}/img/{f}")
json.dump({"compounds": rows}, open(f"{OUT}/index.json", "w"), ensure_ascii=False, separators=(",", ":"))
print(f"{len(en)} listed; {len(rows)} written ({sum(r['img'] for r in rows)} master plans, {sum(r['plan'] is not None for r in rows)} placed on the map, {sum(r['price'] is not None for r in rows)} with a price, {bytes_img / 1e6:.1f} MB of images); "
      f"{no_geom} without an outline, {phases} phases under their parent, {bad_img} unreadable images; "
      f"index.json {os.path.getsize(OUT + '/index.json') / 1024:.0f} KB, {sum(len(r['ring']) for r in rows)} points")
