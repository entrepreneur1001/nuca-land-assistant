"use client";

import "leaflet/dist/leaflet.css";
import { track } from "@/lib/firebase";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { t } from "@/i18n/ar";
import type { Plot } from "@/data/snapshot";
import type { AreaDistrict } from "@/lib/area-stats";
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

/**
 * Satellite map of every plot in a city or district. Where an official zone plan exists (public/plans) the plan
 * image is laid over the tiles and each plot is a shape coloured by status; other plots are dots (available green,
 * booked red). Plots the source left without coordinates and no shape are summed into one dashed circle per
 * district at its approximate centre.
 */
export function AreaMap({
  plots,
  districts,
  highlight,
  availableOnly,
  onDistrict,
  onPlan,
  onPast,
  onCompounds,
  onPlaces,
  onApprox,
}: {
  plots: Plot[];
  /** Districts shown, for the plan lookup and the approximate circles. */
  districts: AreaDistrict[];
  /** Plot id to emphasise (e.g. the hovered list row). */
  highlight?: string | null;
  /** Hide booked plots (dots and shapes). */
  availableOnly?: boolean;
  onDistrict?: (id: string | null) => void;
  /** Whether any plot ended up drawn from an official plan (for the legend). */
  onPlan?: (hasPlan: boolean) => void;
  /** Whether the city has plans of earlier stages, drawn muted (for the legend). */
  onPast?: (hasPast: boolean) => void;
  /** Whether private compounds are within the map's reach (for the legend). */
  onCompounds?: (has: boolean) => void;
  /** Whether nearby places (universities, clubs …) are on the map (for the legend). */
  onPlaces?: (has: boolean) => void;
  /** Whether any approximate district circle is on the map (for the legend). */
  onApprox?: (hasCircle: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const router = useRouter();
  const markers = useRef(new Map<string, import("leaflet").CircleMarker>());
  const plans = useRef<PlanLayer[]>([]);
  const lit = useRef<string | null>(null);
  const bookedDots = useRef<import("leaflet").CircleMarker[]>([]);
  const host = useRef<import("leaflet").Map | null>(null);
  const hideBooked = useRef(false);
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
    const dots = bookedDots.current;
    let map: import("leaflet").Map | null = null;
    let cancelled = false;
    const city = plots[0]?.cityName ?? "";
    const plotIds = new Set(plots.map((p) => p.id));
    // Plans load alongside Leaflet itself (small static files, cached), so the map is drawn once, with no dots to retract.
    void Promise.all([import("leaflet"), loadPlans(city, districts.map((d) => d.id), plotIds), loadPastIndex(), loadCompounds()]).then(([L, zones, pastIndex, compounds]) => {
      if (cancelled) return;
      const css = getComputedStyle(document.documentElement);
      const color = (name: string) => css.getPropertyValue(name).trim();
      const good = color("--good");
      const bad = color("--bad");
      const accent = color("--accent");
      const warn = color("--warn") || good;

      // Canvas keeps a few thousand dots smooth.
      map = L.map(el, { scrollWheelZoom: false, preferCanvas: true });
      L.tileLayer(IMAGERY, { maxZoom: 19, attribution: IMAGERY_ATTRIBUTION }).addTo(map);
      L.tileLayer(LABELS, { maxZoom: 19 }).addTo(map);
      setStatus("ready");

      // The view must be set before layers are added (Leaflet can't place them otherwise).
      // A district whose plan is on the map needs no approximate circle: the plan itself shows where its
      // unidentified plots are, and its old guessed centre must not pull the view away either.
      const covered = new Set(zones.map((z) => z.info.sector).filter((s): s is string => !!s));
      const pts: [number, number][] = [
        ...located.map((p): [number, number] => [p.latitude!, p.longitude!]),
        ...approx.filter((d) => !covered.has(d.id ?? "")).map((d): [number, number] => [d.centre!.lat, d.centre!.lng]),
      ];
      const bounds = L.latLngBounds(pts);
      for (const z of zones) bounds.extend(z.info.bounds);
      if (pts.length > 1 || zones.length) map.fitBounds(bounds, { padding: [32, 32], maxZoom: 17, animate: false });
      else map.setView(pts[0], 15);

      const byPlot = new Map(plots.map((p) => [p.id, p]));
      const open = (id: string) => {
        void track("map_plot_click", { id, page: location.pathname });
        router.push(`/land?id=${encodeURIComponent(id)}`);
      };
      layers.length = 0;
      for (const z of zones) layers.push(addPlanLayer(L, map, z.zid, z.zone, z.image, byPlot, { colors: { good, warn, bad, accent }, onClick: open }));
      const shaped = new Set(layers.flatMap((l) => [...l.ids]));
      // Earlier stages lie under everything else, greyed: context for the current plots, never a status.
      const pastZones = pastZonesOfCity(pastIndex, city);
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
        addPlaces(L, built, places, undefined);
        onPlaces?.(true);
      });
      if (layers.length || past) addPlanToggle(L, map, past ? [...layers, past] : layers);
      if (layers.length) addPlanLabels(L, map, layers);
      for (const l of layers) {
        l.setHighlight(lit.current);
        l.setBookedVisible(!hideBooked.current);
      }
      onPlan?.(shaped.size > 0);

      let circles = 0;
      for (const d of districts) {
        if (!d.centre || covered.has(d.id ?? "")) continue;
        // Only plots that have neither coordinates nor a shape are left to the circle.
        const rest = plots.filter((p) => p.projectId === d.id && (p.latitude == null || p.longitude == null) && !shaped.has(p.id));
        if (!rest.length) continue;
        const avail = rest.filter((p) => p.status === "available").length;
        L.circle([d.centre.lat, d.centre.lng], { radius: 350, color: accent, weight: 2, dashArray: "6 6", fillOpacity: 0.12 })
          // Always labelled: these plots have no dots, so the circle is all that shows them.
          .bindTooltip(`${d.name}: ${t.area.approx(rest.length, avail)}`, { permanent: true, direction: "top" })
          .on("click", () => onDistrict?.(d.id))
          .addTo(map);
        circles++;
      }
      onApprox?.(circles > 0);
      // Booked first so available dots sit on top.
      const ordered = located.filter((p) => !shaped.has(p.id)).sort((a, b) => Number(b.status === "booked") - Number(a.status === "booked"));
      byId.clear();
      dots.length = 0;
      for (const p of ordered) {
        const booked = p.status === "booked";
        const m = L.circleMarker([p.latitude!, p.longitude!], {
          radius: 5,
          weight: 1,
          color: "#fff",
          fillColor: booked ? bad : good,
          fillOpacity: booked ? 0.75 : 0.95,
        })
          .bindTooltip(plotTooltip(p))
          .on("click", () => open(p.id));
        if (booked) dots.push(m);
        if (!booked || !hideBooked.current) m.addTo(map);
        byId.set(p.id, m);
      }
      host.current = map;
    }).catch(() => {
      if (!cancelled) setStatus("error");
    });
    return () => {
      cancelled = true;
      byId.clear();
      dots.length = 0;
      layers.length = 0;
      host.current = null;
      map?.remove();
    };
    // Rebuild when the area changes; snapshot refreshes don't move plots.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, empty]);

  useEffect(() => {
    hideBooked.current = !!availableOnly;
    for (const l of plans.current) l.setBookedVisible(!availableOnly);
    const map = host.current;
    if (!map) return; // Not built yet: the build reads hideBooked.
    for (const m of bookedDots.current) {
      if (availableOnly) map.removeLayer(m);
      else m.addTo(map);
    }
    // Re-added booked dots land on top: lift the available ones back above them.
    if (!availableOnly && bookedDots.current.length) {
      const booked = new Set(bookedDots.current);
      for (const m of markers.current.values()) if (!booked.has(m)) m.bringToFront();
    }
  }, [availableOnly]);

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
  return <div className="relative z-0 h-80 w-full overflow-hidden rounded-xl sm:h-[28rem]">
      <div ref={ref} dir="ltr" className="absolute inset-0" />
      {status === "ready" ? null : <div className="nuca-map-loading">{status === "error" ? t.mapError : t.mapLoading}</div>}
    </div>;
}
