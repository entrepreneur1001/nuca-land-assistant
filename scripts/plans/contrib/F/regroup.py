"""Apply one correction to a group of chained registrations: new_z = New_anchor ∘ Old_anchor^-1 ∘ Old_z (keeps the chain relations).
usage: python3 regroup.py <old reg dir> <out reg dir> <anchor zid> '<new anchor affine json>' <note> <zid>..."""
import sys, json, math, numpy as np
old, out, anchor, newA, note = sys.argv[1:6]
def h(M): return np.vstack([np.array(M, float), [0, 0, 1]])
C = h(json.loads(newA)) @ np.linalg.inv(h(json.load(open(f"{old}/{anchor}.json"))["affine"]))
R = 6378137.0
def ll(x, y): return math.degrees(2 * math.atan(math.exp(y / R)) - math.pi / 2), math.degrees(x / R)
for z in sys.argv[6:]:
    r = json.load(open(f"{old}/{z}.json")); M0 = h(r["affine"]); M = C @ M0
    s = math.sqrt(abs(np.linalg.det(M[:2, :2]))); rot = math.degrees(math.atan2(M[1, 0], M[0, 0]))
    c = np.array([1024, 724, 1]); p0 = M0 @ c; p1 = M @ c; la, lo = ll(p1[0], p1[1]); coslat = math.cos(math.radians(la))
    print(f"{z}: scale {r['scale_m_per_px']:.4f} -> {s:.4f} merc m/px ({s*coslat:.4f} ground), rot {rot:+.2f}, image-centre shift {np.hypot(*(p1-p0)[:2])*coslat:.0f} m ground (dE {(p1-p0)[0]*coslat:+.0f}, dN {(p1-p0)[1]*coslat:+.0f}), new centre {la:.6f},{lo:.6f}")
    r.update({"affine": M[:2].tolist(), "scale_m_per_px": s, "rotation_deg": rot, "how": "roads+chain", "prev_how": r.get("how"), "note": note})
    r.pop("score", None); json.dump(r, open(f"{out}/{z}.json", "w"))
