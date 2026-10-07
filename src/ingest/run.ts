import { z } from "zod";
import {
  CHUNK_COUNT,
  SCHEMA_VERSION,
  chunkOf,
  hashString,
  packTuples,
  round,
  unpackTuples,
  type MetaDoc,
  type PlotTuple,
} from "@/data/snapshot";
import { computeBuiltDistances, type LatLng } from "@/engine/nearbuilt";
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
import { bboxOf, buildIndex, fetchBuiltPoints as defaultFetchBuilt, type BBox } from "./osm";
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
  fetchJson?: (path: string) => Promise<unknown>;
  fetchBuiltPoints?: (bbox: BBox) => Promise<LatLng[]>;
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
  const fetchBuilt = opts.fetchBuiltPoints ?? ((b: BBox) => defaultFetchBuilt(b));
  const log = opts.log ?? ((...a: unknown[]) => console.log("[ingest]", ...a));
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const maxFullSyncMs = opts.maxFullSyncMs ?? 2 * 3600_000;
  const osmMaxAgeMs = opts.osmMaxAgeMs ?? 7 * 86_400_000;

  const prev = (await store.getMeta()) ?? emptyMeta();
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

    const fullDue =
      opts.forceFull || !prev.fullSyncAt || !prev.chunks.length || statsChanged || now.getTime() - Date.parse(prev.fullSyncAt) >= maxFullSyncMs;
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
    try {
      const sec = await fetchAllPaged(fetchJson, "/api/app/sector", 1000, "", sleep);
      for (const i of sec.items) {
        const r = sectorSchema.safeParse(i);
        if (r.success && r.data.isHot) hot.add(r.data.id);
      }
    } catch {
      /* optional */
    }

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

    // 4. distance to existing buildings (OpenStreetMap), refreshed weekly or when new plots appear
    const osmDue = opts.forceOsm || !prev.osmAt || now.getTime() - Date.parse(prev.osmAt) >= osmMaxAgeMs || (d.inserted.length > 0 && prev.chunks.length > 0);
    const built = new Map<string, { km: number | null; src: 0 | 1 | 2 }>();
    for (const t of prevTuples) built.set(t[0], { km: t[17], src: t[18] });
    if (osmDue) {
      try {
        const { distances, failedCities } = await computeOsmDistances(plots, fetchBuilt, log, sleep);
        for (const [id, v] of distances) built.set(id, v);
        if (!failedCities.length) meta.osmAt = now.toISOString();
        result.osmRefreshed = distances.size > 0;
      } catch (e) {
        log("OSM refresh failed, keeping previous distances:", e instanceof Error ? e.message : e);
      }
    }

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
        ? idx(sectorIdx, p.projectId, () => sectors.push({ id: p.projectId!, name: p.projectName ?? "", city: c, hot: hot.has(p.projectId!) }))
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

async function computeOsmDistances(
  plots: NormalizedPlot[],
  fetchBuilt: (b: BBox) => Promise<LatLng[]>,
  log: (...a: unknown[]) => void,
  sleep: (ms: number) => Promise<void>,
) {
  const byCity = new Map<string, NormalizedPlot[]>();
  for (const p of plots) {
    if (!byCity.has(p.cityName)) byCity.set(p.cityName, []);
    byCity.get(p.cityName)!.push(p);
  }
  const out = new Map<string, { km: number | null; src: 0 | 1 | 2 }>();
  const failedCities: string[] = [];
  let first = true;
  for (const [city, ps] of byCity) {
    const coords = ps.filter((p) => p.latitude != null && p.longitude != null).map((p) => [p.latitude!, p.longitude!] as LatLng);
    const bbox = bboxOf(coords);
    if (!bbox) {
      for (const p of ps) out.set(p.id, { km: null, src: 2 });
      continue;
    }
    if (!first) await sleep(5000);
    first = false;
    try {
      const points = await fetchBuilt(bbox);
      log(`OSM ${city}: ${points.length} built points`);
      for (const [id, v] of computeBuiltDistances(ps, buildIndex(points))) out.set(id, v);
    } catch (e) {
      // Keep this city's previous distances; retry on the next run.
      failedCities.push(city);
      log(`OSM ${city} failed:`, e instanceof Error ? e.message : e);
    }
  }
  return { distances: out, failedCities };
}
