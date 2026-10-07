import { MODEL } from "./config";

export interface AllocationBatch {
  issueDate: Date;
  totalCodes: number;
  plotsBooked: number | null;
}

export interface Range {
  low: number;
  mid: number;
  high: number;
}

export interface QueueEstimate {
  rank: number;
  codesIssued: number;
  codesIssuedSource: "allocations" | "estimated-from-booked";
  peopleAhead: number;
  conversion: Range;
  codesPerBatch: Range;
  batchesPerWeek: number;
  /** Calendar days until the user's batch is issued. low = fastest. */
  daysToTurn: Range;
  eta: { best: Date | null; expected: Date | null; worst: Date | null };
  /** Bookings expected to happen before the user's turn. */
  bookingsAhead: Range;
  /** Market-wide inventory left when the user's turn arrives (high = optimistic). */
  remainingAtTurn: Range;
  aggregateLevel: "HIGH" | "MEDIUM" | "LOW";
  assumptions: string[];
}

const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const DAY = 86_400_000;

/**
 * Queue model. NUCA issues daily batches of booking codes to the next ranks;
 * only a fraction of code holders book. We assume codes are issued in rank order.
 */
export function estimateQueue(input: {
  rank: number;
  booked: number;
  available: number;
  allocations?: AllocationBatch[];
  /** Optional: allocated code count reported directly by the source. */
  allocatedCodes?: number | null;
  now?: Date;
}): QueueEstimate {
  const now = input.now ?? new Date();
  const assumptions: string[] = [];
  const batches = [...(input.allocations ?? [])].sort((a, b) => a.issueDate.getTime() - b.issueDate.getTime());
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  // A batch issued today is still in progress; its conversion is not final.
  const completed = batches.filter((b) => b.issueDate.getTime() < startOfToday.getTime());
  const recent = completed.slice(-MODEL.recentBatches);

  // Conversion: share of code holders who actually booked, per completed batch.
  const convs = recent
    .filter((b) => b.plotsBooked != null && b.totalCodes > 0)
    .map((b) => clamp(b.plotsBooked! / b.totalCodes, 0, 1));
  let conversion: Range;
  if (convs.length >= 2) {
    const mean = convs.reduce((a, b) => a + b, 0) / convs.length;
    conversion = { low: Math.min(...convs), mid: mean, high: Math.max(...convs) };
  } else if (completed.length && input.booked > 0) {
    const issued = completed.reduce((a, b) => a + b.totalCodes, 0);
    const c = clamp(input.booked / issued, 0, 1);
    conversion = { low: clamp(c - 0.1, 0, 1), mid: c, high: clamp(c + 0.1, 0, 1) };
    assumptions.push("Conversion estimated from total booked / total codes (per-batch data missing).");
  } else {
    const c = MODEL.defaultConversion;
    conversion = { low: c - 0.1, mid: c, high: c + 0.1 };
    assumptions.push(`No allocation history; assumed ${Math.round(c * 100)}% of code holders book.`);
  }

  let codesIssued: number;
  let codesIssuedSource: QueueEstimate["codesIssuedSource"];
  const fromBatches = batches.reduce((a, b) => a + b.totalCodes, 0);
  if (fromBatches > 0 || (input.allocatedCodes ?? 0) > 0) {
    codesIssued = Math.max(fromBatches, input.allocatedCodes ?? 0);
    codesIssuedSource = "allocations";
  } else {
    codesIssued = Math.round(input.booked / conversion.mid);
    codesIssuedSource = "estimated-from-booked";
    assumptions.push("Codes issued estimated as booked ÷ conversion.");
  }
  assumptions.push("A1: booking codes are issued in rank order, so ranks ≤ codes issued have been served.");
  assumptions.push(`Best case assumes batch size grows ×${MODEL.optimisticBatchGrowth}; worst case uses the smallest recent batch.`);
  assumptions.push("A2: future batches convert to bookings at the recent per-batch rate.");

  const peopleAhead = Math.max(0, input.rank - codesIssued);

  const sizes = (recent.length ? recent : batches.slice(-MODEL.recentBatches)).map((b) => b.totalCodes);
  // Optimistic case allows NUCA to enlarge batches again (it already went 200 → 300).
  const codesPerBatch: Range = sizes.length
    ? { low: Math.min(...sizes), mid: median(sizes), high: Math.max(Math.max(...sizes), median(sizes) * MODEL.optimisticBatchGrowth) }
    : { low: MODEL.defaultCodesPerBatch * 0.67, mid: MODEL.defaultCodesPerBatch, high: MODEL.defaultCodesPerBatch * 1.33 };

  // Batches per week from the last 14 days of issue dates (NUCA skips some days, e.g. Fri/Sat).
  const twoWeeksAgo = now.getTime() - 14 * DAY;
  const lastTwoWeeks = batches.filter((b) => b.issueDate.getTime() >= twoWeeksAgo).length;
  const spanDays = batches.length ? Math.min(14, (now.getTime() - batches[0].issueDate.getTime()) / DAY + 1) : 0;
  const batchesPerWeek =
    lastTwoWeeks >= 3 && spanDays >= 5 ? clamp((lastTwoWeeks / spanDays) * 7, 1, 7) : MODEL.defaultBatchesPerWeek;

  const perDay = (codes: number) => (codes * batchesPerWeek) / 7;
  const daysToTurn: Range = {
    low: peopleAhead / perDay(codesPerBatch.high),
    mid: peopleAhead / perDay(codesPerBatch.mid),
    high: peopleAhead / perDay(codesPerBatch.low),
  };
  const at = (d: number) => (Number.isFinite(d) ? new Date(now.getTime() + d * DAY) : null);

  const bookingsAhead: Range = {
    low: peopleAhead * conversion.low,
    mid: peopleAhead * conversion.mid,
    high: peopleAhead * conversion.high,
  };
  const remainingAtTurn: Range = {
    low: Math.max(0, input.available - bookingsAhead.high),
    mid: Math.max(0, input.available - bookingsAhead.mid),
    high: Math.max(0, input.available - bookingsAhead.low),
  };
  const ratio = input.available > 0 ? remainingAtTurn.mid / input.available : 0;
  const aggregateLevel = ratio >= MODEL.aggregateHighAt ? "HIGH" : ratio >= MODEL.aggregateMediumAt ? "MEDIUM" : "LOW";

  return {
    rank: input.rank,
    codesIssued,
    codesIssuedSource,
    peopleAhead,
    conversion,
    codesPerBatch,
    batchesPerWeek,
    daysToTurn,
    eta: { best: at(daysToTurn.low), expected: at(daysToTurn.mid), worst: at(daysToTurn.high) },
    bookingsAhead,
    remainingAtTurn,
    aggregateLevel,
    assumptions,
  };
}
