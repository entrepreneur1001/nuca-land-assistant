"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { FACTOR, ago, km, num, pct, t, usd } from "@/i18n/ar";
import { isOnMainRoad } from "@/engine/roads";
import { unitsPerFloor } from "@/engine/units";
import { track } from "@/lib/firebase";
import { useNow } from "@/lib/use-now";
import { useApp } from "./app-state";
import { Badge, Card, FeatureBadges, RecBadge, SurvivalBar } from "./ui";

export function LandDetail() {
  const id = useSearchParams().get("id") ?? "";
  const app = useApp();
  const now = useNow();
  useEffect(() => {
    if (id) void track("land_view", { id });
  }, [id]);

  if (!app?.result || !app.snapshot) return <div className="py-20 text-center text-muted">{t.loading}</div>;
  const plot = app.snapshot.plots.find((p) => p.id === id);
  if (!plot) return <Card>{t.detail.notFound}</Card>;
  const { ranked, extras, dashboard } = app.result;
  const pos = ranked.findIndex((r) => r.id === id);
  const s = pos >= 0 ? ranked[pos] : null;
  const ex = extras[id];
  const sectorKey = plot.projectId ?? `city:${plot.cityName}`;
  const sector = dashboard.sectors.find((x) => x.key === sectorKey);
  const booked = plot.status === "booked";
  // Only show regulation fields the source actually publishes.
  const rules = [
    [t.rules.ratio, plot.rules?.ratio],
    [t.rules.floors, plot.rules?.floors],
    [t.rules.setbacks, plot.rules?.setbacks],
  ].filter((x): x is [string, string] => !!x[1]);
  // Always known: set by the plot's area under the licensing rule.
  const units = unitsPerFloor(plot.area);
  const unitsNote = units === 4 ? t.rules.unitsNote4 : units === 3 ? t.rules.unitsNote3 : null;

  return (
    <div className="space-y-4">
      <Link href="/" className="text-sm text-muted hover:text-text">{t.detail.back}</Link>
      <Card>
        <h1 className="text-xl font-bold">
          {t.card.plot} {plot.plotNumber}
        </h1>
        <div>{plot.projectName}</div>
        <div className="text-sm text-muted">
          {plot.cityName}
          {plot.zoneName ? ` · ${plot.zoneName}` : ""}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {booked ? <Badge tone="bad">{t.detail.booked}</Badge> : <Badge tone="good">{t.detail.available}</Badge>}
          {s ? <RecBadge rec={s.recommendation} /> : null}
          <FeatureBadges
            garden={plot.gardenPct > 0}
            corner={plot.cornerPct > 0}
            street={isOnMainRoad(plot.mainRoadM)}
            sea={plot.seaPct > 0}
            nearBuilt={s?.isNearBuilt}
            units={units}
          />
          {s ? <span className="text-xs text-muted">{t.detail.rankOf(pos + 1)}</span> : null}
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-4">
          <dt className="text-muted">{t.card.area}</dt>
          <dd>{num(plot.area, 1)} {t.card.m2}</dd>
          <dt className="text-muted">{t.detail.total}</dt>
          <dd>{usd(plot.totalPrice)}</dd>
          <dt className="text-muted">{t.card.ppm}</dt>
          <dd>{usd(plot.pricePerMeter)}</dd>
          <dt className="text-muted">{t.card.dp}</dt>
          <dd>{usd(plot.downPayment)}</dd>
          <dt className="text-muted">{t.detail.premiumsLabel}</dt>
          <dd>{t.detail.premiums(plot.cornerPct, plot.gardenPct, plot.seaPct)}</dd>
          <dt className="text-muted">{t.detail.budget}</dt>
          <dd>
            {usd(dashboard.budgetLimit)} {plot.downPayment > dashboard.budgetLimit ? <span className="text-bad">{t.detail.over}</span> : null}
          </dd>
          {plot.builtKm != null ? (
            <>
              <dt className="text-muted">{t.detail.builtDist}</dt>
              <dd>
                {km(plot.builtKm)} {plot.builtSrc === 1 ? <span className="text-xs text-muted">{t.detail.builtFromSector}</span> : null}
              </dd>
            </>
          ) : null}
          {/* Only when confirmed: "far" may just be a road missing from the map. */}
          {isOnMainRoad(plot.mainRoadM) ? (
            <>
              <dt className="text-muted">{t.detail.roadDist}</dt>
              <dd>
                {km(plot.mainRoadM! / 1000)}{" "}
                <span className="text-xs text-muted">{t.detail.roadNote}</span>
              </dd>
            </>
          ) : null}
          {ex?.n != null ? (
            <>
              <dt className="text-muted">{t.detail.neighbours}</dt>
              <dd>{pct(ex.n)}</dd>
            </>
          ) : null}
          {plot.externalPlotId ? (
            <>
              <dt className="text-muted">{t.detail.nucaId}</dt>
              <dd>{plot.externalPlotId}</dd>
            </>
          ) : null}
          {plot.latitude != null ? (
            <>
              <dt className="text-muted">{t.detail.location}</dt>
              <dd>
                <a className="text-accent hover:underline" target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${plot.latitude},${plot.longitude}`}>
                  {t.detail.map}
                </a>
              </dd>
            </>
          ) : null}
        </dl>
      </Card>

      <Card>
        <h2 className="font-bold">🏗️ {t.rules.title}</h2>
        <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-4">
          {rules.map(([label, value]) => (
            <div key={label}>
              <dt className="text-muted">{label}</dt>
              <dd className="font-semibold">{value}</dd>
            </div>
          ))}
          <div>
            <dt className="text-muted">{t.rules.units}</dt>
            <dd className="font-semibold">{t.rules.unitsValue(units)}</dd>
            {unitsNote ? <dd className="text-xs text-muted">{unitsNote}</dd> : null}
          </div>
        </dl>
        {rules.length ? <p className="mt-2 text-xs text-muted">{plot.rules?.from === "booklet" ? t.rules.noteBooklet : t.rules.note}</p> : null}
        <p className="mt-1 text-xs text-muted">{t.rules.unitsBasis}</p>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <h2 className="font-bold">{t.detail.breakdown}</h2>
          {s ? (
            <>
              <div className="mt-1 text-3xl font-bold">
                {num(s.score)}
                <span className="text-base text-muted">/١٠٠</span>
              </div>
              <ul className="mt-3 space-y-1.5 text-sm">
                {Object.entries(s.factors).map(([k, v]) => (
                  <li key={k} className="flex items-center gap-2">
                    <span className="w-44 text-muted">{FACTOR[k] ?? k}</span>
                    <div className="h-2 flex-1 rounded-full bg-surface-2">
                      <div className="h-2 rounded-full bg-accent" style={{ width: `${v * 100}%` }} />
                    </div>
                    <span className="w-10 text-left">{pct(v)}</span>
                  </li>
                ))}
              </ul>
              <ul className="mt-3 list-disc ps-5 text-sm">
                {s.reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </>
          ) : (
            <p className="mt-2 text-sm text-muted">{t.detail.notEligible(booked)}</p>
          )}
        </Card>
        <Card>
          <h2 className="font-bold">{t.detail.chanceTitle}</h2>
          {ex?.s && !booked ? (
            <>
              <div className="mt-2">
                <SurvivalBar {...ex.s} />
              </div>
              <p className="mt-2 text-sm">{t.detail.chanceText(pct(ex.s.mid), pct(ex.s.low), pct(ex.s.high))}</p>
            </>
          ) : null}
          {sector ? (
            <p className="mt-2 text-sm text-muted">
              {t.detail.sector(sector.available, sector.recentBookings, sector.expectedBookingsBeforeTurn, sector.expectedRemaining)}
            </p>
          ) : null}
          <p className="mt-3 text-xs text-muted">{t.detail.source(ago(app.snapshot.meta.fullSyncAt, now))}</p>
        </Card>
      </div>
    </div>
  );
}
