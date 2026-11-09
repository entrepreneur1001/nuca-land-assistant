"""Re-segment the offered (yellow) plots of a low-resolution plan, one polygon per printed plot number.
The colour threshold of extract.py merges neighbours whose thin separator line is too faint and cuts plots whose number
touches a line; here the yellow blocks are flooded from the number positions (read_tiles.py tokens) over the darkness of
the separator lines (seeded watershed), so every number gets exactly one polygon.
usage: python3 segment.py <zone.jpg> <plots.json from extract.py> <tokens.json> <out plots.json> [--fix fixes.json] [--debug out.png]
Polygons of extract.py that hold no number but have a normal size keep a seed of their own (number unread).
"""
import sys, json, heapq, collections
import cv2, numpy as np
src, pj, tj, outf = sys.argv[1:5]
dbg = sys.argv[sys.argv.index("--debug") + 1] if "--debug" in sys.argv else None
img = cv2.imread(src); H, W = img.shape[:2]
d = json.load(open(pj)); polys = d["plots"]
toks = json.load(open(tj))["tokens"]
# --- number sites: clusters of tokens at one place, read in several renderings
sites = []
for t in sorted(toks, key=lambda t: -len(t[0])):
    for s in sites:
        if abs(s["x"] - t[3]) < 6 and abs(s["y"] - t[4]) < 4.5: s["tok"].append(t); break
    else: sites.append({"x": t[3], "y": t[4], "tok": [t]}); s = sites[-1]
    full = [u for u in s["tok"] if len(u[0]) == max(len(v[0]) for v in s["tok"])]
    s["x"] = float(np.median([u[3] for u in full])); s["y"] = float(np.median([u[4] for u in full])); s["w"] = float(np.median([u[5] for u in full]))
for s in sites: s["nvar"] = len({t[2] for t in s["tok"]})
sites = [s for s in sites if s["nvar"] >= 4]
if "--fix" in sys.argv:   # numbers read by eye: seeds where OCR found no number site
    import os, re
    zid = re.search(r"zone_(\d+)", os.path.basename(src)).group(1)
    for x, y, t in json.load(open(sys.argv[sys.argv.index("--fix") + 1])).get(zid, []):
        if not any(abs(s["x"] - x) < 6 and abs(s["y"] - y) < 4.5 for s in sites): sites.append({"x": float(x), "y": float(y), "w": 3.5 * len(t) + 1, "tok": [], "nvar": 9})
# --- yellow blocks (plots + separator lines + digits)
hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
yel = cv2.inRange(hsv, (18, 110, 150), (42, 255, 255))
red = cv2.bitwise_or(cv2.inRange(hsv, (0, 60, 60), (17, 255, 255)), cv2.inRange(hsv, (165, 60, 60), (180, 255, 255)))
old = np.zeros((H, W), np.uint8); label = np.full((H, W), -1, np.int32)
for i, p in enumerate(polys):
    a = np.array(p["poly"], np.int32); cv2.fillPoly(old, [a], 255); cv2.fillPoly(label, [a], i)
near_old = cv2.dilate(old, np.ones((7, 7), np.uint8))
block = cv2.bitwise_or(yel, cv2.bitwise_and(red, near_old))      # digits only count next to known plots (not the red fence)
block = cv2.morphologyEx(block, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
strict = cv2.bitwise_or(cv2.inRange(hsv, (22, 200, 225), (38, 255, 255)), old)
block = cv2.bitwise_and(cv2.bitwise_or(block, old), cv2.dilate(strict, np.ones((5, 5), np.uint8)))   # lines/digits within 2 px of clear yellow; no pavement
block = cv2.morphologyEx(block, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
n, cl, st, _ = cv2.connectedComponentsWithStats(block, connectivity=4)
keep = {int(cl[int(s["y"]), int(s["x"])]) for s in sites if 0 <= s["x"] < W and 0 <= s["y"] < H} | {int(c) for c in np.unique(cl[old > 0])}
keep.discard(0)
block = np.isin(cl, list(keep)).astype(np.uint8) * 255
block[:int(H * 0.1)][:, :] = np.where(old[:int(H * 0.1)] > 0, block[:int(H * 0.1)], 0)   # never the yellow title bar
med = float(np.median([p["area_px"] for p in polys]))
# extract.py polygons that hold exactly one number and have a normal size are kept as they are; the rest (several
# numbers = merged neighbours; small pieces = a plot cut through its number; numbers on no polygon) is re-flooded.
allsites = [{"x": s["x"], "y": s["y"], "w": s["w"], "site": True} for s in sites if block[int(s["y"]), int(s["x"])]]
inside = collections.defaultdict(list)
for i, p in enumerate(polys):   # polygon test, not the raster: extract.py pieces of a cut plot can overlap
    bx, by, bw, bh = p["bbox"]; a = np.array(p["poly"], np.float32)
    for k, s in enumerate(allsites):
        if bx - 1 <= s["x"] <= bx + bw + 1 and by - 1 <= s["y"] <= by + bh + 1 and cv2.pointPolygonTest(a, (s["x"], s["y"]), False) >= 0: inside[i].append(k)
good = [i for i, p in enumerate(polys) if p["area_px"] >= 0.62 * med and len(inside[i]) <= 1]
goodset = set(good); taken_sites = {k for i in good for k in inside[i]}
seeds = [s for k, s in enumerate(allsites) if k not in taken_sites]
region = np.zeros((H, W), np.uint8)
for i, p in enumerate(polys):
    if i not in goodset: cv2.fillPoly(region, [np.array(p["poly"], np.int32)], 255)
for s in seeds: cv2.circle(region, (int(s["x"]), int(s["y"])), int(0.6 * np.sqrt(med)), 255, -1)
region = cv2.dilate(region, np.ones((5, 5), np.uint8))
for i in good: cv2.fillPoly(region, [np.array(polys[i]["poly"], np.int32)], 0)
block = cv2.bitwise_and(block, region)
if not seeds or not block.any():
    for i in good: polys[i]["has_number"] = bool(inside[i])
    d["plots"] = [polys[i] for i in good]; json.dump(d, open(outf, "w")); print(f"{src}: nothing to re-segment, {len(good)} polygons"); sys.exit()
S = 4
b_, g_, r_ = [c.astype(np.float32) for c in cv2.split(img)]
dark = 255 - np.minimum(r_, g_)            # yellow → 0, olive separator → ~50, red ink → ~190
ys, xs = np.nonzero(block); X0, X1, Y0, Y1 = max(xs.min() - 2, 0), min(xs.max() + 3, W), max(ys.min() - 2, 0), min(ys.max() + 3, H)
ridge = cv2.GaussianBlur(cv2.resize(dark[Y0:Y1, X0:X1], None, fx=S, fy=S, interpolation=cv2.INTER_CUBIC), (0, 0), 1.0)
m = cv2.resize(block[Y0:Y1, X0:X1], None, fx=S, fy=S, interpolation=cv2.INTER_NEAREST)
mark = np.zeros(ridge.shape, np.int32)
for k, s in enumerate(seeds):
    c = (int((s["x"] - X0) * S), int((s["y"] - Y0) * S))
    cv2.ellipse(mark, c, (max(4, int(s["w"] * S / 2)), int(3.2 * S) if s["site"] else 6), 0, 0, 360, k + 1, -1)
mark[m == 0] = 0
hh, ww = ridge.shape; rl = ridge.tolist(); ml = (m > 0).tolist()
def flood(step):
    """lowest ridge first; +step per pixel so that areas without a visible line are shared half-way"""
    q = []; cnt = 0; kl = mark.tolist()
    for yy, xx in zip(*np.nonzero(mark)): q.append((0.0, cnt, int(yy), int(xx))); cnt += 1
    heapq.heapify(q)
    while q:
        lvl, _, yy, xx = heapq.heappop(q); lab = kl[yy][xx]
        for a, b in ((yy + 1, xx), (yy - 1, xx), (yy, xx + 1), (yy, xx - 1)):
            if 0 <= a < hh and 0 <= b < ww and ml[a][b] and kl[a][b] == 0:
                kl[a][b] = lab; cnt += 1
                heapq.heappush(q, (max(lvl, rl[a][b]) + step, cnt, a, b))
    return np.array(kl, np.int32)
# Two floods: one that trusts the separator lines (small step) and one that leans on distance (for pairs whose line is
# invisible). Per connected cluster the result with the more even plot sizes wins.
fa, fb = flood(0.03), flood(0.15)
nc, comp_l = cv2.connectedComponents((m > 0).astype(np.uint8), connectivity=4)
def spread(f, sel):
    labs, cnts = np.unique(f[sel], return_counts=True); cnts = cnts[labs > 0]
    return float(np.std(cnts) / max(np.mean(cnts), 1)) if len(cnts) > 1 else 0.0
mark = fa.copy(); nb_used = 0
for c in range(1, nc):
    sel = comp_l == c
    if spread(fb, sel) < spread(fa, sel) - 0.08: mark[sel] = fb[sel]; nb_used += 1
new = []
objs = cv2.connectedComponentsWithStats  # noqa
for k, s in enumerate(seeds):
    x = int((s["x"] - X0) * S); y = int((s["y"] - Y0) * S); R = int(4 * np.sqrt(med) * S)
    xa, ya = max(0, x - R), max(0, y - R)
    comp = (mark[ya:y + R, xa:x + R] == k + 1).astype(np.uint8)
    comp = cv2.morphologyEx(comp, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 13)))
    cs, _ = cv2.findContours(comp, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cs: continue
    c = max(cs, key=cv2.contourArea)
    poly = np.round(cv2.approxPolyDP(c, 0.012 * cv2.arcLength(c, True), True).reshape(-1, 2) / S + [xa / S + X0, ya / S + Y0], 1)
    bx, by, bw, bh = cv2.boundingRect(poly.astype(np.float32))
    new.append({"poly": poly.tolist(), "bbox": [int(bx), int(by), int(bw), int(bh)], "area_px": int(cv2.contourArea(c) / S / S), "text": "", "conf": 0, "cands": [], "seed": [round(s["x"], 1), round(s["y"], 1)], "has_number": s["site"]})
for i in good: polys[i]["has_number"] = bool(inside[i])
d["plots"] = [polys[i] for i in good] + new
json.dump(d, open(outf, "w"))
print(f"{src}: extract.py polygons {len(polys)} → {len(d['plots'])}: kept {len(good)} ({sum(1 for i in good if not inside[i])} without a number), re-segmented {len(polys) - len(good)} → {len(new)}; number sites {len(allsites)}")
if dbg:
    vis = cv2.resize(img, None, fx=3, fy=3, interpolation=cv2.INTER_CUBIC)
    for p in d["plots"]: cv2.polylines(vis, [(np.array(p["poly"]) * 3).astype(np.int32)], True, (255, 0, 255) if "seed" in p else (255, 0, 0) if p["has_number"] else (0, 0, 255), 1)
    cv2.imwrite(dbg, vis)
