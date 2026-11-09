"""Contact sheets for eye checks. usage: sheet.py <out prefix> <items.json>  items: [[zid, polygon index], ...] (plots from res/)"""
import sys, json, cv2, numpy as np
pre, items = sys.argv[1], json.load(open(sys.argv[2]))
S, CW, CH, COLS, ROWS = 7, 46, 26, 6, 5
cache = {}
def zone(z):
    if z not in cache: cache[z] = (cv2.imread(f"plans/zone_{z}.jpg"), json.load(open(f"res/zone_{z}.plots.json"))["plots"])
    return cache[z]
tiles = []
for z, i in items:
    im, ps = zone(z); p = ps[i]; a = np.array(p["poly"], float); cx, cy = a.mean(0)
    x0, y0 = int(cx - CW / 2), int(cy - CH / 2)
    pad = cv2.copyMakeBorder(im, CH, CH, CW, CW, cv2.BORDER_CONSTANT, value=(255, 255, 255))
    c = cv2.resize(pad[y0 + CH:y0 + 2 * CH, x0 + CW:x0 + 2 * CW], None, fx=S, fy=S, interpolation=cv2.INTER_CUBIC)
    cv2.polylines(c, [((a - [x0, y0]) * S).astype(np.int32)], True, (255, 0, 0), 1)
    t = np.full((CH * S + 26, CW * S + 4, 3), 255, np.uint8); t[:CH * S, 2:-2] = c
    cv2.putText(t, f"{len(tiles)+1}) z{z} #{i} -> {p['text']} [{p['method']}]", (4, CH * S + 19), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 0, 0), 1, cv2.LINE_AA)
    tiles.append(t)
per = COLS * ROWS
for s in range(0, len(tiles), per):
    chunk = tiles[s:s + per]
    while len(chunk) % COLS: chunk.append(np.full_like(tiles[0], 255))
    rows = [np.hstack(chunk[r:r + COLS]) for r in range(0, len(chunk), COLS)]
    cv2.imwrite(f"{pre}_{s // per + 1}.png", np.vstack(rows))
print(len(tiles), "tiles")
