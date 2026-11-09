"""Draw cached OSM ways around a centre with a metre grid. usage: osm_draw.py <osm json> <lat> <lng> <half m> <out.jpg> [grid m]"""
import sys, json, math, cv2, numpy as np
R = 6378137.0
def merc(lat, lng): return (math.radians(lng) * R, math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * R)
o = json.load(open(sys.argv[1])); cx, cy = merc(float(sys.argv[2]), float(sys.argv[3])); half = float(sys.argv[4]); g = float(sys.argv[6]) if len(sys.argv) > 6 else 500
N = 1400; res = 2 * half / N; im = np.full((N, N, 3), 255, np.uint8)
for i in range(-int(half // g), int(half // g) + 1):
    p = int((half + i * g) / res); cv2.line(im, (p, 0), (p, N), (255, 220, 120), 1); cv2.line(im, (0, N - p), (N, N - p), (255, 220, 120), 1)
    cv2.putText(im, f"{int(i*g):+d}", (p + 3, 14), 0, 0.45, (200, 120, 0), 1); cv2.putText(im, f"{int(i*g):+d}", (3, N - p - 3), 0, 0.45, (200, 120, 0), 1)
for w in o["ways"]:
    pp = np.array([[(x - (cx - half)) / res, ((cy + half) - y) / res] for x, y in (merc(a, b) for a, b in w["pts"])], np.int32)
    cv2.polylines(im, [pp], False, (0, 0, 200) if w["hw"] not in ("service", "track", "path", "footway") else (120, 120, 120), 1, cv2.LINE_AA)
cv2.imwrite(sys.argv[5], im)
