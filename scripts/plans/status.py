"""Per-zone pipeline status table. usage: python3 status.py"""
import json, os, glob
counts = json.load(open("zone_counts.json")); zp = json.load(open("zone_plots.json"))
rows = []
for zid, c in counts.items():
    z = zp.get(zid, {"plots": []}); located = sum(1 for p in z["plots"] if p["lat"] is not None)
    dl = os.path.exists(f"plans/zone_{zid}.jpg"); ex = os.path.exists(f"plans/zone_{zid}.plots.json")
    reg = json.load(open(f"reg/{zid}.json")) if os.path.exists(f"reg/{zid}.json") else None
    expd = os.path.exists(f"export/{zid}.json")
    ocr = ""
    if ex:
        ps = json.load(open(f"plans/zone_{zid}.plots.json"))["plots"]; ocr = f"{sum(1 for p in ps if p['text'])}/{len(ps)}"
    rows.append((zid, c["city"], c["name"], c["n"], located, "dl" if dl else "", ocr, f"{reg['how']} rms{(reg.get('rms_m') or 0):.1f} m{reg['matched']}" if reg else "", "exp" if expd else ""))
print(f"{'zid':>5} {'n':>4} {'loc':>4} {'dl':>2} {'ocr':>8} {'registration':>22} {'exp':>3}  city / zone")
for r in rows: print(f"{r[0]:>5} {r[3]:>4} {r[4]:>4} {r[5]:>2} {r[6]:>8} {r[7]:>22} {r[8]:>3}  {r[1]} / {r[2]}")
print(f"\n{sum(1 for r in rows if r[5])} downloaded, {sum(1 for r in rows if r[6])} extracted, {sum(1 for r in rows if r[7])} registered, {sum(1 for r in rows if r[8])} exported of {len(rows)}; unplaced zones: {sum(1 for r in rows if r[4] == 0)}")
