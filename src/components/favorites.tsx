"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { num, t, usd } from "@/i18n/ar";
import type { Plot } from "@/data/snapshot";
import { acknowledge, bookedChanges, getFavorites, onFavoritesChange, removeFavorite, reopen, useFavorites } from "@/lib/favorites";
import { CURRENT_PHASE, phasePath } from "@/lib/phases";
import { enablePush, syncWatcher, usePushSupport } from "@/lib/push";
import { useApp } from "./app-state";
import { FavoriteButton } from "./favorite-button";
import { Badge, Card } from "./ui";

const label = (p: Plot) => t.fav.label(p.plotNumber, p.projectName, p.cityName);

/** Plot by id for the live snapshot (memoised per snapshot). */
function usePlotIndex() {
  const snapshot = useApp()?.snapshot ?? null;
  return useMemo(() => (snapshot ? new Map(snapshot.plots.map((p) => [p.id, p])) : null), [snapshot]);
}

/**
 * Mounted once in the app layout:
 * - keeps the push copy of the list in step (debounced) and refreshes the push token once per visit;
 * - shows «⚠️ أرض … اللي في مفضلتك اتحجزت» until dismissed, for visitors without push and for open tabs.
 */
export function FavoritesWatcher() {
  const favs = useFavorites();
  const plots = usePlotIndex();
  const path = usePathname();
  const onFavPage = path === "/favorites";

  useEffect(() => {
    void syncWatcher(Object.keys(getFavorites()));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = onFavoritesChange((ids) => {
      clearTimeout(timer);
      timer = setTimeout(() => void syncWatcher(ids), 1500);
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, []);

  const { newly, reopened } = useMemo(() => (plots ? bookedChanges(favs, (id) => plots.get(id)?.status) : { newly: [], reopened: [] }), [favs, plots]);

  useEffect(() => {
    if (reopened.length) reopen(reopened);
    // The list itself marks booked plots, so opening it counts as seeing the notice.
    if (onFavPage && newly.length) acknowledge(newly);
  }, [reopened, newly, onFavPage]);

  if (!plots || !newly.length || onFavPage) return null;
  const first = plots.get(newly[0])!;
  return (
    <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-bad/40 bg-bad-soft px-4 py-3 text-sm">
      <span className="flex-1 font-semibold text-bad">{newly.length === 1 ? t.fav.bookedOne(label(first)) : t.fav.bookedMany(newly.length)}</span>
      <Link href={newly.length === 1 ? `/land?id=${first.id}` : "/favorites"} className="font-semibold text-accent hover:underline">
        {newly.length === 1 ? t.fav.open : t.fav.see}
      </Link>
      <button type="button" onClick={() => acknowledge(newly)} className="rounded-xl bg-surface px-3 py-1 font-semibold hover:bg-surface-2">
        {t.fav.dismiss}
      </button>
    </div>
  );
}

/** «🔔 فعّل الإشعارات», or why it can't be turned on here. */
export function PushPrompt({ compact = false }: { compact?: boolean }) {
  const support = usePushSupport();
  const favs = useFavorites();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  if (support === "unsupported" && compact) return null;
  const text =
    support === "on"
      ? t.fav.push.on
      : support === "denied"
        ? t.fav.push.denied
        : support === "ios-install"
          ? t.fav.push.ios
          : support === "unsupported"
            ? t.fav.push.unsupported
            : t.fav.push.ask;
  const enable = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await enablePush(Object.keys(favs));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={`flex flex-wrap items-center gap-3 rounded-2xl border border-border px-4 py-3 text-sm ${support === "on" ? "bg-good-soft" : "bg-surface-2"}`}>
      <span className="flex-1">{failed ? t.fav.push.error : text}</span>
      {support === "ok" ? (
        <button type="button" disabled={busy} onClick={enable} className="shrink-0 rounded-xl bg-accent px-4 py-2 font-semibold text-white hover:opacity-90 disabled:opacity-60">
          {busy ? t.fav.push.enabling : t.fav.push.enable}
        </button>
      ) : null}
    </div>
  );
}

/** The /favorites page: every saved plot with its live status. */
export function FavoritesList() {
  const app = useApp();
  const favs = useFavorites();
  const plots = usePlotIndex();
  const ids = Object.keys(favs).sort((a, b) => favs[b].at - favs[a].at);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">♥ {t.fav.title}</h1>
        <p className="mt-1 text-sm text-muted">{t.fav.intro}</p>
      </div>
      {ids.length ? <PushPrompt /> : null}
      {!ids.length ? (
        <Card>
          <p>{t.fav.empty}</p>
          <Link href={phasePath.available(CURRENT_PHASE)} className="mt-2 inline-block font-semibold text-accent hover:underline">
            {t.fav.emptyLink}
          </Link>
        </Card>
      ) : !app?.snapshot || !plots ? (
        <div className="py-10 text-center text-muted">{t.loading}</div>
      ) : (
        <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
          {ids.map((id) => {
            const p = plots.get(id);
            if (!p)
              return (
                <li key={id} className="flex items-center gap-3 px-4 py-3 text-sm text-muted">
                  <span className="flex-1">{t.fav.missing}</span>
                  <button type="button" onClick={() => removeFavorite(id)} className="hover:text-bad" aria-label={t.fav.remove} title={t.fav.remove}>
                    ✕
                  </button>
                </li>
              );
            const booked = p.status === "booked";
            return (
              <li key={id} className={`relative flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-surface-2 ${booked ? "opacity-75" : ""}`}>
                <div className="min-w-0 flex-1">
                  <Link href={`/land?id=${p.id}`} className="font-semibold after:absolute after:inset-0">
                    {label(p)}
                  </Link>
                  <div className="text-xs text-muted">
                    {num(p.area)} {t.card.m2} · {t.card.dp} {usd(p.downPayment)} · {t.detail.total} {usd(p.totalPrice)}
                  </div>
                </div>
                {booked ? <Badge tone="bad">{t.detail.booked}</Badge> : p.held ? <Badge tone="warn">{t.fav.held}</Badge> : <Badge tone="good">{t.detail.available}</Badge>}
                <FavoriteButton id={p.id} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
