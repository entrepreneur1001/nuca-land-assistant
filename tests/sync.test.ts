import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { packTuples, tupleToPlot, unpackTuples, type MetaDoc, type PlotTuple } from "@/data/snapshot";
import { createClient, crawlZone, probeZone } from "@/ingest/nuca-plots";
import { runLive } from "@/ingest/live";
import { OFFICIAL_SITE, officialUrl } from "@/ingest/official";
import { normalizeName, type OfficialZoneEntry } from "@/ingest/official-map";
import { loadTuples, runSync, stripUndefined, type ChunkDoc, type RunOptions, type Store } from "@/ingest/run";
import { recordToTuple, type PlotRecord } from "@/ingest/status";
import { createFakeSite, genPlots, type FakeSiteData } from "./fake-site";

const NEWS = readFileSync(path.join(__dirname, "fixtures/official/newslist.html"), "utf8");
const T0 = new Date("2026-11-09T08:30:00Z"); // Mon 9 Nov 10:30 Cairo
const later = (min: number) => new Date(T0.getTime() + min * 60_000);
const CITY = "القاهرة الجديدة";
const SQ = "الامتداد الجنوبى بالقرب من ديستركت 5";

function memStore() {
  const chunks = new Map<string, ChunkDoc>();
  let meta: MetaDoc | null = null;
  let writes = 0;
  const store: Store = {
    getMeta: async () => meta,
    getChunk: async (id) => chunks.get(id) ?? null,
    async commit(c, m) {
      for (const [id, d] of Object.entries(c)) {
        chunks.set(id, d);
        writes++;
      }
      meta = structuredClone(m);
      writes++;
    },
    async putMeta(m) {
      meta = structuredClone(m);
      writes++;
    },
  };
  return { store, get meta() { return meta; }, get writes() { return writes; }, chunks };
}

/** A tracker-era snapshot: GUID ids, coordinates, OSM distances, booking history. */
async function seedStore(m: ReturnType<typeof memStore>, records: PlotRecord[], extra: Partial<MetaDoc> = {}) {
  const cities = [...new Set(records.map((r) => r.cityName))];
  const sectorIds = [...new Set(records.flatMap((r) => (r.sectorId ? [r.sectorId] : [])))];
  const zones = [...new Set(records.flatMap((r) => (r.zoneName ? [r.zoneName] : [])))];
  const tuples = records.map((r) => recordToTuple(r, cities.indexOf(r.cityName), r.sectorId ? sectorIds.indexOf(r.sectorId) : -1, r.zoneName ? zones.indexOf(r.zoneName) : -1));
  const data = await packTuples(tuples);
  const meta: MetaDoc = {
    schema: 1,
    dataVersion: "seed",
    statsAt: "2026-11-09T06:00:00Z",
    fullSyncAt: "2026-11-09T06:00:00Z",
    osmAt: null,
    lastError: null,
    lastErrorAt: null,
    source: { name: "old", url: "old" },
    market: { total: records.length, booked: records.filter((r) => r.state === 1).length, available: records.filter((r) => r.state !== 1).length, allocatedCodes: 10000, sourceLastUpdate: null },
    allocations: [],
    cities,
    sectors: sectorIds.map((id) => ({ id, name: records.find((r) => r.sectorId === id)!.sectorName ?? id, city: 0, hot: false, c: id === "sec-a" ? [30.01, 31.02] : undefined })),
    zones,
    chunks: [{ id: "c0", v: "seed", n: tuples.length }],
    ...extra,
  };
  await m.store.commit({ c0: { version: "seed", n: tuples.length, data } }, stripUndefined(meta));
}

const rec = (plotNo: string, state: 0 | 1 | 2 = 0, extra: Partial<PlotRecord> = {}): PlotRecord => ({
  id: `guid-${plotNo}`,
  ext: null,
  plotNo,
  cityName: CITY,
  sectorId: "sec-a",
  sectorName: "الامتداد الجنوبى",
  zoneName: SQ,
  area: 500 + (Number(plotNo) % 7) * 10,
  ppm: 450,
  total: (500 + (Number(plotNo) % 7) * 10) * 450,
  dp: ((500 + (Number(plotNo) % 7) * 10) * 450) / 4,
  corner: 0,
  garden: 0,
  sea: 0,
  lat: 30.01,
  lng: 31.02,
  state,
  bookingTs: state === 1 ? Date.parse("2026-11-05T09:00:00Z") : 0,
  builtKm: 0.8,
  builtSrc: 0,
  roadM: 25,
  sq: null,
  ...extra,
});

const table: OfficialZoneEntry[] = [{ zid: 4797, pid: 2284, cityId: 1, city: CITY, name: "المرحلة الحادية عشر - الامتداد الجنوبى", squares: { [normalizeName(SQ)]: { sector: "sec-a", zone: SQ } } }];
const officialCities = { 1: CITY, 9: "السادس من أكتوبر" };

function siteData(plots = genPlots(45, { square: SQ, status: (i) => (i % 5 === 0 ? "held" : "free") })): FakeSiteData {
  return {
    cities: [
      { id: 1, name: CITY },
      { id: 9, name: "السادس من اكتوبر" },
    ],
    projects: {
      2284: { cityId: 1, name: "المرحلة الحادية عشر - الامتداد الجنوبى", green: true, zones: [4797] },
      57: { cityId: 1, name: "Cairo Walk", green: false, zones: [77] },
      1277: { cityId: 9, name: "المرحلة الحادية عشر - الأرض 12", green: true, zones: [3789] },
    },
    zones: {
      4797: { name: "الامتداد الجنوبى", egpPerM: 23455, plots },
      77: { name: "قديم", egpPerM: null, plots: genPlots(3, { square: "x" }) },
      3789: { name: "الأرض 12", egpPerM: 15000, plots: [] },
    },
  };
}

function harness(data = siteData(), news: string | null = NEWS) {
  const site = createFakeSite(data);
  const fetchHtml: NonNullable<RunOptions["fetchHtml"]> = async (url, init) => {
    if (url === officialUrl.news()) {
      if (news == null) throw new Error("news down");
      return news;
    }
    return site.fetchHtml(url, init);
  };
  const opts: RunOptions = {
    fetchHtml,
    fetchJsonPost: site.fetchJsonPost,
    fetchBuiltPoints: async () => [[30.0105, 31.0205]],
    officialZones: table,
    officialCities,
    rulesOverrides: {},
    sectorViews: {},
    districtCentres: {},
    delayMs: 0,
    log: () => {},
    sleep: async () => {},
  };
  return { site, opts };
}

const limit = OFFICIAL_SITE.maxNewlyBookedPerRun;
afterEach(() => {
  OFFICIAL_SITE.maxNewlyBookedPerRun = limit;
});

describe("sync runner (official site)", () => {
  it("keeps ids, coordinates and history from the previous snapshot and applies the official statuses", async () => {
    const m = memStore();
    // 45 plots known; the site now lists 1..45 except 7 and 20 (booked), with every 5th held
    await seedStore(m, Array.from({ length: 45 }, (_, i) => rec(String(i + 1), i + 1 === 3 ? 1 : 0)));
    const data = siteData(genPlots(45, { square: SQ, status: (i) => (i % 5 === 0 ? "held" : "free") }).filter((p) => !["7", "20"].includes(p.plotNo)));
    const { site, opts } = harness(data);
    const r = await runSync(m.store, { ...opts, now: T0 });
    expect(r.error).toBeUndefined();
    expect(r.mode).toBe("status");
    expect(r.zonesOk).toBe(2);
    expect(r.inserted).toBe(0);
    expect(r.newlyBooked).toBe(2);
    expect(r.newlyAvailable).toBe(1); // plot 3 was booked in the snapshot but is offered again
    expect(r.newlyBookedPlots.map((p) => p.plotNo).sort()).toEqual(["20", "7"]);
    expect(r.newlyBookedLabels.map((p) => p.id).sort()).toEqual(r.newlyBookedPlots.map((p) => p.id).sort());
    expect(r.newlyBookedLabels.every((p) => p.city && p.plotNo)).toBe(true);
    const tuples = await loadTuples(m.store, m.meta!);
    expect(tuples).toHaveLength(45);
    const byNo = new Map(tuples.map((t) => [t[2], t]));
    expect(byNo.get("7")![0]).toBe("guid-7");
    expect(byNo.get("7")!.slice(13, 17)).toEqual([30.01, 31.02, 1, T0.getTime()]);
    expect(byNo.get("7")![17]).toBe(0.8);
    expect(byNo.get("1")![15]).toBe(2); // genPlots index 0 → held
    expect(byNo.get("3")!.slice(15, 17)).toEqual([0, 0]);
    expect(m.meta!.market).toMatchObject({ total: 45, booked: 2, available: 43, held: 9, allocatedCodes: 10700 });
    expect(m.meta!.source.name).toBe("lands.nuca.gov.eg");
    expect(m.meta!.statsAt).toBe(T0.toISOString());
    expect(m.meta!.fullSyncAt).toBe(T0.toISOString());
    expect(m.meta!.official!.zones.map((z) => z.zid).sort()).toEqual([3789, 4797]);
    expect(m.meta!.official!.zones.find((z) => z.zid === 4797)).toMatchObject({ city: CITY, egpPerM: 23455, n: 45, lastOkAt: T0.toISOString(), lastError: null });
    expect(m.meta!.official!.zones.find((z) => z.zid === 3789)!.city).toBe("السادس من أكتوبر");
    // the official news drives the batches: codes issued through 10700 today, 700-code batches
    expect(m.meta!.officialNews!.length).toBe(10);
    expect(r.officialNew.length).toBe(10);
    expect(m.meta!.allocations.at(-1)).toMatchObject({ id: "nid-9117", c: 700 });
    expect(m.meta!.bookingsByDay).toEqual({ "2026-11-05": 1, "2026-11-09": 2 });
    expect(site.requests.some((q) => q.url.includes("GetSiteCities"))).toBe(true);
    const plot = tupleToPlot(byNo.get("1")!, m.meta!);
    expect(plot).toMatchObject({ status: "available", held: true, projectId: "sec-a" });
  });

  it("refuses to start from nothing unless --bootstrap, then gives new plots deterministic ids", async () => {
    const m = memStore();
    const { opts } = harness();
    const r = await runSync(m.store, { ...opts, now: T0 });
    expect(r.error).toMatch(/bootstrap/);
    expect(m.meta!.lastError).toMatch(/bootstrap/);
    expect(m.meta!.officialNews!.length).toBe(10); // the news still landed
    const r2 = await runSync(m.store, { ...opts, bootstrap: true, now: later(15) });
    expect(r2.error).toBeUndefined();
    expect(r2.inserted).toBe(45);
    const tuples = await loadTuples(m.store, m.meta!);
    expect(tuples.every((t) => t[0].startsWith("o4797-"))).toBe(true);
    expect(tuples.every((t) => t[13] === null && t[18] !== 0)).toBe(true);
    expect(m.meta!.sectors.map((s) => s.id)).toEqual(["sec-a"]);
  });

  it("a new booking rewrites only the affected chunk, and an unchanged run writes only meta", async () => {
    const m = memStore();
    await seedStore(m, Array.from({ length: 60 }, (_, i) => rec(String(i + 1))));
    const { site, opts } = harness(siteData(genPlots(60, { square: SQ, status: () => "free" })));
    await runSync(m.store, { ...opts, now: T0 });
    const before = m.writes;
    const r = await runSync(m.store, { ...opts, now: later(15) });
    expect(r.changedChunks).toEqual([]);
    expect(m.writes - before).toBe(1);
    site.data.zones[4797].plots = site.data.zones[4797].plots.filter((p) => p.plotNo !== "9");
    const r2 = await runSync(m.store, { ...opts, now: later(30) });
    expect(r2.newlyBooked).toBe(1);
    expect(r2.changedChunks).toHaveLength(1);
    expect(m.meta!.bookingsByDay!["2026-11-09"]).toBe(1);
  });

  it("a zone whose pages fail keeps every status and records the error; the run still writes the others", async () => {
    const m = memStore();
    await seedStore(m, Array.from({ length: 30 }, (_, i) => rec(String(i + 1))));
    const { site, opts } = harness(siteData(genPlots(10, { square: SQ, status: () => "free" })));
    // every request to zone 4797 answers the error page (crawlZone retries once, then gives up)
    site.failOnce("ViewZone.aspx?ID=4797", "no-table");
    site.failOnce("ViewZone.aspx?ID=4797", "no-table");
    const r = await runSync(m.store, { ...opts, now: T0 });
    expect(r.error).toBeUndefined();
    expect(r.zonesFailed).toBe(1);
    expect(r.zonesOk).toBe(1);
    expect(r.newlyBooked).toBe(0);
    expect(m.meta!.official!.zones.find((z) => z.zid === 4797)).toMatchObject({ lastOkAt: null, lastErrorAt: T0.toISOString() });
    expect(m.meta!.official!.zones.find((z) => z.zid === 4797)!.lastError).toBeTruthy();
    expect(m.meta!.statsAt).toBe(T0.toISOString());
    expect(m.meta!.fullSyncAt).toBe("2026-11-09T06:00:00Z");
    expect((await loadTuples(m.store, m.meta!)).every((t) => t[15] === 0)).toBe(true);
    // once the zone recovers, the complete-pass time is the oldest zone refresh
    const r2 = await runSync(m.store, { ...opts, now: later(15) });
    expect(r2.zonesOk).toBe(2);
    expect(m.meta!.fullSyncAt).toBe(later(15).toISOString());
    expect(m.meta!.official!.zones.find((z) => z.zid === 4797)!.lastError).toBeNull();
  });

  it("a run that does not reach every zone keeps the complete-pass time at the oldest refresh", async () => {
    const m = memStore();
    await seedStore(m, [rec("1")]);
    const { opts } = harness(siteData(genPlots(1, { square: SQ, status: () => "free" })));
    // a 1 ms budget on a clock that ticks 0.6 ms per reading lets exactly the first zone start
    const ticking = () => { let n = 0; return () => n++ * 0.6; };
    const r = await runSync(m.store, { ...opts, budgetMs: 1, concurrency: 1, now: T0, clock: ticking() });
    expect(r.zonesOk).toBe(1);
    expect(r.zonesSkipped).toBe(1);
    expect(m.meta!.statsAt).toBe(T0.toISOString());
    expect(m.meta!.fullSyncAt).toBe("2026-11-09T06:00:00Z");
    const r2 = await runSync(m.store, { ...opts, budgetMs: 1, concurrency: 1, now: later(15), clock: ticking() });
    expect(r2.zonesOk).toBe(1);
    expect(m.meta!.fullSyncAt).toBe(T0.toISOString()); // the zone done 15 min ago is now the oldest
  });

  it("fails the run (keeping the last good data) when no zone could be crawled", async () => {
    const m = memStore();
    await seedStore(m, [rec("1"), rec("2")]);
    const good = structuredClone(m.meta!);
    const { site, opts } = harness();
    for (let i = 0; i < 8; i++) site.failOnce("ViewZone.aspx", "503");
    const r = await runSync(m.store, { ...opts, now: T0 });
    expect(r.error).toMatch(/no zone crawled/);
    expect(m.meta!.chunks).toEqual(good.chunks);
    expect(m.meta!.fullSyncAt).toBe(good.fullSyncAt);
    expect(m.meta!.lastError).toMatch(/no zone/);
  });

  it("refuses a run that would book suspiciously many plots unless --accept-large", async () => {
    const m = memStore();
    await seedStore(m, Array.from({ length: 30 }, (_, i) => rec(String(i + 1))));
    OFFICIAL_SITE.maxNewlyBookedPerRun = 5;
    const { opts } = harness(siteData(genPlots(10, { square: SQ, status: () => "free" })));
    const r = await runSync(m.store, { ...opts, now: T0 });
    expect(r.error).toMatch(/suspicious: 20/);
    expect((await loadTuples(m.store, m.meta!)).every((t) => t[15] === 0)).toBe(true);
    const r2 = await runSync(m.store, { ...opts, acceptLarge: true, now: later(15) });
    expect(r2.error).toBeUndefined();
    expect(r2.newlyBooked).toBe(20);
  });

  it("a full run also reads the booked view and stamps lastFullAt", async () => {
    const m = memStore();
    await seedStore(m, Array.from({ length: 12 }, (_, i) => rec(String(i + 1))));
    const plots = genPlots(12, { square: SQ, status: (i) => (i < 4 ? "booked" : "free") });
    const { site, opts } = harness(siteData(plots));
    const r = await runSync(m.store, { ...opts, full: true, now: T0 });
    expect(r.mode).toBe("full");
    expect(r.newlyBooked).toBe(4);
    expect(site.requests.some((q) => q.target === "ctl00$MainContent$rdShowBooked")).toBe(true);
    expect(m.meta!.official!.zones.find((z) => z.zid === 4797)!.lastFullAt).toBe(T0.toISOString());
  });

  it("caches the zone list for a day and re-discovers on demand", async () => {
    const m = memStore();
    await seedStore(m, [rec("1")]);
    const { site, opts } = harness(siteData(genPlots(1, { square: SQ, status: () => "free" })));
    await runSync(m.store, { ...opts, now: T0 });
    const cities = () => site.requests.filter((q) => q.url.includes("GetSiteCities")).length;
    expect(cities()).toBe(1);
    await runSync(m.store, { ...opts, now: later(15) });
    expect(cities()).toBe(1);
    await runSync(m.store, { ...opts, forceZones: true, now: later(30) });
    expect(cities()).toBe(2);
    await runSync(m.store, { ...opts, now: later(25 * 60) });
    expect(cities()).toBe(3);
    // discovery failure keeps the cached list
    site.failOnce("GetSiteCities", "503");
    site.failOnce("GetSiteCities", "503");
    site.failOnce("GetSiteCities", "503");
    site.failOnce("GetSiteCities", "503");
    const r = await runSync(m.store, { ...opts, forceZones: true, now: later(26 * 60) });
    expect(r.error).toBeUndefined();
    expect(m.meta!.official!.zonesError).toBeTruthy();
    expect(m.meta!.official!.zones).toHaveLength(2);
  });

  it("a news failure keeps the previous items and never fails the run", async () => {
    const m = memStore();
    await seedStore(m, [rec("1")]);
    const { opts } = harness(siteData(genPlots(1, { square: SQ, status: () => "free" })));
    await runSync(m.store, { ...opts, now: T0 });
    const { opts: down } = harness(siteData(genPlots(1, { square: SQ, status: () => "free" })), null);
    const r = await runSync(m.store, { ...down, now: later(15) });
    expect(r.error).toBeUndefined();
    expect(r.officialNew).toEqual([]);
    expect(m.meta!.officialNews).toHaveLength(10);
    expect(m.meta!.officialError).toMatch(/news down/);
    expect(m.meta!.officialAt).toBe(T0.toISOString());
  });

  it("derives hot districts from the last week's bookings and reads rules from the booklet table only", async () => {
    const m = memStore();
    const recs = Array.from({ length: 40 }, (_, i) => rec(String(i + 1), i < 12 ? 1 : 0, { bookingTs: i < 12 ? T0.getTime() - 3600_000 : 0 }));
    await seedStore(m, recs);
    const { opts } = harness(siteData(genPlots(40, { square: SQ, status: () => "free" }).filter((p) => Number(p.plotNo) > 12)));
    await runSync(m.store, { ...opts, rulesOverrides: { "sec-a": { ratio: "50 %", floors: "بدروم + أرضي + دورين", setbacks: null } }, now: T0 });
    const s = m.meta!.sectors.find((x) => x.id === "sec-a")!;
    expect(s.hot).toBe(true);
    expect(s.rules).toEqual({ ratio: "50 %", floors: "بدروم + أرضي + دورين", setbacks: null, from: "booklet" });
    expect(s.c).toEqual([30.01, 31.02]);
  });

  it("keeps the previous snapshot's rules and per-batch bookings when the booklet and the site have none", async () => {
    const m = memStore();
    const recs = [rec("1", 1, { bookingTs: Date.parse("2026-11-07T23:00:00Z") }), rec("2")];
    await seedStore(m, recs, { allocations: [{ id: "old", d: "2026-11-07T22:00:00Z", c: 700, b: 336 }] });
    m.meta!.sectors[0].rules = { ratio: "60 %", floors: "أرضي + 3", setbacks: null, from: "source" };
    await m.store.putMeta(m.meta!);
    const { opts } = harness(siteData(genPlots(2, { square: SQ, status: () => "free" }).slice(1)));
    await runSync(m.store, { ...opts, now: T0 });
    expect(m.meta!.sectors[0].rules).toEqual({ ratio: "60 %", floors: "أرضي + 3", setbacks: null, from: "source" });
    expect(m.meta!.bookingsByDay).toEqual({ "2026-11-08": 336 });
  });

  it("measures built-up distance for new plots from their district centre and leaves old ones alone", async () => {
    const m = memStore();
    await seedStore(m, [rec("1"), rec("2")]);
    let osmCalls = 0;
    const { opts } = harness(siteData(genPlots(4, { square: SQ, status: () => "free" })));
    const r = await runSync(m.store, {
      ...opts,
      fetchBuiltPoints: async (c) => {
        osmCalls++;
        expect(c).toEqual([[30.01, 31.02]]);
        return [[30.012, 31.02]];
      },
      now: T0,
    });
    expect(r.inserted).toBe(2);
    expect(osmCalls).toBe(1);
    expect(r.osmRefreshed).toBe(true);
    const tuples = await loadTuples(m.store, m.meta!);
    const byNo = new Map(tuples.map((t) => [t[2], t]));
    expect(byNo.get("1")!.slice(17, 19)).toEqual([0.8, 0]);
    expect(byNo.get("3")![18]).toBe(1);
    expect(byNo.get("3")![17]).toBeGreaterThan(0);
    expect(tupleToPlot(byNo.get("3")!, m.meta!).approxLoc).toEqual({ lat: 30.01, lng: 31.02 });
  });

  it("a dry run reports but writes nothing", async () => {
    const m = memStore();
    await seedStore(m, [rec("1"), rec("2")]);
    const before = m.writes;
    const lines: string[] = [];
    const { opts } = harness(siteData(genPlots(1, { square: SQ, status: () => "free" })));
    const r = await runSync(m.store, { ...opts, dryRun: true, log: (...a) => lines.push(a.join(" ")), now: T0 });
    expect(r.error).toBeUndefined();
    expect(r.newlyBooked).toBe(1);
    expect(m.writes).toBe(before);
    expect(lines.some((l) => l.startsWith("DRY RUN"))).toBe(true);
  });

  it("strips undefined before writing and the crawl client is paced", async () => {
    expect(stripUndefined({ a: 1, b: undefined, c: { d: undefined, e: [1, { f: undefined }] } })).toEqual({ a: 1, c: { e: [1, {}] } });
    const { site } = harness();
    const c = createClient(site.fetchHtml, { delayMs: 0 });
    const z = await crawlZone(c, 4797, "available");
    expect(z.ok).toBe(true);
    expect(z.rows).toHaveLength(45);
  });

  it("round-trips the packed tuples with the held state", async () => {
    const t: PlotTuple[] = [["a", null, "1", 0, -1, -1, 500, 200, 100000, 25000, 10, 0, 0, 30.1, 31.2, 2, 0, 0.5, 0, 12]];
    expect(await unpackTuples(await packTuples(t))).toEqual(t);
    const p = tupleToPlot(t[0], { cities: ["مدينة"], sectors: [], zones: [] });
    expect(p).toMatchObject({ status: "available", held: true, mainRoadM: 12 });
  });
  it("takes every plot's position from the zone plans, re-measuring distances only for plots that moved", async () => {
    const m = memStore();
    await seedStore(m, Array.from({ length: 10 }, (_, i) => rec(String(i + 1), 0, i + 1 === 9 ? { lat: null, lng: null, builtKm: null, builtSrc: 2 } : {})));
    const { opts } = harness(siteData(genPlots(10, { square: SQ })));
    const planPlaces = new Map<string, [number, number]>([
      ["guid-1", [30.01001, 31.02001]], // ~1.5 m from the stored position: moved, not re-measured
      ["guid-2", [30.02, 31.03]], // ~1.4 km away: a corrected plan moved it
      ["guid-9", [30.015, 31.025]], // never had a position
    ]);
    const r = await runSync(m.store, { ...opts, planPlaces, now: T0 });
    expect(r.error).toBeUndefined();
    expect(r.located).toBe(2);
    const byNo = new Map((await loadTuples(m.store, m.meta!)).map((t) => [t[2], t]));
    expect([byNo.get("1")![13], byNo.get("1")![14]]).toEqual([30.01001, 31.02001]);
    expect([byNo.get("2")![13], byNo.get("2")![14]]).toEqual([30.02, 31.03]);
    expect([byNo.get("9")![13], byNo.get("9")![14]]).toEqual([30.015, 31.025]);
    expect(byNo.get("9")![18]).toBe(0); // measured from the plot itself
    expect([byNo.get("3")![13], byNo.get("3")![14]]).toEqual([30.01, 31.02]); // not on a plan: untouched
  });
  it("retries building distances next run when OpenStreetMap was down", async () => {
    const m = memStore();
    await seedStore(m, Array.from({ length: 5 }, (_, i) => rec(String(i + 1), 0, i + 1 === 2 ? { lat: null, lng: null, builtKm: null, builtSrc: 2 } : {})));
    const { opts } = harness(siteData(genPlots(5, { square: SQ })));
    const planPlaces = new Map<string, [number, number]>([["guid-2", [30.015, 31.025]]]);
    const down = await runSync(m.store, { ...opts, planPlaces, now: T0, fetchBuiltPoints: async () => { throw new Error("fetch failed"); } });
    expect(down.error).toBeUndefined();
    expect(m.meta!.distancePending).toEqual(["s:sec-a"]);
    let byNo = new Map((await loadTuples(m.store, m.meta!)).map((t) => [t[2], t]));
    expect(byNo.get("2")![18]).toBe(2); // still unknown
    const up = await runSync(m.store, { ...opts, planPlaces, now: later(15) });
    expect(up.error).toBeUndefined();
    expect(up.osmRefreshed).toBe(true);
    expect(m.meta!.distancePending).toEqual([]);
    byNo = new Map((await loadTuples(m.store, m.meta!)).map((t) => [t[2], t]));
    expect(byNo.get("2")![18]).toBe(0); // measured from the plot on the retry
  });
  it("measures a district with committed built points even when the OpenStreetMap budget is zero", async () => {
    const m = memStore();
    await seedStore(m, Array.from({ length: 5 }, (_, i) => rec(String(i + 1), 0, i + 1 === 2 ? { lat: null, lng: null, builtKm: null, builtSrc: 2 } : {})));
    const { opts } = harness(siteData(genPlots(5, { square: SQ })));
    const planPlaces = new Map<string, [number, number]>([["guid-2", [30.015, 31.025]]]);
    const asked: unknown[] = [];
    const run = await runSync(m.store, {
      ...opts,
      planPlaces,
      now: T0,
      osmBudgetMs: 0,
      builtCache: (sid) => (sid === "sec-a" ? [[30.0151, 31.0251]] : null),
      fetchBuiltPoints: async (c) => {
        asked.push(c);
        return [];
      },
    });
    expect(run.error).toBeUndefined();
    expect(asked).toEqual([]); // no network
    expect(m.meta!.distancePending).toEqual([]);
    const byNo = new Map((await loadTuples(m.store, m.meta!)).map((t) => [t[2], t]));
    expect(byNo.get("2")![18]).toBe(0);
  });
});

describe("live loop: one-request probes", () => {
  it("probeZone replays the last page with one request and sees a booking anywhere in the zone", async () => {
    const data = siteData(genPlots(45, { square: SQ, status: () => "free" }));
    const site = createFakeSite(data);
    const client = createClient(site.fetchHtml);
    const c = await crawlZone(client, 4797, "available");
    expect(c.probe).toMatchObject({ pages: 3 });
    expect(c.probe!.hidden).not.toBeNull();
    const n = site.requests.length;
    expect(await probeZone(client, 4797, c.probe!)).toEqual({ changed: false });
    expect(site.requests.slice(n).map((r) => `${r.method} ${r.argument}`)).toEqual(["POST Page$3"]);
    // a plot on page 1 gets booked: every later page shifts, so the last page changes
    data.zones[4797].plots.find((p) => p.plotNo === "7")!.status = "booked";
    expect((await probeZone(client, 4797, c.probe!)).changed).toBe(true);
    // the zone shrinks to 2 pages: the replayed postback hits the error page, which also counts as a change
    data.zones[4797].plots.splice(30);
    expect(await probeZone(client, 4797, c.probe!)).toMatchObject({ changed: true, error: expect.any(String) });
    // a connection reset or a 503 says nothing about the zone
    site.failOnce("ViewZone.aspx", "reset");
    expect(await probeZone(client, 4797, c.probe!)).toMatchObject({ changed: false, error: expect.any(String) });
    site.failOnce("ViewZone.aspx", "503");
    expect(await probeZone(client, 4797, c.probe!)).toMatchObject({ changed: false, error: expect.any(String) });
    // a held flag on the last page counts too
    const fresh = (await crawlZone(client, 4797, "available")).probe!;
    data.zones[4797].plots.at(-1)!.status = "held";
    expect((await probeZone(client, 4797, fresh)).changed).toBe(true);
  });

  it("probes a one-page or empty zone with a plain GET", async () => {
    const site = createFakeSite(siteData());
    const client = createClient(site.fetchHtml);
    const c = await crawlZone(client, 3789, "available");
    expect(c.probe).toEqual({ pages: 1, hidden: null, sig: "" });
    const n = site.requests.length;
    expect(await probeZone(client, 3789, c.probe!)).toEqual({ changed: false });
    expect(site.requests.slice(n).map((r) => r.method)).toEqual(["GET"]);
    site.data.zones[3789].plots.push(...genPlots(2, { square: "س" }));
    expect((await probeZone(client, 3789, c.probe!)).changed).toBe(true);
  });

  it("runSync with onlyZones walks just those zones, skips the news on request and returns their probes", async () => {
    const m = memStore();
    await seedStore(m, Array.from({ length: 45 }, (_, i) => rec(String(i + 1))));
    const { site, opts } = harness();
    await runSync(m.store, { ...opts, now: T0 });
    const n = site.requests.length;
    const r = await runSync(m.store, { ...opts, now: later(1), onlyZones: [4797], skipNews: true });
    expect(r.error).toBeUndefined();
    expect(r.zonesOk).toBe(1);
    expect(new Set(site.requests.slice(n).map((q) => q.zid))).toEqual(new Set([4797]));
    expect([...r.probes.keys()]).toEqual([4797]);
    expect(m.meta!.officialNews?.length).toBeGreaterThan(0); // kept from the first run
  });

  it("runLive seeds, then walks only the zone whose probe changed and reports the booking", async () => {
    const m = memStore();
    await seedStore(m, Array.from({ length: 45 }, (_, i) => rec(String(i + 1))));
    const data = siteData(genPlots(45, { square: SQ, status: () => "free" }));
    const { site, opts } = harness(data);
    let t = T0.getTime();
    const booked: string[][] = [];
    const lines: string[] = [];
    const stats = await runLive(m.store, {
      durationMs: 3 * 60_000,
      delayMs: 0,
      fetchHtml: opts.fetchHtml,
      sync: { ...opts, log: () => {} },
      now: () => t,
      sleep: async (ms) => {
        t += ms;
      },
      log: (...a) => {
        const line = a.join(" ");
        lines.push(line);
        // plot 7 is booked right after the seed walk
        if (line.startsWith("seed:")) data.zones[4797].plots.find((p) => p.plotNo === "7")!.status = "booked";
      },
      onRun: async (r) => {
        if (r.newlyBookedLabels.length) booked.push(r.newlyBookedLabels.map((l) => l.plotNo));
      },
    });
    expect(booked).toEqual([["7"]]);
    expect(stats.ticks).toBe(3);
    expect(stats.newlyBooked).toBe(1);
    // tick 1: every zone was just walked by the seed, nothing is due yet
    expect(lines[1]).toMatch(/^tick 1: 0\/0 probed/);
    // tick 2: only the zone with plots is due (the empty one waits 5 min): one request, the change, one walk
    expect(lines[2]).toMatch(/^tick 2: 1\/1 probed .* 1 changed \[4797\].* 1 newly booked/);
    expect(lines[3]).toMatch(/^tick 3: 1\/1 probed .* 0 changed$/);
    const tuples = await loadTuples(m.store, m.meta!);
    expect(tuples.find((x) => x[2] === "7")).toBeDefined();
    void site;
  });
});
