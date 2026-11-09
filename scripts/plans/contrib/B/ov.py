"""Overlay check that keeps the satellite visible: only the plan's non-white pixels (roads, plots, boundary) are blended.
usage: python3 ov.py <plans dir> <reg dir> <out.jpg> <zid> [zoom=17] [--win x0,y0,x1,y1 (plan px)] [--alpha 0.5] [--pad m] [--maxw 1800] [--edges]
--edges draws only the plan's edge lines (magenta) + yellow plots instead of blending. Prints the output's pixel→plan-px mapping.
"""
import sys, json, math, os, time
from urllib.request import Request, urlopen
import numpy as np, cv2
R = 6378137.0; HALF = math.pi * R
plans, reg, out, zid = sys.argv[1:5]
def opt(n, d): return type(d)(sys.argv[sys.argv.index(n) + 1]) if n in sys.argv else d
zoom = int(sys.argv[5]) if len(sys.argv) > 5 and not sys.argv[5].startswith("--") else 17
alpha = opt("--alpha", 0.5); pad = opt("--pad", 60.0); maxw = opt("--maxw", 1800)
M = np.array(json.load(open(f"{reg}/{zid}.json"))["affine"])
img = cv2.imread(f"{plans}/zone_{zid}.jpg"); H, W = img.shape[:2]
x0, y0, x1, y1 = map(float, opt("--win", f"0,0,{W},{H}").split(","))
corners = np.array([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], float) @ M[:, :2].T + M[:, 2]
mn, mx = corners.min(0) - pad, corners.max(0) + pad
n = 2 ** zoom; res = 2 * HALF / n / 256
def tile_xy(x, y): return int((x + HALF) / (2 * HALF) * n), int((HALF - y) / (2 * HALF) * n)
tx0, ty1 = tile_xy(mn[0], mn[1]); tx1, ty0 = tile_xy(mx[0], mx[1])
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
S = np.array([[1 / res, 0], [0, -1 / res]]); A = S @ M[:, :2]; t = S @ (M[:, 2] - np.array([ox, oy]))
Mc = np.hstack([A, t[:, None]]).astype(np.float32)
size = (canvas.shape[1], canvas.shape[0])
warped = cv2.warpAffine(img, Mc, size, flags=cv2.INTER_LINEAR, borderValue=(255, 255, 255))
hsv = cv2.cvtColor(warped, cv2.COLOR_BGR2HSV)
blend = canvas.copy()
if "--edges" in sys.argv:
    # road surface of the plan (mid-grey, unsaturated) drawn as a translucent magenta tint: satellite stays visible in the blocks
    rd = cv2.inRange(hsv, (0, 0, int(opt("--rmin", 150))), (180, 40, int(opt("--rmax", 215))))
    rd = cv2.morphologyEx(rd, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    tint = blend.copy(); tint[rd > 0] = (255, 0, 255); blend = cv2.addWeighted(blend, 0.65, tint, 0.35, 0)
    yel = cv2.inRange(hsv, (20, 110, 150), (34, 255, 255)); blend[yel > 0] = (0, 255, 255)
else:
    sel = (hsv[:, :, 2] < 228) | (hsv[:, :, 1] > 50)
    blend[sel] = (canvas[sel] * (1 - alpha) + warped[sel] * alpha).astype(np.uint8)
cx0, cy0 = int((mn[0] - ox) / res), int((oy - mx[1]) / res); cx1, cy1 = int((mx[0] - ox) / res), int((oy - mn[1]) / res)
crop = blend[max(0, cy0):cy1, max(0, cx0):cx1]; raw = canvas[max(0, cy0):cy1, max(0, cx0):cx1]
sc = min(1.0, maxw / crop.shape[1])
cv2.imwrite(out, cv2.resize(crop, None, fx=sc, fy=sc, interpolation=cv2.INTER_AREA), [cv2.IMWRITE_JPEG_QUALITY, 85])
if "--raw" in sys.argv: cv2.imwrite(out.replace(".jpg", "_raw.jpg"), cv2.resize(raw, None, fx=sc, fy=sc, interpolation=cv2.INTER_AREA), [cv2.IMWRITE_JPEG_QUALITY, 85])
# output px (u,v) → merc: x = ox + (u/sc + cx0) * res ; y = oy - (v/sc + cy0) * res
print(json.dumps({"out": out, "size": [int(crop.shape[1] * sc), int(crop.shape[0] * sc)], "merc_of_px": {"x0": ox + max(0, cx0) * res, "y0": oy - max(0, cy0) * res, "m_per_px": res / sc}}))
