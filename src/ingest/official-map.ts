/**
 * Name matching between the app's plots (city / zone / sector names copied from the former
 * source) and the official portal (zone ids, square names). Pure functions; the mapping
 * table itself lives in `src/data/official-zones.ts`.
 */
import { hashString } from "@/data/snapshot";

const ARABIC_INDIC = /[٠-٩]/g;
const EXTENDED_ARABIC_INDIC = /[۰-۹]/g;
/** Tashkeel (U+064B–U+0652) and tatweel (U+0640). */
const DIACRITICS = /[ً-ْـ]/g;
const PUNCTUATION = /[()[\]{}«»\-–—_./,،:]/g;
const LETTER = "A-Za-zء-يٮ-ۓ";
const LETTER_DIGIT = new RegExp(`([${LETTER}])(\\d)`, "g");
const DIGIT_LETTER = new RegExp(`(\\d)([${LETTER}])`, "g");

/** Arabic-Indic and Extended Arabic-Indic digits → ASCII digits. */
export function asciiDigits(s: string): string {
  return s.replace(ARABIC_INDIC, (d) => String.fromCharCode(d.charCodeAt(0) - 0x0660 + 48)).replace(EXTENDED_ARABIC_INDIC, (d) => String.fromCharCode(d.charCodeAt(0) - 0x06f0 + 48));
}

/**
 * Canonical form of an Arabic/Latin place name: NFKC, ASCII digits, no diacritics or tatweel,
 * أإآ→ا, ى→ي, ة→ه, punctuation → space, a space between letters and digits («موقع3» → «موقع 3»),
 * single spaces, trimmed, Latin lower-cased.
 */
export function normalizeName(s: string): string {
  return asciiDigits(s.normalize("NFKC"))
    .replace(DIACRITICS, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(PUNCTUATION, " ")
    .replace(LETTER_DIGIT, "$1 $2")
    .replace(DIGIT_LETTER, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Stable ASCII id for a plot the official site lists: `o<zid>-<hash of the square>-<plot number>`. */
export function officialPlotId(zid: number, square: string, plotNo: string): string {
  return `o${zid}-${hashString(normalizeName(square))}-${asciiDigits(plotNo).replace(/\s+/g, "")}`;
}

/** Where a square (المربع) of an official zone sits in the app's taxonomy. */
export interface OfficialSquareMap {
  sector: string | null;
  zone: string;
}

export interface OfficialZoneEntry {
  zid: number;
  pid: number;
  cityId: number;
  city: string;
  name: string;
  /** Keyed by `normalizeName(square)`. */
  squares: Record<string, OfficialSquareMap>;
}

export interface OfficialIndex {
  byZid: Map<number, OfficialZoneEntry>;
  /** Official zone id for the app's (city, zone name); `zoneName` null matches a city with a single zone. */
  zidOf(city: string, zoneName: string | null): number | null;
  squareOf(zid: number, square: string): OfficialSquareMap | null;
  cityOf(cityId: number): string | null;
}

export function buildOfficialIndex(zones: OfficialZoneEntry[], cities: Record<number, string>): OfficialIndex {
  const byZid = new Map<number, OfficialZoneEntry>();
  /** `${city}|${zone}` (both normalized) → zid; first entry wins. */
  const byName = new Map<string, number>();
  const byCity = new Map<string, Set<number>>();
  for (const z of zones) {
    byZid.set(z.zid, z);
    const cityNames = new Set([normalizeName(z.city)]);
    if (cities[z.cityId]) cityNames.add(normalizeName(cities[z.cityId]));
    const zoneNames = new Set([normalizeName(z.name)]);
    for (const sq of Object.values(z.squares)) zoneNames.add(normalizeName(sq.zone));
    for (const c of cityNames) {
      const set = byCity.get(c) ?? new Set<number>();
      set.add(z.zid);
      byCity.set(c, set);
      for (const n of zoneNames) if (!byName.has(`${c}|${n}`)) byName.set(`${c}|${n}`, z.zid);
    }
  }
  return {
    byZid,
    zidOf(city, zoneName) {
      const c = normalizeName(city);
      if (zoneName === null) {
        const set = byCity.get(c);
        return set && set.size === 1 ? [...set][0] : null;
      }
      return byName.get(`${c}|${normalizeName(zoneName)}`) ?? null;
    },
    squareOf(zid, square) {
      return byZid.get(zid)?.squares[normalizeName(square)] ?? null;
    },
    cityOf(cityId) {
      return cities[cityId] ?? null;
    },
  };
}
