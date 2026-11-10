"""Place a zone drawing that is a detail of a larger sheet already placed (a district sheet, a neighbouring zone's
drawing): the detail is registered on the sheet by image features (SIFT, RANSAC similarity) and the sheet's
placement is carried over.
usage: python3 via_sheet.py <detail.jpg> <sheet.jpg> <sheet placement or registration .json> <out.json> [--check out.jpg]
Writes {image, w, h, candidates: [{affine, inliers, scale, rot, centre}]} like place_g.py (refine or preview it with
place_g.py --refine). --check draws the detail's outline and matched points on the sheet.
"""
import sys, json, math
import numpy as np, cv2
R = 6378137.0
def opt(name, default=None): return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default
detail, sheet, reg, out = sys.argv[1:5]
a, b = cv2.imread(detail), cv2.imread(sheet); H, W = a.shape[:2]
d = json.load(open(reg)); S = np.array(d["affine"] if "affine" in d else d["candidates"][0]["affine"])
sift = cv2.SIFT_create(nfeatures=20000, contrastThreshold=0.02)
best = None
# The detail is usually drawn larger than the sheet: try it shrunk by several factors so the features meet in scale.
for f in (1.0, 0.7, 0.5, 0.35, 0.25, 0.17, 0.12):
    g = cv2.cvtColor(cv2.resize(a, None, fx=f, fy=f, interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY)
    ka, da = sift.detectAndCompute(g, None); kb, db = sift.detectAndCompute(cv2.cvtColor(b, cv2.COLOR_BGR2GRAY), None)
    if da is None or db is None or len(ka) < 8: continue
    m = [p for p, q in cv2.BFMatcher().knnMatch(da, db, k=2) if p.distance < 0.8 * q.distance]
    if len(m) < 8: continue
    pa = np.float32([ka[x.queryIdx].pt for x in m]) / f; pb = np.float32([kb[x.trainIdx].pt for x in m])
    T, inl = cv2.estimateAffinePartial2D(pa, pb, method=cv2.RANSAC, ransacReprojThreshold=3.0, maxIters=20000, confidence=0.999)
    n = int(inl.sum()) if inl is not None else 0
    print(f"shrink {f}: {len(m)} matches, {n} inliers")
    # A collapse of many repeated features onto one spot is not a registration.
    if T is not None and n and pb[inl.ravel() > 0].std(0).max() < 0.02 * min(b.shape[:2]): continue
    if T is not None and (best is None or n > best[0]): best = (n, T, pa[inl.ravel() > 0], pb[inl.ravel() > 0])
if best is None or best[0] < 12: json.dump({"image": detail, "w": W, "h": H, "candidates": []}, open(out, "w")); sys.exit("no reliable registration")
n, T, pa, pb = best
M = S @ np.vstack([T, [0, 0, 1]])
x, y = M @ np.array([W / 2, H / 2, 1.0])
c = {"affine": M.tolist(), "inliers": n, "scale": round(math.hypot(M[0, 0], M[1, 0]), 4), "rot": round(math.degrees(math.atan2(M[1, 0], M[0, 0])), 2),
     "on_sheet": {"scale": round(math.hypot(T[0, 0], T[1, 0]), 4), "rot": round(math.degrees(math.atan2(T[1, 0], T[0, 0])), 2)},
     "T": T.tolist(), "centre": [round(math.degrees(2 * math.atan(math.exp(y / R)) - math.pi / 2), 6), round(math.degrees(x / R), 6)]}
print(f"{n} inliers; on the sheet: scale {c['on_sheet']['scale']}, rot {c['on_sheet']['rot']}; centre {c['centre']}")
json.dump({"image": detail, "w": W, "h": H, "candidates": [c]}, open(out, "w"))
if opt("--check"):
    o = b.copy(); cor = (np.array([[0, 0, 1], [W, 0, 1], [W, H, 1], [0, H, 1]], float) @ T.T).astype(np.int32)
    cv2.polylines(o, [cor], True, (0, 0, 255), 3)
    for p in pb: cv2.circle(o, (int(p[0]), int(p[1])), 3, (255, 0, 0), -1)
    cv2.imwrite(opt("--check"), o, [cv2.IMWRITE_JPEG_QUALITY, 80])
