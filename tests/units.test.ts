import { describe, expect, it } from "vitest";
import { CITY_SET_UNITS, alameinBlock, isMultiUnit, unitsPerFloor, unitsRule } from "@/engine/units";

describe("apartments per floor", () => {
  it("follows the ministry area bands (550 / 750 / 950, upper bounds inclusive)", () => {
    expect(unitsPerFloor(300)).toBe(2);
    expect(unitsPerFloor(550)).toBe(2);
    expect(unitsPerFloor(550.1)).toBe(3);
    expect(unitsPerFloor(750)).toBe(3);
    expect(unitsPerFloor(750.1)).toBe(4);
    expect(unitsPerFloor(950)).toBe(4);
    expect(unitsPerFloor(950.1)).toBe(5);
    expect(unitsPerFloor(1200)).toBe(5);
    expect(isMultiUnit(550, "City")).toBe(false);
    expect(isMultiUnit(551, "City")).toBe(true);
  });

  it("New Alamein is city-set per plot: no per-floor number, always multi-unit", () => {
    expect(unitsRule(1000, CITY_SET_UNITS)).toBeNull();
    expect(unitsRule(1000, "City")).toBe(5);
    expect(isMultiUnit(300, CITY_SET_UNITS)).toBe(true);
    expect(alameinBlock("البلوك رقم 10 بجوار الاكاديمية البحرية")?.block).toBe(10);
    expect(alameinBlock("بلوك (11)")?.block).toBe(11);
    expect(alameinBlock("منطقة C")).toBeNull();
    expect(alameinBlock("بلوك 7")).toBeNull();
    expect(alameinBlock(null)).toBeNull();
  });
});
