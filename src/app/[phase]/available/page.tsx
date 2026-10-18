import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LiveAsOf, LiveAvailableTable, LiveTotals } from "@/components/live-blocks";
import { Breadcrumbs, Cta, DataNote, HubLinks } from "@/components/phase-blocks";
import { t } from "@/i18n/ar";
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

  return (
    <article className="space-y-6">
      <Breadcrumbs items={[{ name: s.hub.available, href: phasePath.available(phase) }]} />
      <header className="space-y-2">
        <h1 className="text-2xl font-bold leading-snug">{a.h1(phase)}</h1>
        <p className="text-sm leading-7 text-muted">{a.intro(phase)}</p>
      </header>
      <LiveTotals initial={totals} />

      <section className="space-y-3">
        <h2 className="text-xl font-bold">{a.tableH}</h2>
        <LiveAvailableTable phase={phase} initial={cities} />
      </section>

      <Cta />
      <section className="space-y-3">
        <h2 className="text-lg font-bold">{s.home.hubH(phase)}</h2>
        <HubLinks phase={phase} exclude="available" />
      </section>
      <DataNote phase={phase} asOf={<LiveAsOf initial={at} />} />
    </article>
  );
}
