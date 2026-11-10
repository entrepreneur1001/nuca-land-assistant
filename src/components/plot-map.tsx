"use client";

import "leaflet/dist/leaflet.css";
import { track } from "@/lib/firebase";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { t } from "@/i18n/ar";
import type { Plot } from "@/data/snapshot";
import { loadPastIndex, pastZonesOfCity } from "@/lib/past-plans";
import { loadCompounds } from "@/lib/compounds";
import { addCompounds, limitToCity } from "./compound-layer";
import { IMAGERY_ATTRIBUTION } from "./map-controls";
import { addPlaces } from "./places-layer";
import { loadPlacesNear } from "@/lib/places";
import { loadPlans } from "@/lib/plans";
import { addPlanLabels } from "./plan-labels";
import { addPastPlans, addPlanLayer, addPlanToggle, plotTooltip, type PlanLayer } from "./plan-layer";

const IMAGERY = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const LABELS = "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}";

/** Width of the ground window a placed plot's map opens on, in metres. */
const PLOT_VIEW_M = 450;

/**
 * Satellite map of the plot among the other plots of its district. With an official zone plan (public/plans) the
 * plot is its shape on the plan, in the accent colour, and the neighbours are shapes by status; otherwise dots.
 */
export function PlotMap({
  plot,
  plots,
  availableOnly,
  onPlan,
  onPast,
  onCompounds,
  onPlaces,
}: {
  plot: Plot;
  plots: Plot[];
  /** Hide the booked neighbours (dots and shapes); the plot itself always shows. */
  availableOnly?: boolean;
  /** Whether the plot itself is drawn from an official plan (then its place isn't approximate). */
  onPlan?: (hasPlan: boolean) => void;
  /** Whether the city has plans of earlier stages, drawn muted (for the legend). */
  onPast?: (hasPast: boolean) => void;
  /** Whether private compounds are within the map's reach (for the legend). */
  onCompounds?: (has: boolean) => void;
  /** Whether nearby places (universities, clubs …) are on the map (for the legend). */
  onPlaces?: (has: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const router = useRouter();
  const plans = useRef<PlanLayer[]>([]);
  const bookedDots = useRef<import("leaflet").CircleMarker[]>([]);
  const host = useRef<import("leaflet").Map | null>(null);
  const hideBooked = useRef(false);
  const exact = plot.latitude != null && plot.longitude != null;
  const centre = exact ? { lat: plot.latitude!, lng: plot.longitude! } : plot.approxLoc;

  useEffect(() => {
    if (!centre || !ref.current) {
      onPlan?.(false);
      return;
    }
    const el = ref.current;
    const dots = bookedDots.current;
    let map: import("leaflet").Map | null = null;
    let cancelled = false;
    void Promise.all([import("leaflet"), loadPlans(plot.cityName, [plot.projectId], new Set([plot.id])), loadPastIndex(), loadCompounds()]).then(([L, zones, pastIndex, compounds]) => {
      if (cancelled) return;
      const css = getComputedStyle(document.documentElement);
      const color = (name: string) => css.getPropertyValue(name).trim();
      const good = color("--good");
      const bad = color("--bad");
      const accent = color("--accent");
      const warn = color("--warn") || good;

      map = L.map(el, { scrollWheelZoom: false, attributionControl: true });
      L.tileLayer(IMAGERY, { maxZoom: 19, attribution: IMAGERY_ATTRIBUTION }).addTo(map);
      L.tileLayer(LABELS, { maxZoom: 19 }).addTo(map);
      setStatus("ready");

      const neighbours = plot.projectId ? plots.filter((p) => p.projectId === plot.projectId && p.id !== plot.id) : [];
      const dotted = neighbours.filter((p) => p.latitude != null && p.longitude != null);
      // The view must be set before layers are added (Leaflet can't place them otherwise).
      const pts: [number, number][] = [[centre.lat, centre.lng], ...dotted.map((p): [number, number] => [p.latitude!, p.longitude!])];
      const bounds = L.latLngBounds(pts);
      for (const z of zones) bounds.extend(z.info.bounds);
      // A placed plot opens on itself with the few blocks around it (a district can be kilometres wide, the plot a
      // speck in it); a plot known only by its district's centre opens on the whole district.
      if (exact) map.fitBounds(L.latLng(centre.lat, centre.lng).toBounds(PLOT_VIEW_M), { padding: [8, 8], maxZoom: 19, animate: false });
      else if (pts.length > 1 || zones.length) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 17, animate: false });
      else map.setView([centre.lat, centre.lng], 16);

      const byPlot = new Map([plot, ...neighbours].map((p) => [p.id, p]));
      const layers: PlanLayer[] = zones.map((z) =>
        addPlanLayer(L, map!, z.zid, z.zone, z.image, byPlot, {
          colors: { good, warn, bad, accent },
          self: plot.id,
          onClick: (id) => {
            void track("map_plot_click", { id, page: location.pathname });
            router.push(`/land?id=${encodeURIComponent(id)}`);
          },
        }),
      );
      const shaped = new Set(layers.flatMap((l) => [...l.ids]));
      const pastZones = pastZonesOfCity(pastIndex, plot.cityName);
      const past = pastZones.length ? addPastPlans(L, map, pastZones) : null;
      onPast?.(!!past);
      limitToCity(map);
      // Private compounds lie lowest of all: what is being built around the plots.
      onCompounds?.(compounds.length ? addCompounds(L, map, compounds).any : false);
      // Universities, clubs, hospitals, stations… around the land: loaded for the area the map can reach.
      const max = map.options.maxBounds;
      const reach = max ? (max instanceof L.LatLngBounds ? max : L.latLngBounds(max)) : map.getBounds();
      const built = map;
      void loadPlacesNear([
        [reach.getSouth(), reach.getWest()],
        [reach.getNorth(), reach.getEast()],
      ]).then((places) => {
        if (cancelled || !places.length) return;
        addPlaces(L, built, places, exact ? L.latLng(centre.lat, centre.lng) : undefined);
        onPlaces?.(true);
      });
      if (layers.length || past) addPlanToggle(L, map, past ? [...layers, past] : layers);
      if (layers.length) addPlanLabels(L, map, layers);
      for (const l of layers) l.setBookedVisible(!hideBooked.current);
      plans.current = layers;
      host.current = map;
      dots.length = 0;
      onPlan?.(shaped.has(plot.id));

      for (const p of dotted) {
        if (shaped.has(p.id)) continue;
        const booked = p.status === "booked";
        const m = L.circleMarker([p.latitude!, p.longitude!], {
          radius: 5,
          weight: 1,
          color: "#fff",
          fillColor: booked ? bad : good,
          fillOpacity: booked ? 0.75 : 0.9,
        })
          .bindTooltip(plotTooltip(p))
          .on("click", () => {
            void track("map_plot_click", { id: p.id, page: location.pathname });
            router.push(`/land?id=${encodeURIComponent(p.id)}`);
          });
        if (booked) dots.push(m);
        if (!booked || !hideBooked.current) m.addTo(map);
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
    }).catch(() => {
      if (!cancelled) setStatus("error");
    });
    return () => {
      cancelled = true;
      dots.length = 0;
      plans.current = [];
      host.current = null;
      map?.remove();
    };
    // Rebuild only when the shown plot changes; snapshot refreshes don't move plots.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plot.id, centre?.lat, centre?.lng]);

  useEffect(() => {
    hideBooked.current = !!availableOnly;
    for (const l of plans.current) l.setBookedVisible(!availableOnly);
    const map = host.current;
    if (!map) return; // Not built yet: the build reads hideBooked.
    for (const m of bookedDots.current) {
      if (availableOnly) map.removeLayer(m);
      else m.addTo(map);
    }
  }, [availableOnly]);

  if (!centre) return null;
  return <div className="relative z-0 h-72 w-full overflow-hidden rounded-xl sm:h-96">
      <div ref={ref} dir="ltr" className="absolute inset-0" />
      {status === "ready" ? null : <div className="nuca-map-loading">{status === "error" ? t.mapError : t.mapLoading}</div>}
    </div>;
}
