"""Draw the OpenStreetMap roads onto a plan image under a placement, to check the fit by eye: the red lines must
run along the drawing's streets.
usage: python3 overlay.py <placement.json | '[[a,b,c],[d,e,f]]'> <overpass out-geom json> <out.jpg> [--cand i] [--image path] [--max 1400]
"""
import sys, json, math
import numpy as np, cv2
R = 6378137.0
def merc(lat, lng): return (math.radians(lng) * R, math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * R)
src, osm, out = sys.argv[1:4]
def opt(name, default=None): return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default
if src.lstrip().startswith("["): M = np.array(json.loads(src)); image = opt("--image")
else:
    d = json.load(open(src)); M = np.array(d["candidates"][int(opt("--cand", "0"))]["affine"]); image = opt("--image", d["image"])
img = cv2.imread(image); H, W = img.shape[:2]
A = np.vstack([M, [0, 0, 1]]); inv = np.linalg.inv(A)[:2]
cor = np.array([[0, 0, 1], [W, 0, 1], [W, H, 1], [0, H, 1]], float) @ M.T; mn, mx = cor.min(0), cor.max(0)
for w in json.load(open(osm))["elements"]:
    g = w.get("geometry")
    if not g: continue
    p = np.array([merc(q["lat"], q["lon"]) for q in g])
    if p[:, 0].max() < mn[0] or p[:, 0].min() > mx[0] or p[:, 1].max() < mn[1] or p[:, 1].min() > mx[1]: continue
    px = (np.column_stack([p, np.ones(len(p))]) @ inv.T).round().astype(np.int32)
    cv2.polylines(img, [px], False, (0, 0, 255), max(1, W // 600), cv2.LINE_AA)
mxpx = int(opt("--max", "1400")); f = min(1.0, mxpx / max(H, W))
if f < 1: img = cv2.resize(img, None, fx=f, fy=f, interpolation=cv2.INTER_AREA)
cv2.imwrite(out, img, [cv2.IMWRITE_JPEG_QUALITY, 85])
