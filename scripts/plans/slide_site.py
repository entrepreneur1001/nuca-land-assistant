"""Register a zone plan from a project slide whose satellite background was georeferenced (georef_master):
the red dashed site boundary is found in both the slide and the zone plan; the two quadrilaterals give the fit.
usage: python3 slide_site.py <slide.jpg> <slide georef json> <plans dir> <zid> <reg dir> [--slide-crop x0,y0,x1,y1]
"""
import sys, json, math, os
import numpy as np, cv2
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from register import fit_similarity, apply
slide, gj, plans, zid, reg = sys.argv[1:6]
scrop = [int(v) for v in sys.argv[sys.argv.index("--slide-crop") + 1].split(",")] if "--slide-crop" in sys.argv else None
def site_quad(img, k_frac, exclude_title):
    """Oriented bounding box of the red dashed site boundary: close the dashes, keep the largest component, hull it."""
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    red = cv2.bitwise_or(cv2.inRange(hsv, (0, 110, 110), (10, 255, 255)), cv2.inRange(hsv, (170, 110, 110), (180, 255, 255)))
    if exclude_title: red[:int(img.shape[0] * 0.14), int(img.shape[1] * 0.5):] = 0; red[int(img.shape[0] * 0.92):, :] = 0
    # plot numbers are red too: drop red pixels inside (slightly grown) yellow plots
    yellow = cv2.inRange(hsv, (18, 110, 150), (40, 255, 255))
    yellow = cv2.dilate(yellow, np.ones((7, 7), np.uint8)); red[yellow > 0] = 0
    k = max(5, int(min(img.shape[:2]) * k_frac)) | 1
    closed = cv2.morphologyEx(red, cv2.MORPH_CLOSE, np.ones((k, k), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(closed, connectivity=8)
    if n < 2: return None
    big = 1 + int(np.argmax(st[1:, 4]))
    pts = np.column_stack(np.where(lab == big))[:, ::-1].astype(np.float32)
    box = cv2.boxPoints(cv2.minAreaRect(pts))
    cen = box.mean(0); ang = np.arctan2(box[:, 1] - cen[1], box[:, 0] - cen[0])
    return box[np.argsort(ang)], len(pts)
def fit_noreflect(P, Q):
    n = len(P); pc, qc = P.mean(0), Q.mean(0); P0, Q0 = P - pc, Q - qc
    U, D, Vt = np.linalg.svd(Q0.T @ P0 / n); S = np.eye(2)
    if np.linalg.det(U) * np.linalg.det(Vt) < 0: S[1, 1] = -1
    Rm = U @ S @ Vt; c = (D * np.diag(S)).sum() / ((P0 ** 2).sum() / n); A = c * Rm
    return np.hstack([A, (qc - A @ pc)[:, None]])
g = json.load(open(gj)); Ms = np.array(g["affine_cropped_px_to_merc"]); c0 = g["crop"] or [0, 0]
s_img = cv2.imread(slide)
if scrop: s_img = s_img[scrop[1]:scrop[3], scrop[0]:scrop[2]]
sq = site_quad(s_img, 0.03, False)
if sq is None: print("no red site boundary on the slide"); sys.exit(1)
sbox, sarea = sq
# slide px (in its own crop) → georef crop px → mercator
Q = np.array([Ms @ np.array([x + (scrop[0] if scrop else 0) - c0[0], y + (scrop[1] if scrop else 0) - c0[1], 1.0]) for x, y in sbox])
p_img = cv2.imread(f"{plans}/zone_{zid}.jpg")
pq = site_quad(p_img, 0.025, True)
if pq is None: print("no red site boundary on the plan"); sys.exit(1)
pbox, parea = pq
# Match orderings: try the 4 cyclic shifts (same orientation sense since both are images with y down)
best = None
for shift in range(4):
    P = np.roll(pbox, shift, axis=0)
    M = fit_noreflect(P, Q); res = np.linalg.norm(apply(M, P) - Q, axis=1)
    if best is None or res.max() < best[0]: best = (res.max(), M, res)
rmax, M, res = best
scale = math.sqrt(abs(np.linalg.det(M[:, :2]))); rot = math.degrees(math.atan2(M[1, 0], M[0, 0]))
os.makedirs(reg, exist_ok=True)
json.dump({"zid": int(zid), "affine": M.tolist(), "scale_m_per_px": scale, "rotation_deg": rot, "rms_m": float(np.sqrt((res ** 2).mean())), "matched": 0, "polygons": 0, "located": 0, "assign": {}, "how": "slide", "corner_residuals_m": res.tolist()}, open(f"{reg}/{zid}.json", "w"))
print(f"{zid}: slide site quad {np.round(sbox).tolist()}, plan quad {np.round(pbox).tolist()}; corner residuals m {np.round(res, 1).tolist()}, scale {scale:.3f} m/px, rot {rot:.1f}°")
