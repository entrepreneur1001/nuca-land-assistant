import { describe, expect, it } from "vitest";
import { packTuples, tupleToPlot, unpackTuples, type MetaDoc, type PlotTuple } from "@/data/snapshot";
import { loadTuples, runSync, type ChunkDoc, type Store } from "@/ingest/run";

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
  return { store, get meta() { return meta; }, get writes() { return writes; } };
}

const plot = (i: number, booked = false) => ({
  id: `id-${String(i).padStart(4, "0")}`,
  externalPlotId: String(1000 + i),
  plotNumber: String(i),
  area: 500 + i,
  totalPricePerMeter: 200,
  totalPrice: (500 + i) * 200,
  downPayment: ((500 + i) * 200) / 4,
  corner: i % 3 === 0 ? 10 : 0,
  gardenView: i % 5 === 0 ? 5 : 0,
  seaOrNileView: 0,
  cityName: i % 2 ? "مدينة أ" : "مدينة ب",
  sectorId: `s${i % 4}`,
  sectorName: `حي ${i % 4}`,
  zoneName: `منطقة ${i % 6}`,
  isBooked: booked,
  bookingDate: booked ? "2026-10-06T10:00:00" : null,
  geoJson: JSON.stringify({ type: "Feature", geometry: { type: "Polygon", coordinates: [[[31 + i / 1e4, 30], [31.0005 + i / 1e4, 30], [31.0005 + i / 1e4, 30.0005], [31 + i / 1e4, 30]]] } }),
});

function fakeSource(n: number, bookedIds: Set<number>, opts: { failPage?: boolean; stats?: { booked: number } } = {}) {
  const all = Array.from({ length: n }, (_, i) => plot(i, bookedIds.has(i)));
  return async (path: string): Promise<unknown> => {
    if (path.startsWith("/api/app/dashboard/dashboard-statistics"))
      return { totalPlots: n, bookedPlots: opts.stats?.booked ?? bookedIds.size, availablePlots: n - (opts.stats?.booked ?? bookedIds.size), lastUpdate: "2026-10-07T10:00:00" };
    if (path.startsWith("/api/app/dashboard/enhanced")) return { allocatedBookings: 600 };
    if (path.startsWith("/api/app/dashboard/allocation-statistics")) return [{ allocationId: "a1", issueDate: "2026-10-05T00:00:00", totalCodesIssued: 300, plotsBooked: 200 }];
    if (path.startsWith("/api/app/booking-allocation"))
      return { totalCount: 2, items: [{ id: "a1", issueDate: "2026-10-05T00:00:00", totalCodes: 300 }, { id: "a2", issueDate: "2026-10-06T00:00:00", totalCodes: 300 }] };
    if (path.startsWith("/api/app/sector")) return { totalCount: 1, items: [{ id: "s1", name: "حي 1", isHot: true, buildingRatio: "50 %", allowedFloors: "بدروم + أرضي + دورين", setbacks: "3م امامي -  5م خلفي" }] };
    if (path.startsWith("/api/app/land-plot")) {
      const skip = Number(/SkipCount=(\d+)/.exec(path)![1]);
      const max = Number(/MaxResultCount=(\d+)/.exec(path)![1]);
      if (opts.failPage && skip > 0) throw new Error("HTTP 503");
      return { totalCount: n, items: all.slice(skip, skip + max) };
    }
    throw new Error(`unexpected ${path}`);
  };
}

const quiet = { log: () => {}, sleep: async () => {} };
const osm = async () => [[30.0002, 31.0002]] as [number, number][];

describe("snapshot packing", () => {
  it("round-trips tuples through gzip+base64", async () => {
    const t: PlotTuple[] = [["a", null, "1", 0, -1, -1, 500, 200, 100000, 25000, 10, 0, 0, 30.1, 31.2, 1, 123, 0.5, 0]];
    expect(await unpackTuples(await packTuples(t))).toEqual(t);
    const p = tupleToPlot(t[0], { cities: ["مدينة"], sectors: [], zones: [] });
    expect(p).toMatchObject({ cityName: "مدينة", status: "booked", projectId: null, builtKm: 0.5 });
  });
});

describe("sync runner", () => {
  it("first run writes every chunk; unchanged second run writes only meta", async () => {
    const m = memStore();
    const src = fakeSource(60, new Set([1, 2]));
    const r1 = await runSync(m.store, { ...quiet, fetchJson: src, fetchBuiltPoints: osm, now: new Date("2026-10-07T10:00:00Z") });
    expect(r1.error).toBeUndefined();
    expect(r1.mode).toBe("full");
    expect(r1.osmRefreshed).toBe(true);
    const tuples = await loadTuples(m.store, m.meta!);
    expect(tuples).toHaveLength(60);
    expect(tuples.filter((x) => x[15] === 1)).toHaveLength(2);
    expect(tuples.every((x) => x[17] != null)).toBe(true);
    expect(m.meta!.allocations.map((a) => a.c)).toEqual([300, 300]);
    expect(m.meta!.sectors.find((s) => s.id === "s1")?.hot).toBe(true);
    // building regulations travel with the district and reach every plot in it
    expect(m.meta!.sectors.find((s) => s.id === "s1")?.rules).toEqual({ ratio: "50 %", floors: "بدروم + أرضي + دورين", setbacks: "3م امامي - 5م خلفي" });
    expect(m.meta!.sectors.find((s) => s.id === "s2")?.rules).toBeNull();
    const plotInS1 = tuples.find((x) => m.meta!.sectors[x[4]]?.id === "s1")!;
    expect(tupleToPlot(plotInS1, m.meta!).rules?.floors).toBe("بدروم + أرضي + دورين");

    const before = m.writes;
    const r2 = await runSync(m.store, { ...quiet, fetchJson: src, fetchBuiltPoints: osm, now: new Date("2026-10-07T10:15:00Z") });
    expect(r2.mode).toBe("stats");
    expect(m.writes - before).toBe(1);
  });

  it("a new booking rewrites only the affected chunk", async () => {
    const m = memStore();
    await runSync(m.store, { ...quiet, fetchJson: fakeSource(60, new Set([1])), fetchBuiltPoints: osm, now: new Date("2026-10-07T10:00:00Z") });
    const r = await runSync(m.store, { ...quiet, fetchJson: fakeSource(60, new Set([1, 7])), fetchBuiltPoints: osm, now: new Date("2026-10-07T10:15:00Z") });
    expect(r.mode).toBe("full");
    expect(r.newlyBooked).toBe(1);
    expect(r.changedChunks).toHaveLength(1);
    expect(r.osmRefreshed).toBe(false);
  });

  it("a failed page writes no plot data and keeps the last good snapshot", async () => {
    const m = memStore();
    await runSync(m.store, { ...quiet, fetchJson: fakeSource(60, new Set([1])), fetchBuiltPoints: osm, now: new Date("2026-10-07T10:00:00Z") });
    const good = structuredClone(m.meta!);
    const r = await runSync(m.store, {
      ...quiet,
      fetchJson: fakeSource(2500, new Set([1, 2, 3]), { failPage: true }),
      fetchBuiltPoints: osm,
      now: new Date("2026-10-07T10:15:00Z"),
    });
    expect(r.error).toMatch(/503/);
    expect(m.meta!.chunks).toEqual(good.chunks);
    expect(m.meta!.fullSyncAt).toBe(good.fullSyncAt);
    expect(m.meta!.lastError).toMatch(/503/);
  });

  it("an OpenStreetMap failure keeps previous distances", async () => {
    const m = memStore();
    await runSync(m.store, { ...quiet, fetchJson: fakeSource(30, new Set()), fetchBuiltPoints: osm, now: new Date("2026-10-07T10:00:00Z") });
    const before = (await loadTuples(m.store, m.meta!)).map((x) => x[17]);
    await runSync(m.store, {
      ...quiet,
      forceFull: true,
      forceOsm: true,
      fetchJson: fakeSource(30, new Set()),
      fetchBuiltPoints: async () => {
        throw new Error("overpass down");
      },
      now: new Date("2026-10-07T11:00:00Z"),
    });
    const after = (await loadTuples(m.store, m.meta!)).map((x) => x[17]);
    expect(after).toEqual(before);
  });

  it("refreshes OpenStreetMap a few cities per run, oldest first", async () => {
    const m = memStore();
    const calls: number[] = [];
    const countingOsm = async (c: [number, number][]) => {
      calls.push(c.length);
      return [[30.0002, 31.0002]] as [number, number][];
    };
    const src = fakeSource(60, new Set());
    await runSync(m.store, { ...quiet, fetchJson: src, fetchBuiltPoints: countingOsm, osmCitiesPerRun: 1, now: new Date("2026-10-07T10:00:00Z") });
    expect(calls).toHaveLength(1);
    expect(Object.keys(m.meta!.osmCities!)).toHaveLength(1);
    await runSync(m.store, { ...quiet, fetchJson: src, fetchBuiltPoints: countingOsm, osmCitiesPerRun: 1, now: new Date("2026-10-07T10:15:00Z") });
    expect(calls).toHaveLength(2);
    expect(Object.keys(m.meta!.osmCities!)).toHaveLength(2);
    // Everything fresh → a quiet stats-only run, no OSM calls.
    const r = await runSync(m.store, { ...quiet, fetchJson: src, fetchBuiltPoints: countingOsm, osmCitiesPerRun: 1, now: new Date("2026-10-07T10:30:00Z") });
    expect(r.mode).toBe("stats");
    expect(calls).toHaveLength(2);
  });
});
