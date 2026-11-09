"""Extract offered-plot polygons from a LOW-RESOLUTION zone plan (≈2048 px wide, plots ~10 px, numbers unreadable).
usage: python3 extract_small.py <zone.jpg> <out.json> [--debug out.png] [--up 4] [--min-area 25] [--split-area px2] [--k "compIndex:k,..."]
Works on a cubic-upscaled copy. Yellow fill + the dark number blob inside it form one component per plot or per
group of touching plots; a component holding k number blobs is split into k cells along its long axis (override
the count per component with --k after looking at the debug image, which labels components c<i>/k).
No OCR: "text" stays empty (digits are 3-4 px tall). Polygon coords are original pixels (floats).
"""
import sys, json
import cv2, numpy as np
src, out = sys.argv[1], sys.argv[2]
def opt(n, d): return type(d)(sys.argv[sys.argv.index(n) + 1]) if n in sys.argv else d
UP = opt("--up", 4); MINA = opt("--min-area", 25.0); dbg = opt("--debug", ""); SPLIT = opt("--split-area", 0.0)  # px² of one plot: k = area/SPLIT rounded (≥0.6 fraction rounds up)
force = {int(a.split(":")[0]): int(a.split(":")[1]) for a in opt("--k", "").split(",") if a}
img0 = cv2.imread(src); H, W = img0.shape[:2]
img = cv2.resize(img0, None, fx=UP, fy=UP, interpolation=cv2.INTER_CUBIC)
hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
yel = cv2.inRange(hsv, (22, 110, 160), (32, 255, 255))
darkish = cv2.inRange(hsv, (0, 0, 0), (180, 255, 150))
# number blobs: dark pixels enclosed by yellow → close the yellow mask, keep dark pixels inside the closed region
closed = cv2.morphologyEx(yel, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * UP + 1, 2 * UP + 1)))
n, lab, st, _ = cv2.connectedComponentsWithStats(closed, connectivity=8)
plots = []; comps = []
ci = -1
for i in range(1, n):
    x, y, w, h, a = st[i]
    if a < MINA * UP * UP or a > 3000 * UP * UP: continue
    if y < 0.15 * H * UP and x < 0.08 * W * UP: continue  # logo
    ci += 1
    pad = 3 * UP
    x0, y0 = max(0, x - pad), max(0, y - pad); x1, y1 = x + w + pad, y + h + pad
    comp = (lab[y0:y1, x0:x1] == i).astype(np.uint8)
    cs, _ = cv2.findContours(comp, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    filled = np.zeros_like(comp); cv2.drawContours(filled, cs, -1, 1, -1)
    inner = cv2.erode(filled, np.ones((3, 3), np.uint8), iterations=max(2, UP // 2 + 1))
    dark = ((darkish[y0:y1, x0:x1] > 0) & (inner > 0)).astype(np.uint8)
    nb, bl, bs, bc = cv2.connectedComponentsWithStats(dark, connectivity=8)
    blobs = [bc[j] for j in range(1, nb) if bs[j, cv2.CC_STAT_AREA] >= 1.0 * UP * UP]
    k = force.get(ci, max(1, int(a / UP / UP / SPLIT + 0.4)) if SPLIT else max(1, len(blobs)))
    filled = cv2.dilate(filled, np.ones((3, 3), np.uint8), iterations=max(1, UP // 4))
    ys, xs = np.nonzero(filled); pts = np.stack([xs, ys], 1).astype(np.float64)
    cells = [filled]
    if k >= 2:
        mu = pts.mean(0); _, _, vt = np.linalg.svd(pts - mu, full_matrices=False); t = (pts - mu) @ vt[0]
        if len(blobs) == k:  # cut midway between consecutive number blobs
            bt = sorted(((np.array(b) - mu) @ vt[0]) for b in blobs); cuts = [(a_ + b_) / 2 for a_, b_ in zip(bt, bt[1:])]
        else: cuts = list(np.quantile(t, [j / k for j in range(1, k)]))
        own = np.searchsorted(cuts, t); cells = []
        for j in range(k):
            m = np.zeros_like(filled); m[ys[own == j], xs[own == j]] = 1; cells.append(m)
    comps.append((ci, k, round(a / UP / UP), x, y))
    for m in cells:
        cs, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not cs: continue
        c = cv2.convexHull(max(cs, key=cv2.contourArea))  # plots are convex; removes notches left by the number blob
        poly = (cv2.approxPolyDP(c, 0.025 * cv2.arcLength(c, True), True).reshape(-1, 2) + [x0, y0]) / UP
        if len(poly) < 3: continue
        bx, by = poly.min(0); ex, ey = poly.max(0)
        plots.append({"poly": [[round(float(px), 2), round(float(py), 2)] for px, py in poly], "bbox": [int(bx), int(by), int(ex - bx) + 1, int(ey - by) + 1],
                      "area_px": round(cv2.contourArea(c) / UP / UP, 1), "text": "", "conf": 0, "cands": [], "comp": ci})
json.dump({"width": W, "height": H, "plots": plots}, open(out, "w"))
print(f"{src}: {len(comps)} components → {len(plots)} plots; k per component:", [c[1] for c in comps])
if dbg:
    vis = img.copy()
    for p in plots: cv2.polylines(vis, [(np.array(p["poly"]) * UP).astype(np.int32)], True, (255, 0, 0), 2)
    for ci, k, nb, x, y in comps: cv2.putText(vis, f"c{ci}/{k}", (x, y - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (200, 0, 200), 2)
    cv2.imwrite(dbg, vis)
