"""Refine an approximate registration against OSM road centre-lines (truncated chamfer distance, similarity transform).
usage: python3 refine_osm.py <plans dir> <reg dir> <osm json> <zid> [--win x0,y0,x1,y1] [--trunc 25] [--write] [--debug out.jpg] [--search 60]
Plan road pixels (light grey, unsaturated) are thinned to centre-lines; the transform (dx, dy, scale, rotation about the
window centre) minimising mean(min(dist to nearest OSM way, trunc)) is found by grid search around the start + Nelder-Mead.
Prints the start/end cost and the change; --write updates reg/<zid>.json (how += "+osm-refine").
"""
import sys, json, math
import numpy as np, cv2
R = 6378137.0
def merc(lat, lng): return (math.radians(lng) * R, math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * R)
plans, reg, osmf, zid = sys.argv[1:5]
def opt(n, d): return type(d)(sys.argv[sys.argv.index(n) + 1]) if n in sys.argv else d
r = json.load(open(f"{reg}/{zid}.json")); M0 = np.array(r["affine"])
img = cv2.imread(f"{plans}/zone_{zid}.jpg"); H, W = img.shape[:2]
x0, y0, x1, y1 = map(int, opt("--win", f"0,0,{W},{H}").split(","))
TR = opt("--trunc", 25.0); SR = opt("--search", 60.0)
hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
road = cv2.inRange(hsv, (0, 0, opt("--vmin", 150)), (180, 45, opt("--vmax", 225)))
m = np.zeros_like(road); m[y0:y1, x0:x1] = road[y0:y1, x0:x1]
m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
# thinning (Zhang-Suen via distance-transform ridge approximation)
dt = cv2.distanceTransform(m, cv2.DIST_L2, 3)
ridge = (dt >= cv2.dilate(dt, np.ones((3, 3), np.uint8)) - 1e-6) & (dt >= opt("--minw", 1.5))
ys, xs = np.nonzero(ridge); P = np.stack([xs, ys], 1).astype(np.float64)
if len(P) > 6000: P = P[np.random.RandomState(0).choice(len(P), 6000, replace=False)]
c = np.array([(x0 + x1) / 2, (y0 + y1) / 2])
osm = json.load(open(osmf)); res = 1.0
Q0 = M0[:, :2] @ c + M0[:, 2]
ext = np.abs(M0[:, :2]) @ np.array([(x1 - x0) / 2, (y1 - y0) / 2]) + SR + 100
ox, oy = Q0[0] - ext[0], Q0[1] + ext[1]; Wd, Hd = int(2 * ext[0] / res), int(2 * ext[1] / res)
ras = np.full((Hd, Wd), 255, np.uint8)
skip = set(opt("--skip", "footway,path,steps,cycleway").split(","))
for w in osm["ways"]:
    if w["hw"] in skip: continue
    pp = np.array([[(x - ox) / res, (oy - y) / res] for x, y in (merc(a, b) for a, b in w["pts"])], np.int32)
    cv2.polylines(ras, [pp], False, 0, 1)
D = np.minimum(cv2.distanceTransform(ras, cv2.DIST_L2, 5) * res, TR).astype(np.float32)
def transform(p):
    dx, dy, ls, th = p; s = math.exp(ls); cs, sn = math.cos(th), math.sin(th)
    Rm = s * np.array([[cs, -sn], [sn, cs]]); A = Rm @ M0[:, :2]
    t = Q0 + np.array([dx, dy]) - A @ c
    return np.hstack([A, t[:, None]])
def cost(p):
    M = transform(p); q = P @ M[:, :2].T + M[:, 2]
    u = ((q[:, 0] - ox) / res).astype(int); v = ((oy - q[:, 1]) / res).astype(int)
    ok = (u >= 0) & (u < Wd) & (v >= 0) & (v < Hd)
    d = np.full(len(P), TR, np.float32); d[ok] = D[v[ok], u[ok]]
    return float(d.mean())
best = (cost([0, 0, 0, 0]), [0, 0, 0, 0]); c0 = best[0]
for ls in np.linspace(-0.06, 0.06, 7):
    for th in np.radians(np.linspace(-2, 2, 5)):
        for dx in np.arange(-SR, SR + 1, 6):
            for dy in np.arange(-SR, SR + 1, 6):
                cc = cost([dx, dy, ls, th])
                if cc < best[0]: best = (cc, [dx, dy, ls, th])
# Nelder-Mead (tiny implementation)
def nm(f, x, steps, it=400):
    n = len(x); S = [np.array(x, float)] + [np.array(x, float) + np.eye(n)[i] * steps[i] for i in range(n)]; F = [f(s) for s in S]
    for _ in range(it):
        o = np.argsort(F); S = [S[i] for i in o]; F = [F[i] for i in o]
        cen = np.mean(S[:-1], 0); xr = cen + (cen - S[-1]); fr = f(xr)
        if fr < F[0]:
            xe = cen + 2 * (cen - S[-1]); fe = f(xe)
            S[-1], F[-1] = (xe, fe) if fe < fr else (xr, fr)
        elif fr < F[-2]: S[-1], F[-1] = xr, fr
        else:
            xc = cen + 0.5 * (S[-1] - cen); fc = f(xc)
            if fc < F[-1]: S[-1], F[-1] = xc, fc
            else:
                S = [S[0]] + [S[0] + 0.5 * (s - S[0]) for s in S[1:]]; F = [F[0]] + [f(s) for s in S[1:]]
    o = int(np.argmin(F)); return S[o], F[o]
p, fc = nm(cost, best[1], [3, 3, 0.01, 0.005])
M = transform(p)
print(f"{zid}: {len(P)} road pts; cost start {c0:.2f} → grid {best[0]:.2f} → final {fc:.2f} m (trunc {TR}); shift ({p[0]:+.1f}, {p[1]:+.1f}) m, scale ×{math.exp(p[2]):.4f}, rot {math.degrees(p[3]):+.2f}°; new scale {math.sqrt(abs(np.linalg.det(M[:, :2]))):.4f} m/px")
dbg = opt("--debug", "")
if dbg:
    vis = cv2.cvtColor(255 - ras, cv2.COLOR_GRAY2BGR) // 2
    q = P @ M[:, :2].T + M[:, 2]
    for (a, b) in q: 
        u, v = int((a - ox) / res), int((oy - b) / res)
        if 0 <= u < Wd and 0 <= v < Hd: vis[v, u] = (0, 255, 255)
    sc = min(1.0, 1800 / Wd); cv2.imwrite(dbg, cv2.resize(vis, None, fx=sc, fy=sc, interpolation=cv2.INTER_AREA))
if "--write" in sys.argv:
    r["affine"] = M.tolist(); r["scale_m_per_px"] = math.sqrt(abs(np.linalg.det(M[:, :2]))); r["rotation_deg"] = math.degrees(math.atan2(M[1, 0], M[0, 0]))
    r["how"] = r.get("how", "") + "+osm-refine"; r["osm_chamfer_m"] = fc
    json.dump(r, open(f"{reg}/{zid}.json", "w"))
