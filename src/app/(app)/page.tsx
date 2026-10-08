import type { Metadata } from "next";
import { Home } from "@/components/home";
import { JsonLd } from "@/components/json-ld";
import { CityLinks, HubLinks } from "@/components/phase-blocks";
import { date, t } from "@/i18n/ar";
import { getCities, getDataDate, getTotals } from "@/lib/build-data";
import { CURRENT_PHASE as phase } from "@/lib/phases";
import { SITE_URL } from "@/lib/site";

export const metadata: Metadata = { alternates: { canonical: "/" } };

export default async function Page() {
  const [cities, totals, at] = await Promise.all([getCities(), getTotals(), getDataDate()]);
  const h = t.seo.home;
  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: t.appName,
          url: SITE_URL,
          inLanguage: "ar-EG",
          description: t.seo.description(phase),
        }}
      />
      <header className="mb-4 space-y-2">
        <h1 className="text-2xl font-bold leading-snug">{h.h1(phase)}</h1>
        <p className="text-sm leading-7 text-muted">
          {h.intro(phase, totals.total, cities.length, totals.booked, totals.available, date(at))}
        </p>
      </header>
      <nav aria-label={h.hubH(phase)} className="mb-5">
        <HubLinks phase={phase} />
      </nav>
      <Home />
      <section className="mt-8 space-y-3">
        <h2 className="text-lg font-bold">{h.citiesH(phase)}</h2>
        <CityLinks phase={phase} cities={cities} />
      </section>
    </>
  );
}
