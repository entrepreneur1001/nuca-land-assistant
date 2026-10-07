import { DEFAULT_WEIGHTS } from "@/engine/config";
import type { FeatureMode, Profile } from "@/engine/scoring";

const KEY = "nuca-profile-v2";

export const DEFAULT_PROFILE: Profile = {
  bookingRank: 17000,
  moneyPaid: 39500,
  moneyAvailable: null,
  maxAdditional: 0,
  preferredCities: [],
  preferredProjects: [],
  minArea: null,
  maxArea: null,
  preferredArea: null,
  maxPrice: null,
  preferredPricePerMeter: null,
  weights: { ...DEFAULT_WEIGHTS },
  preferences: { garden: "prefer", corner: "prefer", nearBuilt: "prefer", street: "prefer", units: "prefer", onlyPreferredCities: false },
};

const modes = new Set<FeatureMode>(["prefer", "require", "ignore"]);
const asMode = (v: unknown, d: FeatureMode): FeatureMode => (modes.has(v as FeatureMode) ? (v as FeatureMode) : d);
const posNum = (v: unknown, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : d;
};

/** Sanitize anything coming from storage or the URL. */
export function sanitize(p: Partial<Profile> | null | undefined): Profile {
  const d = DEFAULT_PROFILE;
  const prefs = (p?.preferences ?? {}) as NonNullable<Profile["preferences"]>;
  const w = { ...DEFAULT_WEIGHTS, ...(p?.weights ?? {}) } as Record<string, number>;
  for (const k of Object.keys(w)) w[k] = Math.min(50, posNum(w[k], 0));
  return {
    ...d,
    bookingRank: Math.max(1, Math.round(posNum(p?.bookingRank, d.bookingRank))),
    moneyPaid: posNum(p?.moneyPaid, d.moneyPaid),
    maxAdditional: posNum(p?.maxAdditional, 0),
    preferredCities: Array.isArray(p?.preferredCities) ? p!.preferredCities.filter((x) => typeof x === "string").slice(0, 30) : [],
    minArea: p?.minArea == null ? null : posNum(p.minArea, 0),
    maxArea: p?.maxArea == null ? null : posNum(p.maxArea, 0),
    weights: w,
    preferences: {
      garden: asMode(prefs.garden, "prefer"),
      corner: asMode(prefs.corner, "prefer"),
      nearBuilt: asMode(prefs.nearBuilt, "prefer"),
      street: asMode(prefs.street, "prefer"),
      units: asMode(prefs.units, "prefer"),
      onlyPreferredCities: !!prefs.onlyPreferredCities,
    },
  };
}

export function loadProfile(): Profile {
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.has("r")) return fromQuery(url.searchParams);
    const raw = localStorage.getItem(KEY);
    if (raw) return sanitize(JSON.parse(raw));
  } catch {
    /* ignore */
  }
  return sanitize(DEFAULT_PROFILE);
}

export function saveProfile(p: Profile) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* private mode etc. */
  }
}

export function toQuery(p: Profile): string {
  const q = new URLSearchParams({
    r: String(p.bookingRank),
    p: String(p.moneyPaid),
    x: String(p.maxAdditional),
    g: p.preferences?.garden ?? "prefer",
    c: p.preferences?.corner ?? "prefer",
    n: p.preferences?.nearBuilt ?? "prefer",
    st: p.preferences?.street ?? "prefer",
    un: p.preferences?.units ?? "prefer",
  });
  if (p.preferredCities.length) q.set("cities", p.preferredCities.join("|"));
  if (p.preferences?.onlyPreferredCities) q.set("only", "1");
  return q.toString();
}

export function fromQuery(q: URLSearchParams): Profile {
  const n = (k: string, d: number) => (q.has(k) && q.get(k) !== "" ? Number(q.get(k)) : d);
  return sanitize({
    bookingRank: n("r", DEFAULT_PROFILE.bookingRank),
    moneyPaid: n("p", DEFAULT_PROFILE.moneyPaid),
    maxAdditional: n("x", 0),
    preferredCities: q.get("cities")?.split("|").filter(Boolean) ?? [],
    preferences: {
      garden: q.get("g") as FeatureMode,
      corner: q.get("c") as FeatureMode,
      nearBuilt: q.get("n") as FeatureMode,
      street: q.get("st") as FeatureMode,
      units: q.get("un") as FeatureMode,
      onlyPreferredCities: q.get("only") === "1",
    },
  });
}
