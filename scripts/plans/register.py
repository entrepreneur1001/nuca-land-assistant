"""Fit a zone plan to the map using plots that already have coordinates.
usage: python3 register.py <zone_counts.json> <zone_plots.json> <plans dir> <out dir> [zid ...]
Similarity transform (scale, rotation, translation, y flipped) from plan pixels to Web-Mercator metres:
seeded by OCR'd plot numbers (RANSAC), else by ICP from a bounding-box start over several rotations; refined by
mutual-nearest assignment. Writes <out>/<zid>.json = {affine, rms_m, matched, assign {plotNo: polygon index}, how}.
"""
import sys, json, math, os
import numpy as np
R = 6378137.0
def merc(lat, lng): return (math.radians(lng) * R, math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * R)
def inv_merc(x, y): return (math.degrees(2 * math.atan(math.exp(y / R)) - math.pi / 2), math.degrees(x / R))
def fit_similarity(P, Q):
    """Least-squares similarity P→Q (orthogonal Procrustes + scale); a reflection is allowed (plan y down, map y up)."""
    n = len(P); pc, qc = P.mean(0), Q.mean(0); P0, Q0 = P - pc, Q - qc
    U, D, Vt = np.linalg.svd(Q0.T @ P0 / n)
    Rm = U @ Vt
    c = D.sum() / ((P0 ** 2).sum() / n)
    A = c * Rm; t = qc - A @ pc
    return np.hstack([A, t[:, None]])
def apply(M, P): return P @ M[:, :2].T + M[:, 2]
def poly_area(poly): return abs(sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(poly, poly[1:] + poly[:1]))) / 2

def register(zid, z, polys):
    located = [p for p in z["plots"] if p["lat"] is not None]
    if len(located) < 3: return None, f"SKIP: only {len(located)} located plots"
    cent = np.array([np.mean(p["poly"], axis=0) for p in polys])
    allQ = np.array([merc(p["lat"], p["lng"]) for p in located]); allNo = [p["no"] for p in located]
    nn = np.linalg.norm(allQ[:, None] - allQ[None], axis=2); np.fill_diagonal(nn, 1e9)
    tol = max(4.0, 0.4 * float(np.median(nn.min(1))))
    def assign(M):
        T = apply(M, cent); d = np.linalg.norm(T[:, None, :] - allQ[None, :, :], axis=2)
        a = d.argmin(1); b = d.argmin(0)
        return [(i, a[i], d[i, a[i]]) for i in range(len(polys)) if b[a[i]] == i and d[i, a[i]] < tol]
    def refine(M, rounds=4):
        for _ in range(rounds):
            m = assign(M)
            if len(m) < 3: return M, m
            M = fit_similarity(np.array([cent[i] for i, _, _ in m]), np.array([allQ[j] for _, j, _ in m]))
        return M, assign(M)
    # --- OCR-seeded fit
    byno = {}
    for p in located: byno.setdefault(p["no"].strip().lstrip("0") or "0", []).append(p)
    Q = {k: np.array(merc(v[0]["lat"], v[0]["lng"])) for k, v in byno.items() if len(v) == 1}
    seen = {}
    for i, p in enumerate(polys):
        if p["text"] and p["text"].lstrip("0") in Q: seen.setdefault(p["text"].lstrip("0"), []).append(i)
    pairs = [(v[0], Q[k]) for k, v in seen.items() if len(v) == 1]
    seeded, inliers = None, 0
    if len(pairs) >= 3:
        P = np.array([cent[i] for i, _ in pairs]); Qa = np.array([q for _, q in pairs])
        best = None; rng = np.random.default_rng(0)
        for _ in range(400):
            idx = rng.choice(len(pairs), 3, replace=False)
            M = fit_similarity(P[idx], Qa[idx]); inl = np.linalg.norm(apply(M, P) - Qa, axis=1) < tol
            if best is None or inl.sum() > best.sum(): best = inl
        inliers = int(best.sum())
        if inliers >= 3: seeded = refine(fit_similarity(P[best], Qa[best]))
    M, match, how = (seeded if seeded else (None, [], "")) + ("ocr",) if seeded else (None, [], "")
    # --- ICP fallback: flip y, scale from the point spread, try rotations every 15°
    if len(match) < 0.8 * min(len(polys), len(located)):
        pc, qc = cent.mean(0), allQ.mean(0)
        s0 = math.sqrt(((allQ - qc) ** 2).sum() / len(allQ) / (((cent - pc) ** 2).sum() / len(cent)))
        bestI = None
        for s in [s0, s0 * 0.85, s0 * 1.15]:
            for deg in range(0, 360, 15):
                th = math.radians(deg)
                A = s * np.array([[math.cos(th), -math.sin(th)], [math.sin(th), math.cos(th)]]) @ np.array([[1, 0], [0, -1]])
                Mi, mi = refine(np.hstack([A, (qc - A @ pc)[:, None]]), 8)
                if bestI is None or len(mi) > len(bestI[1]): bestI = (Mi, mi)
        if bestI and len(bestI[1]) > len(match): M, match, how = bestI[0], bestI[1], "icp"
    if M is None or len(match) < 3: return None, f"FAILED: matched {len(match)}"
    rms = math.sqrt(np.mean([m[2] ** 2 for m in match]))
    scale = math.sqrt(abs(np.linalg.det(M[:, :2])))
    rot = math.degrees(math.atan2(M[1, 0], M[0, 0]))  # direction of the plan's x axis on the map; 0 = east
    agree = sum(1 for i, j, _ in match if polys[i]["text"] and polys[i]["text"].lstrip("0") == allNo[j].strip().lstrip("0"))
    ocrd = sum(1 for i, j, _ in match if polys[i]["text"])
    areas_m = {p["no"]: p["area"] for p in located}
    ratio = float(np.median([poly_area(polys[i]["poly"]) * scale * scale / areas_m[allNo[j]] for i, j, _ in match if areas_m[allNo[j]] > 0]))
    res = {"zid": int(zid), "affine": M.tolist(), "scale_m_per_px": scale, "rotation_deg": rot, "rms_m": rms, "matched": len(match), "polygons": len(polys), "located": len(located),
           "assign": {allNo[j]: int(i) for i, j, _ in match}, "assign_ids": {located[j]["id"]: int(i) for i, j, _ in match}, "how": how, "tol_m": tol, "ocr_agree": agree, "ocr_read": ocrd, "area_ratio": ratio}
    line = f"[{how} tol {tol:.1f}] polys {len(polys)} located {len(located)} seeds {len(pairs)} inliers {inliers} matched {len(match)} rms {rms:.1f} m scale {scale:.3f} m/px rot {rot:.1f}° ocr-agree {agree}/{ocrd} area-ratio {ratio:.2f}"
    return res, line

def main():
    counts, zplots, plans, outdir = json.load(open(sys.argv[1])), json.load(open(sys.argv[2])), sys.argv[3], sys.argv[4]
    os.makedirs(outdir, exist_ok=True)
    zids = sys.argv[5:] or [z for z in zplots if os.path.exists(f"{plans}/zone_{z}.plots.json")]
    for zid in zids:
        z = zplots.get(zid); f = f"{plans}/zone_{zid}.plots.json"
        if not z or not os.path.exists(f): continue
        res, line = register(zid, z, json.load(open(f))["plots"])
        if res: json.dump(res, open(f"{outdir}/{zid}.json", "w"))
        print(zid, z["city"], z["name"], line)
if __name__ == "__main__": main()
