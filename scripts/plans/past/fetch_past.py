"""Download the plan images of earlier-stage zones, gently: one zone at a time, four tile requests at once, and
only as much detail as the maps show. (fetch_plans.py with several copies running made the official site time out.)
usage: python3 fetch_past.py <out dir> <zones.tsv from scripts/tools/list-past-zones.mts> [--min-px 1600]
Per zone: <out>/zone_<zid>.jpg, stitched from the smallest Deep Zoom level at least --min-px on its long side, and
<out>/zone_<zid>.src.json ({xml, level, w, h, full_w, full_h}). Per project: its slide(s) as project_<pid>_<name>.
Existing files are kept, so the script can simply be run again after failures.
"""
import re, sys, time, math, io, os, json
from urllib.request import Request, urlopen
from urllib.parse import urljoin
from concurrent.futures import ThreadPoolExecutor
from PIL import Image
BASE = "https://lands.nuca.gov.eg/ar/"
OUT, TSV = sys.argv[1:3]
MIN_PX = int(sys.argv[sys.argv.index("--min-px") + 1]) if "--min-px" in sys.argv else 1600
UA = {"User-Agent": "Mozilla/5.0"}
def get(url, tries=4):
    err = None
    for i in range(tries):
        try:
            time.sleep(0.15)
            with urlopen(Request(url, headers=UA), timeout=25) as r:
                if r.geturl().endswith("Error.aspx"): raise RuntimeError("redirect to Error.aspx")
                return r.read()
        except Exception as e:
            err = e; time.sleep(4 * (i + 1))
    raise err
def say(*a): print(*a, flush=True)
def stitch(xml_url, path):
    xml = get(xml_url).decode("utf-8-sig")
    ts, ov = int(re.search(r'TileSize="(\d+)"', xml).group(1)), int(re.search(r'Overlap="(\d+)"', xml).group(1))
    fmt = re.search(r'Format="(\w+)"', xml).group(1)
    fw, fh = int(re.search(r'Width="(\d+)"', xml).group(1)), int(re.search(r'Height="(\d+)"', xml).group(1))
    top = math.ceil(math.log2(max(fw, fh))); lvl = top
    while lvl > 0 and math.ceil(max(fw, fh) / 2 ** (top - lvl + 1)) >= MIN_PX: lvl -= 1
    k = 2 ** (top - lvl); w, h = math.ceil(fw / k), math.ceil(fh / k)
    cols, rows = math.ceil(w / ts), math.ceil(h / ts)
    img = Image.new("RGB", (w, h), "white")
    def tile(cr):
        c, r = cr
        return cr, Image.open(io.BytesIO(get(f"{xml_url[:-4]}_files/{lvl}/{c}_{r}.{fmt}")))
    with ThreadPoolExecutor(4) as ex:
        for (c, r), t in ex.map(tile, [(c, r) for c in range(cols) for r in range(rows)]):
            img.paste(t, (c * ts - (ov if c else 0), r * ts - (ov if r else 0)))
    img.save(path, quality=92)
    json.dump({"xml": xml_url, "level": lvl, "w": w, "h": h, "full_w": fw, "full_h": fh}, open(path[:-4] + ".src.json", "w"))
    say("plan", path, f"{w}x{h} of {fw}x{fh}", f"{cols * rows} tiles")
rows = [l.rstrip("\n").split("\t") for l in open(TSV, encoding="utf-8") if l.strip()]
seen_pid = set(); failed = 0
for zid, pid, cid, city, name, *_ in rows:
    try:
        if pid not in seen_pid:
            seen_pid.add(pid)
            if not any(f.startswith(f"project_{pid}_") for f in os.listdir(OUT)):
                html = get(BASE + f"ViewProject.aspx?ID={pid}").decode("utf-8", "ignore")
                for m in set(re.findall(r'(\.\./Images/DataImages/[^"\']+)', html)):
                    if "icon" in m.lower() or "main" not in os.path.basename(m).lower(): continue
                    open(f"{OUT}/project_{pid}_{os.path.basename(m)}", "wb").write(get(urljoin(BASE, m))); say("slide", pid, os.path.basename(m))
        path = f"{OUT}/zone_{zid}.jpg"
        if os.path.exists(path): continue
        html = get(BASE + f"ViewZone.aspx?ID={zid}").decode("utf-8", "ignore")
        m = re.search(r"TileSource\s*=\s*'([^']+)'", html)
        if not m: say("NO TileSource", zid, name); continue
        stitch(urljoin(BASE, m.group(1)), path)
        time.sleep(1.0)
    except Exception as e:
        failed += 1; say("FAIL", zid, name, repr(e)); time.sleep(20)
say(f"done, {failed} failed")
