import { describe, expect, it } from "vitest";
import { SECTOR_VIEWS, mercatorToLatLng, viewCentres } from "@/data/sector-views";
import { cityBests, citiesOf } from "@/lib/area-stats";
import type { Plot, Snapshot } from "@/data/snapshot";

describe("sector map views", () => {
  it("converts the source's EPSG:3857 centre to lat/lng", () => {
    const [lat, lng] = mercatorToLatLng([3397517.082075122, 3557688.8177515413]);
    expect(lat).toBeCloseTo(30.42029, 4);
    expect(lng).toBeCloseTo(30.52042, 4);
  });

  it("keys every view by sector id", () => {
    expect(viewCentres().size).toBe(Object.keys(SECTOR_VIEWS).length);
  });
});

describe("city districts", () => {
  const plot = (id: string, sector: string, booked: boolean, ppm: number, dp: number): Plot =>
    ({ id, cityName: "السادات", projectId: sector, status: booked ? "booked" : "available", pricePerMeter: ppm, downPayment: dp, area: 500, totalPrice: ppm * 500, gardenPct: 0, cornerPct: 0, latitude: null, longitude: null }) as Plot;
  const snap = {
    meta: {
      cities: ["السادات"],
      sectors: [
        { id: "big", name: "big", city: 0, hot: false },
        { id: "axis", name: "axis", city: 0, hot: true },
      ],
    },
    plots: [
      ...Array.from({ length: 5 }, (_, i) => plot(`b${i}`, "big", false, 206, 26000)),
      plot("a0", "axis", true, 195, 21000),
      plot("a1", "axis", false, 195, 21791),
    ],
  } as unknown as Snapshot;

  it("puts in-demand districts first and flags the cheapest", () => {
    const [city] = citiesOf(snap);
    expect(city.districts.map((d) => d.id)).toEqual(["axis", "big"]);
    expect(cityBests(city.districts)).toEqual({ cheapest: "axis", lowestDp: "axis" });
  });
});
