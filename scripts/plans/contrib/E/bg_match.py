"""Register a zone plan by its own faded satellite background: the background outside the drawn site is contrast-stretched
and SIFT-matched (RANSAC similarity) to a satellite crop made with sat2.py --nogrid.
usage: python3 bg_match.py <plan.jpg> <sat.jpg> <sat centre merc x> <y> <sat half-width m> <out prefix> [--f 0.39]
Prints/writes the affine plan px → Web Mercator. The drawn site may NOT be at the background's scale: compare with the plot-area scale.
"""
import sys, json, math
import numpy as np, cv2
plan, sat, cx, cy, half, out = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4]), float(sys.argv[5]), sys.argv[6]
f = float(sys.argv[sys.argv.index("--f") + 1]) if "--f" in sys.argv else 0.39
im = cv2.imread(plan); hsv = cv2.cvtColor(im, cv2.COLOR_BGR2HSV); g = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
# background = low-saturation, bright pixels; drawn site = hull of the red dashed boundary
red = cv2.bitwise_or(cv2.inRange(hsv, (0, 110, 110), (10, 255, 255)), cv2.inRange(hsv, (170, 110, 110), (180, 255, 255)))
H, W = g.shape; red[:int(H * 0.11)] = 0; red[int(H * 0.955):] = 0
pts = cv2.findNonZero(red); hull = cv2.convexHull(pts)
mask = np.full((H, W), 255, np.uint8); cv2.fillConvexPoly(mask, hull, 0); mask = cv2.erode(mask, np.ones((25, 25), np.uint8))
mask[:int(H * 0.115)] = 0; mask[int(H * 0.95):] = 0; mask[:, :int(W * 0.05)] = 0; mask[:, int(W * 0.935):] = 0
mask[(hsv[..., 1] > 60) | (g < 120)] = 0  # arrow, labels
mask = cv2.erode(mask, np.ones((9, 9), np.uint8))
e = np.clip((g.astype(float) - 185) / 60, 0, 1); e = (e * 255).astype(np.uint8)
e = cv2.resize(e, None, fx=f, fy=f, interpolation=cv2.INTER_AREA); m = cv2.resize(mask, (e.shape[1], e.shape[0]), interpolation=cv2.INTER_NEAREST)
e = cv2.createCLAHE(2.0, (8, 8)).apply(e)
s = cv2.imread(sat); sg = cv2.createCLAHE(2.0, (8, 8)).apply(cv2.cvtColor(s, cv2.COLOR_BGR2GRAY)); res = 2 * half / s.shape[1]
sift = cv2.SIFT_create(nfeatures=20000, contrastThreshold=0.02)
k1, d1 = sift.detectAndCompute(e, m); k2, d2 = sift.detectAndCompute(sg, None)
mt = cv2.BFMatcher().knnMatch(d1, d2, k=2); good = [a for a, b in mt if a.distance < 0.8 * b.distance]
P = np.float32([k1[a.queryIdx].pt for a in good]); Q = np.float32([k2[a.trainIdx].pt for a in good])
A, inl = cv2.estimateAffinePartial2D(P, Q, method=cv2.RANSAC, ransacReprojThreshold=4, maxIters=20000, confidence=0.999)
n = int(inl.sum()); print(f"kp {len(k1)}/{len(k2)}, good {len(good)}, inliers {n}")
# small-plan px → sat px → mercator; plan px = small/f
S = np.array([[res, 0, cx - half], [0, -res, cy + half]]); A3 = np.vstack([A, [0, 0, 1]]); M = S @ A3 @ np.diag([f, f, 1])
sc = math.sqrt(abs(np.linalg.det(M[:, :2]))); rot = math.degrees(math.atan2(-M[1, 0], M[0, 0]))
print(f"scale {sc:.4f} merc m/px, rot {rot:.2f} deg"); print(json.dumps(M.tolist()))
json.dump({"affine": M.tolist(), "inliers": n, "scale": sc, "rot": rot, "inlier_plan_px": (P[inl.ravel() > 0] / f).tolist()}, open(out + ".json", "w"))
vis = cv2.drawMatches(e, k1, sg, k2, [g_ for g_, i in zip(good, inl.ravel()) if i], None, flags=2); cv2.imwrite(out + "_matches.jpg", cv2.resize(vis, None, fx=0.5, fy=0.5))
cv2.imwrite(out + "_bg.jpg", cv2.bitwise_and(e, m))
