"""Street and zone masks for place_g.py --template, for drawings where zone_shape.zone_template (outlined plots)
does not give a usable street pattern.
usage: python3 street_mask.py <plan.jpg> <out prefix> <method> [options]  → <prefix>.streets.png, <prefix>.zone.png, <prefix>.jpg (check picture)
methods:
  grey [--v lo,hi] [--s max]   streets are drawn in a neutral grey between lo and hi brightness (district sheets
                               whose plots are too fine to outline); zone = the area the streets enclose.
  plots [--ink 14] [--min f] [--max f] [--whole]
                               like zone_template with a chosen ink threshold and plot-size range (fractions of the
                               image area); --whole takes every block on the drawing rather than plots of one size.
  --crop x0,y0,x1,y1           (any method) keep only this part of the drawing in the zone mask.
"""
import sys, math
import numpy as np, cv2
def opt(name, default=None): return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default
src, out, method = sys.argv[1:4]
img = cv2.imread(src); H, W = img.shape[:2]
if method == "grey":
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV); lo, hi = map(int, opt("--v", "165,200").split(",")); smax = int(opt("--s", "14"))
    road = ((hsv[..., 1] < smax) & (hsv[..., 2] > lo) & (hsv[..., 2] < hi)).astype(np.uint8) * 255
    k = max(3, int(max(H, W) / 400)) | 1
    road = cv2.morphologyEx(road, cv2.MORPH_CLOSE, np.ones((k, k), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(road, connectivity=8)
    streets = np.isin(lab, [i for i in range(1, n) if st[i, 4] > H * W * 0.002]).astype(np.uint8) * 255
    # zone: the streets and the blocks they enclose (holes of the street network that do not touch the border)
    n, lab, st, _ = cv2.connectedComponentsWithStats(cv2.bitwise_not(streets), connectivity=4)
    inner = [i for i in range(1, n) if st[i, 0] > 0 and st[i, 1] > 0 and st[i, 0] + st[i, 2] < W and st[i, 1] + st[i, 3] < H and st[i, 4] < H * W * 0.03]
    zone = cv2.bitwise_or(np.isin(lab, inner).astype(np.uint8) * 255, 0)
    r = max(5, int(max(H, W) / 60)) | 1
    zone = cv2.dilate(zone, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (r, r)))
    streets = cv2.bitwise_and(streets, zone)
else:
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY); bg = cv2.medianBlur(g, 2 * int(max(H, W) / 150) + 1)
    ink = ((bg.astype(int) - g.astype(int)) > int(opt("--ink", "14"))).astype(np.uint8) * 255
    ink = cv2.dilate(ink, np.ones((2, 2), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(cv2.bitwise_not(ink), connectivity=4)
    A = H * W; area = st[:, 4]; bw, bh = st[:, 2], st[:, 3]
    ok = (area > A * float(opt("--min", "0.00006"))) & (area < A * float(opt("--max", "0.006"))) & (area > 0.45 * bw * bh) & (np.maximum(bw, bh) < 4.5 * np.minimum(bw, bh)); ok[0] = False
    if ok.sum() < 3: sys.exit("no plots found")
    med = float(np.median(area[ok]))
    if "--whole" not in sys.argv: ok &= (area > med / 3.5) & (area < med * 3.5)
    plots = np.isin(lab, np.where(ok)[0]).astype(np.uint8) * 255
    side = math.sqrt(med); k = max(3, int(side * 0.3)) | 1
    blocks = cv2.morphologyEx(plots, cv2.MORPH_CLOSE, np.ones((k, k), np.uint8))
    r = int(side * float(opt("--join", "1.3"))) | 1
    zone = cv2.morphologyEx(blocks, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (r, r)))
    zone = cv2.dilate(zone, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (int(side * 0.5) | 1,) * 2))
    streets = cv2.bitwise_and(zone, cv2.bitwise_not(blocks))
    print(f"{int(ok.sum())} plots, side {side:.1f} px → scale prior {29 / side:.3f} m/px")
if opt("--crop"):
    x0, y0, x1, y1 = map(int, opt("--crop").split(",")); m = np.zeros_like(zone); m[y0:y1, x0:x1] = 255
    zone = cv2.bitwise_and(zone, m); streets = cv2.bitwise_and(streets, m)
cv2.imwrite(out + ".streets.png", streets); cv2.imwrite(out + ".zone.png", zone)
o = img.copy(); o[zone == 0] = o[zone == 0] // 3; o[streets > 0] = (0, 0, 255)
f = min(1.0, 1300 / max(H, W)); cv2.imwrite(out + ".jpg", cv2.resize(o, None, fx=f, fy=f, interpolation=cv2.INTER_AREA), [cv2.IMWRITE_JPEG_QUALITY, 80])
print(f"streets {streets.mean() / 255:.1%} of the image, zone {zone.mean() / 255:.1%}")
