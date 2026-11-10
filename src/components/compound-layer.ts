/**
 * Private compounds on the Leaflet maps: a tinted outline with the compound's name, under everything of ours, so a
 * buyer sees what is being built next to a plot. Tapping one opens its name, developer, master plan and, near our land, its approximate starting price.
 * Plain TypeScript: the maps import Leaflet dynamically, so the module is passed in rather than imported.
 */
import type * as Leaflet from "leaflet";
import { t } from "@/i18n/ar";
import { compoundContains, compoundImageUrl, compoundInView, compoundSourceUrl, type Compound } from "@/lib/compounds";
import { compoundsShown, setCompoundsShown } from "@/lib/map-prefs";

type L = typeof Leaflet;

const PANE = "nucaCompound";
/** Under the earlier-stage plans (380) and the current ones (390): our own plots are never covered. */
const PANE_Z = "370";
const COLOR = "#a855f7";
/** Names appear from this zoom: further out a city's compounds are too small to label without a pile-up. */
const LABEL_ZOOM = 14;
/** How far from the land the map opened on a compound still counts as its neighbour. */
const NEAR_M = 3000;

export interface CompoundLayer {
  remove(): void;
}

function popupContent(c: Compound, price: boolean): HTMLElement {
  const el = document.createElement("div");
  el.dir = "rtl";
  // Leaflet aligns its popups left whatever the direction.
  Object.assign(el.style, { minWidth: "200px", textAlign: "right" });
  const title = document.createElement("div");
  title.textContent = c.nameAr ?? c.name;
  Object.assign(title.style, { fontWeight: "700", fontSize: "14px" });
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
    line.title = t.compound.fromNote;
    Object.assign(line.style, { fontSize: "13px", fontWeight: "600", margin: "0 0 6px" });
    el.append(line);
  }
  if (c.img) {
    const a = document.createElement("a");
    a.href = compoundImageUrl(c.id);
    a.target = "_blank";
    a.rel = "noopener";
    a.title = t.compound.openPlan;
    const img = document.createElement("img");
    img.src = compoundImageUrl(c.id);
    img.alt = t.compound.plan;
    // A fixed box: the popup is placed before the image arrives, so its height must not depend on it.
    Object.assign(img.style, { display: "block", width: "240px", maxWidth: "100%", height: "150px", objectFit: "contain", borderRadius: "6px", background: "#f3f3f3" });
    // A plan that fails to load just leaves the text.
    img.onerror = () => a.remove();
    a.append(img);
    el.append(a);
  }
  const src = document.createElement("a");
  src.href = compoundSourceUrl(c);
  src.target = "_blank";
  src.rel = "noopener";
  src.textContent = t.compound.source;
  Object.assign(src.style, { display: "inline-block", marginTop: "6px", fontSize: "12px" });
  el.append(src);
  return el;
}

/**
 * Draws the compounds that touch the view (the index covers the whole country) and adds the «كمبوندات» button that
 * hides them. The outlines take no mouse events themselves: a tap is read off the map, and only when it landed on
 * nothing of ours, so plots and districts on top of a compound keep working whatever renderer the map uses.
 */
export function addCompounds(L: L, map: Leaflet.Map, compounds: readonly Compound[]): CompoundLayer {
  if (!map.getPane(PANE)) map.createPane(PANE).style.zIndex = PANE_Z;
  // Its own SVG renderer: a canvas per pane would swallow the taps meant for the layers below it.
  const renderer = L.svg({ pane: PANE });
  const made = new Map<number, Leaflet.Polygon>();
  let on = compoundsShown();
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
  const sync = () => {
    const b = map.getBounds();
    const view: [[number, number], [number, number]] = [
      [b.getSouth(), b.getWest()],
      [b.getNorth(), b.getEast()],
    ];
    const labels = map.getZoom() >= LABEL_ZOOM;
    for (const c of compounds) {
      const want = on && compoundInView(c, view);
      let shape = made.get(c.id);
      if (want && !shape) {
        shape = L.polygon(c.ring, { pane: PANE, renderer, interactive: false, color: COLOR, weight: 2, opacity: 0.95, fillColor: COLOR, fillOpacity: 0.22 });
        shape.bindTooltip(c.nameAr ?? c.name, { permanent: true, direction: "center", interactive: false, opacity: 0.9, className: "nuca-compound-label" });
        made.set(c.id, shape);
      }
      if (!shape) continue;
      if (want) {
        shape.addTo(map);
        if (labels) shape.openTooltip();
        else shape.closeTooltip();
      } else map.removeLayer(shape);
    }
  };
  const tap = (e: Leaflet.LeafletMouseEvent) => {
    // A tap on a plot, a dot or a district circle reaches the map too, with that layer as its source.
    if (!on || (e as unknown as { sourceTarget?: unknown }).sourceTarget !== map) return;
    const hit = compounds.find((c) => compoundContains(c, e.latlng.lat, e.latlng.lng));
    if (hit) L.popup({ maxWidth: 280, autoPanPadding: [90, 16] }).setLatLng(e.latlng).setContent(popupContent(hit, compoundInView(hit, near))).openOn(map);
  };
  map.on("moveend zoomend", sync);
  map.on("click", tap);
  sync();

  const control = new L.Control({ position: "topright" });
  control.onAdd = () => {
    const div = L.DomUtil.create("div", "leaflet-bar");
    const a = L.DomUtil.create("a", "", div) as HTMLAnchorElement;
    a.href = "#";
    a.role = "button";
    a.dir = "rtl";
    a.title = t.compound.toggleTitle;
    a.textContent = t.compound.toggle;
    Object.assign(a.style, { width: "auto", padding: "0 10px", fontSize: "13px", fontWeight: "600", lineHeight: "30px", whiteSpace: "nowrap" });
    const render = () => {
      a.setAttribute("aria-pressed", String(on));
      a.style.color = on ? "#111" : "#888";
      a.style.backgroundColor = on ? "#fff" : "#eee";
      a.style.textDecoration = on ? "none" : "line-through";
    };
    render();
    L.DomEvent.disableClickPropagation(div);
    L.DomEvent.on(a, "click", (e) => {
      L.DomEvent.stop(e);
      on = !on;
      setCompoundsShown(on);
      if (!on) map.closePopup();
      sync();
      render();
    });
    return div;
  };
  control.addTo(map);

  return {
    remove() {
      map.off("moveend zoomend", sync);
      map.off("click", tap);
      control.remove();
      for (const shape of made.values()) map.removeLayer(shape);
      made.clear();
    },
  };
}
