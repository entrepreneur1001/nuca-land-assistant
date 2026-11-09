"""Fetch OpenStreetMap highways around given centres (Overpass) and cache them as GeoJSON-ish line lists.
usage: python3 osm_roads.py <centres.json> <out dir> [radius m=4000]
centres.json: {"<key>": [lat, lng], ...}
"""
import sys, json, os, time
from urllib.request import Request, urlopen
from urllib.parse import urlencode
centres, out = json.load(open(sys.argv[1])), sys.argv[2]
radius = int(sys.argv[3]) if len(sys.argv) > 3 else 4000
os.makedirs(out, exist_ok=True)
EP = ["https://overpass.kumi.systems/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass-api.de/api/interpreter"]
for key, (lat, lng) in centres.items():
    f = f"{out}/{key}.json"
    if os.path.exists(f): continue
    q = f'[out:json][timeout:120];(way["highway"](around:{radius},{lat},{lng}););out geom;'
    for a in range(4):
        try:
            import subprocess
            r = subprocess.run(["curl", "-s", "-m", "200", "-A", "nuca-land-assistant/1.0 (personal, read-only)", "--data-urlencode", "data=" + q, EP[a % 3]], capture_output=True, check=True)
            d = json.loads(r.stdout)
            ways = [{"id": w["id"], "hw": w.get("tags", {}).get("highway"), "name": w.get("tags", {}).get("name"), "pts": [[p["lat"], p["lon"]] for p in w.get("geometry", [])]} for w in d.get("elements", []) if w.get("type") == "way"]
            json.dump({"centre": [lat, lng], "radius": radius, "ways": ways}, open(f, "w"))
            print(key, len(ways), "ways", flush=True); break
        except Exception as e:
            print(key, "retry", a, e, flush=True); time.sleep(15 * (a + 1))
    time.sleep(3)
