/**
 * Private compounds on the Leaflet maps: an outline with the compound's name, filled with its master plan where one
 * could be fitted and tinted otherwise, under everything of ours, so a
 * buyer sees what is being built next to a plot. Tapping one opens its name, developer and, near our land, its approximate starting price.
 * Plain TypeScript: the maps import Leaflet dynamically, so the module is passed in rather than imported.
 */
import type * as Leaflet from "leaflet";
import { t } from "@/i18n/ar";
import { compoundContains, compoundImageUrl, compoundInView, compoundLogoUrl, type Compound } from "@/lib/compounds";
import { compoundsPref } from "@/lib/map-prefs";
import { addToggle, cullOverlaps } from "./map-controls";
import { rotatedImage } from "./plan-layer";
import { polygonArea, polygonCentroid } from "./plan-labels";

type L = typeof Leaflet;

const PANE = "nucaCompound";
/** Under the earlier-stage plans (380) and the current ones (390): our own plots are never covered. */
const PANE_Z = "370";
const COLOR = "#a855f7"; // = --compound in globals.css
/** Developer logos stand in for names when zoomed out, above our plot numbers (450) but under popups. */
const BADGE_PANE = "nucaCompoundBadge";
const BADGE_PANE_Z = "455";
/** Names appear from this zoom: further out a city's compounds are too small to label without a pile-up. */
const LABEL_ZOOM = 14;
/** How far from the land the map opened on a compound still counts as its neighbour. */
const NEAR_M = 3000;

/** The widest the maps ever go: about one city across (some 40 km on a laptop, 14 km on a phone). */
const CITY_ZOOM = 12;
/** How far past the opening view the map may be dragged. */
const ROAM_M = 15000;

/**
 * Keeps a map on its land: it opens on the plots and can zoom out to city level at most (never the whole country),
 * nor be dragged far away. Call once the opening view is set; an opening view wider than a city is narrowed to one.
 */
export function limitToCity(map: Leaflet.Map): void {
  if (map.getZoom() < CITY_ZOOM) map.setView(map.getCenter(), CITY_ZOOM, { animate: false });
  map.setMinZoom(CITY_ZOOM);
  const b = map.getBounds();
  const dLat = ROAM_M / 110540;
  const dLng = ROAM_M / (111320 * Math.cos((b.getCenter().lat * Math.PI) / 180));
  map.setMaxBounds([
    [b.getSouth() - dLat, b.getWest() - dLng],
    [b.getNorth() + dLat, b.getEast() + dLng],
  ]);
  map.options.maxBoundsViscosity = 1;
}

export interface CompoundLayer {
  /** Whether any compound lies within the area the map can be dragged over (for the legend). */
  any: boolean;
  remove(): void;
}

function popupContent(c: Compound, price: boolean): HTMLElement {
  const el = document.createElement("div");
  el.dir = "rtl";
  // Leaflet aligns its popups left whatever the direction.
  Object.assign(el.style, { minWidth: "200px", textAlign: "right" });
  const title = document.createElement("div");
  Object.assign(title.style, { fontWeight: "700", fontSize: "14px", display: "flex", alignItems: "center", gap: "8px" });
  if (c.devLogo) {
    const logo = document.createElement("img");
    logo.src = compoundLogoUrl(c.devLogo);
    logo.alt = "";
    Object.assign(logo.style, { width: "28px", height: "28px", objectFit: "contain", borderRadius: "6px", border: "1px solid #ddd", background: "#fff" });
    title.append(logo);
  }
  title.append(document.createTextNode(c.nameAr ?? c.name));
  el.append(title);
  if (c.nameAr && c.nameAr !== c.name) {
    const latin = document.createElement("div");
    latin.textContent = c.name;
    Object.assign(latin.style, { fontSize: "12px", color: "#666" });
    el.append(latin);
  }
  const sub = [c.devAr ?? c.dev, c.areaAr ?? c.area].filter(Boolean).join(" · ");
  if (sub) {
    const line = document.createElement("div");
    line.textContent = sub;
    Object.assign(line.style, { fontSize: "12px", margin: "2px 0 6px" });
    el.append(line);
  }
  if (price && c.price != null) {
    const line = document.createElement("div");
    line.textContent = t.compound.from(c.price);
    Object.assign(line.style, { fontSize: "13px", fontWeight: "600", margin: "0 0 6px" });
    el.append(line);
  }
  return el;
}

/**
 * Draws the compounds that touch the view (the index covers the whole country) and adds the «كمبوندات» button that
 * hides them. The outlines take no mouse events themselves: a tap is read off the map, and only when it landed on
 * nothing of ours, so plots and districts on top of a compound keep working whatever renderer the map uses.
 */
export function addCompounds(L: L, map: Leaflet.Map, compounds: readonly Compound[]): CompoundLayer {
  if (!map.getPane(PANE)) map.createPane(PANE).style.zIndex = PANE_Z;
  if (!map.getPane(BADGE_PANE)) map.createPane(BADGE_PANE).style.zIndex = BADGE_PANE_Z;
  // Its own SVG renderer: a canvas per pane would swallow the taps meant for the layers below it.
  const renderer = L.svg({ pane: PANE });
  const made = new Map<number, Leaflet.Polygon>();
  const badges = new Map<number, Leaflet.Marker>();
  // Master plans that could be placed on the ground are drawn inside their outline, like the official plans.
  const Img = rotatedImage(L);
  const images = new Map<number, InstanceType<typeof Img>>();
  // Bigger compounds win when names or logos collide.
  const size = new Map(compounds.map((c) => [c.id, polygonArea(c.ring)]));
  const ordered = [...compounds].sort((a, b) => size.get(b.id)! - size.get(a.id)!);
  let on = compoundsPref.get();
  // Prices are shown for the compounds around our land only: those within NEAR_M of what the map opened on.
  const home = map.getBounds();
  const near: [[number, number], [number, number]] = (() => {
    const dLat = NEAR_M / 110540;
    const dLng = NEAR_M / (111320 * Math.cos((home.getCenter().lat * Math.PI) / 180));
    return [
      [home.getSouth() - dLat, home.getWest() - dLng],
      [home.getNorth() + dLat, home.getEast() + dLng],
    ];
  })();
  const openPopup = (c: Compound, at: Leaflet.LatLngExpression) =>
    L.popup({ maxWidth: 280, autoPanPadding: [60, 16] }).setLatLng(at).setContent(popupContent(c, compoundInView(c, near))).openOn(map);
  const labelHtml = (c: Compound) => {
    const el = document.createElement("span");
    if (c.devLogo) {
      const img = document.createElement("img");
      img.src = compoundLogoUrl(c.devLogo);
      img.alt = "";
      img.loading = "lazy";
      el.append(img);
    }
    el.append(document.createTextNode(c.nameAr ?? c.name));
    return el;
  };
  const badgeFor = (c: Compound) => {
    const [lat, lng] = polygonCentroid(c.ring);
    const icon = L.divIcon({
      className: "",
      html: `<div class="nuca-badge is-small" style="--badge:${COLOR}"><img src="${compoundLogoUrl(c.devLogo!)}" alt="" loading="lazy"></div>`,
      iconSize: [22, 22],
      iconAnchor: [11, 11],
    });
    return L.marker([lat, lng], { icon, pane: BADGE_PANE, keyboard: false, title: c.nameAr ?? c.name }).on("click", (e) => openPopup(c, e.latlng));
  };
  const sync = () => {
    const b = map.getBounds();
    const view: [[number, number], [number, number]] = [
      [b.getSouth(), b.getWest()],
      [b.getNorth(), b.getEast()],
    ];
    const labels = map.getZoom() >= LABEL_ZOOM;
    const shown: HTMLElement[] = [];
    for (const c of ordered) {
      const want = on && compoundInView(c, view);
      let shape = made.get(c.id);
      if (want && !shape) {
        shape = L.polygon(c.ring, { pane: PANE, renderer, interactive: false, color: COLOR, weight: 2, opacity: 0.95, fillColor: COLOR, fillOpacity: c.plan ? 0 : 0.18 });
        shape.bindTooltip(labelHtml(c), { permanent: true, direction: "center", interactive: false, className: "nuca-map-label nuca-compound-label" });
        made.set(c.id, shape);
      }
      if (c.plan) {
        let image = images.get(c.id);
        if (want && !image) {
          const clip = `polygon(${c.plan.clip.map(([x, y]) => `${x}px ${y}px`).join(", ")})`;
          const corners = [c.plan.corners.tl, c.plan.corners.tr, c.plan.corners.bl].map(([lat, lng]) => L.latLng(lat, lng));
          image = new Img(compoundImageUrl(c.id), corners, c.plan.w, c.plan.h, { opacity: 0.92, pane: PANE }, clip);
          images.set(c.id, image);
        }
        if (image && want && !image._failed) image.addTo(map);
        else if (image) {
          // Out of view: drop it altogether so a long pan across a city doesn't keep every plan decoded.
          map.removeLayer(image);
          images.delete(c.id);
        }
      }
      // Zoomed out, a compound is its developer's logo; zoomed in, its name (with the logo).
      if (c.devLogo) {
        let badge = badges.get(c.id);
        if (want && !labels) {
          if (!badge) badges.set(c.id, (badge = badgeFor(c)));
          badge.addTo(map);
          const el = badge.getElement();
          if (el) shown.push(el);
        } else if (badge) map.removeLayer(badge);
      }
      if (!shape) continue;
      if (want) {
        shape.addTo(map);
        if (labels) {
          shape.openTooltip();
          const el = shape.getTooltip()?.getElement();
          if (el) shown.push(el);
        } else shape.closeTooltip();
      } else map.removeLayer(shape);
    }
    cullOverlaps(shown);
  };
  const tap = (e: Leaflet.LeafletMouseEvent) => {
    // A tap on a plot, a dot or a district circle reaches the map too, with that layer as its source.
    if (!on || (e as unknown as { sourceTarget?: unknown }).sourceTarget !== map) return;
    const hit = compounds.find((c) => compoundContains(c, e.latlng.lat, e.latlng.lng));
    if (hit) openPopup(hit, e.latlng);
  };
  map.on("moveend zoomend", sync);
  map.on("click", tap);
  sync();

  const control = addToggle(L, map, {
    label: t.compound.toggle,
    title: t.compound.toggleTitle,
    pref: compoundsPref,
    swatch: COLOR,
    onChange: (v) => {
      on = v;
      if (!on) map.closePopup();
      sync();
    },
  });

  const max = map.options.maxBounds;
  const reach = max ? (max instanceof L.LatLngBounds ? max : L.latLngBounds(max)) : map.getBounds();
  const reachBox: [[number, number], [number, number]] = [
    [reach.getSouth(), reach.getWest()],
    [reach.getNorth(), reach.getEast()],
  ];
  return {
    any: compounds.some((c) => compoundInView(c, reachBox)),
    remove() {
      map.off("moveend zoomend", sync);
      map.off("click", tap);
      control.remove();
      for (const shape of made.values()) map.removeLayer(shape);
      for (const image of images.values()) map.removeLayer(image);
      for (const badge of badges.values()) map.removeLayer(badge);
      images.clear();
      badges.clear();
      made.clear();
    },
  };
}
