/**
 * Leaflet layers for an official zone plan (src/lib/plans.ts): the plan image placed by its three georeferenced
 * corners (so rotated plans line up with the satellite tiles) and one clickable polygon per plot, coloured by status.
 * Plain TypeScript: the maps import Leaflet dynamically, so the module is passed in rather than imported.
 */

import type * as Leaflet from "leaflet";
import type { Plot } from "@/data/snapshot";
import { num, t, usd } from "@/i18n/ar";
import { planProjector, type PlanZone } from "@/lib/plans";

type L = typeof Leaflet;

export interface PlanColors {
  good: string;
  warn: string;
  muted: string;
  accent: string;
}

export interface PlanLayerOptions {
  colors: PlanColors;
  /** Plot id drawn as "this plot" (accent fill, permanent label, no click). */
  self?: string | null;
  onClick?: (plotId: string) => void;
}

export interface PlanLayer {
  zid: string;
  /** Plot ids that got a polygon (so the maps don't also draw a dot for them). */
  ids: ReadonlySet<string>;
  /** The image's four corners. */
  bounds: Leaflet.LatLngBounds;
  setHighlight(plotId: string | null): void;
  setImageVisible(on: boolean): void;
  remove(): void;
}

/** Tooltip of a plot dot or shape: «قطعة 12 · 500 م² · 200 دولار/م²». */
export const plotTooltip = (p: Plot) => `${t.card.plot} ${p.plotNumber} · ${num(p.area, 1)} ${t.card.m2} · ${usd(p.pricePerMeter)}/${t.card.m2}`;

const statusWord = (p: Plot) => (p.status === "booked" ? t.detail.booked : p.held ? `${t.detail.available} (${t.plan.held})` : t.detail.available);

/** Whether plan images are shown; remembered across map rebuilds within the session. */
let imagesOn = true;

const PANE = "nucaPlan";
/** Below the overlay pane (400) so the polygons and dots always sit on the image. */
const PANE_Z = "390";

// ---- rotated image overlay ----

/** Instance state of the overlay class below (Leaflet's own members, e.g. the protected `_map`, stay out of the way). */
interface RotatedImage {
  _url: string;
  _corners: Leaflet.LatLng[];
  _w: number;
  _h: number;
  _img?: HTMLImageElement;
  _failed?: boolean;
  /** The map while added (set in onAdd, cleared in onRemove). */
  _on?: Leaflet.Map;
  /** Set by Leaflet before getEvents() runs. */
  _zoomAnimated?: boolean;
  options: Leaflet.LayerOptions & { opacity: number };
  getPane(name?: string): HTMLElement | undefined;
  _reset(): void;
  _animateZoom(e: Leaflet.ZoomAnimEvent): void;
  _place(toPoint: (ll: Leaflet.LatLng) => Leaflet.Point): void;
}
type RotatedImageCtor = new (
  url: string,
  corners: Leaflet.LatLng[],
  w: number,
  h: number,
  options: Leaflet.LayerOptions & { opacity: number },
) => RotatedImage & Leaflet.Layer;

/** Leaflet's private helper that gives a layer point as it will be after the running zoom animation. */
interface AnimatedMap {
  _latLngToNewLayerPoint(latlng: Leaflet.LatLng, zoom: number, center: Leaflet.LatLng): Leaflet.Point;
}

let rotatedImageClass: RotatedImageCtor | null = null;

/**
 * An <img> in its own pane whose CSS matrix maps image pixels onto the three projected corners, refreshed on
 * every zoom/move (same idea as the leaflet-imageoverlay-rotated plugin). Never interactive.
 */
function rotatedImage(L: L): RotatedImageCtor {
  rotatedImageClass ??= L.Layer.extend({
    options: { opacity: 0.9, interactive: false, pane: PANE },
    initialize(this: RotatedImage, url: string, corners: Leaflet.LatLng[], w: number, h: number, options?: Leaflet.LayerOptions) {
      L.Util.setOptions(this, options);
      this._url = url;
      this._corners = corners;
      this._w = w;
      this._h = h;
    },
    onAdd(this: RotatedImage, map: Leaflet.Map) {
      if (this._failed) return;
      this._on = map;
      if (!this._img) {
        const img = L.DomUtil.create("img", "leaflet-image-layer" + (this._zoomAnimated ? " leaflet-zoom-animated" : "")) as HTMLImageElement;
        img.alt = "";
        img.draggable = false;
        img.decoding = "async";
        img.width = this._w;
        img.height = this._h;
        // Inline sizes beat the global `img { height: auto }` reset, so the matrix below is exact before the image loads.
        img.style.width = `${this._w}px`;
        img.style.height = `${this._h}px`;
        img.style.transformOrigin = "0 0";
        img.style.opacity = String(this.options.opacity);
        img.style.pointerEvents = "none";
        img.onselectstart = L.Util.falseFn;
        img.onmousemove = L.Util.falseFn;
        img.onerror = () => {
          this._failed = true;
          this._on?.removeLayer(this as unknown as Leaflet.Layer);
        };
        img.src = this._url;
        this._img = img;
      }
      this.getPane()!.appendChild(this._img);
      this._reset();
    },
    onRemove(this: RotatedImage) {
      this._on = undefined;
      if (this._img) L.DomUtil.remove(this._img);
    },
    getEvents(this: RotatedImage) {
      const events: Record<string, (e: Leaflet.LeafletEvent) => void> = { zoom: this._reset, viewreset: this._reset };
      if (this._zoomAnimated) events.zoomanim = this._animateZoom as (e: Leaflet.LeafletEvent) => void;
      return events;
    },
    _reset(this: RotatedImage) {
      const map = this._on;
      if (map) this._place((ll) => map.latLngToLayerPoint(ll));
    },
    _animateZoom(this: RotatedImage, e: Leaflet.ZoomAnimEvent) {
      const map = this._on as unknown as AnimatedMap | undefined;
      if (map) this._place((ll) => map._latLngToNewLayerPoint(ll, e.zoom, e.center));
    },
    /** matrix(a, b, c, d, e, f): columns are the per-pixel vectors along the top and left edges, then the top-left corner. */
    _place(this: RotatedImage, toPoint: (ll: Leaflet.LatLng) => Leaflet.Point) {
      if (!this._img) return;
      const [tl, tr, bl] = this._corners.map(toPoint);
      const a = (tr.x - tl.x) / this._w;
      const b = (tr.y - tl.y) / this._w;
      const c = (bl.x - tl.x) / this._h;
      const d = (bl.y - tl.y) / this._h;
      this._img.style.transform = `matrix(${a}, ${b}, ${c}, ${d}, ${tl.x}, ${tl.y})`;
    },
  }) as unknown as RotatedImageCtor;
  return rotatedImageClass;
}

// ---- plot polygons ----

type Style = Pick<Leaflet.PathOptions, "color" | "weight" | "fillColor" | "fillOpacity">;

function baseStyle(p: Plot, self: boolean, c: PlanColors): Style {
  if (self) return { color: "#fff", weight: 3, fillColor: c.accent, fillOpacity: 0.6 };
  if (p.status === "booked") return { color: "#fff", weight: 1, fillColor: c.muted, fillOpacity: 0.55 };
  return { color: "#fff", weight: 1, fillColor: p.held ? c.warn : c.good, fillOpacity: 0.5 };
}

/** Adds one zone's plan image and plot polygons to `map`. The view must already be set. */
export function addPlanLayer(L: L, map: Leaflet.Map, zid: string, zone: PlanZone, imageUrl: string, plots: ReadonlyMap<string, Plot>, opts: PlanLayerOptions): PlanLayer {
  if (!map.getPane(PANE)) map.createPane(PANE).style.zIndex = PANE_Z;
  const crs = map.options.crs ?? L.CRS.EPSG3857;
  const toLatLng = planProjector(zone.corners, zone.w, zone.h, { project: (ll) => crs.project(ll), unproject: (p) => crs.unproject(L.point(p.x, p.y)) });
  const corner = (x: number, y: number) => L.latLng(toLatLng(x, y));
  const corners = [corner(0, 0), corner(zone.w, 0), corner(0, zone.h)];
  const bounds = L.latLngBounds([...corners, corner(zone.w, zone.h)]);

  const Img = rotatedImage(L);
  const image = new Img(imageUrl, corners, zone.w, zone.h, { opacity: 0.9, pane: PANE });
  if (imagesOn) image.addTo(map);

  // One SVG renderer per zone: hover/highlight restyle single paths without redrawing the canvas the dots use.
  const renderer = L.svg({ pane: "overlayPane" });
  const polys = new Map<string, { poly: Leaflet.Polygon; base: Style; hover: boolean; lit: boolean }>();
  const apply = (id: string) => {
    const e = polys.get(id);
    if (!e) return;
    const lit = e.lit && id !== opts.self;
    e.poly.setStyle({ ...e.base, weight: e.hover || lit ? 3 : e.base.weight, color: lit ? opts.colors.accent : e.base.color });
    if (e.hover || lit) e.poly.bringToFront();
  };

  for (const [id, pixels] of Object.entries(zone.plots)) {
    const p = plots.get(id);
    if (!p || !Array.isArray(pixels) || pixels.length < 3) continue;
    const self = id === opts.self;
    const base = baseStyle(p, self, opts.colors);
    const poly = L.polygon(
      pixels.map(([x, y]) => toLatLng(x, y)),
      { ...base, renderer, pane: "overlayPane" },
    );
    if (self) {
      poly.bindTooltip(t.detail.thisPlot(p.plotNumber), { permanent: true, direction: "top" });
    } else {
      poly
        .bindTooltip(`${plotTooltip(p)} · ${statusWord(p)}`, { sticky: true, direction: "top" })
        .on("mouseover", () => {
          polys.get(id)!.hover = true;
          apply(id);
        })
        .on("mouseout", () => {
          polys.get(id)!.hover = false;
          apply(id);
        })
        .on("click", () => opts.onClick?.(id));
    }
    poly.addTo(map);
    polys.set(id, { poly, base, hover: false, lit: false });
  }
  if (opts.self) polys.get(opts.self)?.poly.bringToFront();

  let lit: string | null = null;
  return {
    zid,
    ids: new Set(polys.keys()),
    bounds,
    setHighlight(plotId) {
      if (lit === plotId) return;
      const prev = lit;
      lit = plotId && polys.has(plotId) ? plotId : null;
      if (prev && polys.has(prev)) {
        polys.get(prev)!.lit = false;
        apply(prev);
        polys.get(prev)!.poly.closeTooltip();
      }
      if (lit) {
        polys.get(lit)!.lit = true;
        apply(lit);
        polys.get(lit)!.poly.openTooltip();
      }
    },
    setImageVisible(on) {
      if (on && !image._failed) image.addTo(map);
      else map.removeLayer(image);
    },
    remove() {
      map.removeLayer(image);
      for (const { poly } of polys.values()) map.removeLayer(poly);
      map.removeLayer(renderer);
      polys.clear();
    },
  };
}

/** Top-right «المخطط» button that shows/hides the plan images of every layer in `layers` (polygons stay). */
export function addPlanToggle(L: L, map: Leaflet.Map, layers: readonly PlanLayer[]): Leaflet.Control {
  const control = new L.Control({ position: "topright" });
  control.onAdd = () => {
    const div = L.DomUtil.create("div", "leaflet-bar");
    const a = L.DomUtil.create("a", "", div) as HTMLAnchorElement;
    a.href = "#";
    a.role = "button";
    a.dir = "rtl";
    a.title = t.plan.toggleTitle;
    a.textContent = t.plan.toggle;
    Object.assign(a.style, { width: "auto", padding: "0 10px", fontSize: "13px", fontWeight: "600", lineHeight: "30px", whiteSpace: "nowrap" });
    const render = () => {
      a.setAttribute("aria-pressed", String(imagesOn));
      a.style.color = imagesOn ? "#111" : "#888";
      a.style.backgroundColor = imagesOn ? "#fff" : "#eee";
      a.style.textDecoration = imagesOn ? "none" : "line-through";
    };
    render();
    L.DomEvent.disableClickPropagation(div);
    L.DomEvent.on(a, "click", (e) => {
      L.DomEvent.stop(e);
      imagesOn = !imagesOn;
      for (const l of layers) l.setImageVisible(imagesOn);
      render();
    });
    return div;
  };
  return control.addTo(map);
}
