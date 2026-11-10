/**
 * Status model for the official site: turns crawled zone tables into plot records, keeping everything the
 * official site does not publish (ids, coordinates, OSM distances, booking history) from the previous snapshot.
 * Pure functions; the orchestration lives in run.ts.
 */
import type { MetaDoc, OfficialNewsItem, PlotTuple } from "@/data/snapshot";
import { round } from "@/data/snapshot";
import { OFFICIAL_SITE } from "./official";
import { normalizeName, officialPlotId, type OfficialIndex } from "./official-map";
import type { ZoneCrawl, ZoneRow } from "./nuca-plots";

/** 0 free, 1 booked, 2 available with a preliminary booking request on it. */
export type PlotState = 0 | 1 | 2;

export interface PlotRecord {
  id: string;
  ext: string | null;
  plotNo: string;
  cityName: string;
  sectorId: string | null;
  sectorName: string | null;
  zoneName: string | null;
  area: number;
  ppm: number;
  total: number;
  dp: number;
  corner: number;
  garden: number;
  sea: number;
  lat: number | null;
  lng: number | null;
  state: PlotState;
  /** First time the plot was seen booked (ms); 0 when not booked. */
  bookingTs: number;
  builtKm: number | null;
  builtSrc: 0 | 1 | 2;
  /** undefined = never computed (older chunks). */
  roadM: number | null | undefined;
  /** Official square (normalised) this record is bound to; null until a tie between squares had to be broken. */
  sq: string | null;
}

export function tupleToRecord(t: PlotTuple, meta: Pick<MetaDoc, "cities" | "sectors" | "zones">): PlotRecord {
  const sector = t[4] >= 0 ? meta.sectors[t[4]] : undefined;
  return {
    id: t[0],
    ext: t[1],
    plotNo: t[2],
    cityName: meta.cities[t[3]] ?? "",
    sectorId: sector?.id ?? null,
    sectorName: sector?.name ?? null,
    zoneName: t[5] >= 0 ? (meta.zones[t[5]] ?? null) : null,
    area: t[6],
    ppm: t[7],
    total: t[8],
    dp: t[9],
    corner: t[10],
    garden: t[11],
    sea: t[12],
    lat: t[13],
    lng: t[14],
    state: t[15],
    bookingTs: t[16],
    builtKm: t[17],
    builtSrc: t[18],
    roadM: t[19],
    sq: t[20] ?? null,
  };
}

export function recordToTuple(r: PlotRecord, city: number, sector: number, zone: number): PlotTuple {
  return [
    r.id,
    r.ext,
    r.plotNo,
    city,
    sector,
    zone,
    round(r.area, 1)!,
    round(r.ppm, 2)!,
    round(r.total, 2)!,
    round(r.dp, 2)!,
    r.corner,
    r.garden,
    r.sea,
    round(r.lat, 6),
    round(r.lng, 6),
    r.state,
    r.bookingTs,
    round(r.builtKm, 3),
    r.builtSrc,
    r.roadM ?? null,
    r.sq ?? null,
  ];
}

export interface ZoneInfo {
  zid: number;
  cityId: number;
  /** City name as stored in meta.cities. */
  city: string;
}

export interface DeriveInput {
  prev: PlotRecord[];
  crawls: Map<number, ZoneCrawl[]>;
  index: OfficialIndex;
  zones: ZoneInfo[];
  /** Known sector names (previous meta.sectors), for new plots mapped to an existing sector. */
  sectorNames?: Map<string, string>;
  now: Date;
}

export interface ZoneStats {
  seen: number;
  free: number;
  held: number;
  booked: number;
}

export interface DeriveResult {
  records: PlotRecord[];
  inserted: string[];
  newlyBooked: string[];
  newlyAvailable: string[];
  /** Previous plots whose (city, zone) has no official counterpart; their status is frozen. */
  unmapped: number;
  /** Official squares not in the mapping table (plots got new ids). */
  newSquares: { zid: number; square: string; n: number }[];
  perZone: Map<number, ZoneStats>;
}

const key = (city: string, zone: string | null, plotNo: string) => `${city}|${zone ?? ""}|${plotNo}`;
const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.5, Math.abs(b) * 0.005);

/**
 * Apply crawled zone tables to the previous records. For a zone whose available view crawled OK, a known plot
 * missing from that view is booked (first observation = now); rows present take their state from the label.
 * A booked view marks its rows booked. Zones that failed or were not reached keep every previous value.
 */
export function deriveStatuses(input: DeriveInput): DeriveResult {
  const now = input.now.getTime();
  const records = new Map(input.prev.map((r) => [r.id, { ...r }]));
  const byKey = new Map<string, PlotRecord[]>();
  const byZid = new Map<number, PlotRecord[]>();
  let unmapped = 0;
  for (const r of records.values()) {
    const k = key(r.cityName, r.zoneName, r.plotNo);
    byKey.set(k, [...(byKey.get(k) ?? []), r]);
    const zid = input.index.zidOf(r.cityName, r.zoneName);
    if (zid == null) unmapped++;
    else byZid.set(zid, [...(byZid.get(zid) ?? []), r]);
  }
  const zoneInfo = new Map(input.zones.map((z) => [z.zid, z]));
  const result: DeriveResult = { records: [], inserted: [], newlyBooked: [], newlyAvailable: [], unmapped, newSquares: [], perZone: new Map() };
  const newSquares = new Map<string, { zid: number; square: string; n: number }>();

  /**
   * The existing record for an official row, by (city, mapped zone, plot number). When several squares of one
   * zone repeat a number, a record already bound to the row's square wins; otherwise the tie is broken by
   * area/price and, among exact twins, by binding each row to the lowest-id record not yet used in this pass
   * (rows arrive square by square), and the binding is kept in `sq` so it never flips between runs.
   */
  const usedInPass = new Set<string>();
  const resolve = (zid: number, row: ZoneRow): { rec: PlotRecord | null; city: string; zone: string; sector: string | null; mapped: boolean } => {
    const z = zoneInfo.get(zid);
    const sq = input.index.squareOf(zid, row.square);
    const city = z?.city ?? input.index.cityOf(z?.cityId ?? -1) ?? "";
    const zone = sq?.zone ?? row.square;
    const square = normalizeName(row.square);
    const cands = byKey.get(key(city, zone, row.plotNo)) ?? [];
    let rec: PlotRecord | null = null;
    if (cands.length === 1) rec = cands[0];
    else if (cands.length > 1) {
      const bound = cands.filter((c) => c.sq === square);
      if (bound.length === 1) rec = bound[0];
      else {
        const tied = cands
          .filter((c) => (c.sq == null || c.sq === square) && !usedInPass.has(c.id) && close(c.area, row.area) && close(c.total, row.total))
          .sort((a, b) => a.id.localeCompare(b.id));
        rec = tied[0] ?? null;
      }
    }
    if (rec) {
      usedInPass.add(rec.id);
      if (rec.sq == null) rec.sq = square;
    }
    return { rec, city, zone, sector: sq?.sector ?? null, mapped: !!sq };
  };

  const applyRow = (zid: number, row: ZoneRow, state: PlotState) => {
    const { rec, city, zone, sector, mapped } = resolve(zid, row);
    if (!mapped) {
      const k = `${zid}|${row.square}`;
      const e = newSquares.get(k) ?? { zid, square: row.square, n: 0 };
      e.n++;
      newSquares.set(k, e);
    }
    const fields = { area: row.area, ppm: row.ppm, total: row.total, dp: row.dp, corner: row.corner, garden: row.garden, sea: row.sea };
    if (rec) {
      const was = rec.state;
      Object.assign(rec, fields, { state });
      if (state === 1 && was !== 1) {
        rec.bookingTs = now;
        result.newlyBooked.push(rec.id);
      } else if (state !== 1 && was === 1) {
        rec.bookingTs = 0;
        result.newlyAvailable.push(rec.id);
      } else if (state === 1 && !rec.bookingTs) rec.bookingTs = now;
      return rec;
    }
    const id = officialPlotId(zid, row.square, row.plotNo);
    const existing = records.get(id);
    if (existing) {
      const was = existing.state;
      Object.assign(existing, fields, { state });
      if (state === 1 && was !== 1) {
        existing.bookingTs = now;
        result.newlyBooked.push(id);
      } else if (state !== 1 && was === 1) {
        existing.bookingTs = 0;
        result.newlyAvailable.push(id);
      }
      return existing;
    }
    const fresh: PlotRecord = {
      id,
      ext: null,
      plotNo: row.plotNo,
      cityName: city,
      sectorId: sector,
      sectorName: sector ? (input.sectorNames?.get(sector) ?? null) : null,
      zoneName: zone,
      ...fields,
      lat: null,
      lng: null,
      state,
      bookingTs: state === 1 ? now : 0,
      builtKm: null,
      builtSrc: 2,
      roadM: null,
      sq: normalizeName(row.square),
    };
    records.set(id, fresh);
    byKey.set(key(city, zone, row.plotNo), [...(byKey.get(key(city, zone, row.plotNo)) ?? []), fresh]);
    byZid.set(zid, [...(byZid.get(zid) ?? []), fresh]);
    result.inserted.push(id);
    return fresh;
  };

  for (const [zid, crawls] of input.crawls) {
    const avail = crawls.find((c) => c.view === "available" && c.ok);
    const booked = crawls.find((c) => c.view === "booked" && c.ok);
    if (!avail && !booked) continue;
    const stats: ZoneStats = { seen: 0, free: 0, held: 0, booked: 0 };
    const seen = new Set<string>();
    if (avail) {
      const known = [...(byZid.get(zid) ?? [])];
      for (const row of avail.rows) {
        const rec = applyRow(zid, row, row.status === "held" ? 2 : row.status === "booked" ? 1 : 0);
        seen.add(rec.id);
      }
      for (const rec of known) {
        if (seen.has(rec.id) || rec.state === 1) continue;
        rec.state = 1;
        rec.bookingTs = now;
        result.newlyBooked.push(rec.id);
      }
    }
    if (booked) {
      for (const row of booked.rows) {
        const rec = applyRow(zid, row, 1);
        seen.add(rec.id);
      }
    }
    for (const rec of byZid.get(zid) ?? []) {
      stats.seen++;
      if (rec.state === 0) stats.free++;
      else if (rec.state === 2) stats.held++;
      else stats.booked++;
    }
    result.perZone.set(zid, stats);
  }
  result.records = [...records.values()];
  result.newSquares = [...newSquares.values()];
  return result;
}

// ---- Cairo calendar helpers (Node side; the browser has its own in engine/queue.ts) ----

const TZ = "Africa/Cairo";
const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
/** "YYYY-MM-DD" of the Cairo calendar day containing `ms`. */
export const cairoDayKey = (ms: number) => dayFmt.format(new Date(ms));

function tzOffsetMs(utcMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - Math.floor(utcMs / 1000) * 1000;
}
/** The instant of `hour`:00 Cairo time on the Cairo day "YYYY-MM-DD", as ISO. */
export function cairoTimeIso(day: string, hour: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const naive = Date.UTC(y, m - 1, d, hour);
  let utc = naive - tzOffsetMs(naive);
  utc = naive - tzOffsetMs(utc);
  return new Date(utc).toISOString();
}

// ---- booking counts per day, synthesized batches, hot districts ----

export const BOOKINGS_BY_DAY_KEEP = 45;

/**
 * Newly booked plots per Cairo day, used once when no counter exists yet: the previous snapshot's per-batch
 * bookings where known (one batch per day), else the records' booking timestamps.
 */
export function seedBookingsByDay(records: PlotRecord[], now: Date, batches: MetaDoc["allocations"] = [], keepDays = BOOKINGS_BY_DAY_KEEP): Record<string, number> {
  const since = now.getTime() - keepDays * 86_400_000;
  const out: Record<string, number> = {};
  for (const r of records) {
    if (r.state !== 1 || !r.bookingTs || r.bookingTs < since) continue;
    const k = cairoDayKey(r.bookingTs);
    out[k] = (out[k] ?? 0) + 1;
  }
  for (const a of batches) {
    const t = Date.parse(a.d);
    if (a.b == null || Number.isNaN(t) || t < since) continue;
    out[cairoDayKey(t)] = a.b;
  }
  return out;
}

/** Adds `n` bookings observed at `now` and drops days older than `keepDays`. */
export function bumpBookingsByDay(prev: Record<string, number> | undefined, n: number, now: Date, keepDays = BOOKINGS_BY_DAY_KEEP): Record<string, number> {
  const out: Record<string, number> = {};
  const since = now.getTime() - keepDays * 86_400_000;
  for (const [k, v] of Object.entries(prev ?? {})) if (Date.parse(`${k}T12:00:00Z`) >= since) out[k] = v;
  if (n > 0) {
    const k = cairoDayKey(now.getTime());
    out[k] = (out[k] ?? 0) + n;
  }
  return out;
}

/**
 * Daily code batches from the official news: one per announced range, with the plots booked that Cairo day as
 * the batch's bookings. A range without an end is closed by the next item's "served through".
 */
export function synthesizeAllocations(items: OfficialNewsItem[], bookingsByDay: Record<string, number>, now: Date): MetaDoc["allocations"] {
  const sorted = items.filter((i) => i.next || i.servedThrough != null).sort((a, b) => a.day.localeCompare(b.day) || a.nid - b.nid);
  const today = cairoDayKey(now.getTime());
  const byDay = new Map<string, MetaDoc["allocations"][number]>();
  sorted.forEach((item, idx) => {
    const n = item.next;
    if (!n?.day || n.day > today) return;
    let to = n.to;
    if (to == null) {
      const later = sorted.slice(idx + 1).find((x) => x.servedThrough != null && x.servedThrough >= n.from);
      if (later) to = later.servedThrough!;
    }
    if (to == null || to < n.from) return;
    byDay.set(n.day, { id: `nid-${item.nid}`, d: cairoTimeIso(n.day, n.hour ?? 10), c: to - n.from + 1, b: bookingsByDay[n.day] ?? null });
  });
  return [...byDay.values()].sort((a, b) => a.d.localeCompare(b.d));
}

/** Sector ids whose bookings in the last 7 days reach max(hotMinBookings, hotShare × plots). */
export function hotSectors(records: PlotRecord[], now: Date, cfg = OFFICIAL_SITE): Set<string> {
  const since = now.getTime() - 7 * 86_400_000;
  const total = new Map<string, number>();
  const recent = new Map<string, number>();
  for (const r of records) {
    if (!r.sectorId) continue;
    total.set(r.sectorId, (total.get(r.sectorId) ?? 0) + 1);
    if (r.state === 1 && r.bookingTs >= since) recent.set(r.sectorId, (recent.get(r.sectorId) ?? 0) + 1);
  }
  const hot = new Set<string>();
  for (const [id, n] of recent) if (n >= Math.max(cfg.hotMinBookings, cfg.hotShare * (total.get(id) ?? 0))) hot.add(id);
  return hot;
}
