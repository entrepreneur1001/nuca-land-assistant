"""Find the yellow project pins on a NUCA city master plan and print their tip pixel (bottom of the pin) and label.
usage: python3 pins.py <masterplan.jpg> [x1 limit of the map area, default 790]
"""
import sys, cv2, numpy as np
img = cv2.imread(sys.argv[1]); xlim = int(sys.argv[2]) if len(sys.argv) > 2 else 790
hsv = cv2.cvtColor(img[:, :xlim], cv2.COLOR_BGR2HSV)
m = cv2.inRange(hsv, (18, 120, 150), (35, 255, 255))
m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
n, lab, st, cen = cv2.connectedComponentsWithStats(m, connectivity=8)
for i in range(1, n):
    x, y, w, h, a = st[i]
    if a < 150 or w > 60 or h > 80 or y < 20 or y > img.shape[0] - 80: continue
    col = (lab[y:y + h, x:x + w] == i)
    # tip: lowest row of the component, at its horizontal centre
    ys, xs = np.where(col); tipy = y + ys.max(); tipx = x + int(np.median(xs[ys == ys.max()]))
    print(f"pin bbox ({x},{y},{w},{h}) area {a} tip ({tipx},{tipy}) centre ({cen[i][0]:.0f},{cen[i][1]:.0f})")
