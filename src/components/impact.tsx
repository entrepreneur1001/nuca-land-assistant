"use client";

import { collection, doc, documentId, getDoc, getDocs, limit, orderBy, query } from "firebase/firestore";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { dateTime, num, t } from "@/i18n/ar";
import { firestore } from "@/lib/firebase";
import { useLive } from "@/lib/live";
import type { Plot } from "@/data/snapshot";
import { Card, Stat } from "./ui";

/** What the sync job writes to `stats/impact` (scripts/ingest.mts). */
interface ImpactDoc {
  watchers?: number;
  totals?: { sent?: number; failed?: number; plots?: number };
  daily?: Record<string, { sent?: number; plots?: number; people?: number }>;
  census?: { at: string; people: number; plotsSaved: number; areasFollowed: number; topAreas: { key: string; name?: string; n: number }[]; topPlots: { key: string; n: number }[] };
}

const GA_URL = "https://console.firebase.google.com/project/nuca-lands-assistant/analytics";
const TZ = "Africa/Cairo";
const dayKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: TZ });
const shortDay = (k: string) => new Date(`${k}T12:00:00`).toLocaleDateString("ar-EG", { day: "numeric", month: "numeric" });
const axis = { stroke: "var(--muted)", fontSize: 11, tickLine: false, axisLine: false } as const;

function plotLabel(p: Plot | undefined): string {
  if (!p) return t.card.plot;
  return [`${t.card.plot} ${p.plotNumber}`, p.projectName, p.cityName].filter(Boolean).join(" · ");
}

export function Impact() {
  const [data, setData] = useState<{ stats: ImpactDoc; opens: Map<string, number>; now: number } | null>(null);
  const [error, setError] = useState(false);
  // Names for the most-saved plots («قطعة ١٢ · الحي · المدينة»); until the live data loads they read «قطعة».
  const { snapshot } = useLive();
  const plotsById = useMemo(() => new Map((snapshot?.plots ?? []).map((p) => [p.id, p])), [snapshot]);

  useEffect(() => {
    (async () => {
      const db = firestore();
      const [s, o] = await Promise.all([getDoc(doc(db, "stats", "impact")), getDocs(query(collection(db, "opens"), orderBy(documentId(), "desc"), limit(90)))]);
      setData({ stats: (s.data() as ImpactDoc) ?? {}, opens: new Map(o.docs.map((d) => [d.id, Number(d.data().n) || 0])), now: Date.now() });
    })().catch(() => setError(true));
  }, []);

  if (error) return <Card>{t.impact.empty}</Card>;
  if (!data) return <div className="py-20 text-center text-muted">{t.loading}</div>;
  const { stats, opens, now } = data;
  const daily = stats.daily ?? {};
  const days = Array.from({ length: 30 }, (_, i) => dayKey(new Date(now - (29 - i) * 86_400_000)));
  const chart = days.map((d) => ({ day: shortDay(d), sent: daily[d]?.sent ?? 0, opens: opens.get(d) ?? 0 }));
  const last7 = days.slice(-7);
  const sent7 = last7.reduce((a, d) => a + (daily[d]?.sent ?? 0), 0);
  const opens7 = last7.reduce((a, d) => a + (opens.get(d) ?? 0), 0);
  const sent = stats.totals?.sent ?? 0;
  const opened = [...opens.values()].reduce((a, b) => a + b, 0);
  const c = stats.census;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">📈 {t.impact.title}</h1>
        <p className="mt-1 text-sm text-muted">{t.impact.intro}</p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label={t.impact.people} value={num(stats.watchers ?? 0)} tone="good" />
        <Stat label={t.impact.sent} value={num(sent)} sub={t.impact.last7(sent7)} />
        <Stat label={t.impact.opens} value={num(opened)} sub={sent ? t.impact.openRate(opened / sent) : t.impact.last7(opens7)} />
        <Stat label={t.impact.plots} value={num(stats.totals?.plots ?? 0)} />
        <Stat label={t.impact.saved} value={c ? num(c.plotsSaved) : "—"} />
        <Stat label={t.impact.followed} value={c ? num(c.areasFollowed) : "—"} />
      </div>
      <Card>
        <h2 className="font-bold">{t.impact.daily}</h2>
        <div className="mt-3 h-56" dir="ltr">
          <ResponsiveContainer>
            <BarChart data={chart}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis dataKey="day" {...axis} interval={4} />
              <YAxis {...axis} width={32} allowDecimals={false} />
              <Tooltip formatter={(v) => num(Number(v))} contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} />
              <Legend />
              <Bar dataKey="sent" name={t.impact.sentS} fill="var(--accent)" radius={[3, 3, 0, 0]} />
              <Bar dataKey="opens" name={t.impact.opensS} fill="var(--good)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
      {c ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <h2 className="mb-2 font-bold">{t.impact.topAreas}</h2>
            <ul className="space-y-1 text-sm">
              {c.topAreas.map((a) => (
                <li key={a.key} className="flex justify-between gap-2">
                  <span>{a.name ?? a.key}</span>
                  <span className="text-muted">{t.impact.followedBy(a.n)}</span>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <h2 className="mb-2 font-bold">{t.impact.topPlots}</h2>
            <ul className="space-y-1 text-sm">
              {c.topPlots.map((p) => (
                <li key={p.key} className="flex justify-between gap-2">
                  <Link href={`/land?id=${encodeURIComponent(p.key)}`} className="text-accent hover:underline">
                    {plotLabel(plotsById.get(p.key))} ↗
                  </Link>
                  <span className="text-muted">{t.impact.savedBy(p.n)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ) : null}
      <p className="text-xs text-muted">{c ? t.impact.census(dateTime(c.at)) : t.impact.noCensus}</p>
      <a href={GA_URL} target="_blank" rel="noopener" className="inline-block font-semibold text-accent hover:underline">
        {t.impact.ga} ↗
      </a>
    </div>
  );
}
