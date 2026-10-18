import { MODEL } from "./config";

interface DemandPlot {
  projectId: string | null;
  cityName: string;
  status: string;
  bookingDate: string | null;
}

const DAY = 86_400_000;
export const sectorKey = (p: { projectId: string | null; cityName: string }) => p.projectId ?? `city:${p.cityName}`;

/**
 * How fast each district is selling right now (0–1, 1 = fastest): the share of its inventory booked in the
 * demand window, blended with its city's share. Where people are booking is a crowd signal that the place is
 * good. Districts with only a few recent bookings lean on the city figure, so one booking isn't a trend.
 */
export function sectorDemand(plots: DemandPlot[], nowMs: number): Map<string, number> {
  const since = nowMs - MODEL.demandWindowDays * DAY;
  const tally = () => ({ recent: 0, available: 0 });
  const bySector = new Map<string, ReturnType<typeof tally> & { city: string }>();
  const byCity = new Map<string, ReturnType<typeof tally>>();
  for (const p of plots) {
    const k = sectorKey(p);
    const s = bySector.get(k) ?? { ...tally(), city: p.cityName };
    const c = byCity.get(p.cityName) ?? tally();
    if (p.status !== "booked") {
      s.available++;
      c.available++;
    } else if (p.bookingDate && Date.parse(p.bookingDate) >= since) {
      s.recent++;
      c.recent++;
    }
    bySector.set(k, s);
    byCity.set(p.cityName, c);
  }
  // Share of what was on offer at the start of the window that sold during it.
  const rate = (x: { recent: number; available: number }) => x.recent / Math.max(1, x.recent + x.available);
  const raw = new Map<string, number>();
  for (const [k, s] of bySector) {
    const city = rate(byCity.get(s.city)!);
    const trust = Math.min(1, s.recent / MODEL.demandMinBookings);
    const own = trust * rate(s) + (1 - trust) * city;
    raw.set(k, 0.7 * own + 0.3 * city);
  }
  const top = Math.max(0, ...raw.values());
  return new Map([...raw].map(([k, v]) => [k, top > 0 ? v / top : 0]));
}

/**
 * How much booking speed should count for this user (0–1): fully when their turn is within
 * `demandNearTurnDays`, fading to nothing by `demandFadeDays`. Far from their turn, fast-selling districts
 * will be gone, which the survival factor already covers.
 */
export function turnNearness(daysToTurn: number): number {
  const { demandNearTurnDays: near, demandFadeDays: fade } = MODEL;
  if (daysToTurn <= near) return 1;
  if (daysToTurn >= fade) return 0;
  return (fade - daysToTurn) / (fade - near);
}
