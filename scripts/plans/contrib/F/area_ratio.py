"""Area-ratio check: polygon px area x scale^2 vs official m2 (median over plots matched by plot_id or unique number).
usage: python3 area_ratio.py <plans dir> <reg dir> <zone_plots.json> <zid>...   -> ratio (~1.15 for a right scale) and implied scale."""
import sys, json, math, numpy as np
from collections import Counter
plans, reg, zpf = sys.argv[1:4]; zp = json.load(open(zpf))
def parea(p):
    p = np.array(p, float); x, y = p[:, 0], p[:, 1]; return abs(np.dot(x, np.roll(y, 1)) - np.dot(y, np.roll(x, 1))) / 2
for z in sys.argv[4:]:
    polys = json.load(open(f"{plans}/zone_{z}.plots.json"))["plots"]; r = json.load(open(f"{reg}/{z}.json")); s = r["scale_m_per_px"]
    byid = {p["id"]: p["area"] for p in zp[z]["plots"]}; cnt = Counter(p["no"] for p in zp[z]["plots"]); byno = {p["no"]: p["area"] for p in zp[z]["plots"] if cnt[p["no"]] == 1}
    rat = []
    for p in polys:
        a = byid.get(p.get("plot_id")) or byno.get((p.get("text") or "").lstrip("0"))
        if a: rat.append(parea(p["poly"]) / a)
    rat = np.array(rat); m = np.median(rat)
    print(f"{z}: n={len(rat)}/{len(polys)} scale {s:.4f} ratio {m*s*s:.3f} (iqr {np.percentile(rat,25)*s*s:.3f}-{np.percentile(rat,75)*s*s:.3f}); scale for ratio 1.15: {math.sqrt(1.15/m):.4f}  px2/m2 {m:.3f}")
