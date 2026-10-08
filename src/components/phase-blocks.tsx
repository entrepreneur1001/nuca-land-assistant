import Link from "next/link";
import type { BuildingRules } from "@/data/snapshot";
import { date, num, t, usd } from "@/i18n/ar";
import type { AreaStats, CityInfo } from "@/lib/build-data";
import { OFFICIAL, phasePath, type Phase } from "@/lib/phases";
import { SITE_URL } from "@/lib/site";
import { JsonLd, breadcrumbs } from "./json-ld";
import { Card, Stat } from "./ui";

/** Server-rendered building blocks for the static phase pages (/[phase]/…). */

const s = t.seo;

export function Breadcrumbs({ items }: { items: { name: string; href: string }[] }) {
  const all = [{ name: s.crumbs.home, href: "/" }, ...items];
  return (
    <>
      <JsonLd data={breadcrumbs(all.map((i) => ({ name: i.name, url: `${SITE_URL}${i.href === "/" ? "" : i.href}` })))} />
      <nav aria-label="breadcrumb" className="text-xs text-muted">
        <ol className="flex flex-wrap gap-1">
          {all.map((i, n) => (
            <li key={i.href} className="flex gap-1">
              {n > 0 ? <span aria-hidden>‹</span> : null}
              {n < all.length - 1 ? (
                <Link href={i.href} className="hover:text-text hover:underline">{i.name}</Link>
              ) : (
                <span aria-current="page" className="text-text">{i.name}</span>
              )}
            </li>
          ))}
        </ol>
      </nav>
    </>
  );
}

export function StatsGrid({ stats }: { stats: AreaStats }) {
  const st = s.stat;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat label={st.available} value={num(stats.available)} sub={`${st.total}: ${num(stats.total)} · ${st.booked}: ${num(stats.booked)}`} tone={stats.available ? "good" : "bad"} />
      <Stat label={st.ppm} value={usd(stats.ppmMin)} sub={stats.ppmMax != null && stats.ppmMax !== stats.ppmMin ? st.range(usd(stats.ppmMin), usd(stats.ppmMax)) : undefined} />
      <Stat label={st.minDp} value={usd(stats.dpMin)} sub={`${st.minTotal}: ${usd(stats.totalMin)}`} />
      <Stat
        label={st.area}
        value={stats.areaMin != null && stats.areaMax != null ? st.areaRange(stats.areaMin, stats.areaMax) : "—"}
        sub={`${st.garden}: ${num(stats.garden)} · ${st.corner}: ${num(stats.corner)}`}
      />
    </div>
  );
}

/** نسبة البناء / الارتفاع / الردود, labelled with where the values came from. */
export function RulesList({ rules }: { rules: BuildingRules | null }) {
  const rows: [string, string | null][] = [
    [t.rules.ratio, rules?.ratio ?? null],
    [t.rules.floors, rules?.floors ?? null],
    [t.rules.setbacks, rules?.setbacks ?? null],
  ];
  if (!rows.some(([, v]) => v)) return <p className="text-sm text-muted">{s.noRules}</p>;
  return (
    <dl className="grid gap-2 text-sm sm:grid-cols-3">
      {rows.map(([k, v]) => (
        <div key={k} className="rounded-xl bg-surface-2 px-3 py-2">
          <dt className="text-xs text-muted">{k}</dt>
          <dd className="font-semibold">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export const ruleSource = (rules: BuildingRules | null) =>
  rules?.from === "booklet" ? s.ruleSource.booklet : rules ? s.ruleSource.source : null;

export function Cta() {
  return (
    <Card className="flex flex-col gap-3 border-accent/40 sm:flex-row sm:items-center">
      <p className="flex-1 text-sm text-muted">{s.ctaSub}</p>
      <Link href="/" className="rounded-xl bg-accent px-4 py-2 text-center text-sm font-semibold text-white">
        {s.cta}
      </Link>
    </Card>
  );
}

export function Faq({ items }: { items: { q: string; a: string }[] }) {
  return (
    <Card>
      <h2 className="mb-3 text-lg font-bold">{s.faqH}</h2>
      <div className="space-y-4 text-sm leading-7">
        {items.map(({ q, a }) => (
          <div key={q}>
            <h3 className="font-semibold">{q}</h3>
            <p className="text-muted">{a}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** Where the numbers come from, how fresh they are, and what is computed vs published. */
export function DataNote({ phase, at, calc = true }: { phase: Phase; at: string | null; calc?: boolean }) {
  return (
    <section className="space-y-1 rounded-2xl bg-surface-2 px-4 py-3 text-xs leading-6 text-muted">
      <h2 className="text-sm font-semibold text-text">{s.sourceH}</h2>
      <p>{s.asOf(date(at))}</p>
      {calc ? <p>{s.calcNote}</p> : null}
      <p>
        {s.officialNote}{" "}
        <a className="text-accent hover:underline" href={OFFICIAL.portal} target="_blank" rel="noreferrer">{s.official} ↗</a>
        {" · "}
        <a className="text-accent hover:underline" href={phase.bookletUrl} target="_blank" rel="noreferrer">{s.booklet(phase)} ↗</a>
      </p>
    </section>
  );
}

/** Links between the phase pages (internal linking hub). */
export function HubLinks({ phase, exclude }: { phase: Phase; exclude?: "available" | "rules" | "guide" }) {
  const h = s.hub;
  const items = [
    { key: "available", href: phasePath.available(phase), title: h.available, sub: h.availableSub },
    { key: "rules", href: phasePath.rules(phase), title: h.rules, sub: h.rulesSub },
    { key: "guide", href: phasePath.guide(phase), title: h.guide, sub: h.guideSub },
    { key: "market", href: "/market", title: h.market, sub: h.marketSub },
  ].filter((i) => i.key !== exclude);
  return (
    <ul className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      {items.map((i) => (
        <li key={i.key}>
          <Link href={i.href} className="block h-full rounded-xl border border-border bg-surface px-3 py-2 hover:border-accent">
            <div className="text-sm font-semibold">{i.title}</div>
            <div className="text-xs text-muted">{i.sub}</div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function CityLinks({ phase, cities }: { phase: Phase; cities: CityInfo[] }) {
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      {cities.map((c) => (
        <li key={c.slug}>
          <Link href={phasePath.city(phase, c.slug)} className="block rounded-xl border border-border bg-surface px-3 py-2 text-sm hover:border-accent">
            <div className="font-semibold">{c.name}</div>
            <div className="text-xs text-muted">
              {s.stat.available}: {num(c.stats.available)} · {usd(c.stats.ppmMin)}/م²
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
