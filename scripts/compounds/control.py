"""Place a master plan by hand-picked landmarks: the same roundabout, corner or lake read off the plan and off the
satellite. Three or more pairs fix the plan exactly (least-squares affine), with no reliance on the outline's shape.
usage:
  python3 control.py <fetch dir> <public/compounds> grid <id> <out.jpg>
      The plan (left) and the satellite with the outline (right), each 640 px with a labelled grid every 40 px.
      Read landmark pairs off it as [plan x, plan y, sat x, sat y] in those displayed pixels.
  python3 control.py <fetch dir> <public/compounds> add <id> '<json list of [px, py, sx, sy]>' | hide | unbuilt
      Records the pairs (as image pixels and lat/lng) in scripts/compounds/control_points.json; "hide" marks an image
      that is no plan of the site; "unbuilt" notes nothing is built yet to match (the placement stays as it is).
  python3 control.py <fetch dir> <public/compounds> apply
      Turns every recorded set of pairs into a placement in scripts/compounds/reviewed.json (then run the build).
"""
import sys, os, json, math, time
from urllib.request import Request, urlopen
import numpy as np, cv2
SRC, PUB, MODE = sys.argv[1:4]
HERE = os.path.dirname(os.path.abspath(__file__))
POINTS, REVIEWED = f"{HERE}/control_points.json", f"{HERE}/reviewed.json"
R = 6378137.0; HALF = math.pi * R; TILES = f"{SRC}/tiles"; PX = 640; G = 40
def merc(lat, lng): return (math.radians(lng) * R, math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * R)
def unmerc(x, y): return [round(math.degrees(2 * math.atan(math.exp(y / R)) - math.pi / 2), 7), round(math.degrees(x / R), 7)]
def tile(z, ty, tx):
    f = f"{TILES}/{z}_{ty}_{tx}.jpg"
    if not os.path.exists(f):
        os.makedirs(TILES, exist_ok=True)
        for a in range(3):
            try:
                with urlopen(Request(f"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{ty}/{tx}", headers={"User-Agent": "Mozilla/5.0"}), timeout=30) as r:
                    open(f + ".part", "wb").write(r.read()); os.replace(f + ".part", f); break
            except Exception: time.sleep(2 * (a + 1))
    return cv2.imread(f)
def satellite(bounds):
    (s, w), (n, e) = bounds; x0, y0 = merc(s, w); x1, y1 = merc(n, e)
    span = max(x1 - x0, y1 - y0) * 1.3; cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    z = max(10, min(19, int(math.log2(2 * HALF * PX / (256 * span))) + 1)); nt = 2 ** z; res = 2 * HALF / nt / 256
    tx0, ty0 = int((cx - span / 2 + HALF) / (2 * HALF) * nt), int((HALF - (cy + span / 2)) / (2 * HALF) * nt)
    tx1, ty1 = int((cx + span / 2 + HALF) / (2 * HALF) * nt), int((HALF - (cy - span / 2)) / (2 * HALF) * nt)
    canvas = np.zeros(((ty1 - ty0 + 1) * 256, (tx1 - tx0 + 1) * 256, 3), np.uint8)
    for tx in range(tx0, tx1 + 1):
        for ty in range(ty0, ty1 + 1):
            t = tile(z, ty, tx)
            if t is not None: canvas[(ty - ty0) * 256:(ty - ty0 + 1) * 256, (tx - tx0) * 256:(tx - tx0 + 1) * 256] = t
    ox, oy = tx0 / nt * 2 * HALF - HALF, HALF - ty0 / nt * 2 * HALF
    c0, r0, size = int((cx - span / 2 - ox) / res), int((oy - (cy + span / 2)) / res), int(span / res)
    img = cv2.resize(canvas[r0:r0 + size, c0:c0 + size], (PX, PX), interpolation=cv2.INTER_AREA)
    fx0, fy0, k = cx - span / 2, cy + span / 2, span / PX
    return img, (lambda ll: ((merc(*ll)[0] - fx0) / k, (fy0 - merc(*ll)[1]) / k)), (lambda p: unmerc(fx0 + p[0] * k, fy0 - p[1] * k))
def gridded(img, color):
    img = img.copy(); h, w = img.shape[:2]
    for x in range(0, w, G):
        cv2.line(img, (x, 0), (x, h), color, 1)
        if x % 80 == 0: cv2.putText(img, str(x), (x + 2, 11), cv2.FONT_HERSHEY_SIMPLEX, 0.35, color, 1)
    for y in range(0, h, G):
        cv2.line(img, (0, y), (w, y), color, 1)
        if y % 80 == 0 and y: cv2.putText(img, str(y), (2, y - 2), cv2.FONT_HERSHEY_SIMPLEX, 0.35, color, 1)
    return img
comps = {c["id"]: c for c in json.load(open(f"{PUB}/index.json"))["compounds"]}
def plan_view(cid):
    im = cv2.imread(f"{PUB}/img/{cid}.webp"); H, W = im.shape[:2]; k = PX / max(H, W)
    return im, cv2.resize(im, (round(W * k), round(H * k)), interpolation=cv2.INTER_AREA), k
pts = json.load(open(POINTS)) if os.path.exists(POINTS) else {}
if MODE == "grid":
    cid, out = int(sys.argv[4]), sys.argv[5]; c = comps[cid]
    im, small, k = plan_view(cid); sat, ll_px, _ = satellite(c["bounds"])
    cv2.polylines(sat, [np.int32([ll_px(p) for p in c["ring"]])], True, (255, 0, 255), 2)
    left = np.full((PX, PX, 3), 255, np.uint8); left[:small.shape[0], :small.shape[1]] = small
    sheet = np.hstack([gridded(left, (0, 0, 255)), np.full((PX, 8, 3), 0, np.uint8), gridded(sat, (0, 255, 255))])
    cv2.putText(sheet, f"{cid} {c['name'][:40]}", (6, PX - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 0, 255), 2)
    cv2.imwrite(out, sheet, [cv2.IMWRITE_JPEG_QUALITY, 88]); print(out)
elif MODE == "add":
    cid = int(sys.argv[4]); val = sys.argv[5]
    if val in ("hide", "unbuilt"): pts[str(cid)] = val
    else:
        pairs = json.loads(val); assert len(pairs) >= 3, "need at least three pairs"
        _, _, k = plan_view(cid); _, _, px_ll = satellite(comps[cid]["bounds"])
        pts[str(cid)] = [[round(px / k, 1), round(py / k, 1)] + px_ll((sx, sy)) for px, py, sx, sy in pairs]
    json.dump(pts, open(POINTS, "w"), indent=0); print(cid, pts[str(cid)] if isinstance(pts[str(cid)], str) else f"{len(pts[str(cid)])} pairs")
elif MODE == "apply":
    rev = json.load(open(REVIEWED)); done = 0; worst = []
    for cid, v in pts.items():
        if v == "hide": rev[cid] = "hide"; continue
        if v == "unbuilt": continue
        c = comps[int(cid)]; lat0 = c["ring"][0][0]; kx, ky = 111320 * math.cos(math.radians(lat0)), 110540
        P = np.float64([[p[0], p[1]] for p in v]); Q = np.float64([[p[3] * kx, -p[2] * ky] for p in v])  # metres, y down
        A = np.hstack([P, np.ones((len(P), 1))]); sol, *_ = np.linalg.lstsq(A, Q, rcond=None)  # image px -> metres
        err = float(np.sqrt(((A @ sol - Q) ** 2).sum(1)).max()); worst.append((err, cid))
        im = cv2.imread(f"{PUB}/img/{cid}.webp"); H, W = im.shape[:2]
        def ll(x, y): mx, my = np.array([x, y, 1.0]) @ sol; return [round(-my / ky, 6), round(mx / kx, 6)]
        M = np.vstack([sol.T, [0, 0, 1]]); Mi = np.linalg.inv(M)
        clip = [[round(float(u)) for u in (Mi @ np.array([p[1] * kx, -p[0] * ky, 1.0]))[:2]] for p in c["ring"]]
        rev[cid] = {"corners": {"tl": ll(0, 0), "tr": ll(W, 0), "bl": ll(0, H)}, "clip": clip}; done += 1
    json.dump(rev, open(REVIEWED, "w"), separators=(",", ":"))
    print(done, "placed by landmarks; largest residual (m):", sorted(worst, reverse=True)[:5])
