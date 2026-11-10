"""Find a zone plan inside its project's overview slide. Both are the same drawing (the zone plan is an enlarged
crop, same way up), so the zone, shrunk by the right factor, matches a patch of the slide.
usage: python3 chain_slide.py <zone.jpg> <slide.jpg> [--out zone_to_slide.json] [--preview out.jpg]
Prints and writes {f, x, y, score}: slide px = f · zone px + (x, y). A score under ~0.45 is not a match.
"""
import sys, json
import numpy as np, cv2
zone, slide = sys.argv[1:3]
def opt(name, default=None): return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default
def prep(path):
    g = cv2.cvtColor(cv2.imread(path), cv2.COLOR_BGR2GRAY)
    return g
gz, gs = prep(zone), prep(slide); hz, wz = gz.shape; hs, ws = gs.shape
# The zone plan fades everything outside the zone: its centre is the reliable part.
def match(f):
    w, h = int(round(wz * f)), int(round(hz * f))
    if w < 24 or h < 24 or w > ws or h > hs: return None
    t = cv2.resize(gz, (w, h), interpolation=cv2.INTER_AREA)
    x0, y0 = int(w * 0.15), int(h * 0.15); core = t[y0:h - y0, x0:w - x0]
    if core.std() < 4: return None
    r = cv2.matchTemplate(gs, core, cv2.TM_CCOEFF_NORMED); _, mx, _, loc = cv2.minMaxLoc(r)
    return mx, f, loc[0] - x0, loc[1] - y0
fmax = min(ws / wz, hs / hz)
coarse = [m for m in (match(f) for f in np.geomspace(0.05, fmax, 70)) if m]
best = max(coarse)
fine = [m for m in (match(f) for f in np.linspace(best[1] * 0.94, min(fmax, best[1] * 1.06), 49)) if m]
best = max(fine + [best])
res = {"f": round(float(best[1]), 5), "x": int(best[2]), "y": int(best[3]), "score": round(float(best[0]), 3)}
print(zone.split("/")[-1], res)
if opt("--out"): json.dump(res, open(opt("--out"), "w"))
if opt("--preview"):
    im = cv2.imread(slide); f = res["f"]
    cv2.rectangle(im, (res["x"], res["y"]), (int(res["x"] + wz * f), int(res["y"] + hz * f)), (0, 0, 255), 2); cv2.imwrite(opt("--preview"), im)
