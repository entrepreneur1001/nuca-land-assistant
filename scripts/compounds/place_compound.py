"""Place a compound's master plan on the map by its streets: the streets drawn on the plan are correlated with the road
raster of Google's road map (labels off) around Nawy's outline, over scale, rotation and position. Adapted from
scripts/plans/past/place_g.py (earlier-stage zone plans); Nawy's outline fixes where to look and roughly how large.
usage: python3 -I place_compound.py <fetch dir> <public/compounds> <id> [--image file] [--preview out.jpg] [--masks out.jpg]
Prints and returns {id, image, W, H, variant, score, ratio, scale, rot, overlap, affine, corners: {tl, tr, bl}, clip}
- affine: original image px -> Web-Mercator metres; corners [lat, lng] of the image's top-left, top-right, bottom-left
  (as fit_master.py writes them); clip: Nawy's outline in original image pixels, cut to the image box.
- score: normalised correlation of the plan's streets with Google's roads (place_g.py's measure);
  ratio: best score over the best at a clearly different placement (another place or a turn of more than 8 degrees).
Clear match (verified): see is_clear(); gdens/recall/precision (agreement()) measure the match inside the outline. The search keeps the scale within about +-28 % of 1.13 x the
outline's (0.82-1.45 x the scale at which the drawn site's area equals the outline's: drawn sites carry margins, so
the prior runs small; drawings that fill their frame: 0.85-1.4 x the frame laid over the outline, from fits.json),
and the placed drawing must cover at least 70 % of the outline. Ranges set from the 82 ground-checked placements.
Google tiles are cached in <fetch dir>/gtiles (zoom 16), Esri satellite tiles (previews) in <fetch dir>/tiles.
"""
import sys, os, site
sys.path.append(site.getusersitepackages())  # run with -I (downloaded files are read), keep the user's opencv
import json, math, time, glob
from urllib.request import Request, urlopen
from concurrent.futures import ThreadPoolExecutor
import numpy as np, cv2
cv2.setNumThreads(1)
R = 6378137.0; HALF = math.pi * R; Z = 16; NT = 2 ** Z; RES = 2 * HALF / NT / 256  # 2.39 Mercator m / px
UA = {"User-Agent": "Mozilla/5.0"}
MIN_OVERLAP = 0.7
def merc(lat, lng): return (math.radians(lng) * R, math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * R)
def unmerc(x, y): return [round(math.degrees(2 * math.atan(math.exp(y / R)) - math.pi / 2), 6), round(math.degrees(x / R), 6)]

# ---------- tiles ----------
def _get(url, f):
    for a in range(3):
        try:
            with urlopen(Request(url, headers=UA), timeout=30) as r: data = r.read()
            open(f + ".part", "wb").write(data); os.replace(f + ".part", f); return
        except Exception: time.sleep(2 * (a + 1))
def gtile(cache, x, y):
    f = f"{cache}/{Z}_{x}_{y}.png"
    if not (os.path.exists(f) and os.path.getsize(f) > 100):
        os.makedirs(cache, exist_ok=True)
        _get(f"https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={Z}&apistyle=s.e%3Al%7Cp.v%3Aoff", f)
    t = cv2.imread(f)
    if t is None: return None
    b, g, r = t[..., 0].astype(int), t[..., 1].astype(int), t[..., 2].astype(int)
    return (((b - r) > 9) & ((b - g) > 2) & (g > 150)).astype(np.uint8) * 255  # streets: blue-grey on a light ground
def road_raster(cache, x0, y0, x1, y1, threads=2):
    """Road raster (uint8) covering Mercator box x0..x1, y0..y1 (y1 north); returns raster, (left x, top y)."""
    tx0, tx1 = int((x0 + HALF) / (2 * HALF) * NT), int((x1 + HALF) / (2 * HALF) * NT)
    ty0, ty1 = int((HALF - y1) / (2 * HALF) * NT), int((HALF - y0) / (2 * HALF) * NT)
    out = np.zeros(((ty1 - ty0 + 1) * 256, (tx1 - tx0 + 1) * 256), np.uint8)
    xy = [(x, y) for x in range(tx0, tx1 + 1) for y in range(ty0, ty1 + 1)]
    with ThreadPoolExecutor(threads) as ex:
        for (x, y), t in zip(xy, ex.map(lambda p: gtile(cache, *p), xy)):
            if t is not None: out[(y - ty0) * 256:(y - ty0 + 1) * 256, (x - tx0) * 256:(x - tx0 + 1) * 256] = t
    return out, (tx0 / NT * 2 * HALF - HALF, HALF - ty0 / NT * 2 * HALF)
def esri(cache, x0, y0, x1, y1, z):
    n = 2 ** z; res = 2 * HALF / n / 256
    tx0, tx1 = int((x0 + HALF) / (2 * HALF) * n), int((x1 + HALF) / (2 * HALF) * n)
    ty0, ty1 = int((HALF - y1) / (2 * HALF) * n), int((HALF - y0) / (2 * HALF) * n)
    out = np.zeros(((ty1 - ty0 + 1) * 256, (tx1 - tx0 + 1) * 256, 3), np.uint8)
    def one(p):
        tx, ty = p; f = f"{cache}/{z}_{ty}_{tx}.jpg"
        if not os.path.exists(f):
            os.makedirs(cache, exist_ok=True)
            _get(f"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{ty}/{tx}", f)
        return cv2.imread(f)
    xy = [(x, y) for x in range(tx0, tx1 + 1) for y in range(ty0, ty1 + 1)]
    with ThreadPoolExecutor(3) as ex:
        for (x, y), t in zip(xy, ex.map(one, xy)):
            if t is not None and t.shape[:2] == (256, 256): out[(y - ty0) * 256:(y - ty0 + 1) * 256, (x - tx0) * 256:(x - tx0 + 1) * 256] = t
    return out, (tx0 / n * 2 * HALF - HALF, HALF - ty0 / n * 2 * HALF), res

def thin(m):
    """Morphological skeleton (centre lines, not necessarily connected) of a binary mask."""
    img = (m > 0).astype(np.uint8) * 255; out = np.zeros_like(img); k = cv2.getStructuringElement(cv2.MORPH_CROSS, (3, 3))
    while img.any():
        er = cv2.erode(img, k); out |= cv2.subtract(img, cv2.dilate(er, k)); img = er
    return out
def centre_lines(m, width):
    """Streets as centre lines drawn `width` px wide, so drawn and mapped street widths do not matter."""
    t = thin(m); w = max(1, int(round(width)))
    return cv2.dilate(t.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (w, w))) if w > 1 else t.astype(np.uint8)

# ---------- the drawing ----------
def load_image(path):
    im = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    if im is None:
        try:  # webp/gif and friends that opencv may not read
            from PIL import Image
            im = cv2.cvtColor(np.array(Image.open(path).convert("RGBA")), cv2.COLOR_RGBA2BGRA)
        except Exception: return None
    if im.ndim == 2: im = cv2.cvtColor(im, cv2.COLOR_GRAY2BGR)
    if im.shape[2] == 4:
        a = im[..., 3:4].astype(np.float32) / 255; im = (im[..., :3] * a + 255 * (1 - a)).astype(np.uint8)
    return im
def page(img):
    """Page background: the border-connected area of the page's own colour."""
    h, w = img.shape[:2]; rgb = img.astype(np.int16)
    edge = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]]); bg = np.median(edge, 0)
    near = (np.abs(rgb - bg).max(2) <= 22).astype(np.uint8)
    if (np.abs(edge - bg).max(1) < 22).mean() < 0.5: return np.zeros((h, w), bool)
    n, lab = cv2.connectedComponents(near, connectivity=4)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    return np.isin(lab, list(border))
def silhouette_area(img, pg):
    """Area (px) of the drawn site: the biggest non-page blob with its holes, or None for a drawing that fills its frame."""
    if pg.mean() < 0.05: return None, None
    fg = cv2.morphologyEx((~pg).astype(np.uint8), cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(fg, 8)
    if n < 2: return None, None
    big = 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA])); m = (lab == big).astype(np.uint8)
    cs, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE); m[:] = 0; cv2.drawContours(m, cs, -1, 1, -1)
    if not 0.08 < m.mean() < 0.92: return None, None
    return float(m.sum()), m
def street_masks(img, mpp, pg):
    """Candidate street masks for a drawing at `mpp` Mercator metres per pixel: grey asphalt, and light (white) roads.
    Thick areas (wider than ~45 m: squares, lakes, the page) and short bits (text, roofs) are dropped."""
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV); S, V = hsv[..., 1].astype(int), hsv[..., 2].astype(int)
    zone = (~pg).astype(np.uint8) * 255
    out = []
    for name, m in (("grey", (S < 45) & (V > 60) & (V < 215)), ("light", (S < 30) & (V >= 200))):
        m = (m & ~pg).astype(np.uint8) * 255
        k1 = max(1, int(round(3 / mpp)))
        if k1 > 1: m = cv2.morphologyEx(m, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k1, k1)))
        d = max(3, int(round(45 / mpp))) | 1
        thick = cv2.morphologyEx(m, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (d, d)))
        m = cv2.bitwise_and(m, cv2.bitwise_not(cv2.dilate(thick, np.ones((3, 3), np.uint8))))
        n, lab, st, _ = cv2.connectedComponentsWithStats(m, connectivity=8)
        span = np.maximum(st[:, 2], st[:, 3]) * mpp
        keep = np.where((span > 90) & (st[:, 4] * mpp * mpp > 500))[0]; keep = keep[keep > 0]
        m = np.isin(lab, keep).astype(np.uint8) * 255
        frac = m.mean() / 255 / max(1e-6, zone.mean() / 255)
        if 0.02 < frac < 0.6: out.append((name, centre_lines(m, 6 / mpp), zone))
    return out

# ---------- the search ----------
def ring_merc(ring): return np.array([merc(p[0], p[1]) for p in ring])
def poly_area(p): return 0.5 * abs(float(np.dot(p[:, 0], np.roll(p[:, 1], 1)) - np.dot(p[:, 1], np.roll(p[:, 0], 1))))
def to_affine(A, u, v, res, ox, oy):
    """A: image px -> template px; (u, v) template origin in raster px -> affine image px -> Mercator."""
    return np.array([[res * A[0, 0], res * A[0, 1], ox + res * (A[0, 2] + u)], [-res * A[1, 0], -res * A[1, 1], oy - res * (A[1, 2] + v)]])
def place(src, pub, cid, image=None, preview=None, masks_out=None, comp=None, fit=None):
    if comp is None: comp = next(c for c in json.load(open(f"{pub}/index.json"))["compounds"] if c["id"] == cid)
    if fit is None:
        fits = json.load(open(f"{src}/fits.json")) if os.path.exists(f"{src}/fits.json") else {}
        fit = fits.get(str(cid))
    if image is None:
        im = [f for f in glob.glob(f"{src}/master/{cid}.*") if not f.endswith(".part")]; image = im[0] if im else None
    res0 = {"id": cid, "image": image}
    orig = load_image(image) if image else None
    if orig is None: return {**res0, "fail": "no image"}
    H0, W0 = orig.shape[:2]
    if max(H0, W0) < 500: return {**res0, "fail": "image too small"}
    ring = ring_merc(comp["ring"]); A_out = poly_area(ring); cen = ring.mean(0)
    diam = float(np.hypot(*(ring.max(0) - ring.min(0))))
    # prior scale (Mercator m per original px)
    k0 = min(1.0, 1600 / max(H0, W0)); img0 = cv2.resize(orig, None, fx=k0, fy=k0, interpolation=cv2.INTER_AREA)
    pg0 = page(img0); sil_a, sil = silhouette_area(img0, pg0)
    bw, bh = ring.max(0) - ring.min(0)
    s_cover = max(bw / W0, bh / H0) / 0.98
    if fit and fit.get("corners"):
        a = merc(*fit["corners"]["tl"]); b = merc(*fit["corners"]["tr"]); s_cover = math.hypot(b[0] - a[0], b[1] - a[1]) / W0
    if sil_a: s0 = math.sqrt(A_out / (sil_a / k0 / k0)); lo, hi = 0.82 * s0, 1.45 * s0
    else: s0 = s_cover; lo, hi = 0.85 * s0, 1.4 * s0
    # anchor: the point of the drawing that should land near the outline's centre
    if sil is not None:
        ys, xs = np.nonzero(sil); anchor = (xs.mean() / k0, ys.mean() / k0)
    elif fit and fit.get("clip"):
        c = np.array(fit["clip"], float) * (W0 / fit["w"]); anchor = tuple(c.mean(0))
    else: anchor = (W0 / 2, H0 / 2)
    # working image: about 1.2 Mercator m per px at the prior scale
    kw = min(1.0, s0 / 1.2, 1600 / max(H0, W0)); img = cv2.resize(orig, None, fx=kw, fy=kw, interpolation=cv2.INTER_AREA)
    H, W = img.shape[:2]; mpp = s0 / kw
    pg = page(img); variants = street_masks(img, mpp, pg)
    if masks_out:
        tiles = [img] + [cv2.cvtColor(m, cv2.COLOR_GRAY2BGR) for _, m, _ in variants]
        f = 600 / max(H, W); cv2.imwrite(masks_out, np.hstack([cv2.resize(t, None, fx=f, fy=f) for t in tiles]))
    if not variants: return {**res0, "W": W0, "H": H0, "fail": "no streets"}
    # road raster around the outline + margin for the drawing's whole extent
    # Google's roads over the outline + 1 km; beyond that (where a large drawing may reach) the raster is padded empty
    (x0, y0), (x1, y1) = ring.min(0) - 1000, ring.max(0) + 1000
    full, (ox, oy) = road_raster(f"{src}/gtiles", x0, y0, x1, y1)
    pad = int(max(0.0, 0.6 * hi * math.hypot(W0, H0) - 700) / RES)
    if pad: full = cv2.copyMakeBorder(full, pad, pad, pad, pad, cv2.BORDER_CONSTANT, value=0); ox -= pad * RES; oy += pad * RES
    full = centre_lines(full, 6 / RES)
    PROBE[:] = anchor
    rad = max(100.0, 0.2 * diam)  # how far the anchor may land from the outline's centre (ground-checked: <= 0.18 x diameter)
    best_all = []
    for vname, streets, zone in variants:
        r = search(streets, zone, full, ox, oy, lo, hi, anchor, kw, cen, rad, ring, A_out, sil, k0)
        if r: best_all.append((vname, r))
    if not best_all: return {**res0, "W": W0, "H": H0, "fail": "no placement covers the outline"}
    vname, r = max(best_all, key=lambda t: t[1]["score"])
    M = r["affine"]
    def ll(x, y): return unmerc(*(M @ np.array([x, y, 1.0])))
    Minv = np.linalg.inv(np.vstack([M, [0, 0, 1]]))[:2]
    clip = (np.c_[ring, np.ones(len(ring))] @ Minv.T)
    clip = clip_to_box(clip, W0, H0)
    out = {**res0, "W": W0, "H": H0, "variant": vname, "score": r["score"], "ratio": r["ratio"], "scale": round(r["scale"], 4),
           "scale_prior": round(s0, 4), "rot": r["rot"], "overlap": r["overlap"], "n_alt": r["n_alt"], "affine": [[round(float(v), 4) for v in row] for row in M],
           "corners": {"tl": ll(0, 0), "tr": ll(W0, 0), "bl": ll(0, H0)}, "clip": [[round(float(x)), round(float(y))] for x, y in clip]}
    streets = dict((n, m) for n, m, _ in variants)[vname]
    out.update(agreement(streets, kw, M, ring, full, ox, oy))
    out["clear"] = is_clear(out)
    if preview: make_preview(src, orig, M, ring, full, ox, oy, out, preview)
    return out

def agreement(streets, kw, M, ring, full, ox, oy, tol_m=10.0):
    """Inside Nawy's outline: gdens = share of the outline's area on Google's street centre lines (is the inside
    mapped at all?); recall = share of Google's centre lines within tol of the plan's streets; precision = share of
    the plan's street centre lines within tol of Google's."""
    lo, hi = ring.min(0) - 50, ring.max(0) + 50
    u0, v0 = int((lo[0] - ox) / RES), int((oy - hi[1]) / RES); u1, v1 = int((hi[0] - ox) / RES) + 1, int((oy - lo[1]) / RES) + 1
    u0, v0 = max(0, u0), max(0, v0); u1, v1 = min(full.shape[1], u1), min(full.shape[0], v1)
    g = full[v0:v1, u0:u1] > 0
    inside = np.zeros(g.shape, np.uint8)
    cv2.fillPoly(inside, [np.round(np.c_[(ring[:, 0] - ox) / RES - u0, (oy - ring[:, 1]) / RES - v0]).astype(np.int32)], 1)
    inside = inside > 0
    # plan streets (working px) -> this raster window
    P = np.array([[M[0, 0] / kw / RES, M[0, 1] / kw / RES, (M[0, 2] - ox) / RES - u0], [-M[1, 0] / kw / RES, -M[1, 1] / kw / RES, (oy - M[1, 2]) / RES - v0]])
    p = cv2.warpAffine(streets, P, (g.shape[1], g.shape[0]), flags=cv2.INTER_AREA) > 40
    t = max(1, int(round(tol_m / RES)))
    near = lambda m: cv2.dilate(m.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * t + 1, 2 * t + 1))) > 0
    gi, pi = g & inside, p & inside
    gd = gi.sum() / max(1, inside.sum())
    rec = (gi & near(p)).sum() / max(1, gi.sum()); prec = (pi & near(g)).sum() / max(1, pi.sum())
    return {"gdens": round(float(gd), 4), "recall": round(float(rec), 3), "precision": round(float(prec), 3)}
def is_clear(r):
    """Verified: another placement was found and clearly loses, Google maps streets inside the outline, and the plan's
    streets mostly lie on them. Either the past-plans rule (score >= 0.4, ratio >= 1.15) or a lower score that wins
    by 1.4 x. Set on the 82 ground-checked compounds: every placement this accepts was within 60 m of the ground
    check, except one where the ground check itself was 120 m off (410)."""
    if r.get("n_alt", 0) < 1 or r.get("gdens", 0) < 0.03 or r.get("precision", 0) < 0.45: return False
    s, q = r.get("score", 0), r.get("ratio", 0)
    return bool((s >= 0.4 and q >= 1.15) or (s >= 0.12 and q >= 1.4))
def worth_review(r):
    """Not clear, but Google maps the inside and the placement leads: a preview for a person to judge."""
    return bool(not is_clear(r) and r.get("gdens", 0) >= 0.03 and r.get("score", 0) >= 0.1 and r.get("ratio", 0) >= 1.1
                and r.get("precision", 0) >= 0.3)
def search(streets, zone, full, ox, oy, lo, hi, anchor, kw, cen, rad, ring, A_out, sil, k0):
    """Coarse search over all turns and the scale range, then a fine pass around the best distinct candidates."""
    span = max(full.shape) * RES
    def prep(c):
        a = full
        if c > 1: a = cv2.resize(a, (full.shape[1] // c, full.shape[0] // c), interpolation=cv2.INTER_AREA)
        return cv2.GaussianBlur(a.astype(np.float32) / 255.0, (0, 0), 1.0)
    # coarse: about 250 px over the drawing's long side
    longest = hi * max(streets.shape) / kw
    c = int(max(1, min(3, round(longest / 350 / RES))))
    city = prep(c); res = RES * c
    nsc = max(2, int(math.ceil(math.log(hi / lo) / math.log(1.07))))
    scales = [lo * (hi / lo) ** (i / nsc) for i in range(nsc + 1)]
    feasible = lambda M: overlap(M, ring, A_out, sil, k0, streets.shape, kw) >= MIN_OVERLAP - 0.25
    cand = run(streets, zone, city, res, scales, list(range(0, 360, 4)), anchor, kw, cen, rad, ox, oy, per=2, feasible=feasible)
    # only placements that cover the outline compete (a little slack before refinement)
    cand.sort(key=lambda t: -t[0]); distinct = []
    for t in cand:
        if all(different(t, k, rad) for k in distinct) and overlap(t[3], ring, A_out, sil, k0, streets.shape, kw) >= MIN_OVERLAP - 0.1:
            distinct.append(t)
            if len(distinct) >= 4: break
    # fine: full resolution, but at most ~1500 px over the drawing (very large towns would take ages otherwise)
    fc = int(max(1, round(longest / 1500 / RES))); fine = prep(fc); fres = RES * fc
    def refine(t, fs, ds, r):
        p = t[3] @ np.array([anchor[0], anchor[1], 1.0])
        rr = run(streets, zone, fine, fres, [t[1] * f for f in fs], [t[2] + d for d in ds], anchor, kw, p, r, ox, oy, per=1)
        rr.sort(key=lambda q: -q[0])
        for q in rr:
            ov = overlap(q[3], ring, A_out, sil, k0, streets.shape, kw)
            if ov >= MIN_OVERLAP: return (*q, ov)
    refined = [r for r in (refine(t, (0.97, 1.0, 1.03), (-2, 0, 2), 3 * res + 4) for t in distinct) if r]
    if not refined: return None
    refined.sort(key=lambda t: -t[0])
    b = refine(refined[0], (0.99, 1.0, 1.01), (-1, 0, 1), 2 * fres + 2) or refined[0]
    # runner-up: the best refined placement that is clearly different (scores at one resolution only)
    others = [t for t in refined if different(t, b, rad)]
    second = max([t[0] for t in others], default=0.0)
    return {"score": round(b[0], 4), "ratio": round(b[0] / max(second, 1e-6), 3) if others else 9.0, "scale": b[1], "rot": round(b[2] % 360, 1),
            "affine": b[3], "overlap": round(b[4], 3), "n_alt": len(others)}
PROBE = [0.0, 0.0]  # the drawing's anchor (original px): placements are compared by where it lands
def different(t, b, rad):
    """Another placement: turned more than 8 degrees, or the anchor landing clearly elsewhere."""
    d = abs((t[2] - b[2] + 180) % 360 - 180); p = np.array([PROBE[0], PROBE[1], 1.0])
    return d > 8 or float(np.hypot(*(t[3] @ p - b[3] @ p))) > max(60.0, 0.3 * rad)
def pick(cand, rad):
    cand.sort(key=lambda t: -t[0]); kept = []
    for t in cand:
        if all(different(t, k, rad) for k in kept): kept.append(t)
        if len(kept) >= 6: break
    return kept
def run(streets, zone, city, res, scales, rots, anchor, kw, cen, rad, ox, oy, per=2, feasible=None):
    CH, CW = city.shape; out = []
    for scale in scales:
        f = scale / kw / res  # template px per working px
        st_s = cv2.resize(streets, None, fx=f, fy=f, interpolation=cv2.INTER_AREA)
        zo_s = cv2.resize(zone, None, fx=f, fy=f, interpolation=cv2.INTER_AREA)
        fy_, fx_ = st_s.shape[0] / streets.shape[0], st_s.shape[1] / streets.shape[1]
        for rot in rots:
            th = math.radians(rot); c, s_ = math.cos(th), math.sin(th)
            A = np.array([[c, s_, 0.0], [-s_, c, 0.0]]); h, w = st_s.shape
            cor = np.array([[0, 0, 1], [w, 0, 1], [w, h, 1], [0, h, 1]], float) @ A.T
            mn = cor.min(0); A[:, 2] = -mn; tw, th_ = (np.ceil(cor.max(0) - mn).astype(int) + 1)
            if tw >= CW or th_ >= CH or tw < 8 or th_ < 8: continue
            A0 = A.copy(); A = A @ np.array([[fx_, 0, 0], [0, fy_, 0], [0, 0, 1.0]])  # working px -> template px
            # where the anchor may land: within rad of cen (Mercator) -> template origin window in raster px
            ap = A @ np.array([anchor[0] * kw, anchor[1] * kw, 1.0])
            u, vv = (cen[0] - ox) / res - ap[0], (oy - cen[1]) / res - ap[1]; r = rad / res
            Aw = A.copy(); Aw[:, :2] *= kw  # original px -> template px
            # skip turns and scales at which no shift in the window can cover the outline
            if feasible is not None and not feasible(to_affine(Aw, u, vv, res, ox, oy)): continue
            t = cv2.warpAffine(st_s, A0, (int(tw), int(th_)), flags=cv2.INTER_LINEAR).astype(np.float32) / 255.0
            v = cv2.warpAffine(zo_s, A0, (int(tw), int(th_)), flags=cv2.INTER_LINEAR).astype(np.float32) / 255.0
            t = cv2.GaussianBlur(t, (0, 0), 1.0)
            n = float(v.sum())
            if n < 50: continue
            tz = (t - (t * v).sum() / n) * v; tn = math.sqrt(float((tz ** 2).sum()))
            if tn < 1e-6: continue
            u0, v0 = max(0, int(u - r)), max(0, int(vv - r)); u1, v1 = min(CW - tw, int(u + r)), min(CH - th_, int(vv + r))
            if u1 <= u0 or v1 <= v0: continue
            sub = city[v0:v1 + th_, u0:u1 + tw]
            num = cv2.matchTemplate(sub, tz, cv2.TM_CCORR)
            s1 = cv2.matchTemplate(sub, v, cv2.TM_CCORR); s2 = cv2.matchTemplate(sub * sub, v, cv2.TM_CCORR)
            den = np.sqrt(np.maximum(s2 - s1 * s1 / n, 0.02 * n)) * tn
            sc = num / den
            for _ in range(per):
                _, mx, _, loc = cv2.minMaxLoc(sc)
                out.append((float(mx), scale, rot, to_affine(Aw, u0 + loc[0], v0 + loc[1], res, ox, oy)))
                q = max(3, int(60 / res)); cv2.rectangle(sc, (loc[0] - q, loc[1] - q), (loc[0] + q, loc[1] + q), -1.0, -1)
    return out
def overlap(M, ring, A_out, sil, k0, shape, kw):
    """Share of the outline covered by the placed drawing (its site silhouette, or its whole frame)."""
    Minv = np.linalg.inv(np.vstack([M, [0, 0, 1]]))[:2]
    q = np.c_[ring, np.ones(len(ring))] @ Minv.T  # outline in original px
    if sil is not None:
        g = 400 / max(sil.shape); m = cv2.resize(sil, None, fx=g, fy=g, interpolation=cv2.INTER_NEAREST); f = k0 * g
    else:
        h, w = shape; g = 400 / max(h, w); m = np.ones((max(1, round(h * g)), max(1, round(w * g))), np.uint8); f = kw * g
    pad = 400; canvas = np.zeros((m.shape[0] + 2 * pad, m.shape[1] + 2 * pad), np.uint8); canvas[pad:-pad, pad:-pad] = m
    o = np.zeros_like(canvas); cv2.fillPoly(o, [np.round(q * f + pad).astype(np.int32)], 1)
    return float((o & canvas).sum()) / max(1.0, float(o.sum()))
def clip_to_box(poly, W, H):
    """Sutherland-Hodgman: the outline cut to the image rectangle."""
    pts = [tuple(p) for p in poly]
    for axis, lim, keep_less in ((0, 0, False), (0, W, True), (1, 0, False), (1, H, True)):
        out = []
        for i in range(len(pts)):
            a, b = pts[i - 1], pts[i]
            ina = a[axis] <= lim if keep_less else a[axis] >= lim; inb = b[axis] <= lim if keep_less else b[axis] >= lim
            if inb:
                if not ina: out.append(_cut(a, b, axis, lim))
                out.append(b)
            elif ina: out.append(_cut(a, b, axis, lim))
        pts = out
        if not pts: break
    return np.array(pts, float).reshape(-1, 2)
def _cut(a, b, axis, lim):
    t = (lim - a[axis]) / (b[axis] - a[axis]); return (a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]))

def make_preview(src, orig, M, ring, full, ox, oy, out, path):
    """Three panels: Google's roads (red) on the plan; the plan over Google's road map; the plan over the satellite."""
    H0, W0 = orig.shape[:2]; g = min(1.0, 700 / max(H0, W0)); plan = cv2.resize(orig, None, fx=g, fy=g, interpolation=cv2.INTER_AREA)
    h, w = plan.shape[:2]
    # plan px (scaled) -> raster px
    P = np.array([[M[0, 0] / g / RES, M[0, 1] / g / RES, (M[0, 2] - ox) / RES], [-M[1, 0] / g / RES, -M[1, 1] / g / RES, (oy - M[1, 2]) / RES]])
    roads = cv2.warpAffine(full, P, (w, h), flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP)
    a = plan.copy(); a[roads > 100] = (0.3 * a[roads > 100] + 0.7 * np.array([0, 0, 255])).astype(np.uint8)
    # map view: square around the outline (+40 %), 700 px
    lo, hi = ring.min(0), ring.max(0); c = (lo + hi) / 2; span = max(hi - lo) * 1.5 + 200
    bx0, by0, bx1, by1 = c[0] - span / 2, c[1] - span / 2, c[0] + span / 2, c[1] + span / 2
    S = 700; res = span / S
    def view(raster, rox, roy, rres):
        T = np.array([[res / rres, 0, (bx0 - rox) / rres], [0, res / rres, (roy - by1) / rres]])
        return cv2.warpAffine(raster, T, (S, S), flags=cv2.INTER_AREA | cv2.WARP_INVERSE_MAP)
    gm = view(255 - (full // 2), ox, oy, RES); gm = cv2.cvtColor(gm, cv2.COLOR_GRAY2BGR)
    z = max(12, min(18, int(math.log2(2 * HALF / (256 * res)))))
    sat, (sox, soy), sres = esri(f"{src}/tiles", bx0, by0, bx1, by1, z); sat = view(sat, sox, soy, sres)
    # plan px (original) -> view px
    Q = np.array([[M[0, 0] / res, M[0, 1] / res, (M[0, 2] - bx0) / res], [-M[1, 0] / res, -M[1, 1] / res, (by1 - M[1, 2]) / res]])
    warped = cv2.warpAffine(orig, Q, (S, S), flags=cv2.INTER_AREA, borderValue=(0, 0, 0))
    inside = cv2.warpAffine(np.ones(orig.shape[:2], np.uint8), Q, (S, S), flags=cv2.INTER_NEAREST) > 0
    ringpx = np.round(np.c_[(ring[:, 0] - bx0) / res, (by1 - ring[:, 1]) / res]).astype(np.int32)
    panels = []
    for base, alpha in ((gm, 0.45), (sat, 0.5)):
        b = base.copy(); b[inside] = (alpha * warped[inside] + (1 - alpha) * b[inside]).astype(np.uint8)
        cv2.polylines(b, [ringpx], True, (0, 255, 255), 2); panels.append(b)
    pa = np.full((S, S, 3), 255, np.uint8); pa[:h, :w] = a
    sheet = np.hstack(panels[:1] + [pa] + panels[1:])
    txt = f"{out['id']} {out['variant']} score {out['score']:.3f} ratio {out['ratio']:.2f} ov {out['overlap']:.2f} rot {out['rot']:.0f} s {out['scale'] / out['scale_prior']:.2f}x"
    cv2.putText(sheet, txt, (8, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 4); cv2.putText(sheet, txt, (8, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)
    cv2.imwrite(path, sheet, [cv2.IMWRITE_JPEG_QUALITY, 80])

if __name__ == "__main__":
    src, pub, cid = sys.argv[1], sys.argv[2], int(sys.argv[3])
    def opt(n): return sys.argv[sys.argv.index(n) + 1] if n in sys.argv else None
    r = place(src, pub, cid, image=opt("--image"), preview=opt("--preview"), masks_out=opt("--masks"))
    print(json.dumps({k: v for k, v in r.items() if k not in ("clip", "affine")}))
