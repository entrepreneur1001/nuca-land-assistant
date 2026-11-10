/**
 * What every plot drawn on an official zone plan faces: a main road, a private compound (premium or not), existing
 * buildings, and the major services near it. Feeds the "surroundings" factor of the recommendations
 * (src/engine/surroundings.ts).
 *   npx tsx scripts/surroundings/build.mts [--refresh] [--zone <zid>[,<zid>…]] [--stats]
 * Inputs: public/plans/<zid>.json (plot outlines), public/compounds/index.json, public/places/*.json, and
 * OpenStreetMap main roads + buildings around each zone (Overpass, cached in data/surroundings/osm, git-ignored;
 * --refresh asks again). Writes public/surroundings.json:
 *   { v: 2, generated, compounds: { <id>: [name, premium 0|1] }, plots: { <plotId>: [roadM, compoundId, compoundM, builtM, services] },
 *     plain: "<12-char id prefixes of measured plots that face nothing, concatenated>" }
 * nulls/0 for the parts that don't apply; services = [[cat, sub, name, m], …].
 * Plots missing from the file were not measured (no outline) and score neutral.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { imagePointToLatLng, loadPlanFiles, polygonCentroid } from "@/ingest/plan-places";
import {
  FACING,
  MAJOR_SERVICES,
  boxOf,
  facingDistance,
  pointInPolygon,
  projector,
  type Blocker,
  type XY,
} from "@/engine/surroundings";

type LL = [number, number];
const ROOT = process.cwd();
const CACHE = path.join(ROOT, "data", "surroundings", "osm");
const OUT = path.join(ROOT, "public", "surroundings.json");
const ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const args = process.argv.slice(2);
const flag = (n: string) => args.includes(n);
const opt = (n: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const onlyZones = opt("--zone")?.split(",");

// ---------- plots ----------
interface PlotGeo {
  id: string;
  zid: number;
  ring: LL[];
}
const files = loadPlanFiles();
const plots: PlotGeo[] = [];
for (const f of files)
  for (const [id, poly] of Object.entries(f.plots)) {
    if (poly.length < 3) continue;
    plots.push({ id, zid: f.zid, ring: poly.map(([x, y]) => imagePointToLatLng(f, x, y)) });
  }
console.log(`${plots.length} plot outlines in ${files.length} zones`);

// ---------- OSM per zone ----------
interface OsmZone {
  roads: LL[][];
  buildings: LL[][];
}
async function overpass(q: string): Promise<string> {
  let last: unknown;
  for (let round = 0; round < 3; round++)
    for (const url of ENDPOINTS) {
      try {
        const r = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "nuca-map-build/1.0" },
          body: new URLSearchParams({ data: q }),
          signal: AbortSignal.timeout(150_000),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return await r.text();
      } catch (e) {
        last = e;
        await sleep(3000 * (round + 1));
      }
    }
  throw last instanceof Error ? last : new Error(String(last));
}

async function osmFor(zid: number, zonePlots: PlotGeo[]): Promise<OsmZone> {
  const file = path.join(CACHE, `${zid}.json`);
  if (!flag("--refresh") && existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as OsmZone;
  const all = zonePlots.flatMap((p) => p.ring);
  const pad = 0.004; // ≈ 400 m
  const s = Math.min(...all.map((p) => p[0])) - pad;
  const n = Math.max(...all.map((p) => p[0])) + pad;
  const w = Math.min(...all.map((p) => p[1])) - pad;
  const e = Math.max(...all.map((p) => p[1])) + pad;
  const bb = `${s.toFixed(5)},${w.toFixed(5)},${n.toFixed(5)},${e.toFixed(5)}`;
  const q = `[out:json][timeout:120];(way["highway"~"^(motorway|trunk|primary|secondary|tertiary)(_link)?$"](${bb});way["building"](${bb}););out geom;`;
  const json = JSON.parse(await overpass(q)) as { elements?: { tags?: Record<string, string>; geometry?: { lat: number; lon: number }[] }[] };
  const out: OsmZone = { roads: [], buildings: [] };
  for (const el of json.elements ?? []) {
    const g = (el.geometry ?? []).map((p) => [p.lat, p.lon] as LL);
    if (g.length < 2) continue;
    if (el.tags?.highway) out.roads.push(g);
    else if (el.tags?.building) out.buildings.push(g);
  }
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(file, JSON.stringify(out));
  await sleep(1500);
  return out;
}

/**
 * Fetch every uncached zone up front, several zones per Overpass request (each request waits in a queue, so one
 * per zone takes hours). Elements are split back to the zones whose padded box they touch.
 */
async function prefetch(zones: Map<number, PlotGeo[]>, perRequest = 10) {
  const todo = [...zones].filter(([zid]) => flag("--refresh") || !existsSync(path.join(CACHE, `${zid}.json`)));
  const pad = 0.004;
  const boxes = new Map(
    todo.map(([zid, ps]) => {
      const all = ps.flatMap((p) => p.ring);
      return [zid, [Math.min(...all.map((p) => p[0])) - pad, Math.min(...all.map((p) => p[1])) - pad, Math.max(...all.map((p) => p[0])) + pad, Math.max(...all.map((p) => p[1])) + pad]] as const;
    }),
  );
  for (let i = 0; i < todo.length; i += perRequest) {
    const group = todo.slice(i, i + perRequest).map(([zid]) => zid);
    const bbs = group.map((z) => boxes.get(z)!.map((v) => v.toFixed(5)).join(","));
    const q = `[out:json][timeout:300];(${bbs.map((bb) => `way["highway"~"^(motorway|trunk|primary|secondary|tertiary)(_link)?$"](${bb});way["building"](${bb});`).join("")});out geom;`;
    const t0 = Date.now();
    try {
      const json = JSON.parse(await overpass(q)) as { elements?: { tags?: Record<string, string>; geometry?: { lat: number; lon: number }[] }[] };
      const out = new Map(group.map((z) => [z, { roads: [], buildings: [] } as OsmZone]));
      for (const el of json.elements ?? []) {
        const g = (el.geometry ?? []).map((p) => [p.lat, p.lon] as LL);
        if (g.length < 2) continue;
        for (const z of group) {
          const [s, w, n, e] = boxes.get(z)!;
          const lats = g.map((p) => p[0]);
          const lngs = g.map((p) => p[1]);
          if (Math.max(...lats) < s || Math.min(...lats) > n || Math.max(...lngs) < w || Math.min(...lngs) > e) continue;
          if (el.tags?.highway) out.get(z)!.roads.push(g);
          else if (el.tags?.building) out.get(z)!.buildings.push(g);
        }
      }
      mkdirSync(CACHE, { recursive: true });
      for (const [z, o] of out) writeFileSync(path.join(CACHE, `${z}.json`), JSON.stringify(o));
      console.log(`OSM: zones ${group.join(",")} in ${Math.round((Date.now() - t0) / 1000)} s`);
    } catch (e) {
      console.warn(`OSM: zones ${group.join(",")} failed (${e instanceof Error ? e.message : e}); retried one by one below`);
    }
  }
}

// ---------- compounds ----------
interface Compound {
  id: number;
  name: string;
  nameAr: string | null;
  bounds: [LL, LL];
  ring: LL[];
  price: number | null;
}
const compounds: Compound[] = existsSync(path.join(ROOT, "public/compounds/index.json"))
  ? (JSON.parse(readFileSync(path.join(ROOT, "public/compounds/index.json"), "utf8")).compounds as Compound[]).filter((c) => c.ring?.length >= 3)
  : [];
const centre = (c: Compound): LL => [(c.bounds[0][0] + c.bounds[1][0]) / 2, (c.bounds[0][1] + c.bounds[1][1]) / 2];
const kmBetween = (a: LL, b: LL) => Math.hypot((a[0] - b[0]) * 111.32, (a[1] - b[1]) * 111.32 * Math.cos((a[0] * Math.PI) / 180));
const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};
const allPrices = compounds.map((c) => c.price).filter((p): p is number => p != null && p > 0);
/** Premium = in the pricier third of the compounds within 10 km (all of Egypt when fewer than 6 are priced there). */
const premium = new Map<number, boolean>();
for (const c of compounds) {
  if (!c.price) {
    premium.set(c.id, false);
    continue;
  }
  const near = compounds.filter((o) => o.price && kmBetween(centre(c), centre(o)) <= 10).map((o) => o.price!);
  premium.set(c.id, c.price >= quantile(near.length >= 6 ? near : allPrices, 2 / 3));
}

// ---------- places ----------
interface Place {
  cat: string;
  sub: string;
  name: string;
  nameAr: string | null;
  lat: number;
  lng: number;
  ring?: LL[] | null;
}
const placesDir = path.join(ROOT, "public", "places");
const places: Place[] = existsSync(placesDir)
  ? readdirSync(placesDir)
      .filter((f) => f.endsWith(".json") && f !== "index.json")
      .flatMap((f) => (JSON.parse(readFileSync(path.join(placesDir, f), "utf8")).places ?? []) as Place[])
      .filter((p) => MAJOR_SERVICES.has(p.sub))
  : [];
console.log(`${compounds.length} compounds (${[...premium.values()].filter(Boolean).length} premium), ${places.length} major places`);

// ---------- measure ----------
type Row = 0 | [number | null, number, number | null, number | null, [string, string, string, number][]];
const PREFIX = 12;
const prev = existsSync(OUT) ? (JSON.parse(readFileSync(OUT, "utf8")) as { v: number; plots: Record<string, Row>; plain?: string }) : null;
const rows: Record<string, Row> = {};
if (onlyZones && prev?.v === 2) {
  Object.assign(rows, prev.plots);
  const plainSet = new Set((prev.plain ?? "").match(new RegExp(`.{${PREFIX}}`, "g")) ?? []);
  for (const p of plots) if (plainSet.has(p.id.slice(0, PREFIX))) rows[p.id] = 0;
}
const usedCompounds = new Set<number>();
const stats = { plots: 0, road: 0, compound: 0, premium: 0, built: 0, service: 0, any: 0 };

const byZone = new Map<number, PlotGeo[]>();
for (const p of plots) byZone.set(p.zid, [...(byZone.get(p.zid) ?? []), p]);
const zoneBox = new Map([...byZone].map(([z, ps]) => [z, boxOf(ps.flatMap((p) => p.ring).map(([la, ln]) => [ln, la] as XY))]));

await prefetch(new Map([...byZone].filter(([zid]) => !onlyZones || onlyZones.includes(String(zid)))));

for (const [zid, zonePlots] of byZone) {
  if (onlyZones && !onlyZones.includes(String(zid))) continue;
  let osm: OsmZone;
  try {
    osm = await osmFor(zid, zonePlots);
  } catch (e) {
    console.warn(`zone ${zid}: Overpass failed (${e instanceof Error ? e.message : e}); its plots stay unmeasured`);
    for (const p of zonePlots) delete rows[p.id];
    continue;
  }
  const zb = zoneBox.get(zid)!;
  const lat0 = (zb.y0 + zb.y1) / 2;
  const P = projector(lat0);
  const near = (b: { x0: number; y0: number; x1: number; y1: number }, padDeg: number) =>
    b.x0 - padDeg <= zb.x1 && zb.x0 - padDeg <= b.x1 && b.y0 - padDeg <= zb.y1 && zb.y0 - padDeg <= b.y1;
  // Blockers: every plot of every plan touching this zone (neighbouring zones share streets).
  const neighbours = plots.filter((p) => p.zid === zid || near(zoneBox.get(p.zid)!, 0.002));
  const blockers = new Map(neighbours.map((p) => {
    const poly = p.ring.map(P);
    return [p.id, { poly, box: boxOf(poly) } as Blocker];
  }));
  const roads = osm.roads.map((r) => r.map(P));
  const buildings = osm.buildings.map((r) => r.map(P));
  const zoneCompounds = compounds
    .filter((c) => near({ x0: c.bounds[0][1], y0: c.bounds[0][0], x1: c.bounds[1][1], y1: c.bounds[1][0] }, 0.002))
    .map((c) => ({ c, ring: [...c.ring, c.ring[0]].map(P) }));
  const zonePlaces = places.filter((pl) => near({ x0: pl.lng, y0: pl.lat, x1: pl.lng, y1: pl.lat }, 0.02)).map((pl) => ({ pl, xy: P([pl.lat, pl.lng]), ring: pl.ring?.map(P) ?? null }));

  for (const p of zonePlots) {
    const ring = p.ring.map(P);
    const others = [...blockers].filter(([id]) => id !== p.id).map(([, b]) => b);
    const pb = boxOf(ring);
    const localOthers = others.filter((b) => b.box.x0 <= pb.x1 + 80 && pb.x0 - 80 <= b.box.x1 && b.box.y0 <= pb.y1 + 80 && pb.y0 - 80 <= b.box.y1);
    const cen = polygonCentroid(ring);
    const roadM = facingDistance(ring, roads, localOthers, FACING.roadM);
    // Buildings standing inside the plot itself are stale or misplaced data, not neighbours.
    const bld = buildings.filter((b) => !pointInPolygon(b[0], ring)).map((b) => [...b, b[0]]);
    const builtM = facingDistance(ring, bld, localOthers, FACING.builtM);
    let comp: { id: number; m: number } | null = null;
    for (const { c, ring: cr } of zoneCompounds) {
      if (pointInPolygon(cen, cr)) continue; // plot drawn inside a compound's outline: one of the two is misplaced
      const m = facingDistance(ring, [cr], localOthers, FACING.compoundM);
      if (m != null && (!comp || m < comp.m || (m === comp.m && premium.get(c.id) && !premium.get(comp.id)))) comp = { id: c.id, m };
    }
    const services: [string, string, string, number][] = [];
    const seen = new Set<string>();
    const svc = zonePlaces
      .map(({ pl, xy, ring: r }) => ({ pl, m: r && pointInPolygon(cen, r) ? 0 : Math.hypot(xy[0] - cen[0], xy[1] - cen[1]) }))
      .filter((x) => x.m <= FACING.serviceM)
      .sort((a, b) => a.m - b.m);
    for (const { pl, m } of svc) {
      if (seen.has(pl.sub) || services.length >= 3) continue;
      seen.add(pl.sub);
      services.push([pl.cat, pl.sub, pl.nameAr || pl.name, Math.round(m / 10) * 10]);
    }
    stats.plots++;
    if (roadM != null) stats.road++;
    if (builtM != null) stats.built++;
    if (comp) {
      stats.compound++;
      if (premium.get(comp.id)) stats.premium++;
      usedCompounds.add(comp.id);
    }
    if (services.length) stats.service++;
    if (roadM != null || builtM != null || comp) stats.any++;
    rows[p.id] = roadM == null && builtM == null && !comp && !services.length ? 0 : [roadM, comp?.id ?? 0, comp?.m ?? null, builtM, services];
  }
  if (flag("--debug")) {
    const dir = path.join(ROOT, "data", "surroundings", "debug");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `${zid}.json`), JSON.stringify({
      plots: zonePlots.map((p) => ({ id: p.id, ring: p.ring, row: rows[p.id] })),
      others: neighbours.filter((p) => p.zid !== zid).map((p) => p.ring),
      roads: osm.roads, buildings: osm.buildings,
      compounds: zoneCompounds.map(({ c }) => ({ id: c.id, ring: c.ring, premium: premium.get(c.id) })),
    }));
  }
  process.stdout.write(`zone ${zid}: ${zonePlots.length} plots, ${osm.roads.length} roads, ${osm.buildings.length} buildings, ${zoneCompounds.length} compounds\n`);
}

if (onlyZones && prev) for (const r of Object.values(rows)) if (r !== 0 && r[1]) usedCompounds.add(r[1]);
const compoundsOut: Record<number, [string, 0 | 1]> = {};
for (const c of compounds) if (usedCompounds.has(c.id)) compoundsOut[c.id] = [c.nameAr || c.name, premium.get(c.id) ? 1 : 0];
// Most plots face nothing: list those by a 12-character id prefix (unique among the plots) instead of a full row.
const plain = Object.entries(rows).filter(([, r]) => r === 0).map(([id]) => id);
const prefixes = new Set(plots.map((p) => p.id.slice(0, PREFIX)));
if (prefixes.size !== plots.length) throw new Error("plot id prefixes collide; raise PREFIX");
const facing = Object.fromEntries(Object.entries(rows).filter(([, r]) => r !== 0));
writeFileSync(OUT, JSON.stringify({ v: 2, generated: new Date().toISOString(), compounds: compoundsOut, plots: facing, plain: plain.map((id) => id.slice(0, PREFIX)).sort().join("") }));
console.log(stats);
console.log(`wrote ${path.relative(ROOT, OUT)} (${Math.round(readFileSync(OUT).length / 1024)} KB)`);
