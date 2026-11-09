"use client";

import "leaflet/dist/leaflet.css";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { t } from "@/i18n/ar";
import type { Plot } from "@/data/snapshot";
import type { AreaDistrict } from "@/lib/area-stats";
import { loadPlans } from "@/lib/plans";
import { addPlanLayer, addPlanToggle, plotTooltip, type PlanLayer } from "./plan-layer";

const IMAGERY = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const LABELS = "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}";

/**
 * Satellite map of every plot in a city or district. Where an official zone plan exists (public/plans) the plan
 * image is laid over the tiles and each plot is a shape coloured by status; other plots are dots (available green,
 * booked grey). Plots the source left without coordinates and no shape are summed into one dashed circle per
 * district at its approximate centre.
 */
export function AreaMap({
  plots,
  districts,
  highlight,
  onDistrict,
  onPlan,
}: {
  plots: Plot[];
  /** Districts shown, for the plan lookup and the approximate circles. */
  districts: AreaDistrict[];
  /** Plot id to emphasise (e.g. the hovered list row). */
  highlight?: string | null;
  onDistrict?: (id: string | null) => void;
  /** Whether any plot ended up drawn from an official plan (for the legend). */
  onPlan?: (hasPlan: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const markers = useRef(new Map<string, import("leaflet").CircleMarker>());
  const plans = useRef<PlanLayer[]>([]);
  const lit = useRef<string | null>(null);
  const key = `${plots.length}|${districts.map((d) => d.id).join(",")}`;
  const located = plots.filter((p) => p.latitude != null && p.longitude != null);
  const approx = districts.filter((d) => d.unlocated > 0 && d.centre);
  const empty = !located.length && !approx.length;

  useEffect(() => {
    if (empty || !ref.current) {
      onPlan?.(false);
      return;
    }
    const el = ref.current;
    const byId = markers.current;
    const layers = plans.current;
    let map: import("leaflet").Map | null = null;
    let cancelled = false;
    const city = plots[0]?.cityName ?? "";
    const plotIds = new Set(plots.map((p) => p.id));
    // Plans load alongside Leaflet itself (small static files, cached), so the map is drawn once, with no dots to retract.
    void Promise.all([import("leaflet"), loadPlans(city, districts.map((d) => d.id), plotIds)]).then(([L, zones]) => {
      if (cancelled) return;
      const css = getComputedStyle(document.documentElement);
      const color = (name: string) => css.getPropertyValue(name).trim();
      const good = color("--good");
      const muted = color("--muted");
      const accent = color("--accent");
      const warn = color("--warn") || good;

      // Canvas keeps a few thousand dots smooth.
      map = L.map(el, { scrollWheelZoom: false, preferCanvas: true });
      L.tileLayer(IMAGERY, { maxZoom: 19, attribution: "Tiles © Esri" }).addTo(map);
      L.tileLayer(LABELS, { maxZoom: 19 }).addTo(map);

      // The view must be set before layers are added (Leaflet can't place them otherwise).
      const pts: [number, number][] = [
        ...located.map((p): [number, number] => [p.latitude!, p.longitude!]),
        ...approx.map((d): [number, number] => [d.centre!.lat, d.centre!.lng]),
      ];
      const bounds = L.latLngBounds(pts);
      for (const z of zones) bounds.extend(z.info.bounds);
      if (pts.length > 1 || zones.length) map.fitBounds(bounds, { padding: [32, 32], maxZoom: 17, animate: false });
      else map.setView(pts[0], 15);

      const byPlot = new Map(plots.map((p) => [p.id, p]));
      const open = (id: string) => router.push(`/land?id=${encodeURIComponent(id)}`);
      layers.length = 0;
      for (const z of zones) layers.push(addPlanLayer(L, map, z.zid, z.zone, z.image, byPlot, { colors: { good, warn, muted, accent }, onClick: open }));
      const shaped = new Set(layers.flatMap((l) => [...l.ids]));
      if (layers.length) addPlanToggle(L, map, layers);
      for (const l of layers) l.setHighlight(lit.current);
      onPlan?.(shaped.size > 0);

      for (const d of districts) {
        if (!d.centre) continue;
        // Only plots that have neither coordinates nor a shape are left to the circle.
        const rest = plots.filter((p) => p.projectId === d.id && (p.latitude == null || p.longitude == null) && !shaped.has(p.id));
        if (!rest.length) continue;
        const avail = rest.filter((p) => p.status === "available").length;
        L.circle([d.centre.lat, d.centre.lng], { radius: 350, color: accent, weight: 2, dashArray: "6 6", fillOpacity: 0.12 })
          // Always labelled: these plots have no dots, so the circle is all that shows them.
          .bindTooltip(`${d.name}: ${t.area.approx(rest.length, avail)}`, { permanent: true, direction: "top" })
          .on("click", () => onDistrict?.(d.id))
          .addTo(map);
      }
      // Booked first so available dots sit on top.
      const ordered = located.filter((p) => !shaped.has(p.id)).sort((a, b) => Number(b.status === "booked") - Number(a.status === "booked"));
      byId.clear();
      for (const p of ordered) {
        const booked = p.status === "booked";
        const m = L.circleMarker([p.latitude!, p.longitude!], {
          radius: 5,
          weight: 1,
          color: "#fff",
          fillColor: booked ? muted : good,
          fillOpacity: booked ? 0.6 : 0.95,
        })
          .bindTooltip(plotTooltip(p))
          .on("click", () => open(p.id))
          .addTo(map);
        byId.set(p.id, m);
      }
    });
    return () => {
      cancelled = true;
      byId.clear();
      layers.length = 0;
      map?.remove();
    };
    // Rebuild when the area changes; snapshot refreshes don't move plots.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, empty]);

  useEffect(() => {
    lit.current = highlight ?? null;
    for (const l of plans.current) l.setHighlight(lit.current);
    const m = highlight ? markers.current.get(highlight) : null;
    if (!m) return;
    const prev = { radius: m.getRadius(), weight: m.options.weight };
    m.setRadius(10).setStyle({ weight: 3 }).bringToFront().openTooltip();
    return () => {
      m.setRadius(prev.radius).setStyle({ weight: prev.weight }).closeTooltip();
    };
  }, [highlight]);

  if (empty) return <p className="text-sm text-muted">{t.area.noMap}</p>;
  return <div ref={ref} dir="ltr" className="relative z-0 h-80 w-full overflow-hidden rounded-xl sm:h-[28rem]" />;
}
