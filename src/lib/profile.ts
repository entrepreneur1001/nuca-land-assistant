import { DEFAULT_WEIGHTS } from "@/engine/config";
import type { FeatureMode, Profile } from "@/engine/scoring";

const KEY = "nuca-profile-v2";

export const DEFAULT_PROFILE: Profile = {
  bookingRank: null,
  moneyPaid: null,
  preferredCities: [],
  preferredProjects: [],
  minArea: null,
  maxArea: null,
  preferredArea: null,
  maxPrice: null,
  preferredPricePerMeter: null,
  weights: { ...DEFAULT_WEIGHTS },
  preferences: { garden: "prefer", corner: "prefer", nearBuilt: "prefer", units: "prefer", onlyPreferredCities: false },
};

const modes = new Set<FeatureMode>(["prefer", "require", "ignore"]);
const asMode = (v: unknown, d: FeatureMode): FeatureMode => (modes.has(v as FeatureMode) ? (v as FeatureMode) : d);
const posNum = (v: unknown, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : d;
};
/** Empty, zero or invalid means "not entered yet". */
const optNum = (v: unknown) => (v == null || v === "" ? null : posNum(v, NaN) || null);

// Old builds saved these placeholder defaults; treat them as "not entered".
const LEGACY_RANK = 17000;
const LEGACY_PAID = 39500;

/** Sanitize anything coming from storage or the URL. */
export function sanitize(p: Partial<Profile> | null | undefined): Profile {
  const d = DEFAULT_PROFILE;
  const rank = optNum(p?.bookingRank);
  const prefs = (p?.preferences ?? {}) as NonNullable<Profile["preferences"]>;
  const w = { ...DEFAULT_WEIGHTS } as Record<string, number>;
  for (const k of Object.keys(w)) w[k] = Math.min(50, posNum((p?.weights as Record<string, unknown> | undefined)?.[k] ?? w[k], 0));
  return {
    ...d,
    bookingRank: rank == null ? null : Math.max(1, Math.round(rank)),
    moneyPaid: optNum(p?.moneyPaid),
    preferredCities: Array.isArray(p?.preferredCities) ? p!.preferredCities.filter((x) => typeof x === "string").slice(0, 30) : [],
    minArea: p?.minArea == null ? null : posNum(p.minArea, 0),
    maxArea: p?.maxArea == null ? null : posNum(p.maxArea, 0),
    weights: w,
    preferences: {
      garden: asMode(prefs.garden, "prefer"),
      corner: asMode(prefs.corner, "prefer"),
      nearBuilt: asMode(prefs.nearBuilt, "prefer"),
      units: asMode(prefs.units, "prefer"),
      onlyPreferredCities: !!prefs.onlyPreferredCities,
    },
  };
}

export function loadProfile(): Profile {
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.has("r") || url.searchParams.has("p")) return fromQuery(url.searchParams);
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      if (saved?.bookingRank === LEGACY_RANK && saved?.moneyPaid === LEGACY_PAID) {
        saved.bookingRank = null;
        saved.moneyPaid = null;
      }
      return sanitize(saved);
    }
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
    g: p.preferences?.garden ?? "prefer",
    c: p.preferences?.corner ?? "prefer",
    n: p.preferences?.nearBuilt ?? "prefer",
    un: p.preferences?.units ?? "prefer",
  });
  if (p.bookingRank != null) q.set("r", String(p.bookingRank));
  if (p.moneyPaid != null) q.set("p", String(p.moneyPaid));
  if (p.preferredCities.length) q.set("cities", p.preferredCities.join("|"));
  if (p.preferences?.onlyPreferredCities) q.set("only", "1");
  return q.toString();
}

export function fromQuery(q: URLSearchParams): Profile {
  return sanitize({
    bookingRank: Number(q.get("r")),
    moneyPaid: Number(q.get("p")),
    preferredCities: q.get("cities")?.split("|").filter(Boolean) ?? [],
    preferences: {
      garden: q.get("g") as FeatureMode,
      corner: q.get("c") as FeatureMode,
      nearBuilt: q.get("n") as FeatureMode,
      units: q.get("un") as FeatureMode,
      onlyPreferredCities: q.get("only") === "1",
    },
  });
}
