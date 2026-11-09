"""Re-export a zone after a registration change WITHOUT touching polygons: copies the current public <zid>.json/.webp and
recomputes only "corners" (the exported crop's corner pixels are recovered from the old corners with the old affine).
usage: python3 recorner.py <public plans dir> <old reg dir> <new reg dir> <out dir> <zid>...
Prints the plot-centroid shift (ground metres) and verifies that everything except "corners" is byte-identical."""
import sys, json, math, shutil, numpy as np
R = 6378137.0
def merc(lat, lng): return (math.radians(lng) * R, math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * R)
def ll(x, y): return [round(math.degrees(2 * math.atan(math.exp(y / R)) - math.pi / 2), 7), round(math.degrees(x / R), 7)]
def h(M): return np.vstack([np.array(M, float), [0, 0, 1]])
pub, old, new, out = sys.argv[1:5]
for z in sys.argv[5:]:
    d = json.load(open(f"{pub}/{z}.json")); M0 = h(json.load(open(f"{old}/{z}.json"))["affine"]); M1 = h(json.load(open(f"{new}/{z}.json"))["affine"])
    px = {k: np.round((np.linalg.inv(M0) @ np.array([*merc(*c), 1]))[:2]) for k, c in d["corners"].items()}   # crop corners, plan px
    chk = max(np.abs((np.linalg.inv(M0) @ np.array([*merc(*c), 1]))[:2] - px[k]).max() for k, c in d["corners"].items())
    assert chk < 0.1, f"{z}: old corners do not match the old registration ({chk:.2f} px)"
    nd = dict(d); nd["corners"] = {k: ll(*(M1 @ np.array([*p, 1]))[:2]) for k, p in px.items()}
    json.dump(nd, open(f"{out}/{z}.json", "w"), separators=(",", ":")); shutil.copyfile(f"{pub}/{z}.webp", f"{out}/{z}.webp")
    a = json.load(open(f"{out}/{z}.json")); assert {k: v for k, v in a.items() if k != "corners"} == {k: v for k, v in d.items() if k != "corners"} and list(a["plots"]) == list(d["plots"])
    # centroid shift: exported px -> plan px -> merc, old vs new
    sx = (px["tr"][0] - px["tl"][0]) / d["w"]; sy = (px["bl"][1] - px["tl"][1]) / d["h"]; sh = []
    for poly in d["plots"].values():
        c = np.mean(poly, 0); p = np.array([px["tl"][0] + c[0] * sx, px["tl"][1] + c[1] * sy, 1]); a0, a1 = M0 @ p, M1 @ p
        sh.append(np.hypot(*(a1 - a0)[:2]) * math.cos(math.radians(ll(a1[0], a1[1])[0])))
    print(f"{z}: {len(d['plots'])} plots, polygons/ids identical, webp copied; centroid shift median {np.median(sh):.0f} m (min {min(sh):.0f}, max {max(sh):.0f}); corners {nd['corners']}")
