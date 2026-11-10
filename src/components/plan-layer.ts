/**
 * Leaflet layers for an official zone plan (src/lib/plans.ts): the plan image placed by its three georeferenced
 * corners (so rotated plans line up with the satellite tiles) and one clickable polygon per plot, coloured by status.
 * Plain TypeScript: the maps import Leaflet dynamically, so the module is passed in rather than imported.
 */

import type * as Leaflet from "leaflet";
import type { Plot } from "@/data/snapshot";
import { num, t, usd } from "@/i18n/ar";
import { pastImageUrl, pastZoneInView, type PastPlanZone } from "@/lib/past-plans";
import { planClip, planProjector, type PlanZone } from "@/lib/plans";
import { plansPref } from "@/lib/map-prefs";
import { addToggle } from "./map-controls";
import { polygonArea, polygonCentroid, type PlanLabel, type PlanLabelSource } from "./plan-labels";

type L = typeof Leaflet;

export interface PlanColors {
  good: string;
  warn: string;
  bad: string;
  accent: string;
}

export interface PlanLayerOptions {
  colors: PlanColors;
  /** Plot id drawn as "this plot" (accent fill, permanent label, no click). */
  self?: string | null;
  onClick?: (plotId: string) => void;
}

export interface PlanLayer extends PlanLabelSource {
  zid: string;
  /** Plot ids that got a polygon (so the maps don't also draw a dot for them). */
  ids: ReadonlySet<string>;
  /** The image's four corners. */
  bounds: Leaflet.LatLngBounds;
  setHighlight(plotId: string | null): void;
  setImageVisible(on: boolean): void;
  /** Shows/hides the booked plots' shapes (never the `self` plot). */
  setBookedVisible(on: boolean): void;
  remove(): void;
}

/** Tooltip of a plot dot or shape: «قطعة 12 · 500 م² · 200 دولار/م²». */
export const plotTooltip = (p: Plot) => `${t.card.plot} ${p.plotNumber} · ${num(p.area, 1)} ${t.card.m2} · ${usd(p.pricePerMeter)}/${t.card.m2}`;

const statusWord = (p: Plot) => (p.status === "booked" ? t.detail.booked : p.held ? `${t.detail.available} (${t.plan.held})` : t.detail.available);


const PANE = "nucaPlan";
/**
 * The whole plan sheet (roads, context, white margins, title banner) lies lowest of our layers: under the private
 * compounds (370, compound-layer.ts) and the earlier stages (380), so a sheet's margins never hide a neighbouring
 * compound or an earlier-stage plan. Only the satellite tiles (200) are below it.
 */
const PANE_Z = "360";
/** The drawn site of each plan, cut out and stacked above every whole plan sheet, the compounds and the earlier
 *  stages: a zone's site is never hidden under a neighbour's margins or anything else, while roads and context still
 *  show wherever nothing else is drawn. Below the overlay pane (400) so the polygons and dots always sit on it. */
const SITE_PANE = "nucaPlanSite";
const SITE_PANE_Z = "391";
/** The whole plan sheet (margins, title, surrounding roads) shows from this zoom; below it only the site does. */
const SHEET_ZOOM = 16;

// ---- rotated image overlay ----

/** Instance state of the overlay class below (Leaflet's own members, e.g. the protected `_map`, stay out of the way). */
interface RotatedImage {
  _url: string;
  _corners: Leaflet.LatLng[];
  _w: number;
  _h: number;
  /** CSS clip-path in image pixels (before the matrix), or undefined to show the whole image. */
  _clip?: string;
  _img?: HTMLImageElement;
  _failed?: boolean;
  /** The map while added (set in onAdd, cleared in onRemove). */
  _host?: Leaflet.Map;
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
  clip?: string,
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
export function rotatedImage(L: L): RotatedImageCtor {
  rotatedImageClass ??= L.Layer.extend({
    options: { opacity: 0.9, interactive: false, pane: PANE },
    initialize(this: RotatedImage, url: string, corners: Leaflet.LatLng[], w: number, h: number, options?: Leaflet.LayerOptions, clip?: string) {
      L.Util.setOptions(this, options);
      this._clip = clip;
      this._url = url;
      this._corners = corners;
      this._w = w;
      this._h = h;
    },
    onAdd(this: RotatedImage, map: Leaflet.Map) {
      if (this._failed) return;
      this._host = map;
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
        if (this._clip) img.style.clipPath = this._clip;
        img.onselectstart = L.Util.falseFn;
        img.onmousemove = L.Util.falseFn;
        img.onerror = () => {
          this._failed = true;
          this._host?.removeLayer(this as unknown as Leaflet.Layer);
        };
        img.src = this._url;
        this._img = img;
      }
      this.getPane()!.appendChild(this._img);
      this._reset();
    },
    onRemove(this: RotatedImage) {
      this._host = undefined;
      if (this._img) L.DomUtil.remove(this._img);
    },
    getEvents(this: RotatedImage) {
      const events: Record<string, (e: Leaflet.LeafletEvent) => void> = { zoom: this._reset, viewreset: this._reset };
      if (this._zoomAnimated) events.zoomanim = this._animateZoom as (e: Leaflet.LeafletEvent) => void;
      return events;
    },
    _reset(this: RotatedImage) {
      const map = this._host;
      if (map) this._place((ll) => map.latLngToLayerPoint(ll));
    },
    _animateZoom(this: RotatedImage, e: Leaflet.ZoomAnimEvent) {
      const map = this._host as unknown as AnimatedMap | undefined;
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

/**
 * Solid: the plot's colour is then exactly the legend's, whatever lies underneath. Any transparency let the plan's
 * yellow plots, or a neighbouring plan's white margin where two plans overlap, tint the same status differently.
 * The numbers the fill hides are redrawn on top by plan-labels.ts.
 */
const FILL_OPACITY = 1;

type Style = Pick<Leaflet.PathOptions, "color" | "weight" | "fillColor" | "fillOpacity">;

function baseStyle(p: Plot, self: boolean, c: PlanColors): Style {
  if (self) return { color: "#fff", weight: 3, fillColor: c.accent, fillOpacity: FILL_OPACITY };
  return { color: "#fff", weight: 1, fillColor: p.status === "booked" ? c.bad : p.held ? c.warn : c.good, fillOpacity: FILL_OPACITY };
}

/** Adds one zone's plan image and plot polygons to `map`. The view must already be set. */
export function addPlanLayer(L: L, map: Leaflet.Map, zid: string, zone: PlanZone, imageUrl: string, plots: ReadonlyMap<string, Plot>, opts: PlanLayerOptions): PlanLayer {
  if (!map.getPane(PANE)) map.createPane(PANE).style.zIndex = PANE_Z;
  if (!map.getPane(SITE_PANE)) map.createPane(SITE_PANE).style.zIndex = SITE_PANE_Z;
  const crs = map.options.crs ?? L.CRS.EPSG3857;
  const toLatLng = planProjector(zone.corners, zone.w, zone.h, { project: (ll) => crs.project(ll), unproject: (p) => crs.unproject(L.point(p.x, p.y)) });
  const corner = (x: number, y: number) => L.latLng(toLatLng(x, y));
  const corners = [corner(0, 0), corner(zone.w, 0), corner(0, zone.h)];
  const bounds = L.latLngBounds([...corners, corner(zone.w, zone.h)]);

  const Img = rotatedImage(L);
  // Two copies of the plan: the whole drawing (roads, context, margins) at the very bottom, and its site cut out on
  // top, so a sheet's margins never cover a site, a compound or an earlier-stage plan.
  const hull = planClip(zone);
  const clip = hull ? `polygon(${hull.map(([x, y]) => `${x}px ${y}px`).join(", ")})` : undefined;
  const image = new Img(imageUrl, corners, zone.w, zone.h, { opacity: 0.9, pane: PANE });
  const site = clip ? new Img(imageUrl, corners, zone.w, zone.h, { opacity: 0.9, pane: SITE_PANE }, clip) : null;
  let imagesShown = false;
  const showImages = (on: boolean) => {
    imagesShown = on;
    // Zoomed out, the whole sheet is a white box around the site: only the site shows until the roads around it
    // are big enough to read (a plan with no site outline keeps its sheet).
    const sheet = on && (!site || map.getZoom() >= SHEET_ZOOM);
    for (const [layer, want] of [
      [image, sheet],
      [site, on],
    ] as const) {
      if (!layer) continue;
      if (want && !layer._failed) layer.addTo(map);
      else map.removeLayer(layer);
    }
  };
  const onZoom = () => showImages(imagesShown);
  map.on("zoomend", onZoom);
  if (plansPref.get()) showImages(true);

  // One SVG renderer per zone: hover/highlight restyle single paths without redrawing the canvas the dots use.
  const renderer = L.svg({ pane: "overlayPane" });
  const polys = new Map<string, { poly: Leaflet.Polygon; base: Style; hover: boolean; lit: boolean; booked: boolean; label: PlanLabel }>();
  // Ground metres per image pixel, for the room each plot gives its number.
  const mPerPx = map.distance(corners[0], corners[1]) / zone.w;
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
    const [cx, cy] = polygonCentroid(pixels);
    const label: PlanLabel = { text: String(p.plotNumber), ...toLatLng(cx, cy), sizeM: Math.sqrt(polygonArea(pixels)) * mPerPx };
    polys.set(id, { poly, base, hover: false, lit: false, booked: !self && p.status === "booked", label });
  }
  // Plots the plan shows but whose number could not be read: neutral outlines, so the block still looks complete.
  for (const pixels of zone.unassigned ?? []) {
    if (!Array.isArray(pixels) || pixels.length < 3) continue;
    L.polygon(
      pixels.map(([x, y]) => toLatLng(x, y)),
      { color: "#fff", weight: 1, fillColor: "#9ca3af", fillOpacity: 0.25, renderer, pane: "overlayPane" },
    )
      .bindTooltip(t.plan.unknown, { sticky: true, direction: "top" })
      .addTo(map);
  }
  if (opts.self) polys.get(opts.self)?.poly.bringToFront();

  let lit: string | null = null;
  let bookedOn = true;
  const layer: PlanLayer = {
    zid,
    ids: new Set(polys.keys()),
    bounds,
    onChange: null,
    labels() {
      const out: PlanLabel[] = [];
      for (const e of polys.values()) if (bookedOn || !e.booked) out.push(e.label);
      return out;
    },
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
      showImages(on);
    },
    setBookedVisible(on) {
      if (on === bookedOn) return;
      bookedOn = on;
      for (const e of polys.values()) {
        if (!e.booked) continue;
        if (on) e.poly.addTo(map);
        else map.removeLayer(e.poly);
      }
      // Re-added shapes land on top: put the emphasised ones back above them.
      if (on && opts.self) polys.get(opts.self)?.poly.bringToFront();
      if (on && lit) apply(lit);
      layer.onChange?.();
    },
    remove() {
      map.off("zoomend", onZoom);
      showImages(false);
      for (const { poly } of polys.values()) map.removeLayer(poly);
      map.removeLayer(renderer);
      polys.clear();
      layer.onChange?.();
    },
  };
  return layer;
}

const PAST_PANE = "nucaPlanPast";
/** Under the current stage's sites, over their whole sheets (so a sheet's margin never hides an earlier stage). */
const PAST_PANE_Z = "380";

export interface PastPlans {
  setImageVisible(on: boolean): void;
  remove(): void;
}

/**
 * Draws the plans of earlier offerings, greyed and faded so that only the current stage stands out. Images only (no
 * shapes, nothing to hover). A city can have well over a hundred of them: only those touching the view are on the map.
 */
export function addPastPlans(L: L, map: Leaflet.Map, zones: readonly [string, PastPlanZone][]): PastPlans {
  if (!map.getPane(PAST_PANE)) {
    const pane = map.createPane(PAST_PANE);
    pane.style.zIndex = PAST_PANE_Z;
    // Faded as one sheet, so zones that overlap each other don't add up to a brighter patch.
    pane.style.opacity = "0.55";
    pane.style.filter = "grayscale(1)";
  }
  const Img = rotatedImage(L);
  const made = new Map<string, RotatedImage & Leaflet.Layer>();
  let on = plansPref.get();
  const sync = () => {
    const b = map.getBounds();
    const view: [[number, number], [number, number]] = [
      [b.getSouth(), b.getWest()],
      [b.getNorth(), b.getEast()],
    ];
    for (const [zid, z] of zones) {
      const want = on && pastZoneInView(z, view);
      let image = made.get(zid);
      if (want && !image) {
        const clip = z.clip?.length ? `polygon(${z.clip.map(([x, y]) => `${x}px ${y}px`).join(", ")})` : undefined;
        const corners = [z.corners.tl, z.corners.tr, z.corners.bl].map(([lat, lng]) => L.latLng(lat, lng));
        image = new Img(pastImageUrl(zid), corners, z.w, z.h, { opacity: 1, pane: PAST_PANE }, clip);
        made.set(zid, image);
      }
      if (!image) continue;
      if (want && !image._failed) image.addTo(map);
      else map.removeLayer(image);
    }
  };
  map.on("moveend", sync);
  sync();
  return {
    setImageVisible(visible) {
      on = visible;
      sync();
    },
    remove() {
      map.off("moveend", sync);
      for (const image of made.values()) map.removeLayer(image);
      made.clear();
    },
  };
}

/** Top-right «المخطط» button that shows/hides the plan images of every layer in `layers` (polygons stay); remembered on the device. */
export function addPlanToggle(L: L, map: Leaflet.Map, layers: readonly { setImageVisible(on: boolean): void }[]): Leaflet.Control {
  return addToggle(L, map, {
    label: t.plan.toggle,
    title: t.plan.toggleTitle,
    pref: plansPref,
    onChange: (on) => {
      for (const l of layers) l.setImageVisible(on);
    },
  });
}
