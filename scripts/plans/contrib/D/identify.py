"""Identify every polygon of a zone plan with an official plot, from two independent signals:
  (1) coordinates: each official plot's known lat/lng, mapped through the plan's affine, must fall inside (or next to)
      exactly one polygon — one-to-one Hungarian matching, capped at a fraction of the plot size;
  (2) numbers: the multi-variant reads of reocr.py (Western and Arabic-Indic digits), restricted to official numbers.
usage: python3 identify.py <zid> [--refit] [--no-coords] [--override file.json] [--write]
  --refit      fit the affine again from the number reads (RANSAC similarity) and use it (reports old vs new)
  --no-coords  zone has no trustworthy coordinates: numbers only
  --override   {"<polygon index>": "<plot number>" | ""}: hand decisions after looking at the crop ("" = leave out)
  --write      update plans/zone_<zid>.plots.json (text, method, plot_id per polygon) and reg/<zid>.json (assign, assign_ids)
Methods: ocr+coord (both agree), coord (number unread, coordinate unambiguous), ocr (no coordinate match, number unique),
ocr>coord / coord>ocr (disagreement settled automatically, see code), hand (override), seq (row interpolation).
"""
import sys, json, math, collections
import numpy as np, cv2
from scipy.optimize import linear_sum_assignment
R = 6378137.0
def merc(lat, lng): return (math.radians(lng) * R, math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * R)
def fit_similarity(P, Q):
    n = len(P); pc, qc = P.mean(0), Q.mean(0); P0, Q0 = P - pc, Q - qc
    U, D, Vt = np.linalg.svd(Q0.T @ P0 / n); c = D.sum() / ((P0 ** 2).sum() / n); A = c * (U @ Vt)
    return np.hstack([A, (qc - A @ pc)[:, None]])
def apply(M, P): return np.asarray(P, float) @ M[:, :2].T + M[:, 2]
zid = sys.argv[1]; flags = sys.argv[2:]
zp = json.load(open("zone_plots.json"))[zid]["plots"]
pj = f"plans/zone_{zid}.plots.json"; d = json.load(open(pj)); polys = d["plots"]
reads = json.load(open(f"reads/{zid}.json"))
override = json.load(open(flags[flags.index("--override") + 1])).get(zid, {}) if "--override" in flags else {}
norm = lambda s: s.strip().lstrip("0") or "0"
byno = collections.defaultdict(list)
for p in zp: byno[norm(p["no"])].append(p)
uniq = {k: v[0] for k, v in byno.items() if len(v) == 1}
# ---- numbers: pick the script (Arabic-Indic vs Western) that explains more polygons, then the best vote per polygon
def pick(lang):
    out = {}
    for i, r in enumerate(reads):
        v = {k[2:]: s for k, s in r["votes"].items() if k[0] == lang and k[2:] in byno}
        if not v: continue
        o = sorted(v.items(), key=lambda kv: -kv[1])
        out[i] = (o[0][0], o[0][1], o[1][1] if len(o) > 1 else 0.0)
    return out
# Vision reads text in any orientation, so a number made of 0/1/6/8/9 can come back upside down (6↔9, 66↔99, 68↔89,
# 16↔91 …). Western digits only: the ink itself decides — a 6 has its loop low, a 9 has it high.
ROT = {"0": "0", "1": "1", "6": "9", "8": "8", "9": "6"}
def rot180(t): return "".join(ROT[c] for c in reversed(t)) if all(c in ROT for c in t) else None
_img = None
def loops(j):
    """Per digit glyph (left→right): 'L' loop in the lower half, 'H' upper half, '?' otherwise."""
    global _img
    if _img is None: _img = cv2.imread(f"plans/zone_{zid}.jpg")
    p = polys[j]; x, y, w, h = p["bbox"]; c = _img[y:y + h, x:x + w]
    c = cv2.resize(c, None, fx=6, fy=6, interpolation=cv2.INTER_CUBIC).astype(np.int32)
    m = np.zeros(c.shape[:2], np.uint8); cv2.fillPoly(m, [(np.array(p["poly"], np.int32) - [x, y]) * 6], 255); m = cv2.erode(m, np.ones((13, 13), np.uint8))
    ink = (((c[:, :, 2] - c[:, :, 1]) > 70) & (m > 0)).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(ink, connectivity=8)
    comps = [k for k in range(1, n) if st[k, 4] > 60]
    if not comps: return ""
    hmax = max(st[k, 3] for k in comps); out = []
    for k in sorted([k for k in comps if st[k, 3] > 0.6 * hmax], key=lambda k: st[k, 0]):
        gx, gy, gw, gh = st[k, :4]; g = (lab[gy:gy + gh, gx:gx + gw] == k).astype(np.uint8)
        pad = cv2.copyMakeBorder(1 - g, 1, 1, 1, 1, cv2.BORDER_CONSTANT, value=1)
        n2, lab2, st2, cen2 = cv2.connectedComponentsWithStats(pad, connectivity=4)
        holes = [(st2[q, 4], cen2[q][1] - 1) for q in range(1, n2) if lab2[0, 0] != q and st2[q, 4] > 0.015 * gw * gh]
        if len(holes) != 1: out.append("?"); continue
        r = holes[0][1] / gh
        out.append("L" if r > 0.56 else "H" if r < 0.44 else "?")
    return "".join(out)
def upright(j, t):
    """Resolve t vs its upside-down reading from the glyph loops; returns the upright number, or None if undecided."""
    u = rot180(t)
    if u is None or u == t or u not in byno: return t
    sig = loops(j)
    if len(sig) != len(t): return None
    exp = lambda s: "".join({"6": "L", "9": "H"}.get(c, ".") for c in s)
    ok_t = all(a == b for a, b in zip(sig, exp(t)) if b != "."); ok_u = all(a == b for a, b in zip(sig, exp(u)) if b != ".")
    return t if ok_t and not ok_u else u if ok_u and not ok_t else None
pa, pe = pick("a"), pick("e")
flipped = undecided = 0
for i in list(pe):
    t, s_, s2 = pe[i]; u = upright(i, t)
    if u is None: del pe[i]; undecided += 1
    elif u != t: pe[i] = (u, s_, 0.0); flipped += 1
    elif rot180(t) not in (None, t) and rot180(t) in byno: pe[i] = (t, s_, 0.0)  # the runner-up was only the upside-down reading
script = "a" if sum(s for _, s, _ in pa.values()) > sum(s for _, s, _ in pe.values()) else "e"
ocr = pa if script == "a" else pe
# a read is "firm" when it clearly beats the runner-up and no other polygon claims the same number more strongly
claim = collections.defaultdict(list)
for i, (t, s, s2) in ocr.items(): claim[t].append((s, i))
firm = {i: t for i, (t, s, s2) in ocr.items() if s >= 0.6 and s >= 1.5 * s2 and max(claim[t])[1] == i and sum(1 for x in claim[t] if x[0] >= 0.5 * s) == 1}
if script == "e": print(f"  upside-down check (6/9 loops): {flipped} reads turned, {undecided} undecided (dropped)")
print(f"{zid}: {len(polys)} polygons, {len(zp)} official plots, script {'Arabic-Indic' if script == 'a' else 'Western'}, reads {len(ocr)}, firm {len(firm)}")
cent = np.array([np.mean(p["poly"], axis=0) for p in polys])
def parea(poly): return abs(sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(poly, poly[1:] + poly[:1]))) / 2
# ---- coordinates
coord = {}; M = None; reg = None
if "--no-coords" not in flags:
    reg = json.load(open(f"reg/{zid}.json")); M = np.array(reg["affine"])
    loc = [p for p in zp if p["lat"] is not None]
    Q = np.array([merc(p["lat"], p["lng"]) for p in loc])
    def anchor_stats(M):
        pr = [(i, uniq[t]) for i, t in firm.items() if t in uniq and uniq[t]["lat"] is not None]
        if not pr: return 0, 0, 0
        e = np.linalg.norm(apply(M, cent[[i for i, _ in pr]]) - np.array([merc(c["lat"], c["lng"]) for _, c in pr]), axis=1)
        return len(pr), float(np.median(e)), float(np.mean(e < 0.5 * np.median([math.sqrt(parea(p["poly"])) for p in polys]) * math.sqrt(abs(np.linalg.det(M[:, :2])))))
    n, med, frac = anchor_stats(M)
    print(f"  existing affine ({reg['how']}): {n} number anchors, median error {med:.1f} m, within half a plot {frac:.0%}")
    if "--refit" in flags:
        pr = [(i, uniq[t]) for i, t in firm.items() if t in uniq and uniq[t]["lat"] is not None]
        P = cent[[i for i, _ in pr]]; Qa = np.array([merc(c["lat"], c["lng"]) for _, c in pr])
        rng = np.random.default_rng(0); best = None
        tol = 0.35 * float(np.median([math.sqrt(parea(p["poly"])) for p in polys])) * reg["scale_m_per_px"]
        for _ in range(2000):
            idx = rng.choice(len(pr), 3, replace=False); Mi = fit_similarity(P[idx], Qa[idx])
            inl = np.linalg.norm(apply(Mi, P) - Qa, axis=1) < tol
            if best is None or inl.sum() > best.sum(): best = inl
        for _ in range(3):
            Mn = fit_similarity(P[best], Qa[best]); best = np.linalg.norm(apply(Mn, P) - Qa, axis=1) < tol
        Mn = fit_similarity(P[best], Qa[best]); e = np.linalg.norm(apply(Mn, P[best]) - Qa[best], axis=1)
        sc = math.sqrt(abs(np.linalg.det(Mn[:, :2]))); rot = math.degrees(math.atan2(Mn[1, 0], Mn[0, 0]))
        n2, med2, frac2 = anchor_stats(Mn)
        print(f"  refit from numbers: inliers {int(best.sum())}/{len(pr)} (tol {tol:.1f} m), rms {math.sqrt((e ** 2).mean()):.1f} m, scale {sc:.4f} (was {reg['scale_m_per_px']:.4f}), rot {rot:.1f}° (was {reg['rotation_deg']:.1f}°); anchors median error {med2:.1f} m, within half a plot {frac2:.0%}")
        M = Mn; reg = dict(reg, affine=Mn.tolist(), scale_m_per_px=sc, rotation_deg=rot, rms_m=float(math.sqrt((e ** 2).mean())), how="ocr-ar" if script == "a" else "ocr2", refit_from=reg["how"])
    scale = math.sqrt(abs(np.linalg.det(M[:, :2])))
    Minv = np.linalg.inv(np.vstack([M, [0, 0, 1]]))[:2]
    Qpx = apply(Minv, Q)  # official plot positions in plan pixels
    C = np.full((len(loc), len(polys)), 1e6)
    for j, p in enumerate(polys):
        cnt = np.array(p["poly"], np.float32); rad = math.sqrt(parea(p["poly"]))
        dc = np.linalg.norm(Qpx - cent[j], axis=1)
        for a in np.where(dc < 2.5 * rad)[0]:
            ds = cv2.pointPolygonTest(cnt, (float(Qpx[a][0]), float(Qpx[a][1])), True)  # >0 inside
            out = max(0.0, -ds)
            if out <= 0.45 * rad: C[a, j] = out / rad + 0.2 * dc[a] / rad
    ra, cj = linear_sum_assignment(C)
    for a, j in zip(ra, cj):
        if C[a, j] < 1e5: coord[j] = (loc[a], bool(cv2.pointPolygonTest(np.array(polys[j]["poly"], np.float32), (float(Qpx[a][0]), float(Qpx[a][1])), False) >= 0), C[a, j])
    # ambiguity: a second plot almost as good for the same polygon, or a second polygon almost as good for the plot
    inside = sum(1 for v in coord.values() if v[1])
    print(f"  coordinate matching: {len(coord)}/{len(polys)} polygons matched ({inside} with the point inside the polygon)")
# ---- combine
final = {}; method = {}; notes = []
both = agree = 0
for j in range(len(polys)):
    c = coord.get(j); t = firm.get(j); weak = ocr.get(j)
    if c and t:
        both += 1
        if norm(c[0]["no"]) == t: agree += 1; final[j] = c[0]; method[j] = "ocr+coord"
        else:
            # The read number's own plot sits (by coordinates) in another polygon whose read does not contradict that,
            # and this polygon's point is inside it: the read here is a misread → keep the coordinate assignment.
            other = [k for k, v in coord.items() if norm(v[0]["no"]) == t and k != j]
            if c[1] and other and firm.get(other[0], t) == t and np.linalg.norm(cent[other[0]] - cent[j]) > 1.5 * math.sqrt(parea(polys[j]["poly"])):
                final[j] = c[0]; method[j] = "coord>ocr"; notes.append((j, f"misread {t} → coord {c[0]['no']} (plot {t} is polygon {other[0]})"))
            elif c[1] and "--coord-wins" in flags:
                final[j] = c[0]; method[j] = "coord>ocr"; notes.append((j, f"read {t} overruled by coord {c[0]['no']}"))
            else: notes.append((j, f"DISAGREE coord={c[0]['no']} (inside={c[1]}) ocr={t} votes={reads[j]['votes']}"))
    elif c:
        if weak and weak[0] == norm(c[0]["no"]): final[j] = c[0]; method[j] = "ocr+coord"
        else:
            final[j] = c[0]; method[j] = "coord"
            if weak: notes.append((j, f"weak-read differs: coord={c[0]['no']} read={weak[0]} votes={reads[j]['votes']}"))
    elif t and t in uniq: final[j] = uniq[t]; method[j] = "ocr"
if both: print(f"  agreement coord vs firm number read: {agree}/{both} = {agree / both:.1%}")
# plots claimed twice (ocr-only clashing with a coord assignment): drop the ocr-only one
seen = collections.defaultdict(list)
for j, c in final.items(): seen[c["id"]].append(j)
for pid, js in seen.items():
    if len(js) > 1:
        for j in js:
            if method[j] == "ocr": notes.append((j, f"number {final[j]['no']} also assigned to polygon {[x for x in js if x != j]} — dropped")); del final[j]; del method[j]
for j, v in override.items():
    j = int(j)
    if v == "": final.pop(j, None); method.pop(j, None); continue
    c = uniq.get(norm(v))
    if not c: print("  override: unknown/ambiguous number", v); continue
    for k in [k for k, x in final.items() if x["id"] == c["id"] and k != j]: del final[k]; del method[k]; notes.append((k, f"lost {v} to hand override on {j}"))
    final[j] = c; method[j] = "hand"
# ---- row interpolation for what is left: an unassigned polygon whose two row neighbours carry n-1 and n+1
rad = [math.sqrt(max(parea(p["poly"]), 1)) for p in polys]
changed = True
while changed:
    changed = False
    used_ids = {c["id"] for c in final.values()}
    for j in range(len(polys)):
        if j in final or str(j) in override: continue
        nb = [k for k in final if np.linalg.norm(cent[j] - cent[k]) < 0.75 * (rad[j] + rad[k]) and norm(final[k]["no"]).isdigit()]
        cands = set()
        for a in nb:
            for b in nb:
                na, nb_ = int(norm(final[a]["no"])), int(norm(final[b]["no"]))
                if nb_ - na == 2 and str(na + 1) in uniq and uniq[str(na + 1)]["id"] not in used_ids:
                    # the three centroids must be roughly collinear with j in the middle
                    v1, v2 = cent[j] - cent[a], cent[b] - cent[j]
                    if np.dot(v1, v2) / (np.linalg.norm(v1) * np.linalg.norm(v2) + 1e-9) > 0.8: cands.add(str(na + 1))
        if len(cands) == 1:
            t = cands.pop(); c = uniq[t]
            # stated area must be compatible with the polygon when a scale is known
            if M is not None and c["area"] and not (0.6 < parea(polys[j]["poly"]) * scale * scale / 1.2 / c["area"] < 1.6): continue
            final[j] = c; method[j] = "seq"; changed = True
if M is not None:
    rat = {j: parea(polys[j]["poly"]) * scale * scale / c["area"] for j, c in final.items() if c["area"]}
    med = float(np.median(list(rat.values())))
    for j, r in rat.items():
        if not 0.6 < r / med < 1.6: notes.append((j, f"AREA plot {final[j]['no']} {final[j]['area']} m2 vs polygon {parea(polys[j]['poly']) * scale * scale / med:.0f} m2 ({method[j]})"))
    print(f"  drawn/stated area ratio median {med:.2f}")
for j, n in sorted(notes): print(f"  poly {j} @({cent[j][0]:.0f},{cent[j][1]:.0f}): {n}")
left = [j for j in range(len(polys)) if j not in final]
miss = [p["no"] for p in zp if p["id"] not in {c["id"] for c in final.values()}]
print(f"  identified {len(final)}/{len(polys)} polygons ({dict(collections.Counter(method.values()))}); unassigned polygons {left}; plots without polygon {miss}")
if "--write" in flags:
    for j, p in enumerate(polys):
        p["text_ocr0"] = p.get("text_ocr0", p.get("text", ""))
        if j in final: p["text"], p["method"], p["plot_id"] = norm(final[j]["no"]), method[j], final[j]["id"]
        else:
            p["text"] = ""; p["method"] = "none"; p.pop("plot_id", None)
    json.dump(d, open(pj, "w"))
    if reg is not None:
        reg["assign"] = {final[j]["no"]: j for j in final}; reg["assign_ids"] = {final[j]["id"]: j for j in final}
        reg["matched"] = len(final); reg["identify"] = dict(collections.Counter(method.values()))
        json.dump(reg, open(f"reg/{zid}.json", "w"))
    print("  written")
