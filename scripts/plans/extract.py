"""Extract offered-plot polygons (yellow fill) from a NUCA zone plan and OCR the plot number inside each.
usage: python3 extract.py <zone.jpg> <out.json> [--debug out.png]
Output: {"width", "height", "plots": [{"poly": [[x,y],...], "bbox": [x,y,w,h], "area_px", "text", "conf", "cands"}]}
"""
import sys, json, subprocess, os, tempfile, shutil, math
import cv2, numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
src, out = sys.argv[1], sys.argv[2]
dbg = sys.argv[sys.argv.index("--debug") + 1] if "--debug" in sys.argv else None
img = cv2.imread(src)
H, W = img.shape[:2]
hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
expect = int(sys.argv[sys.argv.index("--expect") + 1]) if "--expect" in sys.argv else None
# Yellow fill. The thin dark borders between plots blur into dark-yellow in the JPEG, so a strict saturation/value
# floor plus a small erosion separates neighbouring plots. The strictness is chosen per image: the combination whose
# component count lands closest to the zone's known plot count wins (ties → the gentler setting).
def components(s, v, k):
    m = cv2.inRange(hsv, (18, s, v), (40, 255, 255))
    if k: m = cv2.erode(m, np.ones((3, 3), np.uint8), iterations=k)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(m, connectivity=4)
    a = stats[1:, cv2.CC_STAT_AREA]
    big = a[a > 200]
    med = float(np.median(big)) if len(big) else (float(np.median(a)) if len(a) else 1.0)
    keep = [i for i in range(1, n) if stats[i, cv2.CC_STAT_AREA] >= max(120, med * 0.1)]
    return keep, labels, stats, med, k
best = None
for (s, v) in [(140, 205), (150, 215), (160, 225), (170, 235)]:
    for k in [0, 1, 2, 3]:
        r = components(s, v, k)
        score = abs(len(r[0]) - expect) if expect is not None else -len(r[0]) * 0  # without a target: first setting
        if best is None or score < best[0]: best = (score, (s, v, k), r)
        if expect is not None and score == 0: break
    if best[0] == 0: break
keep, labels, stats, med, ERODE = best[2]
print(f"settings S>={best[1][0]} V>={best[1][1]} erode{best[1][2]} → {len(keep)} components (expected {expect})")
plots = []
GROW = ERODE + 1  # undo the erosion so outlines sit on the drawn borders
CLOSE = max(9, int(round(W / 280)) | 1)  # closes the notch a plot number leaves when it touches the border
for i in keep:
    x, y, w, h, a = stats[i]
    if y < H * 0.1 and w > W * 0.2: continue  # the title bar
    comp = (labels[y:y + h, x:x + w] == i).astype(np.uint8)
    comp = cv2.copyMakeBorder(comp, CLOSE, CLOSE, CLOSE, CLOSE, cv2.BORDER_CONSTANT, value=0)
    # Fill holes (the red number sits inside the plot), grow back, take the outer contour.
    comp = cv2.morphologyEx(comp, cv2.MORPH_CLOSE, np.ones((CLOSE, CLOSE), np.uint8))
    comp = cv2.dilate(comp, np.ones((3, 3), np.uint8), iterations=GROW)
    cs, _ = cv2.findContours(comp, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    c = max(cs, key=cv2.contourArea)
    hull_area = cv2.contourArea(cv2.convexHull(c))
    eps = 0.012 * cv2.arcLength(c, True)
    poly = cv2.approxPolyDP(c, eps, True).reshape(-1, 2) + [x - CLOSE, y - CLOSE]
    bx, by, bw, bh = cv2.boundingRect(poly)
    plots.append({"poly": poly.tolist(), "bbox": [int(bx), int(by), int(bw), int(bh)], "area_px": int(cv2.contourArea(c)), "solidity": round(float(a) / max(hull_area, 1), 3)})
# OCR each plot alone: everything outside its polygon is painted white so neighbours' numbers cannot leak in.
# Apple Vision only reads text that is close to horizontal, so crops are deskewed by the plan's dominant
# orientation (from the polygon edges); the four right-angle variants are tried and the best one kept.
tmp = tempfile.mkdtemp()
PAD = 30
def dominant_angle():
    hist = np.zeros(90)
    for p in plots:
        poly = p["poly"]
        for (x0, y0), (x1, y1) in zip(poly, poly[1:] + poly[:1]):
            L = math.hypot(x1 - x0, y1 - y0)
            if L < 4: continue
            a = math.degrees(math.atan2(y1 - y0, x1 - x0)) % 90
            hist[int(a) % 90] += L
    hist = np.convolve(np.concatenate([hist[-2:], hist, hist[:2]]), np.ones(5) / 5, mode="valid")
    a = int(np.argmax(hist))
    return a - 90 if a >= 45 else a
def crops(indices, ang, binarise):
    files = []
    for k in indices:
        p = plots[k]; x, y, w, h = p["bbox"]; pad = 2
        x0, y0, x1, y1 = max(0, x - pad), max(0, y - pad), min(W, x + w + pad), min(H, y + h + pad)
        crop = img[y0:y1, x0:x1].copy()
        m = np.zeros(crop.shape[:2], np.uint8)
        cv2.fillPoly(m, [np.array(p["poly"], np.int32) - [x0, y0]], 255)
        if binarise:
            ch = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
            red = cv2.bitwise_or(cv2.inRange(ch, (0, 60, 60), (15, 255, 255)), cv2.inRange(ch, (165, 60, 60), (180, 255, 255)))
            red[m == 0] = 0
            crop = np.full(crop.shape, 255, np.uint8); crop[red > 0] = (0, 0, 0)
        else:
            m = cv2.erode(m, np.ones((3, 3), np.uint8))  # keep the dark border out of the crop
            crop[m == 0] = (255, 255, 255)
        crop = cv2.copyMakeBorder(crop, PAD, PAD, PAD, PAD, cv2.BORDER_CONSTANT, value=(255, 255, 255))
        ch_, cw_ = crop.shape[:2]
        Mr = cv2.getRotationMatrix2D((cw_ / 2, ch_ / 2), ang, 1.0)
        if ang: crop = cv2.warpAffine(crop, Mr, (cw_, ch_), borderValue=(255, 255, 255))
        p["_origin"] = [x0 - PAD, y0 - PAD]; p["_rot"] = cv2.invertAffineTransform(Mr).tolist()
        f = os.path.join(tmp, f"{k}_{int(binarise)}_{int(ang)}.png"); cv2.imwrite(f, crop); files.append(f)
    return files
def ocr(files):
    of = os.path.join(tmp, "ocr.json"); res = []
    for i in range(0, len(files), 200):  # keep argv short
        subprocess.run([os.path.join(HERE, "ocr_files"), of] + files[i:i + 200], check=True)
        res += json.load(open(of))
    return res
def read(indices, ang, binarise, store):
    """store[k] = (text, conf) best candidate for plot k at this angle."""
    for k, obs in zip(indices, ocr(crops(indices, ang, binarise))):
        p = plots[k]; ox, oy = p["_origin"]; Ri = np.array(p["_rot"])
        cx, cy = np.array(p["poly"], np.float32).mean(axis=0)
        cands = []
        for o in obs:
            txt = "".join(ch for ch in o["text"] if ch.isdigit())
            if not txt or len(txt) > 4 or len(txt) != len(o["text"].strip()): continue
            px, py = Ri @ np.array([o["cx"], o["cy"], 1.0])
            d = math.hypot(px + ox - cx, py + oy - cy)
            cands.append((d, -o["conf"], txt, round(o["conf"], 3)))
        cands.sort()
        if cands: store[k] = (cands[0][2], cands[0][3])
# Text is usually upright; when few plots read at 0°, the plan (and its numbers) is probably rotated: try more angles.
results = {}
every = list(range(len(plots)))
angles = [0]
st = {}; read(every, 0, False, st); results[0] = st
if len(st) < 0.9 * len(plots):
    for ang in (-15, 15, -30, 30, -45, 45, -60, 60):
        st = {}; read(every, ang, False, st); results[ang] = st; angles.append(ang)
best_ang = max(results, key=lambda a: len(results[a]))
print(f"text orientation: {best_ang}° (reads per angle: " + ", ".join(f"{a}°={len(results[a])}" for a in angles) + ")")
for p in plots: p["text"], p["conf"], p["cands"] = "", 0, []
for k, (txt, conf) in results[best_ang].items(): plots[k]["text"], plots[k]["conf"], plots[k]["cands"] = txt, conf, [txt]
# Fill gaps: the other angles, then a binarised pass at the best angle.
import collections
for ang in angles:
    if ang == best_ang: continue
    for k, (txt, conf) in results[ang].items():
        if not plots[k]["text"] and conf >= 0.5: plots[k]["text"], plots[k]["conf"], plots[k]["cands"] = txt, conf, [txt]
missing = [k for k, p in enumerate(plots) if not p["text"]]
if missing:
    st = {}; read(missing, best_ang, True, st)
    for k, (txt, conf) in st.items(): plots[k]["text"], plots[k]["conf"], plots[k]["cands"] = txt, conf, [txt]
for p in plots: p.pop("_rot", None)
for p in plots: p.pop("_origin", None)
shutil.rmtree(tmp)
json.dump({"width": W, "height": H, "plots": plots}, open(out, "w"))
nums = [p["text"] for p in plots if p["text"]]
dup = len(nums) - len(set(nums))
print(f"{os.path.basename(src)}: {len(plots)} plots, {len(nums)} with number, {dup} duplicate numbers, median px area {med:.0f}")
if dbg:
    vis = img.copy()
    for p in plots:
        cv2.polylines(vis, [np.array(p["poly"], np.int32)], True, (255, 0, 0), 2)
        x, y, w, h = p["bbox"]
        cv2.putText(vis, p["text"] or "?", (x, y + h), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 0, 0), 2)
    cv2.imwrite(dbg, vis)
