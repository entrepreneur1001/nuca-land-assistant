import { describe, expect, it } from "vitest";
import { labelFontPx, polygonArea, polygonCentroid } from "@/components/plan-labels";

describe("plot number labels", () => {
  it("leaves a number out when the plot is too small on screen for it, and never exceeds the plot", () => {
    expect(labelFontPx(10, "123")).toBe(0);
    expect(labelFontPx(18, "123")).toBe(0);
    expect(labelFontPx(20, "123")).toBeGreaterThanOrEqual(9);
    // Short numbers fit earlier than long ones.
    expect(labelFontPx(17, "7")).toBeGreaterThanOrEqual(9);
    expect(labelFontPx(17, "1234")).toBe(0);
    for (const size of [20, 30, 60, 200]) {
      for (const text of ["7", "42", "123", "1234"]) {
        const f = labelFontPx(size, text);
        if (!f) continue;
        expect(f).toBeLessThanOrEqual(14);
        // Half a pixel of rounding on the font size.
        expect((f - 0.5) * 0.6 * text.length).toBeLessThanOrEqual(size * 0.85);
        expect(f - 0.5).toBeLessThanOrEqual(size * 0.55);
      }
    }
    expect(labelFontPx(200, "12")).toBe(14);
  });

  it("measures a polygon's area and centre whichever way it winds", () => {
    const rect: [number, number][] = [[10, 10], [50, 10], [50, 30], [10, 30]];
    expect(polygonArea(rect)).toBe(800);
    expect(polygonArea([...rect].reverse())).toBe(800);
    expect(polygonCentroid(rect)).toEqual([30, 20]);
    expect(polygonCentroid([...rect].reverse())).toEqual([30, 20]);
  });
});
