"""Sentinel-2 cloudless mosaic (EOX, 10 m, newer than Esri in new developments) crop with a metre grid.
usage: python3 s2.py <lat> <lng> <half m> <out.jpg> [--year 2024] [--grid 500] [--up 4]"""
import sys, math, os, time
from urllib.request import Request, urlopen
import numpy as np, cv2
R = 6378137.0; HALF = math.pi * R
lat, lng, halfw, out = float(sys.argv[1]), float(sys.argv[2]), float(sys.argv[3]), sys.argv[4]
def opt(n, d): return type(d)(sys.argv[sys.argv.index(n) + 1]) if n in sys.argv else d
year = opt("--year", 2024); grid = opt("--grid", 500.0); up = opt("--up", 4); zoom = 14
cx, cy = math.radians(lng) * R, math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * R
n = 2 ** zoom; res = 2 * HALF / n / 256
def txy(x, y): return int((x + HALF) / (2 * HALF) * n), int((HALF - y) / (2 * HALF) * n)
tx0, ty1 = txy(cx - halfw, cy - halfw); tx1, ty0 = txy(cx + halfw, cy + halfw)
os.makedirs("tiles_s2", exist_ok=True); canvas = np.zeros(((ty1 - ty0 + 1) * 256, (tx1 - tx0 + 1) * 256, 3), np.uint8)
for tx in range(tx0, tx1 + 1):
    for ty in range(ty0, ty1 + 1):
        f = f"tiles_s2/{year}_{zoom}_{ty}_{tx}.jpg"
        if not os.path.exists(f):
            for a in range(3):
                try:
                    with urlopen(Request(f"https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-{year}_3857/default/g/{zoom}/{ty}/{tx}.jpg", headers={"User-Agent": "Mozilla/5.0"}), timeout=40) as r: open(f, "wb").write(r.read()); break
                except Exception as e: err = e; time.sleep(2)
            else: print("tile fail", err)
        t = cv2.imread(f)
        if t is not None: canvas[(ty - ty0) * 256:(ty - ty0 + 1) * 256, (tx - tx0) * 256:(tx - tx0 + 1) * 256] = t
ox = tx0 / n * 2 * HALF - HALF; oy = HALF - ty0 / n * 2 * HALF
x0, y0 = int((cx - halfw - ox) / res), int((oy - cy - halfw) / res); x1, y1 = int((cx + halfw - ox) / res), int((oy - cy + halfw) / res)
crop = cv2.resize(canvas[y0:y1, x0:x1], None, fx=up, fy=up, interpolation=cv2.INTER_CUBIC); r2 = res / up; h, w = crop.shape[:2]
if "--nogrid" not in sys.argv:
    for i in range(-int(halfw // grid), int(halfw // grid) + 1):
        px = int((halfw + i * grid) / r2); py = int((halfw - i * grid) / r2)
        cv2.line(crop, (px, 0), (px, h), (255, 255, 0), 1); cv2.line(crop, (0, py), (w, py), (255, 255, 0), 1)
        cv2.putText(crop, f"{int(i*grid):+d}", (px + 3, 14), 0, 0.45, (255, 255, 0), 1); cv2.putText(crop, f"{int(i*grid):+d}", (3, py - 3), 0, 0.45, (255, 255, 0), 1)
cv2.imwrite(out, crop, [cv2.IMWRITE_JPEG_QUALITY, 90])
print(f"{out}: {w}x{h}, {r2:.3f} m/px (native {res:.2f}); offset m = ((px - {w/2:.0f}) * {r2:.3f}, ({h/2:.0f} - py) * {r2:.3f}); centre merc {cx:.1f},{cy:.1f}")
