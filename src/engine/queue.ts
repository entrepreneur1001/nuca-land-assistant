import type { OfficialNewsItem } from "@/data/snapshot";
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
  codesIssuedSource: "official" | "allocations" | "estimated-from-booked";
  peopleAhead: number;
  conversion: Range;
  codesPerBatch: Range;
  batchesPerWeek: number;
  /** Calendar days until the user's batch is issued. low = fastest. */
  daysToTurn: Range;
  eta: { best: Date | null; expected: Date | null; worst: Date | null };
  /**
   * The latest official NUCA news item about the queue (days as "YYYY-MM-DD"). `applied` is false when the synced
   * batch data is newer than the item, in which case the synced data sizes the estimate.
   */
  official: {
    nid: number;
    day: string;
    issuedThrough: number;
    batchSize: number | null;
    next: { from: number; to: number | null; day: string } | null;
    applied: boolean;
  } | null;
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
export function cairoDay(d: Date): number {
  const [y, m, dd] = cairoDate.format(d).split("-").map(Number);
  return Date.UTC(y, m - 1, dd, 12);
}
/** "YYYY-MM-DD" as UTC noon of that day (same convention as cairoDay). */
export const isoDay = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return Date.UTC(y, m - 1, d, 12);
};
/** The inverse of isoDay / cairoDay: a day number → "YYYY-MM-DD". */
const dayIso = (day: number) => new Date(day).toISOString().slice(0, 10);
const isBatchDay = (day: number) => (MODEL.batchWeekdays as readonly number[]).includes(new Date(day).getUTCDay());

const cairoHour = new Intl.DateTimeFormat("en-GB", { timeZone: MODEL.batchTimeZone, hour: "numeric", hourCycle: "h23" });
/** Hour of the day (0–23) in Cairo. */
export function cairoHourOf(d: Date): number {
  return Number(cairoHour.format(d));
}
/** True during the 15-minute sync window: a batch weekday (Sun–Thu) between the configured Cairo hours. */
export function inSyncWindow(d: Date): boolean {
  const hour = cairoHourOf(d);
  return isBatchDay(cairoDay(d)) && hour >= MODEL.syncWindowHours.start && hour < MODEL.syncWindowHours.end;
}

/**
 * Cairo day of the n-th batch (n ≥ 1) issued after `lastBatchDay`, never earlier than `today`. Skips Friday/Saturday.
 * With `firstDay` (an announced next batch day) the first batch is on that day whatever its weekday, and later ones
 * walk the batch weekdays after it.
 */
export function nthBatchDay(lastBatchDay: number, today: number, n: number, firstDay?: number): number {
  if (firstDay != null) return n <= 1 ? firstDay : nthBatchDayFrom(firstDay + DAY, n - 1);
  return nthBatchDayFrom(Math.max(lastBatchDay + DAY, today), n);
}

/** The n-th batch day (n ≥ 1) on or after `day`. Every 7 days hold the same number of batch days, so whole weeks are
 *  skipped arithmetically: a walk of one day at a time took seconds for a huge rank and never ended past JS's last Date. */
function nthBatchDayFrom(day: number, n: number): number {
  const perWeek = MODEL.batchWeekdays.length;
  const weeks = Math.max(0, Math.floor((n - 1) / perWeek));
  let left = n - weeks * perWeek;
  day += weeks * 7 * DAY;
  // At most one more week; bounded because past JS's last Date getUTCDay() is NaN and no day matches.
  for (let i = 0; i < 14; i++, day += DAY) if (isBatchDay(day) && --left <= 0) return day;
  return day;
}

/** An official news item that says something about the code queue. */
export const isQueueNews = (item: OfficialNewsItem) => item.servedThrough != null || item.next != null;

export interface OfficialQueue {
  /** The latest queue item. */
  nid: number;
  day: string;
  /** Highest serial known to have been issued, and the Cairo day (UTC noon) it was reached. */
  issuedThrough: number;
  issuedDay: number;
  /** How current the news is: the later of the latest item's day and the last day it accounts for (projections excluded). */
  asOfDay: number;
  /** Size of the last batch whose range is known. */
  batchSize: number | null;
  /** The announced next batch when it is still ahead (day ≥ today and not yet counted as issued). */
  next: { from: number; to: number | null; day: number; hour: number | null } | null;
  /** `batchSize` when a batch was completed today (its holders are still booking), else null. */
  todayBatch: number | null;
  /** `issuedThrough` before the projection: what the news itself says. */
  newsThrough: number;
  /** Batch weekdays after the latest news item counted as issued (one `batchSize` each) because NUCA hasn't posted yet. */
  projectedBatches: number;
}

/**
 * Reduce the official news items to what the queue model needs. A batch announced for a day counts as issued once
 * that day has passed, or on the day itself from its announced hour (MODEL.defaultBatchHour when none).
 */
export function officialQueue(items: OfficialNewsItem[], now: Date): OfficialQueue | null {
  const queue = items.filter(isQueueNews).sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.nid - b.nid));
  if (!queue.length) return null;
  const today = cairoDay(now);
  const hour = cairoHourOf(now);

  // Best "issued through" candidate: highest serial, then latest day, then one that marks a completed batch
  // (a stated «حتى مسلسل N» or a next-batch range whose day has come) over a «from − 1» inference.
  type Candidate = { value: number; day: number; completed: boolean };
  let best = null as Candidate | null;
  const consider = (value: number, day: number, completed: boolean) => {
    if (!best || value > best.value || (value === best.value && (day > best.day || (day === best.day && completed && !best.completed))))
      best = { value, day, completed };
  };
  for (const it of queue) {
    const itemDay = isoDay(it.day);
    if (it.servedThrough != null) consider(it.servedThrough, itemDay, true);
    if (it.next) {
      consider(it.next.from - 1, itemDay, false);
      if (it.next.to != null && it.next.day) {
        const batchDay = isoDay(it.next.day);
        if (batchDay < today || (batchDay === today && hour >= (it.next.hour ?? MODEL.defaultBatchHour))) consider(it.next.to, batchDay, true);
      }
    }
  }
  let batchSize: number | null = null;
  queue.forEach((it, i) => {
    if (!it.next) return;
    const { from, to } = it.next;
    if (to != null) batchSize = to - from + 1;
    else {
      const later = queue.slice(i + 1).find((x) => x.servedThrough != null && x.servedThrough >= from);
      if (later) batchSize = later.servedThrough! - from + 1;
    }
  });

  // The latest item may announce a batch without its end («بدء من مسلسل 10701 حتى مسلسل» with no number): it is
  // taken to be the size of the last known batch, and counts from its announced hour like any other.
  const latest = queue.at(-1)!;
  const n = latest.next;
  const nTo = n ? (n.to ?? (batchSize != null ? n.from + batchSize - 1 : null)) : null;
  if (n && n.to == null && nTo != null && n.day) {
    const batchDay = isoDay(n.day);
    if (batchDay < today || (batchDay === today && hour >= (n.hour ?? MODEL.defaultBatchHour))) consider(nTo, batchDay, true);
  }

  // Until NUCA posts again, every later batch weekday adds one batch of the same size at MODEL.defaultBatchHour.
  // Any newer news item replaces this projection, since it is only ever walked from the latest item.
  const { value: newsThrough, day: knownDay } = best as Candidate;
  let projectedBatches = 0;
  if (batchSize != null) {
    const covered = Math.max(isoDay(latest.day), n?.day ? isoDay(n.day) : 0, (best as Candidate).day);
    for (let day = covered + DAY; day <= today; day += DAY) {
      if (!isBatchDay(day) || (day === today && hour < MODEL.defaultBatchHour)) continue;
      const b = best as Candidate;
      best = { value: b.value + batchSize, day, completed: true };
      projectedBatches++;
    }
  }
  const { value: issuedThrough, day: issuedDay, completed } = best as Candidate;

  const next =
    n && n.day && isoDay(n.day) >= today && (nTo == null || nTo > issuedThrough) ? { from: n.from, to: n.to, day: isoDay(n.day), hour: n.hour } : null;

  return {
    nid: latest.nid,
    day: latest.day,
    issuedThrough,
    newsThrough,
    issuedDay,
    // How current the news itself is: a projected batch adds no information, so it doesn't count here.
    asOfDay: Math.max(isoDay(latest.day), knownDay),
    batchSize,
    next,
    todayBatch: issuedDay === today && completed ? batchSize : null,
    projectedBatches,
  };
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
  /** Official NUCA news items (meta.officialNews); the newest information wins over the synced batches. */
  official?: OfficialNewsItem[];
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

  // Codes issued so far. The official news is the source whenever it is at least as current as the synced batches;
  // the synced batches (or, failing those, booked ÷ conversion) otherwise.
  const off = input.official?.length ? officialQueue(input.official, now) : null;
  const trackerLastDay = batches.length ? cairoDay(batches.at(-1)!.issueDate) : null;
  const trackerIssued = Math.max(
    batches.reduce((a, b) => a + b.totalCodes, 0),
    input.allocatedCodes ?? 0,
  );
  const useOfficial = !!off && (trackerLastDay == null || off.asOfDay >= trackerLastDay);
  const synced = batches.at(-1)?.totalCodes ?? null;
  let codesIssued: number;
  let codesIssuedSource: QueueEstimate["codesIssuedSource"];
  let latest: number;
  let lastBatchDay: number;
  let firstBatchDay: number | undefined;
  if (off && useOfficial) {
    codesIssued = off.asOfDay === trackerLastDay ? Math.max(off.issuedThrough, trackerIssued) : off.issuedThrough;
    codesIssuedSource = "official";
    latest = off.batchSize ?? synced ?? MODEL.defaultCodesPerBatch;
    lastBatchDay = off.issuedDay;
    firstBatchDay = off.next ? off.next.day : undefined;
    const next = off.next ? `next batch ${off.next.from}–${off.next.to ?? "…"} on ${dayIso(off.next.day)}` : "no next batch announced yet";
    assumptions.push(`A5: official NUCA news (NID ${off.nid}, ${off.day}): codes issued through ${off.newsThrough}; ${next}.`);
    if (off.projectedBatches)
      assumptions.push(`A6: ${off.projectedBatches} batch(es) of ${off.batchSize} added at ${MODEL.defaultBatchHour}:00 Cairo on working days not yet covered by the news.`);
  } else {
    if (trackerIssued > 0) {
      codesIssued = trackerIssued;
      codesIssuedSource = "allocations";
    } else {
      codesIssued = Math.round(input.booked / conversion.mid);
      codesIssuedSource = "estimated-from-booked";
      assumptions.push("Codes issued estimated as booked ÷ conversion.");
    }
    latest = synced ?? MODEL.defaultCodesPerBatch;
    lastBatchDay = batches.length ? cairoDay(batches.at(-1)!.issueDate) : today - DAY;
    if (off) assumptions.push(`A5: the official news item (NID ${off.nid}, ${off.day}) is older than the latest synced batch; synced data used.`);
  }
  assumptions.push("A1: booking codes are issued in rank order, so ranks ≤ codes issued have been served.");
  assumptions.push(`Best case assumes batch size grows ×${MODEL.optimisticBatchGrowth.toFixed(2)}; expected and worst case keep the latest batch size.`);
  assumptions.push("A2: future batches convert to bookings at the recent per-batch rate.");

  const peopleAhead = Math.max(0, input.rank - codesIssued);

  // NUCA sends one batch per working day (Sun–Thu) and only ever grew it (200 → 300 on 1 Oct 2026, 300 → 700 on
  // 8 Nov 2026, 700 → 1000 on 15 Nov 2026), so the latest batch size is both the expected and the worst case; the
  // best case allows it to grow again. The official news names the next batch's range and day, which fixes the first step of the walk.
  const codesPerBatch: Range = { low: latest, mid: latest, high: Math.round(latest * MODEL.optimisticBatchGrowth) };
  const batchesPerWeek = MODEL.batchWeekdays.length;
  assumptions.push("A3: one batch per working day; Friday and Saturday are off (public holidays are not modelled).");

  const turn = (perBatch: number) => {
    if (peopleAhead <= 0) return { days: 0, date: now };
    const day = nthBatchDay(lastBatchDay, today, Math.ceil(peopleAhead / perBatch), firstBatchDay);
    return { days: Math.max(0, (day - now.getTime()) / DAY), date: new Date(day) };
  };
  const fast = turn(codesPerBatch.high);
  const mid = turn(codesPerBatch.mid);
  const slow = turn(codesPerBatch.low);
  const daysToTurn: Range = { low: fast.days, mid: mid.days, high: slow.days };

  // People already called who haven't booked still compete: today's batch is still booking, and earlier code holders may book late.
  // When the official news reports today's batch before the tracker has it, that batch is the open one.
  let openCodes = inProgress.reduce((a, b) => a + b.totalCodes, 0);
  let openBooked = inProgress.reduce((a, b) => a + (b.plotsBooked ?? 0), 0);
  if (off && useOfficial && off.todayBatch && !inProgress.length) {
    openCodes = off.todayBatch;
    openBooked = 0;
  }
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
    official: off
      ? {
          nid: off.nid,
          day: off.day,
          issuedThrough: off.newsThrough,
          batchSize: off.batchSize,
          next: off.next ? { from: off.next.from, to: off.next.to, day: dayIso(off.next.day) } : null,
          applied: useOfficial,
        }
      : null,
    unbookedCodes,
    pendingBookings,
    bookingsAhead,
    remainingAtTurn,
    aggregateLevel,
    assumptions,
  };
}
