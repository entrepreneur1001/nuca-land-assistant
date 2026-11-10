import { describe, expect, it } from "vitest";
import type { OfficialNewsItem, PlotTuple } from "@/data/snapshot";
import { buildOfficialIndex, officialPlotId, type OfficialZoneEntry } from "@/ingest/official-map";
import type { ZoneCrawl, ZoneRow } from "@/ingest/nuca-plots";
import {
  bumpBookingsByDay,
  cairoDayKey,
  cairoTimeIso,
  deriveStatuses,
  hotSectors,
  recordToTuple,
  seedBookingsByDay,
  synthesizeAllocations,
  tupleToRecord,
  type PlotRecord,
} from "@/ingest/status";

const NOW = new Date("2026-11-09T10:00:00Z"); // 12:00 Cairo
const CITY = "القاهرة الجديدة";
const ZONE = "الامتداد الجنوبى بالقرب من ديستركت 5";
const table: OfficialZoneEntry[] = [
  { zid: 4797, pid: 2284, cityId: 1, city: CITY, name: "المرحلة الحادية عشر - الامتداد الجنوبى", squares: { [ZONE.replace(/\s+/g, " ")]: { sector: "sec-a", zone: ZONE } } },
];
// normalizeName is applied by buildOfficialIndex's lookups; key the square map the same way the generator would.
import { normalizeName } from "@/ingest/official-map";
table[0].squares = { [normalizeName(ZONE)]: { sector: "sec-a", zone: ZONE } };
const index = buildOfficialIndex(table, { 1: CITY });
const zones = [{ zid: 4797, cityId: 1, city: CITY }];

const rec = (plotNo: string, state: 0 | 1 | 2 = 0, extra: Partial<PlotRecord> = {}): PlotRecord => ({
  id: `g-${plotNo}`,
  ext: null,
  plotNo,
  cityName: CITY,
  sectorId: "sec-a",
  sectorName: "حي",
  zoneName: ZONE,
  area: 500,
  ppm: 450,
  total: 225_000,
  dp: 56_250,
  corner: 0,
  garden: 0,
  sea: 0,
  lat: 30,
  lng: 31,
  state,
  bookingTs: state === 1 ? Date.parse("2026-11-01T08:00:00Z") : 0,
  builtKm: 1.2,
  builtSrc: 0,
  roadM: 40,
  sq: null,
  ...extra,
});
const row = (plotNo: string, status: ZoneRow["status"], extra: Partial<ZoneRow> = {}): ZoneRow => ({
  square: ZONE,
  plotNo,
  area: 500,
  basePpm: 450,
  corner: 0,
  garden: 0,
  sea: 0,
  ppm: 450,
  total: 225_000,
  dp: 56_250,
  status,
  ...extra,
});
const crawl = (view: "available" | "booked", rows: ZoneRow[], ok = true): ZoneCrawl => ({ zid: 4797, view, ok, rows, pages: 1, egpPerM: 23_455, ms: 1 });

describe("deriveStatuses", () => {
  it("marks a known plot booked when it disappears from the available view, and keeps ids/coordinates", () => {
    const prev = [rec("1"), rec("2"), rec("3", 2)];
    const r = deriveStatuses({ prev, crawls: new Map([[4797, [crawl("available", [row("1", "free"), row("3", "held")])]]]), index, zones, now: NOW });
    const by = new Map(r.records.map((x) => [x.id, x]));
    expect(by.get("g-2")).toMatchObject({ state: 1, bookingTs: NOW.getTime(), lat: 30, builtKm: 1.2 });
    expect(by.get("g-1")!.state).toBe(0);
    expect(by.get("g-3")!.state).toBe(2);
    expect(r.newlyBooked).toEqual(["g-2"]);
    expect(r.inserted).toEqual([]);
    expect(r.unmapped).toBe(0);
    expect(r.perZone.get(4797)).toEqual({ seen: 3, free: 1, held: 1, booked: 1 });
  });

  it("re-available plots lose their booking time; already booked plots keep theirs", () => {
    const prev = [rec("1", 1), rec("2", 1)];
    const r = deriveStatuses({ prev, crawls: new Map([[4797, [crawl("available", [row("1", "free")])]]]), index, zones, now: NOW });
    const by = new Map(r.records.map((x) => [x.id, x]));
    expect(by.get("g-1")).toMatchObject({ state: 0, bookingTs: 0 });
    expect(by.get("g-2")).toMatchObject({ state: 1, bookingTs: Date.parse("2026-11-01T08:00:00Z") });
    expect(r.newlyAvailable).toEqual(["g-1"]);
  });

  it("the booked view marks rows booked without rewriting an existing timestamp", () => {
    const prev = [rec("1", 1), rec("2")];
    const r = deriveStatuses({ prev, crawls: new Map([[4797, [crawl("booked", [row("1", "booked"), row("2", "booked")])]]]), index, zones, now: NOW });
    const by = new Map(r.records.map((x) => [x.id, x]));
    expect(by.get("g-1")!.bookingTs).toBe(Date.parse("2026-11-01T08:00:00Z"));
    expect(by.get("g-2")).toMatchObject({ state: 1, bookingTs: NOW.getTime() });
  });

  it("leaves a zone untouched when its crawl failed or was not reached", () => {
    const prev = [rec("1"), rec("2", 1)];
    const r = deriveStatuses({ prev, crawls: new Map([[4797, [crawl("available", [], false)]]]), index, zones, now: NOW });
    expect(r.records).toEqual(prev);
    expect(r.perZone.size).toBe(0);
    const r2 = deriveStatuses({ prev, crawls: new Map(), index, zones, now: NOW });
    expect(r2.records).toEqual(prev);
  });

  it("freezes plots whose zone has no official counterpart and counts them", () => {
    const prev = [rec("1", 0, { zoneName: "منطقة غير معروفة", id: "g-x" })];
    const r = deriveStatuses({ prev, crawls: new Map([[4797, [crawl("available", [])]]]), index, zones, now: NOW });
    expect(r.unmapped).toBe(1);
    expect(r.records[0].state).toBe(0);
  });

  it("gives unknown squares deterministic new ids with no coordinates, and reports them", () => {
    const r = deriveStatuses({ prev: [], crawls: new Map([[4797, [crawl("available", [row("7", "free", { square: "مربع جديد" })])]]]), index, zones, now: NOW });
    expect(r.inserted).toEqual([officialPlotId(4797, "مربع جديد", "7")]);
    expect(r.records[0]).toMatchObject({ cityName: CITY, zoneName: "مربع جديد", sectorId: null, lat: null, builtSrc: 2, state: 0 });
    expect(r.newSquares).toEqual([{ zid: 4797, square: "مربع جديد", n: 1 }]);
    // the same row next run maps to the same record
    const r2 = deriveStatuses({ prev: r.records, crawls: new Map([[4797, [crawl("available", [row("7", "held", { square: "مربع جديد" })])]]]), index, zones, now: NOW });
    expect(r2.inserted).toEqual([]);
    expect(r2.records[0].state).toBe(2);
  });

  it("breaks duplicate plot numbers within a zone by area and price", () => {
    const prev = [rec("35", 0, { id: "g-35a", area: 500, total: 225_000 }), rec("35", 0, { id: "g-35b", area: 620, total: 279_000 })];
    const r = deriveStatuses({ prev, crawls: new Map([[4797, [crawl("available", [row("35", "free", { area: 620, total: 279_000 })])]]]), index, zones, now: NOW });
    const by = new Map(r.records.map((x) => [x.id, x]));
    expect(by.get("g-35b")!.state).toBe(0);
    expect(by.get("g-35a")!.state).toBe(1);
    expect(r.inserted).toEqual([]);
  });

  it("binds twin plot numbers from two squares of one zone to fixed records, so neither is wrongly booked", () => {
    // Squares A and B of one official zone both map to ZONE and both list plot 42 with the same area and price.
    const two = buildOfficialIndex([{ ...table[0], squares: { "منطقه a": { sector: "sec-a", zone: ZONE }, "منطقه b": { sector: "sec-a", zone: ZONE } } }], { 1: CITY });
    const prev = [rec("42", 0, { id: "g-42x" }), rec("42", 0, { id: "g-42y" })];
    const rows = [row("42", "free", { square: "منطقة A" }), row("42", "free", { square: "منطقة B" })];
    const r = deriveStatuses({ prev, crawls: new Map([[4797, [crawl("available", rows)]]]), index: two, zones, now: NOW });
    const by = new Map(r.records.map((x) => [x.id, x]));
    expect(by.get("g-42x")!.state).toBe(0);
    expect(by.get("g-42y")!.state).toBe(0);
    expect(r.newlyBooked).toEqual([]);
    // lowest id ↔ first square; the binding persists and survives reversed record order and a flipped row order
    expect(by.get("g-42x")!.sq).toBe("منطقه a");
    expect(by.get("g-42y")!.sq).toBe("منطقه b");
    const again = deriveStatuses({ prev: [...r.records].reverse(), crawls: new Map([[4797, [crawl("available", [...rows].reverse().map((x, i) => ({ ...x, status: i === 0 ? "held" : "free" })))]]]), index: two, zones, now: NOW });
    const by2 = new Map(again.records.map((x) => [x.id, x]));
    expect(by2.get("g-42y")!.state).toBe(2); // B-42 held → the record bound to B
    expect(by2.get("g-42x")!.state).toBe(0);
  });

  it("official prices overwrite the stored ones", () => {
    const r = deriveStatuses({ prev: [rec("1")], crawls: new Map([[4797, [crawl("available", [row("1", "free", { total: 230_000, dp: 57_500, corner: 8 })])]]]), index, zones, now: NOW });
    expect(r.records[0]).toMatchObject({ total: 230_000, dp: 57_500, corner: 8 });
  });
});

describe("record ↔ tuple", () => {
  it("round-trips, including the held state and missing road distance", () => {
    const r = rec("9", 2, { roadM: undefined });
    const t: PlotTuple = recordToTuple(r, 0, 0, 0);
    expect(t[15]).toBe(2);
    expect(t[19]).toBeNull();
    const back = tupleToRecord(t, { cities: [CITY], sectors: [{ id: "sec-a", name: "حي", city: 0, hot: false }], zones: [ZONE] });
    expect(back).toMatchObject({ id: "g-9", state: 2, sectorId: "sec-a", zoneName: ZONE, roadM: null });
  });
});

describe("bookings per day and synthesized batches", () => {
  it("seeds from booking timestamps in Cairo days and bumps today", () => {
    const recs = [rec("1", 1, { bookingTs: Date.parse("2026-11-08T22:30:00Z") }), rec("2", 1, { bookingTs: Date.parse("2026-11-08T12:00:00Z") }), rec("3", 1, { bookingTs: Date.parse("2026-09-01T12:00:00Z") })];
    const seeded = seedBookingsByDay(recs, NOW);
    expect(seeded).toEqual({ "2026-11-09": 1, "2026-11-08": 1 }); // 22:30Z on 8 Nov is already 9 Nov in Cairo
    expect(bumpBookingsByDay(seeded, 3, NOW)).toEqual({ "2026-11-09": 4, "2026-11-08": 1 });
    // the old snapshot's per-batch bookings win over bulk-stamped timestamps
    expect(seedBookingsByDay(recs, NOW, [{ id: "x", d: "2026-11-07T22:00:00Z", c: 700, b: 336 }, { id: "y", d: "2026-11-02T22:00:00Z", c: 300, b: null }])).toEqual({ "2026-11-09": 1, "2026-11-08": 336 });
    expect(cairoDayKey(Date.parse("2026-11-08T22:30:00Z"))).toBe("2026-11-09");
    expect(cairoTimeIso("2026-11-09", 10)).toBe("2026-11-09T08:00:00.000Z");
  });

  it("turns announced ranges into batches with that day's bookings, closing open ranges with the next item", () => {
    const items: OfficialNewsItem[] = [
      { nid: 9108, day: "2026-11-02", title: "", servedThrough: 8100, next: { from: 8101, to: null, day: "2026-11-02", hour: 11 } },
      { nid: 9109, day: "2026-11-02", title: "", servedThrough: 8400, next: { from: 8401, to: null, day: "2026-11-03", hour: 11 } },
      { nid: 9110, day: "2026-11-03", title: "", servedThrough: 8700, next: { from: 8701, to: 9000, day: "2026-11-04", hour: 11 } },
      { nid: 9117, day: "2026-11-08", title: "", servedThrough: 10000, next: { from: 10001, to: 10700, day: "2026-11-09", hour: 10 } },
      { nid: 9999, day: "2026-11-09", title: "", next: { from: 10701, to: 11400, day: "2026-11-10", hour: 10 } },
      { nid: 9114, day: "2026-11-06", title: "unrelated" },
    ];
    const a = synthesizeAllocations(items, { "2026-11-02": 190, "2026-11-04": 205 }, NOW);
    expect(a.map((x) => [x.id, x.d.slice(0, 10), x.c, x.b])).toEqual([
      ["nid-9108", "2026-11-02", 300, 190],
      ["nid-9109", "2026-11-03", 300, null],
      ["nid-9110", "2026-11-04", 300, 205],
      ["nid-9117", "2026-11-09", 700, null],
    ]);
    expect(a[0].d).toBe("2026-11-02T09:00:00.000Z");
  });

  it("hot sectors need enough recent bookings", () => {
    const recs = [
      ...Array.from({ length: 12 }, (_, i) => rec(`a${i}`, 1, { sectorId: "A", bookingTs: NOW.getTime() - i * 3_600_000 })),
      ...Array.from({ length: 50 }, (_, i) => rec(`b${i}`, i < 3 ? 1 : 0, { sectorId: "B", bookingTs: i < 3 ? NOW.getTime() - 1000 : 0 })),
      ...Array.from({ length: 5 }, (_, i) => rec(`c${i}`, 1, { sectorId: "C", bookingTs: NOW.getTime() - 30 * 86_400_000 })),
    ];
    expect([...hotSectors(recs, NOW)]).toEqual(["A"]);
  });
});
