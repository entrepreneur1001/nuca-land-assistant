"""Chain a zone plan to an already-registered neighbouring plan that shows the same drawing: feature matching
(SIFT + RANSAC similarity) between the two images gives B→A in pixels; B's map affine = A_affine ∘ (B→A).
usage: python3 chain.py <plans dir> <reg dir> <A zid (registered)> <B zid> [--test]
Writes reg/<B>.json (how="chain:<A>") with assign {} (plots are matched by OCR number at export). --test only reports.
"""
import sys, json, math, os
import numpy as np, cv2
plans, reg, A, B = sys.argv[1:5]
def load(z):
    im = cv2.imread(f"{plans}/zone_{z}.jpg"); H, W = im.shape[:2]
    g = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
    # hide the title bar / footer bands so their text does not match across plans
    rows = (g < 120).mean(1) > 0.6; g[rows, :] = 255; g[:int(H * 0.12), int(W * 0.6):] = 255
    # yellow highlight differs between the two plans: flatten it to the page colour so matching uses roads/blocks
    hsv = cv2.cvtColor(im, cv2.COLOR_BGR2HSV); y = cv2.inRange(hsv, (15, 80, 150), (45, 255, 255)); g[y > 0] = 245
    return g
ga, gb = load(A), load(B)
sift = cv2.SIFT_create(nfeatures=20000)
ka, da = sift.detectAndCompute(ga, None); kb, db = sift.detectAndCompute(gb, None)
m = cv2.BFMatcher(cv2.NORM_L2).knnMatch(db, da, k=2)
good = [x for x, y in (p for p in m if len(p) == 2) if x.distance < 0.75 * y.distance]
if len(good) < 10: print(f"{B}->{A}: only {len(good)} matches"); sys.exit(1)
P = np.float32([kb[x.queryIdx].pt for x in good]); Q = np.float32([ka[x.trainIdx].pt for x in good])
M, inl = cv2.estimateAffinePartial2D(P, Q, method=cv2.RANSAC, ransacReprojThreshold=4.0, maxIters=5000, confidence=0.999)
n_in = int(inl.sum()) if inl is not None else 0
if M is None or n_in < 12: print(f"{B}->{A}: {len(good)} matches, {n_in} inliers — FAILED"); sys.exit(1)
s = math.sqrt(abs(np.linalg.det(M[:, :2]))); rot = math.degrees(math.atan2(M[1, 0], M[0, 0]))
res = np.linalg.norm((P[inl[:, 0] > 0] @ M[:, :2].T + M[:, 2]) - Q[inl[:, 0] > 0], axis=1)
print(f"{B}->{A}: {len(good)} matches, {n_in} inliers, scale {s:.3f}, rot {rot:.2f}°, median residual {np.median(res):.1f} px")
if "--test" in sys.argv: sys.exit(0)
ra = json.load(open(f"{reg}/{A}.json")); MA = np.array(ra["affine"])
MB = (np.vstack([MA, [0, 0, 1]]) @ np.vstack([M, [0, 0, 1]]))[:2]
scale = math.sqrt(abs(np.linalg.det(MB[:, :2])))
json.dump({"zid": int(B), "affine": MB.tolist(), "scale_m_per_px": scale, "rotation_deg": math.degrees(math.atan2(MB[1, 0], MB[0, 0])), "rms_m": ra.get("rms_m"), "matched": 0, "polygons": 0, "located": 0, "assign": {}, "how": f"chain:{A}", "chain_inliers": n_in, "chain_residual_px": float(np.median(res))}, open(f"{reg}/{B}.json", "w"))
print(f"wrote {reg}/{B}.json (scale {scale:.4f} m/px)")
