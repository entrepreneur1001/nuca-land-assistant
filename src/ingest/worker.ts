import { getDb } from "@/db/client";
import { config } from "@/lib/config";
import { backfillHistoryFromBookingDates, fullSync, syncReference, syncStats, type MarketStats } from "./sync";

export interface WorkerState {
  started: boolean;
  running: boolean;
  lastStats?: MarketStats;
  lastFullSyncAt?: number;
  lastFullSyncStats?: Pick<MarketStats, "booked" | "available">;
  lastReferenceAt?: number;
  lastError?: string;
  timers: ReturnType<typeof setInterval>[];
}

const g = globalThis as unknown as { __nucaWorker?: WorkerState };
export const workerState: WorkerState = (g.__nucaWorker ??= { started: false, running: false, timers: [] });

const log = (...a: unknown[]) => console.log(`[worker ${new Date().toISOString()}]`, ...a);

async function tick(force = false) {
  if (workerState.running) return;
  workerState.running = true;
  try {
    const db = await getDb();
    const now = Date.now();
    if (force || !workerState.lastReferenceAt || now - workerState.lastReferenceAt > config.referencePollMs) {
      await syncReference(db).catch((e) => (workerState.lastError = String(e)));
      workerState.lastReferenceAt = now;
    }
    const stats = await syncStats(db);
    workerState.lastStats = stats;
    const prev = workerState.lastFullSyncStats;
    const changed = !prev || prev.booked !== stats.booked || prev.available !== stats.available;
    const sinceFull = now - (workerState.lastFullSyncAt ?? 0);
    if (force || (changed && sinceFull >= config.minFullSyncMs) || sinceFull >= config.maxFullSyncMs) {
      const r = await fullSync(db);
      workerState.lastFullSyncAt = Date.now();
      workerState.lastFullSyncStats = { booked: stats.booked, available: stats.available };
      if (r.inserted > 1000) await backfillHistoryFromBookingDates(db);
    }
    workerState.lastError = undefined;
  } catch (e) {
    workerState.lastError = e instanceof Error ? e.message : String(e);
    log("tick failed:", workerState.lastError);
  } finally {
    workerState.running = false;
  }
}

/** Start background polling once per process. Safe to call repeatedly. */
export function startWorker() {
  if (workerState.started || !config.workerEnabled) return;
  workerState.started = true;
  log(`starting: stats every ${config.statsPollMs / 1000}s, full sync ${config.minFullSyncMs / 60000}-${config.maxFullSyncMs / 60000} min, source ${config.sourceApiUrl}`);
  void tick(true);
  workerState.timers.push(setInterval(() => void tick(), config.statsPollMs));
}

export async function runOnce() {
  await tick(true);
}
