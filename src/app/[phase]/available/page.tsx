import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Breadcrumbs, Cta, DataNote, HubLinks, StatsGrid } from "@/components/phase-blocks";
import { num, pct, t, usd } from "@/i18n/ar";
import { getCities, getDataDate, getTotals } from "@/lib/build-data";
import { PHASES, getPhase, phasePath } from "@/lib/phases";
import { OG_BASE } from "@/lib/site";

const s = t.seo;

export const dynamicParams = false;

export function generateStaticParams() {
  return PHASES.map((p) => ({ phase: p.slug }));
}

export async function generateMetadata({ params }: PageProps<"/[phase]/available">): Promise<Metadata> {
  const phase = getPhase((await params).phase);
  if (!phase) return {};
  const totals = await getTotals();
  const title = s.available.title(phase);
  const description = s.available.description(phase, totals.available, totals.booked);
  const url = phasePath.available(phase);
  return { title: { absolute: title }, description, alternates: { canonical: url }, openGraph: { ...OG_BASE, title, description, url } };
}

export default async function Page({ params }: PageProps<"/[phase]/available">) {
  const phase = getPhase((await params).phase);
  if (!phase) notFound();
  const [cities, totals, at] = await Promise.all([getCities(), getTotals(), getDataDate()]);
  const a = s.available;
  const th = "px-3 py-2 text-start font-medium";
  const td = "px-3 py-2";

  return (
    <article className="space-y-6">
      <Breadcrumbs items={[{ name: s.hub.available, href: phasePath.available(phase) }]} />
      <header className="space-y-2">
        <h1 className="text-2xl font-bold leading-snug">{a.h1(phase)}</h1>
        <p className="text-sm leading-7 text-muted">{a.intro(phase)}</p>
      </header>
      <StatsGrid stats={totals} />

      <section className="space-y-3">
        <h2 className="text-xl font-bold">{a.tableH}</h2>
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
      </section>

      <Cta />
      <section className="space-y-3">
        <h2 className="text-lg font-bold">{s.home.hubH(phase)}</h2>
        <HubLinks phase={phase} exclude="available" />
      </section>
      <DataNote phase={phase} at={at} />
    </article>
  );
}
