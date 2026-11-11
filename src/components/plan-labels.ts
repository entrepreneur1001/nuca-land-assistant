/**
 * Plot numbers drawn by the app on top of the plot shapes (plan-layer.ts). The official plan image prints its own
 * numbers in red, but the status fills cover them (red on red for booked plots) and neighbouring plans cover each
 * other, so the image can't be relied on to show them. One canvas for every zone on the map: a district can have
 * thousands of plots, far too many for one DOM node each.
 */

import type * as Leaflet from "leaflet";

type L = typeof Leaflet;

export interface PlanLabel {
  /** The plot number as shown on the plan. */
  text: string;
  lat: number;
  lng: number;
  /** Side of the square with the plot's area, in ground metres: how much room the number has. */
  sizeM: number;
}

/** What the label canvas needs from a plan layer. */
export interface PlanLabelSource {
  /** The labels of the shapes currently on the map. */
  labels(): readonly PlanLabel[];
  /** Called by the layer when that set changes. */
  onChange: (() => void) | null;
}

const LABEL_MIN_PX = 9;
const LABEL_MAX_PX = 14;
/** Average digit width over font size, for the system sans-serif at weight 600. */
const DIGIT_EM = 0.6;

/** Area-weighted centroid of a polygon (vertex mean for degenerate ones). */
export function polygonCentroid(poly: readonly (readonly [number, number])[]): [number, number] {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % poly.length];
    const f = x0 * y1 - x1 * y0;
    a += f;
    cx += (x0 + x1) * f;
    cy += (y0 + y1) * f;
  }
  if (Math.abs(a) < 1e-9) return [poly.reduce((s, p) => s + p[0], 0) / poly.length, poly.reduce((s, p) => s + p[1], 0) / poly.length];
  return [cx / (3 * a), cy / (3 * a)];
}

export function polygonArea(poly: readonly (readonly [number, number])[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) a += poly[i][0] * poly[(i + 1) % poly.length][1] - poly[(i + 1) % poly.length][0] * poly[i][1];
  return Math.abs(a) / 2;
}

/**
 * Font size for a number on a plot that is `sizePx` screen pixels across, or 0 when it would not fit legibly
 * (then the number is left out until the user zooms in, rather than spilling over the neighbours).
 */
export function labelFontPx(sizePx: number, text: string): number {
  const len = Math.max(1, text.length);
  // Plots are often twice as deep as wide: keep the text within the narrow side.
  const f = Math.min(LABEL_MAX_PX, sizePx * 0.55, (sizePx * 0.85) / (DIGIT_EM * len));
  return f >= LABEL_MIN_PX ? Math.round(f) : 0;
}

/**
 * Where to look so the plot numbers of a district can be read: the lowest zoom at which most plots (judged by the
 * lower-quartile size and upper-quartile number length) get their number drawn, centred on the plot nearest the
 * middle of them all (so the view lands on plots, not on a park between blocks). Null when there are no labels.
 * Capped at `maxZoom`.
 */
export function labelView(labels: readonly PlanLabel[], maxZoom = 19): { lat: number; lng: number; zoom: number } | null {
  if (!labels.length) return null;
  const pick = (xs: number[], q: number) => xs.sort((a, b) => a - b)[Math.floor((xs.length - 1) * q)];
  // The smaller plots (lower quartile) and longer numbers (upper quartile) decide, so most numbers show, not half.
  const sizeM = pick(labels.map((l) => l.sizeM), 0.25);
  const len = pick(labels.map((l) => l.text.length), 0.75);
  // Smallest on-screen size labelFontPx accepts for this length.
  const needPx = Math.max(LABEL_MIN_PX / 0.55, (LABEL_MIN_PX * DIGIT_EM * len) / 0.85);
  const lat = labels.reduce((s, l) => s + l.lat, 0) / labels.length;
  const lng = labels.reduce((s, l) => s + l.lng, 0) / labels.length;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  // mPerPx(z) = EARTH_M·cos(lat) / (256·2^z) must be ≤ sizeM / needPx.
  const zoom = Math.min(maxZoom, Math.max(0, Math.ceil(Math.log2((EARTH_M * cosLat * needPx) / (256 * sizeM)))));
  let best = labels[0];
  let bestD = Infinity;
  for (const l of labels) {
    const d = (l.lat - lat) ** 2 + ((l.lng - lng) * cosLat) ** 2;
    if (d < bestD) [best, bestD] = [l, d];
  }
  return { lat: best.lat, lng: best.lng, zoom };
}

const PANE = "nucaPlanLabels";
/** Above the shapes and dots (overlay pane, 400), below markers and tooltips. */
const PANE_Z = "450";
const EARTH_M = 40075016.686;

/** Draws the plot numbers of `sources` on `map` and keeps them in step with the view. Removed with the map. */
export function addPlanLabels(L: L, map: Leaflet.Map, sources: readonly PlanLabelSource[]): { redraw(): void; remove(): void } {
  const pane = map.getPane(PANE) ?? map.createPane(PANE);
  pane.style.zIndex = PANE_Z;
  pane.style.pointerEvents = "none";
  // Hidden while a zoom animates (the numbers would be at the old scale), redrawn when it ends.
  const canvas = L.DomUtil.create("canvas", "leaflet-zoom-hide", pane) as HTMLCanvasElement;
  canvas.style.pointerEvents = "none";
  const ctx = canvas.getContext("2d");
  let frame = 0;
  let dead = false;

  const draw = () => {
    frame = 0;
    if (dead || !ctx) return;
    const size = map.getSize();
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(size.x * dpr) || canvas.height !== Math.round(size.y * dpr)) {
      canvas.width = Math.round(size.x * dpr);
      canvas.height = Math.round(size.y * dpr);
      canvas.style.width = `${size.x}px`;
      canvas.style.height = `${size.y}px`;
    }
    // The pane moves with the map while dragging: pin the canvas to the visible corner.
    L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.x, size.y);
    const view = map.getBounds();
    const mPerPx = (EARTH_M * Math.cos((map.getCenter().lat * Math.PI) / 180)) / (256 * 2 ** map.getZoom());
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(0, 0, 0, 0.8)";
    ctx.fillStyle = "#fff";
    let font = 0;
    for (const s of sources)
      for (const l of s.labels()) {
        if (!view.contains([l.lat, l.lng])) continue;
        const f = labelFontPx(l.sizeM / mPerPx, l.text);
        if (!f) continue;
        if (f !== font) {
          font = f;
          ctx.font = `600 ${f}px system-ui, -apple-system, "Segoe UI", sans-serif`;
          ctx.lineWidth = Math.max(2, f / 4);
        }
        const p = map.latLngToContainerPoint([l.lat, l.lng]);
        // White on a dark outline reads on every status colour.
        ctx.strokeText(l.text, p.x, p.y);
        ctx.fillText(l.text, p.x, p.y);
      }
  };
  const redraw = () => {
    if (!dead && !frame) frame = requestAnimationFrame(draw);
  };
  const remove = () => {
    if (dead) return;
    dead = true;
    if (frame) cancelAnimationFrame(frame);
    map.off("move zoomend resize viewreset", redraw);
    for (const s of sources) s.onChange = null;
    L.DomUtil.remove(canvas);
  };

  for (const s of sources) s.onChange = redraw;
  map.on("move zoomend resize viewreset", redraw);
  map.once("unload", remove);
  redraw();
  return { redraw, remove };
}
