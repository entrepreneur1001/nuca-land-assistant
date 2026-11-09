"""Locate a zone plan on satellite imagery by correlating its road network with linear features in the imagery.
usage: python3 match_sat.py <plans dir> <zone_plots.json> <zid> <lat> <lng> <half m> <out dir> [--zoom 16] [--rot 0,5,...] [--scale m_per_px] [--top 6]
Writes <out>/<zid>.sat.json (candidates: affine px→mercator, score, rot) and preview JPEGs with the plan outline drawn.
"""
import sys, json, math, os, time
from urllib.request import Request, urlopen
import numpy as np, cv2
R = 6378137.0; HALF = math.pi * R
def merc(lat, lng): return (math.radians(lng) * R, math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * R)
def poly_area(poly): return abs(sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(poly, poly[1:] + poly[:1]))) / 2
plans, zpf, zid, lat, lng, halfw, out = sys.argv[1], sys.argv[2], sys.argv[3], float(sys.argv[4]), float(sys.argv[5]), float(sys.argv[6]), sys.argv[7]
zoom = int(sys.argv[sys.argv.index("--zoom") + 1]) if "--zoom" in sys.argv else 16
rots = [float(x) for x in sys.argv[sys.argv.index("--rot") + 1].split(",")] if "--rot" in sys.argv else [r for r in range(0, 360, 5)]
top = int(sys.argv[sys.argv.index("--top") + 1]) if "--top" in sys.argv else 6
scales = [float(x) for x in sys.argv[sys.argv.index("--scales") + 1].split(",")] if "--scales" in sys.argv else [1.0]
zp = json.load(open(zpf))[zid]; polys = json.load(open(f"{plans}/zone_{zid}.plots.json"))["plots"]
img = cv2.imread(f"{plans}/zone_{zid}.jpg"); H, W = img.shape[:2]
if "--scale" in sys.argv: scale = float(sys.argv[sys.argv.index("--scale") + 1])
else:
    px = sum(poly_area(p["poly"]) for p in polys); m2 = sum(p["area"] for p in zp["plots"]); scale = math.sqrt(m2 * 1.15 / px)
# --- satellite canvas
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
ox = tx0 / n * 2 * HALF - HALF; oy = HALF - ty0 / n * 2 * HALF  # canvas origin (metres)
# Linear features in the imagery: gradient magnitude, blurred (roads = pairs of edges / colour change)
g = cv2.cvtColor(canvas, cv2.COLOR_BGR2GRAY).astype(np.float32)
gx = cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3); gy = cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3)
mag = cv2.GaussianBlur(np.hypot(gx, gy), (0, 0), 2.5)
mag = np.clip(mag / np.percentile(mag, 99), 0, 1)
# --- plan road mask (light grey) at the imagery resolution, then its edges blurred the same way
hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV); gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
road = cv2.inRange(hsv, (0, 0, 150), (180, 45, 225))
road[(gray < 120).mean(1) > 0.6, :] = 0; road[:int(H * 0.12), int(W * 0.6):] = 0
base_scale = scale
cands = []
for sm in scales:
    scale = base_scale * sm
    f = scale / res
    small = cv2.resize(road, (max(1, int(W * f)), max(1, int(H * f))), interpolation=cv2.INTER_AREA)
    small = (small > 60).astype(np.uint8) * 255
    small = cv2.morphologyEx(small, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    edges = cv2.morphologyEx(small, cv2.MORPH_GRADIENT, np.ones((3, 3), np.uint8)).astype(np.float32) / 255
    tpl0 = cv2.GaussianBlur(edges, (0, 0), 2.5)
    drawn = (cv2.resize(cv2.inRange(hsv, (0, 0, 0), (180, 255, 235)), small.shape[::-1], interpolation=cv2.INTER_AREA) > 60).astype(np.uint8) * 255
    for rot in rots:
        Mr = cv2.getRotationMatrix2D((small.shape[1] / 2, small.shape[0] / 2), -rot, 1.0)
        cos, sin = abs(Mr[0, 0]), abs(Mr[0, 1]); nw, nh = int(small.shape[0] * sin + small.shape[1] * cos), int(small.shape[0] * cos + small.shape[1] * sin)
        Mr[0, 2] += nw / 2 - small.shape[1] / 2; Mr[1, 2] += nh / 2 - small.shape[0] / 2
        tpl = cv2.warpAffine(tpl0, Mr, (nw, nh)); msk = cv2.warpAffine(drawn, Mr, (nw, nh))
        if nh >= mag.shape[0] or nw >= mag.shape[1]: continue
        r = cv2.matchTemplate(mag, tpl, cv2.TM_CCOEFF_NORMED, mask=(msk > 0).astype(np.float32))
        r = np.nan_to_num(r, nan=-1, posinf=-1, neginf=-1)
        rr = r.copy()
        for _ in range(3):
            _, mx, _, loc = cv2.minMaxLoc(rr)
            cands.append((float(mx), rot, loc, Mr.copy(), nw, nh, f, scale)); cv2.circle(rr, loc, 30, -1, -1)
cands.sort(key=lambda c: -c[0])
os.makedirs(out, exist_ok=True); results = []
for k, (score, rot, (lx, ly), Mr, nw, nh, f, scale) in enumerate(cands[:top]):
    A1 = np.array([[f, 0, 0], [0, f, 0], [0, 0, 1.0]]); A2 = np.vstack([Mr, [0, 0, 1]]); A3 = np.array([[1, 0, lx], [0, 1, ly], [0, 0, 1.0]])
    A4 = np.array([[res, 0, ox], [0, -res, oy], [0, 0, 1.0]])
    M = (A4 @ A3 @ A2 @ A1)[:2]
    results.append({"affine": M.tolist(), "score": score, "rot": rot, "scale_m_per_px": scale})
    vis = canvas.copy()
    Mc = (A3 @ A2 @ A1)[:2].astype(np.float32)
    ol = cv2.warpAffine(road, Mc, (vis.shape[1], vis.shape[0]))
    vis[ol > 0] = (0.4 * vis[ol > 0] + 0.6 * np.array([0, 0, 255])).astype(np.uint8)
    corners = np.array([[0, 0], [W, 0], [W, H], [0, H]], np.float32) @ Mc[:, :2].T + Mc[:, 2]
    cv2.polylines(vis, [corners.astype(np.int32)], True, (0, 255, 0), 2)
    x0, y0 = corners.min(0).astype(int) - 60; x1, y1 = corners.max(0).astype(int) + 60
    crop = vis[max(0, y0):min(vis.shape[0], y1), max(0, x0):min(vis.shape[1], x1)]
    s = min(1.0, 1400 / max(1, crop.shape[1]))
    cv2.imwrite(f"{out}/{zid}.sat{k}.jpg", cv2.resize(crop, None, fx=s, fy=s), [cv2.IMWRITE_JPEG_QUALITY, 82])
    c = M @ np.array([W / 2, H / 2, 1]); clat = math.degrees(2 * math.atan(math.exp(c[1] / R)) - math.pi / 2); clng = math.degrees(c[0] / R)
    print(f"cand {k}: score {score:.3f} rot {rot}° scale {scale:.3f} m/px centre {clat:.5f},{clng:.5f}")
json.dump(results, open(f"{out}/{zid}.sat.json", "w"))
print(f"base scale {base_scale:.4f} m/px at {res:.2f} m/px imagery")
