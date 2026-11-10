/**
 * Places around the land on the Leaflet maps (src/lib/places.ts): each one a round badge with its logo or a
 * category icon, its outline when it is an area, and its name when zoomed in. Tapping one opens its name, kind and
 * distance from the plot (or the land the map opened on). Plain TypeScript: Leaflet is passed in.
 */
import type * as Leaflet from "leaflet";
import { t } from "@/i18n/ar";
import { placesPref } from "@/lib/map-prefs";
import { distanceM, placeLogoUrl, type Place, type PlaceCategory } from "@/lib/places";
import { addToggle, cullOverlaps } from "./map-controls";
import { polygonArea } from "./plan-labels";

type L = typeof Leaflet;

/** Outlines over the compounds (370), under the earlier stages (380) and our plans. */
const PANE = "nucaPlaces";
const PANE_Z = "375";
const BADGE_PANE = "nucaPlaceBadge";
const BADGE_PANE_Z = "456";

/** Badges show from this zoom; schools and other small places from MINOR_ZOOM; names from NAME_ZOOM. */
const BADGE_ZOOM = 12;
const MINOR_ZOOM = 15;
const NAME_ZOOM = 15;
const OUTLINE_ZOOM = 14;

export const PLACE_COLORS: Record<PlaceCategory, string> = {
  education: "#2563eb",
  sport: "#0d9488",
  health: "#e11d48",
  shopping: "#db2777",
  transport: "#0369a1",
  landmark: "#b45309",
};

const ICONS: Record<PlaceCategory, string> = {
  education: '<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c3 2 9 2 12 0v-5"/>',
  sport: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3.5 3 3.5 15 0 18M12 3c-3.5 3-3.5 15 0 18"/>',
  health: '<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/>',
  shopping: '<path d="M5 8h14l-1 13H6z"/><path d="M9 8V6a3 3 0 016 0v2"/>',
  transport: '<rect x="6" y="3" width="12" height="13" rx="3"/><path d="M6 10h12M9 20l-2 2M15 20l2 2"/>',
  landmark: '<path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>',
};

export const placeIcon = (cat: PlaceCategory) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">${ICONS[cat] ?? ICONS.landmark}</svg>`;

const MINOR = new Set(["school", "clinic", "sports_centre", "worship", "mosque", "church", "bus", "government"]);
const kind = (p: Place) => t.places.sub[p.sub] ?? t.places.cat[p.cat] ?? "";
const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function popupContent(p: Place, from: Leaflet.LatLng): HTMLElement {
  const el = document.createElement("div");
  el.dir = "rtl";
  Object.assign(el.style, { minWidth: "180px", textAlign: "right" });
  const head = document.createElement("div");
  Object.assign(head.style, { display: "flex", alignItems: "center", gap: "8px", fontWeight: "700", fontSize: "14px" });
  const badge = document.createElement("span");
  badge.className = "nuca-badge";
  badge.style.setProperty("--badge", PLACE_COLORS[p.cat]);
  badge.innerHTML = p.logo ? `<img src="${placeLogoUrl(p.logo)}" alt="">` : placeIcon(p.cat);
  head.append(badge, document.createTextNode(p.nameAr ?? p.name));
  el.append(head);
  if (p.nameAr && p.nameAr !== p.name) {
    const latin = document.createElement("div");
    latin.textContent = p.name;
    Object.assign(latin.style, { fontSize: "12px", color: "#666", marginTop: "2px" });
    el.append(latin);
  }
  const line = document.createElement("div");
  line.textContent = [kind(p), t.places.away(distanceM(from.lat, from.lng, p.lat, p.lng))].filter(Boolean).join(" · ");
  Object.assign(line.style, { fontSize: "12px", marginTop: "4px" });
  el.append(line);
  return el;
}

export interface PlacesLayer {
  remove(): void;
}

/**
 * Draws `places` that touch the view and adds the «أماكن» button. `from` is what distances are measured from:
 * the plot on a plot's map, the centre of the opening view otherwise.
 */
export function addPlaces(L: L, map: Leaflet.Map, places: readonly Place[], from?: Leaflet.LatLng): PlacesLayer {
  if (!map.getPane(PANE)) map.createPane(PANE).style.zIndex = PANE_Z;
  if (!map.getPane(BADGE_PANE)) map.createPane(BADGE_PANE).style.zIndex = BADGE_PANE_Z;
  const origin = from ?? map.getCenter();
  const renderer = L.svg({ pane: PANE });
  // Places with a logo first, then the bigger ones: they win when badges collide.
  const weight = (p: Place) => (p.logo ? 1e9 : 0) + (MINOR.has(p.sub) ? 0 : 1e8) + (p.ring ? Math.min(polygonArea(p.ring) * 1e10, 9e7) : 0);
  const ordered = [...places].sort((a, b) => weight(b) - weight(a));
  const markers = new Map<string, Leaflet.Marker>();
  const outlines = new Map<string, Leaflet.Polygon>();
  let on = placesPref.get();

  const markerFor = (p: Place) => {
    const color = PLACE_COLORS[p.cat] ?? PLACE_COLORS.landmark;
    const inner = p.logo ? `<img src="${placeLogoUrl(p.logo)}" alt="" loading="lazy">` : placeIcon(p.cat);
    const small = MINOR.has(p.sub) ? " is-small" : "";
    const px = small ? 22 : 28;
    const icon = L.divIcon({ className: "", html: `<div class="nuca-badge${small}" style="--badge:${color}">${inner}</div>`, iconSize: [px, px], iconAnchor: [px / 2, px / 2] });
    const m = L.marker([p.lat, p.lng], { icon, pane: BADGE_PANE, keyboard: false, title: p.nameAr ?? p.name });
    m.bindTooltip(escape(p.nameAr ?? p.name), { permanent: true, direction: "bottom", offset: [0, px / 2], interactive: false, className: "nuca-map-label", pane: BADGE_PANE });
    m.on("click", () => L.popup({ maxWidth: 260, autoPanPadding: [60, 16], offset: [0, -px / 2] }).setLatLng([p.lat, p.lng]).setContent(popupContent(p, origin)).openOn(map));
    return m;
  };

  const sync = () => {
    const z = map.getZoom();
    const b = map.getBounds().pad(0.1);
    const names = z >= NAME_ZOOM;
    const shown: HTMLElement[][] = [];
    for (const p of ordered) {
      const visible = on && z >= (MINOR.has(p.sub) ? MINOR_ZOOM : BADGE_ZOOM) && b.contains([p.lat, p.lng]);
      let m = markers.get(p.id);
      if (visible) {
        if (!m) markers.set(p.id, (m = markerFor(p)));
        m.addTo(map);
        if (names) m.openTooltip();
        else m.closeTooltip();
        const tip = names ? m.getTooltip()?.getElement() : null;
        shown.push([m.getElement(), tip].filter((e): e is HTMLElement => !!e));
      } else if (m) map.removeLayer(m);

      if (p.ring && p.ring.length >= 3) {
        let o = outlines.get(p.id);
        if (visible && z >= OUTLINE_ZOOM) {
          const color = PLACE_COLORS[p.cat] ?? PLACE_COLORS.landmark;
          if (!o) outlines.set(p.id, (o = L.polygon(p.ring, { pane: PANE, renderer, interactive: false, color, weight: 1.5, opacity: 0.9, dashArray: "4 4", fillColor: color, fillOpacity: 0.08 })));
          o.addTo(map);
        } else if (o) map.removeLayer(o);
      }
    }
    cullOverlaps(shown, 3);
  };
  map.on("moveend zoomend", sync);
  sync();

  const control = places.length
    ? addToggle(L, map, {
        label: t.places.toggle,
        title: t.places.toggleTitle,
        pref: placesPref,
        swatch: PLACE_COLORS.education,
        onChange: (v) => {
          on = v;
          if (!on) map.closePopup();
          sync();
        },
      })
    : null;

  return {
    remove() {
      map.off("moveend zoomend", sync);
      control?.remove();
      for (const m of markers.values()) map.removeLayer(m);
      for (const o of outlines.values()) map.removeLayer(o);
      markers.clear();
      outlines.clear();
    },
  };
}
