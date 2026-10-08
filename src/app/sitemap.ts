import type { MetadataRoute } from "next";
import { getCities, getDataDate } from "@/lib/build-data";
import { PHASES, phasePath } from "@/lib/phases";
import { SITE_URL } from "@/lib/site";

export const dynamic = "force-static";

/** Every indexable URL. /land (one client shell for all plots) is noindex and left out. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [cities, at] = await Promise.all([getCities(), getDataDate()]);
  const lastModified = at ? new Date(at) : new Date();
  const page = (path: string, priority: number, changeFrequency: "daily" | "monthly" = "daily") => ({
    url: `${SITE_URL}${path}`,
    lastModified,
    changeFrequency,
    priority,
  });
  return [
    page("", 1),
    page("/market", 0.7),
    ...PHASES.flatMap((p) => [
      page(phasePath.available(p), 0.9),
      page(phasePath.guide(p), 0.9, "monthly"),
      page(phasePath.rules(p), 0.8, "monthly"),
      ...cities.map((c) => page(phasePath.city(p, c.slug), 0.8)),
    ]),
  ];
}
