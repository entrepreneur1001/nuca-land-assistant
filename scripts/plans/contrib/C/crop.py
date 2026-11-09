"""View helper: upscaled crop of a plan with polygon outlines and indices. usage: crop.py <jpg> <plots.json> <out.png> x0 y0 x1 y1 [scale] [--nopoly]"""
import sys, json, cv2, numpy as np
jpg, pj, out = sys.argv[1:4]; x0, y0, x1, y1 = map(int, sys.argv[4:8]); S = int(sys.argv[8]) if len(sys.argv) > 8 and sys.argv[8].isdigit() else 6
im = cv2.imread(jpg); c = cv2.resize(im[y0:y1, x0:x1], None, fx=S, fy=S, interpolation=cv2.INTER_CUBIC)
if "--nopoly" not in sys.argv:
    for i, p in enumerate(json.load(open(pj))["plots"]):
        a = np.array(p["poly"], float); cx, cy = a.mean(0)
        if not (x0 - 20 < cx < x1 + 20 and y0 - 20 < cy < y1 + 20): continue
        cv2.polylines(c, [((a - [x0, y0]) * S).astype(np.int32)], True, (255, 0, 0), 1)
        lab = f"{i}" + (f"={p['text']}" if p.get("text") else "=?")
        cv2.putText(c, lab, (int((cx - x0) * S) - 30, int((cy - y0) * S) + 5 * S), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (160, 0, 160) if p.get("text") else (0, 0, 0), 1, cv2.LINE_AA)
cv2.imwrite(out, c)
