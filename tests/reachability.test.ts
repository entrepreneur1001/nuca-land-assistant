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
    expect(q.bookingsAhead.mid).toBeCloseTo(q.peopleAhead * 0.7, 5);
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
    expect(q.bookingsAhead.mid).toBeCloseTo(9590, 0);
    expect(q.remainingAtTurn.mid).toBeCloseTo(13409 - 9590, 0);
    expect(q.daysToTurn.low).toBeLessThanOrEqual(q.daysToTurn.mid);
    expect(q.daysToTurn.mid).toBeLessThanOrEqual(q.daysToTurn.high);
    expect(q.eta.expected!.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it("someone already called has nobody ahead and full availability", () => {
    const q = estimateQueue({ rank: 100, booked: 2000, available: 5000, allocatedCodes: 3300, now: NOW });
    expect(q.peopleAhead).toBe(0);
    expect(q.remainingAtTurn.mid).toBe(5000);
    expect(q.aggregateLevel).toBe("HIGH");
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
