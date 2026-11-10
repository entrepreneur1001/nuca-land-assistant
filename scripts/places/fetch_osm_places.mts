/**
 * Nearby places (universities, schools, clubs, hospitals, malls, stations, landmarks) around every city with NUCA
 * land, from OpenStreetMap, with logos from Wikidata. Context for the maps and the plot page, like the compounds.
 *   npx tsx scripts/places/fetch_osm_places.mts [--city <slug>[,<slug>…]] [--no-logos] [--refresh] [--batch <n>]
 * City extents are the bounds of its published zone plans (public/plans and public/plans/past) padded by ~3 km.
 * Writes public/places/<slug>.json, public/places/index.json and public/places/logo/<qid>.webp. Raw Overpass answers
 * are cached in scripts/places/.cache (git-ignored); --refresh asks Overpass again. Re-run monthly or so.
 * Overpass mirrors are flaky and queue each request: uncached cities go a few per request (--batch, default 4), tried
 * on overpass-api.de then the kumi mirror; a city that still fails is skipped, so simply run again to fill it in.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { bboxOf, type BBox } from "@/ingest/osm";
import { citySlug } from "@/lib/slugs";

type LL = [number, number];
type Cat = "education" | "sport" | "health" | "shopping" | "transport" | "landmark";
export interface Place {
  id: string;
  cat: Cat;
  sub: string;
  name: string;
  nameAr: string | null;
  lat: number;
  lng: number;
  ring?: LL[];
  wikidata?: string;
  logo?: string;
}

const ROOT = process.cwd();
const OUT = path.join(ROOT, "public", "places");
const LOGO_DIR = path.join(OUT, "logo");
const CACHE = path.join(ROOT, "scripts", "places", ".cache");
const UA = "nuca-map-build/1.0";
const ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(n);
const opt = (n: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);

// ---------- city extents ----------
interface ZoneIdx { zones: Record<string, { city: string; bounds: [LL, LL] }> }
function cityBoxes(): Map<string, BBox> {
  const pts = new Map<string, LL[]>();
  for (const f of ["plans/index.json", "plans/past/index.json"]) {
    const p = path.join(ROOT, "public", f);
    if (!existsSync(p)) continue;
    for (const z of Object.values((JSON.parse(readFileSync(p, "utf8")) as ZoneIdx).zones)) {
      const id = citySlug(z.city);
      if (!pts.has(id)) pts.set(id, []);
      pts.get(id)!.push(...z.bounds);
    }
  }
  const out = new Map<string, BBox>();
  for (const [id, p] of pts) out.set(id, bboxOf(p, 0.03)!);
  return out;
}

// ---------- Overpass ----------
async function overpass(query: string): Promise<string> {
  let last: unknown;
  for (let round = 0; round < 2; round++) {
    for (const url of ENDPOINTS) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": UA },
          body: new URLSearchParams({ data: query }),
          signal: AbortSignal.timeout(290_000),
        });
        if (!res.ok) throw new Error(`Overpass HTTP ${res.status} from ${url}`);
        const text = await res.text();
        if (!text.trimStart().startsWith("{")) throw new Error(`Overpass non-JSON from ${url}`);
        return text;
      } catch (e) {
        last = e;
        console.warn(`  overpass: ${(e as Error).message}`);
        await sleep(5_000 * (round + 1));
      }
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

const FILTERS = [
  'nwr["amenity"~"^(university|college|school)$"]["name"]',
  'nwr["leisure"~"^(sports_club|golf_course|sports_centre|stadium)$"]["name"]',
  'nwr["club"="sport"]["name"]',
  'nwr["amenity"="hospital"]["name"]',
  'way["amenity"="clinic"]["name"]',
  'nwr["shop"="mall"]["name"]',
  'nwr["railway"~"^(station|halt)$"]["name"]',
  'nwr["public_transport"="station"]["name"]',
  'nwr["station"~"^(monorail|light_rail|subway)$"]["name"]',
  'nwr["amenity"="place_of_worship"]["name"]',
  'nwr["tourism"~"^(attraction|museum)$"]["name"]',
  'nwr["office"="government"]["wikidata"]["name"]',
  'nwr["historic"]["name"]',
];
/** One request for every box: the public mirrors queue each request for tens of seconds, so fewer is faster. */
const query = (boxes: BBox[]) =>
  `[out:json][timeout:280];\n(\n${boxes.flatMap(([s, w, n, e]) => FILTERS.map((f) => `  ${f}(${s},${w},${n},${e});`)).join("\n")}\n);\nout tags geom;`;

interface El {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  geometry?: ({ lat: number; lon: number } | null)[];
  bounds?: { minlat: number; minlon: number; maxlat: number; maxlon: number };
  members?: { type: string; role: string; geometry?: { lat: number; lon: number }[] }[];
}

// ---------- geometry ----------
const R = 6371008.8;
/** Local metres around a reference latitude. */
const toXY = (lat0: number) => ([lat, lng]: LL): LL => [(lng * Math.PI * R * Math.cos((lat0 * Math.PI) / 180)) / 180, (lat * Math.PI * R) / 180];
function area(ring: LL[]): number {
  if (ring.length < 3) return 0;
  const f = toXY(ring[0][0]);
  const p = ring.map(f);
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i];
    const [x2, y2] = p[(i + 1) % p.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}
function centroid(ring: LL[]): LL {
  const f = toXY(ring[0][0]);
  const p = ring.map(f);
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i];
    const [x2, y2] = p[(i + 1) % p.length];
    const c = x1 * y2 - x2 * y1;
    a += c;
    cx += (x1 + x2) * c;
    cy += (y1 + y2) * c;
  }
  if (Math.abs(a) < 1e-6) {
    const n = ring.length;
    return [ring.reduce((s, q) => s + q[0], 0) / n, ring.reduce((s, q) => s + q[1], 0) / n];
  }
  cx /= 3 * a;
  cy /= 3 * a;
  const k = Math.cos((ring[0][0] * Math.PI) / 180);
  return [(cy * 180) / (Math.PI * R), (cx * 180) / (Math.PI * R * k)];
}
/** Douglas–Peucker on an open ring, tolerance in metres. */
function simplify(ring: LL[], tolM: number): LL[] {
  if (ring.length <= 4) return ring;
  const f = toXY(ring[0][0]);
  const p = ring.map(f);
  const keep = new Uint8Array(p.length);
  keep[0] = keep[p.length - 1] = 1;
  const stack: [number, number][] = [[0, p.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let best = -1, bi = -1;
    const [ax, ay] = p[a];
    const [bx, by] = p[b];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const [x, y] = p[i];
      let d: number;
      if (len2 === 0) d = Math.hypot(x - ax, y - ay);
      else {
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
        d = Math.hypot(x - ax - t * dx, y - ay - t * dy);
      }
      if (d > best) [best, bi] = [d, i];
    }
    if (best > tolM) {
      keep[bi] = 1;
      stack.push([a, bi], [bi, b]);
    }
  }
  return ring.filter((_, i) => keep[i]);
}
const r5 = (x: number) => Math.round(x * 1e5) / 1e5;
const same = (a: LL, b: LL) => a[0] === b[0] && a[1] === b[1];

/** Joins a relation's outer member ways into closed rings and returns the largest. */
function outerRing(el: El): LL[] | null {
  const parts: LL[][] = (el.members ?? [])
    .filter((m) => m.type === "way" && (m.role === "outer" || m.role === "") && m.geometry?.length)
    .map((m) => m.geometry!.map((g) => [g.lat, g.lon] as LL));
  const rings: LL[][] = [];
  while (parts.length) {
    let cur = parts.shift()!;
    let grew = true;
    while (!same(cur[0], cur[cur.length - 1]) && grew) {
      grew = false;
      for (let i = 0; i < parts.length; i++) {
        const q = parts[i];
        const end = cur[cur.length - 1];
        if (same(end, q[0])) cur = cur.concat(q.slice(1));
        else if (same(end, q[q.length - 1])) cur = cur.concat(q.slice(0, -1).reverse());
        else continue;
        parts.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (cur.length >= 4 && same(cur[0], cur[cur.length - 1])) rings.push(cur);
  }
  if (!rings.length) return null;
  return rings.sort((a, b) => area(b) - area(a))[0];
}

// ---------- classification ----------
function classify(t: Record<string, string>): { cat: Cat; sub: string } | null {
  const a = t.amenity, l = t.leisure;
  if (a === "university" || a === "college" || a === "school") return { cat: "education", sub: a };
  if (a === "hospital" || a === "clinic") return { cat: "health", sub: a };
  if (t.shop === "mall") return { cat: "shopping", sub: "mall" };
  if (t.railway === "station" || t.railway === "halt" || t.public_transport === "station" || t.station) {
    const s = t.station;
    const bus = t.bus === "yes" || t.amenity === "bus_station" || t.highway === "bus_stop";
    const sub = s === "monorail" ? "monorail" : s === "light_rail" ? "lrt" : s === "subway" ? "metro" : t.railway === "station" || t.railway === "halt" || t.train === "yes" ? "rail" : bus ? "bus" : "station";
    return { cat: "transport", sub };
  }
  if (l === "golf_course") return { cat: "sport", sub: "golf" };
  if (l === "stadium") return { cat: "sport", sub: "stadium" };
  if (l === "sports_club" || t.club === "sport") return { cat: "sport", sub: "club" };
  if (l === "sports_centre") return { cat: "sport", sub: "sports_centre" };
  if (a === "place_of_worship") return { cat: "landmark", sub: t.religion === "christian" ? "church" : t.religion === "muslim" ? "mosque" : "worship" };
  if (t.tourism === "museum") return { cat: "landmark", sub: "museum" };
  if (t.tourism === "attraction") return { cat: "landmark", sub: "attraction" };
  if (t.office === "government") return { cat: "landmark", sub: "government" };
  if (t.historic) return { cat: "landmark", sub: "historic" };
  return null;
}

const ARABIC = /[؀-ۿ]/;
const MAX_RING = 120;

function toPlace(el: El): Place | null {
  const t = el.tags ?? {};
  const c = classify(t);
  if (!c || !t.name) return null;
  let ring: LL[] | null = null;
  if (el.type === "way" && el.geometry?.length) {
    const g = el.geometry.filter((x): x is { lat: number; lon: number } => !!x).map((x) => [x.lat, x.lon] as LL);
    if (g.length >= 4 && same(g[0], g[g.length - 1])) ring = g;
    else if (g.length) ring = null;
  } else if (el.type === "relation") ring = outerRing(el);
  if (ring) ring = ring.slice(0, -1); // open
  const a = ring ? area(ring) : 0;
  if (ring && a < 50) ring = null;
  // Filters per category.
  if (c.sub === "clinic" && (el.type === "node" || !ring)) return null;
  if (c.cat === "landmark" && t.amenity === "place_of_worship" && !t.wikidata && a < 5000) return null;
  if (t.historic && !t.wikidata && !t.tourism && a < 5000) return null;
  if (c.sub === "attraction" && !t.wikidata && a < 5000) return null;
  let lat: number, lng: number;
  if (el.type === "node") [lat, lng] = [el.lat!, el.lon!];
  else if (ring) [lat, lng] = centroid(ring);
  else if (el.type === "way" && el.geometry?.length) {
    const g = el.geometry.filter((x): x is { lat: number; lon: number } => !!x);
    [lat, lng] = [g.reduce((s, q) => s + q.lat, 0) / g.length, g.reduce((s, q) => s + q.lon, 0) / g.length];
  } else return null;
  const name = t["name:en"] || t.name;
  const nameAr = t["name:ar"] || (ARABIC.test(t.name) ? t.name : null);
  const p: Place = { id: `${el.type[0]}${el.id}`, cat: c.cat, sub: c.sub, name, nameAr, lat: r5(lat), lng: r5(lng) };
  if (ring) {
    let tol = 5;
    let s = simplify(ring, tol);
    while (s.length > MAX_RING) s = simplify(ring, (tol *= 2));
    const out: LL[] = [];
    for (const q of s.map(([y, x]) => [r5(y), r5(x)] as LL)) if (!out.length || !same(out[out.length - 1], q)) out.push(q);
    if (out.length >= 3) p.ring = out;
  }
  const qid = t.wikidata?.match(/^Q\d+$/)?.[0];
  if (qid) p.wikidata = qid;
  return p;
}

const inBox = (p: Place, [s, w, n, e]: BBox) => p.lat >= s && p.lat <= n && p.lng >= w && p.lng <= e;

const touches = (el: El, [s, w, n, e]: BBox) =>
  el.type === "node" ? el.lat! >= s && el.lat! <= n && el.lon! >= w && el.lon! <= e : !!el.bounds && el.bounds.minlat <= n && el.bounds.maxlat >= s && el.bounds.minlon <= e && el.bounds.maxlon >= w;

/**
 * Fetches the cities lacking a cached answer, a few per Overpass request (the mirrors queue every request for tens of
 * seconds but refuse very large ones); a failed group is retried city by city, and a city that still fails is skipped.
 */
async function fetchMissing(boxes: Map<string, BBox>, ids: string[], refresh: boolean): Promise<void> {
  mkdirSync(CACHE, { recursive: true });
  const missing = ids.filter((id) => refresh || !existsSync(path.join(CACHE, `${id}.json`)));
  const size = Number(opt("--batch") ?? 4);
  const run = async (group: string[]) => {
    console.log(`overpass: ${group.join(", ")}`);
    const els = (JSON.parse(await overpass(query(group.map((id) => boxes.get(id)!)))) as { elements: El[] }).elements;
    for (const id of group) writeFileSync(path.join(CACHE, `${id}.json`), JSON.stringify({ elements: els.filter((el) => touches(el, boxes.get(id)!)) }));
  };
  for (let i = 0; i < missing.length; i += size) {
    const group = missing.slice(i, i + size);
    try {
      await run(group);
    } catch (e) {
      console.warn(`  group failed (${(e as Error).message})${group.length > 1 ? "; trying one by one" : ""}`);
      if (group.length > 1)
        for (const id of group)
          try {
            await run([id]);
          } catch (e2) {
            console.warn(`  ${id} skipped: ${(e2 as Error).message}`);
          }
    }
  }
}

function cityPlaces(id: string, box: BBox): Place[] {
  const els = (JSON.parse(readFileSync(path.join(CACHE, `${id}.json`), "utf8")) as { elements: El[] }).elements;
  const byId = new Map<string, Place>();
  for (const el of els) {
    const p = toPlace(el);
    if (p && inBox(p, box)) byId.set(p.id, p);
  }
  // A node inside a same-named area of the same category (e.g. a school pin inside its school grounds) is a duplicate.
  const areas = [...byId.values()].filter((p) => p.ring);
  for (const p of [...byId.values()]) {
    if (p.ring || p.id[0] !== "n") continue;
    if (areas.some((a) => a.cat === p.cat && (a.name === p.name || (a.nameAr && a.nameAr === p.nameAr)) && Math.abs(a.lat - p.lat) < 0.01 && Math.abs(a.lng - p.lng) < 0.01))
      byId.delete(p.id);
  }
  const order: Cat[] = ["education", "sport", "health", "shopping", "transport", "landmark"];
  return [...byId.values()].sort((a, b) => order.indexOf(a.cat) - order.indexOf(b.cat) || a.name.localeCompare(b.name));
}

// ---------- logos ----------
async function logos(qids: string[]): Promise<Map<string, string>> {
  mkdirSync(LOGO_DIR, { recursive: true });
  const files = new Map<string, string>(); // qid → commons file name
  for (let i = 0; i < qids.length; i += 50) {
    const ids = qids.slice(i, i + 50).join("|");
    const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims&ids=${ids}`;
    const res = await fetch(url, { headers: { "user-agent": UA } });
    if (!res.ok) { console.warn(`  wikidata HTTP ${res.status}`); continue; }
    const j = (await res.json()) as { entities: Record<string, { claims?: Record<string, { mainsnak: { datavalue?: { value: string } } }[]> }> };
    for (const [q, ent] of Object.entries(j.entities ?? {})) {
      const v = ent.claims?.P154?.[0]?.mainsnak?.datavalue?.value;
      if (typeof v === "string") files.set(q, v);
    }
    await sleep(500);
  }
  const done = new Map<string, string>();
  for (const [q, file] of files) {
    const out = path.join(LOGO_DIR, `${q}.webp`);
    const rel = `logo/${q}.webp`;
    if (existsSync(out)) { done.set(q, rel); continue; }
    try {
      const res = await fetch(`https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file.replace(/ /g, "_"))}?width=96`, { headers: { "user-agent": UA } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      await sharp(buf).resize(64, 64, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp({ quality: 80 }).toFile(out);
      done.set(q, rel);
    } catch (e) {
      console.warn(`  logo ${q} (${file}): ${(e as Error).message}`);
    }
    await sleep(300);
  }
  return done;
}

// ---------- main ----------
async function main() {
  const boxes = cityBoxes();
  const only = opt("--city")?.split(",");
  const ids = [...boxes.keys()].filter((id) => !only || only.includes(id)).sort();
  mkdirSync(OUT, { recursive: true });
  const all = new Map<string, Place[]>();
  await fetchMissing(boxes, ids, flag("--refresh"));
  for (const id of ids) {
    if (!existsSync(path.join(CACHE, `${id}.json`))) continue;
    const places = cityPlaces(id, boxes.get(id)!);
    all.set(id, places);
    console.log(`${id}: ${places.length} places`);
  }
  if (!flag("--no-logos")) {
    const qids = [...new Set([...all.values()].flat().flatMap((p) => (p.wikidata ? [p.wikidata] : [])))];
    console.log(`logos: ${qids.length} wikidata items`);
    const got = await logos(qids);
    for (const p of [...all.values()].flat()) if (p.wikidata && got.has(p.wikidata)) p.logo = got.get(p.wikidata);
    console.log(`logos: ${got.size} found`);
  } else {
    for (const p of [...all.values()].flat()) if (p.wikidata && existsSync(path.join(LOGO_DIR, `${p.wikidata}.webp`))) p.logo = `logo/${p.wikidata}.webp`;
  }
  const generated = new Date().toISOString().slice(0, 10);
  const idxPath = path.join(OUT, "index.json");
  const index: { cities: Record<string, { count: number; bounds: [LL, LL] }> } = existsSync(idxPath) ? JSON.parse(readFileSync(idxPath, "utf8")) : { cities: {} };
  for (const [id, places] of all) {
    writeFileSync(path.join(OUT, `${id}.json`), JSON.stringify({ cityId: id, generated, places }));
    const [s, w, n, e] = boxes.get(id)!;
    index.cities[id] = { count: places.length, bounds: [[r5(s), r5(w)], [r5(n), r5(e)]] };
  }
  index.cities = Object.fromEntries(Object.entries(index.cities).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(idxPath, JSON.stringify(index));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
