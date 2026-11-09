"""Georeference a city master plan that has a satellite background: SIFT-match it to Esri imagery around a centre.
usage: python3 georef_master.py <masterplan.jpg> <lat> <lng> <zoom> <half m> <out prefix> [--crop x0,y0,x1,y1] [--pins "x,y;x,y"]
Prints the similarity (image px → Mercator), the lat/lng of the given pin pixels, and writes <out>.jpg (overlay).
"""
import sys, math, os, time, json
import numpy as np, cv2
from urllib.request import Request, urlopen
R = 6378137.0; HALF = math.pi * R
mp, lat, lng, zoom, halfw, out = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), int(sys.argv[4]), float(sys.argv[5]), sys.argv[6]
crop = [int(v) for v in sys.argv[sys.argv.index("--crop") + 1].split(",")] if "--crop" in sys.argv else None
pins = [tuple(map(float, p.split(","))) for p in sys.argv[sys.argv.index("--pins") + 1].split(";")] if "--pins" in sys.argv else []
cx, cy = (math.radians(lng) * R, math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * R); n = 2 ** zoom; res = 2 * HALF / n / 256
def tile_xy(x, y): return int((x + HALF) / (2 * HALF) * n), int((HALF - y) / (2 * HALF) * n)
tx0, ty1 = tile_xy(cx - halfw, cy - halfw); tx1, ty0 = tile_xy(cx + halfw, cy + halfw)
os.makedirs("tiles", exist_ok=True)
canvas = np.zeros(((ty1 - ty0 + 1) * 256, (tx1 - tx0 + 1) * 256, 3), np.uint8)
for tx in range(tx0, tx1 + 1):
    for ty in range(ty0, ty1 + 1):
        f = f"tiles/{zoom}_{ty}_{tx}.jpg"
        if not os.path.exists(f):
            for a in range(3):
                try:
                    with urlopen(Request(f"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{zoom}/{ty}/{tx}", headers={"User-Agent": "Mozilla/5.0"}), timeout=30) as r: open(f, "wb").write(r.read()); break
                except Exception: time.sleep(2)
        t = cv2.imread(f)
        if t is not None: canvas[(ty - ty0) * 256:(ty - ty0 + 1) * 256, (tx - tx0) * 256:(tx - tx0 + 1) * 256] = t
ox = tx0 / n * 2 * HALF - HALF; oy = HALF - ty0 / n * 2 * HALF
img = cv2.imread(mp); full = img.copy()
if crop: img = img[crop[1]:crop[3], crop[0]:crop[2]]
ga = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY); gb = cv2.cvtColor(canvas, cv2.COLOR_BGR2GRAY)
if "--enhance" in sys.argv:  # washed-out slide backgrounds: local contrast equalisation on both sides
    cl = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8)); ga = cl.apply(ga); gb = cl.apply(gb)
sift = cv2.SIFT_create(nfeatures=30000)
ka, da = sift.detectAndCompute(ga, None); kb, db = sift.detectAndCompute(gb, None)
m = cv2.BFMatcher(cv2.NORM_L2).knnMatch(da, db, k=2)
good = [x for x, y in (p for p in m if len(p) == 2) if x.distance < 0.78 * y.distance]
P = np.float32([ka[x.queryIdx].pt for x in good]); Q = np.float32([kb[x.trainIdx].pt for x in good])
M, inl = cv2.estimateAffinePartial2D(P, Q, method=cv2.RANSAC, ransacReprojThreshold=5.0, maxIters=10000, confidence=0.999)
n_in = int(inl.sum()) if inl is not None else 0
print(f"{len(good)} matches, {n_in} inliers")
if M is None or n_in < 15: sys.exit(1)
s = math.sqrt(abs(np.linalg.det(M[:, :2]))); rot = math.degrees(math.atan2(M[1, 0], M[0, 0]))
res_px = np.linalg.norm((P[inl[:, 0] > 0] @ M[:, :2].T + M[:, 2]) - Q[inl[:, 0] > 0], axis=1)
print(f"canvas px per image px {s:.3f} ({s*res:.1f} m per image px), rot {rot:.2f}°, median residual {np.median(res_px)*res:.0f} m")
# image px (cropped) → mercator
A4 = np.array([[res, 0, ox], [0, -res, oy], [0, 0, 1.0]]); Mm = (A4 @ np.vstack([M, [0, 0, 1]]))[:2]
json.dump({"affine_cropped_px_to_merc": Mm.tolist(), "crop": crop, "inliers": n_in}, open(out + ".json", "w"))
for (px, py) in pins:
    q = Mm @ np.array([px - (crop[0] if crop else 0), py - (crop[1] if crop else 0), 1.0])
    print(f"pin ({px:.0f},{py:.0f}) → {math.degrees(2*math.atan(math.exp(q[1]/R))-math.pi/2):.5f},{math.degrees(q[0]/R):.5f}")
warped = cv2.warpAffine(img, M.astype(np.float32), (canvas.shape[1], canvas.shape[0]))
mask = cv2.warpAffine(np.full(img.shape[:2], 255, np.uint8), M.astype(np.float32), (canvas.shape[1], canvas.shape[0])) > 0
vis = canvas.copy(); vis[mask] = (0.5 * canvas[mask] + 0.5 * warped[mask]).astype(np.uint8)
sc = min(1.0, 1600 / vis.shape[1]); cv2.imwrite(out + ".jpg", cv2.resize(vis, None, fx=sc, fy=sc), [cv2.IMWRITE_JPEG_QUALITY, 82])
