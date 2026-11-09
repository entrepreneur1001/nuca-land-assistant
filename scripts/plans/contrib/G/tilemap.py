"""Stitch map tiles (Google roadmap/hybrid or OSM) around a Mercator point, to look for mapped roads where imagery shows nothing.
usage: python3 tilemap.py <merc x> <merc y> <zoom> <half m> <out.jpg> [--src gm|gh|osm]   (gm = Google roadmap, gh = hybrid, bing = Bing aerial, s2-YYYY = EOX Sentinel-2 cloudless mosaic of that year, 10 m)"""
import sys, math, os, time
from urllib.request import Request, urlopen
import numpy as np, cv2
R = 6378137.0; HALF = math.pi * R
cx, cy, zoom, halfw, out = float(sys.argv[1]), float(sys.argv[2]), int(sys.argv[3]), float(sys.argv[4]), sys.argv[5]
src = sys.argv[sys.argv.index("--src") + 1] if "--src" in sys.argv else "gm"
n = 2 ** zoom; res = 2 * HALF / n / 256
def tile_xy(x, y): return int((x + HALF) / (2 * HALF) * n), int((HALF - y) / (2 * HALF) * n)
tx0, ty1 = tile_xy(cx - halfw, cy - halfw); tx1, ty0 = tile_xy(cx + halfw, cy + halfw)
os.makedirs("tiles", exist_ok=True)
canvas = np.zeros(((ty1 - ty0 + 1) * 256, (tx1 - tx0 + 1) * 256, 3), np.uint8)
for tx in range(tx0, tx1 + 1):
    for ty in range(ty0, ty1 + 1):
        f = f"tiles/{src}_{zoom}_{ty}_{tx}.png"
        url = {"gm": f"https://mt1.google.com/vt/lyrs=m&x={tx}&y={ty}&z={zoom}", "gh": f"https://mt1.google.com/vt/lyrs=y&x={tx}&y={ty}&z={zoom}",
               "osm": f"https://tile.openstreetmap.org/{zoom}/{tx}/{ty}.png",
               "bing": "https://ecn.t0.tiles.virtualearth.net/tiles/a" + "".join(str(((tx >> i) & 1) + 2 * ((ty >> i) & 1)) for i in range(zoom - 1, -1, -1)) + ".jpeg?g=1",
               "s2": f"https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-{src[3:] or '2024'}_3857/default/g/{zoom}/{ty}/{tx}.jpg"}[src.split("-")[0]]
        if not os.path.exists(f):
            for a in range(3):
                try:
                    with urlopen(Request(url, headers={"User-Agent": "Mozilla/5.0 plan-check"}), timeout=30) as r: open(f, "wb").write(r.read()); break
                except Exception as e: time.sleep(2)
        t = cv2.imread(f) if os.path.exists(f) else None
        if t is not None: canvas[(ty - ty0) * 256:(ty - ty0 + 1) * 256, (tx - tx0) * 256:(tx - tx0 + 1) * 256] = t
ox = tx0 / n * 2 * HALF - HALF; oy = HALF - ty0 / n * 2 * HALF
x0, y0 = int((cx - halfw - ox) / res), int((oy - cy - halfw) / res); x1, y1 = int((cx + halfw - ox) / res), int((oy - cy + halfw) / res)
cv2.imwrite(out, canvas[y0:y1, x0:x1]); print(out, canvas[y0:y1, x0:x1].shape, f"{res:.3f} m/px")
