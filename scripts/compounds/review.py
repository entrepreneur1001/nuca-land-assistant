"""Review the placed master plans against satellite imagery, and apply the reviewer's choices.
usage:
  python3 review.py <fetch dir> <public/compounds> sheets <out dir> [--kinds rough,cover] [--ids a,b] [--per 6]
      Per compound: the satellite with the outline, then each candidate placement over it, labelled with a road
      agreement score. Writes <out>/sheet_NN.jpg (--per compounds each) and <out>/candidates.json.
  The reviewer's choices ({id: "<candidate>" | "now" | "hide"}) become scripts/compounds/reviewed.json: the chosen
  placement {corners, clip}, or "hide"; build_compounds.py applies it over fits.json, so a new fitting run keeps them.
Candidates: "now" (current placement); "n0" "n90" "n180" "n270" (whole image laid over the outline turned that many
degrees clockwise from north-up); "c0".."c270" (the same with blank page margins trimmed); "a0".."a270" (trimmed and
turned to the outline's own long axis).
"""
import sys, os, json, math, glob, time
from urllib.request import Request, urlopen
from concurrent.futures import ThreadPoolExecutor
import numpy as np, cv2
SRC, PUB, MODE = sys.argv[1:4]
R = 6378137.0; HALF = math.pi * R
TILES = f"{SRC}/tiles"
def arg(name, default=None): return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default
def merc(lat, lng): return (math.radians(lng) * R, math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * R)
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
def satellite(bounds, px=520):
    """Satellite around bounds (with a margin): image, and a function [lat, lng] -> pixel."""
    (s, w), (n, e) = bounds
    x0, y0 = merc(s, w); x1, y1 = merc(n, e)
    span = max(x1 - x0, y1 - y0) * 1.35; cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    z = max(10, min(18, int(math.log2(2 * HALF * px / (256 * span)))))
    nt = 2 ** z; res = 2 * HALF / nt / 256
    tx0, ty0 = int((cx - span / 2 + HALF) / (2 * HALF) * nt), int((HALF - (cy + span / 2)) / (2 * HALF) * nt)
    tx1, ty1 = int((cx + span / 2 + HALF) / (2 * HALF) * nt), int((HALF - (cy - span / 2)) / (2 * HALF) * nt)
    canvas = np.zeros(((ty1 - ty0 + 1) * 256, (tx1 - tx0 + 1) * 256, 3), np.uint8)
    with ThreadPoolExecutor(4) as ex:
        jobs = {(tx, ty): ex.submit(tile, z, ty, tx) for tx in range(tx0, tx1 + 1) for ty in range(ty0, ty1 + 1)}
    for (tx, ty), j in jobs.items():
        t = j.result()
        if t is not None: canvas[(ty - ty0) * 256:(ty - ty0 + 1) * 256, (tx - tx0) * 256:(tx - tx0 + 1) * 256] = t
    ox, oy = tx0 / nt * 2 * HALF - HALF, HALF - ty0 / nt * 2 * HALF
    cx0, cy0 = int((cx - span / 2 - ox) / res), int((oy - (cy + span / 2)) / res); size = int(span / res)
    img = canvas[cy0:cy0 + size, cx0:cx0 + size]
    k = px / max(1, img.shape[0]); img = cv2.resize(img, (px, px), interpolation=cv2.INTER_AREA)
    def to_px(ll):
        x, y = merc(ll[0], ll[1]); return ((x - ox) / res - cx0) * k, ((oy - y) / res - cy0) * k
    return img, to_px
def content_box(im):
    """Bounding box of the drawing on a plain page, or the whole image."""
    small = cv2.resize(im[..., :3], (200, max(1, round(200 * im.shape[0] / im.shape[1])))).astype(np.int16)
    edge = np.concatenate([small[0], small[-1], small[:, 0], small[:, -1]]); bg = np.median(edge, 0)
    fg = (np.abs(small - bg).max(2) > 30).astype(np.uint8)
    fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(fg, 8)
    if n < 2: return 0, 0, im.shape[1], im.shape[0]
    big = 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA])); x, y, w, h = st[big, :4]
    if w * h < 0.15 * fg.size: return 0, 0, im.shape[1], im.shape[0]
    k = im.shape[1] / 200
    return int(x * k), int(y * k), min(im.shape[1], int((x + w) * k)), min(im.shape[0], int((y + h) * k))
def place(ring, box, deg):
    """Corners {tl, tr, bl} of the full image so that `box` (x0, y0, x1, y1 in image pixels), turned `deg` clockwise,
    is the smallest such frame holding the outline. Also the outline in image pixels."""
    lat0 = sum(p[0] for p in ring) / len(ring); kx, ky = 111320 * math.cos(math.radians(lat0)), 110540
    pts = np.array([[p[1] * kx, -p[0] * ky] for p in ring]); org = pts.mean(0); pts = pts - org
    bx0, by0, bx1, by1 = box; W, H = bx1 - bx0, by1 - by0
    th = math.radians(-deg); c, sn = math.cos(th), math.sin(th)  # map metres -> frame axes
    r = np.stack([pts[:, 0] * c - pts[:, 1] * sn, pts[:, 0] * sn + pts[:, 1] * c], 1)
    lo, hi = r.min(0), r.max(0); s = min(W / (hi[0] - lo[0]), H / (hi[1] - lo[1])) * 0.98; mid = (lo + hi) / 2
    q = np.stack([(r[:, 0] - mid[0]) * s + bx0 + W / 2, (r[:, 1] - mid[1]) * s + by0 + H / 2], 1)
    def to_ll(x, y):
        fx, fy = (x - bx0 - W / 2) / s + mid[0], (y - by0 - H / 2) / s + mid[1]
        c2, s2 = math.cos(-th), math.sin(-th); mx, my = fx * c2 - fy * s2 + org[0], fx * s2 + fy * c2 + org[1]
        return [round(-my / ky, 6), round(mx / kx, 6)]
    return {"tl": to_ll(0, 0), "tr": to_ll(IMW, 0), "bl": to_ll(0, IMH)}, [[round(float(x)), round(float(y))] for x, y in q]
def axis_deg(ring):
    lat0 = sum(p[0] for p in ring) / len(ring); kx, ky = 111320 * math.cos(math.radians(lat0)), 110540
    pts = np.array([[p[1] * kx, -p[0] * ky] for p in ring], np.float32)
    (_, _), (w, h), a = cv2.minAreaRect(pts)
    return a if w >= h else a + 90
def warp(im, corners, to_px, size):
    tl, tr, bl = (np.float32(to_px(corners[k])) for k in ("tl", "tr", "bl"))
    h, w = im.shape[:2]
    M = cv2.getAffineTransform(np.float32([[0, 0], [w, 0], [0, h]]), np.float32([tl, tr, bl]))
    return cv2.warpAffine(im, M, (size, size), flags=cv2.INTER_AREA, borderValue=0), M
def grad(g):
    g = cv2.GaussianBlur(g, (0, 0), 1.5).astype(np.float32)
    gx, gy = cv2.Sobel(g, cv2.CV_32F, 1, 0), cv2.Sobel(g, cv2.CV_32F, 0, 1)
    return gx, gy, np.hypot(gx, gy)
def score(sat, over, mask):
    """Agreement of edge directions between the satellite and the placed plan, inside the outline (0 = none)."""
    if mask.sum() < 500: return 0.0
    ax, ay, am = grad(cv2.cvtColor(sat, cv2.COLOR_BGR2GRAY)); bx, by, bm = grad(cv2.cvtColor(over, cv2.COLOR_BGR2GRAY))
    am = np.minimum(am / (np.percentile(am[mask], 90) + 1e-3), 1); bm = np.minimum(bm / (np.percentile(bm[mask], 90) + 1e-3), 1)
    cos2 = ((ax * bx + ay * by) / (np.hypot(ax, ay) * np.hypot(bx, by) + 1e-3)) ** 2
    w = am * bm * mask
    return float(((cos2 - 0.5) * 2 * w).sum() / (w.sum() + 1e-3))
fits = json.load(open(f"{SRC}/fits.json"))
comps = {c["id"]: c for c in json.load(open(f"{PUB}/index.json"))["compounds"]}
if MODE == "sheets":
    OUT = sys.argv[4]; os.makedirs(OUT, exist_ok=True)
    kinds = set(arg("--kinds", "rough,cover").split(",")); per = int(arg("--per", "6"))
    ids = [int(x) for x in arg("--ids").split(",")] if arg("--ids") else sorted(int(k) for k, f in fits.items() if f["kind"] in kinds)
    cands_all, rows, page = {}, [], 0
    def flush():
        global rows, page
        if not rows: return
        page += 1; cv2.imwrite(f"{OUT}/sheet_{page:02d}.jpg", np.vstack(rows), [cv2.IMWRITE_JPEG_QUALITY, 82]); rows = []
    T = 260
    for i, cid in enumerate(ids):
        c, f = comps.get(cid), fits.get(str(cid))
        if not c or not f or not c.get("plan"): continue
        im = cv2.imread(f"{PUB}/img/{cid}.webp")
        if im is None: continue
        IMH, IMW = im.shape[:2]
        sat, to_px = satellite(c["bounds"])
        ring_px = np.array([to_px(p) for p in c["ring"]], np.int32)
        mask = np.zeros(sat.shape[:2], np.uint8); cv2.fillPoly(mask, [ring_px], 1); maskb = mask.astype(bool)
        box = content_box(im); full = (0, 0, IMW, IMH); ax = axis_deg(c["ring"])
        cands = {"now": (f["corners"], f["clip"])}
        for d in (0, 90, 180, 270):
            cands[f"n{d}"] = place(c["ring"], full, d)
            if box != full: cands[f"c{d}"] = place(c["ring"], box, d)
            cands[f"a{d}"] = place(c["ring"], box, (ax + d) % 360)
        scored = []
        for name, (corners, clip) in cands.items():
            over, _ = warp(im, corners, to_px, sat.shape[0])
            scored.append((score(sat, over, maskb), name, over))
        scored.sort(key=lambda t: -t[0])
        now = next(t for t in scored if t[1] == "now")
        built = float(grad(cv2.cvtColor(sat, cv2.COLOR_BGR2GRAY))[2][maskb].mean()) if maskb.any() else 0
        cands_all[cid] = {"name": c["name"], "kind": f["kind"], "built": round(built, 1),
                          "scores": {n: round(s, 3) for s, n, _ in scored}, "box": list(box), "axis": round(ax, 1),
                          "place": {n: {"corners": v[0], "clip": v[1]} for n, v in cands.items()}}
        def panel(over, label):
            p = sat.copy()
            if over is not None:
                m3 = np.repeat(mask[..., None], 3, 2).astype(bool); p[m3] = (0.85 * over[m3] + 0.15 * p[m3]).astype(np.uint8)
            cv2.polylines(p, [ring_px], True, (255, 0, 255), 2)
            p = cv2.resize(p, (T, T)); cv2.rectangle(p, (0, 0), (T, 18), (0, 0, 0), -1)
            cv2.putText(p, label, (4, 13), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (255, 255, 255), 1); return p
        best = [t for t in scored if t[1] != "now"][:3]
        thumb = cv2.resize(im, (T, round(T * IMH / IMW)) if IMW >= IMH else (round(T * IMW / IMH), T))
        tp = np.full((T, T, 3), 40, np.uint8); tp[:thumb.shape[0], :thumb.shape[1]] = thumb
        cv2.putText(tp, f"{cid} {c['name'][:22]}", (4, T - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (0, 255, 255), 1)
        row = [tp, panel(None, f"sat built {built:.0f}"), panel(now[2], f"now {f['kind']} {now[0]:.2f}")] + [panel(o, f"{n} {s:.2f}") for s, n, o in best]
        rows.append(np.hstack(row))
        if len(rows) == per: flush()
        print(i + 1, len(ids), cid, c["name"], f"now {now[0]:.2f} best {best[0][1]} {best[0][0]:.2f}", flush=True)
    flush()
    old = json.load(open(f"{OUT}/candidates.json")) if os.path.exists(f"{OUT}/candidates.json") else {}
    old.update({str(k): v for k, v in cands_all.items()}); json.dump(old, open(f"{OUT}/candidates.json", "w"))
