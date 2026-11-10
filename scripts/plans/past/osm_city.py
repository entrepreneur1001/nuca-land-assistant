"""Rasterise a city's OpenStreetMap roads once, for matching plans against them (place.py).
usage: python3 osm_city.py <overpass out-geom json> <out prefix> <south,west,north,east> [res m/px = 4]
Writes <prefix>.npy (uint8 road raster, north-up, Web-Mercator metres at `res` per pixel) and <prefix>.json
({x0, y1, res}: Mercator x of the left edge, y of the top edge).
"""
import sys, json, math
import numpy as np, cv2
R = 6378137.0
def merc(lat, lng): return (math.radians(lng) * R, math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * R)
src, out = sys.argv[1:3]; S, Wd, N, E = map(float, sys.argv[3].split(",")); res = float(sys.argv[4]) if len(sys.argv) > 4 else 4.0
ways = [w for w in json.load(open(src))["elements"] if w.get("type") == "way" and w.get("geometry")]
lines = [(w.get("tags", {}).get("highway", ""), np.array([merc(p["lat"], p["lon"]) for p in w["geometry"]])) for w in ways]
(x0, y0), (x1, y1) = merc(S, Wd), merc(N, E)  # ways that leave the box are clipped by the raster
W, H = int((x1 - x0) / res) + 1, int((y1 - y0) / res) + 1
img = np.zeros((H, W), np.uint8)
# Carriageway widths in Mercator metres (ground width / cos 30°): what a plan draws as the street.
WIDTH = {"motorway": 40, "trunk": 40, "primary": 34, "secondary": 28, "tertiary": 22}
for hw, l in lines:
    wm = WIDTH.get(hw.replace("_link", ""), 14)
    pts = np.column_stack([(l[:, 0] - x0) / res, (y1 - l[:, 1]) / res]).round().astype(np.int32)
    cv2.polylines(img, [pts], False, 255, max(1, int(round(wm / res))), cv2.LINE_AA)
np.save(out + ".npy", img); json.dump({"x0": x0, "y1": y1, "res": res}, open(out + ".json", "w"))
print(f"{len(lines)} ways → {W}x{H} px at {res} m/px")
