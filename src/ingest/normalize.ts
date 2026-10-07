import { z } from "zod";
import type { NewLand } from "@/db/schema";
import { config } from "@/lib/config";

const numish = z.union([z.number(), z.string().transform(Number)]).pipe(z.number().finite());
const optNum = numish.nullish().catch(null);
const optStr = z.string().nullish().catch(null);

export const sourcePlotSchema = z.object({
  id: z.string().min(1),
  externalPlotId: z.union([z.string(), z.number()]).nullish().transform((v) => (v == null ? null : String(v))),
  plotNumber: z.union([z.string(), z.number()]).transform(String),
  square: optStr,
  area: numish.refine((n) => n > 0, "area must be > 0"),
  basePricePerMeter: optNum,
  corner: optNum,
  gardenView: optNum,
  seaOrNileView: optNum,
  totalPricePerMeter: numish,
  totalPrice: numish.refine((n) => n > 0, "price must be > 0"),
  downPayment: numish,
  zoneId: optStr,
  zoneName: optStr,
  sectorId: optStr,
  sectorName: optStr,
  cityId: optStr,
  cityName: z.string().min(1),
  isBooked: z.boolean(),
  bookingDate: optStr,
  geoJson: optStr,
  lastModificationTime: optStr,
});
export type SourcePlot = z.infer<typeof sourcePlotSchema>;

export const pagedSchema = z.object({ totalCount: z.number().int().nonnegative(), items: z.array(z.unknown()) });

export const statsSchema = z.object({
  totalPlots: z.number(),
  bookedPlots: z.number(),
  availablePlots: z.number(),
  lastUpdate: z.string().nullish(),
});

export const enhancedStatsSchema = z
  .object({
    allocatedBookings: z.number().nullish(),
    bigDownPaymentPlots: z.number().nullish(),
    lowDownPaymentPlots: z.number().nullish(),
    todayBookedPlots: z.number().nullish(),
    todayAllocatedBookings: z.number().nullish(),
  })
  .passthrough();

export const allocationSchema = z.object({
  id: z.string(),
  issueDate: z.string(),
  totalCodes: z.number().int().nonnegative(),
});
export const allocationStatSchema = z.object({
  allocationId: z.string(),
  issueDate: z.string(),
  totalCodesIssued: z.number(),
  plotsBooked: z.number(),
});

export const citySchema = z.object({ id: z.string(), name: z.string(), code: z.string().nullish() });
export const sectorSchema = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string().nullish(),
  cityId: z.string().nullish(),
  isHot: z.boolean().nullish(),
  isFullyBooked: z.boolean().nullish(),
});

const SOURCE_TZ = process.env.SOURCE_TIMEZONE ?? "Africa/Cairo";

/** Offset (ms) of `tz` from UTC at the given instant. */
function tzOffsetMs(utc: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(utc);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(utc.getTime() / 1000) * 1000;
}

/** Source timestamps have no zone suffix and are Cairo local time. */
export function parseSourceDate(s: string | null | undefined, tz = SOURCE_TZ): Date | null {
  if (!s) return null;
  if (/[zZ]|[+-]\d\d:?\d\d$/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const naive = new Date(`${s}Z`);
  if (Number.isNaN(naive.getTime())) return null;
  // Two passes handle DST transitions.
  let utc = naive.getTime() - tzOffsetMs(naive, tz);
  utc = naive.getTime() - tzOffsetMs(new Date(utc), tz);
  return new Date(utc);
}

/** Centroid (vertex average) of the first polygon ring in a GeoJSON Feature string. */
export function parseGeometry(geoJson: string | null | undefined): {
  lat: number | null;
  lng: number | null;
  geometry: unknown;
} {
  if (!geoJson) return { lat: null, lng: null, geometry: null };
  try {
    const f = JSON.parse(geoJson);
    const geom = f?.geometry ?? f;
    let ring: number[][] | undefined;
    if (geom?.type === "Polygon") ring = geom.coordinates?.[0];
    else if (geom?.type === "MultiPolygon") ring = geom.coordinates?.[0]?.[0];
    if (!ring?.length) return { lat: null, lng: null, geometry: null };
    const pts = ring.filter((p) => Array.isArray(p) && p.length >= 2);
    const lng = pts.reduce((a, p) => a + p[0], 0) / pts.length;
    const lat = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    return { lat, lng, geometry: { type: "Polygon", coordinates: [pts.map((p) => [p[0], p[1]])] } };
  } catch {
    return { lat: null, lng: null, geometry: null };
  }
}

export function normalizePlot(p: SourcePlot): Omit<NewLand, "firstSeenAt" | "lastSeenAt" | "updatedAt"> {
  const { lat, lng, geometry } = parseGeometry(p.geoJson);
  return {
    id: p.id,
    externalPlotId: p.externalPlotId,
    cityId: p.cityId ?? null,
    cityName: p.cityName.trim(),
    projectId: p.sectorId ?? null,
    projectName: p.sectorName?.trim() ?? null,
    zoneId: p.zoneId ?? null,
    zoneName: p.zoneName?.trim() ?? null,
    square: p.square?.trim() ?? null,
    plotNumber: p.plotNumber.trim(),
    area: p.area,
    basePricePerMeter: p.basePricePerMeter ?? null,
    pricePerMeter: p.totalPricePerMeter,
    totalPrice: p.totalPrice,
    downPayment: p.downPayment,
    cornerPct: p.corner ?? 0,
    gardenPct: p.gardenView ?? 0,
    seaPct: p.seaOrNileView ?? 0,
    latitude: lat,
    longitude: lng,
    geometry,
    status: p.isBooked ? "booked" : "available",
    bookingDate: parseSourceDate(p.bookingDate),
    source: config.sourceName,
    sourceUrl: `${config.sourceApiUrl}/api/app/land-plot/${p.id}`,
    sourceUpdatedAt: parseSourceDate(p.lastModificationTime),
  };
}

/** Validate raw items; returns valid normalized plots (deduped by id) and a count of rejects. */
export function validatePlots(raw: unknown[]) {
  const byId = new Map<string, ReturnType<typeof normalizePlot>>();
  let rejected = 0;
  const errors: string[] = [];
  for (const item of raw) {
    const r = sourcePlotSchema.safeParse(item);
    if (!r.success) {
      rejected++;
      if (errors.length < 5) errors.push(r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
      continue;
    }
    byId.set(r.data.id, normalizePlot(r.data));
  }
  return { plots: [...byId.values()], rejected, errors };
}
