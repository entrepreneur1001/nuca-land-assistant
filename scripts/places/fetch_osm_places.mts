/**
 * Nearby places (universities, schools, clubs, hospitals, malls, stations, landmarks) around every city with NUCA
 * land, from OpenStreetMap, with logos from Wikidata. Context for the maps and the plot page, like the compounds.
 *   npx tsx scripts/places/fetch_osm_places.mts [--city <slug>[,<slug>…]] [--no-logos] [--refresh] [--batch <n>] [--boxes]
 * City extents: its zone plans (public/plans, public/plans/past), located plots and districts (public/dev-snapshot when
 * present) and the compounds within 5 km of those, padded by 5 km (--boxes prints them and exits).
 * Writes public/places/<slug>.json, public/places/index.json and public/places/logo/<qid>.webp. Raw Overpass answers
 * are cached in scripts/places/.cache (git-ignored); --refresh asks Overpass again. Re-run monthly or so.
 * Overpass mirrors are flaky and queue each request: uncached cities go a few per request (--batch, default 4), tried
 * on overpass-api.de then the kumi mirror; a city that still fails is skipped, so simply run again to fill it in.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import sharp from "sharp";
import { bboxOf, type BBox } from "@/ingest/osm";
import { DISTRICT_CENTRES } from "@/data/district-centres";
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
const KM_LAT = 1 / 110.574;
const kmLng = (lat: number) => 1 / (111.32 * Math.cos((lat * Math.PI) / 180));
const distKm = ([a, b]: LL, [c, d]: LL) => Math.hypot((a - c) / KM_LAT, (b - d) / kmLng(a));

/**
 * Located points of each city's plots and districts from the local data snapshot (public/dev-snapshot, git-ignored;
 * written by the dev sync). Optional: without it the extents rest on the plans and compounds alone.
 */
function snapshotPoints(): Map<string, LL[]> {
  const out = new Map<string, LL[]>();
  const dir = path.join(ROOT, "public", "dev-snapshot");
  if (!existsSync(path.join(dir, "meta.json"))) return out;
  const meta = JSON.parse(readFileSync(path.join(dir, "meta.json"), "utf8")) as {
    chunks: { id: string }[];
    cities: string[];
    sectors: { id: string; city: number; c?: LL }[];
  };
  const add = (city: string | undefined, p: LL) => {
    if (!city || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return;
    const id = citySlug(city);
    if (!out.has(id)) out.set(id, []);
    out.get(id)!.push(p);
  };
  for (const sec of meta.sectors) if (sec.c) add(meta.cities[sec.city], sec.c);
  const secCity = new Map(meta.sectors.map((x) => [x.id, meta.cities[x.city]]));
  for (const [sid, c] of Object.entries(DISTRICT_CENTRES)) add(secCity.get(sid), c);
  for (const ch of meta.chunks) {
    const f = JSON.parse(readFileSync(path.join(dir, `${ch.id}.json`), "utf8")) as { data: string };
    const rows = JSON.parse(gunzipSync(Buffer.from(f.data, "base64")).toString("utf8")) as unknown[][];
    for (const t of rows) if (typeof t[13] === "number" && typeof t[14] === "number") add(meta.cities[t[3] as number], [t[13], t[14]]);
  }
  return out;
}

/**
 * Each city's extent: its plan zones (current and earlier stages), its located plots and districts, and the private
 * compounds within 5 km of those, padded by 5 km. Points over 30 km from the city's median are dropped as misplaced.
 */
function cityBoxes(): Map<string, BBox> {
  const pts = new Map<string, LL[]>();
  const add = (id: string, p: LL[]) => {
    if (!pts.has(id)) pts.set(id, []);
    pts.get(id)!.push(...p);
  };
  for (const f of ["plans/index.json", "plans/past/index.json"]) {
    const p = path.join(ROOT, "public", f);
    if (!existsSync(p)) continue;
    for (const z of Object.values((JSON.parse(readFileSync(p, "utf8")) as ZoneIdx).zones)) add(citySlug(z.city), z.bounds);
  }
  for (const [id, p] of snapshotPoints()) add(id, p);
  const cpath = path.join(ROOT, "public", "compounds", "index.json");
  const compounds = existsSync(cpath) ? (JSON.parse(readFileSync(cpath, "utf8")) as { compounds: { bounds: [LL, LL] }[] }).compounds : [];
  const out = new Map<string, BBox>();
  for (const [id, raw] of pts) {
    const med: LL = [[...raw].map((q) => q[0]).sort((x, y) => x - y)[raw.length >> 1], [...raw].map((q) => q[1]).sort((x, y) => x - y)[raw.length >> 1]];
    const core = raw.filter((q) => distKm(q, med) <= 30);
    // Thin the core to a ~500 m grid so the compound test stays cheap.
    const grid = [...new Map(core.map((q) => [`${Math.round(q[0] * 200)},${Math.round(q[1] * 200)}`, q])).values()];
    const all = [...core];
    for (const c of compounds) {
      const [[s, w], [n, e]] = c.bounds;
      const mid: LL = [(s + n) / 2, (w + e) / 2];
      if (grid.some((q) => distKm(q, mid) <= 5)) all.push(...c.bounds);
    }
    const [s, w, n, e] = bboxOf(all, 0)!;
    const lat = (s + n) / 2;
    out.set(id, [s - 5 * KM_LAT, w - 5 * kmLng(lat), n + 5 * KM_LAT, e + 5 * kmLng(lat)]);
  }
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

interface CacheFile { box?: BBox; elements: El[] }
const cachePath = (id: string) => path.join(CACHE, `${id}.json`);
const readCache = (id: string): CacheFile | null => (existsSync(cachePath(id)) ? (JSON.parse(readFileSync(cachePath(id), "utf8")) as CacheFile) : null);
const sameBox = (a: BBox | undefined, b: BBox) => !!a && a.every((x, i) => Math.abs(x - b[i]) < 1e-6);

/**
 * Fetches the cities lacking a cached answer for their current extent, a few per Overpass request (the mirrors queue
 * every request for tens of seconds but refuse very large ones); a failed group is retried city by city, and a city
 * that still fails is skipped.
 */
async function fetchMissing(boxes: Map<string, BBox>, ids: string[], refresh: boolean): Promise<void> {
  mkdirSync(CACHE, { recursive: true });
  const missing = ids.filter((id) => refresh || !sameBox(readCache(id)?.box, boxes.get(id)!));
  const size = Number(opt("--batch") ?? 4);
  const run = async (group: string[]) => {
    console.log(`overpass: ${group.join(", ")}`);
    const els = (JSON.parse(await overpass(query(group.map((id) => boxes.get(id)!)))) as { elements: El[] }).elements;
    for (const id of group) {
      const box = boxes.get(id)!;
      writeFileSync(cachePath(id), JSON.stringify({ box, elements: els.filter((el) => touches(el, box)) }));
    }
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

/** The OSM wikipedia tag ("en:Title") of each place that has one, for the logo lookup. */
const WIKIPEDIA = new Map<string, string>();
const SIZE_BUDGET = 150_000;

function cityPlaces(id: string, box: BBox): Place[] {
  const els = readCache(id)!.elements;
  const byId = new Map<string, Place>();
  for (const el of els) {
    const p = toPlace(el);
    if (p && inBox(p, box)) {
      byId.set(p.id, p);
      if (el.tags?.wikipedia) WIKIPEDIA.set(p.id, el.tags.wikipedia);
    }
  }
  // A node inside a same-named area of the same category (e.g. a school pin inside its school grounds) is a duplicate.
  const areas = [...byId.values()].filter((p) => p.ring);
  for (const p of [...byId.values()]) {
    if (p.ring || p.id[0] !== "n") continue;
    if (areas.some((a) => a.cat === p.cat && (a.name === p.name || (a.nameAr && a.nameAr === p.nameAr)) && Math.abs(a.lat - p.lat) < 0.01 && Math.abs(a.lng - p.lng) < 0.01))
      byId.delete(p.id);
  }
  const order: Cat[] = ["education", "sport", "health", "shopping", "transport", "landmark"];
  let out = [...byId.values()].sort((a, b) => order.indexOf(a.cat) - order.indexOf(b.cat) || a.name.localeCompare(b.name));
  // Over budget: schools only with their grounds drawn, then sports centres only with theirs.
  const size = () => JSON.stringify(out).length;
  if (size() > SIZE_BUDGET) out = out.filter((p) => p.sub !== "school" || p.ring);
  if (size() > SIZE_BUDGET) out = out.filter((p) => p.sub !== "sports_centre" || p.ring);
  return out;
}

// ---------- logos ----------
/**
 * Logos, one request at a time: Wikidata's logo (P154) of the place's item; else the logo file in the infobox of its
 * Wikipedia article (the OSM wikipedia tag or the item's en/ar sitelink), picked by file name (logo/شعار…), never a
 * photo; for universities without either tag, a Wikidata search on the exact name restricted to universities.
 * Lookups are cached in scripts/places/.cache/logos.json.
 */
type Found = { url: string; key: string } | null;
const LOGO_RE = /logo|شعار|emblem|seal|crest|insignia/i;
const NOT_LOGO_RE = /flag|map|location|locator|علم|خريطة|photo|\.jpe?g$/i;
const UNI_TYPES = new Set(["Q3918", "Q875538", "Q902104", "Q23002054", "Q62078547", "Q15936437", "Q189004", "Q38723"]);
const LOGO_SUBS = new Set(["university", "college", "club", "hospital", "mall", "golf", "stadium"]);
const memoPath = path.join(CACHE, "logos.json");
const memo: Record<string, unknown> = existsSync(memoPath) ? JSON.parse(readFileSync(memoPath, "utf8")) : {};
const saveMemo = () => writeFileSync(memoPath, JSON.stringify(memo));

async function api<T>(url: string): Promise<T | null> {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(30_000) });
      await sleep(250);
      if (res.status === 429 || res.status >= 500) { await sleep(5_000 * (i + 1)); continue; }
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      await sleep(3_000);
    }
  }
  return null;
}

interface Entity { p154: string | null; p31: string[]; p17: string[]; sites: Record<string, string>; labels: string[] }
async function entity(qid: string): Promise<Entity | null> {
  const k = `e2:${qid}`;
  if (!(k in memo)) {
    type Raw = { entities?: Record<string, { claims?: Record<string, { mainsnak: { datavalue?: { value: unknown } } }[]>; sitelinks?: Record<string, { title: string }>; labels?: Record<string, { value: string }>; aliases?: Record<string, { value: string }[]> }> };
    const j = await api<Raw>(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims|sitelinks|labels|aliases&languages=en|ar&sitefilter=enwiki|arwiki&ids=${qid}`);
    const e = j?.entities?.[qid];
    if (!j) return null; // network trouble: do not remember
    memo[k] = e
      ? {
          p154: (e.claims?.P154?.[0]?.mainsnak?.datavalue?.value as string | undefined) ?? null,
          p31: (e.claims?.P31 ?? []).map((c) => (c.mainsnak.datavalue?.value as { id?: string } | undefined)?.id).filter(Boolean),
          p17: (e.claims?.P17 ?? []).map((c) => (c.mainsnak.datavalue?.value as { id?: string } | undefined)?.id).filter(Boolean),
          sites: Object.fromEntries(Object.entries(e.sitelinks ?? {}).map(([s, v]) => [s.replace("wiki", ""), v.title])),
          labels: [...Object.values(e.labels ?? {}).map((l) => l.value), ...Object.values(e.aliases ?? {}).flat().map((l) => l.value)],
        }
      : null;
  }
  return memo[k] as Entity | null;
}

/** Logos of other things that sit on many articles: sister projects, social networks, state emblems. */
const SHARED_RE = /commons|wiki|instagram|facebook|twitter|youtube|linkedin|tiktok|whatsapp|telegram|snapchat|x[_ ]logo|coat[_ ]of[_ ]arms|emblem[_ ]of|seal[_ ]of|flag|portal|icon|symbol|disambig|edit|padlock|question|stub/i;
const STOP = new Set(["university", "universite", "college", "school", "hospital", "club", "mall", "egypt", "egyptian", "cairo", "the", "for", "and", "of", "in", "de", "جامعه", "جامعة", "كليه", "مستشفي", "نادي", "مصر", "القاهره"]);
const tokens = (s: string) => norm(s.replace(/\.[a-z]+$/i, "").replace(/_/g, " ")).split(" ").filter((t) => t.length >= 3 && !STOP.has(t));

/**
 * The logo file of a Wikipedia article: a file named like a logo (logo/شعار…) that is not a shared logo (Commons,
 * Instagram, a state emblem…) and is either the article's page image or names the subject (a word of the title, or
 * its initials).
 */
async function wikiLogo(lang: string, title: string): Promise<{ file: string; qid: string | null } | null> {
  const k = `w2:${lang}:${title}`;
  if (!(k in memo)) {
    type Raw = { query?: { pages?: Record<string, { title?: string; pageimage?: string; images?: { title: string }[]; pageprops?: { wikibase_item?: string } }> } };
    const j = await api<Raw>(`https://${lang}.wikipedia.org/w/api.php?action=query&format=json&redirects=1&prop=pageimages|images|pageprops&piprop=name&imlimit=100&titles=${encodeURIComponent(title)}`);
    if (!j) return null;
    const page = Object.values(j.query?.pages ?? {})[0];
    memo[k] = {
      title: page?.title ?? title,
      pageimage: page?.pageimage ?? null,
      images: (page?.images ?? []).map((i) => i.title.replace(/^[^:]+:/, "")),
      qid: page?.pageprops?.wikibase_item ?? null,
    };
  }
  const v = memo[k] as { title: string; pageimage: string | null; images: string[]; qid: string | null };
  const words = new Set(tokens(v.title));
  const initials = norm(v.title).split(" ").filter((w) => !["of", "the", "and", "for", "in"].includes(w)).map((w) => w[0]).join("");
  const names = [...new Set([v.pageimage, ...v.images].filter((n): n is string => !!n))];
  const ok = names.filter((n) => {
    if (!LOGO_RE.test(n) || NOT_LOGO_RE.test(n) || SHARED_RE.test(n.replace(LOGO_RE, ""))) return false;
    const t = tokens(n);
    return n === v.pageimage || t.some((w) => words.has(w)) || (initials.length >= 2 && t.includes(initials));
  });
  ok.sort((a, b) => Number(b === v.pageimage) - Number(a === v.pageimage) || Number(/\.svg$/i.test(b)) - Number(/\.svg$/i.test(a)));
  return ok.length ? { file: ok[0], qid: v.qid } : null;
}

const filePath = (host: string, file: string) => `https://${host}/wiki/Special:FilePath/${encodeURIComponent(file.replace(/ /g, "_"))}?width=96`;
const hashKey = (s: string) => `h${createHash("sha1").update(s).digest("hex").slice(0, 10)}`;

async function logoOfItem(qid: string): Promise<Found> {
  const e = await entity(qid);
  // An item in another country is a wrong tag (OSM has a Ghanaian "College of Engineering" on an Egyptian one).
  if (!e || (e.p17.length && !e.p17.includes("Q79"))) return null;
  if (e.p154) return { url: filePath("commons.wikimedia.org", e.p154), key: qid };
  for (const lang of ["en", "ar"]) {
    const t = e.sites[lang];
    const w = t ? await wikiLogo(lang, t) : null;
    if (w) return { url: filePath(`${lang}.wikipedia.org`, w.file), key: qid };
  }
  return null;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/\s[-–—]\s.*$/, "")
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/^the\s+/, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** A university's Wikidata item found by its exact name (en or ar), only when it is an instance of a university. */
async function searchUniversity(p: Place): Promise<string | null> {
  for (const [name, lang] of [[p.name, "en"], [p.nameAr, "ar"]] as const) {
    if (!name) continue;
    const k = `s:${lang}:${name}`;
    if (!(k in memo)) {
      type Raw = { search?: { id: string }[] };
      const j = await api<Raw>(`https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&type=item&limit=7&language=${lang}&uselang=${lang}&search=${encodeURIComponent(name.replace(/\(.*?\)/g, "").trim())}`);
      if (!j) continue;
      let hit: string | null = null;
      for (const r of j.search ?? []) {
        const e = await entity(r.id);
        if (e && e.p17.includes("Q79") && e.p31.some((t) => UNI_TYPES.has(t)) && e.labels.some((l) => norm(l) === norm(name))) {
          hit = r.id;
          break;
        }
      }
      memo[k] = hit;
    }
    if (memo[k]) return memo[k] as string;
  }
  return null;
}

async function findLogo(p: Place): Promise<Found> {
  if (p.wikidata) {
    // A tag pointing at an item in another country is wrong: drop it so it isn't published either.
    const e = await entity(p.wikidata);
    if (e && e.p17.length && !e.p17.includes("Q79")) delete p.wikidata;
  }
  if (p.wikidata) {
    const f = await logoOfItem(p.wikidata);
    if (f) return f;
  }
  const wp = WIKIPEDIA.get(p.id)?.match(/^(en|ar):(.+)$/);
  if (wp) {
    const w = await wikiLogo(wp[1], wp[2]);
    if (w) return { url: filePath(`${wp[1]}.wikipedia.org`, w.file), key: p.wikidata ?? w.qid ?? hashKey(w.file) };
  }
  if ((p.sub === "university" || p.sub === "college") && !p.wikidata && !wp) {
    const q = await searchUniversity(p);
    if (q) {
      const f = await logoOfItem(q);
      if (f) {
        p.wikidata = q;
        return f;
      }
    }
  }
  return null;
}

async function download(f: NonNullable<Found>): Promise<string | null> {
  const out = path.join(LOGO_DIR, `${f.key}.webp`);
  if (existsSync(out)) return `logo/${f.key}.webp`;
  try {
    const res = await fetch(f.url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(30_000) });
    await sleep(300);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await sharp(buf).resize(64, 64, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp({ quality: 80 }).toFile(out);
    return `logo/${f.key}.webp`;
  } catch (e) {
    console.warn(`  logo ${f.key} (${f.url}): ${(e as Error).message}`);
    return null;
  }
}

async function addLogos(places: Place[], online: boolean): Promise<void> {
  mkdirSync(LOGO_DIR, { recursive: true });
  const byKey = new Map<string, string | null>(); // place-identity → logo path, so a place in two cities is looked up once
  for (const p of places) {
    // Logos only for institutions (landmarks' items carry seals, portraits and the like); untagged ones only for universities.
    if (!LOGO_SUBS.has(p.sub)) continue;
    if (!p.wikidata && !WIKIPEDIA.has(p.id) && p.sub !== "university" && p.sub !== "college") continue;
    const ident = p.wikidata ?? WIKIPEDIA.get(p.id) ?? `${p.sub}:${p.name}`;
    if (!byKey.has(ident)) {
      let rel: string | null = null;
      if (online) {
        const f = await findLogo(p);
        if (f) rel = await download(f);
        saveMemo();
      } else if (p.wikidata && existsSync(path.join(LOGO_DIR, `${p.wikidata}.webp`))) rel = `logo/${p.wikidata}.webp`;
      byKey.set(ident, rel);
    }
    const rel = byKey.get(ident);
    if (rel) {
      p.logo = rel;
      // A logo keyed by a Wikidata id names the place's item (found from its article or by its exact name).
      const q = rel.match(/^logo\/(Q\d+)\.webp$/)?.[1];
      if (q && !p.wikidata) p.wikidata = q;
    }
  }
}

// ---------- main ----------
async function main() {
  const boxes = cityBoxes();
  if (flag("--boxes")) {
    for (const [id, [s, w, n, e]] of [...boxes].sort()) console.log(id, ((n - s) / KM_LAT).toFixed(1), "x", ((e - w) / kmLng(s)).toFixed(1), "km");
    return;
  }
  const only = opt("--city")?.split(",");
  const ids = [...boxes.keys()].filter((id) => !only || only.includes(id)).sort();
  mkdirSync(OUT, { recursive: true });
  const all = new Map<string, Place[]>();
  await fetchMissing(boxes, ids, flag("--refresh"));
  for (const id of ids) {
    if (!readCache(id)) continue;
    const places = cityPlaces(id, boxes.get(id)!);
    all.set(id, places);
    console.log(`${id}: ${places.length} places`);
  }
  const flat = [...all.values()].flat();
  await addLogos(flat, !flag("--no-logos"));
  console.log(`logos: ${new Set(flat.flatMap((p) => (p.logo ? [p.logo] : []))).size} distinct on ${flat.filter((p) => p.logo).length} places`);
  const generated = new Date().toISOString().slice(0, 10);
  const idxPath = path.join(OUT, "index.json");
  const index: { cities: Record<string, { count: number; bounds: [LL, LL] }> } = existsSync(idxPath) ? JSON.parse(readFileSync(idxPath, "utf8")) : { cities: {} };
  for (const [id, places] of all) {
    writeFileSync(path.join(OUT, `${id}.json`), JSON.stringify({ cityId: id, generated, places }));
    const [s, w, n, e] = boxes.get(id)!;
    index.cities[id] = { count: places.length, bounds: [[r5(s), r5(w)], [r5(n), r5(e)]] };
  }
  // Drop logo files no place uses any more.
  if (!only) {
    const used = new Set(flat.flatMap((p) => (p.logo ? [path.basename(p.logo)] : [])));
    for (const f of readdirSync(LOGO_DIR)) if (!used.has(f)) unlinkSync(path.join(LOGO_DIR, f));
  }
  index.cities = Object.fromEntries(Object.entries(index.cities).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(idxPath, JSON.stringify(index));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
