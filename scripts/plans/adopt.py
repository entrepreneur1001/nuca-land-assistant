"""Adopt a road-match (or satellite-match) candidate as the registration of a zone.
usage: python3 adopt.py <cand json> <index> <zid> <reg dir> <how>
"""
import sys, json, math, os
import numpy as np
cf, idx, zid, reg, how = sys.argv[1], int(sys.argv[2]), sys.argv[3], sys.argv[4], sys.argv[5]
c = json.load(open(cf))[idx]; M = np.array(c["affine"])
os.makedirs(reg, exist_ok=True)
json.dump({"zid": int(zid), "affine": M.tolist(), "scale_m_per_px": math.sqrt(abs(np.linalg.det(M[:, :2]))), "rotation_deg": math.degrees(math.atan2(M[1, 0], M[0, 0])), "rms_m": None, "matched": 0, "polygons": 0, "located": 0, "assign": {}, "how": how, "score": c.get("score")}, open(f"{reg}/{zid}.json", "w"))
print(f"reg/{zid}.json ← {cf}[{idx}] ({how}, score {c.get('score')})")
