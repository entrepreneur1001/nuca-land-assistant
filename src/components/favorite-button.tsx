"use client";

import Link from "next/link";
import { num, t } from "@/i18n/ar";
import { MAX_FAVORITES, toggleFavorite, useFavorites } from "@/lib/favorites";
import { track } from "@/lib/firebase";
import { MAX_FOLLOWS, followKey, toggleFollow, useFollows } from "@/lib/follows";

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
  const n = Object.keys(useFavorites()).length + Object.keys(useFollows()).length;
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

/** «🔔 تابع الحي / المدينة»: get a push when any plot inside gets booked. Explains itself in one line. */
export function FollowButton({ city, district }: { city: string; district?: { id: string; name: string } | null }) {
  const follows = useFollows();
  const key = followKey(city, district?.id);
  const on = !!follows[key];
  const name = district ? district.name : city;
  const click = () => {
    if (!on && Object.keys(follows).length >= MAX_FOLLOWS) {
      alert(t.fav.follow.full(MAX_FOLLOWS));
      return;
    }
    const now = toggleFollow(city, district);
    void track(now ? "follow_add" : "follow_remove", { kind: district ? "district" : "city", city, district: district?.name ?? "" });
  };
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <button
        type="button"
        onClick={click}
        aria-pressed={on}
        className={`rounded-full border px-3 py-1.5 font-semibold ${on ? "border-good bg-good-soft text-good" : "border-accent text-accent hover:bg-accent-soft"}`}
      >
        {on ? t.fav.follow.following : district ? t.fav.follow.district : t.fav.follow.city}
      </button>
      <span className="text-muted">{district ? t.fav.follow.hintDistrict(name) : t.fav.follow.hintCity(name)}</span>
      {on ? (
        <button type="button" onClick={click} className="text-xs text-muted hover:text-bad">
          {t.fav.follow.stop}
        </button>
      ) : null}
    </div>
  );
}
