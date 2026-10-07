import { describe, expect, it } from "vitest";
import { isMultiUnit, unitsPerFloor } from "@/engine/units";

describe("apartments per floor", () => {
  it("follows the area thresholds (730 inclusive, 950 exclusive)", () => {
    expect(unitsPerFloor(500)).toBe(2);
    expect(unitsPerFloor(729.9)).toBe(2);
    expect(unitsPerFloor(730)).toBe(3);
    expect(unitsPerFloor(950)).toBe(3);
    expect(unitsPerFloor(950.1)).toBe(4);
    expect(isMultiUnit(729.9)).toBe(false);
    expect(isMultiUnit(730)).toBe(true);
  });
});
