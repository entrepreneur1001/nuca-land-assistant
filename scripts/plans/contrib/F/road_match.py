"""Match a plan's road network to graded (unpaved) roads in satellite imagery: normalised correlation of the plan's
road mask with a satellite 'roadness' map, searched over scale, rotation and translation.
usage: python3 road_match.py <plans dir> <zid> <sat.jpg (from sat2.py --nogrid)> <centre merc x,y> <res m/px> [--scales a:b:step] [--rots a:b:step]
       [--feat sat|dark|both] [--win x0,y0,x1,y1 (plan px region used)] [--near ex,ny,radius (merc offset of the plan-window centre from the image centre)]
Prints the best candidates as px->Mercator affines. Road mask: the plan's grey road surface (+ the faded surroundings)."""
import sys, json, math, numpy as np, cv2
plans, zid, satf = sys.argv[1:4]; cx, cy = map(float, sys.argv[4].split(",")); res = float(sys.argv[5])
def opt(k, d): return sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
def rng(s): a, b, st = map(float, s.split(":")); return np.arange(a, b + 1e-9, st)
scales = rng(opt("--scales", "1.10:1.30:0.02")); rots = rng(opt("--rots", "-3:3:1")); feat = opt("--feat", "sat")
img = cv2.imread(f"{plans}/zone_{zid}.jpg"); H, W = img.shape[:2]
hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
road = ((hsv[..., 1] < 22) & (hsv[..., 2] > 150) & (hsv[..., 2] < 236)).astype(np.float32)
valid = np.ones((H, W), np.float32)
g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY); rows = (g < 120).mean(1) > 0.5; valid[rows, :] = 0; valid[:int(H * 0.1), int(W * 0.62):] = 0
blank = cv2.erode((g > 247).astype(np.uint8), np.ones((41, 41), np.uint8)); valid[blank > 0] = 0   # big empty page areas
if "--win" in sys.argv:
    x0, y0, x1, y1 = map(int, opt("--win", "").split(",")); v2 = np.zeros_like(valid); v2[y0:y1, x0:x1] = 1; valid *= v2
ys, xs = np.where(valid > 0); bx0, bx1, by0, by1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
road = road[by0:by1, bx0:bx1]; valid = valid[by0:by1, bx0:bx1]; h0, w0 = road.shape
sat = cv2.imread(satf); SH, SW = sat.shape[:2]
shsv = cv2.cvtColor(sat, cv2.COLOR_BGR2HSV).astype(np.float32); lab = cv2.cvtColor(sat, cv2.COLOR_BGR2LAB).astype(np.float32)
def hp(x, s=25): return x - cv2.GaussianBlur(x, (0, 0), s)
fs = hp(shsv[..., 1]) + hp(lab[..., 1]) * 2; fd = -hp(shsv[..., 2])
F = {"sat": fs, "dark": fd, "both": fs / fs.std() + fd / fd.std()}[feat]; F = cv2.GaussianBlur(F, (0, 0), 1.5).astype(np.float32); F = np.clip(F / F.std(), -3, 3)
near = [float(v) for v in opt("--near", "0,0,1e9").split(",")]
cands = []
for s in scales:
    f = s / res
    for r in rots:
        c, sn = math.cos(math.radians(r)), math.sin(math.radians(r))
        # plan px (cropped) -> template px: rotate by r (map convention: counter-clockwise positive; image y down)
        A = f * np.array([[c, sn], [-sn, c]]); pts = np.array([[0, 0], [w0, 0], [w0, h0], [0, h0]]) @ A.T; mn = pts.min(0)
        Mt = np.hstack([A, (-mn)[:, None]]).astype(np.float32); tw, th = np.ceil(pts.max(0) - mn).astype(int)
        if tw >= SW or th >= SH: continue
        T = cv2.warpAffine(road, Mt, (tw, th), flags=cv2.INTER_AREA); V = cv2.warpAffine(valid, Mt, (tw, th), flags=cv2.INTER_AREA)
        V = (V > 0.5).astype(np.float32); T = (T - (T * V).sum() / V.sum()) * V
        R = cv2.matchTemplate(F, T, cv2.TM_CCORR)  # sum F*T ; normalise by local F energy under V
        E = cv2.matchTemplate(F * F, V, cv2.TM_CCORR); Mn = cv2.matchTemplate(F, V, cv2.TM_CCORR)
        var = np.maximum(E - Mn * Mn / V.sum(), 1e-6); score = R / np.sqrt(var * (T * T).sum())
        # window-centre offset of each location from image centre (merc m)
        if near[2] < 1e8:
            yy, xx = np.mgrid[0:score.shape[0], 0:score.shape[1]]; ex = (xx + tw / 2 - SW / 2) * res; ny = (SH / 2 - (yy + th / 2)) * res
            score[(ex - near[0]) ** 2 + (ny - near[1]) ** 2 > near[2] ** 2] = -1
        for k in range(2):
            _, mx, _, loc = cv2.minMaxLoc(score)
            # full affine: plan px (uncropped) -> merc
            P2T = np.hstack([A, (-mn - A @ np.array([bx0, by0]) + np.array(loc))[:, None]])  # plan px -> sat px
            S = np.array([[res, 0, cx - SW / 2 * res], [0, -res, cy + SH / 2 * res]])
            M = S[:, :2] @ P2T; M[:, 2] += S[:, 2]
            cands.append((float(mx), float(s), float(r), M.tolist())); cv2.circle(score, loc, 40, -1, -1)
cands.sort(key=lambda c: -c[0])
for c in cands[:int(opt("--top", 12))]: print(f"score {c[0]:.4f} scale {c[1]:.3f} rot {c[2]:+.1f} affine {json.dumps(c[3])}")
json.dump([{"score": c[0], "scale": c[1], "rot": c[2], "affine": c[3]} for c in cands[:50]], open(opt("--out", "out/road_match.json"), "w"))
