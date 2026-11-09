"""Build public/plans/index.json from the exported zone files.
usage: python3 build_index.py <export dir> <zone_plots.json> <out index.json>
index: {"zones": {"<zid>": {"city", "name", "sector": "<sector id>|null", "bounds": [[south, west], [north, east]], "plots": <count>}}}
"""
import sys, json, os, glob
exp, zpf, out = sys.argv[1:4]
zp = json.load(open(zpf))
zones = {}
for f in sorted(glob.glob(f"{exp}/*.json")):
    zid = os.path.basename(f)[:-5]
    if zid == "index": continue
    d = json.load(open(f)); c = d["corners"]
    br = [c["tr"][0] + (c["bl"][0] - c["tl"][0]), c["tr"][1] + (c["bl"][1] - c["tl"][1])]
    pts = [c["tl"], c["tr"], c["bl"], br]
    z = zp[zid]
    zones[zid] = {"city": z["city"], "name": z["name"], "sector": z["sector"], "bounds": [[round(min(p[0] for p in pts), 6), round(min(p[1] for p in pts), 6)], [round(max(p[0] for p in pts), 6), round(max(p[1] for p in pts), 6)]], "plots": len(d["plots"])}
json.dump({"zones": zones}, open(out, "w"), ensure_ascii=False, separators=(",", ":"))
print(len(zones), "zones in index")
