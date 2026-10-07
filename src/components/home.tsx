"use client";

import Link from "next/link";
import { useState } from "react";
import type { AiResponse } from "@/ai/schema";
import { ago, date, num, pct, t, usd } from "@/i18n/ar";
import { analyze, cooldownLeft } from "@/lib/ai";
import { useNow } from "@/lib/use-now";
import { useApp } from "./app-state";
import { ProfileCard } from "./profile-card";
import { AdvancedSearch } from "./search";
import { Badge, Card, FeatureBadges, RecBadge, Stat, SurvivalBar } from "./ui";

export function Home() {
  const app = useApp();
  const now = useNow();
  if (!app) return <div className="py-20 text-center text-muted">{t.loading}</div>;
  const { snapshot, result, profile, setProfile, error, computing } = app;

  if (error && !result)
    return (
      <Card className="text-center">
        {error === "quota" ? t.quota : error === "no-data" ? t.firstSync : t.loadError}
      </Card>
    );

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">{t.tagline}</p>
      <p className="rounded-xl bg-warn-soft px-3 py-2 text-xs text-warn">{t.disclaimer.short}</p>
      <ProfileCard profile={profile} setProfile={setProfile} cities={snapshot?.meta.cities ?? []} />
      {!result ? (
        <div className="py-12 text-center text-muted">{t.loading}</div>
      ) : (
        <Results now={now} computing={computing} />
      )}
    </div>
  );
}

function Results({ now, computing }: { now: number; computing: boolean }) {
  const app = useApp()!;
  const { dashboard: d, ranked } = app.result!;
  const q = d.queue;
  const f = d.freshness;
  const top = d.top;
  const topChoice = top.find((x) => x.id === d.strategy.topChoiceId) ?? top[0];

  return (
    <div className={`space-y-5 transition-opacity ${computing ? "opacity-60" : ""}`}>
      {f.stale ? (
        <div className="rounded-2xl border border-warn bg-warn-soft px-4 py-3 text-sm text-warn">
          {t.stale} — {t.lastUpdate} {ago(f.lastFullOkAt, now)}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label={t.kpi.ahead} value={num(q.peopleAhead)} sub={t.kpi.aheadSub(q.codesIssued)} />
        <Stat label={t.kpi.booked} value={num(d.market.booked)} sub={t.kpi.bookedSub(d.market.bookedLast24h)} />
        <Stat label={t.kpi.available} value={num(d.reachable.eligible)} sub={t.kpi.availableSub(d.market.available)} />
        <Stat
          label={t.kpi.reachable}
          value={num(d.reachable.expected)}
          sub={t.kpi.reachableSub(d.reachable.low, d.reachable.high)}
          tone={q.aggregateLevel === "HIGH" ? "good" : q.aggregateLevel === "MEDIUM" ? "warn" : "bad"}
        />
        <div className="col-span-2 rounded-2xl border border-border bg-surface px-4 py-3 lg:col-span-1">
          <div className="flex items-center gap-2 text-xs font-medium text-muted">
            <span className={`inline-block h-2 w-2 rounded-full ${f.stale ? "bg-warn" : "live-dot bg-good"}`} />
            {f.stale ? t.stale : t.live}
          </div>
          <div className="mt-1 text-lg font-bold">{ago(f.lastFullOkAt, now)}</div>
          <div className="text-xs text-muted">{t.lastUpdate}</div>
        </div>
      </div>

      <Card className="border-accent/40">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-bold">{t.now.title}</h2>
          <span className="text-sm">
            {t.now.turn} <b>{date(q.eta.expected)}</b>{" "}
            <span className="text-xs text-muted">{t.now.turnRange(date(q.eta.best), date(q.eta.worst))}</span>
          </span>
        </div>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <div className="space-y-3 text-sm">
            <p>{t.now.ahead(q.peopleAhead, q.bookingsAhead.mid, q.bookingsAhead.low, q.bookingsAhead.high, q.remainingAtTurn.mid)}</p>
            <div className="flex flex-wrap gap-2">
              <Badge tone="good">{t.now.high(d.strategy.highConfidence)}</Badge>
              <Badge tone="warn">{t.now.medium(d.strategy.mediumConfidence)}</Badge>
            </div>
            <p className="text-xs text-muted">{t.now.featureReach(d.reachable.gardenCorner, d.reachable.nearBuilt)}</p>
            {d.strategy.targets.length || d.strategy.avoid.length ? (
              <div>
                <div className="font-semibold">{t.now.strategy}</div>
                <ol className="mt-1 list-decimal space-y-1 ps-5">
                  {d.strategy.targets.map((x, i) => (
                    <li key={i}>
                      {i === 0 ? t.now.target : t.now.backup}: <b>{x.projectName}</b> · {x.cityName}{" "}
                      <span className="text-muted">{t.now.targetDetail(x.count, x.bestScore)}</span>
                    </li>
                  ))}
                  {d.strategy.avoid.map((x, i) => (
                    <li key={`a${i}`} className="text-bad">
                      {t.now.avoid}: <b>{x.projectName}</b> · {x.cityName}. <span className="opacity-80">{t.now.avoidReason(x.recentBookings)}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
          </div>
          <div className="rounded-xl bg-surface-2 p-3 text-sm">
            {topChoice ? (
              <>
                <div className="text-xs text-muted">{t.now.top}</div>
                <Link href={`/land?id=${topChoice.id}`} className="mt-1 block text-base font-bold hover:underline">
                  {t.card.plot} {topChoice.plotNumber} · {topChoice.projectName}
                </Link>
                <div className="text-muted">
                  {topChoice.cityName}
                  {topChoice.zoneName ? ` · ${topChoice.zoneName}` : ""}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <RecBadge rec={topChoice.recommendation} />
                  <FeatureBadges garden={topChoice.hasGarden} corner={topChoice.hasCorner} nearBuilt={topChoice.isNearBuilt} />
                  <span className="text-xs">
                    {t.card.score} {num(topChoice.score)}/١٠٠
                  </span>
                </div>
                <div className="mt-2 font-semibold">{t.now.why}</div>
                <ul className="list-disc ps-5">
                  {topChoice.reasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </>
            ) : (
              <div className="text-muted">{t.now.none}</div>
            )}
          </div>
        </div>
      </Card>

      <div>
        <h2 className="mb-2 text-lg font-bold">{t.top5}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {top.map((l, i) => (
            <Link key={l.id} href={`/land?id=${l.id}`} className="block rounded-2xl border border-border bg-surface p-3 hover:border-accent">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted">#{num(i + 1)}</span>
                <RecBadge rec={l.recommendation} />
              </div>
              <div className="mt-1 font-bold">
                {t.card.plot} {l.plotNumber}
              </div>
              <div className="truncate text-sm" title={l.projectName ?? ""}>{l.projectName}</div>
              <div className="truncate text-xs text-muted">{l.cityName}</div>
              <div className="mt-2">
                <FeatureBadges garden={l.hasGarden} corner={l.hasCorner} nearBuilt={l.isNearBuilt} sea={l.seaPct > 0} />
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-2 gap-y-0.5 text-xs">
                <dt className="text-muted">{t.card.area}</dt>
                <dd>{num(l.area)} {t.card.m2}</dd>
                <dt className="text-muted">{t.card.dp}</dt>
                <dd>{usd(l.downPayment)}</dd>
                <dt className="text-muted">{t.card.price}</dt>
                <dd>{usd(l.totalPrice)}</dd>
              </dl>
              {l.rules?.floors ? <div className="mt-1 truncate text-xs text-muted" title={l.rules.floors}>🏗️ {l.rules.floors}</div> : null}
              <div className="mt-2 flex items-center justify-between">
                <SurvivalBar {...l.survival} />
                <span className="text-sm font-bold">{num(l.score)}</span>
              </div>
            </Link>
          ))}
        </div>
      </div>

      <AiPanel />
      <AdvancedSearch ranked={ranked} cities={app.snapshot?.meta.cities ?? []} />

      <Card>
        <details>
          <summary className="cursor-pointer text-sm font-semibold">{t.how.title}</summary>
          <div className="mt-2 space-y-2 text-sm text-muted">
            <p>{t.how.queue(q.codesPerBatch.mid, q.batchesPerWeek, q.codesIssued, pct(q.conversion.low), pct(q.conversion.high), pct(q.conversion.mid))}</p>
            <p>{t.how.demand(d.featureWeights.gardenCorner, d.featureWeights.garden, d.featureWeights.corner)}</p>
            <p>{t.how.nearBuilt}</p>
            <ul className="list-disc ps-5">
              {t.how.assumptions.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
            <p>{t.how.source(app.snapshot?.meta.source.name ?? "")}</p>
          </div>
        </details>
      </Card>
    </div>
  );
}

function AiPanel() {
  const app = useApp()!;
  const { dashboard, ranked } = app.result!;
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ data: AiResponse; cached: boolean; forVersion: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const now = useNow();
  const left = now ? cooldownLeft() : 0;
  const byId = new Map(ranked.map((r) => [r.id, r]));

  const run = async () => {
    setBusy(true);
    setErr(null);
    const r = await analyze(dashboard, ranked, app.profile);
    setBusy(false);
    if (r.ok) setRes({ data: r.data, cached: r.cached, forVersion: dashboard.dataVersion });
    else
      setErr(
        r.error === "cooldown"
          ? t.ai.cooldown(Math.max(1, Math.ceil(cooldownLeft() / 1000)))
          : r.error === "daily-cap"
            ? t.ai.dailyCap
            : t.ai.failed,
      );
  };

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">🤖 {t.ai.title}</h2>
        <button
          type="button"
          onClick={run}
          disabled={busy || left > 0 || !ranked.length}
          className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? t.ai.running : left > 0 ? t.ai.cooldown(Math.ceil(left / 1000)) : res ? t.ai.again : t.ai.button}
        </button>
      </div>
      <p className="mt-1 text-xs text-muted">{t.ai.note}</p>
      {err ? <p className="mt-2 text-sm text-bad">{err}</p> : null}
      {res ? (
        <div className="mt-3 space-y-3 text-sm">
          {res.cached ? <Badge>{t.ai.cached}</Badge> : null}
          <p className="font-medium">{res.data.strategy}</p>
          <p className="text-muted">{res.data.market_summary}</p>
          {res.data.warnings.length ? (
            <ul className="list-disc ps-5 text-xs text-warn">
              {res.data.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          ) : null}
          <ol className="space-y-2">
            {res.data.recommendations
              .filter((r) => byId.has(r.land_id))
              .slice(0, 8)
              .map((r) => {
                const l = byId.get(r.land_id)!;
                return (
                  <li key={r.land_id} className="rounded-xl bg-surface-2 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold">#{num(r.rank)}</span>
                      <Link href={`/land?id=${l.id}`} className="font-semibold hover:underline">
                        {t.card.plot} {l.plotNumber} · {l.projectName} · {l.cityName}
                      </Link>
                      <RecBadge rec={r.recommendation} />
                      <FeatureBadges garden={l.hasGarden} corner={l.hasCorner} nearBuilt={l.isNearBuilt} />
                      <span className="text-xs text-muted">
                        {t.ai.confidence} {pct(r.confidence)}
                      </span>
                    </div>
                    <p className="mt-1">{r.reason}</p>
                    {r.risks.length ? (
                      <p className="mt-1 text-xs text-warn">
                        {t.ai.risks}: {r.risks.join("، ")}
                      </p>
                    ) : null}
                  </li>
                );
              })}
          </ol>
        </div>
      ) : null}
    </Card>
  );
}
