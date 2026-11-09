"""Consistency audit of resolved plot numbers. usage: audit.py <plots.json> <zid> → prints polygons worth an eye check."""
import sys, json, math, numpy as np
d = json.load(open(sys.argv[1])); ps = d["plots"]; zid = sys.argv[2]
def parea(poly): return abs(sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(poly, poly[1:] + poly[:1]))) / 2
cent = [np.mean(np.array(p["poly"], float), axis=0) for p in ps]; rad = [math.sqrt(max(parea(p["poly"]), 1)) for p in ps]
flags = []
for i, p in enumerate(ps):
    if not p["text"]: continue
    nb = [j for j in range(len(ps)) if j != i and math.hypot(*(cent[i] - cent[j])) < 0.75 * (rad[i] + rad[j]) and ps[j]["text"]]
    seq = sum(abs(int(ps[j]["text"]) - int(p["text"])) == 1 for j in nb)
    why = []
    if nb and not seq: why.append("no ±1 neighbour")
    if p["method"] in ("sequence-inferred", "ocr+seq"): why.append(p["method"])
    if p["method"] == "ocr" and p["conf"] < 0.8: why.append(f"share {p['conf']}")
    if p.get("area_dev") is not None and abs(p["area_dev"]) > 0.2: why.append(f"area {p['area_dev']:+.2f}")
    if not nb and p["conf"] < 0.9: why.append("isolated, weak")
    if why: flags.append((i, p["text"], [round(float(c)) for c in cent[i]], why, p["cands"]))
print(zid, "flagged", len(flags), "of", sum(1 for p in ps if p["text"]))
json.dump(flags, open(f"audit_{zid}.json", "w"))
for f in flags: print("  ", f)
