"""Build a registration from hand control points: plan pixel ↔ map position.
usage: python3 control.py <plans dir> <zone_plots.json> <zid> <out reg dir> --pts "px,py=lat,lng;px,py=lat,lng;..." [--pts-m "px,py=E,N;..." --origin lat,lng]
≥2 points → similarity (scale+rotation+translation, y flipped); ≥3 → least squares. Plots are assigned to polygons by OCR number.
"""
import sys, json, math, os
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from register import merc, fit_similarity, apply, poly_area
plans, zpf, zid, out = sys.argv[1:5]
pts = []
if "--pts" in sys.argv:
    for item in sys.argv[sys.argv.index("--pts") + 1].split(";"):
        a, b = item.split("="); px, py = map(float, a.split(",")); lat, lng = map(float, b.split(","))
        pts.append(([px, py], merc(lat, lng)))
if "--pts-m" in sys.argv:
    olat, olng = map(float, sys.argv[sys.argv.index("--origin") + 1].split(",")); ox, oy = merc(olat, olng)
    for item in sys.argv[sys.argv.index("--pts-m") + 1].split(";"):
        a, b = item.split("="); px, py = map(float, a.split(",")); e, nn = map(float, b.split(","))
        pts.append(([px, py], (ox + e, oy + nn)))
P = np.array([p for p, _ in pts]); Q = np.array([q for _, q in pts])
if len(pts) == 2:  # similarity from two points, with the y flip
    d = P[1] - P[0]; e = Q[1] - Q[0]; d = np.array([d[0], -d[0] * 0 - d[1]])  # flip y of the plan vector
    s = np.linalg.norm(e) / np.linalg.norm(d); th = math.atan2(e[1], e[0]) - math.atan2(d[1], d[0])
    A = s * np.array([[math.cos(th), -math.sin(th)], [math.sin(th), math.cos(th)]]) @ np.array([[1, 0], [0, -1]])
    M = np.hstack([A, (Q[0] - A @ P[0])[:, None]])
else:
    M = fit_similarity(P, Q)
res = np.linalg.norm(apply(M, P) - Q, axis=1)
zp = json.load(open(zpf))[zid]; polys = json.load(open(f"{plans}/zone_{zid}.plots.json"))["plots"]
scale = math.sqrt(abs(np.linalg.det(M[:, :2]))); rot = math.degrees(math.atan2(M[1, 0], M[0, 0]))
import collections
cnt = collections.Counter(p["text"].lstrip("0") for p in polys if p["text"])
byno = collections.Counter(p["no"].strip().lstrip("0") for p in zp["plots"])
assign = {}
for i, p in enumerate(polys):
    no = p["text"].lstrip("0")
    if no and cnt[no] == 1 and byno.get(no) == 1:
        full = next(pp["no"] for pp in zp["plots"] if pp["no"].strip().lstrip("0") == no); assign[full] = i
px_area = sum(poly_area(p["poly"]) for p in polys) * scale * scale; m2 = sum(p["area"] for p in zp["plots"])
os.makedirs(out, exist_ok=True)
json.dump({"zid": int(zid), "affine": M.tolist(), "scale_m_per_px": scale, "rotation_deg": rot, "rms_m": float(np.sqrt((res ** 2).mean())), "matched": len(assign), "polygons": len(polys), "located": 0, "assign": assign, "how": "control", "control": [[p, list(q)] for p, q in pts], "area_ratio": px_area / m2 if m2 else None}, open(f"{out}/{zid}.json", "w"))
print(f"{zid}: {len(pts)} control points, residuals m {np.round(res, 1).tolist()}, scale {scale:.3f} m/px, rot {rot:.1f}°, area ratio (px→m² / data m²) {px_area / m2 if m2 else float('nan'):.2f}, {len(assign)}/{len(zp['plots'])} plots assigned by OCR number")
