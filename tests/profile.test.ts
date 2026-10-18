import { afterEach, describe, expect, it, vi } from "vitest";
import { loadProfile } from "@/lib/profile";

function browser(href: string) {
  const store = new Map<string, string>();
  const loc = new URL(href);
  vi.stubGlobal("window", { location: loc });
  vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
  vi.stubGlobal("history", {
    state: null,
    replaceState: (_s: unknown, _t: string, url: string) => {
      const next = new URL(url, loc);
      loc.search = next.search;
      loc.hash = next.hash;
    },
  });
  return { loc, store };
}

afterEach(() => vi.unstubAllGlobals());

describe("profile from a shared link", () => {
  it("seeds the profile once, then later edits survive a reload", () => {
    const { loc, store } = browser("https://x.test/?r=16745&p=40000&g=require&tab=2#top");
    expect(loadProfile()).toMatchObject({ bookingRank: 16745, moneyPaid: 40000 });
    // Profile params are gone; anything else in the URL stays.
    expect(loc.search).toBe("?tab=2");
    expect(loc.hash).toBe("#top");
    // The user changes their rank (saved by the app), then reloads.
    const saved = JSON.parse(store.get("nuca-profile-v2")!);
    store.set("nuca-profile-v2", JSON.stringify({ ...saved, bookingRank: 6000 }));
    expect(loadProfile().bookingRank).toBe(6000);
  });
});
