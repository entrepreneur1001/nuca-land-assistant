"""Place every compound master plan by its streets (place_compound.py), resumably, nearest-to-NUCA-land first.
usage: python3 -I loop.py <fetch dir> <public/compounds> [--jobs 4] [--near-only] [--ids a,b] [--redo] [--redo-status s,s] [--list]
State: <fetch dir>/place.json {id: {status, score, ratio, ..., corners, clip, W, H}}; written after every compound,
so the loop can be stopped and run again. Order: compounds within 3 km of NUCA land (public/plans/index.json zone
bounds and public/plans/past/index.json earlier-stage zones), then all others with a master plan.
status: "verified" (place_compound.is_clear), "ambiguous" (place_compound.worth_review: leads, but not clearly),
"fail" (no usable streets, inside not mapped by Google, or no clear lead). Previews for all go to
<fetch dir>/previews/<status>_<id>.jpg; the ambiguous ones are for review by eye.
Decisions by eye go into scripts/compounds/reviewed.json ({corners, clip, check: "eye"} or "hide"); then run
build_compounds.py. --list prints the near-NUCA ids and stops.
--accept a,b / --reject a,b: record review decisions on ambiguous previews in reviewed.json (accept: the matcher's
placement with check "eye"; reject: "reject", never published). --gallery N [--ids a,b] [--per 4]: for compounds whose master plan gave nothing usable (fail, or no master), fetch
their Nawy gallery images (list `images`) one request at a time, at most N requests in all and --per per compound,
into <fetch dir>/gallery/, and place each; the first clear match (or a better ambiguous one) replaces the state
entry, which then names its "image". Near-NUCA compounds first. Gallery images are mostly renders and photos:
--fetch-only downloads them, a contact sheet is looked at, and --pick id_k,id_k places only the chosen ones.
"""
import sys, os, site
sys.path.append(site.getusersitepackages())
import json, math, glob, time
from multiprocessing import Pool
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
SRC, PUB = sys.argv[1:3]
def opt(n, d=None): return sys.argv[sys.argv.index(n) + 1] if n in sys.argv else d
STATE = f"{SRC}/place.json"; PREV = f"{SRC}/previews"
NEAR_M = 3000
def near_ids(comps):
    """Compounds whose outline comes within 3 km of a NUCA zone (current plans or earlier stages)."""
    root = os.path.normpath(os.path.join(PUB, ".."))
    boxes = [z["bounds"] for z in json.load(open(f"{root}/plans/index.json"))["zones"].values()]
    past = f"{root}/plans/past/index.json"
    if os.path.exists(past): boxes += [z["bounds"] for z in json.load(open(past))["zones"].values() if z.get("bounds")]
    out = []
    for c in comps:
        (s, w), (n, e) = c["bounds"]; kx = 111320 * math.cos(math.radians((s + n) / 2)); ky = 110540
        for (bs, bw), (bn, be) in boxes:
            dx = max(0.0, bw - e, w - be) * kx; dy = max(0.0, bs - n, s - bn) * ky
            if math.hypot(dx, dy) <= NEAR_M: out.append(c["id"]); break
    return out
def work(args):
    cid, comp, fit, image = args
    import place_compound as P
    t = time.time()
    try:
        r = P.place(SRC, PUB, cid, image=image, comp=comp, fit=fit, preview=f"{PREV}/_{cid}.jpg")
    except Exception as e:
        r = {"id": cid, "fail": repr(e)}
    r["status"] = "fail" if "fail" in r else "verified" if r.get("clear") else "ambiguous" if P.worth_review(r) else "fail"
    if r["status"] == "fail" and "fail" not in r:
        r["fail"] = "inside not on Google's map" if r.get("gdens", 0) < 0.03 else "no clear match"
    r["secs"] = round(time.time() - t)
    p = f"{PREV}/_{cid}.jpg"
    if os.path.exists(p):
        os.replace(p, f"{PREV}/{r['status']}_{cid}.jpg")
    return r
def put(cid, entry):
    """Write one compound's entry into place.json under a lock, keeping what other runs (e.g. --gallery next to the
    main loop) wrote meanwhile."""
    import fcntl
    with open(STATE + ".lock", "w") as lk:
        fcntl.flock(lk, fcntl.LOCK_EX)
        cur = json.load(open(STATE)) if os.path.exists(STATE) else {}
        cur[str(cid)] = entry
        json.dump(cur, open(STATE + ".part", "w")); os.replace(STATE + ".part", STATE)
        return cur
def gallery(order, comps, fits, state, nearset, image_of):
    from urllib.request import Request, urlopen
    from urllib.parse import quote, urlsplit, urlunsplit
    budget, per = int(opt("--gallery")), int(opt("--per", "4"))
    pick = set(opt("--pick").split(",")) if opt("--pick") else None  # <id>_<k> images chosen by eye from a contact sheet
    lst = {}
    for f in sorted(glob.glob(f"{SRC}/list/en_*.json")):
        for c in json.load(open(f))["results"]: lst[c["id"]] = c
    gdir = f"{SRC}/gallery"; os.makedirs(gdir, exist_ok=True); os.makedirs(PREV, exist_ok=True); used = 0
    for cid in order:
        st = state.get(str(cid))
        if st and st.get("status") in ("verified", "ambiguous"): continue
        if st and st.get("gallery_tried"): continue
        urls = [u for u in (lst.get(cid, {}).get("images") or []) if u][:per]
        if not urls: continue
        best = st
        for k, url in enumerate(urls):
            f = f"{gdir}/{cid}_{k}.webp"
            if not os.path.exists(f):
                if used >= budget: break
                time.sleep(1.5); used += 1
                s_ = urlsplit(url)
                try:
                    with urlopen(Request(urlunsplit((s_.scheme, s_.netloc, quote(s_.path, safe="/%"), s_.query, "")), headers={"User-Agent": "Mozilla/5.0"}), timeout=40) as r:
                        data = r.read()
                    open(f + ".part", "wb").write(data); os.replace(f + ".part", f)
                except Exception as e:
                    print(cid, "gallery", k, repr(e), flush=True)
                    if "403" in repr(e) or "429" in repr(e): print("refused: stopping"); return
                    continue
            if "--fetch-only" in sys.argv: continue
            if pick is not None and f"{cid}_{k}" not in pick: continue
            r = work((cid, comps[cid], fits.get(str(cid)), f)); r["near"] = cid in nearset; r["gallery"] = k
            print(cid, "gallery", k, r["status"], r.get("score"), r.get("ratio"), r.get("fail", ""), flush=True)
            if r["status"] != "fail" and (not best or best.get("status") == "fail" or r.get("score", 0) > best.get("score", 0)):
                best = r
            if r["status"] == "verified": break
        else:
            if best is not None: best["gallery_tried"] = True
        if "--fetch-only" in sys.argv: continue
        if best is not None and best is not st: state[str(cid)] = best; put(cid, best)
        elif st is not None and len(urls) and all(os.path.exists(f"{gdir}/{cid}_{k}.webp") for k in range(len(urls))): st["gallery_tried"] = True; put(cid, st)
        if used >= budget: break
    print(f"gallery: {used} requests", flush=True)
if __name__ == "__main__":
    comps = {c["id"]: c for c in json.load(open(f"{PUB}/index.json"))["compounds"]}
    near = near_ids(comps.values())
    if "--list" in sys.argv: print(len(near), "near NUCA land:", " ".join(map(str, near))); sys.exit(0)
    fits = json.load(open(f"{SRC}/fits.json")) if os.path.exists(f"{SRC}/fits.json") else {}
    state = json.load(open(STATE)) if os.path.exists(STATE) else {}
    imgdir = opt("--image-dir")
    def image_of(cid):
        d = imgdir or f"{SRC}/master"
        f = [x for x in glob.glob(f"{d}/{cid}.*") if not x.endswith(".part")]
        return f[0] if f else None
    if opt("--accept") or opt("--reject"):
        rp = f"{HERE}/reviewed.json"; rv = json.load(open(rp))
        for cid in (opt("--accept") or "").split(","):
            if not cid: continue
            r = state[cid]; assert "corners" in r, cid
            rv[cid] = {"corners": r["corners"], "clip": r["clip"], "check": "eye", "w": r["W"], "h": r["H"]}
            if r.get("gallery") is not None: rv[cid]["image"] = os.path.basename(r["image"])
        for cid in (opt("--reject") or "").split(","):
            if cid: rv[cid] = "reject"
        json.dump(rv, open(rp, "w"), separators=(",", ":")); print("reviewed.json:", len(rv), "entries"); sys.exit(0)
    order = near + sorted(set(comps) - set(near))
    if opt("--gallery"):
        gallery(order if not opt("--ids") else [int(x) for x in opt("--ids").split(",")], comps, fits, state, set(near), image_of)
        sys.exit(0)
    if "--near-only" in sys.argv: order = near
    if opt("--ids"): order = [int(x) for x in opt("--ids").split(",")]
    redo = set((opt("--redo-status") or "").split(",")) - {""}
    todo = [cid for cid in order if image_of(cid) and ("--redo" in sys.argv or str(cid) not in state or state[str(cid)].get("status") in redo)]
    os.makedirs(PREV, exist_ok=True)
    print(f"{len(near)} near NUCA land; {len(todo)} to place", flush=True)
    nearset = set(near)
    with Pool(int(opt("--jobs", "4"))) as pool:
        for r in pool.imap_unordered(work, [(cid, comps[cid], fits.get(str(cid)), image_of(cid)) for cid in todo]):
            r["near"] = r["id"] in nearset
            for f in glob.glob(f"{PREV}/*_{r['id']}.jpg"):
                if not os.path.basename(f).startswith(r["status"] + "_"): os.remove(f)
            state = put(r["id"], r)
            print(r["id"], r["status"], r.get("score"), r.get("ratio"), r.get("fail", ""), f"{r['secs']}s", flush=True)
    st = {}
    for r in state.values(): st[r["status"]] = st.get(r["status"], 0) + 1
    print("state:", st)
