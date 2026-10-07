export interface Freshness {
  lastStatsOkAt: string | null;
  lastFullOkAt: string | null;
  lastError: string | null;
  /** ms since the inventory (full sync) was last refreshed successfully */
  inventoryAgeMs: number | null;
  stale: boolean;
  staleReason: string | null;
}

/** Data is stale when the live stats poll or the inventory sync hasn't succeeded recently. */
export function computeFreshness(input: {
  now: number;
  lastStatsOkAt: Date | null;
  lastFullOkAt: Date | null;
  lastError?: string | null;
  staleAfterMs: number;
  maxFullSyncMs: number;
}): Freshness {
  const { now, lastStatsOkAt, lastFullOkAt, staleAfterMs, maxFullSyncMs } = input;
  let staleReason: string | null = null;
  if (!lastFullOkAt) staleReason = "Inventory has never been synced";
  else if (now - lastFullOkAt.getTime() > maxFullSyncMs + staleAfterMs) staleReason = "Inventory sync is overdue";
  else if (!lastStatsOkAt || now - lastStatsOkAt.getTime() > staleAfterMs) staleReason = "Live stats have not updated recently";
  return {
    lastStatsOkAt: lastStatsOkAt?.toISOString() ?? null,
    lastFullOkAt: lastFullOkAt?.toISOString() ?? null,
    lastError: input.lastError ?? null,
    inventoryAgeMs: lastFullOkAt ? now - lastFullOkAt.getTime() : null,
    stale: staleReason !== null,
    staleReason,
  };
}
