"""Satellite crop with a labelled metre grid, for reading control points by eye.
usage: python3 sat.py <lat> <lng> <zoom> <half-width m> <out.jpg> [--grid 100]
Grid lines every --grid metres; labels are offsets (m) east/north of the given centre. Prints the crop's pixel→lat/lng formula.
"""
import sys, math, os, time
from urllib.request import Request, urlopen
import numpy as np, cv2
R = 6378137.0; HALF = math.pi * R
lat, lng, zoom, halfw, out = float(sys.argv[1]), float(sys.argv[2]), int(sys.argv[3]), float(sys.argv[4]), sys.argv[5]
grid = float(sys.argv[sys.argv.index("--grid") + 1]) if "--grid" in sys.argv else 100.0
def merc(lat, lng): return (math.radians(lng) * R, math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * R)
cx, cy = merc(lat, lng); n = 2 ** zoom; res = 2 * HALF / n / 256
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
def to_px(x, y): return int((x - ox) / res), int((oy - y) / res)
x0, y0 = to_px(cx - halfw, cy + halfw); x1, y1 = to_px(cx + halfw, cy - halfw)
crop = canvas[y0:y1, x0:x1].copy(); h, w = crop.shape[:2]
# grid: lines every `grid` m through the centre
k = int(halfw // grid)
for i in range(-k, k + 1):
    px = int((cx + i * grid - (cx - halfw)) / res); py = int(((cy + halfw) - (cy + i * grid)) / res)
    col = (0, 255, 255) if i == 0 else (255, 255, 0)
    cv2.line(crop, (px, 0), (px, h), col, 1); cv2.line(crop, (0, py), (w, py), col, 1)
    cv2.putText(crop, f"{int(i*grid):+d}", (px + 3, 14), cv2.FONT_HERSHEY_SIMPLEX, 0.45, col, 1)
    cv2.putText(crop, f"{int(i*grid):+d}", (3, py - 3), cv2.FONT_HERSHEY_SIMPLEX, 0.45, col, 1)
cv2.imwrite(out, crop, [cv2.IMWRITE_JPEG_QUALITY, 88])
print(f"{out}: {w}x{h}px, {res:.2f} m/px; offset (east, north) m = ((px - {w/2:.0f}) * {res:.3f}, ({h/2:.0f} - py) * {res:.3f}); centre merc {cx:.1f},{cy:.1f}")
