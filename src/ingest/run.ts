import { CHUNK_COUNT, SCHEMA_VERSION, chunkOf, hashString, packTuples, round, unpackTuples, type BuildingRules, type MetaDoc, type OfficialNewsItem, type OfficialZoneState, type PlotTuple } from "@/data/snapshot";
import { RULES_OVERRIDES } from "@/data/building-rules";
import { DISTRICT_CENTRES } from "@/data/district-centres";
import { OFFICIAL_CITIES, OFFICIAL_ZONES } from "@/data/official-zones";
import { SECTOR_VIEWS, viewCentres, type SectorView } from "@/data/sector-views";
import { computeBuiltDistances, distanceKm, sectorCentroids, type LatLng } from "@/engine/nearbuilt";
import { officialQueue } from "@/engine/queue";
import { fetchJsonPost as defaultFetchJsonPost, fetchText } from "./fetcher";
import { mergeOfficialNews, parseNewsList } from "./nuca-news";
import { createClient, crawlZones, discoverZones, type FetchHtml, type ZoneCrawl } from "./nuca-plots";
import { OFFICIAL_SITE, officialUrl } from "./official";
import { buildOfficialIndex, type OfficialZoneEntry } from "./official-map";
import { buildIndex, fetchBuiltPoints as defaultFetchBuilt } from "./osm";
import { loadPlanFiles, planCentroids } from "./plan-places";

/** A plan-placed plot whose plan moved it by more than this gets its distances measured again. */
const PLAN_MOVE_KM = 0.02;
import { bumpBookingsByDay, deriveStatuses, hotSectors, recordToTuple, seedBookingsByDay, synthesizeAllocations, tupleToRecord, type PlotRecord } from "./status";

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
  /** Also crawl the booked views (daily): confirms statuses and names of fully booked squares. */
  full?: boolean;
  /** Allow starting without a previous snapshot (otherwise refused, since nothing could be frozen from it). */
  bootstrap?: boolean;
  /** Compute and log everything, write nothing. */
  dryRun?: boolean;
  /** Re-discover the zone list even if the cached one is fresh. */
  forceZones?: boolean;
  /** Accept a run that marks more plots booked than OFFICIAL_SITE.maxNewlyBookedPerRun. */
  acceptLarge?: boolean;
  budgetMs?: number;
  concurrency?: number;
  delayMs?: number;
  zonesMaxAgeMs?: number;
  fetchHtml?: FetchHtml;
  fetchJsonPost?: (url: string, body: unknown) => Promise<unknown>;
  /** Built points near the given district centres (OpenStreetMap). */
  fetchBuiltPoints?: (centers: LatLng[]) => Promise<LatLng[]>;
  /** Building rules from the NUCA booklet. */
  rulesOverrides?: Record<string, BuildingRules>;
  sectorViews?: Record<string, SectorView>;
  districtCentres?: Record<string, LatLng>;
  /** Plot id → position read off the official zone plans (default: public/plans/*.json). */
  planPlaces?: Map<string, LatLng>;
  officialZones?: OfficialZoneEntry[];
  officialCities?: Record<number, string>;
  log?: (...a: unknown[]) => void;
  sleep?: (ms: number) => Promise<void>;
}

export interface RunResult {
  mode: "status" | "full";
  dryRun: boolean;
  changedChunks: string[];
  newlyBooked: number;
  newlyAvailable: number;
  inserted: number;
  /** Plots that got coordinates from the official zone plans this run. */
  located: number;
  osmRefreshed: boolean;
  zonesOk: number;
  zonesFailed: number;
  zonesSkipped: number;
  durationMs: number;
  /** Official news items first seen this run (newest first). */
  officialNew: OfficialNewsItem[];
  /** Plots that became booked this run (≤ 200). */
  newlyBookedPlots: { id: string; city: string; sector: string | null; zone: string | null; plotNo: string; total: number }[];
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
  source: { name: OFFICIAL_SITE.name, url: OFFICIAL_SITE.url },
  market: { total: 0, booked: 0, available: 0, held: 0, allocatedCodes: null, sourceLastUpdate: null },
  allocations: [],
  cities: [],
  sectors: [],
  zones: [],
  chunks: [],
});

export async function loadTuples(store: Store, meta: MetaDoc): Promise<PlotTuple[]> {
  const all: PlotTuple[] = [];
  for (const c of meta.chunks) {
    const doc = await store.getChunk(c.id);
    if (doc) all.push(...(await unpackTuples(doc.data)));
  }
  return all;
}

/** Firestore rejects `undefined`; drop such keys recursively. */
export function stripUndefined<T>(v: T): T {
  if (Array.isArray(v)) return v.map(stripUndefined) as T;
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (x !== undefined) out[k] = stripUndefined(x);
    return out as T;
  }
  return v;
}

interface NewsStep {
  patch: Pick<MetaDoc, "officialNews" | "officialAt" | "officialError" | "officialErrorAt">;
  added: OfficialNewsItem[];
}

/** Fetch + parse + merge the official news. Never throws: a failure keeps the previous items and records the error. */
async function syncNews(prev: MetaDoc, fetchHtml: FetchHtml, now: Date, log: (...a: unknown[]) => void): Promise<NewsStep> {
  try {
    const fresh = parseNewsList(await fetchHtml(officialUrl.news()));
    if (!fresh.length) throw new Error("no items parsed");
    const { items, added } = mergeOfficialNews(prev.officialNews, fresh);
    if (added.length) log(`official news: ${added.length} new item(s): ${added.map((i) => `${i.nid} ${i.title}`).join("; ")}`);
    return { patch: { officialNews: items, officialAt: now.toISOString(), officialError: null, officialErrorAt: prev.officialErrorAt ?? null }, added };
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    log("official news failed:", msg);
    return { patch: { officialNews: prev.officialNews ?? [], officialAt: prev.officialAt ?? null, officialError: msg, officialErrorAt: now.toISOString() }, added: [] };
  }
}

export async function runSync(store: Store, opts: RunOptions = {}): Promise<RunResult> {
  const now = opts.now ?? new Date();
  const t0 = Date.now();
  const log = opts.log ?? ((...a: unknown[]) => console.log("[ingest]", ...a));
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  // A hung connection must cost seconds, not minutes: the zone fails fast and is retried next run.
  const fetchHtml: FetchHtml = opts.fetchHtml ?? ((url, init) => fetchText(url, { method: init?.method, body: init?.body, headers: init?.headers, timeoutMs: OFFICIAL_SITE.requestTimeoutMs, retries: 2 }));
  const fetchJsonPost = opts.fetchJsonPost ?? ((url: string, body: unknown) => defaultFetchJsonPost(url, body));
  const fetchBuilt = opts.fetchBuiltPoints ?? ((c: LatLng[]) => defaultFetchBuilt(c));
  const client = createClient(fetchHtml, { delayMs: opts.delayMs ?? OFFICIAL_SITE.delayMs, sleep });
  const cities = opts.officialCities ?? OFFICIAL_CITIES;
  const index = buildOfficialIndex(opts.officialZones ?? OFFICIAL_ZONES, cities);
  const views = viewCentres(opts.sectorViews ?? SECTOR_VIEWS);
  const approx = new Map(Object.entries(opts.districtCentres ?? DISTRICT_CENTRES));
  const rulesOverrides = opts.rulesOverrides ?? RULES_OVERRIDES;
  const full = !!opts.full;

  const prev = (await store.getMeta()) ?? emptyMeta();
  const meta: MetaDoc = { ...emptyMeta(), ...prev, schema: SCHEMA_VERSION, source: { name: OFFICIAL_SITE.name, url: OFFICIAL_SITE.url } };
  const result: RunResult = {
    mode: full ? "full" : "status",
    dryRun: !!opts.dryRun,
    changedChunks: [],
    newlyBooked: 0,
    newlyAvailable: 0,
    inserted: 0,
    located: 0,
    osmRefreshed: false,
    zonesOk: 0,
    zonesFailed: 0,
    zonesSkipped: 0,
    durationMs: 0,
    officialNew: [],
    newlyBookedPlots: [],
  };
  const news = await syncNews(prev, fetchHtml, now, log);
  Object.assign(meta, news.patch);
  result.officialNew = news.added;

  try {
    if (!prev.chunks.length && !opts.bootstrap) throw new Error("no previous snapshot to freeze ids/coordinates from; run with --bootstrap to start from scratch");

    // 1. zone list (cities → available projects → zones), cached for a day
    const zonesMaxAgeMs = opts.zonesMaxAgeMs ?? OFFICIAL_SITE.zonesMaxAgeMs;
    const cached = prev.official?.zones ?? [];
    const zonesStale = !prev.official?.zonesAt || now.getTime() - Date.parse(prev.official.zonesAt) >= zonesMaxAgeMs;
    let zoneStates: OfficialZoneState[] = cached.map((z) => ({ ...z }));
    let zonesAt = prev.official?.zonesAt ?? null;
    let zonesError: string | null = null;
    if (!cached.length || zonesStale || opts.forceZones) {
      try {
        const found = await discoverZones(client, fetchJsonPost);
        const byZid = new Map(cached.map((z) => [z.zid, z]));
        zoneStates = found.map((z) => ({
          ...(byZid.get(z.zid) ?? { egpPerM: null, lastOkAt: null }),
          zid: z.zid,
          pid: z.pid,
          cityId: z.cityId,
          city: cities[z.cityId] ?? index.cityOf(z.cityId) ?? z.cityName,
          name: z.name,
        }));
        const gone = cached.filter((z) => !found.some((f) => f.zid === z.zid));
        if (gone.length) log(`zones no longer listed: ${gone.map((z) => z.zid).join(", ")} (their plots keep their status)`);
        zonesAt = now.toISOString();
        log(`zones: ${zoneStates.length} listed in ${new Set(zoneStates.map((z) => z.city)).size} cities`);
      } catch (e) {
        zonesError = (e instanceof Error ? e.message : String(e)).slice(0, 300);
        log("zone discovery failed:", zonesError);
      }
    }
    if (!zoneStates.length) throw new Error(`no zones known${zonesError ? `: ${zonesError}` : ""}`);

    // 2. crawl: stalest zones first, within the time budget
    const order = [...zoneStates].sort((a, b) => (a.lastOkAt ?? "").localeCompare(b.lastOkAt ?? ""));
    const crawls = await crawlZones(
      client,
      order.map((z) => z.zid),
      full ? ["available", "booked"] : ["available"],
      { concurrency: opts.concurrency ?? OFFICIAL_SITE.concurrency, budgetMs: opts.budgetMs ?? (full ? OFFICIAL_SITE.fullBudgetMs : OFFICIAL_SITE.budgetMs), log },
    );
    for (const z of zoneStates) {
      const cs = crawls.get(z.zid);
      if (!cs) {
        result.zonesSkipped++;
        continue;
      }
      const avail = cs.find((c) => c.view === "available");
      const booked = cs.find((c) => c.view === "booked");
      const okAll = cs.every((c) => c.ok);
      if (avail?.ok) {
        z.lastOkAt = now.toISOString();
        z.egpPerM = avail.egpPerM ?? z.egpPerM ?? null;
      }
      if (booked?.ok && avail?.ok) z.lastFullAt = now.toISOString();
      if (okAll) {
        result.zonesOk++;
        z.lastError = null;
      } else {
        result.zonesFailed++;
        z.lastError = cs.find((c) => !c.ok)?.error?.slice(0, 200) ?? "failed";
        z.lastErrorAt = now.toISOString();
      }
    }
    log(`crawl: ${result.zonesOk} zone(s) ok, ${result.zonesFailed} failed, ${result.zonesSkipped} not reached (budget)`);
    if (result.zonesOk === 0) throw new Error(`no zone crawled successfully (${result.zonesFailed} failed, ${result.zonesSkipped} skipped)`);
    const okCrawls = new Map<number, ZoneCrawl[]>();
    for (const [zid, cs] of crawls) okCrawls.set(zid, cs.filter((c) => c.ok));

    // 3. statuses: previous records are the universe; the official tables set free/held/booked
    const prevTuples = await loadTuples(store, prev);
    const prevRecords = prevTuples.map((t) => tupleToRecord(t, prev));
    const derived = deriveStatuses({
      prev: prevRecords,
      crawls: okCrawls,
      index,
      zones: zoneStates.map((z) => ({ zid: z.zid, cityId: z.cityId, city: z.city })),
      sectorNames: new Map(prev.sectors.map((s) => [s.id, s.name])),
      now,
    });
    result.newlyBooked = derived.newlyBooked.length;
    result.newlyAvailable = derived.newlyAvailable.length;
    result.inserted = derived.inserted.length;
    if (derived.newSquares.length) log(`squares not in the mapping table: ${derived.newSquares.map((s) => `${s.zid} «${s.square}» ×${s.n}`).join("; ")}`);
    if (derived.unmapped) log(`${derived.unmapped} plot(s) belong to zones with no official counterpart; their status is frozen`);
    const max = OFFICIAL_SITE.maxNewlyBookedPerRun;
    if (result.newlyBooked > max && !opts.acceptLarge) throw new Error(`suspicious: ${result.newlyBooked} plots newly booked in one run (> ${max}); re-run with --accept-large if the site really says so`);
    const byId = new Map(derived.records.map((r) => [r.id, r]));
    result.newlyBookedPlots = derived.newlyBooked.slice(0, 200).map((id) => {
      const r = byId.get(id)!;
      return { id, city: r.cityName, sector: r.sectorName, zone: r.zoneName, plotNo: r.plotNo, total: r.total };
    });
    for (const [zid, s] of derived.perZone) {
      const z = zoneStates.find((x) => x.zid === zid);
      if (z) z.n = s.seen;
    }

    // 3b. positions from the official zone plans. The plan is the source of truth for every plot drawn on one:
    // a corrected plan moves its plots on the next run (the site itself publishes no coordinates). Plots that
    // moved more than a few metres, or had no position, get their building distances measured again.
    const records = derived.records;
    const places = opts.planPlaces ?? planCentroids(loadPlanFiles());
    const newlyLocated: string[] = [];
    let moved = 0;
    for (const r of records) {
      const ll = places.get(r.id);
      if (!ll) continue;
      const had = r.lat != null && r.lng != null;
      const far = !had || distanceKm([r.lat!, r.lng!], ll) > PLAN_MOVE_KM;
      r.lat = ll[0];
      r.lng = ll[1];
      if (!far) continue;
      if (had) moved++;
      newlyLocated.push(r.id);
    }
    result.located = newlyLocated.length;
    if (newlyLocated.length) log(`plans: ${newlyLocated.length} plot(s) placed from the official zone plans (${moved} moved from an earlier position)`);

    // 4. distances to existing buildings for new and newly placed plots (from the plot, else its district centre).
    // Ids whose measurement failed in an earlier run (OpenStreetMap down) are carried in meta.distancePending and
    // retried here, so a failure never leaves a plot with an unknown or stale distance for good.
    const known = new Set(records.map((r) => r.id));
    // `["*"]` = every plan-placed plot (a failed run with too many ids to list); undefined = first run with this
    // code, which also re-measures every plan-placed plot once (earlier runs could not retry after a failure).
    const pendingAll = prev.distancePending === undefined || prev.distancePending.includes("*");
    const pending = pendingAll ? [...places.keys()] : prev.distancePending!;
    const unmeasured = records.filter((r) => r.lat != null && r.lng != null && r.builtSrc !== 0).map((r) => r.id);
    const insertedIds = new Set([...derived.inserted, ...newlyLocated, ...unmeasured, ...pending.filter((id) => known.has(id))]);
    const osmCities: Record<string, string> = { ...(prev.osmCities ?? {}) };
    const newBySector = new Map<string, PlotRecord[]>();
    for (const r of records) if (insertedIds.has(r.id) && r.sectorId) newBySector.set(r.sectorId, [...(newBySector.get(r.sectorId) ?? []), r]);
    meta.distancePending = [];
    if (newBySector.size) {
      const centres = new Map<string, LatLng>();
      const plotCentres = sectorCentroids(records.map((r) => ({ id: r.id, projectId: r.sectorId, cityName: r.cityName, latitude: r.lat, longitude: r.lng })));
      for (const id of newBySector.keys()) {
        const c = plotCentres.get(id) ?? views.get(id) ?? prev.sectors.find((s) => s.id === id)?.c ?? approx.get(id);
        if (c) centres.set(id, c);
      }
      if (centres.size) {
        try {
          const points = await fetchBuilt([...centres.values()]);
          const dist = computeBuiltDistances(
            [...newBySector.values()].flat().map((r) => ({ id: r.id, projectId: r.sectorId, cityName: r.cityName, latitude: r.lat, longitude: r.lng })),
            buildIndex(points),
            centres,
          );
          for (const r of records) {
            const d = dist.get(r.id);
            if (d) {
              r.builtKm = d.km;
              r.builtSrc = d.src;
            }
          }
          result.osmRefreshed = dist.size > 0;
          if (result.osmRefreshed) meta.osmAt = now.toISOString();
          log(`OSM: ${points.length} built points for ${centres.size} district(s) of new plots`);
        } catch (e) {
          meta.distancePending = insertedIds.size > 3000 ? ["*"] : [...insertedIds];
          log(`OSM failed (${meta.distancePending.length} plot(s) keep their distances until the next run):`, e instanceof Error ? e.message : e);
        }
      }
    }
    meta.osmCities = osmCities;

    // 5. lookup tables + tuples
    const cityIdx = new Map<string, number>();
    const sectorIdx = new Map<string, number>();
    const zoneIdx = new Map<string, number>();
    const cityNames: string[] = [];
    const sectors: MetaDoc["sectors"] = [];
    const zoneNames: string[] = [];
    const idx = <K>(m: Map<K, number>, k: K, push: () => void) => {
      let i = m.get(k);
      if (i === undefined) {
        i = m.size;
        m.set(k, i);
        push();
      }
      return i;
    };
    const hot = hotSectors(records, now);
    const prevSectorById = new Map(prev.sectors.map((s) => [s.id, s]));
    const sorted = [...records].sort((x, y) => x.id.localeCompare(y.id));
    const tuples: PlotTuple[] = sorted.map((r) => {
      const c = idx(cityIdx, r.cityName, () => cityNames.push(r.cityName));
      const s = r.sectorId
        ? idx(sectorIdx, r.sectorId, () =>
            sectors.push({
              id: r.sectorId!,
              name: r.sectorName ?? prevSectorById.get(r.sectorId!)?.name ?? "",
              city: c,
              hot: hot.has(r.sectorId!),
              // The booklet table first; otherwise whatever the previous snapshot knew (the official site publishes none).
              rules: rulesOverrides[r.sectorId!] ? { ...rulesOverrides[r.sectorId!], from: "booklet" } : (prevSectorById.get(r.sectorId!)?.rules ?? null),
            }),
          )
        : -1;
      const z = r.zoneName ? idx(zoneIdx, r.zoneName, () => zoneNames.push(r.zoneName!)) : -1;
      return recordToTuple(r, c, s, z);
    });
    const plotCentres = sectorCentroids(records.map((r) => ({ id: r.id, projectId: r.sectorId, cityName: r.cityName, latitude: r.lat, longitude: r.lng })));
    for (const x of sectors) {
      const ll = plotCentres.get(x.id) ?? views.get(x.id) ?? prevSectorById.get(x.id)?.c ?? approx.get(x.id);
      if (ll) x.c = [round(ll[0], 5)!, round(ll[1], 5)!];
    }
    meta.cities = cityNames;
    meta.sectors = sectors;
    meta.zones = zoneNames;

    // 6. market, batches, zone states
    const booked = records.filter((r) => r.state === 1).length;
    const held = records.filter((r) => r.state === 2).length;
    // First run after the switch: seed the per-day counts from the old snapshot, preferring its per-batch bookings
    // (the tracker's booking timestamps were bulk-stamped on some days) over the timestamps.
    const seeded = prev.bookingsByDay ?? seedBookingsByDay(prevRecords, now, prev.allocations);
    const bookingsByDay = bumpBookingsByDay(seeded, result.newlyBooked, now);
    meta.bookingsByDay = bookingsByDay;
    meta.allocations = synthesizeAllocations(meta.officialNews ?? [], bookingsByDay, now);
    const oq = meta.officialNews?.length ? officialQueue(meta.officialNews, now) : null;
    meta.market = {
      total: records.length,
      booked,
      available: records.length - booked,
      held,
      allocatedCodes: oq?.issuedThrough ?? prev.market.allocatedCodes ?? null,
      sourceLastUpdate: now.toISOString(),
    };
    meta.official = { zonesAt, zonesError, unmapped: derived.unmapped, zones: zoneStates };

    // 7. chunk + write only what changed
    const groups: PlotTuple[][] = Array.from({ length: CHUNK_COUNT }, () => []);
    for (const t of tuples) groups[chunkOf(t[0])].push(t);
    const tablesHash = hashString(JSON.stringify([cityNames, sectors, zoneNames]));
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
    meta.statsAt = now.toISOString();
    // The inventory is complete as of the oldest zone refresh; zones rotate across runs, so this lags a run or two.
    const oldest = zoneStates.reduce<string | null>((m, z) => (z.lastOkAt == null ? "" : m == null || z.lastOkAt < m ? z.lastOkAt : m), null);
    if (oldest) meta.fullSyncAt = oldest;
    meta.lastError = null;
    result.durationMs = Date.now() - t0;
    const summary = `${result.mode}: ${records.length} plots (${booked} booked, ${held} held), +${result.inserted} new, ${result.newlyBooked} newly booked, ${result.newlyAvailable} re-available, ${result.changedChunks.length} chunk(s) changed, ${Math.round(result.durationMs / 1000)}s`;
    if (opts.dryRun) {
      log(`DRY RUN ${summary}`);
      const perCity = new Map<string, { total: number; booked: number; held: number; newly: number; inserted: number }>();
      for (const r of records) {
        const c = perCity.get(r.cityName) ?? { total: 0, booked: 0, held: 0, newly: 0, inserted: 0 };
        c.total++;
        if (r.state === 1) c.booked++;
        if (r.state === 2) c.held++;
        if (derived.newlyBooked.includes(r.id)) c.newly++;
        if (insertedIds.has(r.id)) c.inserted++;
        perCity.set(r.cityName, c);
      }
      for (const [city, c] of [...perCity].sort((a, b) => b[1].total - a[1].total)) log(`  ${city}: ${c.total} plots, ${c.booked} booked, ${c.held} held, ${c.newly} newly booked, ${c.inserted} new`);
      log(`  previous market: ${JSON.stringify(prev.market)}`);
      return result;
    }
    await store.commit(writes, stripUndefined(meta));
    log(summary);
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log("sync failed:", msg);
    result.durationMs = Date.now() - t0;
    // Record the failure but keep the last good data (and its timestamps) untouched; the news step still lands.
    if (!opts.dryRun) await store.putMeta(stripUndefined({ ...prev, ...(prev.chunks.length ? {} : meta), ...news.patch, lastError: msg.slice(0, 500), lastErrorAt: now.toISOString() })).catch(() => {});
    return { ...result, error: msg };
  }
}
