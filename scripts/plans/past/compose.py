"""Registrations of a project's zones from the project slide's placement: each zone plan is located inside the
slide (chain_slide.py) and inherits the slide's map position.
usage: python3 compose.py <work dir> <zones.tsv> <pid> <slide placement.json> <reg-past dir> [--cand i] [--slide file] [--min-score 0.45]
Writes <reg-past>/project_<pid>.json (the slide) and <reg-past>/<zid>.json per zone found:
{zid, pid, affine (zone image px → Web-Mercator metres), how, score, src: {w, h}}. Zones below --min-score are reported and skipped.
"""
import sys, json, os, subprocess, glob
import numpy as np
work, tsv, pid, placement, reg = sys.argv[1:6]
def opt(name, default=None): return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default
here = os.path.dirname(os.path.abspath(__file__)); os.makedirs(reg, exist_ok=True)
d = json.load(open(placement)); cand = d["candidates"][int(opt("--cand", "0"))]; M = np.array(cand["affine"])
slide = opt("--slide", d["image"]); min_score = float(opt("--min-score", "0.45"))
json.dump({"pid": int(pid), "slide": os.path.basename(slide), "affine": cand["affine"], "how": "osm-roads", "score": cand["score"], "scale_m_per_px": cand["scale"], "rotation_deg": cand["rot"]}, open(f"{reg}/project_{pid}.json", "w"))
for row in (l.rstrip("\n").split("\t") for l in open(tsv, encoding="utf-8") if l.strip()):
    zid = row[0]
    if row[1] != pid: continue
    zimg = f"{work}/plans/zone_{zid}.jpg"
    if not os.path.exists(zimg): print(zid, "not downloaded"); continue
    tmp = f"{work}/place/chain_{zid}.json"
    subprocess.run([sys.executable, f"{here}/chain_slide.py", zimg, slide, "--out", tmp], check=True, stdout=subprocess.DEVNULL)
    c = json.load(open(tmp))
    if c["score"] < min_score: print(zid, "NOT FOUND in slide, score", c["score"]); continue
    S = np.array([[c["f"], 0, c["x"]], [0, c["f"], c["y"]], [0, 0, 1]])
    A = (np.vstack([M, [0, 0, 1]]) @ S)[:2]
    src = json.load(open(zimg[:-4] + ".src.json")) if os.path.exists(zimg[:-4] + ".src.json") else {}
    json.dump({"zid": int(zid), "pid": int(pid), "affine": A.tolist(), "how": f"slide:{pid}", "score": c["score"], "src": {k: src.get(k) for k in ("w", "h", "level")}}, open(f"{reg}/{zid}.json", "w"))
    print(zid, "ok", c)
