"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import useSWR from "swr";
import { ago, fetcher, fmt, pct, usd } from "@/lib/client";
import type { ScoredLand } from "@/engine/scoring";
import type { Survival } from "@/engine/depletion";
import type { SectorOutlook } from "@/engine";
import { Badge, Card, FeatureBadges, RecBadge, SurvivalBar } from "./ui";

interface Detail {
  land: Record<string, unknown> & {
    id: string; plotNumber: string; cityName: string; projectName: string | null; zoneName: string | null; square: string | null;
    area: number; pricePerMeter: number; basePricePerMeter: number | null; totalPrice: number; downPayment: number;
    gardenPct: number; cornerPct: number; seaPct: number; latitude: number | null; longitude: number | null;
    geometry: { coordinates: number[][][] } | null; status: string; bookingDate: string | null; externalPlotId: string | null;
    source: string; sourceUrl: string | null; sourceUpdatedAt: string | null; lastSeenAt: string; firstSeenAt: string;
  };
  survival: Survival | null;
  scored: ScoredLand | null;
  rankPosition: number | null;
  sector: SectorOutlook | null;
  history: { id: number; oldStatus: string | null; newStatus: string; detectedAt: string; sourceBookingDate: string | null }[];
  ai: { rank: number; score: number; recommendation: string; reason: string; risks: string[]; confidence: number } | null;
  budgetLimit: number;
}

function Polygon({ coords }: { coords: number[][] }) {
  const xs = coords.map((c) => c[0]);
  const ys = coords.map((c) => c[1]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const s = Math.max(maxX - minX, maxY - minY) || 1;
  const pts = coords.map((c) => `${((c[0] - minX) / s) * 100},${100 - ((c[1] - minY) / s) * 100}`).join(" ");
  return (
    <svg viewBox="-5 -5 110 110" className="h-40 w-40" aria-label="Plot outline">
      <polygon points={pts} fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth="1.5" />
    </svg>
  );
}

const FACTOR_LABELS: Record<string, string> = {
  reachability: "Reachability",
  budget: "Budget fit",
  value: "Value ($/m² vs similar)",
  area: "Area fit",
  location: "Location",
  premium: "Garden / corner",
  confidence: "Data confidence",
};

export function LandDetail() {
  const { id } = useParams<{ id: string }>();
  const { data, error } = useSWR<Detail>(`/api/lands/${id}`, fetcher, { refreshInterval: 60_000 });
  if (error) return <Card className="text-bad">Failed to load: {String(error.message)}</Card>;
  if (!data) return <div className="py-20 text-center text-muted">Loading…</div>;
  const l = data.land;
  const s = data.scored;
  const ring = l.geometry?.coordinates?.[0];

  return (
    <div className="space-y-4">
      <Link href="/" className="text-sm text-muted hover:text-text">← Back to dashboard</Link>
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">Plot {l.plotNumber}</h1>
            <div><bdi>{l.projectName}</bdi></div>
            <div className="text-sm text-muted"><bdi>{l.cityName}</bdi> · <bdi>{l.zoneName}</bdi></div>
            {l.square && l.square !== l.zoneName ? <div className="text-sm text-muted"><bdi>{l.square}</bdi></div> : null}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {l.status === "booked" ? <Badge tone="bad">BOOKED</Badge> : <Badge tone="good">AVAILABLE</Badge>}
              {s ? <RecBadge rec={s.recommendation} /> : null}
              <FeatureBadges garden={l.gardenPct > 0} corner={l.cornerPct > 0} sea={l.seaPct > 0} />
              {data.rankPosition ? <span className="text-xs text-muted">#{data.rankPosition} of your eligible plots</span> : null}
            </div>
          </div>
          {ring ? <Polygon coords={ring} /> : null}
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
          <dt className="text-muted">Area</dt><dd>{fmt(l.area, 1)} m²</dd>
          <dt className="text-muted">Total price</dt><dd>{usd(l.totalPrice)}</dd>
          <dt className="text-muted">Price / m²</dt><dd>${fmt(l.pricePerMeter, 2)} (base ${fmt(l.basePricePerMeter, 2)})</dd>
          <dt className="text-muted">Down payment</dt><dd>{usd(l.downPayment)}</dd>
          <dt className="text-muted">Premiums</dt><dd>corner {fmt(l.cornerPct)}% · garden {fmt(l.gardenPct)}% · view {fmt(l.seaPct)}%</dd>
          <dt className="text-muted">Your budget</dt><dd>{usd(data.budgetLimit)} {l.downPayment > data.budgetLimit ? <span className="text-bad">(over)</span> : null}</dd>
          <dt className="text-muted">NUCA plot id</dt><dd>{l.externalPlotId ?? "unknown"}</dd>
          <dt className="text-muted">Location</dt>
          <dd>
            {l.latitude != null ? (
              <a className="text-accent hover:underline" target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${l.latitude},${l.longitude}`}>
                Open map ↗
              </a>
            ) : "unknown"}
          </dd>
        </dl>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <h2 className="font-semibold">Score breakdown</h2>
          {s ? (
            <>
              <div className="mt-1 text-3xl font-semibold">{fmt(s.score)}<span className="text-base text-muted">/100</span></div>
              <ul className="mt-3 space-y-1.5 text-sm">
                {Object.entries(s.factors).map(([k, v]) => (
                  <li key={k} className="flex items-center gap-2">
                    <span className="w-44 text-muted">{FACTOR_LABELS[k] ?? k}</span>
                    <div className="h-2 flex-1 rounded-full bg-surface-2">
                      <div className="h-2 rounded-full bg-accent" style={{ width: `${v * 100}%` }} />
                    </div>
                    <span className="w-10 text-right">{pct(v)}</span>
                  </li>
                ))}
              </ul>
              <ul className="mt-3 list-disc ps-5 text-sm">{s.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
            </>
          ) : (
            <p className="mt-2 text-sm text-muted">
              Not in your eligible set ({l.status === "booked" ? "already booked" : "over budget or excluded by your filters"}).
            </p>
          )}
        </Card>
        <Card>
          <h2 className="font-semibold">Chance it&apos;s still free at your turn</h2>
          {data.survival ? (
            <>
              <div className="mt-2"><SurvivalBar {...data.survival} /></div>
              <p className="mt-2 text-sm">
                Expected <b>{pct(data.survival.mid)}</b>. Pessimistic {pct(data.survival.low)}, optimistic {pct(data.survival.high)}.
              </p>
            </>
          ) : <p className="mt-2 text-sm text-muted">Not available.</p>}
          {data.sector ? (
            <p className="mt-2 text-sm text-muted">
              Sector has {fmt(data.sector.available)} available plots. {fmt(data.sector.recentBookings)} were booked in the last 7 days. Expected bookings here before your
              turn: ~{fmt(data.sector.expectedBookingsBeforeTurn)}, leaving ~{fmt(data.sector.expectedRemaining)}.
            </p>
          ) : null}
          {data.ai ? (
            <div className="mt-3 rounded-lg bg-surface-2 p-3 text-sm">
              <div className="flex items-center gap-2"><span className="font-medium">Gemini #{data.ai.rank}</span><RecBadge rec={data.ai.recommendation} /><span className="text-xs text-muted">score {fmt(data.ai.score)} · conf {pct(data.ai.confidence)}</span></div>
              <p className="mt-1">{data.ai.reason}</p>
              {data.ai.risks.length ? <p className="mt-1 text-xs text-warn">Risks: {data.ai.risks.join("; ")}</p> : null}
            </div>
          ) : null}
        </Card>
      </div>

      <Card>
        <h2 className="font-semibold">Status history & data quality</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {data.history.length ? data.history.map((h) => (
            <li key={h.id}>
              {new Date(h.detectedAt).toLocaleString()}: {h.oldStatus ?? "new"} → <b>{h.newStatus}</b>
              {h.sourceBookingDate ? <span className="text-muted"> (source booking time {new Date(h.sourceBookingDate).toLocaleString()})</span> : null}
            </li>
          )) : <li className="text-muted">No status changes recorded.</li>}
        </ul>
        <p className="mt-3 text-xs text-muted">
          Source: {l.source} · source updated {ago(l.sourceUpdatedAt)} · last seen in a sync {ago(l.lastSeenAt)} · first seen {ago(l.firstSeenAt)}
        </p>
      </Card>
    </div>
  );
}
