import { z } from "zod";
import {
  CHUNK_COUNT,
  SCHEMA_VERSION,
  chunkOf,
  hashString,
  packTuples,
  round,
  unpackTuples,
  type BuildingRules,
  type MetaDoc,
  type PlotTuple,
} from "@/data/snapshot";
import { RULES_OVERRIDES } from "@/data/building-rules";
import { computeBuiltDistances, sectorCentroids, type LatLng } from "@/engine/nearbuilt";
import { buildRoadIndex, computeRoadDistances, type Segment } from "@/engine/roads";
import { diffSnapshot, type ExistingItem, type LandStatus } from "./diff";
import { fetchJson as defaultFetchJson } from "./fetcher";
import {
  allocationSchema,
  allocationStatSchema,
  enhancedStatsSchema,
  pagedSchema,
  parseSourceDate,
  sectorSchema,
  statsSchema,
  validatePlots,
  type NormalizedPlot,
} from "./normalize";
import { buildIndex, fetchBuiltPoints as defaultFetchBuilt, fetchMainRoads as defaultFetchRoads } from "./osm";
import { SOURCE } from "./source";

export interface ChunkDoc {
  version: string;
  n: number;
  data: string;
}

/** Minimal storage interface (Firestore in production, in-memory in tests). */
export interface Store {
  getMeta(): Promise<MetaDoc | null>;
  getChunk(id: string): Promise<ChunkDoc | null>;
  /** Writes changed chunks then meta. Implementations should batch. */
  commit(chunks: Record<string, ChunkDoc>, meta: MetaDoc): Promise<void>;
  putMeta(meta: MetaDoc): Promise<void>;
}

export interface RunOptions {
  now?: Date;
  forceFull?: boolean;
  forceOsm?: boolean;
  /** Re-run a full sync at least this often even if stats look unchanged. */
  maxFullSyncMs?: number;
  osmMaxAgeMs?: number;
  /** Max cities refreshed from OpenStreetMap per run (keeps every run short). */
  osmCitiesPerRun?: number;
  fetchJson?: (path: string) => Promise<unknown>;
  /** Built points near the given district centres. */
  fetchBuiltPoints?: (centers: LatLng[]) => Promise<LatLng[]>;
  /** Main-road segments near the given district centres. */
  fetchMainRoads?: (centers: LatLng[]) => Promise<Segment[]>;
  /** Building rules from the NUCA booklet for districts the source leaves empty. */
  rulesOverrides?: Record<string, BuildingRules>;
  log?: (...a: unknown[]) => void;
  sleep?: (ms: number) => Promise<void>;
}

export interface RunResult {
  mode: "stats" | "full";
  changedChunks: string[];
  newlyBooked: number;
  newlyAvailable: number;
  inserted: number;
  osmRefreshed: boolean;
  error?: string;
}

const emptyMeta = (): MetaDoc => ({
  schema: SCHEMA_VERSION,
  dataVersion: "",
  statsAt: null,
  fullSyncAt: null,
  osmAt: null,
  lastError: null,
  lastErrorAt: null,
  source: { name: SOURCE.name, url: SOURCE.apiUrl },
  market: { total: 0, booked: 0, available: 0, allocatedCodes: null, sourceLastUpdate: null },
  allocations: [],
  cities: [],
  sectors: [],
  zones: [],
  chunks: [],
});

async function fetchAllPaged(fetchJson: (p: string) => Promise<unknown>, path: string, pageSize: number, extra = "", sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))) {
  const items: unknown[] = [];
  let total = Infinity;
  for (let skip = 0; skip < total; skip += pageSize) {
    const sep = path.includes("?") ? "&" : "?";
    const page = pagedSchema.parse(await fetchJson(`${path}${sep}SkipCount=${skip}&MaxResultCount=${pageSize}${extra}`));
    total = page.totalCount;
    items.push(...page.items);
    if (!page.items.length) break;
    if (skip + pageSize < total) await sleep(SOURCE.pageDelayMs);
  }
  return { items, total: total === Infinity ? 0 : total };
}

export async function loadTuples(store: Store, meta: MetaDoc): Promise<PlotTuple[]> {
  const all: PlotTuple[] = [];
  for (const c of meta.chunks) {
    const doc = await store.getChunk(c.id);
    if (doc) all.push(...(await unpackTuples(doc.data)));
  }
  return all;
}

export async function runSync(store: Store, opts: RunOptions = {}): Promise<RunResult> {
  const now = opts.now ?? new Date();
  const fetchJson = opts.fetchJson ?? ((p: string) => defaultFetchJson(p));
  const fetchBuilt = opts.fetchBuiltPoints ?? ((c: LatLng[]) => defaultFetchBuilt(c));
  // Roads only matter right at the plot, so a smaller radius than for buildings is enough.
  const fetchRoads = opts.fetchMainRoads ?? ((c: LatLng[]) => defaultFetchRoads(c, 3000));
  const log = opts.log ?? ((...a: unknown[]) => console.log("[ingest]", ...a));
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const maxFullSyncMs = opts.maxFullSyncMs ?? 2 * 3600_000;
  const osmMaxAgeMs = opts.osmMaxAgeMs ?? 7 * 86_400_000;
  const osmCitiesPerRun = opts.osmCitiesPerRun ?? Number(process.env.OSM_CITIES_PER_RUN ?? 3);

  const prev = (await store.getMeta()) ?? emptyMeta();
  const osmCities: Record<string, string> = { ...(prev.osmCities ?? {}) };
  const osmStale = (city: string) => !osmCities[city] || now.getTime() - Date.parse(osmCities[city]) >= osmMaxAgeMs;
  const meta: MetaDoc = { ...emptyMeta(), ...prev, schema: SCHEMA_VERSION, source: { name: SOURCE.name, url: SOURCE.apiUrl } };
  const result: RunResult = { mode: "stats", changedChunks: [], newlyBooked: 0, newlyAvailable: 0, inserted: 0, osmRefreshed: false };

  try {
    // 1. cheap stats poll
    const [rawStats, rawEnh] = await Promise.all([
      fetchJson("/api/app/dashboard/dashboard-statistics"),
      fetchJson("/api/app/dashboard/enhanced-dashboard-statistics").catch(() => null),
    ]);
    const s = statsSchema.parse(rawStats);
    const enh = rawEnh ? enhancedStatsSchema.safeParse(rawEnh) : null;
    const statsChanged = s.bookedPlots !== prev.market.booked || s.availablePlots !== prev.market.available || s.totalPlots !== prev.market.total;
    meta.market = {
      total: s.totalPlots,
      booked: s.bookedPlots,
      available: s.availablePlots,
      allocatedCodes: enh?.success ? (enh.data.allocatedBookings ?? null) : prev.market.allocatedCodes,
      sourceLastUpdate: parseSourceDate(s.lastUpdate)?.toISOString() ?? null,
    };
    meta.statsAt = now.toISOString();

    const anyOsmDue = !prev.cities.length || prev.cities.some(osmStale);
    const fullDue =
      opts.forceFull ||
      opts.forceOsm ||
      anyOsmDue ||
      !prev.fullSyncAt ||
      !prev.chunks.length ||
      statsChanged ||
      now.getTime() - Date.parse(prev.fullSyncAt) >= maxFullSyncMs;
    if (!fullDue) {
      meta.lastError = null;
      await store.putMeta(meta);
      return result;
    }
    result.mode = "full";

    // 2. reference data: allocations + sector flags
    const a = await fetchAllPaged(fetchJson, "/api/app/booking-allocation", 1000, "", sleep);
    const statsRaw = await fetchJson("/api/app/dashboard/allocation-statistics").catch(() => []);
    const bookedPerBatch = new Map<string, number>();
    for (const r of z.array(z.unknown()).catch([]).parse(statsRaw)) {
      const p = allocationStatSchema.safeParse(r);
      if (p.success) bookedPerBatch.set(p.data.allocationId, p.data.plotsBooked);
    }
    const prevBooked = new Map(prev.allocations.map((x) => [x.id, x.b]));
    meta.allocations = a.items
      .flatMap((i) => {
        const r = allocationSchema.safeParse(i);
        const d = r.success ? parseSourceDate(r.data.issueDate) : null;
        return r.success && d ? [{ id: r.data.id, d: d.toISOString(), c: r.data.totalCodes, b: bookedPerBatch.get(r.data.id) ?? prevBooked.get(r.data.id) ?? null }] : [];
      })
      .sort((x, y) => x.d.localeCompare(y.d));
    const hot = new Set<string>();
    // Source rules (fresh, else last known); missing fields are filled from RULES_OVERRIDES below.
    const rules = new Map<string, BuildingRules>(
      prev.sectors.flatMap((x) => (x.rules && x.rules.from !== "booklet" ? [[x.id, x.rules] as const] : [])),
    );
    try {
      const sec = await fetchAllPaged(fetchJson, "/api/app/sector", 1000, "", sleep);
      const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim().replace(/\s+/g, " ") : null);
      for (const i of sec.items) {
        const r = sectorSchema.safeParse(i);
        if (!r.success) continue;
        if (r.data.isHot) hot.add(r.data.id);
        const rr = { ratio: clean(r.data.buildingRatio), floors: clean(r.data.allowedFloors), setbacks: clean(r.data.setbacks) };
        if (rr.ratio || rr.floors || rr.setbacks) rules.set(r.data.id, rr);
      }
    } catch {
      /* optional: keep previous rules */
    }
    for (const [id, o] of Object.entries(opts.rulesOverrides ?? RULES_OVERRIDES)) rules.set(id, mergeRules(rules.get(id), o));

    // 3. all plots
    const fetched = await fetchAllPaged(fetchJson, "/api/app/land-plot", SOURCE.pageSize, "&Sorting=id", sleep);
    const { plots, rejected, errors } = validatePlots(fetched.items);
    if (rejected) log(`rejected ${rejected} invalid plot(s)`, errors);

    const prevTuples = await loadTuples(store, prev);
    const prevById = new Map(prevTuples.map((t) => [t[0], t]));
    const existing = new Map<string, ExistingItem>(
      prevTuples.map((t) => [t[0], { id: t[0], status: (t[15] ? "booked" : "available") as LandStatus, totalPrice: t[8] }]),
    );
    const d = diffSnapshot(
      existing,
      plots.map((p) => ({ id: p.id, status: p.status, totalPrice: p.totalPrice })),
      { expectedTotal: fetched.total - rejected, allPagesOk: true },
    );
    if (!d.accepted) throw new Error(`snapshot rejected: ${d.reason}`);
    result.newlyBooked = d.newlyBooked.length;
    result.newlyAvailable = d.newlyAvailable.length;
    result.inserted = d.inserted.length;

    // 4. distance to existing buildings (OpenStreetMap): a few stale cities per run, plus cities with new plots
    const built = new Map<string, { km: number | null; src: 0 | 1 | 2 }>();
    const roads = new Map<string, number | null>();
    // Cities synced before main-road distances existed need a refresh even if their buildings are fresh.
    const noRoads = new Set<string>();
    for (const t of prevTuples) {
      built.set(t[0], { km: t[17], src: t[18] });
      if (t[19] === undefined) noRoads.add(prev.cities[t[3]]);
      else roads.set(t[0], t[19]);
    }
    const insertedIds = new Set(d.inserted);
    const allCities = [...new Set(plots.map((p) => p.cityName))];
    const citiesWithNew = new Set(prev.chunks.length ? plots.filter((p) => insertedIds.has(p.id)).map((p) => p.cityName) : []);
    const due = opts.forceOsm
      ? allCities
      : allCities
          .filter((c) => osmStale(c) || citiesWithNew.has(c) || noRoads.has(c))
          .sort((x, y) => (osmCities[x] ?? "").localeCompare(osmCities[y] ?? ""))
          .slice(0, Math.max(osmCitiesPerRun, citiesWithNew.size));
    if (due.length) {
      const dueSet = new Set(due);
      const { distances, roadDistances, failedCities } = await computeOsmDistances(
        plots.filter((p) => dueSet.has(p.cityName)),
        fetchBuilt,
        fetchRoads,
        log,
        sleep,
      );
      for (const [id, v] of distances) built.set(id, v);
      for (const [id, v] of roadDistances) roads.set(id, v);
      for (const c of due) if (!failedCities.includes(c)) osmCities[c] = now.toISOString();
      result.osmRefreshed = distances.size > 0;
      if (result.osmRefreshed) meta.osmAt = now.toISOString();
    }
    meta.osmCities = osmCities;

    // 5. build tuples + lookup tables
    const cityIdx = new Map<string, number>();
    const sectorIdx = new Map<string, number>();
    const zoneIdx = new Map<string, number>();
    const cities: string[] = [];
    const sectors: MetaDoc["sectors"] = [];
    const zones: string[] = [];
    const idx = <K>(m: Map<K, number>, k: K, push: () => void) => {
      let i = m.get(k);
      if (i === undefined) {
        i = m.size;
        m.set(k, i);
        push();
      }
      return i;
    };
    const sorted = [...plots].sort((x, y) => x.id.localeCompare(y.id));
    const tuples: PlotTuple[] = sorted.map((p: NormalizedPlot) => {
      const c = idx(cityIdx, p.cityName, () => cities.push(p.cityName));
      const sct = p.projectId
        ? idx(sectorIdx, p.projectId, () => sectors.push({ id: p.projectId!, name: p.projectName ?? "", city: c, hot: hot.has(p.projectId!), rules: rules.get(p.projectId!) ?? null }))
        : -1;
      const z = p.zoneName ? idx(zoneIdx, p.zoneName, () => zones.push(p.zoneName!)) : -1;
      const b = built.get(p.id) ?? (prevById.has(p.id) ? { km: prevById.get(p.id)![17], src: prevById.get(p.id)![18] } : { km: null, src: 2 as const });
      return [
        p.id,
        p.externalPlotId,
        p.plotNumber,
        c,
        sct,
        z,
        round(p.area, 1)!,
        round(p.pricePerMeter, 2)!,
        round(p.totalPrice, 2)!,
        round(p.downPayment, 2)!,
        p.cornerPct,
        p.gardenPct,
        p.seaPct,
        round(p.latitude, 6),
        round(p.longitude, 6),
        p.status === "booked" ? 1 : 0,
        p.bookingDate?.getTime() ?? 0,
        round(b.km, 3),
        b.src,
        roads.get(p.id) ?? null,
      ];
    });
    meta.cities = cities;
    meta.sectors = sectors;
    meta.zones = zones;

    // 6. chunk + write only what changed
    const groups: PlotTuple[][] = Array.from({ length: CHUNK_COUNT }, () => []);
    for (const t of tuples) groups[chunkOf(t[0])].push(t);
    // Index tables are part of a chunk's meaning, so include them in its version.
    const tablesHash = hashString(JSON.stringify([cities, sectors, zones]));
    const prevChunks = new Map(prev.chunks.map((c) => [c.id, c]));
    const writes: Record<string, ChunkDoc> = {};
    meta.chunks = [];
    for (let i = 0; i < CHUNK_COUNT; i++) {
      const id = `c${i}`;
      const version = hashString(tablesHash + JSON.stringify(groups[i]));
      if (prevChunks.get(id)?.v !== version) {
        writes[id] = { version, n: groups[i].length, data: await packTuples(groups[i]) };
        result.changedChunks.push(id);
      }
      meta.chunks.push({ id, v: version, n: groups[i].length });
    }
    meta.dataVersion = hashString(meta.chunks.map((c) => c.v).join("|") + JSON.stringify(meta.allocations));
    meta.fullSyncAt = now.toISOString();
    meta.lastError = null;
    await store.commit(writes, meta);
    log(
      `full sync: ${plots.length} plots, +${d.inserted.length} new, ${d.newlyBooked.length} newly booked, ${d.newlyAvailable.length} re-available, ${result.changedChunks.length} chunk(s) written${result.osmRefreshed ? ", OSM refreshed" : ""}`,
    );
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log("sync failed:", msg);
    // Record the failure but keep the last good data (and its timestamps) untouched.
    await store.putMeta({ ...prev, ...(prev.chunks.length ? {} : meta), lastError: msg.slice(0, 500), lastErrorAt: now.toISOString() }).catch(() => {});
    return { ...result, error: msg };
  }
}

/** Source values win; the booklet table only fills fields the source leaves empty. */
function mergeRules(src: BuildingRules | undefined, booklet: BuildingRules): BuildingRules {
  if (!src) return { ...booklet, from: "booklet" };
  const r = { ratio: src.ratio ?? booklet.ratio, floors: src.floors ?? booklet.floors, setbacks: src.setbacks ?? booklet.setbacks };
  const filled = r.ratio !== src.ratio || r.floors !== src.floors || r.setbacks !== src.setbacks;
  return { ...r, from: filled ? "booklet" : "source" };
}

async function computeOsmDistances(
  plots: NormalizedPlot[],
  fetchBuilt: (centers: LatLng[]) => Promise<LatLng[]>,
  fetchRoads: (centers: LatLng[]) => Promise<Segment[]>,
  log: (...a: unknown[]) => void,
  sleep: (ms: number) => Promise<void>,
) {
  const byCity = new Map<string, NormalizedPlot[]>();
  for (const p of plots) {
    if (!byCity.has(p.cityName)) byCity.set(p.cityName, []);
    byCity.get(p.cityName)!.push(p);
  }
  const out = new Map<string, { km: number | null; src: 0 | 1 | 2 }>();
  const roadOut = new Map<string, number | null>();
  const failedCities: string[] = [];
  let first = true;
  for (const [city, ps] of byCity) {
    const centers = [...sectorCentroids(ps).values()];
    if (!centers.length) {
      for (const p of ps) out.set(p.id, { km: null, src: 2 });
      continue;
    }
    if (!first) await sleep(5000);
    first = false;
    try {
      const t0 = Date.now();
      const points = await fetchBuilt(centers);
      log(`OSM ${city}: ${centers.length} district(s), ${points.length} built points, ${Math.round((Date.now() - t0) / 1000)}s`);
      for (const [id, v] of computeBuiltDistances(ps, buildIndex(points))) out.set(id, v);
    } catch (e) {
      // Keep this city's previous distances; retry on the next run.
      failedCities.push(city);
      log(`OSM ${city} failed:`, e instanceof Error ? e.message : e);
      continue;
    }
    await sleep(5000);
    try {
      const segs = await fetchRoads(centers);
      log(`OSM ${city}: ${segs.length} main-road segments`);
      for (const [id, m] of computeRoadDistances(ps, buildRoadIndex(segs))) roadOut.set(id, m);
    } catch (e) {
      failedCities.push(city);
      log(`OSM roads ${city} failed:`, e instanceof Error ? e.message : e);
    }
  }
  return { distances: out, roadDistances: roadOut, failedCities };
}
