/**
 * Residential units allowed on a plot, per the Ministry of Housing notice for the 11th offering
 * («تنويه هام بشأن عدد الوحدات السكنية المسموح بتنفيذها بقطع الأراضي المطروحة بمشروع بيت الوطن – الطرح الحادي عشر»).
 *
 * Every new city except New Alamein: max apartments per floor (عدد الشقق في الدور) by plot area:
 * - up to 550 m²: 2;  551–750 m²: 3;  751–950 m²: 4;  951 m² and above: 5.
 * Conditions: unit area ≥ 100 m² incl. its share of services and balconies, parking inside the plot,
 * utilities capacity and the district's building rules.
 *
 * New Alamein: the per-floor rule does not apply. The city authority sets units per plot by block
 * (see ALAMEIN_BLOCKS), so these plots have no per-floor number here.
 *
 * This file has no imports so the i18n strings can be built from its constants.
 */
export const UNITS = {
  /** Up to this area (inclusive) a floor may hold 2 units. */
  twoUpToM2: 550,
  /** Up to this area (inclusive) a floor may hold 3 units. */
  threeUpToM2: 750,
  /** Up to this area (inclusive) a floor may hold 4 units; above it 5. */
  fourUpToM2: 950,
};

export type UnitsPerFloor = 2 | 3 | 4 | 5;

/** The general (non-New-Alamein) rule. */
export function unitsPerFloor(area: number): UnitsPerFloor {
  return area <= UNITS.twoUpToM2 ? 2 : area <= UNITS.threeUpToM2 ? 3 : area <= UNITS.fourUpToM2 ? 4 : 5;
}

/** City where the authority sets units per plot instead of the area rule (spelling as in the source data). */
export const CITY_SET_UNITS = "العلمين الجديدة";
export const isCitySetUnits = (cityName: string | null | undefined) => cityName === CITY_SET_UNITS;

export interface AlameinBlock {
  block: number;
  /** Plots offered in the block. */
  plots: number;
  /** Units per plot (whole plot, not per floor). */
  min: number;
  max: number;
}

/** New Alamein units per plot by block (796 plots in 3 blocks). */
export const ALAMEIN_BLOCKS: AlameinBlock[] = [
  { block: 1, plots: 105, min: 29, max: 44 },
  { block: 10, plots: 423, min: 21, max: 35 },
  { block: 11, plots: 268, min: 18, max: 45 },
];

/** The block a New Alamein district belongs to, from «بلوك N» / «البلوك رقم N» in its name; null when unknown. */
export function alameinBlock(districtName: string | null | undefined): AlameinBlock | null {
  const m = districtName?.match(/بلوك\s*(?:رقم\s*)?\(?\s*(\d+)/);
  if (!m) return null;
  const n = Number(m[1]);
  return ALAMEIN_BLOCKS.find((b) => b.block === n) ?? null;
}

/** Apartments per floor for a plot, or null where the city sets units per plot instead (New Alamein). */
export function unitsRule(area: number, cityName: string | null | undefined): UnitsPerFloor | null {
  return isCitySetUnits(cityName) ? null : unitsPerFloor(area);
}

/** 3+ per floor, or a city-set plot (every New Alamein block allows 18+ units per plot). */
export const isMultiUnit = (area: number, cityName: string | null | undefined) =>
  isCitySetUnits(cityName) || unitsPerFloor(area) >= 3;
