/**
 * The on/off buttons in a map's top corner («المخطط», «كمبوندات», «أماكن»): one look for all of them, each choice
 * remembered on the device (map-prefs.ts). Plain TypeScript: the maps import Leaflet dynamically.
 */
import type * as Leaflet from "leaflet";
import { track } from "@/lib/firebase";
import type { MapPref } from "@/lib/map-prefs";

type L = typeof Leaflet;

export interface ToggleOptions {
  label: string;
  title: string;
  pref: MapPref;
  /** Called with the new state after a tap (the pref is already saved). */
  onChange(on: boolean): void;
  /** Small coloured mark before the label, matching the layer's colour on the map. */
  swatch?: string;
}

export function addToggle(L: L, map: Leaflet.Map, opts: ToggleOptions): Leaflet.Control {
  const control = new L.Control({ position: "topright" });
  control.onAdd = () => {
    const div = L.DomUtil.create("div", "leaflet-bar nuca-toggle");
    const a = L.DomUtil.create("a", "", div) as HTMLAnchorElement;
    a.href = "#";
    a.role = "button";
    a.dir = "rtl";
    a.title = opts.title;
    if (opts.swatch) {
      const dot = L.DomUtil.create("span", "nuca-toggle-dot", a);
      dot.style.background = opts.swatch;
    }
    a.append(document.createTextNode(opts.label));
    const render = () => a.setAttribute("aria-pressed", String(opts.pref.get()));
    render();
    L.DomEvent.disableClickPropagation(div);
    L.DomEvent.disableScrollPropagation(div);
    L.DomEvent.on(a, "click", (e) => {
      L.DomEvent.stop(e);
      const on = !opts.pref.get();
      opts.pref.set(on);
      render();
      opts.onChange(on);
      void track("map_layer", { layer: opts.label, on, page: location.pathname });
    });
    return div;
  };
  return control.addTo(map);
}

/** Esri's own credit line for World Imagery. */
export const IMAGERY_ATTRIBUTION = "Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community";

/**
 * Hides labels that would overlap one already shown: `items` in priority order (first wins). An item is one element
 * or a group (a badge and its name) that is kept or hidden together and never collides with itself. Elements must
 * be on screen to be measured; the ones that lose get `nuca-label-hidden`.
 */
export function cullOverlaps(items: readonly (HTMLElement | readonly HTMLElement[])[], pad = 2): void {
  const kept: DOMRect[] = [];
  const groups = items.map((i) => (Array.isArray(i) ? (i as readonly HTMLElement[]) : [i as HTMLElement]));
  for (const g of groups) for (const el of g) el.classList.remove("nuca-label-hidden");
  for (const g of groups) {
    const rects = g.map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0);
    if (!rects.length) continue;
    const hit = rects.some((r) => kept.some((k) => r.left < k.right + pad && r.right > k.left - pad && r.top < k.bottom + pad && r.bottom > k.top - pad));
    if (hit) for (const el of g) el.classList.add("nuca-label-hidden");
    else kept.push(...rects);
  }
}
