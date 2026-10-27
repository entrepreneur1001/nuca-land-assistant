import { describe, expect, it } from "vitest";
import { FRESHNESS, freshnessFor } from "@/engine/compute";
import { inSyncWindow } from "@/engine/queue";
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

describe("sync window (Cairo, Sun–Thu 10:00–22:00)", () => {
  // Summer time (UTC+3) in October before the 29th; winter time (UTC+2) in December.
  const tueSummerNoon = new Date("2026-10-20T11:00:00Z"); // Tue 14:00 Cairo
  const tueSummerNight = new Date("2026-10-19T23:00:00Z"); // Tue 02:00 Cairo
  const friSummerNoon = new Date("2026-10-23T11:00:00Z"); // Fri 14:00 Cairo
  const sunWinterOpen = new Date("2026-12-06T08:00:00Z"); // Sun 10:00 Cairo (UTC+2)
  const sunWinterClose = new Date("2026-12-06T20:00:00Z"); // Sun 22:00 Cairo
  const thuWinterLate = new Date("2026-12-03T19:59:00Z"); // Thu 21:59 Cairo

  it("is open on working days during the day, in both summer and winter time", () => {
    expect(inSyncWindow(tueSummerNoon)).toBe(true);
    expect(inSyncWindow(sunWinterOpen)).toBe(true);
    expect(inSyncWindow(thuWinterLate)).toBe(true);
  });
  it("is closed at night, on Friday/Saturday and from 22:00", () => {
    expect(inSyncWindow(tueSummerNight)).toBe(false);
    expect(inSyncWindow(friSummerNoon)).toBe(false);
    expect(inSyncWindow(sunWinterClose)).toBe(false);
  });
  it("allows a longer gap before showing stale outside the window", () => {
    expect(freshnessFor(tueSummerNoon).staleAfterMs).toBe(FRESHNESS.staleAfterMs);
    expect(freshnessFor(friSummerNoon).staleAfterMs).toBe(FRESHNESS.offHoursStaleAfterMs);
    expect(freshnessFor(tueSummerNight).staleAfterMs).toBe(FRESHNESS.offHoursStaleAfterMs);
    expect(FRESHNESS.offHoursStaleAfterMs).toBeGreaterThan(FRESHNESS.staleAfterMs);
  });
});
