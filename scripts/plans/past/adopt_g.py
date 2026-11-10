"""Turn batch_g.py's results into registrations (reg-past/<zid>.json) for the zones whose placement is trusted:
- clear matches (score ≥ 0.4 and the best place ≥ 1.15 × the next best),
- zones accepted by eye from their preview (--accept zid,zid),
- zones drawn on the same sheet as an accepted zone of their project (several projects publish one district
  drawing per zone, with only the highlight changing): refined from that zone's placement, and kept only when the
  zone's own streets confirm it (score ≥ 0.4). Equal image size alone proves nothing: New Obour's neighbourhood
  sheets all share one size.
usage: python3 adopt_g.py <work dir> <zones.tsv> <raster prefix> <reg-past dir> [--accept zid,..] [--reject zid,..] [--skip-pid pid,..]
"""
import sys, os, json, subprocess, math
import cv2
work, tsv, ras, reg = sys.argv[1:5]
def opt(name, default=""): return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default
accept, reject, skip = (set(opt(n).split(",")) - {""} for n in ("--accept", "--reject", "--skip-pid"))
here = os.path.dirname(os.path.abspath(__file__)); os.makedirs(reg, exist_ok=True)
rows = [l.rstrip("\n").split("\t") for l in open(tsv, encoding="utf-8") if l.strip()]
res, size = {}, {}
for r in rows:
    f, img = f"{work}/place/zg_{r[0]}.json", f"{work}/plans/zone_{r[0]}.jpg"
    if os.path.exists(f) and os.path.exists(img): res[r[0]] = json.load(open(f)); size[r[0]] = cv2.imread(img).shape[:2]
ok = {z: ("clear" if z not in accept else "eye") for z, r in res.items()
      if z not in reject and "affine" in r and (z in accept or (r.get("score", 0) >= 0.4 and r.get("ratio", 0) >= 1.15))}
out = {z: {"affine": res[z]["affine"], "score": res[z]["score"], "ratio": res[z].get("ratio"), "how": f"gmap-roads:{ok[z]}"} for z in ok}
for r in rows:
    z, pid = r[0], r[1]
    if z in out or z not in res or z in reject: continue
    mates = [m for m in ok if size.get(m) == size[z] and any(q[0] == m and q[1] == pid for q in rows)]
    if not mates: continue
    ref = max(mates, key=lambda m: res[m]["score"])
    tmp = f"{work}/place/zg_{z}.ref.json"; json.dump({"candidates": [{"affine": res[ref]["affine"]}]}, open(tmp, "w"))
    fin = f"{work}/place/zg_{z}.fin2.json"
    subprocess.run([sys.executable, f"{here}/place_g.py", f"{work}/plans/zone_{z}.jpg", ras, fin, "--refine", tmp, "--preview", f"{work}/place/zg_{z}.jpg"], capture_output=True)
    c = json.load(open(fin))["candidates"] if os.path.exists(fin) else []
    # Only when the zone's own streets confirm the borrowed position: drawings of equal size are often different
    # neighbourhoods (New Obour 358-360), and a borrowed position that the streets don't confirm was wrong there.
    if c and c[0]["score"] >= 0.4: out[z] = {"affine": c[0]["affine"], "score": c[0]["score"], "ratio": None, "how": f"gmap-roads:sheet-of-{ref}"}
n = 0
for r in rows:
    z, pid = r[0], r[1]
    if z not in out or pid in skip: continue
    json.dump({"zid": int(z), "pid": int(pid), **out[z]}, open(f"{reg}/{z}.json", "w")); n += 1
left = [r[0] for r in rows if r[0] not in out and r[1] not in skip]
print(f"{n} registration(s) written; not placed: {len(left)}: {' '.join(left)}")
