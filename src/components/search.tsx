"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { DEFAULT_WEIGHTS } from "@/engine/config";
import type { RankedLand } from "@/engine/compute";
import { FACTOR, km, num, t, usd } from "@/i18n/ar";
import { track } from "@/lib/firebase";
import { useApp } from "./app-state";
import { Card, FeatureBadges, RecBadge, SurvivalBar } from "./ui";

type Sort = keyof typeof t.search.sorts;
const PAGE = 30;

const parseNum = (s: string) => {
  const n = Number(s.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[^\d.]/g, ""));
  return s.trim() === "" || !Number.isFinite(n) ? null : n;
};

export function AdvancedSearch({ ranked, cities }: { ranked: RankedLand[]; cities: string[] }) {
  const app = useApp()!;
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ city: "", project: "", minArea: "", maxArea: "", maxDp: "", minReach: "", garden: false, corner: false, street: false, near: false, units: false });
  const [sort, setSort] = useState<Sort>("score");
  const [page, setPage] = useState(0);

  const rows = useMemo(() => {
    const minArea = parseNum(f.minArea);
    const maxArea = parseNum(f.maxArea);
    const maxDp = parseNum(f.maxDp);
    const minReach = parseNum(f.minReach);
    const out = ranked.filter(
      (r) =>
        (!f.city || r.cityName === f.city) &&
        (!f.project || `${r.projectName ?? ""} ${r.zoneName ?? ""}`.includes(f.project.trim())) &&
        (minArea == null || r.area >= minArea) &&
        (maxArea == null || r.area <= maxArea) &&
        (maxDp == null || r.downPayment <= maxDp) &&
        (minReach == null || r.survival.mid * 100 >= minReach) &&
        (!f.garden || r.hasGarden) &&
        (!f.corner || r.hasCorner) &&
        (!f.street || r.hasStreet) &&
        (!f.near || r.isNearBuilt) &&
        (!f.units || r.unitsPerFloor >= 3),
    );
    const by: Record<Sort, (a: RankedLand, b: RankedLand) => number> = {
      score: () => 0,
      reach: (a, b) => b.survival.mid - a.survival.mid,
      nearBuilt: (a, b) => (a.builtKm ?? 99) - (b.builtKm ?? 99),
      price: (a, b) => a.totalPrice - b.totalPrice,
      area: (a, b) => b.area - a.area,
    };
    return sort === "score" ? out : [...out].sort(by[sort]);
  }, [ranked, f, sort]);

  useEffect(() => {
    if (!open) return;
    const h = setTimeout(() => void track("search", { results: rows.length, city: f.city || "all" }), 1500);
    return () => clearTimeout(h);
  }, [open, rows.length, f.city]);

  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => {
    setPage(0);
    setF((x) => ({ ...x, [k]: v }));
  };
  const input = "mt-1 w-full rounded-xl border border-border bg-surface-2 px-2 py-1.5 text-sm text-text";
  const weights = { ...DEFAULT_WEIGHTS, ...(app.profile.weights ?? {}) } as Record<string, number>;

  return (
    <Card>
      <button type="button" className="flex w-full items-center justify-between" onClick={() => setOpen((o) => !o)}>
        <h2 className="text-lg font-bold">🔎 {t.search.title}</h2>
        <span className="text-sm text-muted">{open ? "▲" : "▼"} {t.search.results(ranked.length)}</span>
      </button>
      {open ? (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            <label className="text-xs text-muted">
              {t.search.city}
              <select className={input} value={f.city} onChange={(e) => set("city", e.target.value)}>
                <option value="">{t.search.all}</option>
                {cities.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-muted">
              {t.search.project}
              <input className={input} value={f.project} onChange={(e) => set("project", e.target.value)} />
            </label>
            {(
              [
                ["minArea", t.search.minArea],
                ["maxArea", t.search.maxArea],
                ["maxDp", t.search.maxDp],
                ["minReach", t.search.minReach],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="text-xs text-muted">
                {label}
                <input className={input} inputMode="numeric" dir="ltr" value={f[k]} onChange={(e) => set(k, e.target.value)} />
              </label>
            ))}
            <label className="text-xs text-muted">
              {t.search.sort}
              <select className={input} value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                {(Object.keys(t.search.sorts) as Sort[]).map((k) => (
                  <option key={k} value={k}>{t.search.sorts[k]}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-2 flex flex-wrap gap-4 text-sm">
            {(
              [
                ["garden", `🌳 ${t.search.garden}`],
                ["corner", `📐 ${t.search.corner}`],
                ["street", `🛣️ ${t.search.street}`],
                ["near", `🏘️ ${t.search.nearBuilt}`],
                ["units", `🏢 ${t.search.units}`],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="flex items-center gap-1.5">
                <input type="checkbox" checked={f[k]} onChange={(e) => set(k, e.target.checked)} /> {label}
              </label>
            ))}
            <span className="ms-auto text-muted">{t.search.results(rows.length)}</span>
          </div>

          <ul className="mt-3 divide-y divide-border">
            {rows.slice(page * PAGE, (page + 1) * PAGE).map((l) => (
              <li key={l.id}>
                <Link href={`/land?id=${l.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 hover:bg-surface-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">
                      {t.card.plot} {l.plotNumber} · <span className="font-normal">{l.projectName}</span>
                    </div>
                    <div className="text-xs text-muted">
                      {l.cityName} · {num(l.area)} {t.card.m2} · {t.card.dp} {usd(l.downPayment)} · 🏘️ {km(l.builtKm)}
                    </div>
                  </div>
                  <FeatureBadges garden={l.hasGarden} corner={l.hasCorner} street={l.hasStreet} nearBuilt={l.isNearBuilt} units={l.unitsPerFloor} />
                  <SurvivalBar {...l.survival} />
                  <span className="w-8 text-center font-bold">{num(l.score)}</span>
                  <RecBadge rec={l.recommendation} />
                </Link>
              </li>
            ))}
            {!rows.length ? <li className="py-6 text-center text-muted">{t.search.empty}</li> : null}
          </ul>
          {rows.length > PAGE ? (
            <div className="mt-3 flex items-center justify-center gap-3 text-sm">
              <button type="button" className="rounded-lg border border-border px-3 py-1 disabled:opacity-40" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                {t.search.prev}
              </button>
              <span className="text-muted">
                {num(page + 1)} / {num(Math.ceil(rows.length / PAGE))}
              </span>
              <button
                type="button"
                className="rounded-lg border border-border px-3 py-1 disabled:opacity-40"
                disabled={(page + 1) * PAGE >= rows.length}
                onClick={() => setPage((p) => p + 1)}
              >
                {t.search.next}
              </button>
            </div>
          ) : null}

          <details className="mt-4 rounded-xl bg-surface-2 p-3">
            <summary className="cursor-pointer text-sm font-semibold">{t.search.weights}</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {Object.keys(DEFAULT_WEIGHTS).map((k) => (
                <label key={k} className="flex items-center gap-3 text-sm">
                  <span className="w-40 text-muted">{FACTOR[k] ?? k}</span>
                  <input
                    type="range"
                    min={0}
                    max={50}
                    value={weights[k] ?? 0}
                    onChange={(e) => app.setProfile({ ...app.profile, weights: { ...weights, [k]: Number(e.target.value) } })}
                    className="flex-1"
                  />
                  <span className="w-8 text-center">{num(weights[k])}</span>
                </label>
              ))}
            </div>
            <button type="button" className="mt-3 text-xs text-accent" onClick={() => app.setProfile({ ...app.profile, weights: { ...DEFAULT_WEIGHTS } })}>
              {t.search.weightsReset}
            </button>
          </details>
        </>
      ) : null}
    </Card>
  );
}
