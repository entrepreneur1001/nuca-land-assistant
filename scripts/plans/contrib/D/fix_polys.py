"""Hand repairs of extracted polygons. usage: python3 fix_polys.py <zid> <edits.json>
edits.json: {"<zid>": {"drop": [i,...], "hull": [i,...], "split": {"<i>": [[x1,y1],[x2,y2]]}, "add": [[[x,y],...], ...]}}
  drop  = spurious sliver; hull = outline notched by a digit touching the border → convex hull;
  split = two plots merged because their shared border is faint: cut along the given line (extended across the polygon);
  add   = a plot the yellow threshold missed. Indices refer to the file before editing; reads must be re-run afterwards."""
import sys, json, cv2, numpy as np
zid = sys.argv[1]; ed = json.load(open(sys.argv[2])).get(zid, {})
f = f"plans/zone_{zid}.plots.json"; d = json.load(open(f)); polys = d["plots"]
def mk(pts, src=None):
    pts = np.array(pts, np.int32); x, y, w, h = cv2.boundingRect(pts); a = cv2.contourArea(pts)
    return {"poly": pts.tolist(), "bbox": [int(x), int(y), int(w), int(h)], "area_px": int(a), "solidity": round(float(a / max(cv2.contourArea(cv2.convexHull(pts)), 1)), 3), "text": "", "conf": 0, "cands": [], "edit": src}
# --auto: an outline notched by a digit that touches the border (polygon area < 90% of its convex hull) is replaced by
# the hull when the hull does not run into a neighbour; slivers swallowed by such a hull are dropped.
THR = float(sys.argv[sys.argv.index("--thr") + 1]) if "--thr" in sys.argv else 0.9
if "--auto" in sys.argv:
    ed = dict(ed); hull = set(ed.get("hull", [])); drop = set(ed.get("drop", []))
    A = [cv2.contourArea(np.array(p["poly"], np.int32)) for p in polys]; med = float(np.median(A))
    C = [np.mean(p["poly"], axis=0) for p in polys]
    for i, p in enumerate(polys):
        if i in drop or str(i) in ed.get("split", {}): continue
        pts = np.array(p["poly"], np.int32); h = cv2.convexHull(pts); ha = cv2.contourArea(h)
        if A[i] >= THR * ha or A[i] < 0.3 * med: continue
        x, y, w, hh = cv2.boundingRect(h); m = np.zeros((hh, w), np.uint8); cv2.fillPoly(m, [h.reshape(-1, 2) - [x, y]], 1)
        clash = 0; inside = []
        for j, q in enumerate(polys):
            if j == i: continue
            qx, qy, qw, qh = q["bbox"]
            if qx > x + w or qx + qw < x or qy > y + hh or qy + qh < y: continue
            m2 = np.zeros((hh, w), np.uint8); cv2.fillPoly(m2, [np.array(q["poly"], np.int32) - [x, y]], 1)
            ov = int((m & m2).sum())
            if A[j] < 0.3 * med and ov > 0.6 * A[j]: inside.append(j)
            else: clash += ov
        if clash > 0.06 * ha: print(f"  {i}: notched (area/hull {A[i] / ha:.2f}) but hull overlaps neighbours — left"); continue
        hull.add(i); drop.update(inside)
    ed["hull"] = sorted(hull); ed["drop"] = sorted(drop); print(f"  auto: hull {ed['hull']}, drop {ed['drop']}")
out = []
for i, p in enumerate(polys):
    if i in ed.get("drop", []): continue
    if i in ed.get("hull", []):
        q = mk(cv2.convexHull(np.array(p["poly"], np.int32)).reshape(-1, 2), "hull")
        for k in ("text", "conf", "cands", "method", "plot_id", "text_ocr0"):
            if k in p: q[k] = p[k]
        out.append(q); continue
    if str(i) in ed.get("split", {}):
        (x1, y1), (x2, y2) = ed["split"][str(i)]; x, y, w, h = p["bbox"]; m = np.zeros((h + 4, w + 4), np.uint8)
        cv2.fillPoly(m, [np.array(p["poly"], np.int32) - [x - 2, y - 2]], 255)
        dx, dy = x2 - x1, y2 - y1; a = (int(x1 - 3 * dx - x + 2), int(y1 - 3 * dy - y + 2)); b = (int(x2 + 3 * dx - x + 2), int(y2 + 3 * dy - y + 2))
        cv2.line(m, a, b, 0, 2)
        n, lab, st, _ = cv2.connectedComponentsWithStats(m, connectivity=4)
        parts = sorted(range(1, n), key=lambda k: -st[k, 4])[:2]
        for k in parts:
            c = max(cv2.findContours((lab == k).astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)[0], key=cv2.contourArea)
            c = cv2.convexHull(c) if ed.get("split_hull", True) else c
            c = cv2.approxPolyDP(c, 0.012 * cv2.arcLength(c, True), True).reshape(-1, 2) + [x - 2, y - 2]; out.append(mk(c, "split"))
        continue
    out.append(p)
for pts in ed.get("add", []): out.append(mk(pts, "add"))
d["plots"] = out; json.dump(d, open(f, "w")); print(f"{zid}: {len(polys)} → {len(out)} polygons")
