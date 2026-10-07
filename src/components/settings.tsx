"use client";

import { useState } from "react";
import useSWR from "swr";
import { DEFAULT_WEIGHTS } from "@/engine/config";
import { fetcher, type SummaryResponse } from "@/lib/client";
import type { ProfileRow } from "@/lib/profile";
import { Card } from "./ui";

type Mode = "ignore" | "prefer" | "require";
const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s));

export function Settings() {
  const { data: profile, mutate } = useSWR<ProfileRow>("/api/profile", fetcher);
  const { data: summary } = useSWR<SummaryResponse>("/api/summary", fetcher);
  const [saved, setSaved] = useState(false);
  if (!profile) return <div className="py-20 text-center text-muted">Loading…</div>;
  return (
    <>
      <SettingsForm key={profile.updatedAt} profile={profile} allCities={summary?.cities ?? []} onSaved={() => { setSaved(true); void mutate(); }} />
      {saved ? <p className="mt-3 text-sm text-good">Saved. The dashboard will recalculate.</p> : null}
    </>
  );
}

const str = (v: number | null | undefined) => (v == null ? "" : String(v));

function SettingsForm({ profile, allCities, onSaved }: { profile: ProfileRow; allCities: string[]; onSaved: () => void }) {
  const [form, setForm] = useState<Record<string, string>>(() => ({
    bookingRank: str(profile.bookingRank),
    moneyPaid: str(profile.moneyPaid),
    moneyAvailable: str(profile.moneyAvailable),
    maxAdditional: str(profile.maxAdditional),
    minArea: str(profile.minArea),
    maxArea: str(profile.maxArea),
    preferredArea: str(profile.preferredArea),
    maxPrice: str(profile.maxPrice),
    preferredPricePerMeter: str(profile.preferredPricePerMeter),
  }));
  const [cities, setCities] = useState<string[]>(profile.preferredCities);
  const [projects, setProjects] = useState(profile.preferredProjects.join("\n"));
  const [garden, setGarden] = useState<Mode>(profile.preferences?.garden ?? "prefer");
  const [corner, setCorner] = useState<Mode>(profile.preferences?.corner ?? "prefer");
  const [onlyPreferred, setOnlyPreferred] = useState(!!profile.preferences?.onlyPreferredCities);
  const [weights, setWeights] = useState<Record<string, number>>({ ...DEFAULT_WEIGHTS, ...(profile.weights ?? {}) });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async () => {
    setMsg(null);
    const body = {
      bookingRank: Number(form.bookingRank),
      moneyPaid: Number(form.moneyPaid),
      moneyAvailable: numOrNull(form.moneyAvailable ?? ""),
      maxAdditional: Number(form.maxAdditional || 0),
      minArea: numOrNull(form.minArea ?? ""),
      maxArea: numOrNull(form.maxArea ?? ""),
      preferredArea: numOrNull(form.preferredArea ?? ""),
      maxPrice: numOrNull(form.maxPrice ?? ""),
      preferredPricePerMeter: numOrNull(form.preferredPricePerMeter ?? ""),
      preferredCities: cities,
      preferredProjects: projects.split("\n").map((s) => s.trim()).filter(Boolean),
      weights,
      preferences: { garden, corner, onlyPreferredCities: onlyPreferred },
    };
    const r = await fetch("/api/profile", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (r.ok) {
      onSaved();
    } else {
      const j = await r.json().catch(() => ({}));
      setMsg({ ok: false, text: `Could not save: ${JSON.stringify(j.error ?? r.status)}` });
    }
  };

  const input = "mt-0.5 w-full rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm text-text";
  const field = (key: string, label: string, hint?: string) => (
    <label className="text-sm text-muted">
      {label}
      <input className={input} inputMode="decimal" value={form[key] ?? ""} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} />
      {hint ? <span className="text-xs">{hint}</span> : null}
    </label>
  );

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Settings</h1>
      <Card>
        <h2 className="font-semibold">Your booking</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {field("bookingRank", "Booking rank")}
          {field("moneyPaid", "Money already paid (USD)", "Covers plots with down payment ≤ this")}
          {field("maxAdditional", "Max additional I can pay (USD)", "Allows plots with a larger down payment")}
          {field("moneyAvailable", "Money available overall (USD)", "Optional; affects budget fit")}
        </div>
      </Card>
      <Card>
        <h2 className="font-semibold">Plot preferences</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {field("minArea", "Min area m²")}
          {field("maxArea", "Max area m²")}
          {field("preferredArea", "Preferred area m²")}
          {field("maxPrice", "Max total price (USD)")}
          {field("preferredPricePerMeter", "Target $/m²")}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {([["🌳 Garden view (حديقة)", garden, setGarden], ["📐 Corner (ناصية)", corner, setCorner]] as const).map(([label, v, set]) => (
            <label key={label} className="text-sm text-muted">
              {label}
              <select className={input} value={v} onChange={(e) => set(e.target.value as Mode)}>
                <option value="prefer">Prefer (boost score)</option>
                <option value="require">Require (only show these)</option>
                <option value="ignore">Ignore</option>
              </select>
            </label>
          ))}
        </div>
      </Card>
      <Card>
        <h2 className="font-semibold">Preferred cities</h2>
        <p className="text-xs text-muted">Tap in order of priority; the first tapped ranks highest.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {allCities.map((c) => {
            const i = cities.indexOf(c);
            return (
              <button
                key={c}
                onClick={() => setCities((xs) => (i >= 0 ? xs.filter((x) => x !== c) : [...xs, c]))}
                className={`rounded-full border px-3 py-1 text-sm ${i >= 0 ? "border-accent bg-accent-soft text-accent" : "border-border text-muted"}`}
              >
                {i >= 0 ? `${i + 1}. ` : ""}{c}
              </button>
            );
          })}
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={onlyPreferred} onChange={(e) => setOnlyPreferred(e.target.checked)} /> Only show plots in preferred cities
        </label>
        <label className="mt-3 block text-sm text-muted">
          Preferred projects (one per line, exact sector name, highest priority first)
          <textarea className={`${input} h-24`} dir="auto" value={projects} onChange={(e) => setProjects(e.target.value)} />
        </label>
      </Card>
      <Card>
        <h2 className="font-semibold">Scoring weights</h2>
        <p className="text-xs text-muted">Relative importance of each factor in the 0–100 score.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {Object.keys(DEFAULT_WEIGHTS).map((k) => (
            <label key={k} className="flex items-center gap-3 text-sm">
              <span className="w-28 capitalize text-muted">{k}</span>
              <input type="range" min={0} max={50} value={weights[k] ?? 0} onChange={(e) => setWeights((w) => ({ ...w, [k]: Number(e.target.value) }))} className="flex-1" />
              <span className="w-8 text-right">{weights[k]}</span>
            </label>
          ))}
        </div>
        <button className="mt-3 text-xs text-accent" onClick={() => setWeights({ ...DEFAULT_WEIGHTS })}>Reset to defaults</button>
      </Card>
      <div className="flex items-center gap-3">
        <button onClick={save} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white">Save</button>
        {msg ? <span className={`text-sm ${msg.ok ? "text-good" : "text-bad"}`}>{msg.text}</span> : null}
      </div>
    </div>
  );
}
