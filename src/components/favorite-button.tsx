"use client";

import Link from "next/link";
import { num, t } from "@/i18n/ar";
import { MAX_FAVORITES, toggleFavorite, useFavorites } from "@/lib/favorites";
import { track } from "@/lib/firebase";

/**
 * ♡ / ♥: saves a plot to «المفضلة». Sits above a card's stretched plot link (`relative z-10`) and stops the click
 * from following a link it is nested in.
 */
export function FavoriteButton({ id, className = "", label = false }: { id: string; className?: string; label?: boolean }) {
  const favs = useFavorites();
  const on = !!favs[id];
  const click = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!on && Object.keys(favs).length >= MAX_FAVORITES) {
      alert(t.fav.full(MAX_FAVORITES));
      return;
    }
    const now = toggleFavorite(id);
    void track(now ? "fav_add" : "fav_remove", { id });
  };
  const title = on ? t.fav.remove : t.fav.add;
  return (
    <button
      type="button"
      onClick={click}
      aria-pressed={on}
      aria-label={title}
      title={title}
      className={`relative z-10 inline-flex shrink-0 items-center gap-1 rounded-full leading-none transition ${
        label ? "border border-border px-3 py-1.5 text-sm hover:border-bad" : "p-1 text-lg hover:scale-110"
      } ${on ? "text-bad" : "text-muted hover:text-bad"} ${className}`}
    >
      <span aria-hidden>{on ? "♥" : "♡"}</span>
      {label ? <span className="text-text">{title}</span> : null}
    </button>
  );
}

/** «♥ المفضلة ٣» in the top bar. */
export function FavoritesLink() {
  const n = Object.keys(useFavorites()).length;
  return (
    <Link href="/favorites" className="hover:text-text">
      <span className={n ? "text-bad" : ""} aria-hidden>
        {n ? "♥" : "♡"}
      </span>{" "}
      {t.nav.favorites}
      {n ? <span className="ms-1 rounded-full bg-bad-soft px-1.5 text-xs text-bad">{num(n)}</span> : null}
    </Link>
  );
}
