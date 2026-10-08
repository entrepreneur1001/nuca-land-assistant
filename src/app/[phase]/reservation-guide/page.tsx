import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JsonLd, faqPage } from "@/components/json-ld";
import { Breadcrumbs, Cta, Faq, HubLinks } from "@/components/phase-blocks";
import { PHASE_CONTENT } from "@/content";
import { t } from "@/i18n/ar";
import { OFFICIAL, PHASES, getPhase, phasePath, type Phase } from "@/lib/phases";
import { OG_BASE } from "@/lib/site";

const s = t.seo;

export const dynamicParams = false;

export function generateStaticParams() {
  return PHASES.map((p) => ({ phase: p.slug }));
}

export async function generateMetadata({ params }: PageProps<"/[phase]/reservation-guide">): Promise<Metadata> {
  const phase = getPhase((await params).phase);
  if (!phase) return {};
  const title = s.guidePage.title(phase);
  const description = s.guidePage.description(phase);
  const url = phasePath.guide(phase);
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: url },
    openGraph: { ...OG_BASE, type: "article", title, description, url },
  };
}

const faqFor = (p: Phase) => {
  const f = s.faq;
  return [
    { q: f.whoQ(p), a: f.whoA },
    { q: f.downQ(p), a: f.downA },
    { q: f.installQ(p), a: f.installA },
    { q: f.buildQ, a: f.buildA },
  ];
};

export default async function Page({ params }: PageProps<"/[phase]/reservation-guide">) {
  const phase = getPhase((await params).phase);
  const content = phase && PHASE_CONTENT[phase.slug];
  if (!phase || !content) notFound();
  const { GUIDE, CONTACT_EMAIL } = content;
  const g = s.guidePage;
  const faq = faqFor(phase);

  return (
    <article className="space-y-6">
      <JsonLd data={faqPage(faq)} />
      <Breadcrumbs items={[{ name: s.hub.guide, href: phasePath.guide(phase) }]} />
      <header className="space-y-2">
        <h1 className="text-2xl font-bold leading-snug">{g.h1(phase)}</h1>
        <p className="text-sm leading-7 text-muted">{g.intro(phase, phase.bookletDate)}</p>
        <p className="rounded-xl bg-warn-soft px-3 py-2 text-xs text-warn">{t.disclaimer.short}</p>
      </header>

      <nav aria-labelledby="toc" className="rounded-2xl border border-border bg-surface p-4">
        <h2 id="toc" className="mb-2 text-sm font-semibold">{g.tocH}</h2>
        <ol className="list-decimal space-y-1 ps-5 text-sm">
          {GUIDE.map((sec) => (
            <li key={sec.id}>
              <a href={`#${sec.id}`} className="text-accent hover:underline">{sec.title}</a>
            </li>
          ))}
        </ol>
      </nav>

      {GUIDE.map((sec) => (
        <section key={sec.id} id={sec.id} className="scroll-mt-20 space-y-2 rounded-2xl border border-border bg-surface p-4">
          <h2 className="text-lg font-bold">{sec.title}</h2>
          <ul className="list-disc space-y-1.5 ps-5 text-sm leading-7">
            {sec.points.map((pt) => (
              <li key={pt}>{pt}</li>
            ))}
          </ul>
          <p className="text-xs text-muted">
            <a href={phase.bookletUrl} target="_blank" rel="noreferrer" className="hover:underline">{g.page(sec.pages)} ↗</a>
          </p>
        </section>
      ))}

      <section className="space-y-2 rounded-2xl bg-surface-2 p-4 text-sm leading-7">
        <h2 className="text-lg font-bold">{g.contactH}</h2>
        <p>
          {g.contact} <a className="text-accent hover:underline" href={`mailto:${CONTACT_EMAIL}`} dir="ltr">{CONTACT_EMAIL}</a>
        </p>
        <p>{g.bankNote}</p>
        <p>
          <a className="text-accent hover:underline" href={OFFICIAL.portal} target="_blank" rel="noreferrer">{s.official} ↗</a>
          {" · "}
          <a className="text-accent hover:underline" href={phase.bookletUrl} target="_blank" rel="noreferrer">{s.booklet(phase)} ↗</a>
        </p>
      </section>

      <Faq items={faq} />
      <Cta />
      <section className="space-y-3">
        <h2 className="text-lg font-bold">{s.home.hubH(phase)}</h2>
        <HubLinks phase={phase} exclude="guide" />
      </section>
    </article>
  );
}
