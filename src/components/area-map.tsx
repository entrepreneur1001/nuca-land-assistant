"use client";

import "leaflet/dist/leaflet.css";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { num, t, usd } from "@/i18n/ar";
import type { Plot } from "@/data/snapshot";
import type { AreaDistrict } from "@/lib/area-stats";

const IMAGERY = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const LABELS = "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}";

/**
 * Satellite map of every plot in a city or district: available green, booked grey. Plots the source left
 * without coordinates are summed into one dashed circle per district at its approximate centre.
 */
export function AreaMap({
  plots,
  districts,
  highlight,
  onDistrict,
}: {
  plots: Plot[];
  /** Districts shown, for the approximate circles. */
  districts: AreaDistrict[];
  /** Plot id to emphasise (e.g. the hovered list row). */
  highlight?: string | null;
  onDistrict?: (id: string | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const markers = useRef(new Map<string, import("leaflet").CircleMarker>());
  const key = `${plots.length}|${districts.map((d) => d.id).join(",")}`;
  const located = plots.filter((p) => p.latitude != null && p.longitude != null);
  const approx = districts.filter((d) => d.unlocated > 0 && d.centre);
  const empty = !located.length && !approx.length;

  useEffect(() => {
    if (empty || !ref.current) return;
    const el = ref.current;
    const byId = markers.current;
    let map: import("leaflet").Map | null = null;
    let cancelled = false;
    void import("leaflet").then((L) => {
      if (cancelled) return;
      const css = getComputedStyle(document.documentElement);
      const color = (name: string) => css.getPropertyValue(name).trim();
      const good = color("--good");
      const muted = color("--muted");
      const accent = color("--accent");

      // Canvas keeps a few thousand dots smooth.
      map = L.map(el, { scrollWheelZoom: false, preferCanvas: true });
      L.tileLayer(IMAGERY, { maxZoom: 19, attribution: "Tiles © Esri" }).addTo(map);
      L.tileLayer(LABELS, { maxZoom: 19 }).addTo(map);

      // The view must be set before layers are added (Leaflet can't place them otherwise).
      const pts: [number, number][] = [
        ...located.map((p): [number, number] => [p.latitude!, p.longitude!]),
        ...approx.map((d): [number, number] => [d.centre!.lat, d.centre!.lng]),
      ];
      if (pts.length > 1) map.fitBounds(L.latLngBounds(pts), { padding: [32, 32], maxZoom: 17, animate: false });
      else map.setView(pts[0], 15);

      for (const d of approx) {
        L.circle([d.centre!.lat, d.centre!.lng], { radius: 350, color: accent, weight: 2, dashArray: "6 6", fillOpacity: 0.12 })
          // Always labelled: these plots have no dots, so the circle is all that shows them.
          .bindTooltip(`${d.name}: ${t.area.approx(d.unlocated, d.unlocatedAvailable)}`, { permanent: true, direction: "top" })
          .on("click", () => onDistrict?.(d.id))
          .addTo(map);
      }
      // Booked first so available dots sit on top.
      const ordered = [...located].sort((a, b) => Number(b.status === "booked") - Number(a.status === "booked"));
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
          .bindTooltip(`${t.card.plot} ${p.plotNumber} · ${num(p.area, 1)} ${t.card.m2} · ${usd(p.pricePerMeter)}/${t.card.m2}`)
          .on("click", () => router.push(`/land?id=${encodeURIComponent(p.id)}`))
          .addTo(map);
        byId.set(p.id, m);
      }
    });
    return () => {
      cancelled = true;
      byId.clear();
      map?.remove();
    };
    // Rebuild when the area changes; snapshot refreshes don't move plots.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, empty]);

  useEffect(() => {
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
