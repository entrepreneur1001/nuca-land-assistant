"""Enlarged crop with a labelled pixel grid (source-image pixel coordinates), for reading control points by eye.
usage: python3 gridzoom.py <img> <out> x0,y0,x1,y1 <factor> <grid px>"""
import sys, cv2
im = cv2.imread(sys.argv[1]); x0, y0, x1, y1 = map(int, sys.argv[3].split(",")); f = float(sys.argv[4]); g = int(sys.argv[5])
c = cv2.resize(im[y0:y1, x0:x1], None, fx=f, fy=f, interpolation=cv2.INTER_CUBIC)
for x in range((x0 // g + 1) * g, x1, g):
    p = int((x - x0) * f); cv2.line(c, (p, 0), (p, c.shape[0]), (255, 255, 0), 1); cv2.putText(c, str(x), (p + 2, 12), 0, 0.4, (0, 0, 255), 1)
for y in range((y0 // g + 1) * g, y1, g):
    p = int((y - y0) * f); cv2.line(c, (0, p), (c.shape[1], p), (255, 255, 0), 1); cv2.putText(c, str(y), (2, p - 2), 0, 0.4, (0, 0, 255), 1)
cv2.imwrite(sys.argv[2], c)
