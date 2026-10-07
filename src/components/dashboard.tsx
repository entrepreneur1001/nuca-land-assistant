"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useNow } from "@/lib/use-now";
import useSWR from "swr";
import { ago, fetcher, fmt, pct, shortDate, usd, type SummaryResponse } from "@/lib/client";
import { Badge, Card, FeatureBadges, RecBadge, Stat, SurvivalBar } from "./ui";
import { LandTable } from "./land-table";

export function Dashboard() {
  const { data, error, isValidating, mutate } = useSWR<SummaryResponse>("/api/summary", fetcher, {
    refreshInterval: 30_000,
    revalidateOnFocus: true,
  });
  const now = useNow();
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMsg, setAiMsg] = useState<string | null>(null);
  const autoTried = useRef(0);

  const analyze = async (force: boolean) => {
    setAiBusy(true);
    setAiMsg(null);
    try {
      const r = await fetch("/api/ai/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const j = await r.json();
      if (!j.ok) setAiMsg(j.error ?? "AI analysis failed");
      await mutate();
    } catch (e) {
      setAiMsg(String(e));
    } finally {
      setAiBusy(false);
    }
  };

  // Auto-refresh AI only when the server says the cached analysis is out of date (at most every 5 min from this tab).
  useEffect(() => {
    if (!data?.ai?.configured || !data.ai.needsRefresh || data.ai.running || aiBusy) return;
    if (data.freshness.stale || !data.reachable.eligible) return;
    if (Date.now() - autoTried.current < 5 * 60_000) return;
    autoTried.current = Date.now();
    void analyze(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.ai?.needsRefresh, data?.ai?.configured]);

  if (error && !data)
    return <Card className="border-bad text-bad">Could not load dashboard: {String(error.message ?? error)}</Card>;
  if (!data) return <div className="py-20 text-center text-muted">Loading inventory…</div>;
  if (!data.freshness.lastFullOkAt)
    return (
      <Card>
        <div className="font-medium">First sync in progress…</div>
        <p className="mt-1 text-sm text-muted">
          Downloading ~15,500 plots from the source. This takes 1–3 minutes on first start. The page refreshes automatically.
        </p>
      </Card>
    );

  const q = data.queue;
  const f = data.freshness;
  const live = !f.stale;
  const top = data.top;
  const topChoice = data.strategy.topChoiceId ? top.find((t) => t.id === data.strategy.topChoiceId) ?? top[0] : top[0];
  const ai = data.ai.analysis;

  return (
    <div className="space-y-5">
      {f.stale ? (
        <div className="rounded-xl border border-warn bg-warn-soft px-4 py-3 text-sm text-warn">
          ⚠ Data may be outdated: {f.staleReason}. Last inventory sync {ago(f.lastFullOkAt, now)}.
          {f.lastError ? <span className="block opacity-80">Last error: {f.lastError}</span> : null}
        </div>
      ) : null}

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Stat label="Your rank" value={fmt(data.profile.bookingRank)} sub={`Paid ${usd(data.profile.moneyPaid)}`} />
        <Stat label="Booked" value={fmt(data.market.booked)} sub={`${fmt(data.market.bookedLast24h)} in last 24h`} />
        <Stat label="Available" value={fmt(data.market.available)} sub={`${fmt(data.reachable.eligible)} within your budget`} />
        <Stat
          label="People ahead"
          value={fmt(q.peopleAhead)}
          sub={`${fmt(q.codesIssued)} codes issued so far`}
        />
        <Stat
          label="Est. reachable"
          value={fmt(data.reachable.expected)}
          sub={`range ${fmt(data.reachable.low)}–${fmt(data.reachable.high)}`}
          tone={q.aggregateLevel === "HIGH" ? "good" : q.aggregateLevel === "MEDIUM" ? "warn" : "bad"}
        />
        <div className="rounded-xl border border-border bg-surface px-4 py-3">
          <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-muted">
            <span className={`inline-block h-2 w-2 rounded-full ${live ? "live-dot bg-good" : "bg-warn"}`} />
            {isValidating ? "Updating" : live ? "Live" : "Stale"}
          </div>
          <div className="mt-1 text-lg font-semibold">{ago(f.lastFullOkAt, now)}</div>
          <div className="mt-0.5 text-xs text-muted">stats {ago(f.lastStatsOkAt, now)}</div>
        </div>
      </div>

      {/* What should I do now */}
      <Card className="border-accent/40">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">What should I do now?</h2>
          <span className="text-xs text-muted">
            Your turn, estimated: <b className="text-text">{shortDate(q.eta.expected)}</b> (best {shortDate(q.eta.best)}, worst{" "}
            {shortDate(q.eta.worst)})
          </span>
        </div>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <div className="space-y-3 text-sm">
            <p>
              Estimated position in queue: <b>{fmt(q.peopleAhead)}</b> people ahead. About <b>{fmt(q.bookingsAhead.mid)}</b> of them are expected to book
              before you (range {fmt(q.bookingsAhead.low)}–{fmt(q.bookingsAhead.high)}). That leaves ~{fmt(q.remainingAtTurn.mid)} plots in the whole market.
            </p>
            <div className="flex flex-wrap gap-2">
              <Badge tone="good">{fmt(data.strategy.highConfidence)} high-confidence options</Badge>
              <Badge tone="warn">{fmt(data.strategy.mediumConfidence)} medium-confidence options</Badge>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge tone="good">🌳+📐 ~{fmt(data.reachable.gardenCorner)} reachable</Badge>
              <Badge tone="good">🌳 ~{fmt(data.reachable.garden)} reachable</Badge>
              <Badge tone="accent">📐 ~{fmt(data.reachable.corner)} reachable</Badge>
            </div>
            {data.strategy.targets.length ? (
              <div>
                <div className="font-medium">Recommended strategy</div>
                <ol className="mt-1 list-decimal space-y-1 ps-5">
                  {data.strategy.targets.map((t, i) => (
                    <li key={i}>
                      {i === 0 ? "Target" : "Backup"}: <b><bdi>{t.projectName ?? "—"}</bdi></b> · <bdi>{t.cityName}</bdi>{" "}
                      <span className="text-muted">({t.count} good options, best score {fmt(t.bestScore)})</span>
                    </li>
                  ))}
                  {data.strategy.avoid.map((a, i) => (
                    <li key={`a${i}`} className="text-bad">
                      Avoid relying on: <b><bdi>{a.projectName ?? "—"}</bdi></b> · <bdi>{a.cityName}</bdi>. <span className="opacity-80">{a.reason}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
            {data.strategy.summary.slice(2).map((s, i) => (
              <p key={i} className="text-warn">{s}</p>
            ))}
          </div>
          <div className="rounded-lg bg-surface-2 p-3 text-sm">
            {topChoice ? (
              <>
                <div className="text-xs uppercase tracking-wider text-muted">Top choice right now</div>
                <Link href={`/land/${topChoice.id}`} className="mt-1 block text-base font-semibold hover:underline">
                  Plot {topChoice.plotNumber} · <bdi>{topChoice.projectName}</bdi>
                </Link>
                <div className="text-muted"><bdi>{topChoice.cityName}</bdi> · <bdi>{topChoice.zoneName}</bdi></div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <RecBadge rec={topChoice.recommendation} />
                  <FeatureBadges garden={topChoice.hasGarden} corner={topChoice.hasCorner} sea={topChoice.seaPct > 0} />
                  <span className="text-xs">Score {fmt(topChoice.score)}/100</span>
                </div>
                <div className="mt-2 font-medium">Why:</div>
                <ul className="list-disc ps-5">
                  {topChoice.reasons.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              </>
            ) : (
              <div className="text-muted">No plots match your budget and filters.</div>
            )}
          </div>
        </div>

        {/* AI */}
        <div className="mt-4 border-t border-border pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-medium">
              Gemini analysis{" "}
              {ai ? <span className="text-xs font-normal text-muted">· {ago(ai.createdAt, now)} · {ai.model}</span> : null}
            </div>
            <button
              onClick={() => analyze(true)}
              disabled={aiBusy || !data.ai.configured}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              {aiBusy || data.ai.running ? "Analyzing…" : "Re-analyze"}
            </button>
          </div>
          {!data.ai.configured ? <p className="mt-1 text-xs text-muted">Set GEMINI_API_KEY in .env.local to enable AI analysis.</p> : null}
          {aiMsg || data.ai.error ? <p className="mt-1 text-xs text-bad">AI: {aiMsg ?? data.ai.error} (deterministic ranking still applies)</p> : null}
          {ai ? (
            <div className="mt-2 space-y-2 text-sm">
              {data.ai.needsRefresh ? <p className="text-xs text-warn">Out of date: {data.ai.refreshReasons.join(", ")}</p> : null}
              <p>{ai.strategy}</p>
              <p className="text-muted">{ai.market_summary}</p>
              {ai.warnings.length ? (
                <ul className="list-disc ps-5 text-xs text-warn">{ai.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
              ) : null}
            </div>
          ) : null}
        </div>
      </Card>

      {/* Top 5 */}
      <div>
        <h2 className="mb-2 text-lg font-semibold">Best lands you can realistically book</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {top.map((l, i) => (
            <Link key={l.id} href={`/land/${l.id}`} className="block rounded-xl border border-border bg-surface p-3 hover:border-accent">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted">#{i + 1}</span>
                <RecBadge rec={l.recommendation} />
              </div>
              <div className="mt-1 font-semibold">Plot {l.plotNumber}</div>
              <div className="truncate text-sm" title={l.projectName ?? ""}><bdi>{l.projectName}</bdi></div>
              <div className="truncate text-xs text-muted"><bdi>{l.cityName}</bdi></div>
              <div className="mt-2"><FeatureBadges garden={l.hasGarden} corner={l.hasCorner} sea={l.seaPct > 0} /></div>
              <dl className="mt-2 grid grid-cols-2 gap-x-2 gap-y-0.5 text-xs">
                <dt className="text-muted">Area</dt><dd>{fmt(l.area, 1)} m²</dd>
                <dt className="text-muted">Price</dt><dd>{usd(l.totalPrice)}</dd>
                <dt className="text-muted">Down pmt</dt><dd>{usd(l.downPayment)}</dd>
                <dt className="text-muted">$/m²</dt><dd>{fmt(l.pricePerMeter)}</dd>
              </dl>
              <div className="mt-2 flex items-center justify-between">
                <SurvivalBar {...l.survival} />
                <span className="text-sm font-semibold">{fmt(l.score)}</span>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* AI picks */}
      {ai && ai.recommendations.length ? (
        <Card>
          <h2 className="text-lg font-semibold">AI picks</h2>
          <p className="text-xs text-muted">Gemini reasons only over the plots our backend supplied; unknown land ids are rejected.</p>
          <ol className="mt-2 space-y-2">
            {ai.recommendations.slice(0, 8).map((r) => {
              const l = data.aiLands[r.land_id];
              return (
                <li key={r.land_id} className="rounded-lg bg-surface-2 p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">#{r.rank}</span>
                    {l ? (
                      <Link href={`/land/${r.land_id}`} className="font-medium hover:underline">
                        Plot {l.plotNumber} · <bdi>{l.projectName}</bdi> · <bdi>{l.cityName}</bdi>
                      </Link>
                    ) : null}
                    <RecBadge rec={r.recommendation} />
                    {l ? <FeatureBadges garden={l.gardenPct > 0} corner={l.cornerPct > 0} /> : null}
                    <span className="text-xs text-muted">AI score {fmt(r.score)} · confidence {pct(r.confidence)}</span>
                  </div>
                  <p className="mt-1">{r.reason}</p>
                  {r.risks.length ? <p className="mt-1 text-xs text-warn">Risks: {r.risks.join("; ")}</p> : null}
                </li>
              );
            })}
          </ol>
        </Card>
      ) : null}

      <LandTable cities={data.cities} />

      <Card>
        <details>
          <summary className="cursor-pointer text-sm font-medium">How this is calculated (assumptions)</summary>
          <div className="mt-2 space-y-2 text-sm text-muted">
            <p>
              NUCA issues daily batches of booking codes (recently {fmt(q.codesPerBatch.mid)}/batch, ~{fmt(q.batchesPerWeek, 1)} batches/week). {fmt(q.codesIssued)} codes
              have been issued, so ranks up to ~{fmt(q.codesIssued)} have been called. Recent batches converted to bookings at {pct(q.conversion.low)}–{pct(q.conversion.high)} (avg {pct(q.conversion.mid)}).
            </p>
            <p>
              Future bookings are spread across sectors by recent demand (last 7 days, smoothed toward inventory share). Demand from sectors that sell out spills over to others.
              Inside a sector, plots are picked with learned weights: garden+corner ×{fmt(data.featureWeights.gardenCorner, 1)}, garden ×{fmt(data.featureWeights.garden, 1)}, corner ×
              {fmt(data.featureWeights.corner, 1)} vs plain plots, based on what has already been booked.
            </p>
            <ul className="list-disc ps-5">{q.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul>
            <p>
              Budget rule: a plot is affordable when its down payment ≤ what you paid + max extra ({usd(data.budgetLimit)}). Excluded: {fmt(data.excluded.overBudget)} over budget,{" "}
              {fmt(data.excluded.booked)} booked, {fmt(data.excluded.areaOrPrice + data.excluded.featureRequired + data.excluded.city)} by your filters.
            </p>
            <p>
              Source: {data.source.name} ({data.source.url}), a third-party tracker of the official NUCA inventory. All numbers are estimates, not guarantees.
            </p>
          </div>
        </details>
      </Card>
    </div>
  );
}
