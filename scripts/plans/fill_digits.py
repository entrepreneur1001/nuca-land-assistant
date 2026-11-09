"""Fill plot numbers OCR could not read by template-matching the digit glyphs against digits read elsewhere on the
same plan (same font/size). Updates <plots.json> in place: text set with "method": "tm".
usage: python3 fill_digits.py <zone.jpg> <plots.json> [--all]   (--all re-reads every polygon, for a consistency check)
"""
import sys, json, math, os
import numpy as np, cv2
src, pj = sys.argv[1], sys.argv[2]
img = cv2.imread(src); d = json.load(open(pj)); polys = d["plots"]
hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
red_all = cv2.bitwise_or(cv2.inRange(hsv, (0, 60, 60), (15, 255, 255)), cv2.inRange(hsv, (165, 60, 60), (180, 255, 255)))
TS = (24, 32)
def glyphs(p):
    """Digit components inside the polygon, left→right in the plan's text direction (approximated by x)."""
    x, y, w, h = p["bbox"]; sub = red_all[y:y + h, x:x + w].copy()
    m = np.zeros(sub.shape, np.uint8); cv2.fillPoly(m, [np.array(p["poly"], np.int32) - [x, y]], 255); sub[m == 0] = 0
    sub = cv2.morphologyEx(sub, cv2.MORPH_CLOSE, np.ones((2, 2), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(sub, connectivity=8)
    comps = [(st[i, 0], st[i, 1], st[i, 2], st[i, 3], st[i, 4]) for i in range(1, n)]
    if not comps: return []
    hmax = max(c[3] for c in comps)
    comps = [c for c in comps if c[3] >= 0.55 * hmax and c[4] >= 12]  # drop specks (dashes, dots)
    comps.sort(key=lambda c: c[0])
    out = []
    for cx, cy, cw, ch, _ in comps:
        g = sub[cy:cy + ch, cx:cx + cw]
        out.append(cv2.resize(g, TS, interpolation=cv2.INTER_AREA).astype(np.float32) / 255)
    return out
templates = {}
for p in polys:
    t = p.get("text", "")
    if not t or p.get("conf", 0) < 0.8 or p.get("method") == "tm": continue
    gs = glyphs(p)
    if len(gs) != len(t): continue
    for ch, g in zip(t, gs): templates.setdefault(ch, []).append(g)
local_n = sum(len(v) for v in templates.values())
# A shared bank of glyphs from every plan (same font everywhere) backs plans whose own numbers are too small to read.
bank_f = sys.argv[sys.argv.index("--bank") + 1] if "--bank" in sys.argv else None
if bank_f and local_n < 200:
    bank = np.load(bank_f, allow_pickle=True).item()
    for ch, gs in bank.items(): templates.setdefault(ch, []).extend(gs)
if "--save-bank" in sys.argv:
    out = sys.argv[sys.argv.index("--save-bank") + 1]
    old = np.load(out, allow_pickle=True).item() if os.path.exists(out) else {}
    for ch, gs in templates.items(): old.setdefault(ch, []).extend(gs[:40])
    np.save(out, old); print(f"bank: {sum(len(v) for v in old.values())} glyphs"); sys.exit()
if sum(len(v) for v in templates.values()) < 20: print("too few templates"); sys.exit()
# a few prototypes per digit (mean + up to 5 samples) for NCC
protos = {}
for ch, gs in templates.items():
    protos[ch] = [np.mean(gs, axis=0)] + gs[:12]
def ncc(a, b):
    a = a - a.mean(); b = b - b.mean(); den = math.sqrt((a * a).sum() * (b * b).sum())
    return float((a * b).sum() / den) if den > 1e-6 else 0.0
def classify(g):
    best = max(((max(ncc(g, pr) for pr in prs), ch) for ch, prs in protos.items()))
    return best
filled = 0; agree = 0; checked = 0
for p in polys:
    if p.get("text") and "--all" not in sys.argv: continue
    gs = glyphs(p)
    if not gs or len(gs) > 4: continue
    res = [classify(g) for g in gs]
    if min(s for s, _ in res) < 0.6: continue
    txt = "".join(ch for _, ch in res)
    if p.get("text"):
        checked += 1; agree += txt == p["text"]
    else:
        p["text"], p["conf"], p["method"] = txt, round(min(s for s, _ in res), 3), "tm"; filled += 1
json.dump(d, open(pj, "w"))
print(f"{pj}: templates for digits {''.join(sorted(templates))}, filled {filled}" + (f", consistency {agree}/{checked}" if checked else ""))
