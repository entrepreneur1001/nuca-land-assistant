import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { MODEL } from "@/engine/config";
import { cairoHourOf, estimateQueue, isoDay, nthBatchDay, officialQueue } from "@/engine/queue";
import { computeSurvival, plotSurvival, simulateSectorDepletion } from "@/engine/depletion";
import { parseNewsList } from "@/ingest/nuca-news";

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

describe("official NUCA news (lands.nuca.gov.eg news list)", () => {
  // The real list as of 8 Nov 2026: 300-code batches through Thu 5 Nov, then «9301–10000 on Sun 8 Nov at 10»
  // (NID 9116, Sat 7 Nov) and «through 10000; 10001–10700 on Mon 9 Nov at 10» (NID 9117, Sun 8 Nov).
  const all = parseNewsList(readFileSync(path.resolve(__dirname, "fixtures/official/newslist.html"), "utf8"));
  /** Items published up to and including `day` (what the sync would have had then). */
  const publishedBy = (day: string) => all.filter((i) => i.day <= day);
  // The tracker still reports 300-code batches, the last one on Thu 5 Nov 2026 (Cairo).
  const nov = ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"].map((d) => ({
    issueDate: new Date(`${d}T22:00:00Z`), // 2–5 Nov Cairo
    totalCodes: 300,
    plotsBooked: 200,
  }));
  const at = (iso: string, official = publishedBy("2026-11-07"), allocations = nov, rank = 5000, allocatedCodes: number | null = null) =>
    estimateQueue({ rank, booked: 800, available: 10000, allocations, allocatedCodes, official, now: new Date(iso) });
  const day = (d: Date | null) => new Date(d!).toISOString().slice(0, 10);

  it("Sat 7 Nov 20:00 Cairo: the official item sets codes issued (9300) and the batch size (700), not the synced 300s", () => {
    const q = at("2026-11-07T18:00:00Z");
    expect(q.codesIssuedSource).toBe("official");
    expect(q.codesIssued).toBe(9300);
    expect(q.codesPerBatch).toEqual({ low: 700, mid: 700, high: 933 });
    expect(q.official).toEqual({ nid: 9116, day: "2026-11-07", issuedThrough: 9300, batchSize: 700, next: { from: 9301, to: 10000, day: "2026-11-08" }, applied: true });
    expect(q.assumptions.find((a) => a.startsWith("A5:"))).toMatch(/NID 9116.*through 9300.*9301–10000 on 2026-11-08/);
    // Rank 10000 is in Sunday's announced batch; 10001 waits for Monday.
    expect(day(at("2026-11-07T18:00:00Z", undefined, nov, 10000).eta.expected)).toBe("2026-11-08");
    expect(day(at("2026-11-07T18:00:00Z", undefined, nov, 10001).eta.expected)).toBe("2026-11-09");
    // No batch is open on a Saturday evening: only late bookers from the 9300 − 800 earlier holders are pending.
    expect(q.unbookedCodes).toBe(9300 - 800);
    expect(q.pendingBookings.mid).toBeCloseTo(q.unbookedCodes * MODEL.lateBookingShare.mid, 5);
  });

  it("Sun 8 Nov 09:00 Cairo: the 10:00 batch is not out yet", () => {
    const q = at("2026-11-08T07:00:00Z");
    expect(q.codesIssued).toBe(9300);
    expect(day(at("2026-11-08T07:00:00Z", undefined, nov, 10000).eta.expected)).toBe("2026-11-08");
  });

  it("Sun 8 Nov 12:00 Cairo: the announced batch counts as issued, and it is today's open batch", () => {
    const q = at("2026-11-08T10:00:00Z");
    expect(q.codesIssued).toBe(10000);
    expect(q.codesIssuedSource).toBe("official");
    expect(q.official!.next).toBeNull();
    expect(day(at("2026-11-08T10:00:00Z", undefined, nov, 10001).eta.expected)).toBe("2026-11-09");
    expect(day(at("2026-11-08T10:00:00Z", undefined, nov, 10701).eta.expected)).toBe("2026-11-10");
    // The 700 codes issued today are still booking (the tracker has no batch for today yet).
    expect(q.pendingBookings.mid).toBeGreaterThanOrEqual(700 * q.conversion.mid);
  });

  it("Mon 9 Nov 12:00 Cairo with the tracker caught up: both agree on 10700", () => {
    const allocations = [...nov, { issueDate: new Date("2026-11-09T08:00:00Z"), totalCodes: 700, plotsBooked: 100 }];
    const q = at("2026-11-09T10:00:00Z", publishedBy("2026-11-08"), allocations, 12000, 10700);
    expect(q.codesIssued).toBe(10700);
    expect(q.codesIssuedSource).toBe("official");
    expect(q.official!.nid).toBe(9117);
    expect(q.codesPerBatch.mid).toBe(700);
    expect(day(q.eta.expected)).toBe("2026-11-11"); // 1300 ahead → Tue 10 Nov and Wed 11 Nov
  });

  it("a tracker batch newer than the latest item wins; the item is reported but not applied", () => {
    const allocations = [...nov, { issueDate: new Date("2026-11-08T08:00:00Z"), totalCodes: 700, plotsBooked: 400 }];
    const q = at("2026-11-09T10:00:00Z", publishedBy("2026-11-05"), allocations);
    expect(q.codesIssuedSource).toBe("allocations");
    expect(q.codesIssued).toBe(4 * 300 + 700);
    expect(q.official).toMatchObject({ nid: 9113, day: "2026-11-05", issuedThrough: 9300, applied: false });
    expect(q.assumptions.find((a) => a.startsWith("A5:"))).toMatch(/older than the latest synced batch/);
  });

  it("without official items the synced data (or the default 700) is used as before", () => {
    const synced = at("2026-11-08T10:00:00Z", [], nov);
    expect(synced.codesIssuedSource).toBe("allocations");
    expect(synced.codesIssued).toBe(1200);
    expect(synced.codesPerBatch).toEqual({ low: 300, mid: 300, high: 400 });
    expect(synced.official).toBeNull();
    const bare = at("2026-11-08T10:00:00Z", [], []);
    expect(bare.codesIssuedSource).toBe("estimated-from-booked");
    expect(bare.codesPerBatch.mid).toBe(700);
    expect(bare.official).toBeNull();
    expect(at("2026-11-08T10:00:00Z", all.filter((i) => i.nid === 9114), nov).official).toBeNull(); // no queue items
  });

  it("officialQueue: the two 2 Nov items and the 3 Nov item give 8700 issued and 300-code batches", () => {
    const items = all.filter((i) => [9108, 9109, 9110].includes(i.nid));
    const q = officialQueue(items, new Date("2026-11-03T18:00:00Z"))!; // Tue 3 Nov, 20:00 Cairo
    expect(q).toMatchObject({ nid: 9110, day: "2026-11-03", issuedThrough: 8700, batchSize: 300, todayBatch: 300 });
    expect(q.issuedDay).toBe(isoDay("2026-11-03"));
    expect(q.asOfDay).toBe(isoDay("2026-11-03"));
    expect(q.next).toEqual({ from: 8701, to: 9000, day: isoDay("2026-11-04"), hour: 11 });
    // The next morning, before 11:00, nothing has changed; from 11:00 the 4 Nov batch is out.
    expect(officialQueue(items, new Date("2026-11-04T08:00:00Z"))!.issuedThrough).toBe(8700);
    const later = officialQueue(items, new Date("2026-11-04T09:00:00Z"))!;
    expect(later.issuedThrough).toBe(9000);
    expect(later.issuedDay).toBe(isoDay("2026-11-04"));
    expect(later.next).toBeNull();
    expect(later.todayBatch).toBe(300);
    expect(officialQueue([], new Date())).toBeNull();
  });

  it("officialQueue: a batch announced without its end takes the last batch size, then +1 batch per working day at 11:00", () => {
    // NID 9118 (Mon 9 Nov): «through 10700; resume Tue 10 Nov at 10 from 10701 to» with no end number.
    const nid9118 = { nid: 9118, day: "2026-11-09", title: "", servedThrough: 10700, next: { from: 10701, to: null, day: "2026-11-10", hour: 10 } };
    const items = [...all.filter((i) => [9116, 9117].includes(i.nid)), nid9118];
    const q = (iso: string) => officialQueue(items, new Date(iso))!;
    expect(q("2026-11-10T07:00:00Z").issuedThrough).toBe(10700); // Tue 09:00 Cairo
    const tue = q("2026-11-10T08:00:00Z"); // Tue 10:00 Cairo, the announced hour
    expect(tue).toMatchObject({ issuedThrough: 11400, newsThrough: 11400, batchSize: 700, todayBatch: 700, projectedBatches: 0, next: null });
    expect(q("2026-11-11T08:30:00Z").issuedThrough).toBe(11400); // Wed 10:30: not yet
    const wed = q("2026-11-11T09:00:00Z"); // Wed 11:00
    expect(wed).toMatchObject({ issuedThrough: 12100, newsThrough: 11400, todayBatch: 700, projectedBatches: 1 });
    expect(wed.asOfDay).toBe(isoDay("2026-11-10")); // a projection is not news
    expect(q("2026-11-12T10:00:00Z").issuedThrough).toBe(12800); // Thu
    expect(q("2026-11-14T10:00:00Z").issuedThrough).toBe(12800); // Fri and Sat off
    expect(q("2026-11-15T09:00:00Z").issuedThrough).toBe(13500); // Sun 11:00
    // A newer news item replaces the projection.
    const posted = { nid: 9119, day: "2026-11-11", title: "", servedThrough: 11900, next: { from: 11901, to: 12500, day: "2026-11-12", hour: 10 } };
    expect(officialQueue([...items, posted], new Date("2026-11-11T18:00:00Z"))!.issuedThrough).toBe(11900);
    // The estimate follows it.
    const est = estimateQueue({ rank: 20000, booked: 6889, available: 8658, official: items, now: new Date("2026-11-10T10:00:00Z") });
    expect(est.codesIssued).toBe(11400);
  });

  it("nthBatchDay honours an announced first day, even a Friday, then walks working days", () => {
    const fri = isoDay("2026-11-13");
    expect(nthBatchDay(isoDay("2026-11-10"), isoDay("2026-11-11"), 1, fri)).toBe(fri);
    expect(nthBatchDay(isoDay("2026-11-10"), isoDay("2026-11-11"), 2, fri)).toBe(isoDay("2026-11-15")); // Sunday
    expect(nthBatchDay(isoDay("2026-11-10"), isoDay("2026-11-11"), 1)).toBe(isoDay("2026-11-11"));
    expect(cairoHourOf(new Date("2026-11-08T10:00:00Z"))).toBe(12);
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
