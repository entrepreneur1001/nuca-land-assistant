"use client";

import Link from "next/link";
import type { Snapshot } from "@/data/snapshot";
import { date, num, pct, t, usd } from "@/i18n/ar";
import { cityBests, citiesOf, dataDateOf, statsOf, type AreaStats, type CityInfo } from "@/lib/area-stats";
import { useLive } from "@/lib/live";
import { phasePath, type Phase } from "@/lib/phases";
import { CityLinks, Faq, RulesList, StatsGrid, cityFaq, ruleSource } from "./phase-blocks";
import { AreaLink, Badge, Card } from "./ui";

/**
 * Live versions of the static phase-page blocks. The server renders them with the build-time numbers (SEO, first
 * paint); in the browser they switch to the live Firestore snapshot and keep updating as the sync job writes.
 */

const s = t.seo;

interface Derived {
  cities: CityInfo[];
  totals: AreaStats;
  at: string | null;
}

// Every live block on a page derives from the same snapshot; compute once per snapshot.
const derived = new WeakMap<Snapshot, Derived>();

function derive(snap: Snapshot): Derived {
  let d = derived.get(snap);
  if (!d) {
    d = { cities: citiesOf(snap), totals: statsOf(snap.plots), at: dataDateOf(snap.meta) };
    derived.set(snap, d);
  }
  return d;
}

function useDerived(): Derived | null {
  const { snapshot } = useLive();
  return snapshot ? derive(snapshot) : null;
}

/**
 * Live cities, limited to those that had a page at build time (the export has no page for a newer city;
 * it appears after the next deploy).
 */
function useCities(initial: CityInfo[]): CityInfo[] {
  const live = useDerived();
  if (!live) return initial;
  const built = new Set(initial.map((c) => c.slug));
  return live.cities.filter((c) => built.has(c.slug));
}

function useCity(initial: CityInfo): CityInfo {
  return useDerived()?.cities.find((c) => c.slug === initial.slug) ?? initial;
}

const useAt = (initial: string | null) => useDerived()?.at ?? initial;

export function LiveAsOf({ initial }: { initial: string | null }) {
  return <>{s.asOf(date(useAt(initial)))}</>;
}

export function LiveTotals({ initial }: { initial: AreaStats }) {
  return <StatsGrid stats={useDerived()?.totals ?? initial} />;
}

export function LiveCityLinks({ phase, initial, exclude }: { phase: Phase; initial: CityInfo[]; exclude?: string }) {
  const cities = useCities(initial);
  return <CityLinks phase={phase} cities={exclude ? cities.filter((c) => c.slug !== exclude) : cities} />;
}

export function LiveHomeIntro({ phase, initial }: { phase: Phase; initial: { cities: CityInfo[]; totals: AreaStats; at: string | null } }) {
  const live = useDerived();
  const cities = useCities(initial.cities);
  const totals = live?.totals ?? initial.totals;
  return <>{s.home.intro(phase, totals.total, cities.length, totals.booked, totals.available, date(live?.at ?? initial.at))}</>;
}

export function LiveAvailableTable({ phase, initial }: { phase: Phase; initial: CityInfo[] }) {
  const cities = useCities(initial);
  const a = s.available;
  const th = "px-3 py-2 text-start font-medium";
  const td = "px-3 py-2";
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
      <table className="w-full min-w-[36rem] text-sm">
        <thead className="bg-surface-2 text-xs text-muted">
          <tr>
            <th scope="col" className={th}>{a.city}</th>
            <th scope="col" className={th}>{s.stat.total}</th>
            <th scope="col" className={th}>{s.stat.available}</th>
            <th scope="col" className={th}>{s.stat.booked}</th>
            <th scope="col" className={th}>{a.pctBooked}</th>
            <th scope="col" className={th}>{s.stat.ppm}</th>
            <th scope="col" className={th}>{s.stat.minDp}</th>
          </tr>
        </thead>
        <tbody>
          {cities.map((c) => (
            <tr key={c.slug} className="border-t border-border">
              <th scope="row" className={`${td} text-start font-semibold`}>
                <Link href={phasePath.city(phase, c.slug)} className="text-accent hover:underline">{c.name}</Link>
              </th>
              <td className={td}>{num(c.stats.total)}</td>
              <td className={`${td} font-semibold ${c.stats.available ? "text-good" : "text-bad"}`}>
                {c.stats.available ? num(c.stats.available) : a.soldOut}
              </td>
              <td className={td}>{num(c.stats.booked)}</td>
              <td className={td}>{pct(c.stats.total ? c.stats.booked / c.stats.total : null)}</td>
              <td className={td}>
                {c.stats.ppmMax != null && c.stats.ppmMax !== c.stats.ppmMin ? s.stat.range(usd(c.stats.ppmMin), usd(c.stats.ppmMax)) : usd(c.stats.ppmMin)}
              </td>
              <td className={td}>{c.stats.available ? usd(c.stats.dpMin) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function LiveCityIntro({ phase, initial }: { phase: Phase; initial: CityInfo }) {
  const city = useCity(initial);
  return <>{s.city.intro(phase, city.name, city.stats.total, city.stats.available, city.districts.length)}</>;
}

export function LiveCityStats({ initial }: { initial: CityInfo }) {
  return <StatsGrid stats={useCity(initial).stats} />;
}

export function LiveCityFaq({ phase, initial, initialAt }: { phase: Phase; initial: CityInfo; initialAt: string | null }) {
  return <Faq items={cityFaq(phase, useCity(initial), date(useAt(initialAt)))} />;
}

export function LiveDistricts({ initial }: { initial: CityInfo }) {
  const city = useCity(initial);
  const best = cityBests(city.districts);
  return city.districts.map((d) => {
    const st = d.stats;
    const src = ruleSource(d.rules);
    return (
      <Card key={d.id} className="space-y-3">
        <h3 className="flex flex-wrap items-center gap-2 text-lg font-bold">
          <AreaLink city={d.city} district={d.id}>{d.name}</AreaLink>
          {d.hot ? <Badge tone="warn">{s.hot}</Badge> : null}
          {best.cheapest === d.id ? <Badge tone="good">{s.cheapest}</Badge> : null}
          {best.lowestDp === d.id ? <Badge tone="good">{s.lowestDp}</Badge> : null}
        </h3>
        <p className="text-sm leading-7 text-muted">
          {s.stat.available}: <b className="text-text">{num(st.available)}</b> / {num(st.total)} ·{" "}
          {s.stat.ppm}: <b className="text-text">{st.ppmMax != null && st.ppmMax !== st.ppmMin ? s.stat.range(usd(st.ppmMin), usd(st.ppmMax)) : usd(st.ppmMin)}</b>
          {st.areaMin != null && st.areaMax != null ? <> · {s.stat.area}: {s.stat.areaRange(st.areaMin, st.areaMax)}</> : null}
          {st.dpMin != null ? <> · {s.stat.minDp}: {usd(st.dpMin)}</> : null}
        </p>
        <div>
          <h4 className="mb-2 text-sm font-semibold">
            {t.rules.title}
            {src ? <span className="font-normal text-muted"> ({src})</span> : null}
          </h4>
          <RulesList rules={d.rules} />
        </div>
        {d.center ? (
          <a
            className="inline-block text-sm text-accent hover:underline"
            href={`https://www.google.com/maps/search/?api=1&query=${d.center.lat.toFixed(5)},${d.center.lng.toFixed(5)}`}
            target="_blank"
            rel="noreferrer"
          >
            📍 {s.city.map} ↗
          </a>
        ) : null}
      </Card>
    );
  });
}

export function LiveRulesByCity({ phase, initial }: { phase: Phase; initial: CityInfo[] }) {
  const cities = useCities(initial);
  const r = s.rulesPage;
  const th = "px-3 py-2 text-start font-medium";
  const td = "px-3 py-2 align-top";
  return cities.map((c) => (
    <div key={c.slug} className="space-y-2">
      <h3 className="text-lg font-bold">
        <AreaLink city={c.name}>{c.name}</AreaLink>
        <Link href={phasePath.city(phase, c.slug)} className="ms-3 text-sm font-normal text-muted hover:text-accent hover:underline">
          {s.rulesPage.cityPage}
        </Link>
      </h3>
      <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
        <table className="w-full min-w-[34rem] text-sm">
          <thead className="bg-surface-2 text-xs text-muted">
            <tr>
              <th scope="col" className={th}>{r.area}</th>
              <th scope="col" className={th}>{t.rules.ratio}</th>
              <th scope="col" className={th}>{t.rules.floors}</th>
              <th scope="col" className={th}>{t.rules.setbacks}</th>
            </tr>
          </thead>
          <tbody>
            {c.districts.map((d) => {
              const src = ruleSource(d.rules);
              return (
                <tr key={d.id} className="border-t border-border">
                  <th scope="row" className={`${td} text-start font-semibold`}>
                    <AreaLink city={c.name} district={d.id}>{d.name}</AreaLink>
                    {src ? <div className="text-xs font-normal text-muted">{src}</div> : null}
                  </th>
                  <td className={td}>{d.rules?.ratio ?? "—"}</td>
                  <td className={td}>{d.rules?.floors ?? "—"}</td>
                  <td className={td}>{d.rules?.setbacks ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  ));
}
