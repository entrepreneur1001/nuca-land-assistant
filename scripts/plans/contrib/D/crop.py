"""Context crops of polygons for eyeballing. usage: python3 crop.py <zid> <out.jpg> <poly index>... (tiles them in one image)"""
import sys, json, cv2, numpy as np
zid, out = sys.argv[1:3]; idx = [int(a) for a in sys.argv[3:]]
img = cv2.imread(f"plans/zone_{zid}.jpg"); polys = json.load(open(f"plans/zone_{zid}.plots.json"))["plots"]
tiles = []
for i in idx:
    x, y, w, h = polys[i]["bbox"]; m = int(1.2 * max(w, h)); cx, cy = x + w // 2, y + h // 2
    x0, y0 = max(0, cx - m), max(0, cy - m); c = img[y0:cy + m, x0:cx + m].copy()
    cv2.polylines(c, [np.array(polys[i]["poly"], np.int32) - [x0, y0]], True, (255, 0, 0), 2)
    c = cv2.resize(c, (360, 360), interpolation=cv2.INTER_CUBIC); cv2.putText(c, f"#{i}", (5, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 0, 255), 2); tiles.append(c)
rows = [np.hstack(tiles[k:k + 4] + [np.full((360, 360, 3), 255, np.uint8)] * (4 - len(tiles[k:k + 4]))) for k in range(0, len(tiles), 4)]
cv2.imwrite(out, np.vstack(rows))
