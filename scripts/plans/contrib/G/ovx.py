"""ov.py + [--up k] (upsample the imagery k times: closer look where no deeper zoom exists).
Overlay a plan on satellite imagery (Esri or Google) for visual checking, with a choice of rendering.
usage: python3 ov.py <plans dir> <reg file | affine json string> <zid> <out.jpg> [--src esri|google] [--zoom 16] [--alpha 0.45]
       [--mode blend|lines] [--crop cx,cy,half (plan px)] [--maxw 1800]
mode lines: only the plan's dark/red line work and plot outlines are drawn (imagery stays visible between them).
The reg file's "affine" is plan px -> Web Mercator metres."""
import sys, json, math, os, time
from urllib.request import Request, urlopen
import numpy as np, cv2
R = 6378137.0; HALF = math.pi * R
plans, regf, zid, out = sys.argv[1:5]
def opt(k, d): return sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
src = opt("--src", "esri"); zoom = int(opt("--zoom", 16)); alpha = float(opt("--alpha", 0.45)); mode = opt("--mode", "blend"); maxw = int(opt("--maxw", 1800))
M = np.array(json.load(open(regf))["affine"]) if os.path.exists(regf) else np.array(json.loads(regf))
img = cv2.imread(f"{plans}/zone_{zid}.jpg"); H, W = img.shape[:2]
if "--crop" in sys.argv:
    cx, cy, hf = map(float, opt("--crop", "").split(",")); box = np.array([[cx - hf, cy - hf], [cx + hf, cy - hf], [cx + hf, cy + hf], [cx - hf, cy + hf]])
else: box = np.array([[0, 0], [W, 0], [W, H], [0, H]], float)
corners = box @ M[:, :2].T + M[:, 2]
mn, mx = corners.min(0), corners.max(0); pad = 0.12 * (mx - mn); mn -= pad; mx += pad
n = 2 ** zoom; res = 2 * HALF / n / 256
def tile_xy(x, y): return int((x + HALF) / (2 * HALF) * n), int((HALF - y) / (2 * HALF) * n)
tx0, ty1 = tile_xy(mn[0], mn[1]); tx1, ty0 = tile_xy(mx[0], mx[1])
os.makedirs("tiles", exist_ok=True)
canvas = np.zeros(((ty1 - ty0 + 1) * 256, (tx1 - tx0 + 1) * 256, 3), np.uint8)
for tx in range(tx0, tx1 + 1):
    for ty in range(ty0, ty1 + 1):
        f = f"tiles/{zoom}_{ty}_{tx}.jpg" if src == "esri" else f"tiles/{src}_{zoom}_{ty}_{tx}.jpg"
        url = f"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{zoom}/{ty}/{tx}" if src == "esri" else f"https://mt1.google.com/vt/lyrs=s&x={tx}&y={ty}&z={zoom}"
        if not os.path.exists(f):
            for a in range(3):
                try:
                    with urlopen(Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=30) as r: open(f, "wb").write(r.read()); break
                except Exception: time.sleep(2)
        t = cv2.imread(f)
        if t is not None: canvas[(ty - ty0) * 256:(ty - ty0 + 1) * 256, (tx - tx0) * 256:(tx - tx0 + 1) * 256] = t
up = float(opt('--up', 1))
if up != 1: canvas = cv2.resize(canvas, None, fx=up, fy=up, interpolation=cv2.INTER_CUBIC); res /= up
ox = tx0 / n * 2 * HALF - HALF; oy = HALF - ty0 / n * 2 * HALF
S = np.array([[1 / res, 0], [0, -1 / res]]); A = S @ M[:, :2]; t = S @ (M[:, 2] - np.array([ox, oy]))
Mc = np.hstack([A, t[:, None]]).astype(np.float32); size = (canvas.shape[1], canvas.shape[0])
if mode == "lines":
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV); g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    red = cv2.inRange(hsv, (0, 150, 150), (8, 255, 255)) | cv2.inRange(hsv, (172, 150, 150), (180, 255, 255))
    road = cv2.inRange(hsv, (0, 0, 150), (180, 25, 215))  # the plan's grey road surface
    road = cv2.morphologyEx(road, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    edge = cv2.Canny(road, 50, 150)
    lay = np.zeros_like(img); lay[edge > 0] = (255, 255, 0); lay[red > 0] = (0, 0, 255)
    polys = json.load(open(f"{plans}/zone_{zid}.plots.json"))["plots"]
    for p in polys: cv2.polylines(lay, [np.array(p["poly"], np.int32)], True, (0, 255, 255), 1)
    wl = cv2.warpAffine(lay, Mc, size, flags=cv2.INTER_LINEAR); sel = wl.max(2) > 60
    blend = canvas.copy(); blend[sel] = (canvas[sel] * 0.35 + wl[sel] * 0.65).astype(np.uint8)
else:
    warped = cv2.warpAffine(img, Mc, size, flags=cv2.INTER_AREA); mask = cv2.warpAffine(np.full((H, W), 255, np.uint8), Mc, size)
    blend = canvas.copy(); sel = mask > 0; blend[sel] = (canvas[sel] * (1 - alpha) + warped[sel] * alpha).astype(np.uint8)
c = (corners - np.array([ox, oy])) @ S.T; pad = 0.06 * (c.max(0) - c.min(0))
x0, y0 = np.maximum((c.min(0) - pad).astype(int), 0); x1, y1 = (c.max(0) + pad).astype(int)
blend = blend[y0:y1, x0:x1]
if blend.shape[1] > maxw: blend = cv2.resize(blend, (maxw, int(blend.shape[0] * maxw / blend.shape[1])), interpolation=cv2.INTER_AREA)
cv2.imwrite(out, blend, [cv2.IMWRITE_JPEG_QUALITY, 88]); print(out, blend.shape)
