"""Download Nawy's compounds, gently: one request at a time with a pause, and nothing fetched twice.
usage: python3 fetch_nawy.py <out dir> list|detail|images [--limit N]
  list    <out>/list/<lang>_<page>.json: every compound with its outline, in English and Arabic (18 pages each).
  detail  <out>/detail/<id>.json ({masterPlan}): read from each compound's page, the only place the master plan is named.
  images  <out>/master/<id>.<ext>: the master-plan images.
Existing files are kept, so a step can simply be run again after failures. Repeated refusals (403/429) stop the run:
the site is asking us to back off, and pushing harder only gets the address blocked.
Nawy's terms forbid automated collection without their permission; this is run once, by the owner's decision.
"""
import sys, os, re, json, time
from urllib.request import Request, urlopen
from urllib.parse import quote, urlsplit, urlunsplit
from urllib.error import HTTPError
OUT, STEP = sys.argv[1:3]
LIMIT = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else None
API = "https://listing-api.nawy.com/v1/search/compounds"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
PAGE = 50  # the most the API accepts
refused = 0
def say(*a): print(*a, flush=True)
def get(url, headers=None, pause=1.5, tries=3):
    global refused
    err = None
    for i in range(tries):
        time.sleep(pause)
        try:
            with urlopen(Request(url, headers={"User-Agent": UA, **(headers or {})}), timeout=40) as r:
                refused = 0
                return r.read()
        except HTTPError as e:
            err = e
            if e.code == 404: raise
            if e.code in (403, 429):
                refused += 1
                if refused >= 4: say("refused repeatedly, stopping:", e.code, url); sys.exit(2)
                time.sleep(60 * refused)
        except Exception as e:
            err = e
        time.sleep(5 * (i + 1))
    raise err
def save(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path + ".part", "wb") as f: f.write(data)
    os.replace(path + ".part", path)
def compounds(lang="en"):
    out, p = [], 1
    while os.path.exists(f"{OUT}/list/{lang}_{p}.json"):
        out += json.load(open(f"{OUT}/list/{lang}_{p}.json"))["results"]; p += 1
    return out
def enc(url):  # the image URLs come with raw spaces
    s = urlsplit(url)
    return urlunsplit((s.scheme, s.netloc, quote(s.path, safe="/%"), s.query, ""))

if STEP == "list":
    for lang in ("en", "ar"):
        p, total = 1, None
        while total is None or (p - 1) * PAGE < total:
            path = f"{OUT}/list/{lang}_{p}.json"
            if not os.path.exists(path):
                save(path, get(f"{API}?page={p}&pageSize={PAGE}", {"Accept-Language": lang, "platform": "web", "Accept": "application/json"}))
            d = json.load(open(path)); total = d["total"]
            say(lang, "page", p, len(d["results"]), "of", total); p += 1
elif STEP == "detail":
    done = failed = 0
    for c in compounds():
        path = f"{OUT}/detail/{c['id']}.json"
        if os.path.exists(path): continue
        if LIMIT is not None and done >= LIMIT: break
        try:
            html = get(f"https://www.nawy.com/compound/{c['id']}-{quote(c['slug'])}", {"Accept-Language": "en"}, pause=2.0).decode("utf-8", "ignore")
            m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.S)
            comp = json.loads(m.group(1))["props"]["pageProps"]["compound"]
            save(path, json.dumps({"masterPlan": comp.get("masterPlan"), "nameAr": None}).encode())
            done += 1; say("detail", c["id"], c["name"], "plan" if comp.get("masterPlan") else "-")
        except HTTPError as e:
            if e.code == 404: save(path, json.dumps({"masterPlan": None, "missing": True}).encode()); say("404", c["id"], c["name"])
            else: failed += 1; say("FAIL", c["id"], c["name"], repr(e))
        except Exception as e:
            failed += 1; say("FAIL", c["id"], c["name"], repr(e))
    say(f"done {done}, failed {failed}")
elif STEP == "images":
    done = failed = 0
    for c in compounds():
        dp = f"{OUT}/detail/{c['id']}.json"
        url = json.load(open(dp)).get("masterPlan") if os.path.exists(dp) else None
        if not url: continue
        ext = os.path.splitext(urlsplit(url).path)[1].lower() or ".jpg"
        path = f"{OUT}/master/{c['id']}{ext}"
        if os.path.exists(path) or os.path.exists(path + ".missing"): continue
        if LIMIT is not None and done >= LIMIT: break
        try:
            save(path, get(enc(url), pause=0.7)); done += 1; say("image", c["id"], os.path.getsize(path) // 1024, "KB")
        except HTTPError as e:
            if e.code == 404: save(path + ".missing", b""); say("404", c["id"])
            else: failed += 1; say("FAIL", c["id"], repr(e))
        except Exception as e:
            failed += 1; say("FAIL", c["id"], repr(e))
    say(f"done {done}, failed {failed}")
else:
    sys.exit(__doc__)
