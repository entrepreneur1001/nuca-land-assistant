import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JsonLd, faqPage } from "@/components/json-ld";
import { Breadcrumbs, CityLinks, Cta, DataNote, Faq, HubLinks, RulesList, StatsGrid, ruleSource } from "@/components/phase-blocks";
import { Badge, Card } from "@/components/ui";
import { date, num, t, usd } from "@/i18n/ar";
import { getCities, getDataDate, type CityInfo } from "@/lib/build-data";
import { PHASES, getPhase, phasePath, type Phase } from "@/lib/phases";
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

function faqFor(phase: Phase, city: CityInfo, at: string) {
  const f = s.faq;
  const st = city.stats;
  const items = [{ q: f.availQ(phase, city.name), a: f.availA(st.available, st.total, at) }];
  if (st.ppmMin != null) items.unshift({ q: f.ppmQ(phase, city.name), a: f.ppmA(city.name, usd(st.ppmMin), usd(st.ppmMax)) });
  if (st.dpMin != null && st.available) items.push({ q: f.dpQ(city.name), a: f.dpA(usd(st.dpMin), usd(st.totalMin)) });
  return items;
}

export default async function Page({ params }: PageProps<"/[phase]/[city]">) {
  const r = await load(params);
  if (!r) notFound();
  const { phase, city } = r;
  const [cities, at] = await Promise.all([getCities(), getDataDate()]);
  const faq = faqFor(phase, city, date(at));

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
        <p className="text-sm leading-7 text-muted">{s.city.intro(phase, city.name, city.stats.total, city.stats.available, city.districts.length)}</p>
      </header>
      <StatsGrid stats={city.stats} />
      <Cta />

      <section className="space-y-3">
        <h2 className="text-xl font-bold">{s.city.areasH(city.name)}</h2>
        {city.districts.map((d) => {
          const st = d.stats;
          const src = ruleSource(d.rules);
          return (
            <Card key={d.id} className="space-y-3">
              <h3 className="flex flex-wrap items-center gap-2 text-lg font-bold">
                {d.name}
                {d.hot ? <Badge tone="warn">{s.hot}</Badge> : null}
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
        })}
      </section>

      <Faq items={faq} />
      <section className="space-y-3">
        <h2 className="text-lg font-bold">{s.home.hubH(phase)}</h2>
        <HubLinks phase={phase} />
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-bold">{s.city.otherCities}</h2>
        <CityLinks phase={phase} cities={cities.filter((c) => c.slug !== city.slug)} />
      </section>
      <DataNote phase={phase} at={at} />
    </article>
  );
}
