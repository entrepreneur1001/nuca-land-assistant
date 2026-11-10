"""Place a zone plan on the map by computer vision: the streets between the zone's own plots are correlated with
the city's road raster from Google's road map (gmap_city.py) over scale, rotation and position.
usage: python3 place_g.py <zone.jpg> <raster prefix> <out.json> [--scale lo,hi] [--rot a,b,step] [--near lat,lng,radius_m]
                          [--coarse 2] [--refine <placement.json> [--cand i]] [--top 5] [--preview out.jpg]
                          [--template streets.png,zone.png --scale lo,hi]
--template replaces the outlined-plot street template with masks made another way (street_mask.py), for drawings
whose plots cannot be outlined or whose zone is a small pocket; --scale is then required (no plot size to go by).
--scale is Web-Mercator metres per image pixel (default: from the plots' size on the drawing, ±45 %). --coarse shrinks the raster for a first pass.
--refine searches finely around an existing placement (scale ±5 %, rotation ±2.5°, ±60 m).
Writes {image, w, h, candidates: [{affine, score, scale, rot, centre}]}; affine is image px → Web-Mercator metres.
`ratio` on the first candidate is its score over the best score at a different place: under ~1.15 the match is not unique.
"""
import sys, json, math
import os
import numpy as np, cv2
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from zone_shape import zone_template
cv2.setNumThreads(2)
R = 6378137.0
def merc(lat, lng): return (math.radians(lng) * R, math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * R)
def opt(name, default=None): return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default
image, ras, out = sys.argv[1:4]
img = cv2.imread(image); H, W = img.shape[:2]
meta = json.load(open(ras + ".json")); city8 = np.load(ras + ".npy", mmap_mode="r")
coarse = int(opt("--coarse", "1")) if "--refine" not in sys.argv else 1
res = meta["res"] * coarse

if opt("--template"):
    sf, zf = opt("--template").split(","); streets, zone, side = cv2.imread(sf, 0), cv2.imread(zf, 0), None
    if "--refine" not in sys.argv and not opt("--scale"): sys.exit("--template needs --scale lo,hi")
else: streets, zone, side = zone_template(img)
if streets is None: print("no plots found in", image); json.dump({"image": image, "w": W, "h": H, "candidates": []}, open(out, "w")); sys.exit(0)

_city = {}
def city_window(u0, v0, u1, v1):
    """Float road raster for coarse-pixel window [u0,u1)×[v0,v1), roads thickened to a street's width. A whole-city
    search asks for (nearly) the same window at every scale: the raster is prepared once and sliced."""
    if "full" not in _city and (u1 - u0) * (v1 - v0) > 0.5 * CW * CH:
        _city["full"] = prep(0, 0, CW, CH)
    if "full" in _city: return _city["full"][v0:v1, u0:u1]
    return prep(u0, v0, u1, v1)
def prep(u0, v0, u1, v1):
    c = coarse; a = np.asarray(city8[v0 * c:v1 * c, u0 * c:u1 * c])
    a = cv2.dilate(a, np.ones((3, 3), np.uint8))
    if c > 1: a = cv2.resize(a, (u1 - u0, v1 - v0), interpolation=cv2.INTER_AREA)
    return cv2.GaussianBlur(a.astype(np.float32) / 255.0, (0, 0), 1.0)
CH, CW = city8.shape[0] // coarse, city8.shape[1] // coarse

def template(scale, rot):
    f = scale / res; th = math.radians(rot); c, s_ = math.cos(th) * f, math.sin(th) * f
    A = np.array([[c, s_, 0.0], [-s_, c, 0.0]])
    cor = np.array([[0, 0, 1], [W, 0, 1], [W, H, 1], [0, H, 1]], float) @ A.T
    mn = cor.min(0); A[:, 2] = -mn; tw, th_ = np.ceil(cor.max(0) - mn).astype(int) + 1
    t = cv2.warpAffine(streets, A, (int(tw), int(th_)), flags=cv2.INTER_AREA).astype(np.float32) / 255.0
    v = cv2.warpAffine(zone, A, (int(tw), int(th_)), flags=cv2.INTER_AREA).astype(np.float32) / 255.0
    # Crop to the zone's extent: the rest of the image carries no evidence.
    ys, xs = np.where(v > 0.5)
    if len(xs) < 50: return None
    x0, y0, x1, y1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
    A[:, 2] -= (x0, y0)
    return cv2.GaussianBlur(t[y0:y1, x0:x1], (0, 0), 1.0), v[y0:y1, x0:x1], A

def search(scales, rots, window, per=2):
    best = []
    for scale in scales:
        for rot in rots:
            tpl = template(scale, rot)
            if tpl is None: continue
            t, vf, A = tpl; th_, tw = t.shape
            x0, y0, x1, y1 = window(A)
            x0, y0 = max(0, x0), max(0, y0); x1, y1 = min(CW - tw, x1), min(CH - th_, y1)
            if x1 <= x0 or y1 <= y0: continue
            sub = city_window(x0, y0, x1 + tw, y1 + th_)
            n = float(vf.sum()); tz = (t - (t * vf).sum() / n) * vf; tn = math.sqrt(float((tz ** 2).sum()))
            if tn < 1e-6: continue
            # Mean and variance of the city patch are taken over the zone's shape only: what lies around the zone on
            # the drawing is not evidence either way.
            num = cv2.matchTemplate(sub, tz, cv2.TM_CCORR)
            s1 = cv2.matchTemplate(sub, vf, cv2.TM_CCORR); s2 = cv2.matchTemplate(sub * sub, vf, cv2.TM_CCORR)
            # Floor on the patch's contrast so that empty ground cannot win by a tiny denominator.
            den = np.sqrt(np.maximum(s2 - s1 * s1 / n, 0.02 * n)) * tn
            sc = num / den
            for _ in range(per):
                _, mx, _, loc = cv2.minMaxLoc(sc)
                best.append((float(mx), scale, rot, x0 + loc[0], y0 + loc[1], A.copy()))
                r = max(6, int(80 / res)); cv2.rectangle(sc, (loc[0] - r, loc[1] - r), (loc[0] + r, loc[1] + r), -1.0, -1)
    return best

def to_affine(A, u, v):
    return [[res * A[0, 0], res * A[0, 1], meta["x0"] + res * (A[0, 2] + u)], [-res * A[1, 0], -res * A[1, 1], meta["y1"] - res * (A[1, 2] + v)]]
def raster_of(x, y): return (x - meta["x0"]) / res, (meta["y1"] - y) / res

if "--refine" in sys.argv:
    prev = json.load(open(opt("--refine")))["candidates"][int(opt("--cand", "0"))]; M = np.array(prev["affine"])
    s0 = math.hypot(M[0, 0], M[1, 0]); r0 = math.degrees(math.atan2(M[1, 0], M[0, 0]))
    scales = [s0 * (1 + d / 100) for d in np.arange(-5, 5.01, 1)]; rots = [r0 + d for d in np.arange(-2.5, 2.51, 0.5)]
    def window(A):
        # Where the image origin's template offset lands for the previous placement, ± 60 m.
        u, v = raster_of(*(M @ np.array([W / 2, H / 2, 1.0]))); c = A @ np.array([W / 2, H / 2, 1.0]); r = 60 / res
        return int(u - c[0] - r), int(v - c[1] - r), int(u - c[0] + r), int(v - c[1] + r)
    cands = search(scales, rots, window, per=1)
else:
    # A plot is about 25 m across on the ground (29 Web-Mercator metres at this latitude): that fixes the scale to ±45 %.
    lo, hi = map(float, (opt("--scale") or f"{29 / side * 0.62},{29 / side * 1.45}").split(",")); n = max(1, int(math.ceil(math.log(hi / lo) / math.log(1.045))))
    scales = [lo * (hi / lo) ** (i / n) for i in range(n + 1)]
    a, b, st = map(float, opt("--rot", "0,0,1").split(",")); rots = list(np.arange(a, b + 1e-9, st))
    near = opt("--near")
    def window(A):
        if not near: return 0, 0, CW, CH
        lat, lng, rad = map(float, near.split(",")); u, v = raster_of(*merc(lat, lng)); c = A @ np.array([W / 2, H / 2, 1.0]); r = rad / res
        return int(u - c[0] - r), int(v - c[1] - r), int(u - c[0] + r), int(v - c[1] + r)
    cands = search(scales, rots, window)
cands.sort(key=lambda c: -c[0])
kept = []
for score, scale, rot, u, v, A in cands:
    aff = to_affine(A, u, v); c = np.array(aff) @ np.array([W / 2, H / 2, 1.0])
    if any(np.hypot(*(c - k["_c"])) < 120 for k in kept): continue
    kept.append({"affine": aff, "score": round(score, 4), "scale": round(scale, 4), "rot": round(float(rot), 2), "_c": c})
    if len(kept) >= int(opt("--top", "5")): break
for k in kept:
    x, y = k.pop("_c"); k["centre"] = [round(math.degrees(2 * math.atan(math.exp(y / R)) - math.pi / 2), 6), round(math.degrees(x / R), 6)]
if len(kept) > 1: kept[0]["ratio"] = round(kept[0]["score"] / max(kept[1]["score"], 1e-6), 3)
for k in kept: print(f"score {k['score']:.3f}  scale {k['scale']:.3f}  rot {k['rot']:6.1f}  centre {k['centre'][0]:.5f},{k['centre'][1]:.5f}" + (f"  ratio {k['ratio']}" if "ratio" in k else ""))
json.dump({"image": image, "w": W, "h": H, "candidates": kept}, open(out, "w"))
if opt("--preview") and kept:
    # The road raster drawn in red on the plan under the best placement.
    M = np.array(kept[0]["affine"]); full = meta["res"]
    # plan px → raster px (full resolution): invert for warp
    P = np.array([[M[0, 0] / full, M[0, 1] / full, (M[0, 2] - meta["x0"]) / full], [-M[1, 0] / full, -M[1, 1] / full, (meta["y1"] - M[1, 2]) / full]])
    cor = np.array([[0, 0, 1], [W, 0, 1], [W, H, 1], [0, H, 1]], float) @ P.T; mn = np.floor(cor.min(0)).astype(int) - 2; mx = np.ceil(cor.max(0)).astype(int) + 2
    mn = np.maximum(mn, 0); sub = np.asarray(city8[mn[1]:mx[1], mn[0]:mx[0]]); P[:, 2] -= mn
    roads = cv2.warpAffine(sub, P, (W, H), flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP)
    o = img.copy(); o[roads > 100] = (0.35 * o[roads > 100] + 0.65 * np.array([0, 0, 255])).astype(np.uint8)
    f = min(1.0, 1300 / max(H, W)); cv2.imwrite(opt("--preview"), cv2.resize(o, None, fx=f, fy=f, interpolation=cv2.INTER_AREA), [cv2.IMWRITE_JPEG_QUALITY, 82])
