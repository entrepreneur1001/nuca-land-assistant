"""Render Esri World_Transportation tiles (roads) around a centre as a white-background JPEG with a metre grid.
usage: python3 esri_roads.py <lat> <lng> <zoom> <half m> <out.jpg> [--grid 1000]
"""
import sys, math, os, time, numpy as np, cv2
from urllib.request import Request, urlopen
R = 6378137.0; HALF = math.pi * R
lat, lng, zoom, halfw, out = float(sys.argv[1]), float(sys.argv[2]), int(sys.argv[3]), float(sys.argv[4]), sys.argv[5]
grid = float(sys.argv[sys.argv.index("--grid") + 1]) if "--grid" in sys.argv else 1000.0
cx, cy = (math.radians(lng) * R, math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * R); n = 2 ** zoom; res = 2 * HALF / n / 256
def tile_xy(x, y): return int((x + HALF) / (2 * HALF) * n), int((HALF - y) / (2 * HALF) * n)
tx0, ty1 = tile_xy(cx - halfw, cy - halfw); tx1, ty0 = tile_xy(cx + halfw, cy + halfw)
os.makedirs("tiles_tr", exist_ok=True)
canvas = np.zeros(((ty1 - ty0 + 1) * 256, (tx1 - tx0 + 1) * 256, 4), np.uint8)
for tx in range(tx0, tx1 + 1):
    for ty in range(ty0, ty1 + 1):
        f = f"tiles_tr/{zoom}_{ty}_{tx}.png"
        if not os.path.exists(f):
            for a in range(3):
                try:
                    with urlopen(Request(f"https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{zoom}/{ty}/{tx}", headers={"User-Agent": "Mozilla/5.0"}), timeout=30) as r: open(f, "wb").write(r.read()); break
                except Exception: time.sleep(2)
        t = cv2.imread(f, cv2.IMREAD_UNCHANGED)
        if t is None: continue
        if t.ndim == 2: t = cv2.cvtColor(t, cv2.COLOR_GRAY2BGRA)
        elif t.shape[2] == 3: t = cv2.cvtColor(t, cv2.COLOR_BGR2BGRA)
        canvas[(ty - ty0) * 256:(ty - ty0 + 1) * 256, (tx - tx0) * 256:(tx - tx0 + 1) * 256] = t
ox = tx0 / n * 2 * HALF - HALF; oy = HALF - ty0 / n * 2 * HALF
x0, y0 = int((cx - halfw - ox) / res), int((oy - (cy + halfw)) / res); x1, y1 = int((cx + halfw - ox) / res), int((oy - (cy - halfw)) / res)
c = canvas[y0:y1, x0:x1]; a = c[..., 3:4] / 255.0
img = (c[..., :3] * a + np.full(c.shape[:2] + (3,), 255, np.uint8) * (1 - a)).astype(np.uint8)
h, w = img.shape[:2]; k = int(halfw // grid)
for i in range(-k, k + 1):
    px = int((i * grid + halfw) / res); py = int((halfw - i * grid) / res); col = (0, 200, 255) if i == 0 else (200, 200, 200)
    cv2.line(img, (px, 0), (px, h), col, 1); cv2.line(img, (0, py), (w, py), col, 1)
    cv2.putText(img, f"{int(i*grid):+d}", (px + 3, 14), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 0, 0), 1); cv2.putText(img, f"{int(i*grid):+d}", (3, py - 3), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 0, 0), 1)
s = min(1.0, 1600 / w); cv2.imwrite(out, cv2.resize(img, None, fx=s, fy=s), [cv2.IMWRITE_JPEG_QUALITY, 85])
print(f"{out}: {w}x{h} at {res:.2f} m/px (shown ×{s:.2f}); offset m = ((px/{s:.3f} - {w/2:.0f}) * {res:.3f}, ({h/2:.0f} - py/{s:.3f}) * {res:.3f})")
