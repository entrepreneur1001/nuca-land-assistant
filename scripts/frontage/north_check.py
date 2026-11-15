"""
Checks every zone's north against the official north arrow («اتجاه الشمال»). The zone plans themselves carry no
compass, but each project's slide on lands.nuca.gov.eg (ViewProject.aspx → mainproject.jpg, 972×388) shows the same
drawing with a north arrow in its footer: the arrow turns with the drawing (straight up for most projects, 45° for
Sadat's 4th district). The angle read off the arrow is compared with the north of the zone's registration
(scripts/plans/reg/<zid>.json), and the slide's drawing with the zone plan (same street directions?).

    python3 scripts/frontage/north_check.py [--refresh]      # run from the repo root
Slides are cached in data/frontage/slides (git-ignored); --refresh downloads them again. Needs public/dev-snapshot
(zone → project). Writes scripts/frontage/north.json:
    {zid: {"arrowDeg": north on the slide, degrees clockwise from image-up (null = not read),
           "regDeg":   the same angle according to the registration,
           "diffDeg":  arrowDeg − regDeg (null = not read),
           "turnDeg":  how far the slide's street grid is turned from the zone plan's, −45…45 (null = not measured)}}
scripts/frontage/build.mts gives "high" confidence only to zones whose arrow agrees. The arrow icon is ~20 px wide, so
this catches wrong quadrants and 45° turns, not errors of a few degrees.
"""
import json
import math
import os
import re
import sys
import time
from urllib.parse import urljoin
from urllib.request import Request, urlopen

import cv2
import numpy as np

ROOT = os.getcwd()
BASE = "https://lands.nuca.gov.eg/ar/"
CACHE = os.path.join(ROOT, "data", "frontage", "slides")
OUT = os.path.join(ROOT, "scripts", "frontage", "north.json")
UA = {"User-Agent": "Mozilla/5.0"}
# The arrow's circle in a 972×388 slide.
ICON = (632.5, 374.0)


def get(url, tries=3):
    err = None
    for i in range(tries):
        try:
            time.sleep(0.7)
            with urlopen(Request(url, headers=UA), timeout=30) as r:
                if r.geturl().endswith("Error.aspx"):
                    raise RuntimeError("redirect to Error.aspx")
                return r.read()
        except Exception as e:  # noqa: BLE001
            err = e
            time.sleep(2.0 * (i + 1))
    raise err


def slide(pid, refresh):
    path = os.path.join(CACHE, f"{pid}.jpg")
    if refresh or not os.path.exists(path):
        html = get(BASE + f"ViewProject.aspx?ID={pid}").decode("utf-8", "ignore")
        m = re.search(r'(\.\./Images/DataImages/[^"\']+mainproject[^"\']*)', html)
        if not m:
            return None
        data = get(urljoin(BASE, m.group(1)))
        if not data.startswith(b"\xff\xd8"):
            return None
        os.makedirs(CACHE, exist_ok=True)
        open(path, "wb").write(data)
    return cv2.imread(path)


def clockwise_from_up(dx, dy):
    return math.degrees(math.atan2(dx, -dy))


def arrow_angle(im):
    """North on the slide, degrees clockwise from image-up, from the footer icon: a gold arrowhead in a ring that
    carries a white tick where the arrow points. None when the two do not agree."""
    h, w = im.shape[:2]
    if (w, h) != (972, 388):
        im = cv2.resize(im, (972, 388), interpolation=cv2.INTER_AREA)
    cx, cy = ICON
    x0, y0 = int(cx) - 20, int(cy) - 19
    box = im[y0:y0 + 34, x0:x0 + 41].astype(int)
    b, g, r = box[:, :, 0], box[:, :, 1], box[:, :, 2]
    yy, xx = np.mgrid[y0:y0 + box.shape[0], x0:x0 + box.shape[1]]
    dist = np.hypot(xx - cx, yy - cy)
    gold = (r > 150) & (g > 120) & (b < 140) & (r - b > 50) & (dist < 9.5)
    if gold.sum() < 12:
        return None
    gx, gy = xx[gold], yy[gold]
    mx, my = gx.mean(), gy.mean()
    # The white tick: the largest bright blob sitting on the ring (the page above the footer is white too, but not a
    # small blob inside the ring's reach).
    white = ((r > 215) & (g > 215) & (b > 215)).astype(np.uint8)
    n, labels, stats, cents = cv2.connectedComponentsWithStats(white, connectivity=8)
    best = None
    for i in range(1, n):
        area = stats[i, cv2.CC_STAT_AREA]
        d = math.hypot(cents[i][0] + x0 - cx, cents[i][1] + y0 - cy)
        if 3 <= area <= 14 and 10.0 <= d <= 14.5 and (best is None or area > best[0]):
            best = (area, cents[i][0] + x0 - cx, cents[i][1] + y0 - cy)
    if best is None:
        return None
    tick = clockwise_from_up(best[1], best[2])
    # The arrowhead must point the same way: narrow towards the tick, wide (the notched tail) away from it.
    ax, ay = math.sin(math.radians(tick)), -math.cos(math.radians(tick))
    u = (gx - mx) * ax + (gy - my) * ay
    v = np.abs(-(gx - mx) * ay + (gy - my) * ax)
    front, back = v[u > 0.5], v[u < -0.5]
    if not len(front) or not len(back) or front.mean() >= back.mean():
        return None
    return round(tick, 1)


def grid_angle(im):
    """Direction of the drawing's street grid, 0–90°: the strongest edge direction, folded to a quarter turn."""
    gray = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY).astype(np.float32)
    gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    mag = np.hypot(gx, gy)
    keep = mag > 60
    if keep.sum() < 500:
        return None
    ang = np.degrees(np.arctan2(gy[keep], gx[keep])) % 90
    hist, _ = np.histogram(ang, bins=180, range=(0, 90), weights=mag[keep])
    hist = np.convolve(np.concatenate([hist[-4:], hist, hist[:4]]), np.ones(5) / 5, mode="same")[4:-4]
    return (int(np.argmax(hist)) + 0.5) / 2


def fold(d, period):
    d = (d + period / 2) % period - period / 2
    return d


def main():
    refresh = "--refresh" in sys.argv
    meta = json.load(open(os.path.join(ROOT, "public", "dev-snapshot", "meta.json")))
    zones = {z["zid"]: z for z in meta["official"]["zones"]}
    have = sorted(int(f[:-5]) for f in os.listdir(os.path.join(ROOT, "public", "plans")) if re.fullmatch(r"\d+\.json", f))
    out = {}
    slides = {}
    for zid in have:
        reg = json.load(open(os.path.join(ROOT, "scripts", "plans", "reg", f"{zid}.json")))
        M = reg["affine"]
        # Image-up in Mercator is (−M01, −M11); north on the image is that bearing, negated.
        reg_deg = -math.degrees(math.atan2(-M[0][1], -M[1][1]))
        row = {"arrowDeg": None, "regDeg": round(reg_deg, 1), "diffDeg": None, "turnDeg": None}
        out[str(zid)] = row
        z = zones.get(zid)
        if not z:
            continue
        pid = z["pid"]
        if pid not in slides:
            try:
                slides[pid] = slide(pid, refresh)
            except Exception as e:  # noqa: BLE001
                print(f"project {pid}: slide not fetched ({e})", flush=True)
                slides[pid] = None
        im = slides[pid]
        if im is None:
            continue
        a = arrow_angle(im)
        if a is not None:
            row["arrowDeg"] = a
            row["diffDeg"] = round(fold(a - reg_deg, 360), 1)
        plan = cv2.imread(os.path.join(ROOT, "public", "plans", f"{zid}.webp"))
        s = im.shape[1] / 972.0
        ga = grid_angle(im[int(8 * s):int(350 * s), int(8 * s):int(612 * s)])
        gb = grid_angle(plan) if plan is not None else None
        if ga is not None and gb is not None:
            row["turnDeg"] = round(fold(ga - gb, 90), 1)
        print(f"zone {zid} (project {pid}): arrow {row['arrowDeg']}, registration {row['regDeg']}, diff {row['diffDeg']}, slide turned {row['turnDeg']}", flush=True)
    json.dump(out, open(OUT, "w"), indent=0, sort_keys=True)
    read = [r for r in out.values() if r["diffDeg"] is not None]
    off = sorted(z for z, r in out.items() if r["diffDeg"] is not None and abs(r["diffDeg"]) > 12)
    print(f"\n{len(out)} zones, arrow read for {len(read)}, disagree by more than 12°: {', '.join(off) or 'none'}")
    print("not read:", ", ".join(sorted(z for z, r in out.items() if r["diffDeg"] is None)) or "none")


main()
