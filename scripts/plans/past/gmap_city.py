"""Road raster of a city from Google's road-map tiles (labels off), for matching plan drawings against (place_g.py).
Google's map has the streets of the new districts that OpenStreetMap lacks.
usage: python3 gmap_city.py <tile cache dir> <out prefix> <south,west,north,east> [zoom = 16]
Writes <prefix>.npy (uint8, 255 = road, north-up Web Mercator) and <prefix>.json ({x0, y1, res}: Mercator x of the
left edge, y of the top edge, metres per pixel). Tiles are cached, so a rerun only fetches what is missing.
"""
import sys, os, json, math, subprocess
from concurrent.futures import ThreadPoolExecutor
import numpy as np, cv2
R = 6378137.0; HALF = math.pi * R
cache, out = sys.argv[1:3]; S, Wd, N, E = map(float, sys.argv[3].split(",")); z = int(sys.argv[4]) if len(sys.argv) > 4 else 16
os.makedirs(cache, exist_ok=True); n = 2 ** z
def tx(lng): return int((lng + 180) / 360 * n)
def ty(lat): return int((1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n)
x0, x1, y0, y1 = tx(Wd), tx(E), ty(N), ty(S)
def fetch(xy):
    x, y = xy; f = f"{cache}/{z}_{x}_{y}.png"
    if os.path.exists(f) and os.path.getsize(f) > 100: return
    for _ in range(3):
        subprocess.run(["curl", "-s", "-m", "30", "-A", "Mozilla/5.0", "-o", f, f"https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}&apistyle=s.e%3Al%7Cp.v%3Aoff"])
        if os.path.exists(f) and cv2.imread(f) is not None: return
tiles = [(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)]
with ThreadPoolExecutor(8) as ex: list(ex.map(fetch, tiles))
img = np.zeros(((y1 - y0 + 1) * 256, (x1 - x0 + 1) * 256), np.uint8); missing = 0
for x, y in tiles:
    t = cv2.imread(f"{cache}/{z}_{x}_{y}.png")
    if t is None: missing += 1; continue
    b, g, r = t[..., 0].astype(int), t[..., 1].astype(int), t[..., 2].astype(int)
    # Streets are drawn blue-grey on a warm or neutral ground; motorways slightly darker blue-grey.
    road = ((b - r) > 9) & ((b - g) > 2) & (g > 150)
    img[(y - y0) * 256:(y - y0 + 1) * 256, (x - x0) * 256:(x - x0 + 1) * 256] = road * 255
res = 2 * HALF / n / 256
np.save(out + ".npy", img); json.dump({"x0": x0 / n * 2 * HALF - HALF, "y1": HALF - y0 / n * 2 * HALF, "res": res, "zoom": z}, open(out + ".json", "w"))
print(f"{len(tiles)} tiles ({missing} missing) → {img.shape[1]}x{img.shape[0]} px at {res:.2f} m/px, roads {img.mean() / 255:.1%}")
