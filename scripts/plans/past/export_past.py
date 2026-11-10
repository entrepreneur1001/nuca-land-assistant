"""Export placed earlier-stage zone plans for the site: public/plans/past/<zid>.webp (greyscale, transparent
outside the zone's own drawing, at most --max px) and public/plans/past/index.json (src/lib/past-plans.ts).
usage: python3 export_past.py <work dir> <zones.tsv> <reg-past dir> <out dir> [--max 1400] [--only zid,zid]
Every zone with <reg-past>/<zid>.json and a downloaded plan is exported; the index is rebuilt from all of them
(entries of other cities already in the index are kept).
"""
import sys, json, math, os
import numpy as np, cv2
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from zone_shape import zone_template
R = 6378137.0
work, tsv, reg, out = sys.argv[1:5]
def opt(name, default=None): return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default
MAX = int(opt("--max", "1400")); only = set(opt("--only", "").split(",")) - {""}
def unmerc(x, y): return [round(math.degrees(2 * math.atan(math.exp(y / R)) - math.pi / 2), 7), round(math.degrees(x / R), 7)]

def vivid_zone(img, close_first=False):
    """The area of the vivid warm plot fills (the highlighted zone on a sheet that veils or greys the rest), grown
    over the streets between them; None when no such fills stand out. close_first joins the fills across the plot
    borders and numbers before the speckle is removed: for coarse sheets whose plots are only a few px across."""
    H, W = img.shape[:2]; hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    warm = cv2.inRange(hsv, (10, 14, 190), (42, 255, 255)) > 0
    if warm.mean() < 0.004: return None
    sat = hsv[..., 1][warm]
    thr, _ = cv2.threshold(sat.reshape(-1, 1), 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    lo, hi = sat[sat <= thr], sat[sat > thr]
    if len(lo) and len(hi) and hi.mean() - lo.mean() < 15: thr = 0
    m = (warm & (hsv[..., 1] > thr)).astype(np.uint8) * 255
    k = max(3, int(min(H, W) / 250)) | 1
    if close_first: m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((k, k), np.uint8))
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((k, k), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(m, connectivity=8)
    keep = [i for i in range(1, n) if st[i, 4] > (H * W) * 0.0002]
    if sum(st[i, 4] for i in keep) < H * W * 0.003: return None
    own = np.isin(lab, keep).astype(np.uint8) * 255
    r = int(max(H, W) * 0.022) | 1
    own = cv2.morphologyEx(own, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1)))
    return cv2.dilate(own, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (r, r)))

def own_mask(img):
    """The zone's own drawing as a soft 0–255 mask. Usually the area its blocks of outlined plots cover
    (zone_shape.zone_template, the shape the placement was matched on). Some projects publish one sheet of the
    whole district per zone with only that zone highlighted: there the outlined plots cover the district, so
    the highlighted fills decide. None when neither is found (the zone is then not exported)."""
    _, zone, side = zone_template(img)
    vivid = vivid_zone(img)
    if zone is None and vivid is None: vivid = vivid_zone(img, close_first=True)
    if zone is None and vivid is None: return None
    if zone is None or (vivid is not None and (vivid > 0).sum() < 0.35 * (zone > 0).sum()): zone = vivid
    return cv2.GaussianBlur(zone, (0, 0), max(2.0, max(img.shape[:2]) / 400))

os.makedirs(out, exist_ok=True)
index_path = f"{out}/index.json"
index = json.load(open(index_path)) if os.path.exists(index_path) else {"zones": {}}
rows = {r[0]: r for r in (l.rstrip("\n").split("\t") for l in open(tsv, encoding="utf-8") if l.strip())}
# The map matches earlier-stage zones to a city by name, as spelled in the current plans' index (the app's data);
# the official site's city list spells some names differently (اكتوبر / أكتوبر).
def norm(n): return n.replace("أ", "ا").replace("إ", "ا").replace("آ", "ا").replace("ى", "ي").replace("ة", "ه").replace(" ", "")
_cur = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "public", "plans", "index.json")
CITY = {norm(z["city"]): z["city"] for z in json.load(open(_cur))["zones"].values()} if os.path.exists(_cur) else {}
def city_name(n): return CITY.get(norm(n), n)
done = 0
for zid, row in rows.items():
    rf, src = f"{reg}/{zid}.json", f"{work}/plans/zone_{zid}.jpg"
    if only and zid not in only: continue
    if not os.path.exists(rf) or not os.path.exists(src): continue
    M = np.array(json.load(open(rf))["affine"]); img = cv2.imread(src); H, W = img.shape[:2]
    mask = own_mask(img)
    if mask is None: print(zid, "no zone outline found: not exported"); continue
    ys, xs = np.where(mask > 8); x0, y0, x1, y1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
    grey = cv2.cvtColor(img[y0:y1, x0:x1], cv2.COLOR_BGR2GRAY); h, w = grey.shape
    alpha = mask[y0:y1, x0:x1]
    f = min(1.0, MAX / max(w, h))
    if f < 1:
        size = (int(round(w * f)), int(round(h * f)))
        grey, alpha = cv2.resize(grey, size, interpolation=cv2.INTER_AREA), cv2.resize(alpha, size, interpolation=cv2.INTER_AREA)
    h2, w2 = grey.shape
    # Everything outside the zone's own drawing is transparent, so neighbouring zones and the map show through.
    cv2.imwrite(f"{out}/{zid}.webp", cv2.merge([grey, grey, grey, alpha]), [cv2.IMWRITE_WEBP_QUALITY, 62])
    def at(px, py):  # exported px → [lat, lng]
        x, y = M @ np.array([x0 + px * w / w2, y0 + py * h / h2, 1.0]); return unmerc(x, y)
    tl, tr, bl, br = at(0, 0), at(w2, 0), at(0, h2), at(w2, h2)
    lats, lngs = [p[0] for p in (tl, tr, bl, br)], [p[1] for p in (tl, tr, bl, br)]
    entry = {"city": city_name(row[3]), "name": row[4], "stage": row[7], "pid": int(row[1]), "w": w2, "h": h2, "corners": {"tl": tl, "tr": tr, "bl": bl},
             "bounds": [[min(lats), min(lngs)], [max(lats), max(lngs)]]}
    index["zones"][zid] = entry; done += 1
json.dump(index, open(index_path, "w"), ensure_ascii=False, separators=(",", ":"))
print(f"exported {done} zone(s); index has {len(index['zones'])}")
