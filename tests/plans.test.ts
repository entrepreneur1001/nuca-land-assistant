import { describe, expect, it } from "vitest";
import { imagePointToLatLng, planProjector, zonesForPlots, zonesForSectors, type PlanCrs, type PlanIndex, type PlanZone } from "@/lib/plans";

/** Spherical Mercator (EPSG:3857) as Leaflet projects it, minus Leaflet's affine scaling, which the maths is invariant to. */
const R = 6378137;
const crs: PlanCrs = {
  project: ({ lat, lng }) => ({ x: (R * lng * Math.PI) / 180, y: R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) }),
  unproject: ({ x, y }) => ({ lat: ((2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180) / Math.PI, lng: (x * 180) / Math.PI / R }),
};

// Zone 3796 (السادات), rotated about 45°.
const corners = { tl: [30.4178422, 30.5017767] as [number, number], tr: [30.4270073, 30.5123611] as [number, number], bl: [30.4117754, 30.5088409] as [number, number] };
const w = 2400;
const h = 1595;

const close = (got: { lat: number; lng: number }, want: { lat: number; lng: number }) => {
  expect(got.lat).toBeCloseTo(want.lat, 7);
  expect(got.lng).toBeCloseTo(want.lng, 7);
};

describe("imagePointToLatLng", () => {
  it("maps the three given corners onto themselves", () => {
    close(imagePointToLatLng(corners, w, h, 0, 0, crs), { lat: corners.tl[0], lng: corners.tl[1] });
    close(imagePointToLatLng(corners, w, h, w, 0, crs), { lat: corners.tr[0], lng: corners.tr[1] });
    close(imagePointToLatLng(corners, w, h, 0, h, crs), { lat: corners.bl[0], lng: corners.bl[1] });
  });

  it("puts the fourth corner at tr + bl − tl and the centre at the mean of all four, in projected metres", () => {
    const tl = crs.project({ lat: corners.tl[0], lng: corners.tl[1] });
    const tr = crs.project({ lat: corners.tr[0], lng: corners.tr[1] });
    const bl = crs.project({ lat: corners.bl[0], lng: corners.bl[1] });
    const br = { x: tr.x + bl.x - tl.x, y: tr.y + bl.y - tl.y };
    close(imagePointToLatLng(corners, w, h, w, h, crs), crs.unproject(br));
    const centre = { x: (tl.x + tr.x + bl.x + br.x) / 4, y: (tl.y + tr.y + bl.y + br.y) / 4 };
    close(imagePointToLatLng(corners, w, h, w / 2, h / 2, crs), crs.unproject(centre));
    // A rotated plan: the centre is not the lat/lng midpoint of tl and br's lat/lng, but it is on the diagonal.
    expect(planProjector(corners, w, h, crs)(w / 2, h / 2)).toEqual(imagePointToLatLng(corners, w, h, w / 2, h / 2, crs));
  });

  it("is linear in pixels: a quarter of the way along the top edge is a quarter of the projected vector", () => {
    const tl = crs.project({ lat: corners.tl[0], lng: corners.tl[1] });
    const tr = crs.project({ lat: corners.tr[0], lng: corners.tr[1] });
    close(imagePointToLatLng(corners, w, h, w / 4, 0, crs), crs.unproject({ x: tl.x + (tr.x - tl.x) / 4, y: tl.y + (tr.y - tl.y) / 4 }));
  });
});

const index: PlanIndex = {
  zones: {
    "1": { city: "السادات", name: "أ", sector: "s1", bounds: [[0, 0], [1, 1]], plots: 2 },
    "2": { city: "السادات", name: "ب", sector: "s2", bounds: [[0, 0], [1, 1]], plots: 2 },
    "3": { city: "السادات", name: "ج", sector: null, bounds: [[0, 0], [1, 1]], plots: 1 },
    "4": { city: "بدر", name: "د", sector: null, bounds: [[0, 0], [1, 1]], plots: 1 },
    "5": { city: "السادات", name: "هـ", sector: null, bounds: [[0, 0], [1, 1]], plots: 1 },
  },
};
const zone = (ids: string[]): PlanZone => ({ zid: 0, w: 10, h: 10, corners, plots: Object.fromEntries(ids.map((id) => [id, [[0, 0], [1, 0], [1, 1]]])), unassigned: [] });

describe("zone lookup", () => {
  it("matches zones by sector, ignoring null sectors and unknown ids", () => {
    expect(zonesForSectors(index, ["s1", null, "s9"])).toEqual(["1"]);
    expect(zonesForSectors(index, ["s2", "s1"])).toEqual(["1", "2"]);
    expect(zonesForSectors(index, [])).toEqual([]);
  });

  it("finds sector-less zones of the city that draw one of the plots, loading only those", async () => {
    const loaded: string[] = [];
    const load = async (zid: string) => {
      loaded.push(zid);
      return zid === "3" ? zone(["p1"]) : zid === "5" ? zone(["p7"]) : null;
    };
    expect(await zonesForPlots(index, "السادات", new Set(["p1", "p2"]), load)).toEqual(["3"]);
    expect(loaded.sort()).toEqual(["3", "5"]);
    expect(await zonesForPlots(index, "بدر", new Set(["p1"]), async () => null)).toEqual([]);
    expect(await zonesForPlots(index, "السادات", new Set(), load)).toEqual([]);
  });
});
