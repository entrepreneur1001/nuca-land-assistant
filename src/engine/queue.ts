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
  /** Code holders already called (earlier batches) who haven't booked yet. */
  unbookedCodes: number;
  /** Bookings still expected from people already called: today's batch finishing + late bookers from earlier batches. */
  pendingBookings: Range;
  /** Bookings expected to happen before the user's turn (people ahead + pending). */
  bookingsAhead: Range;
  /** Market-wide inventory left when the user's turn arrives (high = optimistic). */
  remainingAtTurn: Range;
  aggregateLevel: "HIGH" | "MEDIUM" | "LOW";
  assumptions: string[];
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const DAY = 86_400_000;

const cairoDate = new Intl.DateTimeFormat("en-CA", { timeZone: MODEL.batchTimeZone, year: "numeric", month: "2-digit", day: "2-digit" });
/** The Cairo calendar day of `d`, as UTC noon of that day (safe for day arithmetic and getUTCDay()). */
function cairoDay(d: Date): number {
  const [y, m, dd] = cairoDate.format(d).split("-").map(Number);
  return Date.UTC(y, m - 1, dd, 12);
}
const isBatchDay = (day: number) => (MODEL.batchWeekdays as readonly number[]).includes(new Date(day).getUTCDay());

const cairoHour = new Intl.DateTimeFormat("en-GB", { timeZone: MODEL.batchTimeZone, hour: "numeric", hourCycle: "h23" });
/** True during the 15-minute sync window: a batch weekday (Sun–Thu) between the configured Cairo hours. */
export function inSyncWindow(d: Date): boolean {
  const hour = Number(cairoHour.format(d));
  return isBatchDay(cairoDay(d)) && hour >= MODEL.syncWindowHours.start && hour < MODEL.syncWindowHours.end;
}

/** Cairo day of the n-th batch (n ≥ 1) issued after `lastBatchDay`, never earlier than `today`. Skips Friday/Saturday. */
function nthBatchDay(lastBatchDay: number, today: number, n: number): number {
  let day = Math.max(lastBatchDay + DAY, today);
  for (let seen = 0; ; day += DAY) if (isBatchDay(day) && ++seen >= n) return day;
}

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
  const today = cairoDay(now);
  // A batch issued today (Cairo time) is still in progress; its conversion is not final.
  const completed = batches.filter((b) => cairoDay(b.issueDate) < today);
  const inProgress = batches.filter((b) => cairoDay(b.issueDate) >= today);
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
  assumptions.push(`Best case assumes batch size grows ×${MODEL.optimisticBatchGrowth.toFixed(2)}; expected and worst case keep the latest batch size.`);
  assumptions.push("A2: future batches convert to bookings at the recent per-batch rate.");

  const peopleAhead = Math.max(0, input.rank - codesIssued);

  // NUCA sends one batch per working day (Sun–Thu) and only ever grew it (200 → 300 on 1 Oct 2026), so the latest batch
  // size is both the expected and the worst case; the best case allows it to grow again.
  const latest = batches.at(-1)?.totalCodes ?? MODEL.defaultCodesPerBatch;
  const codesPerBatch: Range = { low: latest, mid: latest, high: Math.round(latest * MODEL.optimisticBatchGrowth) };
  const batchesPerWeek = MODEL.batchWeekdays.length;
  assumptions.push("A3: one batch per working day; Friday and Saturday are off (public holidays are not modelled).");

  const lastBatchDay = batches.length ? cairoDay(batches.at(-1)!.issueDate) : today - DAY;
  const turn = (perBatch: number) => {
    if (peopleAhead <= 0) return { days: 0, date: now };
    const day = nthBatchDay(lastBatchDay, today, Math.ceil(peopleAhead / perBatch));
    return { days: Math.max(0, (day - now.getTime()) / DAY), date: new Date(day) };
  };
  const fast = turn(codesPerBatch.high);
  const mid = turn(codesPerBatch.mid);
  const slow = turn(codesPerBatch.low);
  const daysToTurn: Range = { low: fast.days, mid: mid.days, high: slow.days };

  // People already called who haven't booked still compete: today's batch is still booking, and earlier code holders may book late.
  const openCodes = inProgress.reduce((a, b) => a + b.totalCodes, 0);
  const openBooked = inProgress.reduce((a, b) => a + (b.plotsBooked ?? 0), 0);
  const unbookedCodes = Math.max(0, codesIssued - openCodes - Math.max(0, input.booked - openBooked));
  const late = MODEL.lateBookingShare;
  const pending = (k: keyof Range) => Math.max(0, openCodes * conversion[k] - openBooked) + unbookedCodes * late[k];
  const pendingBookings: Range = { low: pending("low"), mid: pending("mid"), high: pending("high") };
  if (unbookedCodes > 0) assumptions.push(`A4: ${Math.round(late.mid * 100)}% (up to ${Math.round(late.high * 100)}%) of the ${unbookedCodes} earlier code holders who haven't booked may still book.`);

  const bookingsAhead: Range = {
    low: peopleAhead * conversion.low + pendingBookings.low,
    mid: peopleAhead * conversion.mid + pendingBookings.mid,
    high: peopleAhead * conversion.high + pendingBookings.high,
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
    eta: { best: fast.date, expected: mid.date, worst: slow.date },
    unbookedCodes,
    pendingBookings,
    bookingsAhead,
    remainingAtTurn,
    aggregateLevel,
    assumptions,
  };
}
