import type { ReactNode } from "react";
import { REC, num, t } from "@/i18n/ar";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-border bg-surface p-4 ${className}`}>{children}</section>;
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "good" | "warn" | "bad" }) {
  const color = tone === "good" ? "text-good" : tone === "warn" ? "text-warn" : tone === "bad" ? "text-bad" : "";
  return (
    <div className="rounded-2xl border border-border bg-surface px-4 py-3">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${color}`}>{value}</div>
      {sub ? <div className="mt-0.5 text-xs text-muted">{sub}</div> : null}
    </div>
  );
}

const TONES = {
  good: "bg-good-soft text-good",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
  accent: "bg-accent-soft text-accent",
  muted: "bg-surface-2 text-muted",
} as const;

export function Badge({ children, tone = "muted" }: { children: ReactNode; tone?: keyof typeof TONES }) {
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${TONES[tone]}`}>{children}</span>;
}

export const recTone = (r: string) => (r === "STRONG_BUY" ? "good" : r === "GOOD" ? "accent" : r === "WATCH" ? "warn" : "bad");

export function RecBadge({ rec }: { rec: string }) {
  return <Badge tone={recTone(rec)}>{REC[rec] ?? rec}</Badge>;
}

export function FeatureBadges({ garden, corner, sea, nearBuilt }: { garden: boolean; corner: boolean; sea?: boolean; nearBuilt?: boolean }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {garden ? <Badge tone="good">{t.badge.garden}</Badge> : null}
      {corner ? <Badge tone="accent">{t.badge.corner}</Badge> : null}
      {nearBuilt ? <Badge tone="warn">{t.badge.nearBuilt}</Badge> : null}
      {sea ? <Badge tone="accent">{t.badge.sea}</Badge> : null}
    </span>
  );
}

/** Pessimistic–optimistic band with the expected value marked. Fills right-to-left in RTL. */
export function SurvivalBar({ low, mid, high }: { low: number; mid: number; high: number }) {
  const tone = mid >= 0.7 ? "var(--good)" : mid >= 0.3 ? "var(--warn)" : "var(--bad)";
  return (
    <div className="flex items-center gap-2" title={`${num(Math.round(low * 100))}٪ – ${num(Math.round(high * 100))}٪`}>
      <div className="relative h-2 w-20 rounded-full bg-surface-2">
        <div className="absolute h-2 rounded-full opacity-35" style={{ insetInlineStart: `${low * 100}%`, width: `${Math.max(2, (high - low) * 100)}%`, background: tone }} />
        <div className="absolute -top-0.5 h-3 w-1 rounded" style={{ insetInlineStart: `calc(${mid * 100}% - 2px)`, background: tone }} />
      </div>
      <span className="text-xs font-semibold">{num(Math.round(mid * 100))}٪</span>
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-xl border border-border bg-surface-2 p-0.5 text-xs">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-lg px-2.5 py-1 font-medium ${value === o.value ? "bg-surface text-text shadow-sm" : "text-muted"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
