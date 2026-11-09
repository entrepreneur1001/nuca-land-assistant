"""2x overview with assigned number and polygon index under each plot's centre. usage: overview2x.py <zid> <out.jpg> [x0 y0 x1 y1 in plan px]"""
import sys, json, cv2, numpy as np
z, out = sys.argv[1:3]
img = cv2.imread(f'plans/zone_{z}.jpg'); ps = json.load(open(f'plans/zone_{z}.plots.json'))['plots']
allp = np.vstack([np.array(p['poly']) for p in ps]); x0, y0 = np.maximum(allp.min(0) - 15, 0); x1, y1 = allp.max(0) + 15
if len(sys.argv) > 6: x0, y0, x1, y1 = map(int, sys.argv[3:7])
f = 2 if img.shape[1] < 3000 else 1
img = cv2.resize(img[y0:y1, x0:x1], None, fx=f, fy=f, interpolation=cv2.INTER_CUBIC)
for i, p in enumerate(ps):
    c = (200, 0, 0) if p['text'] else (0, 0, 255); q = (np.array(p['poly'], np.int32) - [x0, y0]) * f
    cv2.polylines(img, [q], True, c, 1); cx, cy = q.mean(0).astype(int)
    cv2.putText(img, (p['text'] or '?') + f'#{i}', (int(cx) - 22, int(cy) + 26), cv2.FONT_HERSHEY_SIMPLEX, 0.4, c, 1)
cv2.imwrite(out, img)
