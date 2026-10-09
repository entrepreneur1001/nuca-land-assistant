import { describe, expect, it } from "vitest";
import { estimateQueue } from "@/engine/queue";
import { computeSurvival, plotSurvival, simulateSectorDepletion } from "@/engine/depletion";

const NOW = new Date("2026-10-07T12:00:00Z");
const day = (d: string) => new Date(`${d}T00:00:00Z`);

describe("queue / reachability", () => {
  it("user example: rank 17000, booked 2200, available 3500 → LOW, no inventory left at turn", () => {
    const q = estimateQueue({ rank: 17000, booked: 2200, available: 3500, now: NOW });
    // No allocation data: codes issued ≈ booked / 70% default conversion.
    expect(q.codesIssuedSource).toBe("estimated-from-booked");
    expect(q.codesIssued).toBe(Math.round(2200 / 0.7));
    expect(q.peopleAhead).toBe(17000 - q.codesIssued);
    // Called-but-unbooked holders (codes − booked) may still book: 10% expected.
    expect(q.unbookedCodes).toBe(q.codesIssued - 2200);
    expect(q.bookingsAhead.mid).toBeCloseTo(q.peopleAhead * 0.7 + q.unbookedCodes * 0.1, 5);
    // ~9,700 bookings ahead vs 3,500 available → nothing left in any scenario.
    expect(q.remainingAtTurn).toEqual({ low: 0, mid: 0, high: 0 });
    expect(q.aggregateLevel).toBe("LOW");
    expect(q.assumptions.length).toBeGreaterThan(0);
  });

  it("does NOT use the naive rank − booked formula when allocation data exists", () => {
    const allocations = [
      ...["09-20", "09-21", "09-22", "09-23", "09-24", "09-27", "09-28", "09-29", "09-30"].map((d) => ({
        issueDate: day(`2026-${d}`),
        totalCodes: 200,
        plotsBooked: 140,
      })),
      ...["10-01", "10-04", "10-05", "10-06"].map((d) => ({ issueDate: day(`2026-${d}`), totalCodes: 300, plotsBooked: 210 })),
      { issueDate: day("2026-10-07"), totalCodes: 300, plotsBooked: 2 }, // today, in progress
    ];
    const q = estimateQueue({ rank: 17000, booked: 2138, available: 13409, allocations, now: NOW });
    expect(q.codesIssued).toBe(3300);
    expect(q.peopleAhead).toBe(13700); // not 17000 − 2138
    expect(q.conversion.mid).toBeCloseTo(0.7, 5); // today's partial batch is excluded
    // Today's batch still books (300 × 70% − 2 already = 208), and 10% of the 864 earlier non-bookers may book late.
    expect(q.unbookedCodes).toBe(3300 - 300 - (2138 - 2));
    expect(q.pendingBookings.mid).toBeCloseTo(208 + 86.4, 5);
    expect(q.bookingsAhead.mid).toBeCloseTo(9590 + 294.4, 0);
    expect(q.remainingAtTurn.mid).toBeCloseTo(13409 - 9884.4, 0);
    expect(q.daysToTurn.low).toBeLessThanOrEqual(q.daysToTurn.mid);
    expect(q.daysToTurn.mid).toBeLessThanOrEqual(q.daysToTurn.high);
    expect(q.eta.expected!.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it("someone already called has nobody ahead and full availability", () => {
    const q = estimateQueue({ rank: 100, booked: 2000, available: 5000, allocatedCodes: 3300, now: NOW });
    expect(q.peopleAhead).toBe(0);
    expect(q.daysToTurn.mid).toBe(0);
    // Only the late share of the 1,300 called-but-unbooked holders competes.
    expect(q.remainingAtTurn.mid).toBeCloseTo(5000 - 130, 5);
    expect(q.aggregateLevel).toBe("HIGH");
  });
});

describe("batch schedule (one batch per working day, Fri/Sat off)", () => {
  // Wed 7 Oct 2026, 15:00 Cairo; today's 300-code batch is already out.
  const allocations = [
    { issueDate: new Date("2026-10-05T21:00:00Z"), totalCodes: 300, plotsBooked: 200 }, // Tue 6 Oct Cairo
    { issueDate: new Date("2026-10-06T21:00:00Z"), totalCodes: 300, plotsBooked: 50 }, // Wed 7 Oct Cairo (today)
  ];
  const turnDay = (rank: number) => {
    const q = estimateQueue({ rank, booked: 250, available: 10000, allocations, now: NOW });
    return { q, day: new Date(q.eta.expected!).toISOString().slice(0, 10) };
  };

  it("the next batch is tomorrow (Thursday)", () => {
    expect(turnDay(600 + 300).day).toBe("2026-10-08");
  });

  it("skips Friday and Saturday", () => {
    expect(turnDay(600 + 301).day).toBe("2026-10-11"); // second batch → Sunday
    const { q } = turnDay(600 + 300 * 7);
    for (const d of [q.eta.best, q.eta.expected, q.eta.worst]) expect([5, 6]).not.toContain(new Date(d!).getUTCDay());
  });

  it("uses the latest batch size; only the best case grows", () => {
    const { q } = turnDay(5000);
    expect(q.codesPerBatch).toEqual({ low: 300, mid: 300, high: 400 });
    expect(q.batchesPerWeek).toBe(5);
    expect(q.daysToTurn.low).toBeLessThanOrEqual(q.daysToTurn.mid);
  });
});

describe("depletion model", () => {
  it("plot survival: no bookings → 1, bookings ≥ plots → 0, and expected picks match", () => {
    expect(plotSurvival([1, 1, 1], 0)).toEqual([1, 1, 1]);
    expect(plotSurvival([1, 1, 1], 3)).toEqual([0, 0, 0]);
    const w = [3, 1, 1, 1, 1];
    const s = plotSurvival(w, 2);
    expect(s.reduce((a, x) => a + (1 - x), 0)).toBeCloseTo(2, 4);
    expect(s[0]).toBeLessThan(s[1]); // more desirable plots disappear first
  });

  it("demand spills over from sectors that sell out", () => {
    const avail = new Map([
      ["hot", 100],
      ["cold", 1000],
    ]);
    const recent = new Map([
      ["hot", 90],
      ["cold", 10],
    ]);
    const r = simulateSectorDepletion(avail, recent, { low: 300, mid: 300, high: 300 });
    expect(r.mid.get("hot")).toBeCloseTo(100, 3); // fully booked
    expect(r.mid.get("cold")).toBeCloseTo(200, 3); // got the spillover
  });

  it("garden+corner plots have lower survival than plain plots in the same sector", () => {
    const base = { projectId: "s1", cityName: "c", status: "available", seaPct: 0 };
    const plots = [
      { ...base, id: "gc", gardenPct: 5, cornerPct: 10 },
      ...Array.from({ length: 20 }, (_, i) => ({ ...base, id: `p${i}`, gardenPct: 0, cornerPct: 0 })),
    ];
    const { survival } = computeSurvival(plots, new Map([["s1", 10]]), { low: 5, mid: 10, high: 15 }, {
      plain: 1, corner: 1.5, garden: 2, gardenCorner: 3, sea: 3,
    });
    expect(survival.get("gc")!.mid).toBeLessThan(survival.get("p0")!.mid);
    const s = survival.get("p0")!;
    expect(s.low).toBeLessThanOrEqual(s.mid);
    expect(s.mid).toBeLessThanOrEqual(s.high);
  });
});
