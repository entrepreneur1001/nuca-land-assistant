"use client";

import { useState } from "react";
import type { FeatureMode, Profile } from "@/engine/scoring";
import { num, t } from "@/i18n/ar";
import { DEFAULT_PROFILE, toQuery } from "@/lib/profile";
import { Card, Segmented } from "./ui";

const MODES: { value: FeatureMode; label: string }[] = [
  { value: "prefer", label: t.profile.modes.prefer },
  { value: "require", label: t.profile.modes.require },
  { value: "ignore", label: t.profile.modes.ignore },
];

function NumberField({
  label,
  placeholder,
  value,
  onCommit,
}: {
  label: string;
  placeholder: string;
  value: number | null;
  onCommit: (n: number | null) => void;
}) {
  const [text, setText] = useState(value == null ? "" : String(value));
  const [prev, setPrev] = useState(value);
  if (prev !== value) {
    setPrev(value);
    setText(value == null ? "" : String(value));
  }
  const commit = () => {
    const ascii = text.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
    const digits = ascii.replace(/[^\d.]/g, "");
    const n = digits ? Number(digits) : null;
    if ((n == null || Number.isFinite(n)) && n !== value) onCommit(n);
  };
  return (
    <label className="block text-xs text-muted">
      {label}
      <input
        inputMode="numeric"
        dir="ltr"
        className="mt-1 w-full rounded-xl border border-border bg-surface-2 px-3 py-2 text-right text-base font-semibold text-text placeholder:font-normal placeholder:text-muted"
        placeholder={placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
      />
    </label>
  );
}

export function ProfileCard({ profile, setProfile, cities }: { profile: Profile; setProfile: (p: Profile) => void; cities: string[] }) {
  const [copied, setCopied] = useState(false);
  const prefs = profile.preferences ?? {};
  const setPref = (k: "garden" | "corner" | "nearBuilt" | "units", v: FeatureMode) => setProfile({ ...profile, preferences: { ...prefs, [k]: v } });
  const share = async () => {
    const url = `${location.origin}${location.pathname}?${toQuery(profile)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      prompt("", url);
    }
  };

  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-bold">{t.profile.title}</h2>
        <span className="text-xs text-muted">{t.profile.hint}</span>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <NumberField
          label={t.profile.rank}
          placeholder={t.profile.rankPlaceholder}
          value={profile.bookingRank}
          onCommit={(n) => setProfile({ ...profile, bookingRank: n == null ? null : Math.round(n) })}
        />
        <NumberField
          label={t.profile.paid}
          placeholder={t.profile.paidPlaceholder}
          value={profile.moneyPaid}
          onCommit={(n) => setProfile({ ...profile, moneyPaid: n })}
        />
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {(
          [
            ["garden", t.profile.garden],
            ["corner", t.profile.corner],
            ["nearBuilt", t.profile.nearBuilt],
            ["units", t.profile.units],
          ] as const
        ).map(([k, label]) => (
          <div key={k} className="flex items-center justify-between gap-2 rounded-xl bg-surface-2 px-3 py-2">
            <span className="text-sm font-medium">{label}</span>
            <Segmented value={(prefs[k] ?? "prefer") as FeatureMode} options={MODES} onChange={(v) => setPref(k, v)} />
          </div>
        ))}
      </div>
      <div className="mt-4">
        <div className="text-xs text-muted">{t.profile.cities}</div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {cities.map((c) => {
            const i = profile.preferredCities.indexOf(c);
            return (
              <button
                key={c}
                type="button"
                onClick={() =>
                  setProfile({
                    ...profile,
                    preferredCities: i >= 0 ? profile.preferredCities.filter((x) => x !== c) : [...profile.preferredCities, c],
                  })
                }
                className={`rounded-full border px-3 py-1 text-sm ${i >= 0 ? "border-accent bg-accent-soft font-medium text-accent" : "border-border text-muted"}`}
              >
                {i >= 0 ? `${num(i + 1)}. ` : ""}
                {c}
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={!!prefs.onlyPreferredCities}
              onChange={(e) => setProfile({ ...profile, preferences: { ...prefs, onlyPreferredCities: e.target.checked } })}
            />
            {t.profile.onlyCities}
          </label>
          <button type="button" onClick={share} className="text-accent">
            {copied ? t.profile.copied : `🔗 ${t.profile.share}`}
          </button>
          <button type="button" onClick={() => setProfile({ ...DEFAULT_PROFILE })} className="text-muted">
            {t.profile.reset}
          </button>
        </div>
      </div>
    </Card>
  );
}
