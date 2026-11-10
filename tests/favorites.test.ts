import { describe, expect, it } from "vitest";
import { bookedChanges, parseFavorites, type Favorites } from "@/lib/favorites";
import { followKey, parseFollows, plotKeys } from "@/lib/follows";

describe("parseFavorites", () => {
  it("reads a saved list and drops junk", () => {
    expect(parseFavorites('{"a":{"at":5,"ack":true},"b":{"at":"x"},"c":null}')).toEqual({ a: { at: 5, ack: true }, b: { at: 0 } });
  });
  it("survives empty, broken or wrong-shaped storage", () => {
    expect(parseFavorites(null)).toEqual({});
    expect(parseFavorites("{oops")).toEqual({});
    expect(parseFavorites("[1,2]")).toEqual({});
  });
});

describe("bookedChanges", () => {
  const favs: Favorites = { a: { at: 1 }, b: { at: 3 }, c: { at: 2, ack: true }, d: { at: 4, ack: true }, gone: { at: 9 } };
  const status: Record<string, "available" | "booked"> = { a: "booked", b: "booked", c: "booked", d: "available" };
  const r = bookedChanges(favs, (id) => status[id]);

  it("lists booked plots not yet seen, newest saved first", () => {
    expect(r.newly).toEqual(["b", "a"]);
  });
  it("re-arms a seen plot that came back on the market", () => {
    expect(r.reopened).toEqual(["d"]);
  });
  it("ignores plots missing from the data", () => {
    expect([...r.newly, ...r.reopened]).not.toContain("gone");
  });
});


describe("follows", () => {
  it("keys match what the sync job queries", () => {
    expect(followKey("العبور")).toBe("c:العبور");
    expect(followKey("العبور", "s3")).toBe("d:s3");
    expect(plotKeys("العبور", "s3")).toEqual(["c:العبور", "d:s3"]);
    expect(plotKeys("العبور", null)).toEqual(["c:العبور"]);
  });
  it("parses storage and drops junk", () => {
    expect(parseFollows('{"c:بدر":{"at":1,"city":"بدر"},"d:s3":{"at":2,"city":"العبور","district":{"id":"s3","name":"الحي ٣"}},"x":{"city":"y"},"c:z":{}}')).toEqual({
      "c:بدر": { at: 1, city: "بدر" },
      "d:s3": { at: 2, city: "العبور", district: { id: "s3", name: "الحي ٣" } },
    });
    expect(parseFollows("nope")).toEqual({});
  });
});
