/**
 * Offering phases (مراحل بيت الوطن) that get public SEO pages under /[phase]/….
 * Only the phase whose plots the sync job ingests may be listed: every page reads the same live dataset.
 * To add a future phase, give it an entry here plus its booklet content in src/content/ (and its own data source).
 */
export interface Phase {
  /** URL segment, e.g. "phase-11". */
  slug: string;
  /** "11" as digits, for titles: "المرحلة 11". */
  num: string;
  /** Eastern Arabic digits: "المرحلة ١١". */
  numAr: string;
  /** Written ordinal: "الحادية عشرة". */
  ordinal: string;
  /** Official terms booklet (كراسة الشروط). */
  bookletUrl: string;
  bookletDate: string;
}

export const PHASES: Phase[] = [
  {
    slug: "phase-11",
    num: "11",
    numAr: "١١",
    ordinal: "الحادية عشرة",
    bookletUrl: "https://lands.nuca.gov.eg/Files/Handbook.pdf",
    bookletDate: "يونيو 2026",
  },
];

export const CURRENT_PHASE = PHASES[0];

export function getPhase(slug: string): Phase | null {
  return PHASES.find((p) => p.slug === slug) ?? null;
}

/** Path helpers, so links never hard-code the phase segment. */
export const phasePath = {
  available: (p: Phase) => `/${p.slug}/available`,
  rules: (p: Phase) => `/${p.slug}/building-requirements`,
  guide: (p: Phase) => `/${p.slug}/reservation-guide`,
  city: (p: Phase, citySlug: string) => `/${p.slug}/${citySlug}`,
};

/** The official sites people should verify against. */
export const OFFICIAL = {
  portal: "https://lands.nuca.gov.eg/",
  nuca: "https://www.nuca.gov.eg/",
};
