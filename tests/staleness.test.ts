import { describe, expect, it } from "vitest";
import { computeFreshness } from "@/lib/freshness";

const now = Date.parse("2026-10-07T12:00:00Z");
const ago = (min: number) => new Date(now - min * 60_000);
const base = { now, staleAfterMs: 10 * 60_000, maxFullSyncMs: 30 * 60_000 };

describe("stale data", () => {
  it("fresh when stats and inventory updated recently", () => {
    const f = computeFreshness({ ...base, lastStatsOkAt: ago(1), lastFullOkAt: ago(5) });
    expect(f.stale).toBe(false);
    expect(f.inventoryAgeMs).toBe(5 * 60_000);
  });
  it("stale when the live stats poll has not succeeded within the threshold", () => {
    const f = computeFreshness({ ...base, lastStatsOkAt: ago(11), lastFullOkAt: ago(5) });
    expect(f.stale).toBe(true);
    expect(f.staleReason).toMatch(/stats/i);
  });
  it("stale when the inventory sync is overdue", () => {
    const f = computeFreshness({ ...base, lastStatsOkAt: ago(1), lastFullOkAt: ago(41) });
    expect(f.stale).toBe(true);
  });
  it("stale when never synced", () => {
    expect(computeFreshness({ ...base, lastStatsOkAt: null, lastFullOkAt: null }).stale).toBe(true);
  });
});
