"""Register a zone plan through a georeferenced project slide using the YELLOW plot block (one compact block of
plots) instead of the red site boundary: oriented bounding boxes of the yellow fill in slide and plan are matched.
usage: python3 slide_yellow.py <slide.jpg> <slide georef json> <plans dir> <zid> <reg dir> [--slide-crop x0,y0,x1,y1]
Only valid when the offered plots form a single block; the slide's resolution limits accuracy (prints residuals)."""
import sys, json, math, os
import numpy as np, cv2
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from register import apply, fit_similarity
slide, gj, plans, zid, reg = sys.argv[1:6]
sc = [int(v) for v in sys.argv[sys.argv.index("--slide-crop") + 1].split(",")] if "--slide-crop" in sys.argv else None
def box(img, up):
    if up != 1: img = cv2.resize(img, None, fx=up, fy=up, interpolation=cv2.INTER_CUBIC)
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV); y = cv2.inRange(hsv, (22, 120, 170), (34, 255, 255))
    y = cv2.morphologyEx(y, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(y, connectivity=8); big = 1 + int(np.argmax(st[1:, 4]))
    cs, _ = cv2.findContours((lab == big).astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    b = cv2.boxPoints(cv2.minAreaRect(max(cs, key=cv2.contourArea))) / up
    cen = b.mean(0); return b[np.argsort(np.arctan2(b[:, 1] - cen[1], b[:, 0] - cen[0]))]
def fit_noreflect(P, Q):
    n = len(P); pc, qc = P.mean(0), Q.mean(0); P0, Q0 = P - pc, Q - qc
    U, D, Vt = np.linalg.svd(Q0.T @ P0 / n); S = np.eye(2)
    if np.linalg.det(U) * np.linalg.det(Vt) < 0: S[1, 1] = -1
    c = (D * np.diag(S)).sum() / ((P0 ** 2).sum() / n); A = c * (U @ S @ Vt)
    return np.hstack([A, (qc - A @ pc)[:, None]])
g = json.load(open(gj)); Ms = np.array(g["affine_cropped_px_to_merc"]); c0 = g["crop"] or [0, 0]
s = cv2.imread(slide); off = [0, 0]
if sc: s = s[sc[1]:sc[3], sc[0]:sc[2]]; off = sc[:2]
sb = box(s, 4) + off; pb = box(cv2.imread(f"{plans}/zone_{zid}.jpg"), 1)
Q = np.array([Ms @ np.array([x - c0[0], y - c0[1], 1.0]) for x, y in sb])
best = None
for sh in range(4):
    P = np.roll(pb, sh, axis=0); M = fit_similarity(P, Q); r = np.linalg.norm(apply(M, P) - Q, axis=1)
    rot = math.degrees(math.atan2(M[1, 0], M[0, 0]))
    if best is None or (r.max(), abs(rot)) < (best[0], abs(best[3])): best = (r.max(), M, r, rot)
_, M, r, rot = best; scale = math.sqrt(abs(np.linalg.det(M[:, :2])))
json.dump({"zid": int(zid), "affine": M.tolist(), "scale_m_per_px": scale, "rotation_deg": rot, "rms_m": float(np.sqrt((r ** 2).mean())), "matched": 0, "polygons": 0, "located": 0, "assign": {}, "how": "slide-yellow", "corner_residuals_m": r.tolist()}, open(f"{reg}/{zid}.json", "w"))
print(f"{zid}: slide box {np.round(sb, 1).tolist()} plan box {np.round(pb).tolist()} residuals m {np.round(r, 1).tolist()} scale {scale:.4f} m/px rot {rot:.1f}°")
