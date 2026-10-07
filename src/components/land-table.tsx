"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import useSWR from "swr";
import { fetcher, fmt, usd, type ListedLand } from "@/lib/client";
import { Card, FeatureBadges, RecBadge, SurvivalBar } from "./ui";

type Filters = Record<string, string>;

const FIELDS: { key: string; label: string; placeholder?: string }[] = [
  { key: "project", label: "Project / zone", placeholder: "search" },
  { key: "minArea", label: "Area ≥ m²" },
  { key: "maxArea", label: "Area ≤ m²" },
  { key: "maxPrice", label: "Price ≤ $" },
  { key: "maxDownPayment", label: "Down pmt ≤ $" },
  { key: "maxPricePerMeter", label: "$/m² ≤" },
  { key: "minReach", label: "Reach ≥ %" },
  { key: "minScore", label: "Score ≥" },
  { key: "minAi", label: "AI score ≥" },
];

export function LandTable({ cities }: { cities: string[] }) {
  const [filters, setFilters] = useState<Filters>({ sort: "score" });
  const [page, setPage] = useState(0);
  const limit = 50;
  const qs = useMemo(() => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v) p.set(k, v);
    p.set("limit", String(limit));
    p.set("offset", String(page * limit));
    return p.toString();
  }, [filters, page]);
  const { data, isLoading } = useSWR<{ total: number; items: ListedLand[] }>(`/api/lands?${qs}`, fetcher, {
    refreshInterval: 60_000,
    keepPreviousData: true,
  });
  const set = (k: string, v: string) => {
    setPage(0);
    setFilters((f) => ({ ...f, [k]: v }));
  };
  const input = "w-full rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm";

  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">All affordable available plots</h2>
        <span className="text-xs text-muted">{data ? `${fmt(data.total)} match` : isLoading ? "loading…" : ""}</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        <label className="text-xs text-muted">
          City
          <select className={input} value={filters.city ?? ""} onChange={(e) => set("city", e.target.value)}>
            <option value="">All</option>
            {cities.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        {FIELDS.map((f) => (
          <label key={f.key} className="text-xs text-muted">
            {f.label}
            <input
              className={input}
              inputMode={f.key === "project" ? "text" : "decimal"}
              placeholder={f.placeholder}
              value={filters[f.key] ?? ""}
              onChange={(e) => set(f.key, e.target.value)}
            />
          </label>
        ))}
        <label className="text-xs text-muted">
          Reachability
          <select className={input} value={filters.reach ?? ""} onChange={(e) => set("reach", e.target.value)}>
            <option value="">Any</option>
            <option value="REACHABLE">Reachable (≥70%)</option>
            <option value="RISKY">Risky (30–70%)</option>
            <option value="UNLIKELY">Unlikely (&lt;30%)</option>
          </select>
        </label>
        <label className="text-xs text-muted">
          Sort
          <select className={input} value={filters.sort} onChange={(e) => set("sort", e.target.value)}>
            <option value="score">Score</option>
            <option value="reach">Reachability</option>
            <option value="ai">AI score</option>
            <option value="price">Price ↑</option>
            <option value="ppm">$/m² ↑</option>
            <option value="area">Area ↓</option>
          </select>
        </label>
        <div className="col-span-2 flex items-end gap-4 pb-1 text-sm">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={filters.garden === "1"} onChange={(e) => set("garden", e.target.checked ? "1" : "")} /> 🌳 Garden
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={filters.corner === "1"} onChange={(e) => set("corner", e.target.checked ? "1" : "")} /> 📐 Corner
          </label>
        </div>
      </div>

      <div className="mt-3 -mx-4 overflow-x-auto px-4">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="text-left text-xs uppercase tracking-wider text-muted">
            <tr className="border-b border-border">
              <th className="py-2 pe-2">#</th>
              <th className="pe-2">Plot</th>
              <th className="pe-2">Project</th>
              <th className="pe-2">Features</th>
              <th className="pe-2 text-right">Area</th>
              <th className="pe-2 text-right">Price</th>
              <th className="pe-2 text-right">Down pmt</th>
              <th className="pe-2 text-right">$/m²</th>
              <th className="pe-2">Reachability</th>
              <th className="pe-2 text-right">Score</th>
              <th className="pe-2 text-right">AI</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data?.items.map((l, i) => (
              <tr key={l.id} className="border-b border-border/60 hover:bg-surface-2">
                <td className="py-2 pe-2 text-muted">{page * limit + i + 1}</td>
                <td className="pe-2 font-medium">
                  <Link href={`/land/${l.id}`} className="hover:underline">{l.plotNumber}</Link>
                </td>
                <td className="max-w-[220px] pe-2">
                  <div className="truncate" title={l.projectName ?? ""}><bdi>{l.projectName}</bdi></div>
                  <div className="truncate text-xs text-muted"><bdi>{l.cityName}</bdi></div>
                </td>
                <td className="pe-2"><FeatureBadges garden={l.hasGarden} corner={l.hasCorner} sea={l.seaPct > 0} /></td>
                <td className="pe-2 text-right">{fmt(l.area, 1)}</td>
                <td className="pe-2 text-right">{usd(l.totalPrice)}</td>
                <td className="pe-2 text-right">{usd(l.downPayment)}</td>
                <td className="pe-2 text-right">{fmt(l.pricePerMeter)}</td>
                <td className="pe-2"><SurvivalBar {...l.survival} /></td>
                <td className="pe-2 text-right font-semibold">{fmt(l.score)}</td>
                <td className="pe-2 text-right">{l.aiScore == null ? "—" : fmt(l.aiScore)}</td>
                <td><RecBadge rec={l.recommendation} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data && data.total > limit ? (
        <div className="mt-3 flex items-center justify-end gap-2 text-sm">
          <button className="rounded border border-border px-2 py-1 disabled:opacity-40" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            Prev
          </button>
          <span className="text-muted">
            {page + 1} / {Math.ceil(data.total / limit)}
          </span>
          <button
            className="rounded border border-border px-2 py-1 disabled:opacity-40"
            disabled={(page + 1) * limit >= data.total}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      ) : null}
    </Card>
  );
}
