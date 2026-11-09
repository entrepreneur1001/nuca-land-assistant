import re, sys, time, math, io, csv, os, json
from urllib.request import Request, urlopen
from urllib.parse import urljoin
from PIL import Image
from concurrent.futures import ThreadPoolExecutor
BASE = "https://lands.nuca.gov.eg/ar/"
OUT = sys.argv[1]; TSV = sys.argv[2]
UA = {"User-Agent": "Mozilla/5.0"}
def get(url, tries=3):
    for i in range(tries):
        try:
            time.sleep(0.1)
            with urlopen(Request(url, headers=UA), timeout=20) as r:
                if r.geturl().endswith("Error.aspx"): raise RuntimeError("redirect to Error.aspx")
                return r.read()
        except Exception as e:
            err = e; time.sleep(1.5 * (i + 1))
    raise err
log = []
def note(*a):
    s = " ".join(str(x) for x in a); print(s, flush=True); log.append(s)
done_img = set()
def save_img(url, path):
    if path in done_img or os.path.exists(path): return
    try:
        open(path, "wb").write(get(url)); done_img.add(path); note("img", path)
    except Exception as e: note("FAIL img", url, e)
def stitch_dzi(xml_url, path):
    if os.path.exists(path): return
    xml = get(xml_url).decode("utf-8-sig")
    ts = int(re.search(r'TileSize="(\d+)"', xml).group(1)); ov = int(re.search(r'Overlap="(\d+)"', xml).group(1))
    fmt = re.search(r'Format="(\w+)"', xml).group(1)
    w = int(re.search(r'Width="(\d+)"', xml).group(1)); h = int(re.search(r'Height="(\d+)"', xml).group(1))
    lvl = math.ceil(math.log2(max(w, h)))
    folder = xml_url[:-4] + "_files/%d/" % lvl
    img = Image.new("RGB", (w, h), "white")
    cols, rows = math.ceil(w / ts), math.ceil(h / ts)
    def tile(cr):
        c, r = cr
        return cr, Image.open(io.BytesIO(get(f"{folder}{c}_{r}.{fmt}", tries=4)))
    with ThreadPoolExecutor(16) as ex:
        for (c, r), t in ex.map(tile, [(c, r) for c in range(cols) for r in range(rows)]):
            img.paste(t, (c * ts - (ov if c else 0), r * ts - (ov if r else 0)))
    img.save(path, quality=92); note("plan", path, f"{w}x{h}", f"{cols*rows} tiles")
rows = [l.rstrip("\n").split("\t") for l in open(TSV, encoding="utf-8")]
only_missing = "--all" not in sys.argv
for zid, pid, cid, city, name, flag, secs in rows:
    if only_missing and flag != "MISSING": continue
    try:
        chtml = get(BASE + f"ViewCity.aspx?ID={cid}").decode("utf-8", "ignore")
        for m in set(re.findall(r'(\.\./Images/DataImages/[^"\']+masterplan[^"\']*)', chtml)):
            save_img(urljoin(BASE, m), f"{OUT}/city_{cid}_{os.path.basename(m)}")
        phtml = get(BASE + f"ViewProject.aspx?ID={pid}").decode("utf-8", "ignore")
        for m in set(re.findall(r'(\.\./Images/DataImages/[^"\']+)', phtml)):
            if "icon" in m.lower(): continue
            save_img(urljoin(BASE, m), f"{OUT}/project_{pid}_{os.path.basename(m)}")
        zhtml = get(BASE + f"ViewZone.aspx?ID={zid}").decode("utf-8", "ignore")
        m = re.search(r"TileSource\s*=\s*'([^']+)'", zhtml)
        if not m: note("NO TileSource", zid, city, name); continue
        xml_url = urljoin(BASE, m.group(1)); note("zone", zid, city, name, xml_url)
        stitch_dzi(xml_url, f"{OUT}/zone_{zid}.jpg")
    except Exception as e:
        note("FAIL zone", zid, city, name, repr(e))
open(f"{OUT}/log.txt", "a", encoding="utf-8").write("\n".join(log) + "\n")
