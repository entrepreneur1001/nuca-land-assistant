import type { Dashboard, RankedLand, LandView } from "@/engine";
import type { AiState } from "@/ai/service";

export type SummaryResponse = Dashboard & {
  ai: AiState;
  aiLands: Record<string, LandView | null>;
  cities: string[];
  error?: string;
};
export type ListedLand = RankedLand & { aiScore: number | null };

export const fetcher = async (url: string) => {
  const r = await fetch(url, { cache: "no-store" });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);
  return j;
};

export const fmt = (n: number | null | undefined, digits = 0) =>
  n == null || !Number.isFinite(n) ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: digits });
export const usd = (n: number | null | undefined) => (n == null ? "—" : `$${fmt(n)}`);
export const pct = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(n * 100)}%`);

export function ago(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export const shortDate = (iso: string | Date | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";
