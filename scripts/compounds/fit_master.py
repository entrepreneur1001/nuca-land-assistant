"""Fit a compound's master-plan drawing onto the map by its silhouette: the drawn site, cut from the page background,
is rotated, scaled and shifted until it covers the compound's outline. Marketing drawings are not surveys, so a fit
is only kept when the two shapes agree (IoU); the rest stay an outline on the map.
usage: python3 fit_master.py <fetch dir> <public/compounds> <out fits.json> [--ids file.json] [--sheet dir]
fits.json: {id: {iou, w, h, corners: {tl, tr, bl}, clip: [[x, y], ...]}} with corners as [lat, lng] of the image
(the size exported by build_compounds.py) and clip the compound outline in image pixels.
"""
import sys, os, json, math, glob
import numpy as np, cv2
SRC, PUB, OUT = sys.argv[1:4]
IDS = set(json.load(open(sys.argv[sys.argv.index("--ids") + 1]))) if "--ids" in sys.argv else None
SHEET = sys.argv[sys.argv.index("--sheet") + 1] if "--sheet" in sys.argv else None
N = 320  # working size of the silhouette
def silhouette(path):
    im = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    if im is None: return None
    if im.ndim == 2: im = cv2.cvtColor(im, cv2.COLOR_GRAY2BGR)
    h, w = im.shape[:2]; k = N / max(h, w)
    im = cv2.resize(im, (max(1, round(w * k)), max(1, round(h * k))), interpolation=cv2.INTER_AREA)
    if im.shape[2] == 4 and (im[..., 3] < 128).mean() > 0.03: fg = im[..., 3] >= 128
    else:
        rgb = im[..., :3].astype(np.int16)
        edge = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])
        bg = np.median(edge, axis=0)
        if (np.abs(edge - bg).max(axis=1) < 26).mean() < 0.7: return None  # no plain page around the drawing
        fg = np.abs(rgb - bg).max(axis=2) > 26
    fg = cv2.morphologyEx(fg.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(fg, 8)
    if n < 2: return None
    big = 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))
    m = (lab == big).astype(np.uint8)
    cs, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    m[:] = 0; cv2.drawContours(m, cs, -1, 1, -1)  # holes (lakes, white roads) belong to the site
    frac = m.mean()
    if frac < 0.08 or frac > 0.9: return None
    return m, k
def iou_at(mask, pts, th, s, cx, cy):
    c, sn = math.cos(th), math.sin(th)
    q = np.stack([(pts[:, 0] * c - pts[:, 1] * sn) * s + cx, (pts[:, 0] * sn + pts[:, 1] * c) * s + cy], 1)
    r = np.zeros_like(mask); cv2.fillPoly(r, [np.round(q).astype(np.int32)], 1)
    inter = (r & mask).sum(); return inter / max(1, (r | mask).sum() ), q
def fit(mask, ring):
    lat0 = sum(p[0] for p in ring) / len(ring); kx, ky = 111320 * math.cos(math.radians(lat0)), 110540
    # metres, x east, y down (image-like)
    pts = np.array([[p[1] * kx, -p[0] * ky] for p in ring]); org = pts.mean(0); pts = pts - org
    area_p = cv2.contourArea(pts.astype(np.float32)); ys, xs = np.nonzero(mask)
    s0 = math.sqrt(mask.sum() / area_p); cx0, cy0 = xs.mean(), ys.mean()
    best = (0, None)
    for deg in range(0, 360, 4):
        for sm in (0.88, 0.94, 1.0, 1.06, 1.12):
            v, _ = iou_at(mask, pts, math.radians(deg), s0 * sm, cx0, cy0)
            if v > best[0]: best = (v, (math.radians(deg), s0 * sm, cx0, cy0))
    v, (th, s, cx, cy) = best
    step = [math.radians(2), 0.03, 4, 4]
    for _ in range(6):  # coordinate descent, halving the steps
        for i in range(4):
            for d in (-1, 1):
                p = [th, s, cx, cy]; p[i] = p[i] * (1 + d * step[i]) if i == 1 else p[i] + d * step[i]
                nv, _ = iou_at(mask, pts, *p)
                if nv > v: v, (th, s, cx, cy) = nv, p
        step = [x / 2 for x in step]
    v, q = iou_at(mask, pts, th, s, cx, cy)
    # second best at a clearly different rotation: a near-symmetric outline fits two ways
    alt = max((iou_at(mask, pts, math.radians(d), s, cx0, cy0)[0] for d in range(0, 360, 6) if min(abs(d - math.degrees(th) % 360), 360 - abs(d - math.degrees(th) % 360)) > 40), default=0)
    def to_ll(x, y):  # working pixel -> [lat, lng]
        dx, dy = (x - cx) / s, (y - cy) / s; c, sn = math.cos(-th), math.sin(-th)
        mx, my = dx * c - dy * sn + org[0], dx * sn + dy * c + org[1]
        return [round(-my / ky, 6), round(mx / kx, 6)]
    return v, alt, q, to_ll, math.degrees(th) % 360
comps = {c["id"]: c for c in json.load(open(f"{PUB}/index.json"))["compounds"]}
masters = {int(os.path.splitext(os.path.basename(f))[0]): f for f in glob.glob(f"{SRC}/master/*") if os.path.splitext(os.path.basename(f))[0].isdigit()}
fits, tried, nosil = {}, 0, 0
if SHEET: os.makedirs(SHEET, exist_ok=True)
for cid, c in sorted(comps.items()):
    if not c["img"] or cid not in masters or (IDS is not None and cid not in IDS): continue
    tried += 1
    sil = silhouette(masters[cid])
    if sil is None: nosil += 1; print(cid, c["name"], "no silhouette", flush=True); continue
    mask, k = sil
    v, alt, q, to_ll, deg = fit(mask, c["ring"])
    web = cv2.imread(f"{PUB}/img/{cid}.webp", cv2.IMREAD_UNCHANGED); h, w = web.shape[:2]; f = w / mask.shape[1]
    fits[str(cid)] = {"iou": round(float(v), 3), "alt": round(float(alt), 3), "rot": round(deg, 1), "w": w, "h": h,
                      "corners": {"tl": to_ll(0, 0), "tr": to_ll(mask.shape[1], 0), "bl": to_ll(0, mask.shape[0])},
                      "clip": [[round(float(x * f)), round(float(y * f))] for x, y in q]}
    print(cid, c["name"], f"iou {v:.2f} alt {alt:.2f} rot {deg:.0f}", flush=True)
    if SHEET:
        vis = cv2.resize(web[..., :3].copy(), (mask.shape[1] * 2, mask.shape[0] * 2))
        cv2.polylines(vis, [np.round(q * 2).astype(np.int32)], True, (255, 0, 255), 2)
        cv2.putText(vis, f"{cid} iou {v:.2f} alt {alt:.2f}", (6, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 2)
        cv2.imwrite(f"{SHEET}/{int(v * 100):03d}_{cid}.jpg", vis)
json.dump(fits, open(OUT, "w"))
vals = [f["iou"] for f in fits.values()]
print(f"{tried} tried, {nosil} without a silhouette, " + ", ".join(f">={t}: {sum(v >= t for v in vals)}" for t in (0.9, 0.85, 0.8, 0.7)))
