"use client";

import { useMemo, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Plot } from "@/data/snapshot";
import { date, num, pct, t } from "@/i18n/ar";
import { useApp } from "./app-state";
import { Card, Stat } from "./ui";

const TZ = "Africa/Cairo";
const dayKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: TZ });
const hourKey = (d: Date) => `${dayKey(d)} ${d.toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" }).slice(0, 2)}`;
const shortDay = (k: string) => new Date(`${k}T12:00:00`).toLocaleDateString("ar-EG", { day: "numeric", month: "numeric" });

const axis = { stroke: "var(--muted)", fontSize: 11, tickLine: false, axisLine: false } as const;
const tip = {
  contentStyle: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--text)", direction: "rtl" as const },
  labelStyle: { color: "var(--muted)" },
  cursor: { fill: "var(--surface-2)" },
  formatter: (v: unknown) => num(Number(v)),
};

function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <h3 className="font-bold">{title}</h3>
      <div className="mt-3 h-56" dir="ltr">{children}</div>
    </Card>
  );
}

function hist(values: number[], bins: number, lo: number, hi: number) {
  const w = (hi - lo) / bins;
  const out = Array.from({ length: bins }, (_, i) => ({ from: lo + i * w, n: 0 }));
  for (const v of values) out[Math.min(bins - 1, Math.max(0, Math.floor((v - lo) / w)))].n++;
  return out;
}

function analytics(plots: Plot[], now: number) {
  const booked = plots.filter((p) => p.status === "booked" && p.bookingDate).map((p) => ({ ...p, t: new Date(p.bookingDate!) }));
  const perDay = new Map<string, number>();
  for (const b of booked) perDay.set(dayKey(b.t), (perDay.get(dayKey(b.t)) ?? 0) + 1);
  let cum = plots.filter((p) => p.status === "booked" && !p.bookingDate).length;
  const daily = [...perDay.keys()].sort().map((d) => {
    cum += perDay.get(d)!;
    return { day: d, booked: perDay.get(d)!, remaining: plots.length - cum };
  });
  const perHour = new Map<string, number>();
  for (const b of booked) if (now - b.t.getTime() < 48 * 3600_000) perHour.set(hourKey(b.t), (perHour.get(hourKey(b.t)) ?? 0) + 1);
  const hourly = [...perHour.entries()].sort().map(([hour, n]) => ({ hour, booked: n }));
  const avail = plots.filter((p) => p.status === "available");
  const bk = plots.filter((p) => p.status === "booked");
  const mergeHist = (a: ReturnType<typeof hist>, b: ReturnType<typeof hist>, label: (x: number) => string) =>
    a.map((h, i) => ({ bucket: label(h.from), available: h.n, booked: b[i].n }));
  const dp = mergeHist(hist(avail.map((p) => p.downPayment), 20, 0, 100_000), hist(bk.map((p) => p.downPayment), 20, 0, 100_000), (x) => `${num(x / 1000)} ألف`);
  const area = mergeHist(hist(avail.map((p) => p.area), 20, 300, 1300), hist(bk.map((p) => p.area), 20, 300, 1300), (x) => num(x));

  const week = 7 * 86_400_000;
  const proj = new Map<string, { cityName: string; projectName: string | null; total: number; booked: number; available: number; last7d: number }>();
  for (const p of plots) {
    const k = p.projectId ?? p.cityName;
    const x = proj.get(k) ?? { cityName: p.cityName, projectName: p.projectName, total: 0, booked: 0, available: 0, last7d: 0 };
    x.total++;
    if (p.status === "booked") {
      x.booked++;
      if (p.bookingDate && now - Date.parse(p.bookingDate) < week) x.last7d++;
    } else x.available++;
    proj.set(k, x);
  }
  const projects = [...proj.values()].map((x) => ({ ...x, bookedPct: x.booked / x.total, daysToSellOut: x.last7d > 0 ? x.available / (x.last7d / 7) : null }));
  return {
    daily,
    hourly,
    dp,
    area,
    popular: [...projects].sort((a, b) => b.last7d - a.last7d).slice(0, 12),
    fastest: projects.filter((x) => x.daysToSellOut != null && x.available > 0).sort((a, b) => a.daysToSellOut! - b.daysToSellOut!).slice(0, 12),
  };
}

export function Market() {
  const app = useApp();
  const snapshot = app?.snapshot;
  const result = app?.result;
  const data = useMemo(() => (snapshot ? analytics(snapshot.plots, Date.parse(snapshot.meta.fullSyncAt ?? "") || 0) : null), [snapshot]);
  if (!snapshot || !result || !data) return <div className="py-20 text-center text-muted">{t.loading}</div>;
  const q = result.dashboard.queue;
  const m = result.dashboard.market;
  const batches = snapshot.meta.allocations.map((a) => ({ day: a.d.slice(0, 10), codes: a.c, booked: a.b }));

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">{t.market.title}</h1>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t.market.last24} value={num(m.bookedLast24h)} sub={t.market.perHour(m.bookedLast24h / 24)} />
        <Stat label={t.market.last7} value={num(m.bookedLast7d)} sub={t.market.perDay(m.bookedLast7d / 7)} />
        <Stat label={t.market.conversion} value={pct(q.conversion.mid)} sub={t.market.conversionSub(pct(q.conversion.low), pct(q.conversion.high))} />
        <Stat label={t.market.days} value={`~${num(q.daysToTurn.mid)}`} sub={t.market.daysSub(q.daysToTurn.low, q.daysToTurn.high)} />
      </div>

      <Card>
        <h3 className="font-bold">{t.market.eta}</h3>
        <p className="text-xs text-muted">{t.market.etaNote}</p>
        <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
          {(
            [
              [t.market.best, q.eta.best, q.codesPerBatch.high],
              [t.market.expected, q.eta.expected, q.codesPerBatch.mid],
              [t.market.worst, q.eta.worst, q.codesPerBatch.low],
            ] as const
          ).map(([label, d, per]) => (
            <div key={label}>
              <div className="text-xs text-muted">{label}</div>
              <div className="text-lg font-bold">{date(d)}</div>
              <div className="text-xs text-muted">{t.market.perBatch(per)}</div>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <ChartCard title={t.market.perDayChart}>
          <ResponsiveContainer>
            <BarChart data={data.daily} margin={{ left: -16, right: 4 }}>
              <CartesianGrid vertical={false} stroke="var(--grid)" />
              <XAxis dataKey="day" {...axis} tickFormatter={shortDay} reversed />
              <YAxis {...axis} orientation="right" tickFormatter={(v: number) => num(v)} />
              <Tooltip {...tip} labelFormatter={(l) => shortDay(String(l))} />
              <Bar isAnimationActive={false} dataKey="booked" name={t.market.bookings} fill="var(--series-1)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title={t.market.remainingChart}>
          <ResponsiveContainer>
            <LineChart data={data.daily} margin={{ left: 8, right: 4 }}>
              <CartesianGrid vertical={false} stroke="var(--grid)" />
              <XAxis dataKey="day" {...axis} tickFormatter={shortDay} reversed />
              <YAxis {...axis} orientation="right" domain={["auto", "auto"]} tickFormatter={(v: number) => num(v)} />
              <Tooltip {...tip} labelFormatter={(l) => shortDay(String(l))} cursor={{ stroke: "var(--muted)" }} />
              <Line isAnimationActive={false} dataKey="remaining" name={t.market.availableS} stroke="var(--series-1)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title={t.market.batchesChart}>
          <ResponsiveContainer>
            <BarChart data={batches} margin={{ left: -16, right: 4 }} barGap={2}>
              <CartesianGrid vertical={false} stroke="var(--grid)" />
              <XAxis dataKey="day" {...axis} tickFormatter={shortDay} reversed />
              <YAxis {...axis} orientation="right" tickFormatter={(v: number) => num(v)} />
              <Tooltip {...tip} labelFormatter={(l) => shortDay(String(l))} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar isAnimationActive={false} dataKey="codes" name={t.market.codes} fill="var(--series-1)" radius={[4, 4, 0, 0]} />
              <Bar isAnimationActive={false} dataKey="booked" name={t.market.bookings} fill="var(--series-2)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title={t.market.hourlyChart}>
          <ResponsiveContainer>
            <BarChart data={data.hourly} margin={{ left: -16, right: 4 }}>
              <CartesianGrid vertical={false} stroke="var(--grid)" />
              <XAxis dataKey="hour" {...axis} tickFormatter={(h: string) => `${num(Number(h.slice(11)))}:٠٠`} reversed />
              <YAxis {...axis} orientation="right" tickFormatter={(v: number) => num(v)} />
              <Tooltip {...tip} />
              <Bar isAnimationActive={false} dataKey="booked" name={t.market.bookings} fill="var(--series-1)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        {(
          [
            [t.market.dpChart, data.dp],
            [t.market.areaChart, data.area],
          ] as const
        ).map(([title, rows]) => (
          <ChartCard key={title} title={title}>
            <ResponsiveContainer>
              <BarChart data={rows as unknown as object[]} margin={{ left: -8, right: 4 }} barGap={2}>
                <CartesianGrid vertical={false} stroke="var(--grid)" />
                <XAxis dataKey="bucket" {...axis} reversed />
                <YAxis {...axis} orientation="right" tickFormatter={(v: number) => num(v)} />
                <Tooltip {...tip} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar isAnimationActive={false} dataKey="available" name={t.market.availableS} fill="var(--series-1)" radius={[4, 4, 0, 0]} />
                <Bar isAnimationActive={false} dataKey="booked" name={t.market.bookedS} fill="var(--series-2)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <ProjectTable title={t.market.popular} rows={data.popular} />
        <ProjectTable title={t.market.fastest} rows={data.fastest} />
      </div>
    </div>
  );
}

function ProjectTable({ title, rows }: { title: string; rows: ReturnType<typeof analytics>["popular"] }) {
  return (
    <Card>
      <h3 className="font-bold">{title}</h3>
      <div className="-mx-4 mt-2 overflow-x-auto px-4">
        <table className="w-full min-w-[440px] text-sm">
          <thead className="text-right text-xs text-muted">
            <tr className="border-b border-border">
              <th className="py-1.5">{t.market.colProject}</th>
              <th>{t.market.col7d}</th>
              <th>{t.market.colLeft}</th>
              <th>{t.market.colBooked}</th>
              <th>{t.market.colSellOut}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p, i) => (
              <tr key={i} className="border-b border-border/60">
                <td className="max-w-[200px] py-1.5">
                  <div className="truncate">{p.projectName ?? "—"}</div>
                  <div className="truncate text-xs text-muted">{p.cityName}</div>
                </td>
                <td>{num(p.last7d)}</td>
                <td>{num(p.available)}</td>
                <td>{pct(p.bookedPct)}</td>
                <td>{p.daysToSellOut == null ? "—" : t.market.days_(p.daysToSellOut)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
