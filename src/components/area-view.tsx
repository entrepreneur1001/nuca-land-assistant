"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import type { Plot } from "@/data/snapshot";
import type { RankedLand } from "@/engine/compute";
import { isOnMainRoad } from "@/engine/roads";
import { unitsPerFloor } from "@/engine/units";
import { num, t, usd } from "@/i18n/ar";
import { areaPlots } from "@/lib/area-stats";
import { areaHref } from "@/lib/phases";
import { useApp } from "./app-state";
import { AreaMap } from "./area-map";
import { Badge, Card, FeatureBadges, RecBadge, Stat, SurvivalBar } from "./ui";

type Sort = keyof typeof t.area.sorts;
const PAGE = 50;

/** /area?city=…[&d=<district id>]: every available plot in a city or district, plus a map of all its plots. */
export function AreaView() {
  const params = useSearchParams();
  const city = params.get("city") ?? "";
  const districtId = params.get("d");
  const router = useRouter();
  const app = useApp();
  const [sort, setSort] = useState<Sort>("ppm");
  const [f, setF] = useState({ garden: false, corner: false, budget: false });
  const [shown, setShown] = useState(PAGE);
  const [hover, setHover] = useState<string | null>(null);

  const snapshot = app?.snapshot ?? null;
  const result = app?.result ?? null;
  const area = useMemo(() => (snapshot ? areaPlots(snapshot, city, districtId) : null), [snapshot, city, districtId]);
  // Chance and recommendation are personal; only shown once the user entered their rank and payment.
  const personal = app?.profile.bookingRank != null && app?.profile.moneyPaid != null;
  const ranked = useMemo(() => new Map((personal ? (result?.ranked ?? []) : []).map((r) => [r.id, r])), [personal, result]);
  const paid = app?.profile.moneyPaid ?? null;

  const rows = useMemo(() => {
    if (!area) return [];
    const out = area.plots.filter(
      (p) =>
        p.status === "available" &&
        (!f.garden || p.gardenPct > 0) &&
        (!f.corner || p.cornerPct > 0) &&
        (!f.budget || paid == null || p.downPayment <= paid),
    );
    const chance = (p: Plot) => ranked.get(p.id)?.survival.mid ?? -1;
    const by: Record<Sort, (a: Plot, b: Plot) => number> = {
      ppm: (a, b) => a.pricePerMeter - b.pricePerMeter,
      dp: (a, b) => a.downPayment - b.downPayment,
      area: (a, b) => b.area - a.area,
      reach: (a, b) => chance(b) - chance(a),
    };
    return out.sort(by[sort]);
  }, [area, f, sort, paid, ranked]);

  if (!app?.snapshot) return <div className="py-20 text-center text-muted">{t.loading}</div>;
  if (!area) return <Card>{t.area.notFound}</Card>;

  const go = (d: string | null) => {
    setShown(PAGE);
    router.replace(areaHref(city, d), { scroll: false });
  };
  const s = area.stats;
  const mapDistricts = area.district ? [area.district] : area.districts;
  const mappable = area.plots.some((p) => p.latitude != null && p.longitude != null) || mapDistricts.some((d) => d.unlocated > 0 && d.centre);
  const sorts = (Object.keys(t.area.sorts) as Sort[]).filter((k) => k !== "reach" || personal);

  return (
    <div className="space-y-4">
      <Link href="/" className="text-sm text-muted hover:text-text">{t.area.back}</Link>

      <Card>
        <h1 className="text-xl font-bold">
          {area.district ? (
            <>
              <button type="button" className="text-accent hover:underline" onClick={() => go(null)}>{area.city}</button>
              {" › "}
              {area.district.name}
            </>
          ) : (
            area.city
          )}
          {area.district?.hot ? <span className="ms-2 align-middle"><Badge tone="warn">{t.seo.hot}</Badge></span> : null}
        </h1>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label={t.detail.legendAvailable} value={num(s.available)} sub={t.area.available(s.available, s.total)} tone="good" />
          <Stat label={t.area.ppm} value={s.ppmMin != null ? usd(s.ppmMin) : "—"} sub={s.ppmMax != null && s.ppmMax !== s.ppmMin ? `— ${usd(s.ppmMax)}` : undefined} />
          <Stat label={t.area.minDp} value={s.dpMin != null ? usd(s.dpMin) : "—"} />
          <Stat label={`${t.badge.garden} · ${t.badge.corner}`} value={`${num(s.garden)} · ${num(s.corner)}`} />
        </div>

        {area.districts.length > 1 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            <Chip active={!area.district} onClick={() => go(null)}>{t.area.allDistricts}</Chip>
            {area.districts.map((d) => (
              <Chip key={d.id ?? "none"} active={area.district?.id === d.id} onClick={() => go(d.id)}>
                {d.name} <span className="text-muted">({num(d.available)})</span>
              </Chip>
            ))}
          </div>
        ) : null}
      </Card>

      <Card>
        <h2 className="font-bold">📍 {t.area.mapTitle}</h2>
        <div className="mt-2">
          <AreaMap plots={area.plots} districts={mapDistricts} highlight={hover} onDistrict={(d) => go(d)} />
        </div>
        <div className={`mt-2 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted ${mappable ? "flex" : "hidden"}`}>
          <Dot className="bg-good" label={t.detail.legendAvailable} />
          <Dot className="bg-muted" label={t.detail.legendBooked} />
          {mapDistricts.some((d) => d.unlocated > 0) ? <Dot className="border-2 border-dashed border-accent" label={t.area.legendApprox} /> : null}
        </div>
        {mappable ? <p className="mt-1 text-xs text-muted">{t.area.mapNote}</p> : null}
      </Card>

      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-bold">{t.area.listTitle}</h2>
          <span className="text-sm text-muted">{t.search.results(rows.length)}</span>
          <select
            className="ms-auto rounded-lg border border-border bg-surface-2 px-2 py-1 text-sm"
            aria-label={t.search.sort}
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
          >
            {sorts.map((k) => (
              <option key={k} value={k}>{t.area.sorts[k]}</option>
            ))}
          </select>
        </div>
        <div className="mt-2 flex flex-wrap gap-4 text-sm">
          <Check checked={f.garden} onChange={(v) => setF({ ...f, garden: v })} label={`🌳 ${t.search.garden}`} />
          <Check checked={f.corner} onChange={(v) => setF({ ...f, corner: v })} label={`📐 ${t.search.corner}`} />
          {paid != null ? <Check checked={f.budget} onChange={(v) => setF({ ...f, budget: v })} label={`💵 ${t.area.budget}`} /> : null}
        </div>

        <ul className="mt-3 divide-y divide-border">
          {rows.slice(0, shown).map((p) => (
            <Row key={p.id} plot={p} r={ranked.get(p.id)} showDistrict={!area.district} onHover={setHover} />
          ))}
          {!rows.length ? <li className="py-6 text-center text-muted">{t.area.none}</li> : null}
        </ul>
        {rows.length > shown ? (
          <div className="mt-3 text-center">
            <button type="button" className="rounded-lg border border-border px-3 py-1 text-sm" onClick={() => setShown((n) => n + PAGE)}>
              {t.area.more(Math.min(PAGE, rows.length - shown))}
            </button>
          </div>
        ) : null}
      </Card>
    </div>
  );
}

function Row({ plot: p, r, showDistrict, onHover }: { plot: Plot; r?: RankedLand; showDistrict: boolean; onHover: (id: string | null) => void }) {
  return (
    <li onMouseEnter={() => onHover(p.id)} onMouseLeave={() => onHover(null)}>
      <Link href={`/land?id=${p.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 hover:bg-surface-2">
        <div className="min-w-0 flex-1">
          <div className="font-semibold">
            {t.card.plot} {p.plotNumber}
            {showDistrict && p.projectName ? <span className="font-normal"> · {p.projectName}</span> : null}
          </div>
          <div className="text-xs text-muted">
            {num(p.area)} {t.card.m2} · {t.card.ppm} {usd(p.pricePerMeter)} · {t.card.dp} {usd(p.downPayment)}
          </div>
        </div>
        <FeatureBadges
          garden={p.gardenPct > 0}
          corner={p.cornerPct > 0}
          street={isOnMainRoad(p.mainRoadM)}
          sea={p.seaPct > 0}
          nearBuilt={r?.isNearBuilt}
          units={unitsPerFloor(p.area)}
        />
        {r ? <SurvivalBar {...r.survival} /> : null}
        {r ? <RecBadge rec={r.recommendation} /> : null}
      </Link>
    </li>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-sm ${active ? "border-accent bg-accent-soft text-accent" : "border-border hover:bg-surface-2"}`}
    >
      {children}
    </button>
  );
}

function Check({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-1.5">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {label}
    </label>
  );
}

function Dot({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block h-3 w-3 rounded-full ${className}`} />
      {label}
    </span>
  );
}
