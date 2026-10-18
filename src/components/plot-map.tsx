"use client";

import "leaflet/dist/leaflet.css";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { num, t, usd } from "@/i18n/ar";
import type { Plot } from "@/data/snapshot";

const IMAGERY = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const LABELS = "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}";

/** Satellite map of the plot among the other plots of its district (dots at their centres). */
export function PlotMap({ plot, plots }: { plot: Plot; plots: Plot[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const exact = plot.latitude != null && plot.longitude != null;
  const centre = exact ? { lat: plot.latitude!, lng: plot.longitude! } : plot.approxLoc;

  useEffect(() => {
    if (!centre || !ref.current) return;
    const el = ref.current;
    let map: import("leaflet").Map | null = null;
    let cancelled = false;
    void import("leaflet").then((L) => {
      if (cancelled) return;
      const css = getComputedStyle(document.documentElement);
      const color = (name: string) => css.getPropertyValue(name).trim();
      const good = color("--good");
      const muted = color("--muted");
      const accent = color("--accent");

      map = L.map(el, { scrollWheelZoom: false, attributionControl: true });
      L.tileLayer(IMAGERY, { maxZoom: 19, attribution: "Tiles © Esri" }).addTo(map);
      L.tileLayer(LABELS, { maxZoom: 19 }).addTo(map);

      const neighbours = plot.projectId
        ? plots.filter((p) => p.projectId === plot.projectId && p.id !== plot.id && p.latitude != null && p.longitude != null)
        : [];
      // The view must be set before layers are added (Leaflet can't place them otherwise).
      const pts: [number, number][] = [[centre.lat, centre.lng], ...neighbours.map((p): [number, number] => [p.latitude!, p.longitude!])];
      if (pts.length > 1) map.fitBounds(L.latLngBounds(pts), { padding: [24, 24], maxZoom: 17, animate: false });
      else map.setView([centre.lat, centre.lng], 16);

      for (const p of neighbours) {
        const booked = p.status === "booked";
        L.circleMarker([p.latitude!, p.longitude!], {
          radius: 5,
          weight: 1,
          color: "#fff",
          fillColor: booked ? muted : good,
          fillOpacity: booked ? 0.7 : 0.9,
        })
          .bindTooltip(`${t.card.plot} ${p.plotNumber} · ${num(p.area, 1)} ${t.card.m2} · ${usd(p.pricePerMeter)}/${t.card.m2}`)
          .on("click", () => router.push(`/land?id=${encodeURIComponent(p.id)}`))
          .addTo(map);
      }

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
