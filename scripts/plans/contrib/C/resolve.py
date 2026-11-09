"""Decide each polygon's plot number from the tile-OCR votes (read_tiles.py), the official plot list and structure
(numbers run consecutively along a row; every official number occurs once; polygon area ∝ official m²).
usage: python3 resolve.py <plots.json> <votes.json> <zone_plots.json> <reg.json> <zid> <out plots.json> [--fix fixes.json]
Sets per polygon: text, conf, method ("ocr" | "ocr+seq" | "sequence-inferred" | "manual" | ""), plus "why" diagnostics.
fixes.json: {"<zid>": [[x, y, "<number>"], ...]} — numbers read by eye; assigned to the polygon containing plan pixel x,y.
Numbers the official list carries twice (the same plot listed under two ids) are only assigned through fixes.json.
"""
import sys, json, math, collections
import numpy as np
pj, vj, zpf, regf, zid, outf = sys.argv[1:7]
fixes = json.load(open(sys.argv[sys.argv.index("--fix") + 1])).get(zid, []) if "--fix" in sys.argv else []
import cv2
d = json.load(open(pj)); polys = d["plots"]
_lab = np.full((d["height"] * 2, d["width"] * 2), -1, np.int32)
for _i, _p in enumerate(polys): cv2.fillPoly(_lab, [(np.array(_p["poly"], np.float32) * 2).astype(np.int32)], _i)
votes = {}
for _t in json.load(open(vj))["tokens"]:
    _y, _x = int(_t[4] * 2), int(_t[3] * 2)
    if 0 <= _y < _lab.shape[0] and 0 <= _x < _lab.shape[1] and _lab[_y, _x] >= 0: votes.setdefault(str(int(_lab[_y, _x])), []).append(_t)
zp = json.load(open(zpf))[zid]["plots"]; reg = json.load(open(regf))
norm = lambda s: s.strip().lstrip("0") or "0"
off_area = {}
for p in zp: off_area.setdefault(norm(p["no"]), []).append(p["area"])
official = {k for k, v in off_area.items() if len(v) == 1}   # numbers that occur twice cannot be placed by number
def parea(poly): return abs(sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(poly, poly[1:] + poly[:1]))) / 2
N = len(polys)
area = [parea(p["poly"]) * reg["scale_m_per_px"] ** 2 for p in polys]
cent = [np.mean(np.array(p["poly"], float), axis=0) for p in polys]; rad = [math.sqrt(max(parea(p["poly"]), 1)) for p in polys]
def near(i, j, f): return math.hypot(*(cent[i] - cent[j])) < f * (rad[i] + rad[j])
adj = {i: [j for j in range(N) if j != i and near(i, j, 0.75)] for i in range(N)}     # touching neighbours (same row or back-to-back)
# vote tallies: one vote per (variant, text) so overlapping tiles do not double count
tally = {}
for i in range(N):
    seen = set(); c = collections.Counter()
    for t, conf, var, *_ in votes.get(str(i), []):
        t = norm(t)
        if (var, t) in seen: continue
        seen.add((var, t)); c[t] += 1
    tally[i] = c
def share(i, t):
    """share of the votes, ignoring partial reads of t itself (a digit lost at either end)"""
    n = sum(c for u, c in tally[i].items() if not (len(u) < len(t) and u in t)); return tally[i][t] / n if n else 0.0
assign = {}; method = {}; why = {}
def seq_support(i, t, strict=False):
    """neighbours carrying t-1 / t+1 (assigned, or — when not strict — as their top vote)"""
    k = int(t); s = 0
    for j in adj[i]:
        tj = assign.get(j) or (None if strict or not tally[j] else tally[j].most_common(1)[0][0])
        if tj and tj.isdigit() and abs(int(tj) - k) == 1: s += 1
    return s
# area calibration from clear reads
def top(i): return tally[i].most_common(1)[0] if tally[i] else (None, 0)
ratios = [area[i] / off_area[top(i)[0]][0] for i in range(N) if top(i)[0] in official and share(i, top(i)[0]) >= 0.8 and top(i)[1] >= 4]
cal = float(np.median(ratios)) if ratios else 1.15; sd = float(np.std([r / cal for r in ratios])) if ratios else 0.1
def area_dev(i, t): return area[i] / cal / off_area[t][0] - 1
ATOL = max(0.12, 3 * min(sd, 0.08))
# pass 1: strong reads
order = sorted(range(N), key=lambda i: -(top(i)[1] * share(i, top(i)[0]) if tally[i] else 0))
taken = {}
def give(i, t, m, w):
    assign[i] = t; method[i] = m; why[i] = w; taken[t] = i
for i in order:
    t, n = top(i)
    if t is None or t not in official: continue
    sh = share(i, t); ss = seq_support(i, t); ad = abs(area_dev(i, t))
    rivals = [j for j in range(N) if j != i and tally[j] and (top(j)[0] == t or (tally[j][t] >= 4 and t not in top(j)[0]))]
    # the area test is strict for reads that stand alone and loose (drawing/segmentation tolerance) for reads that the
    # neighbouring numbers confirm
    ok = (n >= 5 and sh >= 0.75 and ss >= 1 and ad <= 0.35 and not rivals) or (n >= 3 and sh >= 0.6 and ss >= 1 and ad <= ATOL) \
        or (n >= 5 and sh >= 0.75 and ad <= max(ATOL, 0.2) and not rivals)
    if ok and t not in taken: give(i, t, "ocr", f"votes {n} share {sh:.2f} seq {ss} area {area_dev(i, t):+.2f}")
# pass 2: weaker reads confirmed by an assigned neighbour's number (strict sequence), iterated
changed = True
while changed:
    changed = False
    for i in range(N):
        if i in assign or not tally[i]: continue
        cands = [(c, t) for t, c in tally[i].items() if t in official and t not in taken and seq_support(i, t, True) >= 1 and abs(area_dev(i, t)) <= ATOL]
        cands.sort(reverse=True)
        if not cands: continue
        c, t = cands[0]
        if len(cands) > 1 and cands[1][0] * 2 > c: continue        # two plausible readings: leave
        if c < 2 and seq_support(i, t, True) < 2: continue
        give(i, t, "ocr+seq", f"votes {c}/{sum(tally[i].values())} seqA {seq_support(i, t, True)} area {area_dev(i, t):+.2f}"); changed = True
# pass 3: no usable read — the only free official number that sits between two assigned neighbours (n-1 and n+1)
changed = True
while changed:
    changed = False
    for i in range(N):
        if i in assign: continue
        nb = {int(assign[j]) for j in adj[i] if j in assign}
        cands = [str(k) for k in {a + 1 for a in nb} if k - 1 in nb and k + 1 in nb and str(k) in official and str(k) not in taken and abs(area_dev(i, str(k))) <= ATOL]
        if len(cands) != 1: continue
        t = cands[0]
        others = [j for j in range(N) if j != i and j not in assign and {int(t) - 1, int(t) + 1} <= {int(assign[x]) for x in adj[j] if x in assign}]
        if others: continue
        give(i, t, "sequence-inferred", f"between {int(t)-1} and {int(t)+1}, area {area_dev(i, t):+.2f}, votes {dict(tally[i])}"); changed = True
for x, y, t in fixes:
    i = int(_lab[int(y * 2), int(x * 2)])
    if i < 0: print(f"  fix {t}@{x},{y}: no polygon there"); continue
    if i in assign: taken.pop(assign[i], None); assign.pop(i); method.pop(i)
    t = norm(t)
    if t in taken and taken[t] != i: j = taken[t]; assign.pop(j); method.pop(j); print(f"  fix: {t} moved from polygon {j} to {i}")
    give(i, t, "manual", "read by eye on an upscaled crop")
for i, p in enumerate(polys):
    p["text"] = assign.get(i, ""); p["method"] = method.get(i, ""); p["why"] = why.get(i, "")
    p["conf"] = round(share(i, assign[i]), 3) if i in assign else 0
    p["cands"] = [t for t, _ in tally[i].most_common(3)]
    p["area_dev"] = round(area_dev(i, assign[i]), 3) if i in assign and assign[i] in off_area else None
json.dump(d, open(outf, "w"))
mc = collections.Counter(method.values())
un = [i for i in range(N) if i not in assign]
print(f"{zid}: polygons {N}, official {len(zp)} (unique numbers {len(official)}), assigned {len(assign)} {dict(mc)}, unassigned {len(un)}; area cal {cal:.3f} sd {sd:.3f} tol {ATOL:.2f}")
for i in un: print(f"   poly {i} at {cent[i].round(0).tolist()} votes {dict(tally[i])} nb {[assign.get(j, '?') for j in adj[i]]} areadev {[(t, round(area_dev(i, t), 2)) for t, _ in tally[i].most_common(2) if t in official]}")
free = sorted((int(t) for t in official if t not in taken))
print(f"   official numbers without polygon ({len(free)}): {free}")
