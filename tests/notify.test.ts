import { describe, expect, it } from "vitest";
import { MAX_PUSHES_PER_BROWSER, areaKeys, buildPushes, census, chunks, isDeadToken, type PlotLabel } from "@/ingest/notify";

const booked: PlotLabel[] = [
  { id: "p1", plotNo: "12", sector: "الحي ٣", sectorId: "s3", city: "العبور" },
  { id: "p2", plotNo: "7", sector: null, sectorId: null, city: "الشيخ زايد" },
  { id: "p3", plotNo: "9", sector: "الحي ٣", sectorId: "s3", city: "العبور" },
];

describe("buildPushes", () => {
  it("a saved plot: names it and opens its page", () => {
    const ps = buildPushes([{ id: "u1", token: "t1", plots: ["p1", "x"] }], booked);
    expect(ps).toEqual([
      { watcherIds: ["u1"], token: "t1", kind: "plot", plotId: "p1", title: "اتحجزت أرض من مفضلتك", body: "أرض 12 · الحي ٣ · العبور", link: "/land?id=p1&from=push&k=plot" },
    ]);
  });

  it("skips a missing sector in the label", () => {
    expect(buildPushes([{ id: "u1", token: "t1", plots: ["p2"] }], booked)[0].body).toBe("أرض 7 · الشيخ زايد");
  });

  it("a followed district: one push per booked plot inside, each opening that plot", () => {
    const ps = buildPushes([{ id: "u1", token: "t1", areas: ["d:s3"] }], booked);
    expect(ps.map((p) => [p.plotId, p.kind, p.title])).toEqual([
      ["p1", "area", "اتحجزت أرض في الحي ٣"],
      ["p3", "area", "اتحجزت أرض في الحي ٣"],
    ]);
    expect(ps[1].link).toBe("/land?id=p3&from=push&k=area");
  });

  it("a followed city matches every plot in it; a saved plot comes first and isn't repeated", () => {
    const ps = buildPushes([{ id: "u1", token: "t1", plots: ["p3"], areas: ["c:العبور"] }], booked);
    expect(ps.map((p) => [p.plotId, p.kind])).toEqual([
      ["p3", "plot"],
      ["p1", "area"],
    ]);
    expect(ps[1].title).toBe("اتحجزت أرض في العبور");
  });

  it("caps pushes per browser and sums up the rest", () => {
    const many: PlotLabel[] = Array.from({ length: 8 }, (_, i) => ({ id: `q${i}`, plotNo: String(i), sector: null, sectorId: null, city: "بدر" }));
    const ps = buildPushes([{ id: "u1", token: "t1", areas: ["c:بدر"] }], many);
    expect(ps).toHaveLength(MAX_PUSHES_PER_BROWSER);
    expect(ps.at(-1)).toMatchObject({ kind: "more", plotId: null, title: "واتحجزت ٤ أراضي تانية في اللي بتتابعه", link: "/favorites?from=push&k=more" });
    // Exactly at the cap: no summary.
    expect(buildPushes([{ id: "u1", token: "t1", areas: ["c:بدر"] }], many.slice(0, MAX_PUSHES_PER_BROWSER)).every((p) => p.kind === "area")).toBe(true);
  });

  it("ignores watchers with no match and bad docs", () => {
    const ws = [
      { id: "u1", token: "t1", plots: ["x"], areas: ["c:بدر"] },
      { id: "u2", token: "", plots: ["p1"] },
      { id: "u3", token: "t3", plots: undefined, areas: "c:العبور" as unknown as string[] },
    ];
    expect(buildPushes(ws, booked)).toEqual([]);
  });

  it("pushes once per token even when two docs share it", () => {
    const ps = buildPushes(
      [
        { id: "old", token: "t1", plots: ["p1"] },
        { id: "new", token: "t1", plots: ["p1", "p2"] },
      ],
      booked,
    );
    expect(ps.map((p) => p.plotId)).toEqual(["p1", "p2"]);
    expect(ps[0].watcherIds).toEqual(["old", "new"]);
  });
});

describe("helpers", () => {
  it("areaKeys", () => {
    expect(areaKeys(booked).sort()).toEqual(["c:الشيخ زايد", "c:العبور", "d:s3"].sort());
  });
  it("chunks", () => {
    expect(chunks([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunks([], 30)).toEqual([]);
  });
  it("dead tokens", () => {
    expect(isDeadToken("messaging/registration-token-not-registered")).toBe(true);
    expect(isDeadToken("messaging/internal-error")).toBe(false);
    expect(isDeadToken(undefined)).toBe(false);
  });
  it("census", () => {
    const c = census([
      { id: "a", token: "t1", plots: ["p1", "p2"], areas: ["c:بدر"] },
      { id: "b", token: "t2", plots: ["p1"], areas: [] },
      { id: "c", token: "t1", plots: [] },
    ]);
    expect(c).toMatchObject({ people: 2, plotsSaved: 3, areasFollowed: 1 });
    expect(c.topPlots[0]).toEqual({ key: "p1", n: 2 });
  });
});
