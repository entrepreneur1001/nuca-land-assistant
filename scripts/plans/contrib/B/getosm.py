"""OSM highways via the main OSM API (map?bbox), since Overpass mirrors are down. usage: getosm.py <key> <lat> <lng> <radius m>
Writes osm/<key>.json in the osm_roads.py format."""
import sys, json, subprocess, os, math
import xml.etree.ElementTree as ET
key, lat, lng, rad = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), int(sys.argv[4])
f = f"osm/{key}.json"
dlat = rad / 111320; dlng = rad / (111320 * math.cos(math.radians(lat)))
ways = {}
N = 2 if rad > 1500 else 1
for i in range(N):
    for j in range(N):
        w = lng - dlng + 2 * dlng * i / N; e = lng - dlng + 2 * dlng * (i + 1) / N; s = lat - dlat + 2 * dlat * j / N; n = lat - dlat + 2 * dlat * (j + 1) / N
        r = subprocess.run(["curl", "-s", "-m", "120", "-A", "plan-georef/1.0", f"https://api.openstreetmap.org/api/0.6/map?bbox={w:.5f},{s:.5f},{e:.5f},{n:.5f}"], capture_output=True)
        try: root = ET.fromstring(r.stdout)
        except Exception as ex: print("fail tile", i, j, r.stdout[:200]); continue
        nodes = {nd.get("id"): [float(nd.get("lat")), float(nd.get("lon"))] for nd in root.findall("node")}
        for wy in root.findall("way"):
            tags = {t.get("k"): t.get("v") for t in wy.findall("tag")}
            if "highway" not in tags: continue
            pts = [nodes[nd.get("ref")] for nd in wy.findall("nd") if nd.get("ref") in nodes]
            if len(pts) > len(ways.get(wy.get("id"), {"pts": []})["pts"]): ways[wy.get("id")] = {"id": int(wy.get("id")), "hw": tags["highway"], "name": tags.get("name"), "pts": pts}
json.dump({"centre": [lat, lng], "radius": rad, "ways": list(ways.values())}, open(f, "w")); print(key, len(ways), "ways")
