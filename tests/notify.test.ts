import { describe, expect, it } from "vitest";
import { buildPushes, chunks, isDeadToken, type PlotLabel } from "@/ingest/notify";

const booked: PlotLabel[] = [
  { id: "p1", plotNo: "12", sector: "الحي ٣", city: "العبور" },
  { id: "p2", plotNo: "7", sector: null, city: "الشيخ زايد" },
];

describe("buildPushes", () => {
  it("names the plot when one saved plot got booked", () => {
    const [p, ...rest] = buildPushes([{ id: "u1", token: "t1", plots: ["p1", "x"] }], booked);
    expect(rest).toEqual([]);
    expect(p).toMatchObject({ watcherIds: ["u1"], token: "t1", title: "اتحجزت أرض من مفضلتك", body: "أرض 12 · الحي ٣ · العبور", link: "/land?id=p1" });
  });

  it("skips a missing sector in the label", () => {
    expect(buildPushes([{ id: "u1", token: "t1", plots: ["p2"] }], booked)[0].body).toBe("أرض 7 · الشيخ زايد");
  });

  it("sends one summary to /favorites when several saved plots got booked", () => {
    const [p] = buildPushes([{ id: "u1", token: "t1", plots: ["p1", "p2"] }], booked);
    expect(p.title).toBe("اتحجزت ٢ أراضي من مفضلتك");
    expect(p.link).toBe("/favorites");
  });

  it("ignores watchers with no booked plot and bad docs", () => {
    const ws = [
      { id: "u1", token: "t1", plots: ["x"] },
      { id: "u2", token: "", plots: ["p1"] },
      { id: "u3", token: "t3", plots: undefined as unknown as string[] },
    ];
    expect(buildPushes(ws, booked)).toEqual([]);
  });

  it("pushes once per token even when two docs share it", () => {
    const ps = buildPushes(
      [
        { id: "old", token: "t1", plots: ["p1"] },
        { id: "new", token: "t1", plots: ["p2"] },
      ],
      booked,
    );
    expect(ps).toHaveLength(1);
    expect(ps[0].watcherIds).toEqual(["old", "new"]);
    expect(ps[0].link).toBe("/favorites");
  });
});

describe("helpers", () => {
  it("chunks", () => {
    expect(chunks([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunks([], 30)).toEqual([]);
  });
  it("dead tokens", () => {
    expect(isDeadToken("messaging/registration-token-not-registered")).toBe(true);
    expect(isDeadToken("messaging/internal-error")).toBe(false);
    expect(isDeadToken(undefined)).toBe(false);
  });
});
