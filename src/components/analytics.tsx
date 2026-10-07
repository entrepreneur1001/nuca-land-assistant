"use client";

import type { ReactNode } from "react";
import useSWR from "swr";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fetcher, fmt, pct, shortDate } from "@/lib/client";
import type { QueueEstimate } from "@/engine/queue";
import { Card, Stat } from "./ui";

type Hist = { from: number; to: number; count: number }[];
interface AnalyticsData {
  freshness: { stale: boolean; staleReason: string | null };
  rates: { last24h: number; perHour24h: number; last7d: number; perDay7d: number };
  queue: QueueEstimate;
  daily: { day: string; booked: number; cumulativeBooked: number; remaining: number }[];
  hourly: { hour: string; booked: number }[];
  batches: { day: string; codes: number; booked: number | null; conversion: number | null }[];
  priceDist: { available: Hist; booked: Hist };
  dpDist: { available: Hist; booked: Hist };
  areaDist: { available: Hist; booked: Hist };
  popular: Project[];
  fastest: Project[];
}
interface Project {
  cityName: string;
  projectName: string | null;
  total: number;
  booked: number;
  available: number;
  last7d: number;
  bookedPct: number;
  perDay: number;
  daysToSellOut: number | null;
}

const axis = { stroke: "var(--muted)", fontSize: 11, tickLine: false, axisLine: false } as const;
const tooltipStyle = {
  contentStyle: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--text)" },
  labelStyle: { color: "var(--muted)" },
  cursor: { fill: "var(--surface-2)" },
};

function ChartCard({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <Card>
      <h3 className="font-semibold">{title}</h3>
      {sub ? <p className="text-xs text-muted">{sub}</p> : null}
      <div className="mt-3 h-56">{children}</div>
    </Card>
  );
}

const mergeHist = (a: Hist, b: Hist, label: (h: Hist[0]) => string) =>
  a.map((h, i) => ({ bucket: label(h), available: h.count, booked: b[i]?.count ?? 0 }));

export function Analytics() {
  const { data, error } = useSWR<AnalyticsData>("/api/analytics", fetcher, { refreshInterval: 60_000 });
  if (error) return <Card className="text-bad">Failed to load analytics: {String(error.message)}</Card>;
  if (!data) return <div className="py-20 text-center text-muted">Loading analytics…</div>;
  const q = data.queue;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Market analytics</h1>
      {data.freshness.stale ? (
        <div className="rounded-xl border border-warn bg-warn-soft px-4 py-2 text-sm text-warn">⚠ Data may be outdated: {data.freshness.staleReason}</div>
      ) : null}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Booked last 24h" value={fmt(data.rates.last24h)} sub={`${fmt(data.rates.perHour24h, 1)} / hour`} />
        <Stat label="Booked last 7 days" value={fmt(data.rates.last7d)} sub={`${fmt(data.rates.perDay7d, 0)} / day`} />
        <Stat label="Conversion" value={pct(q.conversion.mid)} sub={`range ${pct(q.conversion.low)}–${pct(q.conversion.high)} of codes`} />
        <Stat label="Days until your turn" value={`~${fmt(q.daysToTurn.mid)}`} sub={`range ${fmt(q.daysToTurn.low)}–${fmt(q.daysToTurn.high)} days`} />
      </div>

      <Card>
        <h3 className="font-semibold">Estimated arrival of your booking code</h3>
        <p className="text-xs text-muted">Estimates, not guarantees. They depend on NUCA keeping its batch size and schedule.</p>
        <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
          <div><div className="text-xs text-muted">Best case</div><div className="text-lg font-semibold">{shortDate(q.eta.best)}</div><div className="text-xs text-muted">{fmt(q.codesPerBatch.high)} codes/batch</div></div>
          <div><div className="text-xs text-muted">Expected</div><div className="text-lg font-semibold">{shortDate(q.eta.expected)}</div><div className="text-xs text-muted">{fmt(q.codesPerBatch.mid)} codes/batch</div></div>
          <div><div className="text-xs text-muted">Worst case</div><div className="text-lg font-semibold">{shortDate(q.eta.worst)}</div><div className="text-xs text-muted">{fmt(q.codesPerBatch.low)} codes/batch</div></div>
        </div>
        <p className="mt-2 text-xs text-muted">
          {fmt(q.peopleAhead)} people ahead · ~{fmt(q.batchesPerWeek, 1)} batches/week · inventory left at your turn ~{fmt(q.remainingAtTurn.mid)} (range {fmt(q.remainingAtTurn.low)}–{fmt(q.remainingAtTurn.high)})
        </p>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <ChartCard title="Bookings per day" sub="From source booking dates (Cairo time)">
          <ResponsiveContainer>
            <BarChart data={data.daily} margin={{ left: -16, right: 4 }}>
              <CartesianGrid vertical={false} stroke="var(--grid)" />
              <XAxis dataKey="day" {...axis} tickFormatter={(d: string) => d.slice(5)} />
              <YAxis {...axis} />
              <Tooltip {...tooltipStyle} />
              <Bar isAnimationActive={false} dataKey="booked" name="Booked" fill="var(--series-1)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Inventory remaining" sub="Total plots minus cumulative bookings">
          <ResponsiveContainer>
            <LineChart data={data.daily} margin={{ left: -4, right: 8 }}>
              <CartesianGrid vertical={false} stroke="var(--grid)" />
              <XAxis dataKey="day" {...axis} tickFormatter={(d: string) => d.slice(5)} />
              <YAxis {...axis} domain={["dataMin - 200", "dataMax + 200"]} tickFormatter={(v: number) => fmt(v)} />
              <Tooltip {...tooltipStyle} cursor={{ stroke: "var(--muted)" }} />
              <Line isAnimationActive={false} dataKey="remaining" name="Remaining" stroke="var(--series-1)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Codes issued vs plots booked, per batch" sub="Each NUCA daily batch">
          <ResponsiveContainer>
            <BarChart data={data.batches} margin={{ left: -16, right: 4 }} barGap={2}>
              <CartesianGrid vertical={false} stroke="var(--grid)" />
              <XAxis dataKey="day" {...axis} tickFormatter={(d: string) => d.slice(5)} />
              <YAxis {...axis} />
              <Tooltip {...tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar isAnimationActive={false} dataKey="codes" name="Codes issued" fill="var(--series-1)" radius={[4, 4, 0, 0]} />
              <Bar isAnimationActive={false} dataKey="booked" name="Plots booked" fill="var(--series-2)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Bookings per hour (last 48h)">
          <ResponsiveContainer>
            <BarChart data={data.hourly} margin={{ left: -16, right: 4 }}>
              <CartesianGrid vertical={false} stroke="var(--grid)" />
              <XAxis dataKey="hour" {...axis} tickFormatter={(h: string) => h.slice(5, 13)} />
              <YAxis {...axis} />
              <Tooltip {...tooltipStyle} />
              <Bar isAnimationActive={false} dataKey="booked" name="Booked" fill="var(--series-1)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        {(
          [
            ["Price per m² distribution (USD)", mergeHist(data.priceDist.available, data.priceDist.booked, (h) => `${fmt(h.from)}`)],
            ["Down payment distribution (USD)", mergeHist(data.dpDist.available, data.dpDist.booked, (h) => `${fmt(h.from / 1000)}k`)],
            ["Area distribution (m²)", mergeHist(data.areaDist.available, data.areaDist.booked, (h) => `${fmt(h.from)}`)],
          ] as const
        ).map(([title, rows]) => (
          <ChartCard key={title} title={title}>
            <ResponsiveContainer>
              <BarChart data={rows as unknown as object[]} margin={{ left: -8, right: 4 }} barGap={2}>
                <CartesianGrid vertical={false} stroke="var(--grid)" />
                <XAxis dataKey="bucket" {...axis} />
                <YAxis {...axis} />
                <Tooltip {...tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar isAnimationActive={false} dataKey="available" name="Available" fill="var(--series-1)" radius={[4, 4, 0, 0]} />
                <Bar isAnimationActive={false} dataKey="booked" name="Booked" fill="var(--series-2)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <ProjectTable title="Most popular projects (last 7 days)" rows={data.popular} />
        <ProjectTable title="Fastest disappearing projects" rows={data.fastest} />
      </div>
    </div>
  );
}

function ProjectTable({ title, rows }: { title: string; rows: Project[] }) {
  return (
    <Card>
      <h3 className="font-semibold">{title}</h3>
      <div className="mt-2 -mx-4 overflow-x-auto px-4">
        <table className="w-full min-w-[480px] text-sm">
          <thead className="text-left text-xs uppercase tracking-wider text-muted">
            <tr className="border-b border-border">
              <th className="py-1.5">Project</th>
              <th className="text-right">7d</th>
              <th className="text-right">Left</th>
              <th className="text-right">Booked</th>
              <th className="text-right">Sells out in</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p, i) => (
              <tr key={i} className="border-b border-border/60">
                <td className="max-w-[220px] py-1.5">
                  <div className="truncate"><bdi>{p.projectName ?? "—"}</bdi></div>
                  <div className="truncate text-xs text-muted"><bdi>{p.cityName}</bdi></div>
                </td>
                <td className="text-right">{fmt(p.last7d)}</td>
                <td className="text-right">{fmt(p.available)}</td>
                <td className="text-right">{pct(p.bookedPct)}</td>
                <td className="text-right">{p.daysToSellOut == null ? "—" : `~${fmt(p.daysToSellOut, 0)} d`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
