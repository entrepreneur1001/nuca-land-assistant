"""Align each placed master plan to what is actually on the ground: the plan is moved, turned, scaled and slightly
stretched (within limits around its current placement) until its streets and buildings sit on those of the satellite
image, by edge direction agreement. Where the site is still empty desert nothing can be matched, and the placement
is kept as it is ("not built").
usage: python3 align.py <fetch dir> <public/compounds> <out dir> [--ids a,b] [--jobs 6] [--cands review candidates.json]
Starts from the current placement and, with --cands, from review.py's alternatives too (trimmed, turned, aligned).
Writes <out>/aligned.json {id: {score0, score, built, corners, clip, changed}} and <out>/sheet_NN.jpg (plan, satellite,
before, after, per compound). A result judged right by eye is applied by copying its corners and clip into
scripts/compounds/reviewed.json (with check "ground"). Superseded by place_compound.py / loop.py (Google road map).
"""
import sys, os, json, math, time
from urllib.request import Request, urlopen
from multiprocessing import Pool
import numpy as np, cv2
SRC, PUB, OUT = sys.argv[1:4]
def arg(n, d=None): return sys.argv[sys.argv.index(n) + 1] if n in sys.argv else d
R = 6378137.0; HALF = math.pi * R; TILES = f"{SRC}/tiles"; PX = 640
def merc(lat, lng): return (math.radians(lng) * R, math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * R)
def unmerc(x, y): return [round(math.degrees(2 * math.atan(math.exp(y / R)) - math.pi / 2), 6), round(math.degrees(x / R), 6)]
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
    """Square satellite view around bounds; returns image, metres-per-pixel frame (x0, y0 top-left merc, res)."""
    (s, w), (n, e) = bounds; x0, y0 = merc(s, w); x1, y1 = merc(n, e)
    span = max(x1 - x0, y1 - y0) * 1.4; cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    z = max(10, min(18, int(math.log2(2 * HALF * PX / (256 * span))) + 1))
    nt = 2 ** z; res = 2 * HALF / nt / 256
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
    k = span / PX
    return img, (cx - span / 2, cy + span / 2, k)
def grad(g):
    g = cv2.GaussianBlur(g, (0, 0), 1.2).astype(np.float32)
    gx, gy = cv2.Sobel(g, cv2.CV_32F, 1, 0), cv2.Sobel(g, cv2.CV_32F, 0, 1); return gx, gy, np.hypot(gx, gy)
def align_one(cid):
    try:
        comps = {c["id"]: c for c in json.load(open(f"{PUB}/index.json"))["compounds"]}
        c = comps[cid]; plan = c["plan"]
        im = cv2.imread(f"{PUB}/img/{cid}.webp"); H, W = im.shape[:2]
        sat, (fx0, fy0, k) = satellite(c["bounds"])
        def ll_px(ll): x, y = merc(*ll); return ((x - fx0) / k, (fy0 - y) / k)
        def px_ll(p): return unmerc(fx0 + p[0] * k, fy0 - p[1] * k)
        ring = np.float32([ll_px(p) for p in c["ring"]])
        omask = np.zeros((PX, PX), np.uint8); cv2.fillPoly(omask, [np.round(ring).astype(np.int32)], 1)
        region = cv2.dilate(omask, np.ones((25, 25), np.uint8)).astype(bool)
        sg = grad(cv2.cvtColor(sat, cv2.COLOR_BGR2GRAY)); sm = np.minimum(sg[2] / (np.percentile(sg[2][region], 90) + 1e-3), 1)
        inside = omask.astype(bool)
        built = float(sg[2][inside].mean()) if inside.any() else 0.0
        texture = float(np.percentile(sg[2][inside], 75)) if inside.any() else 0.0
        def affine(corners): return cv2.getAffineTransform(np.float32([[0, 0], [W, 0], [0, H]]), np.float32([ll_px(corners[q]) for q in ("tl", "tr", "bl")]))
        M0 = affine(plan["corners"])
        starts = [("now", M0)] + [(n, affine(v["corners"])) for n, v in CANDS.get(str(cid), {}).get("place", {}).items() if n != "now"]
        gray = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY); valid = np.full((H, W), 255, np.uint8)
        clip_px = np.int32(plan["clip"]); pm = np.zeros((H, W), np.uint8); cv2.fillPoly(pm, [clip_px], 255)
        valid = cv2.dilate(pm, np.ones((max(3, W // 25), max(3, W // 25)), np.uint8))  # the plan around its site
        cen = ring.mean(0); size = math.sqrt(max(1.0, float(omask.sum())))
        def M_of(p, base):
            dx, dy, th, ls, la, sh = p; s, a = math.exp(ls), math.exp(la)
            A = np.array([[s * a, sh * s], [0, s / a]]) @ np.array([[math.cos(th), -math.sin(th)], [math.sin(th), math.cos(th)]])
            T = np.eye(3); T[:2, :2] = A; T[:2, 2] = cen + np.array([dx, dy]) - A @ cen
            return (T @ np.vstack([base, [0, 0, 1]]))[:2]
        def score(p, base):
            M = M_of(p, base)
            g = cv2.warpAffine(gray, M, (PX, PX), flags=cv2.INTER_AREA); v = cv2.warpAffine(valid, M, (PX, PX)) > 0
            pg = grad(g); reg = region & v
            if reg.sum() < 400: return -1.0
            pmg = np.minimum(pg[2] / (np.percentile(pg[2][reg], 90) + 1e-3), 1)
            cos2 = ((sg[0] * pg[0] + sg[1] * pg[1]) / (sg[2] * pg[2] + 1e-3)) ** 2
            w = sm * pmg * reg
            cover = (inside & v).sum() / max(1, inside.sum())
            return float(((cos2 - 0.5) * 2 * w).sum() / (w.sum() + 1e-3)) - 2 * max(0.0, 0.9 - cover)
        lim = [0.2 * size, 0.2 * size, math.radians(15), math.log(1.6), math.log(1.2), 0.1]
        s0 = score([0] * 6, M0); best_p, best, best_base, start = [0.0] * 6, s0, M0, "now"
        if texture > 25:  # something built to match
            # the three most promising starts, each: coarse rotation/shift/scale sweep, then coordinate descent
            ranked = sorted(starts, key=lambda t: -max(score([0, 0, 0, ls, 0, 0], t[1]) for ls in (-0.3, 0, 0.3)))[:3]
            for name, base in ranked:
                bp, bv = [0.0] * 6, score([0] * 6, base)
                for th in np.radians(np.arange(-15, 15.1, 5)):
                    for ls in (-0.35, -0.15, 0, 0.15, 0.35):
                        for dx in np.linspace(-lim[0], lim[0], 3):
                            for dy in np.linspace(-lim[1], lim[1], 3):
                                p = [dx, dy, th, ls, 0, 0]; v = score(p, base)
                                if v > bv: bv, bp = v, p
                steps = [0.05 * size, 0.05 * size, math.radians(3), 0.06, 0.03, 0.02]
                for _ in range(7):
                    improved = True
                    while improved:
                        improved = False
                        for i in range(6):
                            for d in (-1, 1):
                                p = list(bp); p[i] = max(-lim[i], min(lim[i], p[i] + d * steps[i])); v = score(p, base)
                                if v > bv + 1e-4: bv, bp, improved = v, p, True
                    steps = [x / 2 for x in steps]
                if bv > best: best, best_p, best_base, start = bv, bp, base, name
        M = M_of(best_p, best_base)
        corners = {q: px_ll(M @ np.array([x, y, 1.0])) for q, (x, y) in (("tl", (0, 0)), ("tr", (W, 0)), ("bl", (0, H)))}
        Mi = cv2.invertAffineTransform(M)
        clip = [[round(float(v)) for v in Mi @ np.array([x, y, 1.0])] for x, y in ring]
        changed = best > s0 + 0.03
        def panel(Mx, label):
            p = sat.copy()
            if Mx is not None:
                ov = cv2.warpAffine(im, Mx, (PX, PX), flags=cv2.INTER_AREA); m3 = np.repeat(omask[..., None], 3, 2).astype(bool)
                p[m3] = (0.6 * ov[m3] + 0.4 * p[m3]).astype(np.uint8)
            cv2.polylines(p, [np.round(ring).astype(np.int32)], True, (255, 0, 255), 2)
            p = cv2.resize(p, (300, 300)); cv2.rectangle(p, (0, 0), (300, 18), (0, 0, 0), -1)
            cv2.putText(p, label, (4, 13), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (255, 255, 255), 1); return p
        th = cv2.resize(im, (300, round(300 * H / W)) if W >= H else (round(300 * W / H), 300))
        tp = np.full((300, 300, 3), 40, np.uint8); tp[:th.shape[0], :th.shape[1]] = th
        cv2.putText(tp, f"{cid} {c['name'][:24]}", (4, 292), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 255, 255), 1)
        row = np.hstack([tp, panel(None, f"satellite  texture {texture:.0f}"), panel(M0, f"before {s0:.2f}"), panel(M if changed else M0, f"after {best:.2f} from {start}" + ("" if changed else " (kept)"))])
        cv2.imwrite(f"{OUT}/rows/{cid}.jpg", row, [cv2.IMWRITE_JPEG_QUALITY, 85])
        return cid, {"name": c["name"], "score0": round(s0, 3), "score": round(best, 3), "texture": round(texture, 1), "built": round(built, 1),
                     "changed": bool(changed), "start": start, "corners": corners, "clip": clip, "p": [round(float(x), 4) for x in best_p]}
    except Exception as e:
        return cid, {"error": repr(e)}
CANDS = json.load(open(arg("--cands"))) if arg("--cands") else {}
if __name__ == "__main__":
    os.makedirs(f"{OUT}/rows", exist_ok=True)
    comps = json.load(open(f"{PUB}/index.json"))["compounds"]
    ids = [int(x) for x in arg("--ids").split(",")] if arg("--ids") else [c["id"] for c in comps if c.get("plan")]
    res = json.load(open(f"{OUT}/aligned.json")) if os.path.exists(f"{OUT}/aligned.json") else {}
    todo = [i for i in ids if str(i) not in res or "error" in res[str(i)]]
    with Pool(int(arg("--jobs", "6"))) as pool:
        for n, (cid, r) in enumerate(pool.imap_unordered(align_one, todo), 1):
            res[str(cid)] = r; print(n, len(todo), cid, r.get("name"), r.get("score0"), "->", r.get("score"), "changed" if r.get("changed") else "", r.get("error", ""), flush=True)
            if n % 20 == 0: json.dump(res, open(f"{OUT}/aligned.json", "w"))
    json.dump(res, open(f"{OUT}/aligned.json", "w"))
