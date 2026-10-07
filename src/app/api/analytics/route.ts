import { connection } from "next/server";
import { asc } from "drizzle-orm";
import { getDb } from "@/db/client";
import { allocations } from "@/db/schema";
import { getComputed } from "@/engine";

const TZ = "Africa/Cairo";
const dayKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: TZ });
const hourKey = (d: Date) =>
  `${dayKey(d)} ${d.toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" }).slice(0, 2)}:00`;

function histogram(values: number[], bins: number, min?: number, max?: number) {
  if (!values.length) return [];
  const lo = min ?? Math.min(...values);
  const hi = max ?? Math.max(...values);
  const w = (hi - lo) / bins || 1;
  const out = Array.from({ length: bins }, (_, i) => ({ from: lo + i * w, to: lo + (i + 1) * w, count: 0 }));
  for (const v of values) out[Math.min(bins - 1, Math.max(0, Math.floor((v - lo) / w)))].count++;
  return out;
}

export async function GET() {
  await connection();
  const { dashboard, byId } = await getComputed();
  const all = [...byId.values()];
  const now = Date.now();
  const booked = all.filter((l) => l.status === "booked" && l.bookingDate).map((l) => ({ ...l, t: new Date(l.bookingDate!) }));

  // Bookings per day + reconstructed inventory remaining.
  const perDay = new Map<string, number>();
  for (const b of booked) perDay.set(dayKey(b.t), (perDay.get(dayKey(b.t)) ?? 0) + 1);
  const days = [...perDay.keys()].sort();
  let cum = all.filter((l) => l.status === "booked" && !l.bookingDate).length;
  const daily = days.map((d) => {
    cum += perDay.get(d)!;
    return { day: d, booked: perDay.get(d)!, cumulativeBooked: cum, remaining: all.length - cum };
  });

  // Last 48h hourly rate.
  const perHour = new Map<string, number>();
  for (const b of booked) if (now - b.t.getTime() < 48 * 3600_000) perHour.set(hourKey(b.t), (perHour.get(hourKey(b.t)) ?? 0) + 1);
  const hourly = [...perHour.entries()].sort().map(([hour, n]) => ({ hour, booked: n }));

  const db = await getDb();
  const batches = (await db.select().from(allocations).orderBy(asc(allocations.issueDate))).map((a) => ({
    day: dayKey(a.issueDate),
    codes: a.totalCodes,
    booked: a.plotsBooked,
    conversion: a.plotsBooked != null && a.totalCodes ? a.plotsBooked / a.totalCodes : null,
  }));

  const avail = all.filter((l) => l.status === "available");
  const priceDist = {
    available: histogram(avail.map((l) => l.pricePerMeter), 20, 0, 800),
    booked: histogram(all.filter((l) => l.status === "booked").map((l) => l.pricePerMeter), 20, 0, 800),
  };
  const dpDist = {
    available: histogram(avail.map((l) => l.downPayment), 20, 0, 100_000),
    booked: histogram(all.filter((l) => l.status === "booked").map((l) => l.downPayment), 20, 0, 100_000),
  };
  const areaDist = {
    available: histogram(avail.map((l) => l.area), 20, 300, 1300),
    booked: histogram(all.filter((l) => l.status === "booked").map((l) => l.area), 20, 300, 1300),
  };

  // Project popularity & depletion speed.
  const week = 7 * 86_400_000;
  const proj = new Map<string, { cityName: string; projectName: string | null; total: number; booked: number; available: number; last7d: number }>();
  for (const l of all) {
    const k = l.projectId ?? l.cityName;
    const p = proj.get(k) ?? { cityName: l.cityName, projectName: l.projectName, total: 0, booked: 0, available: 0, last7d: 0 };
    p.total++;
    if (l.status === "booked") {
      p.booked++;
      if (l.bookingDate && now - new Date(l.bookingDate).getTime() < week) p.last7d++;
    } else p.available++;
    proj.set(k, p);
  }
  const projects = [...proj.values()].map((p) => ({
    ...p,
    bookedPct: p.booked / p.total,
    perDay: p.last7d / 7,
    daysToSellOut: p.last7d > 0 ? p.available / (p.last7d / 7) : null,
  }));
  const popular = [...projects].sort((a, b) => b.last7d - a.last7d).slice(0, 15);
  const fastest = projects
    .filter((p) => p.daysToSellOut != null && p.available > 0)
    .sort((a, b) => a.daysToSellOut! - b.daysToSellOut!)
    .slice(0, 15);

  const last24 = booked.filter((b) => now - b.t.getTime() < 86_400_000).length;
  const last7 = booked.filter((b) => now - b.t.getTime() < week).length;
  return Response.json({
    generatedAt: new Date().toISOString(),
    freshness: dashboard.freshness,
    rates: { last24h: last24, perHour24h: last24 / 24, last7d: last7, perDay7d: last7 / 7 },
    queue: dashboard.queue,
    daily,
    hourly,
    batches,
    priceDist,
    dpDist,
    areaDist,
    popular,
    fastest,
  });
}
