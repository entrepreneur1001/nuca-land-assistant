import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JsonLd, faqPage } from "@/components/json-ld";
import { LiveAsOf, LiveCityFaq, LiveCityIntro, LiveCityLinks, LiveCityStats, LiveDistricts } from "@/components/live-blocks";
import { Breadcrumbs, Cta, DataNote, HubLinks, cityFaq } from "@/components/phase-blocks";
import { date, t, usd } from "@/i18n/ar";
import { getCities, getDataDate } from "@/lib/build-data";
import { PHASES, getPhase, phasePath } from "@/lib/phases";
import { OG_BASE } from "@/lib/site";

const s = t.seo;

export const dynamicParams = false;

export async function generateStaticParams() {
  const cities = await getCities();
  return PHASES.flatMap((p) => cities.map((c) => ({ phase: p.slug, city: c.slug })));
}

async function load(params: PageProps<"/[phase]/[city]">["params"]) {
  const { phase: ps, city: cs } = await params;
  const phase = getPhase(ps);
  const city = (await getCities()).find((c) => c.slug === cs);
  return phase && city ? { phase, city } : null;
}

export async function generateMetadata({ params }: PageProps<"/[phase]/[city]">): Promise<Metadata> {
  const r = await load(params);
  if (!r) return {};
  const { phase, city } = r;
  const title = s.city.title(phase, city.name);
  const description = s.city.description(phase, city.name, city.stats.available, usd(city.stats.ppmMin), city.districts.length);
  const url = phasePath.city(phase, city.slug);
  return { title: { absolute: title }, description, alternates: { canonical: url }, openGraph: { ...OG_BASE, title, description, url } };
}

export default async function Page({ params }: PageProps<"/[phase]/[city]">) {
  const r = await load(params);
  if (!r) notFound();
  const { phase, city } = r;
  const [cities, at] = await Promise.all([getCities(), getDataDate()]);
  const faq = cityFaq(phase, city, date(at));

  return (
    <article className="space-y-6">
      <JsonLd data={faqPage(faq)} />
      <Breadcrumbs
        items={[
          { name: s.hub.available, href: phasePath.available(phase) },
          { name: city.name, href: phasePath.city(phase, city.slug) },
        ]}
      />
      <header className="space-y-2">
        <h1 className="text-2xl font-bold leading-snug">{s.city.h1(phase, city.name)}</h1>
        <p className="text-sm leading-7 text-muted">
          <LiveCityIntro phase={phase} initial={city} />
        </p>
      </header>
      <LiveCityStats initial={city} />
      <Cta />

      <section className="space-y-3">
        <h2 className="text-xl font-bold">{s.city.areasH(city.name)}</h2>
        <LiveDistricts initial={city} />
      </section>

      <LiveCityFaq phase={phase} initial={city} initialAt={at} />
      <section className="space-y-3">
        <h2 className="text-lg font-bold">{s.home.hubH(phase)}</h2>
        <HubLinks phase={phase} />
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-bold">{s.city.otherCities}</h2>
        <LiveCityLinks phase={phase} initial={cities} exclude={city.slug} />
      </section>
      <DataNote phase={phase} asOf={<LiveAsOf initial={at} />} />
    </article>
  );
}
