import { and, eq, getTableColumns, notInArray, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import {
  allocations,
  cities,
  ingestRuns,
  landStatusHistory,
  lands,
  marketSnapshots,
  projects,
} from "@/db/schema";
import { config } from "@/lib/config";
import { fetchJson } from "./fetcher";
import { diffSnapshot, type ExistingItem, type LandStatus } from "./diff";
import {
  allocationSchema,
  allocationStatSchema,
  citySchema,
  enhancedStatsSchema,
  pagedSchema,
  parseSourceDate,
  sectorSchema,
  statsSchema,
  validatePlots,
} from "./normalize";
import { z } from "zod";

const log = (...a: unknown[]) => console.log(`[ingest ${new Date().toISOString()}]`, ...a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function recordRun<T>(
  db: DB,
  kind: string,
  fn: () => Promise<{ result: T; pages?: number; items?: number; changes?: number }>,
): Promise<T> {
  const [run] = await db.insert(ingestRuns).values({ kind }).returning({ id: ingestRuns.id });
  try {
    const { result, pages, items, changes } = await fn();
    await db
      .update(ingestRuns)
      .set({ ok: true, finishedAt: new Date(), pages, items, changes })
      .where(eq(ingestRuns.id, run.id));
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`${kind} failed:`, msg);
    await db
      .update(ingestRuns)
      .set({ ok: false, finishedAt: new Date(), error: msg.slice(0, 2000) })
      .where(eq(ingestRuns.id, run.id));
    throw e;
  }
}

export interface MarketStats {
  total: number;
  booked: number;
  available: number;
  allocatedCodes: number | null;
  sourceLastUpdate: Date | null;
}

/** Cheap poll: two tiny JSON endpoints. */
export function syncStats(db: DB): Promise<MarketStats> {
  return recordRun(db, "stats", async () => {
    const [rawStats, rawEnh] = await Promise.all([
      fetchJson("/api/app/dashboard/dashboard-statistics"),
      fetchJson("/api/app/dashboard/enhanced-dashboard-statistics").catch(() => null),
    ]);
    const s = statsSchema.parse(rawStats);
    const enh = rawEnh ? enhancedStatsSchema.safeParse(rawEnh) : null;
    const stats: MarketStats = {
      total: s.totalPlots,
      booked: s.bookedPlots,
      available: s.availablePlots,
      allocatedCodes: enh?.success ? (enh.data.allocatedBookings ?? null) : null,
      sourceLastUpdate: parseSourceDate(s.lastUpdate),
    };
    await db.insert(marketSnapshots).values({
      ...stats,
      raw: { stats: rawStats, enhanced: rawEnh },
    });
    return { result: stats };
  });
}

async function fetchAllPaged(path: string, pageSize = 1000, extraQuery = "") {
  const items: unknown[] = [];
  let total = Infinity;
  for (let skip = 0; skip < total; skip += pageSize) {
    const sep = path.includes("?") ? "&" : "?";
    const page = pagedSchema.parse(
      await fetchJson(`${path}${sep}SkipCount=${skip}&MaxResultCount=${pageSize}${extraQuery}`),
    );
    total = page.totalCount;
    items.push(...page.items);
    if (page.items.length === 0) break;
    if (skip + pageSize < total) await sleep(config.pageDelayMs);
  }
  return { items, total: total === Infinity ? 0 : total };
}

/** Cities, sectors (projects) and daily booking-code allocations. */
export function syncReference(db: DB): Promise<void> {
  return recordRun(db, "reference", async () => {
    const now = new Date();
    const c = await fetchAllPaged("/api/app/city");
    const cityRows = c.items.flatMap((i) => {
      const r = citySchema.safeParse(i);
      return r.success ? [{ id: r.data.id, name: r.data.name.trim(), code: r.data.code ?? null, source: config.sourceName, updatedAt: now }] : [];
    });
    if (cityRows.length)
      await db.insert(cities).values(cityRows).onConflictDoUpdate({
        target: cities.id,
        set: { name: sql`excluded.name`, code: sql`excluded.code`, updatedAt: now },
      });

    const s = await fetchAllPaged("/api/app/sector");
    const sectorRows = s.items.flatMap((i) => {
      const r = sectorSchema.safeParse(i);
      return r.success
        ? [{
            id: r.data.id,
            cityId: r.data.cityId ?? null,
            name: r.data.name.trim(),
            code: r.data.code ?? null,
            isHot: !!r.data.isHot,
            isFullyBooked: !!r.data.isFullyBooked,
            source: config.sourceName,
            updatedAt: now,
          }]
        : [];
    });
    for (let i = 0; i < sectorRows.length; i += 500)
      await db.insert(projects).values(sectorRows.slice(i, i + 500)).onConflictDoUpdate({
        target: projects.id,
        set: {
          cityId: sql`excluded.city_id`,
          name: sql`excluded.name`,
          isHot: sql`excluded.is_hot`,
          isFullyBooked: sql`excluded.is_fully_booked`,
          updatedAt: now,
        },
      });

    const a = await fetchAllPaged("/api/app/booking-allocation");
    const statsRaw = await fetchJson("/api/app/dashboard/allocation-statistics").catch(() => []);
    const booked = new Map<string, number>();
    for (const r of z.array(z.unknown()).catch([]).parse(statsRaw)) {
      const p = allocationStatSchema.safeParse(r);
      if (p.success) booked.set(p.data.allocationId, p.data.plotsBooked);
    }
    const allocRows = a.items.flatMap((i) => {
      const r = allocationSchema.safeParse(i);
      const d = r.success ? parseSourceDate(r.data.issueDate) : null;
      return r.success && d
        ? [{ id: r.data.id, issueDate: d, totalCodes: r.data.totalCodes, plotsBooked: booked.get(r.data.id) ?? null, updatedAt: now }]
        : [];
    });
    if (allocRows.length)
      await db.insert(allocations).values(allocRows).onConflictDoUpdate({
        target: allocations.id,
        set: {
          totalCodes: sql`excluded.total_codes`,
          // keep the last known booked count if the stats endpoint no longer lists this batch
          plotsBooked: sql`coalesce(excluded.plots_booked, ${allocations.plotsBooked})`,
          updatedAt: now,
        },
      });
    return { result: undefined, items: cityRows.length + sectorRows.length + allocRows.length };
  });
}

export interface FullSyncResult {
  accepted: boolean;
  reason?: string;
  total: number;
  newlyBooked: string[];
  newlyAvailable: string[];
  inserted: number;
}

const landCols = getTableColumns(lands);
const UPDATABLE = Object.keys(landCols).filter(
  (k) => !["id", "firstSeenAt"].includes(k),
) as (keyof typeof landCols)[];
const upsertSet = Object.fromEntries(
  UPDATABLE.map((k) => [k, sql.raw(`excluded."${landCols[k].name}"`)]),
);

/** Fetch every plot, diff against the DB, and persist changes + status history. */
export function fullSync(db: DB): Promise<FullSyncResult> {
  return recordRun(db, "full", async () => {
    let allPagesOk = true;
    let fetched: Awaited<ReturnType<typeof fetchAllPaged>> = { items: [], total: 0 };
    try {
      fetched = await fetchAllPaged("/api/app/land-plot", config.pageSize, "&Sorting=id");
    } catch (e) {
      allPagesOk = false;
      throw e;
    }
    const pages = Math.ceil(fetched.total / config.pageSize);
    const { plots, rejected, errors } = validatePlots(fetched.items);
    if (rejected) log(`rejected ${rejected} invalid plot(s)`, errors);

    const existingRows = await db
      .select({ id: lands.id, status: lands.status, sourceUpdatedAt: lands.sourceUpdatedAt, totalPrice: lands.totalPrice })
      .from(lands);
    const existing = new Map<string, ExistingItem>(
      existingRows.map((r) => [r.id, { ...r, status: r.status as LandStatus }]),
    );
    const d = diffSnapshot(
      existing,
      plots.map((p) => ({ id: p.id, status: p.status as LandStatus, sourceUpdatedAt: p.sourceUpdatedAt, totalPrice: p.totalPrice })),
      { expectedTotal: fetched.total - rejected, allPagesOk },
    );
    if (!d.accepted) throw new Error(`snapshot rejected: ${d.reason}`);

    const now = new Date();
    const toWrite = new Set([...d.inserted, ...d.updated]);
    const rows = plots
      .filter((p) => toWrite.has(p.id))
      .map((p) => ({ ...p, lastSeenAt: now, updatedAt: now }));
    await db.transaction(async (tx) => {
      for (let i = 0; i < rows.length; i += 500) {
        await tx.insert(lands).values(rows.slice(i, i + 500)).onConflictDoUpdate({ target: lands.id, set: upsertSet });
      }
      // Status history: skip the initial load (inserted while table was empty) to avoid 15k "new" rows.
      const isInitial = existing.size === 0;
      const plotById = new Map(plots.map((p) => [p.id, p]));
      const hist = d.changes
        .filter((c) => !(isInitial && c.oldStatus === null))
        .map((c) => {
          const p = plotById.get(c.landId);
          return { landId: c.landId, oldStatus: c.oldStatus, newStatus: c.newStatus, detectedAt: now, sourceBookingDate: p?.bookingDate ?? null };
        });
      for (let i = 0; i < hist.length; i += 500) await tx.insert(landStatusHistory).values(hist.slice(i, i + 500));
      if (d.missing.length) {
        await tx.update(lands).set({ lastSeenAt: now }).where(notInArray(lands.id, d.missing));
      } else {
        await tx.update(lands).set({ lastSeenAt: now });
      }
    });
    if (d.newlyBooked.length || d.newlyAvailable.length || d.inserted.length)
      log(`full sync: +${d.inserted.length} new, ${d.newlyBooked.length} newly booked, ${d.newlyAvailable.length} re-available, ${d.missing.length} missing`);
    return {
      result: {
        accepted: true,
        total: plots.length,
        newlyBooked: d.newlyBooked,
        newlyAvailable: d.newlyAvailable,
        inserted: d.inserted.length,
      },
      pages,
      items: plots.length,
      changes: d.changes.length,
    };
  });
}

/** On first run there is no history; seed it from source bookingDate so analytics have a timeline. */
export async function backfillHistoryFromBookingDates(db: DB) {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(landStatusHistory);
  if (n > 0) return;
  const booked = await db
    .select({ id: lands.id, bookingDate: lands.bookingDate })
    .from(lands)
    .where(and(eq(lands.status, "booked"), sql`${lands.bookingDate} is not null`));
  const rows = booked.map((b) => ({
    landId: b.id,
    oldStatus: "available",
    newStatus: "booked",
    detectedAt: b.bookingDate!,
    sourceBookingDate: b.bookingDate,
  }));
  for (let i = 0; i < rows.length; i += 500) await db.insert(landStatusHistory).values(rows.slice(i, i + 500));
  if (rows.length) log(`backfilled ${rows.length} booking events from source bookingDate`);
}

