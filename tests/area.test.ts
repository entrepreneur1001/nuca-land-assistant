import { describe, expect, it } from "vitest";
import type { MetaDoc, Plot, Snapshot } from "@/data/snapshot";
import { areaPlots } from "@/lib/area-stats";
import { areaHref } from "@/lib/phases";

const plot = (i: number, o: Partial<Plot>): Plot =>
  ({
    id: `p${i}`,
    plotNumber: String(i),
    cityName: "السادات",
    projectId: "s1",
    projectName: "المحور المركزى",
    status: "available",
    latitude: 30.4,
    longitude: 30.5,
    area: 500,
    pricePerMeter: 200,
    totalPrice: 100_000,
    downPayment: 25_000,
    gardenPct: 0,
    cornerPct: 0,
    seaPct: 0,
    ...o,
  }) as Plot;

const snap = (): Snapshot => ({
  meta: {
    sectors: [
      { id: "s1", name: "المحور المركزى", city: 0, hot: true, rules: null, c: [30.41, 30.52] },
      { id: "s2", name: "حى الزهور", city: 0, hot: false, rules: null, c: [30.38, 30.55] },
    ],
  } as unknown as MetaDoc,
  plots: [
    plot(1, {}),
    plot(2, { status: "booked" }),
    plot(3, { projectId: "s2", projectName: "حى الزهور", latitude: null, longitude: null }),
    plot(4, { projectId: "s2", projectName: "حى الزهور", latitude: null, longitude: null, status: "booked" }),
    plot(5, { cityName: "بدر", projectId: "s9" }),
  ],
});

describe("area page", () => {
  it("links a city, or a district inside it", () => {
    expect(areaHref("السادات")).toBe(`/area?city=${encodeURIComponent("السادات")}`);
    expect(areaHref("حدائق العاشر", "bfca4c7f")).toBe(`/area?city=${encodeURIComponent("حدائق العاشر").replace(/%20/g, "+")}&d=bfca4c7f`);
  });

  it("a city shows all its districts, available and booked, with unlocated plots counted per district", () => {
    const a = areaPlots(snap(), "السادات")!;
    expect(a.district).toBeNull();
    expect(a.plots.map((p) => p.id)).toEqual(["p1", "p2", "p3", "p4"]);
    expect(a.stats).toMatchObject({ total: 4, available: 2 });
    const zohour = a.districts.find((d) => d.id === "s2")!;
    expect(zohour).toMatchObject({ name: "حى الزهور", total: 2, available: 1, unlocated: 2, unlocatedAvailable: 1, centre: { lat: 30.38, lng: 30.55 } });
    expect(a.districts.find((d) => d.id === "s1")).toMatchObject({ hot: true, unlocated: 0 });
  });

  it("a district narrows to its own plots", () => {
    const a = areaPlots(snap(), "السادات", "s2")!;
    expect(a.district?.name).toBe("حى الزهور");
    expect(a.plots.map((p) => p.id)).toEqual(["p3", "p4"]);
    expect(a.districts).toHaveLength(2);
  });

  it("an unknown city has no area", () => {
    expect(areaPlots(snap(), "مدينة مش موجودة")).toBeNull();
  });
});
