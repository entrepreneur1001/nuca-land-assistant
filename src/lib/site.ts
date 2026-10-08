/** Public origin of the site; used for canonical URLs, the sitemap and Open Graph tags. */
export const SITE_URL = "https://nuca-lands-assistant.web.app";

/** Open Graph fields every page shares; a page's own `openGraph` replaces the layout's wholesale, so spread this in. */
export const OG_IMAGE = { url: "/og.png", width: 1200, height: 630, alt: "بيت الوطن المرحلة 11 — مساعد أراضي بيت الوطن" };

export const OG_BASE = { type: "website" as const, locale: "ar_EG", siteName: "مساعد أراضي بيت الوطن", images: [OG_IMAGE] };
