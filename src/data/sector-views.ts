import type { LatLng } from "@/engine/nearbuilt";

/**
 * The source's own map view per district (its reservation map's saved `center` in EPSG:3857 metres and
 * `zoom`), keyed by the source's sector id. Used as the district's location when none of its plots has
 * coordinates, ahead of the rougher tile bounds. Copy entries verbatim from the source's map state.
 */
export interface SectorView {
  center: [x: number, y: number];
  zoom: number;
}

export const SECTOR_VIEWS: Record<string, SectorView> = {
  // السادات: المحور المركزى
  "9a02c998-6d3c-ec69-0d9e-3a21bf7fa3e8": { center: [3397517.082075122, 3557688.8177515413], zoom: 14.72 },
};

const R = 6378137;

/** Web Mercator (EPSG:3857) metres → [lat, lng]. */
export function mercatorToLatLng([x, y]: [number, number]): LatLng {
  return [(Math.atan(Math.sinh(y / R)) * 180) / Math.PI, (x / R) * (180 / Math.PI)];
}

export function viewCentres(views: Record<string, SectorView> = SECTOR_VIEWS): Map<string, LatLng> {
  return new Map(Object.entries(views).map(([id, v]) => [id, mercatorToLatLng(v.center)]));
}
