"""Similarity (plan px -> Web Mercator) from an anchor pair or control points; prints the affine JSON.
usage: python3 simfit.py anchor <px> <py> <mx> <my> <scale merc m/px> <rot deg ccw>
       python3 simfit.py pts "px,py=mx,my;px,py=mx,my;..."   (least-squares similarity, >=2 points)"""
import sys, json, math, numpy as np
if sys.argv[1] == "anchor":
    px, py, mx, my, s, r = map(float, sys.argv[2:8]); c, sn = math.cos(math.radians(r)), math.sin(math.radians(r))
    A = np.array([[s * c, s * sn], [s * sn, -s * c]]); t = np.array([mx, my]) - A @ np.array([px, py])
else:
    P, Q = [], []
    for it in sys.argv[2].split(";"):
        a, b = it.split("="); P.append([float(v) for v in a.split(",")]); Q.append([float(v) for v in b.split(",")])
    P, Q = np.array(P), np.array(Q); Pf = P * [1, -1]; pc, qc = Pf.mean(0), Q.mean(0)
    zp = (Pf - pc) @ [1, 1j]; zq = (Q - qc) @ [1, 1j]; k = (zq * zp.conj()).sum() / (abs(zp) ** 2).sum()
    s, r = abs(k), math.degrees(math.atan2(k.imag, k.real)); c, sn = math.cos(math.radians(r)), math.sin(math.radians(r))
    A = np.array([[s * c, s * sn], [s * sn, -s * c]]); t = qc - A @ P.mean(0)
    res = Q - (P @ A.T + t); print("scale %.4f rot %.2f rms %.1f m" % (s, r, math.sqrt((res ** 2).sum(1).mean())), file=sys.stderr)
print(json.dumps([[A[0, 0], A[0, 1], t[0]], [A[1, 0], A[1, 1], t[1]]]))
