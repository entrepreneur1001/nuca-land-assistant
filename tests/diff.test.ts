import { describe, expect, it } from "vitest";
import { diffSnapshot, type ExistingItem } from "@/ingest/diff";
import { parseSourceDate, validatePlots } from "@/ingest/normalize";

const existing = new Map<string, ExistingItem>([
  ["a", { id: "a", status: "available" }],
  ["b", { id: "b", status: "available" }],
  ["c", { id: "c", status: "booked" }],
]);

describe("change detection", () => {
  it("records available → booked and booked → available", () => {
    const d = diffSnapshot(
      existing,
      [
        { id: "a", status: "booked" },
        { id: "b", status: "available" },
        { id: "c", status: "available" },
        { id: "d", status: "available" },
      ],
      { expectedTotal: 4, allPagesOk: true },
    );
    expect(d.accepted).toBe(true);
    expect(d.newlyBooked).toEqual(["a"]);
    expect(d.newlyAvailable).toEqual(["c"]);
    expect(d.inserted).toEqual(["d"]);
    expect(d.changes).toContainEqual({ landId: "a", oldStatus: "available", newStatus: "booked" });
  });

  it("rejects a partial snapshot so missing plots are never marked booked", () => {
    const d = diffSnapshot(existing, [{ id: "a", status: "available" }], { expectedTotal: 3, allPagesOk: true });
    expect(d.accepted).toBe(false);
    expect(d.changes).toHaveLength(0);
    const failed = diffSnapshot(existing, [], { expectedTotal: 3, allPagesOk: false });
    expect(failed.accepted).toBe(false);
  });

  it("deduplicates repeated plots in a snapshot", () => {
    const d = diffSnapshot(
      existing,
      [
        { id: "a", status: "booked" },
        { id: "a", status: "booked" },
        { id: "b", status: "available" },
        { id: "c", status: "booked" },
      ],
      { expectedTotal: 3, allPagesOk: true },
    );
    expect(d.newlyBooked).toEqual(["a"]);
  });
});

describe("normalization", () => {
  it("parses source timestamps as Cairo local time", () => {
    expect(parseSourceDate("2026-10-07T10:41:33")?.toISOString()).toBe("2026-10-07T07:41:33.000Z"); // EEST, UTC+3
    expect(parseSourceDate("2026-01-07T10:00:00")?.toISOString()).toBe("2026-01-07T08:00:00.000Z"); // EET, UTC+2
    expect(parseSourceDate("2026-10-07T10:00:00Z")?.toISOString()).toBe("2026-10-07T10:00:00.000Z");
    expect(parseSourceDate(null)).toBeNull();
  });

  it("rejects malformed plots and dedupes by id", () => {
    const good = {
      id: "x", plotNumber: 5, area: 500, totalPricePerMeter: 200, totalPrice: 100000, downPayment: 25000,
      cityName: "مدينة", isBooked: false, corner: 10, gardenView: 0,
      geoJson: JSON.stringify({ type: "Feature", geometry: { type: "Polygon", coordinates: [[[31, 30], [31.001, 30], [31.001, 30.001], [31, 30]]] } }),
    };
    const r = validatePlots([good, { ...good }, { ...good, id: "y", area: -1 }, { foo: 1 }]);
    expect(r.plots).toHaveLength(1);
    expect(r.rejected).toBe(2);
    expect(r.plots[0].plotNumber).toBe("5");
    expect(r.plots[0].status).toBe("available");
    expect(r.plots[0].latitude).toBeCloseTo(30.00025, 5);
  });
});
