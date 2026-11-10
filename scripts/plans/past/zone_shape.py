"""The shape of a zone on its plan drawing, independent of the drawing's colours (shared by place_g.py and
export_past.py)."""
import math
import numpy as np, cv2

def zone_template(img):
    """(streets, zone, plot side px): streets = the gaps between blocks of plots; zone = the area the plots cover.
    Independent of the drawing's colours: a plot is a patch of clear paper of the common size enclosed by ink
    lines; blocks are plots joined across their shared borders; streets are what separates blocks."""
    H, W = img.shape[:2]; g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    bg = cv2.medianBlur(g, 2 * int(max(H, W) / 150) + 1)
    ink = ((bg.astype(int) - g.astype(int)) > 14).astype(np.uint8) * 255
    ink = cv2.dilate(ink, np.ones((2, 2), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(cv2.bitwise_not(ink), connectivity=4)
    A = H * W; area = st[:, 4]; bw, bh = st[:, 2], st[:, 3]
    ok = (area > A * 0.00006) & (area < A * 0.006) & (area > 0.45 * bw * bh) & (np.maximum(bw, bh) < 4.5 * np.minimum(bw, bh)); ok[0] = False
    if ok.sum() < 12: return None, None, None
    med = float(np.median(area[ok])); ok &= (area > med / 3.5) & (area < med * 3.5)
    plots = np.isin(lab, np.where(ok)[0]).astype(np.uint8) * 255
    side = math.sqrt(med); k = max(3, int(side * 0.3)) | 1
    blocks = cv2.morphologyEx(plots, cv2.MORPH_CLOSE, np.ones((k, k), np.uint8))
    r = int(side * 1.3) | 1
    zone = cv2.morphologyEx(blocks, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (r, r)))
    zone = cv2.dilate(zone, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (int(side * 0.5) | 1,) * 2))
    return cv2.bitwise_and(zone, cv2.bitwise_not(blocks)), zone, side
