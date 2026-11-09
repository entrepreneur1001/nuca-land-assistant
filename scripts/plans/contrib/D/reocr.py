"""Re-read the plot number of every polygon with several crop variants and both Western and Arabic-Indic digits.
usage: python3 reocr.py <zone.jpg> <plots.json> <out reads.json> [--lang ar|en|both]
Plans of some cities (New Assiut 3584, 10th of Ramadan 3600/3603/3604/3605) print the numbers in Arabic-Indic digits
(١٢٣), which the en-US recogniser turns into garbage; Apple Vision's ar-SA recogniser reads them.
Variants per polygon: masked colour crop and red-ink binarised crop, upright and deskewed by the polygon's own
orientation, x3 upscaled. Output: [{"votes": {"<number>": score}, "n": variants that read something}] per polygon.
Nothing is written to plots.json; identify.py combines these reads with the coordinate assignment.
"""
import sys, json, subprocess, os, tempfile, shutil, math
import cv2, numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
src, pj, outf = sys.argv[1:4]
lang = sys.argv[sys.argv.index("--lang") + 1] if "--lang" in sys.argv else "both"
img = cv2.imread(src); H, W = img.shape[:2]
polys = json.load(open(pj))["plots"]
AR = {ord(a): str(i) for i, a in enumerate("٠١٢٣٤٥٦٧٨٩")}; AR.update({ord(a): str(i) for i, a in enumerate("۰۱۲۳۴۵۶۷۸۹")})
tmp = tempfile.mkdtemp(); PAD = 14; UP = 3
def crop_for(p, binarise, ang):
    x, y, w, h = p["bbox"]; x0, y0, x1, y1 = max(0, x - 2), max(0, y - 2), min(W, x + w + 2), min(H, y + h + 2)
    c = img[y0:y1, x0:x1].copy()
    m = np.zeros(c.shape[:2], np.uint8); cv2.fillPoly(m, [np.array(p["poly"], np.int32) - [x0, y0]], 255)
    m = cv2.erode(m, np.ones((3, 3), np.uint8))
    c = cv2.resize(c, None, fx=UP, fy=UP, interpolation=cv2.INTER_CUBIC); m = cv2.resize(m, (c.shape[1], c.shape[0]), interpolation=cv2.INTER_NEAREST)
    if binarise:
        b, g, r = [c[:, :, i].astype(np.int32) for i in range(3)]
        ink = np.clip((r - g) * 2, 0, 255).astype(np.uint8)  # red digits on yellow: r high, g low
        ink[m == 0] = 0
        c = cv2.cvtColor(255 - ink, cv2.COLOR_GRAY2BGR)
    else:
        c[m == 0] = (255, 255, 255)
    c = cv2.copyMakeBorder(c, PAD * UP, PAD * UP, PAD * UP, PAD * UP, cv2.BORDER_CONSTANT, value=(255, 255, 255))
    if ang:
        hh, ww = c.shape[:2]; c = cv2.warpAffine(c, cv2.getRotationMatrix2D((ww / 2, hh / 2), ang, 1.0), (ww, hh), borderValue=(255, 255, 255))
    return c
def own_angle(p):
    (_, _), (rw, rh), a = cv2.minAreaRect(np.array(p["poly"], np.float32))
    a = a % 90
    return a - 90 if a > 45 else a
def run(binname, files):
    of = os.path.join(tmp, "o.json"); res = []
    for i in range(0, len(files), 150):
        subprocess.run([os.path.join(HERE, binname), of] + files[i:i + 150], check=True); res += json.load(open(of))
    return res
reads = [{"votes": {}, "n": 0} for _ in polys]
variants = []
for binarise in (0, 1):
    for mode in ("up", "own"):
        files, idx = [], []
        for k, p in enumerate(polys):
            a = 0 if mode == "up" else own_angle(p)
            if mode == "own" and abs(a) < 4: continue
            f = os.path.join(tmp, f"{k}_{binarise}_{mode}.png"); cv2.imwrite(f, crop_for(p, binarise, a)); files.append(f); idx.append(k)
        variants.append((files, idx))
for binname in [b for b, l in (("ocr_files", "en"), ("ocr_files_ar", "ar")) if lang in (l, "both")]:
    for files, idx in variants:
        if not files: continue
        for k, obs in zip(idx, run(binname, files)):
            got = {}
            for o in obs:
                t = o["text"].strip().translate(AR).replace(" ", "")
                if not t or not t.isdigit() or len(t) > 4: continue
                t = t.lstrip("0") or "0"
                got[t] = max(got.get(t, 0), o["conf"])
            if got: reads[k]["n"] += 1
            for t, c in got.items():
                key = ("a:" if binname.endswith("_ar") else "e:") + t
                reads[k]["votes"][key] = round(reads[k]["votes"].get(key, 0) + c, 3)
shutil.rmtree(tmp)
json.dump(reads, open(outf, "w"))
print(f"{pj}: {sum(1 for r in reads if r['votes'])}/{len(polys)} polygons with at least one read")
