"use client";

import { useEffect, useState } from "react";
import { t } from "@/i18n/ar";
import { loadPlacesNear, nearestByCategory, placeLogoUrl, type Place, type PlaceCategory } from "@/lib/places";
import { PLACE_COLORS, placeIcon } from "./places-layer";

const ORDER: PlaceCategory[] = ["education", "sport", "health", "shopping", "transport"];
const RANGE_M = 15000;

/** Plot page: the nearest university, club, hospital, mall and station to the plot, with straight-line distances. */
export function NearbyPlaces({ lat, lng }: { lat: number; lng: number }) {
  const [rows, setRows] = useState<{ cat: PlaceCategory; place: Place; m: number }[] | null>(null);
  useEffect(() => {
    let live = true;
    const dLat = RANGE_M / 110540;
    const dLng = RANGE_M / (111320 * Math.cos((lat * Math.PI) / 180));
    void loadPlacesNear([
      [lat - dLat, lng - dLng],
      [lat + dLat, lng + dLng],
    ]).then((places) => {
      if (!live) return;
      const best = nearestByCategory(places, lat, lng, RANGE_M);
      setRows(ORDER.flatMap((cat) => (best[cat] ? [{ cat, ...best[cat]! }] : [])));
    });
    return () => {
      live = false;
    };
  }, [lat, lng]);

  if (!rows?.length) return null;
  return (
    <div className="mt-3 border-t border-border pt-3">
      <h3 className="text-sm font-bold">{t.places.nearest}</h3>
      <ul className="mt-2 grid gap-2 sm:grid-cols-2">
        {rows.map(({ cat, place, m }) => (
          <li key={cat} className="flex items-center gap-2 text-sm">
            <span
              className="nuca-badge is-small shrink-0"
              style={{ ["--badge" as string]: PLACE_COLORS[cat] }}
              dangerouslySetInnerHTML={{ __html: place.logo ? `<img src="${placeLogoUrl(place.logo)}" alt="">` : placeIcon(cat) }}
            />
            <span className="min-w-0">
              <span className="block truncate font-semibold">{place.nameAr ?? place.name}</span>
              <span className="block text-xs text-muted">
                {t.places.sub[place.sub] ?? t.places.cat[cat]} · {t.places.away(m)}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-xs text-muted">{t.places.nearestNote}</p>
    </div>
  );
}
