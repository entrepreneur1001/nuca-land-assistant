import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LiveAsOf, LiveRulesByCity } from "@/components/live-blocks";
import { Breadcrumbs, Cta, DataNote, HubLinks } from "@/components/phase-blocks";
import { t } from "@/i18n/ar";
import { PHASE_CONTENT } from "@/content";
import { getCities, getDataDate } from "@/lib/build-data";
import { PHASES, getPhase, phasePath } from "@/lib/phases";
import { OG_BASE } from "@/lib/site";

const s = t.seo;

export const dynamicParams = false;

export function generateStaticParams() {
  return PHASES.map((p) => ({ phase: p.slug }));
}

export async function generateMetadata({ params }: PageProps<"/[phase]/building-requirements">): Promise<Metadata> {
  const phase = getPhase((await params).phase);
  if (!phase) return {};
  const title = s.rulesPage.title(phase);
  const description = s.rulesPage.description(phase);
  const url = phasePath.rules(phase);
  return { title: { absolute: title }, description, alternates: { canonical: url }, openGraph: { ...OG_BASE, title, description, url } };
}

export default async function Page({ params }: PageProps<"/[phase]/building-requirements">) {
  const phase = getPhase((await params).phase);
  const content = phase && PHASE_CONTENT[phase.slug];
  if (!phase || !content) notFound();
  const { RULES_NOTES } = content;
  const [cities, at] = await Promise.all([getCities(), getDataDate()]);
  const r = s.rulesPage;

  return (
    <article className="space-y-6">
      <Breadcrumbs items={[{ name: s.hub.rules, href: phasePath.rules(phase) }]} />
      <header className="space-y-2">
        <h1 className="text-2xl font-bold leading-snug">{r.h1(phase)}</h1>
        <p className="text-sm leading-7 text-muted">{r.intro(phase)}</p>
      </header>

      <section className="space-y-4">
        <h2 className="text-xl font-bold">{r.byCityH}</h2>
        <LiveRulesByCity phase={phase} initial={cities} />
      </section>

      <section className="space-y-2 rounded-2xl border border-border bg-surface p-4">
        <h2 className="text-lg font-bold">{r.notesH}</h2>
        <ul className="list-disc space-y-1 ps-5 text-sm leading-7">
          {RULES_NOTES.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
        <p className="text-xs text-muted">{s.guidePage.page("٤–٦")}</p>
      </section>

      <Cta />
      <section className="space-y-3">
        <h2 className="text-lg font-bold">{s.home.hubH(phase)}</h2>
        <HubLinks phase={phase} exclude="rules" />
      </section>
      <DataNote phase={phase} asOf={<LiveAsOf initial={at} />} calc={false} />
    </article>
  );
}
