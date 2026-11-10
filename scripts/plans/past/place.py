"""Place a plan drawing (project slide or zone plan) on the map by correlating its street pattern with the
city's OpenStreetMap road raster (osm_city.py) over scale, rotation and position. For built-up districts, whose
streets are in OpenStreetMap; no plot coordinates are needed.
usage: python3 place.py <image> <osm prefix> <out.json> --scale lo,hi [--rot a,b,step] [--mask dark|mid|light|white|all]
                        [--near lat,lng,radius_m] [--refine <placement.json> [--cand i]] [--top 5]
--scale is Mercator metres per image pixel (ground metres / cos(lat)). --refine searches a small neighbourhood of
an existing placement instead (scale ±8 %, rotation ±4°, ±150 m).
Writes {image, w, h, candidates: [{affine, score, scale, rot, mask}]}: affine is image px → Web-Mercator metres.
The best score alone proves nothing: check the runner-up ratio and look at the overlay (overlay.py).
"""
import sys, json, math
import numpy as np, cv2
R = 6378137.0
def merc(lat, lng): return (math.radians(lng) * R, math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * R)
def opt(name, default=None): return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default
image, osm, out = sys.argv[1:4]
img = cv2.imread(image); H, W = img.shape[:2]
meta = json.load(open(osm + ".json")); city = np.load(osm + ".npy").astype(np.float32) / 255.0; res = meta["res"]
city = cv2.GaussianBlur(city, (0, 0), 1.2)

def road_masks(img):
    """Street-coloured pixels under the drawing styles the plans use (asphalt grey, mid grey, pale grey, white)."""
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV); s, v = hsv[..., 1], hsv[..., 2]
    m = {"dark": (s < 60) & (v > 35) & (v < 125), "mid": (s < 40) & (v >= 125) & (v < 200), "light": (s < 28) & (v >= 200) & (v < 238), "white": (s < 14) & (v >= 240)}
    out = {}
    k = max(3, int(round(min(H, W) / 250))) | 1
    for name, mask in m.items():
        mask = mask.astype(np.uint8) * 255
        # Streets are bands, not outlines or lettering: drop anything thinner than the kernel.
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((k, k), np.uint8))
        frac = mask.mean() / 255
        if 0.03 < frac < 0.6: out[name] = mask
    return out

masks = road_masks(img)
want = opt("--mask", "all")
if want != "all": masks = {k: v for k, v in masks.items() if k in want.split(",")}
top_n = int(opt("--top", "5"))

def template(mask, scale, rot):
    """The mask as it would lie on the city raster: (float template, validity, image px → template px matrix)."""
    f = scale / res; th = math.radians(rot); c, s_ = math.cos(th) * f, math.sin(th) * f
    A = np.array([[c, s_, 0.0], [-s_, c, 0.0]])  # counter-clockwise on a y-down raster
    cor = np.array([[0, 0, 1], [W, 0, 1], [W, H, 1], [0, H, 1]], float) @ A.T
    mn = cor.min(0); A[:, 2] = -mn; tw, th_ = np.ceil(cor.max(0) - mn).astype(int) + 1
    t = cv2.warpAffine(mask, A, (int(tw), int(th_)), flags=cv2.INTER_AREA).astype(np.float32) / 255.0
    valid = cv2.warpAffine(np.full((H, W), 255, np.uint8), A, (int(tw), int(th_)), flags=cv2.INTER_NEAREST) > 0
    return cv2.GaussianBlur(t, (0, 0), 1.2), valid, A

def search(mask, scales, rots, window):
    """window: (x0, y0, x1, y1) in city raster px that the template's top-left may take, clipped to the raster."""
    best = []
    for scale in scales:
        for rot in rots:
            t, valid, A = template(mask, scale, rot); th_, tw = t.shape
            x0, y0, x1, y1 = window(tw, th_)
            x0, y0 = max(0, x0), max(0, y0); x1, y1 = min(city.shape[1] - tw, x1), min(city.shape[0] - th_, y1)
            if x1 <= x0 or y1 <= y0: continue
            sub = city[y0:y1 + th_, x0:x1 + tw]
            n = valid.sum(); tz = np.where(valid, t - t[valid].mean(), 0).astype(np.float32); tn = math.sqrt(float((tz ** 2).sum()))
            if tn < 1e-6: continue
            vf = valid.astype(np.float32)
            num = cv2.matchTemplate(sub, tz, cv2.TM_CCORR)
            s1 = cv2.matchTemplate(sub, vf, cv2.TM_CCORR); s2 = cv2.matchTemplate(sub * sub, vf, cv2.TM_CCORR)
            # Floor on the city patch's contrast: an almost empty patch (desert, the raster's edge) otherwise divides a
            # tiny numerator by a tiny denominator and wins.
            den = np.sqrt(np.maximum(s2 - s1 * s1 / n, 0.03 * n)) * tn
            sc = num / den
            # A few separated peaks per (scale, rot) so the runner-up is a different place, not the same hill.
            for _ in range(2):
                _, mx, _, loc = cv2.minMaxLoc(sc)
                best.append((float(mx), scale, rot, x0 + loc[0], y0 + loc[1], A.copy()))
                r = max(8, int(60 / res)); cv2.rectangle(sc, (loc[0] - r, loc[1] - r), (loc[0] + r, loc[1] + r), -1.0, -1)
    return best

def to_affine(A, u, v):
    """image px → Mercator metres, for a template whose top-left sits at raster (u, v)."""
    return [[res * A[0, 0], res * A[0, 1], meta["x0"] + res * (A[0, 2] + u)], [-res * A[1, 0], -res * A[1, 1], meta["y1"] - res * (A[1, 2] + v)]]

cands = []
if "--refine" in sys.argv:
    prev = json.load(open(opt("--refine")))["candidates"][int(opt("--cand", "0"))]; M = np.array(prev["affine"])
    s0 = math.hypot(M[0, 0], M[1, 0]); r0 = math.degrees(math.atan2(M[1, 0], M[0, 0]))
    scales = [s0 * (1 + d / 100) for d in range(-8, 9, 2)]; rots = [r0 + d / 2 for d in range(-8, 9, 2)]
    cx, cy = M @ np.array([W / 2, H / 2, 1.0])
    for name in ([prev["mask"]] if prev.get("mask") in masks else list(masks)):
        def window(tw, th_, cx=cx, cy=cy):
            u = (cx - meta["x0"]) / res - tw / 2; v = (meta["y1"] - cy) / res - th_ / 2; r = 150 / res
            return int(u - r), int(v - r), int(u + r), int(v + r)
        cands += [(b, name) for b in search(masks[name], scales, rots, window)]
else:
    lo, hi = map(float, opt("--scale").split(",")); n = max(1, int(math.ceil(math.log(hi / lo) / math.log(1.07))))
    scales = [lo * (hi / lo) ** (i / n) for i in range(n + 1)] if hi > lo else [lo]
    a, b, st = map(float, opt("--rot", "0,0,1").split(",")); rots = list(np.arange(a, b + 1e-9, st))
    near = opt("--near")
    for name, mask in masks.items():
        def window(tw, th_):
            if not near: return 0, 0, city.shape[1], city.shape[0]
            lat, lng, rad = map(float, near.split(",")); x, y = merc(lat, lng)
            u = (x - meta["x0"]) / res - tw / 2; v = (meta["y1"] - y) / res - th_ / 2; r = rad / res
            return int(u - r), int(v - r), int(u + r), int(v + r)
        cands += [(b, name) for b in search(mask, scales, rots, window)]
cands.sort(key=lambda c: -c[0][0])
# Distinct places only: a candidate within 150 m of a better one is the same answer.
kept = []
for (score, scale, rot, u, v, A), name in cands:
    aff = to_affine(A, u, v); c = np.array(aff) @ np.array([W / 2, H / 2, 1.0])
    if any(np.hypot(*(c - k["_c"])) < 150 for k in kept): continue
    kept.append({"affine": aff, "score": round(score, 4), "scale": round(scale, 4), "rot": round(float(rot), 2), "mask": name, "_c": c})
    if len(kept) >= top_n: break
for k in kept:
    x, y = k.pop("_c"); k["centre"] = [round(math.degrees(2 * math.atan(math.exp(y / R)) - math.pi / 2), 6), round(math.degrees(x / R), 6)]
    print(f"score {k['score']:.3f}  scale {k['scale']:.3f} m/px  rot {k['rot']:6.1f}  mask {k['mask']:5s}  centre {k['centre'][0]:.5f},{k['centre'][1]:.5f}")
json.dump({"image": image, "w": W, "h": H, "candidates": kept}, open(out, "w"))
