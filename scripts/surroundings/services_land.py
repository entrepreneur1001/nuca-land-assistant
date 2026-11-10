"""
Services land («اراضي خدمات») read off the official zone plans: the solid pink areas (RGB ≈ 253,178,178) reserved
for a mosque, school, mall, club… A plot across the street from one counts as facing services
(src/engine/surroundings.ts). The pale pink (≈ 254,224,225) is faded land outside the zone and is ignored.

    python3 scripts/surroundings/services_land.py            # every public/plans/<zid>.webp
Writes scripts/surroundings/services-land.json: {zid: [[[x, y], …], …]} outlines in plan-image pixels (the same
pixel space as the plot polygons in public/plans/<zid>.json). Re-run after new plans, then build.mts.
"""
import glob
import json
import os

import cv2
import numpy as np

ROOT = os.getcwd()
OUT = os.path.join(ROOT, "scripts", "surroundings", "services-land.json")
PINK = (253, 178, 178)
# Areas smaller than this share of the image are labels, legend swatches or anti-aliasing, not land.
MIN_SHARE = 0.0004


def outlines(path):
    im = cv2.imread(path)
    if im is None:
        return []
    h, w = im.shape[:2]
    b, g, r = (im[:, :, i].astype(int) for i in range(3))
    m = ((abs(r - PINK[0]) <= 8) & (abs(g - PINK[1]) <= 14) & (abs(b - PINK[2]) <= 14)).astype(np.uint8)
    # Close the thin label text and parcel lines drawn on the pink, then drop specks.
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    cs, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    out = []
    for c in cs:
        if cv2.contourArea(c) < MIN_SHARE * w * h:
            continue
        a = cv2.approxPolyDP(c, 2.0, True)
        out.append([[int(p[0][0]), int(p[0][1])] for p in a])
    return out


def main():
    res = {}
    for f in sorted(glob.glob(os.path.join(ROOT, "public", "plans", "[0-9]*.webp"))):
        zid = os.path.basename(f)[:-5]
        o = outlines(f)
        if o:
            res[zid] = o
    with open(OUT, "w") as fh:
        json.dump(res, fh, separators=(",", ":"))
    print(f"{len(res)} plans with services land, {sum(len(v) for v in res.values())} areas → {os.path.relpath(OUT, ROOT)}")


if __name__ == "__main__":
    main()
