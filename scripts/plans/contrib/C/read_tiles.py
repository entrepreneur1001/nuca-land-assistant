"""Read plot numbers on a low-resolution plan by OCR of upscaled overlapping tiles (several scales / renderings).
usage: python3 read_tiles.py <zone.jpg> <plots.json> <votes.json>
votes.json: {"tokens": [[text, conf, variant, cx, cy, w, h], ...]} — every digit token read near the plots, in plan pixels
(the polygons are only used to choose which tiles to read; tokens are mapped to polygons later, by resolve.py).
"""
import sys, json, os, subprocess, tempfile, shutil
import cv2, numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
src, pj, outf = sys.argv[1:4]
img = cv2.imread(src); H, W = img.shape[:2]
polys = json.load(open(pj))["plots"]
label = np.full((H, W), -1, np.int32)
for i, p in enumerate(polys): cv2.fillPoly(label, [np.array(p["poly"], np.int32)], i)
def render(mode, s):
    if mode == "col":
        return cv2.resize(img, None, fx=s, fy=s, interpolation=cv2.INTER_LANCZOS4)
    if mode == "cub":
        return cv2.resize(img, None, fx=s, fy=s, interpolation=cv2.INTER_CUBIC)
    # "red": darkness of the red ink on yellow = low green channel relative to red; grey image, black text on white
    b, g, r = [c.astype(np.float32) for c in cv2.split(img)]
    ink = np.clip((r - g) / np.maximum(r, 1), 0, 1)  # yellow → 0, red → ~0.8
    ink[(r < 150)] = 0  # dark borders are not ink
    gimg = (255 * (1 - np.clip(ink * 1.4, 0, 1))).astype(np.uint8)
    up = cv2.resize(gimg, None, fx=s, fy=s, interpolation=cv2.INTER_LANCZOS4)
    return cv2.cvtColor(up, cv2.COLOR_GRAY2BGR)
variants = [("col", 3), ("col", 4), ("col", 5), ("col", 6), ("col", 7), ("col", 8), ("cub", 4), ("cub", 5), ("cub", 6)]
if "--variants" in sys.argv: variants = [(v.split(":")[0], int(v.split(":")[1])) for v in sys.argv[sys.argv.index("--variants") + 1].split(",")]
ys, xs = np.where(label >= 0); x0, x1, y0, y1 = xs.min() - 60, xs.max() + 60, ys.min() - 60, ys.max() + 60
label_d = cv2.dilate((label >= 0).astype(np.uint8), np.ones((121, 121), np.uint8))
votes = {}; alltok = []
tmp = tempfile.mkdtemp()
for vi, (mode, s) in enumerate(variants):
    up = render(mode, s)
    TW, TH = 1400, 1000; ox = (vi % 3) * 130; oy = (vi % 3) * 90   # shift the tiling per variant
    files, origins = [], []
    for ty in range(int(y0 * s) - oy, int(y1 * s), TH - 250):
        for tx in range(int(x0 * s) - ox, int(x1 * s), TW - 300):
            a, b = max(tx, 0), max(ty, 0)
            t = up[b:ty + TH, a:tx + TW]
            if t.shape[0] < 40 or t.shape[1] < 40: continue
            lab = label[int(b / s):int((ty + TH) / s) + 1, int(a / s):int((tx + TW) / s) + 1]
            if not label_d[int(b / s):int((ty + TH) / s) + 1, int(a / s):int((tx + TW) / s) + 1].any(): continue
            f = os.path.join(tmp, f"{vi}_{len(files)}.png"); cv2.imwrite(f, t); files.append(f); origins.append((a, b))
    res = []
    for i in range(0, len(files), 100):
        of = os.path.join(tmp, "o.json"); subprocess.run([os.path.join(HERE, "ocr_tokens"), of] + files[i:i + 100], check=True); res += json.load(open(of))
    n = 0
    for (a, b), obs in zip(origins, res):
        for o in obs:
            t = o["text"].replace("O", "0").replace("o", "0").replace("l", "1").replace("I", "1")
            if not t.isdigit() or len(t) > 4: continue
            cx = (a + o["x"] + o["w"] / 2) / s; cy = (b + o["y"] + o["h"] / 2) / s
            if not (0 <= cx < W and 0 <= cy < H): continue
            k = int(label[int(cy), int(cx)])
            alltok.append([t, round(o["conf"], 2), f"{mode}{s}", round(cx, 1), round(cy, 1), round(o["w"] / s, 1), round(o["h"] / s, 1)])
            if k < 0: continue
            votes.setdefault(k, []).append(alltok[-1]); n += 1
    for f in files: os.remove(f)
    print(f"{mode}x{s}: {len(files)} tiles, {n} digit tokens in polygons, polygons with a vote so far: {len(votes)}/{len(polys)}", flush=True)
shutil.rmtree(tmp)
json.dump({"tokens": alltok}, open(outf, "w"))
