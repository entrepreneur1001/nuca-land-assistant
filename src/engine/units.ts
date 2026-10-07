/**
 * Apartments per floor (عدد الشقق في الدور), set by the plot's area under the city authority's
 * licensing rule:
 * - under 730 m²: 2 per floor (the baseline, keeps density low);
 * - 730–950 m²: 3 per floor, after paying the authority's licensing fee for the third unit;
 * - over 950 m²: 4 per floor, after paying the fee for the fourth unit and meeting the parking requirements.
 */
export const UNITS = {
  /** From this area (inclusive) a floor may be split into 3 units. */
  threeFromM2: 730,
  /** Above this area (exclusive) a floor may be split into 4 units. */
  fourAboveM2: 950,
};

export type UnitsPerFloor = 2 | 3 | 4;

export function unitsPerFloor(area: number): UnitsPerFloor {
  return area > UNITS.fourAboveM2 ? 4 : area >= UNITS.threeFromM2 ? 3 : 2;
}

export const isMultiUnit = (area: number) => unitsPerFloor(area) >= 3;
