import {
  pgTable,
  text,
  integer,
  doublePrecision,
  boolean,
  timestamp,
  jsonb,
  serial,
  index,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const cities = pgTable("cities", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  code: text("code"),
  source: text("source").notNull(),
  createdAt: ts("created_at").defaultNow().notNull(),
  updatedAt: ts("updated_at").defaultNow().notNull(),
});

/** A "project" is a NUCA sector (الحي) inside a city. */
export const projects = pgTable("projects", {
  id: text("id").primaryKey(),
  cityId: text("city_id"),
  name: text("name").notNull(),
  code: text("code"),
  isHot: boolean("is_hot").default(false).notNull(),
  isFullyBooked: boolean("is_fully_booked").default(false).notNull(),
  source: text("source").notNull(),
  createdAt: ts("created_at").defaultNow().notNull(),
  updatedAt: ts("updated_at").defaultNow().notNull(),
});

export const lands = pgTable(
  "lands",
  {
    id: text("id").primaryKey(),
    externalPlotId: text("external_plot_id"),
    cityId: text("city_id"),
    cityName: text("city_name").notNull(),
    projectId: text("project_id"),
    projectName: text("project_name"),
    zoneId: text("zone_id"),
    zoneName: text("zone_name"),
    square: text("square"),
    plotNumber: text("plot_number").notNull(),
    area: doublePrecision("area").notNull(),
    basePricePerMeter: doublePrecision("base_price_per_meter"),
    pricePerMeter: doublePrecision("price_per_meter").notNull(),
    totalPrice: doublePrecision("total_price").notNull(),
    downPayment: doublePrecision("down_payment").notNull(),
    cornerPct: doublePrecision("corner_pct").default(0).notNull(),
    gardenPct: doublePrecision("garden_pct").default(0).notNull(),
    seaPct: doublePrecision("sea_pct").default(0).notNull(),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    geometry: jsonb("geometry"),
    status: text("status").notNull(), // 'available' | 'booked'
    bookingDate: ts("booking_date"),
    source: text("source").notNull(),
    sourceUrl: text("source_url"),
    sourceUpdatedAt: ts("source_updated_at"),
    firstSeenAt: ts("first_seen_at").defaultNow().notNull(),
    lastSeenAt: ts("last_seen_at").defaultNow().notNull(),
    updatedAt: ts("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("lands_status_idx").on(t.status),
    index("lands_project_idx").on(t.projectId),
    index("lands_city_idx").on(t.cityName),
  ],
);

export const landStatusHistory = pgTable(
  "land_status_history",
  {
    id: serial("id").primaryKey(),
    landId: text("land_id").notNull(),
    oldStatus: text("old_status"),
    newStatus: text("new_status").notNull(),
    detectedAt: ts("detected_at").defaultNow().notNull(),
    sourceBookingDate: ts("source_booking_date"),
  },
  (t) => [index("lsh_land_idx").on(t.landId), index("lsh_detected_idx").on(t.detectedAt)],
);

export const marketSnapshots = pgTable(
  "market_snapshots",
  {
    id: serial("id").primaryKey(),
    takenAt: ts("taken_at").defaultNow().notNull(),
    total: integer("total").notNull(),
    booked: integer("booked").notNull(),
    available: integer("available").notNull(),
    allocatedCodes: integer("allocated_codes"),
    sourceLastUpdate: ts("source_last_update"),
    raw: jsonb("raw"),
  },
  (t) => [index("ms_taken_idx").on(t.takenAt)],
);

export const allocations = pgTable("allocations", {
  id: text("id").primaryKey(),
  issueDate: ts("issue_date").notNull(),
  totalCodes: integer("total_codes").notNull(),
  plotsBooked: integer("plots_booked"),
  updatedAt: ts("updated_at").defaultNow().notNull(),
});

export const ingestRuns = pgTable(
  "ingest_runs",
  {
    id: serial("id").primaryKey(),
    kind: text("kind").notNull(),
    startedAt: ts("started_at").defaultNow().notNull(),
    finishedAt: ts("finished_at"),
    ok: boolean("ok").default(false).notNull(),
    pages: integer("pages"),
    items: integer("items"),
    changes: integer("changes"),
    error: text("error"),
  },
  (t) => [index("ir_kind_started_idx").on(t.kind, t.startedAt)],
);

export const userProfile = pgTable("user_profile", {
  id: integer("id").primaryKey(),
  bookingRank: integer("booking_rank").notNull(),
  moneyPaid: doublePrecision("money_paid").notNull(),
  moneyAvailable: doublePrecision("money_available"),
  maxAdditional: doublePrecision("max_additional").default(0).notNull(),
  preferredCities: jsonb("preferred_cities").$type<string[]>().default([]).notNull(),
  preferredProjects: jsonb("preferred_projects").$type<string[]>().default([]).notNull(),
  minArea: doublePrecision("min_area"),
  maxArea: doublePrecision("max_area"),
  preferredArea: doublePrecision("preferred_area"),
  maxPrice: doublePrecision("max_price"),
  preferredPricePerMeter: doublePrecision("preferred_price_per_meter"),
  weights: jsonb("weights").$type<Record<string, number>>(),
  preferences: jsonb("preferences").$type<Record<string, unknown>>(),
  updatedAt: ts("updated_at").defaultNow().notNull(),
});

export const aiAnalyses = pgTable("ai_analyses", {
  id: serial("id").primaryKey(),
  createdAt: ts("created_at").defaultNow().notNull(),
  inputHash: text("input_hash").notNull(),
  profileHash: text("profile_hash").notNull(),
  candidateIds: jsonb("candidate_ids").$type<string[]>().notNull(),
  response: jsonb("response"),
  valid: boolean("valid").notNull(),
  error: text("error"),
});

export type Land = typeof lands.$inferSelect;
export type NewLand = typeof lands.$inferInsert;
export type UserProfile = typeof userProfile.$inferSelect;
