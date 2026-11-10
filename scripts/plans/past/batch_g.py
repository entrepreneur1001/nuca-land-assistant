"""Place every downloaded earlier-stage zone plan with place_g.py: a whole-city search, a full-detail check of its
best candidates, then a fine refinement. Results go to <work>/place/zg_<zid>.json and a preview zg_<zid>.jpg
(Google's roads in red on the plan); nothing is written to reg-past — adopt.py does that after review.
usage: python3 batch_g.py <work dir> <zones.tsv> <raster prefix> [--jobs 5] [--only zid,zid] [--redo] [--seeded [--radius 2500]]
--seeded is a second pass: zones that were not clear are searched again around the clear zones of their project.
Prints one line per zone: zid, pid, score, ratio (best place over the next best), scale, rotation, centre.
"""
import sys, os, json, subprocess, math
from concurrent.futures import ThreadPoolExecutor
work, tsv, ras = sys.argv[1:4]
def opt(name, default=None): return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default
here = os.path.dirname(os.path.abspath(__file__)); PG = f"{here}/place_g.py"
only = set(opt("--only", "").split(",")) - {""}
rows = [l.rstrip("\n").split("\t") for l in open(tsv, encoding="utf-8") if l.strip()]
def run(args): return subprocess.run([sys.executable, PG] + args, capture_output=True, text=True)
def one(row):
    zid, pid = row[0], row[1]; img = f"{work}/plans/zone_{zid}.jpg"; res = f"{work}/place/zg_{zid}.json"
    if not os.path.exists(img) or (only and zid not in only): return None
    if os.path.exists(res) and "--redo" not in sys.argv: return json.load(open(res))
    g = f"{work}/place/zg_{zid}.glob.json"; run([img, ras, g, "--coarse", "2", "--top", "4"])
    cands = json.load(open(g))["candidates"] if os.path.exists(g) else []
    if not cands: out = {"zid": zid, "pid": pid, "score": 0, "ratio": 0}; json.dump(out, open(res, "w")); return out
    scored = []
    for i, c in enumerate(cands[:3]):
        f = f"{work}/place/zg_{zid}.c{i}.json"
        run([img, ras, f, "--near", f"{c['centre'][0]},{c['centre'][1]},250", "--rot", "-6,6,3", "--scale", f"{c['scale'] * 0.93},{c['scale'] * 1.07}", "--top", "1"])
        d = json.load(open(f))["candidates"] if os.path.exists(f) else []
        if d: scored.append((d[0]["score"], f))
    if not scored: out = {"zid": zid, "pid": pid, "score": 0, "ratio": 0}; json.dump(out, open(res, "w")); return out
    scored.sort(reverse=True); best = scored[0]
    fin = f"{work}/place/zg_{zid}.fin.json"; run([img, ras, fin, "--refine", best[1], "--preview", f"{work}/place/zg_{zid}.jpg"])
    c = json.load(open(fin))["candidates"][0]
    out = {"zid": zid, "pid": pid, "affine": c["affine"], "score": c["score"], "ratio": round(best[0] / scored[1][0], 3) if len(scored) > 1 else 9.0,
           "scale": c["scale"], "rot": c["rot"], "centre": c["centre"]}
    json.dump(out, open(res, "w")); return out
CLEAR = lambda r: r.get("score", 0) >= 0.4 and r.get("ratio", 0) >= 1.15
def seeded(row):
    """Second pass for a zone whose whole-city search was not clear: search at full detail around the zones of the
    same project that were clear (a project's zones adjoin each other)."""
    zid, pid = row[0], row[1]; img = f"{work}/plans/zone_{zid}.jpg"; res = f"{work}/place/zg_{zid}.json"
    if not os.path.exists(img) or not os.path.exists(res) or (only and zid not in only): return None
    r = json.load(open(res))
    if CLEAR(r) or pid not in seeds: return None
    lat, lng = seeds[pid]; f = f"{work}/place/zg_{zid}.seed.json"
    run([img, ras, f, "--near", f"{lat},{lng},{opt('--radius', '2500')}", "--rot", "-9,9,3", "--top", "3"])
    d = json.load(open(f))["candidates"] if os.path.exists(f) else []
    if not d: return None
    fin = f"{work}/place/zg_{zid}.fin.json"; run([img, ras, fin, "--refine", f, "--preview", f"{work}/place/zg_{zid}.jpg"])
    c = json.load(open(fin))["candidates"][0]
    out = {"zid": zid, "pid": pid, "affine": c["affine"], "score": c["score"], "ratio": d[0].get("ratio", 9.0), "scale": c["scale"], "rot": c["rot"], "centre": c["centre"], "seeded": True}
    json.dump(out, open(res, "w")); return out
if "--seeded" in sys.argv:
    import statistics
    got = {}
    for row in rows:
        f = f"{work}/place/zg_{row[0]}.json"
        if os.path.exists(f):
            r = json.load(open(f))
            if CLEAR(r): got.setdefault(row[1], []).append(r["centre"])
    seeds = {pid: (statistics.median(c[0] for c in cs), statistics.median(c[1] for c in cs)) for pid, cs in got.items()}
    one = seeded
with ThreadPoolExecutor(int(opt("--jobs", "5"))) as ex:
    for r in ex.map(one, rows):
        if r: print(r["zid"], r["pid"], r.get("score"), r.get("ratio"), r.get("scale"), r.get("rot"), r.get("centre"), flush=True)
