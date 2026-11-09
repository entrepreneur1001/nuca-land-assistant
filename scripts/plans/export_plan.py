"""Export one registered zone for the web app: a cropped WebP of the plan and a JSON with its map corners and plot polygons.
usage: python3 export_plan.py <plans dir> <reg dir> <zone_plots.json> <out dir> <zid> [--max-width 2400]
JSON: {"zid", "w", "h", "corners": {"tl": [lat,lng], "tr": [lat,lng], "bl": [lat,lng]}, "plots": {"<plot id>": [[x,y],...]}, "unassigned": [[[x,y],...]]}
Pixel coordinates refer to the exported (cropped, possibly downscaled) image.
"""
import sys, json, math, os
import numpy as np, cv2
R = 6378137.0
def inv_merc(x, y): return [round(math.degrees(2 * math.atan(math.exp(y / R)) - math.pi / 2), 7), round(math.degrees(x / R), 7)]
plans, reg, zpf, out, zid = sys.argv[1:6]
maxw = int(sys.argv[sys.argv.index("--max-width") + 1]) if "--max-width" in sys.argv else 2400
r = json.load(open(f"{reg}/{zid}.json")); M = np.array(r["affine"])
ex = json.load(open(f"{plans}/zone_{zid}.plots.json")); polys = ex["plots"]
zp = json.load(open(zpf))[zid]
img = cv2.imread(f"{plans}/zone_{zid}.jpg"); H, W = img.shape[:2]
# Crop: drop the title bar and footer band (dark grey rows) and the white margins around the drawing.
gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
content = (gray < 235).astype(np.uint8)  # anything not near-white
# Rows that are a solid dark band across most of the width = header/footer
dark_rows = ((gray < 120).mean(1) > 0.6)
top = 0
while top < H and (dark_rows[top] or content[top].mean() < 0.02): top += 1
bottom = H - 1
while bottom > top and (dark_rows[bottom] or content[bottom].mean() < 0.02): bottom -= 1
# Also skip the yellow title band and any text row directly under the header: start at the first row where the drawing (grey roads/pink/yellow) appears
cols = content[top:bottom + 1].mean(0); left = int(np.argmax(cols > 0.02)); right = W - 1 - int(np.argmax(cols[::-1] > 0.02))
top = max(0, top - 4); bottom = min(H - 1, bottom + 4); left = max(0, left - 4); right = min(W - 1, right + 4)
crop = img[top:bottom + 1, left:right + 1]
ch, cw = crop.shape[:2]
scale = min(1.0, maxw / cw)
if scale < 1: crop = cv2.resize(crop, (int(cw * scale), int(ch * scale)), interpolation=cv2.INTER_AREA)
oh, ow = crop.shape[:2]
os.makedirs(out, exist_ok=True)
cv2.imwrite(f"{out}/{zid}.webp", crop, [cv2.IMWRITE_WEBP_QUALITY, 80])
def to_ll(px, py): x, y = M[:, :2] @ np.array([px, py]) + M[:, 2]; return inv_merc(x, y)
# Corners of the exported image in the original plan's pixel space
corners = {"tl": to_ll(left, top), "tr": to_ll(right + 1, top), "bl": to_ll(left, bottom + 1)}
def fix(poly): return [[round((x - left) * scale, 1), round((y - top) * scale, 1)] for x, y in poly]
byno = {}
for p in zp["plots"]: byno.setdefault(p["no"].strip().lstrip("0") or "0", []).append(p)
plots = {}; used = set()
ids = {p["id"] for p in zp["plots"]}
if r.get("assign_ids"):
    for pid, idx in r["assign_ids"].items():
        if pid in ids and idx not in used: plots[pid] = fix(polys[idx]["poly"]); used.add(idx)
else:
    for no, idx in r["assign"].items():
        cands = byno.get(no.strip().lstrip("0") or "0", [])
        if len(cands) != 1: continue
        plots[cands[0]["id"]] = fix(polys[idx]["poly"]); used.add(idx)
# Polygons the geometric fit did not assign (plots without coordinates in the same zone): match by the OCR'd number;
# when a number occurs on several polygons and several plots (A/B squares on one plan), pair them by area.
import collections
def poly_area(poly): return abs(sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(poly, poly[1:] + poly[:1]))) / 2
s2 = r["scale_m_per_px"] ** 2 / 1.15  # drawn plots are ~15% larger than their stated area
assigned_ids = set(plots)
free_polys = collections.defaultdict(list)
for i, p in enumerate(polys):
    if i not in used and p["text"]: free_polys[p["text"].lstrip("0")].append(i)
for no, pis in free_polys.items():
    cands = [c for c in byno.get(no, []) if c["id"] not in assigned_ids]
    if not cands: continue
    if len(pis) == 1 and len(cands) == 1: pairs = [(pis[0], cands[0])]
    else:
        # greedy by area difference
        opts = sorted(((abs(poly_area(polys[i]["poly"]) * s2 - c["area"]) / max(c["area"], 1), i, c["id"]) for i in pis for c in cands))
        done_i, done_c, pairs = set(), set(), []
        for rel, i, cid in opts:
            if i in done_i or cid in done_c or rel > 0.35: continue
            pairs.append((i, next(c for c in cands if c["id"] == cid))); done_i.add(i); done_c.add(cid)
    for i, c in pairs:
        plots[c["id"]] = fix(polys[i]["poly"]); used.add(i); assigned_ids.add(c["id"])
# Polygons whose number could not be read: plot numbers run consecutively along a block, so a leftover plot whose
# number is adjacent (±1) to the numbers of the polygon's neighbours, and to no other leftover polygon, is assigned.
def centroid(poly): return (sum(p[0] for p in poly) / len(poly), sum(p[1] for p in poly) / len(poly))
cents = [centroid(p["poly"]) for p in polys]; rad = [math.sqrt(max(poly_area(p["poly"]), 1)) for p in polys]
num_of = {}
for cid, poly in plots.items():
    pass
plot_no = {c["id"]: c["no"].strip().lstrip("0") for c in zp["plots"]}
poly_no = {i: plot_no[cid] for cid, i in ((cid, next((j for j, p in enumerate(polys) if fix(p["poly"]) == poly), None)) for cid, poly in plots.items()) if i is not None}
def neighbours(i):
    return [j for j in range(len(polys)) if j != i and math.hypot(cents[i][0] - cents[j][0], cents[i][1] - cents[j][1]) < 1.6 * (rad[i] + rad[j])]
changed = True
while changed:
    changed = False
    left_p = [i for i in range(len(polys)) if i not in used]
    left_c = [c for c in zp["plots"] if c["id"] not in assigned_ids]
    if not left_p or not left_c: break
    def cand_for(i):
        ns = {poly_no[j] for j in neighbours(i) if j in poly_no}
        out = []
        for c in left_c:
            k = plot_no[c["id"]]
            if not k.isdigit(): continue
            k = int(k)
            if str(k - 1) in ns or str(k + 1) in ns: out.append(c)
        return out
    cands = {i: cand_for(i) for i in left_p}
    for i, cs in cands.items():
        if len(cs) != 1: continue
        c = cs[0]
        if sum(1 for j, o in cands.items() if any(x["id"] == c["id"] for x in o)) != 1: continue
        plots[c["id"]] = fix(polys[i]["poly"]); used.add(i); assigned_ids.add(c["id"]); poly_no[i] = plot_no[c["id"]]; changed = True
# Runs of unread plots between two read ones along a row: numbers are consecutive, so a run of k unread polygons
# whose two read ends differ by k+1 is filled by interpolation along the row.
def row_adjacent(i, j):
    d = math.hypot(cents[i][0] - cents[j][0], cents[i][1] - cents[j][1])
    return d < 0.62 * (rad[i] + rad[j])
adj = {i: [j for j in range(len(polys)) if j != i and row_adjacent(i, j)] for i in range(len(polys))}
changed = True
while changed:
    changed = False
    left_c = {plot_no[c["id"]]: c for c in zp["plots"] if c["id"] not in assigned_ids and plot_no[c["id"]].isdigit()}
    unread = [i for i in range(len(polys)) if i not in used]
    seen = set()
    for s0 in unread:
        if s0 in seen: continue
        # component of unread polygons connected through row adjacency
        comp, stack = [], [s0]
        while stack:
            u = stack.pop()
            if u in seen: continue
            seen.add(u); comp.append(u)
            stack.extend(v for v in adj[u] if v not in used and v not in seen)
        # must be a simple path: order it
        deg = {u: [v for v in adj[u] if v in comp] for u in comp}
        ends = [u for u in comp if len(deg[u]) <= 1]
        if len(comp) > 1 and (len(ends) != 2 or any(len(deg[u]) > 2 for u in comp)): continue
        # read neighbours at each end (outside the component)
        def read_ends(u): return [v for v in adj[u] if v in poly_no]
        if len(comp) == 1:
            r = read_ends(comp[0])
            if len(r) < 2: continue
            nums = sorted(int(poly_no[v]) for v in r if poly_no[v].isdigit())
            cand = [k for a in nums for b in nums if a < b and b - a == 2 for k in [a + 1] if str(k) in left_c]
            if len(set(cand)) != 1: continue
            k = cand[0]; c = left_c[str(k)]
            plots[c["id"]] = fix(polys[comp[0]]["poly"]); used.add(comp[0]); assigned_ids.add(c["id"]); poly_no[comp[0]] = str(k); changed = True
            continue
        # order the path from one end
        order, prev, cur = [ends[0]], None, ends[0]
        while True:
            nxt = [v for v in deg[cur] if v != prev]
            if not nxt: break
            prev, cur = cur, nxt[0]; order.append(cur)
        ra = [v for v in read_ends(order[0]) if v not in comp]; rb = [v for v in read_ends(order[-1]) if v not in comp]
        if len(ra) != 1 or len(rb) != 1: continue
        a, b = poly_no[ra[0]], poly_no[rb[0]]
        if not (a.isdigit() and b.isdigit()): continue
        a, b = int(a), int(b)
        if abs(a - b) != len(order) + 1: continue
        step = 1 if b > a else -1
        nums = [a + step * (t + 1) for t in range(len(order))]
        if not all(str(k) in left_c for k in nums): continue
        for u, k in zip(order, nums):
            c = left_c[str(k)]; plots[c["id"]] = fix(polys[u]["poly"]); used.add(u); assigned_ids.add(c["id"]); poly_no[u] = str(k)
        changed = True
# Last resort for polygons whose number could not be read: pair leftover polygons with leftover plots by area
# when the match is unambiguous (closest area within 10%, and no other plot within 10%).
left_p = [i for i in range(len(polys)) if i not in used]
left_c = [c for c in zp["plots"] if c["id"] not in assigned_ids]
if left_p and left_c:
    for i in list(left_p):
        a = poly_area(polys[i]["poly"]) * s2
        near = sorted((abs(a - c["area"]) / max(c["area"], 1), c["id"]) for c in left_c)
        if near and near[0][0] <= 0.10 and (len(near) == 1 or near[1][0] > 0.10):
            cid = near[0][1]; plots[cid] = fix(polys[i]["poly"]); used.add(i); assigned_ids.add(cid)
            left_c = [c for c in left_c if c["id"] != cid]
unassigned = [fix(p["poly"]) for i, p in enumerate(polys) if i not in used]
missing = [p["no"] for p in zp["plots"] if p["id"] not in assigned_ids]
json.dump({"zid": int(zid), "w": ow, "h": oh, "corners": corners, "plots": plots, "unassigned": unassigned}, open(f"{out}/{zid}.json", "w"), separators=(",", ":"))
print(f"{zid}: {ow}x{oh} webp {os.path.getsize(f'{out}/{zid}.webp')//1024} KB, {len(plots)}/{len(zp['plots'])} plots mapped, {len(unassigned)} unassigned polygons, plots without polygon: {missing[:20]}{'…' if len(missing) > 20 else ''}")
