"""Coarse georeferencing of a zone plan without known coordinates: match the plan's road network against
OpenStreetMap roads by normalised cross-correlation over rotations.
usage: python3 match_roads.py <plans dir> <zone_plots.json> <osm/<key>.json> <zid> <out reg dir> [--res 2.0] [--rot 0,45,90,...] [--scale s_m_per_px]
Scale: from the plots' m² areas vs their pixel areas (÷1.15 bias seen on georeferenced zones) unless --scale is given.
Writes <out>/<zid>.cand.json with the top candidates [{affine, score, rot}] and a preview PNG per candidate.
"""
import sys, json, math, os
import numpy as np, cv2
R = 6378137.0
def merc(lat, lng): return (math.radians(lng) * R, math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * R)
def poly_area(poly): return abs(sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(poly, poly[1:] + poly[:1]))) / 2
plans, zpf, osmf, zid, out = sys.argv[1:6]
res = float(sys.argv[sys.argv.index("--res") + 1]) if "--res" in sys.argv else 2.0
rots = [float(x) for x in sys.argv[sys.argv.index("--rot") + 1].split(",")] if "--rot" in sys.argv else list(range(0, 360, 5))
zp = json.load(open(zpf))[zid]; ex = json.load(open(f"{plans}/zone_{zid}.plots.json")); polys = ex["plots"]
img = cv2.imread(f"{plans}/zone_{zid}.jpg"); H, W = img.shape[:2]
# --- scale (m per plan px)
if "--scale" in sys.argv: scale = float(sys.argv[sys.argv.index("--scale") + 1])
else:
    px = sum(poly_area(p["poly"]) for p in polys); m2 = sum(p["area"] for p in zp["plots"])
    scale = math.sqrt(m2 * 1.15 / px) if px and m2 else None
print(f"scale {scale:.4f} m/px ({len(polys)} polygons, {len(zp['plots'])} plots)")
# --- plan road mask: light grey, unsaturated pixels (roads), excluding the header/footer bands and near-white
hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
road = cv2.inRange(hsv, (0, 0, 150), (180, 45, 225))
gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY); dark_rows = (gray < 120).mean(1) > 0.6
road[dark_rows, :] = 0
road[:int(H * 0.12), int(W * 0.6):] = 0  # title band
# Downsample to `res` m/px
f = scale / res
small = cv2.resize(road, (max(1, int(W * f)), max(1, int(H * f))), interpolation=cv2.INTER_AREA)
small = (small > 60).astype(np.uint8) * 255
small = cv2.morphologyEx(small, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
# --- OSM raster around the centre
osm = json.load(open(osmf)); clat, clng = osm["centre"]; rad = osm["radius"]
cx, cy = merc(clat, clng); half = rad * 1.1
N = int(2 * half / res)
ras = np.zeros((N, N), np.uint8)
width = {"motorway": 30, "trunk": 25, "primary": 20, "secondary": 16, "tertiary": 12, "residential": 9, "unclassified": 9, "service": 6, "living_street": 8, "track": 5, "path": 3, "footway": 3, "cycleway": 3, "pedestrian": 6}
for w in osm["ways"]:
    pts = [merc(a, b) for a, b in w["pts"]]
    pp = np.array([[(x - (cx - half)) / res, ((cy + half) - y) / res] for x, y in pts], np.int32)
    cv2.polylines(ras, [pp], False, 255, max(2, int(width.get(w["hw"], 8) / res)))
# Blur both so near-misses still score
sb = cv2.GaussianBlur(small, (0, 0), 2); rb = cv2.GaussianBlur(ras, (0, 0), 2)
cands = []
for rot in rots:
    Mr = cv2.getRotationMatrix2D((small.shape[1] / 2, small.shape[0] / 2), -rot, 1.0)  # image rotation (deg, clockwise positive in image coords)
    # rotate around centre with enough canvas
    cos, sin = abs(Mr[0, 0]), abs(Mr[0, 1]); nw, nh = int(small.shape[0] * sin + small.shape[1] * cos), int(small.shape[0] * cos + small.shape[1] * sin)
    Mr[0, 2] += nw / 2 - small.shape[1] / 2; Mr[1, 2] += nh / 2 - small.shape[0] / 2
    tpl = cv2.warpAffine(sb, Mr, (nw, nh))
    if tpl.shape[0] >= rb.shape[0] or tpl.shape[1] >= rb.shape[1]: continue
    r = cv2.matchTemplate(rb, tpl, cv2.TM_CCOEFF_NORMED)
    # top 3 local maxima for this rotation
    rr = r.copy()
    for _ in range(3):
        _, mx, _, loc = cv2.minMaxLoc(rr)
        cands.append((float(mx), rot, loc, Mr, nw, nh))
        cv2.circle(rr, loc, 25, -1, -1)
cands.sort(key=lambda c: -c[0])
os.makedirs(out, exist_ok=True)
results = []
for k, (score, rot, (lx, ly), Mr, nw, nh) in enumerate(cands[:6]):
    # plan px → small px (×f) → rotated (Mr) → raster px (+loc) → metres
    A1 = np.array([[f, 0, 0], [0, f, 0], [0, 0, 1.0]])
    A2 = np.vstack([Mr, [0, 0, 1]])
    A3 = np.array([[1, 0, lx], [0, 1, ly], [0, 0, 1.0]])
    A4 = np.array([[res, 0, cx - half], [0, -res, cy + half], [0, 0, 1.0]])  # raster px → metres (y down → up)
    M = (A4 @ A3 @ A2 @ A1)[:2]
    results.append({"affine": M.tolist(), "score": score, "rot": rot, "scale_m_per_px": scale})
    # preview: raster with template outline
    vis = cv2.cvtColor(rb, cv2.COLOR_GRAY2BGR)
    tplc = cv2.warpAffine(sb, Mr, (nw, nh))
    sub = vis[ly:ly + nh, lx:lx + nw]
    sub[..., 2] = np.maximum(sub[..., 2], tplc[:sub.shape[0], :sub.shape[1]])
    cv2.rectangle(vis, (lx, ly), (lx + nw, ly + nh), (0, 255, 0), 2)
    cv2.imwrite(f"{out}/{zid}.cand{k}.png", cv2.resize(vis, None, fx=min(1, 1600 / vis.shape[1]), fy=min(1, 1600 / vis.shape[1])))
    print(f"cand {k}: score {score:.3f} rot {rot}° at raster ({lx},{ly})")
json.dump(results, open(f"{out}/{zid}.cand.json", "w"))
