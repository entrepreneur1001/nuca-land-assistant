"""Render a zone plan over Esri satellite imagery for visual checking.
usage: python3 verify.py <plans dir> <reg dir> <out dir> <zid> [zoom=17] [alpha=0.55]
Also accepts a raw affine file instead of reg/<zid>.json via --affine '[[a,b,c],[d,e,f]]' (px → Web Mercator metres).
"""
import sys, json, math, os, io, time
from urllib.request import Request, urlopen
import numpy as np, cv2
R = 6378137.0; HALF = math.pi * R
plans, reg, out, zid = sys.argv[1:5]
zoom = int(sys.argv[5]) if len(sys.argv) > 5 and not sys.argv[5].startswith("--") else 17
alpha = float(sys.argv[6]) if len(sys.argv) > 6 and not sys.argv[6].startswith("--") else 0.55
M = np.array(json.loads(sys.argv[sys.argv.index("--affine") + 1])) if "--affine" in sys.argv else np.array(json.load(open(f"{reg}/{zid}.json"))["affine"])
img = cv2.imread(f"{plans}/zone_{zid}.jpg"); H, W = img.shape[:2]
corners = np.array([[0, 0], [W, 0], [W, H], [0, H]], float) @ M[:, :2].T + M[:, 2]
mn, mx = corners.min(0), corners.max(0); pad = 0.15 * (mx - mn); mn -= pad; mx += pad
n = 2 ** zoom; res = 2 * HALF / n / 256  # metres per pixel at this zoom
def tile_xy(x, y): return int((x + HALF) / (2 * HALF) * n), int((HALF - y) / (2 * HALF) * n)
tx0, ty1 = tile_xy(mn[0], mn[1]); tx1, ty0 = tile_xy(mx[0], mx[1])
cache = "tiles"; os.makedirs(cache, exist_ok=True)
canvas = np.zeros(((ty1 - ty0 + 1) * 256, (tx1 - tx0 + 1) * 256, 3), np.uint8)
for tx in range(tx0, tx1 + 1):
    for ty in range(ty0, ty1 + 1):
        f = f"{cache}/{zoom}_{ty}_{tx}.jpg"
        if not os.path.exists(f):
            for a in range(3):
                try:
                    with urlopen(Request(f"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{zoom}/{ty}/{tx}", headers={"User-Agent": "Mozilla/5.0"}), timeout=30) as r: open(f, "wb").write(r.read())
                    break
                except Exception as e: time.sleep(2)
        t = cv2.imread(f)
        if t is not None: canvas[(ty - ty0) * 256:(ty - ty0 + 1) * 256, (tx - tx0) * 256:(tx - tx0 + 1) * 256] = t
# Canvas origin in metres (top-left of tile tx0, ty0)
ox = tx0 / n * 2 * HALF - HALF; oy = HALF - ty0 / n * 2 * HALF
# px(plan) → canvas px: C = S · (M p + t) + o, with S = diag(1/res, -1/res)
S = np.array([[1 / res, 0], [0, -1 / res]]); A = S @ M[:, :2]; t = S @ (M[:, 2] - np.array([ox, oy]))
Mc = np.hstack([A, t[:, None]]).astype(np.float32)
warped = cv2.warpAffine(img, Mc, (canvas.shape[1], canvas.shape[0]), flags=cv2.INTER_AREA, borderValue=(0, 0, 0))
mask = cv2.warpAffine(np.full((H, W), 255, np.uint8), Mc, (canvas.shape[1], canvas.shape[0]))
blend = canvas.copy(); sel = mask > 0
blend[sel] = (canvas[sel] * (1 - alpha) + warped[sel] * alpha).astype(np.uint8)
# Crop to the plan's extent (+pad)
def to_canvas(m): return ((m[0] - ox) / res, (oy - m[1]) / res)
x0, y0 = to_canvas((mn[0], mx[1])); x1, y1 = to_canvas((mx[0], mn[1]))
crop = blend[max(0, int(y0)):int(y1), max(0, int(x0)):int(x1)]
os.makedirs(out, exist_ok=True)
scale = min(1.0, 1800 / crop.shape[1])
cv2.imwrite(f"{out}/{zid}_z{zoom}.jpg", cv2.resize(crop, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA), [cv2.IMWRITE_JPEG_QUALITY, 85])
lat = math.degrees(2 * math.atan(math.exp(((mn[1] + mx[1]) / 2) / R)) - math.pi / 2); lng = math.degrees(((mn[0] + mx[0]) / 2) / R)
print(f"{zid}: {out}/{zid}_z{zoom}.jpg centre {lat:.5f},{lng:.5f} res {res:.2f} m/px")
