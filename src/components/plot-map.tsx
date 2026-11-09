"use client";

import "leaflet/dist/leaflet.css";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { t } from "@/i18n/ar";
import type { Plot } from "@/data/snapshot";
import { loadPlans } from "@/lib/plans";
import { addPlanLayer, addPlanToggle, plotTooltip, type PlanLayer } from "./plan-layer";

const IMAGERY = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const LABELS = "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}";

/**
 * Satellite map of the plot among the other plots of its district. With an official zone plan (public/plans) the
 * plot is its shape on the plan, in the accent colour, and the neighbours are shapes by status; otherwise dots.
 */
export function PlotMap({
  plot,
  plots,
  onPlan,
}: {
  plot: Plot;
  plots: Plot[];
  /** Whether the plot itself is drawn from an official plan (then its place isn't approximate). */
  onPlan?: (hasPlan: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const exact = plot.latitude != null && plot.longitude != null;
  const centre = exact ? { lat: plot.latitude!, lng: plot.longitude! } : plot.approxLoc;

  useEffect(() => {
    if (!centre || !ref.current) {
      onPlan?.(false);
      return;
    }
    const el = ref.current;
    let map: import("leaflet").Map | null = null;
    let cancelled = false;
    void Promise.all([import("leaflet"), loadPlans(plot.cityName, [plot.projectId], new Set([plot.id]))]).then(([L, zones]) => {
      if (cancelled) return;
      const css = getComputedStyle(document.documentElement);
      const color = (name: string) => css.getPropertyValue(name).trim();
      const good = color("--good");
      const muted = color("--muted");
      const accent = color("--accent");
      const warn = color("--warn") || good;

      map = L.map(el, { scrollWheelZoom: false, attributionControl: true });
      L.tileLayer(IMAGERY, { maxZoom: 19, attribution: "Tiles © Esri" }).addTo(map);
      L.tileLayer(LABELS, { maxZoom: 19 }).addTo(map);

      const neighbours = plot.projectId ? plots.filter((p) => p.projectId === plot.projectId && p.id !== plot.id) : [];
      const dotted = neighbours.filter((p) => p.latitude != null && p.longitude != null);
      // The view must be set before layers are added (Leaflet can't place them otherwise).
      const pts: [number, number][] = [[centre.lat, centre.lng], ...dotted.map((p): [number, number] => [p.latitude!, p.longitude!])];
      const bounds = L.latLngBounds(pts);
      for (const z of zones) bounds.extend(z.info.bounds);
      if (pts.length > 1 || zones.length) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 17, animate: false });
      else map.setView([centre.lat, centre.lng], 16);

      const byPlot = new Map([plot, ...neighbours].map((p) => [p.id, p]));
      const layers: PlanLayer[] = zones.map((z) =>
        addPlanLayer(L, map!, z.zid, z.zone, z.image, byPlot, {
          colors: { good, warn, muted, accent },
          self: plot.id,
          onClick: (id) => router.push(`/land?id=${encodeURIComponent(id)}`),
        }),
      );
      const shaped = new Set(layers.flatMap((l) => [...l.ids]));
      if (layers.length) addPlanToggle(L, map, layers);
      onPlan?.(shaped.has(plot.id));

      for (const p of dotted) {
        if (shaped.has(p.id)) continue;
        const booked = p.status === "booked";
        L.circleMarker([p.latitude!, p.longitude!], {
          radius: 5,
          weight: 1,
          color: "#fff",
          fillColor: booked ? muted : good,
          fillOpacity: booked ? 0.7 : 0.9,
        })
          .bindTooltip(plotTooltip(p))
          .on("click", () => router.push(`/land?id=${encodeURIComponent(p.id)}`))
          .addTo(map);
      }

      if (shaped.has(plot.id)) return; // Its shape, labelled, is on the plan.
      if (exact) {
        L.circleMarker([centre.lat, centre.lng], { radius: 9, weight: 3, color: "#fff", fillColor: accent, fillOpacity: 1 })
          .bindTooltip(t.detail.thisPlot(plot.plotNumber), { permanent: true, direction: "top", offset: [0, -8] })
          .addTo(map)
          .bringToFront();
      } else {
        L.circle([centre.lat, centre.lng], { radius: 300, color: accent, weight: 2, dashArray: "6 6", fillOpacity: 0.1 })
          .bindTooltip(t.detail.approxArea, { permanent: true, direction: "center" })
          .addTo(map);
      }
    });
    return () => {
      cancelled = true;
      map?.remove();
    };
    // Rebuild only when the shown plot changes; snapshot refreshes don't move plots.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plot.id, centre?.lat, centre?.lng]);

  if (!centre) return null;
  return <div ref={ref} dir="ltr" className="relative z-0 h-72 w-full overflow-hidden rounded-xl sm:h-96" />;
}
