"""Fine-tune a placement so that OpenStreetMap road centre-lines run down the middle of the drawing's streets.
Only roads OpenStreetMap has are scored, so a drawing whose inner streets are not mapped yet is still pinned by
its boundary roads. Searches scale ±6 %, rotation ±3°, shift ±120 m around the given placement.
usage: python3 refine_axis.py <placement.json> <overpass out-geom json> <out.json> [--cand i] [--mask dark|mid|light|white]
Writes a placement file with one candidate (same shape as place.py's).
"""
import sys, json, math
import numpy as np, cv2
R = 6378137.0
def merc(lat, lng): return (math.radians(lng) * R, math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * R)
def opt(name, default=None): return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default
src, osm, out = sys.argv[1:4]
d = json.load(open(src)); cand = d["candidates"][int(opt("--cand", "0"))]; M0 = np.array(cand["affine"])
img = cv2.imread(d["image"]); H, W = img.shape[:2]
hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV); s, v = hsv[..., 1], hsv[..., 2]
name = opt("--mask", cand.get("mask", "dark"))
mask = {"dark": (s < 60) & (v > 35) & (v < 125), "mid": (s < 40) & (v >= 125) & (v < 200), "light": (s < 28) & (v >= 200) & (v < 238), "white": (s < 14) & (v >= 240)}[name].astype(np.uint8) * 255
k = max(3, int(round(min(H, W) / 250))) | 1
mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((k, k), np.uint8))
# Depth inside the street band, in image px: largest on the band's centre line. Capped so wide dark areas (car parks,
# satellite shadows) are worth no more than a street.
depth = cv2.distanceTransform(mask, cv2.DIST_L2, 5)
scale0 = math.hypot(M0[0, 0], M0[1, 0]); cap = max(2.0, 9.0 / scale0)  # ~9 Mercator metres: half a local street
depth = np.minimum(depth, cap) / cap
depth = cv2.GaussianBlur(depth, (0, 0), 1.0)
# OSM points near the drawing, every ~4 m.
cor = np.array([[0, 0, 1], [W, 0, 1], [W, H, 1], [0, H, 1]], float) @ M0.T; mn, mx = cor.min(0) - 200, cor.max(0) + 200
pts = []
for w in json.load(open(osm))["elements"]:
    g = w.get("geometry")
    if not g: continue
    p = np.array([merc(q["lat"], q["lon"]) for q in g])
    if p[:, 0].max() < mn[0] or p[:, 0].min() > mx[0] or p[:, 1].max() < mn[1] or p[:, 1].min() > mx[1]: continue
    for a, b in zip(p[:-1], p[1:]):
        n = max(1, int(np.hypot(*(b - a)) / 4)); t = np.linspace(0, 1, n, endpoint=False)[:, None]; pts.append(a + (b - a) * t)
pts = np.vstack(pts); print(len(pts), "OSM points near the drawing")
c0 = M0 @ np.array([W / 2, H / 2, 1.0])
def affine(ds, dr, dx, dy):
    """M0 with scale × (1+ds), rotation + dr rad about the drawing's centre, shifted by (dx, dy) metres."""
    c, s_ = math.cos(dr) * (1 + ds), math.sin(dr) * (1 + ds); Rm = np.array([[c, -s_], [s_, c]])
    A = Rm @ M0[:, :2]; t = c0 + np.array([dx, dy]) - A @ np.array([W / 2, H / 2])
    return np.column_stack([A, t])
def score(p):
    M = affine(*p); inv = np.linalg.inv(np.vstack([M, [0, 0, 1]]))[:2]
    px = pts @ inv[:, :2].T + inv[:, 2]
    ok = (px[:, 0] >= 0) & (px[:, 0] < W - 1) & (px[:, 1] >= 0) & (px[:, 1] < H - 1)
    if ok.sum() < 50: return 0.0
    q = px[ok].astype(np.float32)
    val = cv2.remap(depth, q[:, 0].reshape(-1, 1), q[:, 1].reshape(-1, 1), cv2.INTER_LINEAR)
    # Mean over the points inside the frame at the starting placement's count, so sliding roads out of frame doesn't pay.
    return float(val.sum()) / max(n_ref, ok.sum())
n_ref = 1; M = affine(0, 0, 0, 0); inv0 = np.linalg.inv(np.vstack([M, [0, 0, 1]]))[:2]; px0 = pts @ inv0[:, :2].T + inv0[:, 2]
n_ref = int(((px0[:, 0] >= 0) & (px0[:, 0] < W - 1) & (px0[:, 1] >= 0) & (px0[:, 1] < H - 1)).sum())
best = np.zeros(4); bs = score(best); print(f"start score {bs:.4f}")
steps = np.array([0.02, math.radians(1.0), 40.0, 40.0]); lim = np.array([0.06, math.radians(3.0), 120.0, 120.0])
# Coarse-to-fine pattern search over the four parameters.
while steps[2] > 0.4:
    improved = False
    for i in range(4):
        for sgn in (1, -1):
            p = best.copy(); p[i] += sgn * steps[i]
            if abs(p[i]) > lim[i]: continue
            sc = score(p)
            if sc > bs + 1e-6: best, bs, improved = p, sc, True
    # Translation pairs move together along a diagonal road: try the diagonals too.
    for sx in (1, -1):
        for sy in (1, -1):
            p = best.copy(); p[2] += sx * steps[2]; p[3] += sy * steps[3]
            if abs(p[2]) > lim[2] or abs(p[3]) > lim[3]: continue
            sc = score(p)
            if sc > bs + 1e-6: best, bs, improved = p, sc, True
    if not improved: steps = steps / 2
M = affine(*best)
print(f"final score {bs:.4f}: scale ×{1 + best[0]:.4f}, rot {math.degrees(best[1]):+.2f}°, shift {best[2]:+.1f} E {best[3]:+.1f} N m")
res = {"affine": M.tolist(), "score": round(bs, 4), "scale": round(math.hypot(M[0, 0], M[1, 0]), 4), "rot": round(math.degrees(math.atan2(M[1, 0], M[0, 0])), 2), "mask": name, "how": "osm-axis"}
json.dump({"image": d["image"], "w": W, "h": H, "candidates": [res]}, open(out, "w"))
