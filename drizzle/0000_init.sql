CREATE TABLE "ai_analyses" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"input_hash" text NOT NULL,
	"profile_hash" text NOT NULL,
	"candidate_ids" jsonb NOT NULL,
	"response" jsonb,
	"valid" boolean NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "allocations" (
	"id" text PRIMARY KEY NOT NULL,
	"issue_date" timestamp with time zone NOT NULL,
	"total_codes" integer NOT NULL,
	"plots_booked" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cities" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingest_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"ok" boolean DEFAULT false NOT NULL,
	"pages" integer,
	"items" integer,
	"changes" integer,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "land_status_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"land_id" text NOT NULL,
	"old_status" text,
	"new_status" text NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_booking_date" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "lands" (
	"id" text PRIMARY KEY NOT NULL,
	"external_plot_id" text,
	"city_id" text,
	"city_name" text NOT NULL,
	"project_id" text,
	"project_name" text,
	"zone_id" text,
	"zone_name" text,
	"square" text,
	"plot_number" text NOT NULL,
	"area" double precision NOT NULL,
	"base_price_per_meter" double precision,
	"price_per_meter" double precision NOT NULL,
	"total_price" double precision NOT NULL,
	"down_payment" double precision NOT NULL,
	"corner_pct" double precision DEFAULT 0 NOT NULL,
	"garden_pct" double precision DEFAULT 0 NOT NULL,
	"sea_pct" double precision DEFAULT 0 NOT NULL,
	"latitude" double precision,
	"longitude" double precision,
	"geometry" jsonb,
	"status" text NOT NULL,
	"booking_date" timestamp with time zone,
	"source" text NOT NULL,
	"source_url" text,
	"source_updated_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"taken_at" timestamp with time zone DEFAULT now() NOT NULL,
	"total" integer NOT NULL,
	"booked" integer NOT NULL,
	"available" integer NOT NULL,
	"allocated_codes" integer,
	"source_last_update" timestamp with time zone,
	"raw" jsonb
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"city_id" text,
	"name" text NOT NULL,
	"code" text,
	"is_hot" boolean DEFAULT false NOT NULL,
	"is_fully_booked" boolean DEFAULT false NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_profile" (
	"id" integer PRIMARY KEY NOT NULL,
	"booking_rank" integer NOT NULL,
	"money_paid" double precision NOT NULL,
	"money_available" double precision,
	"max_additional" double precision DEFAULT 0 NOT NULL,
	"preferred_cities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"preferred_projects" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"min_area" double precision,
	"max_area" double precision,
	"preferred_area" double precision,
	"max_price" double precision,
	"preferred_price_per_meter" double precision,
	"weights" jsonb,
	"preferences" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ir_kind_started_idx" ON "ingest_runs" USING btree ("kind","started_at");--> statement-breakpoint
CREATE INDEX "lsh_land_idx" ON "land_status_history" USING btree ("land_id");--> statement-breakpoint
CREATE INDEX "lsh_detected_idx" ON "land_status_history" USING btree ("detected_at");--> statement-breakpoint
CREATE INDEX "lands_status_idx" ON "lands" USING btree ("status");--> statement-breakpoint
CREATE INDEX "lands_project_idx" ON "lands" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "lands_city_idx" ON "lands" USING btree ("city_name");--> statement-breakpoint
CREATE INDEX "ms_taken_idx" ON "market_snapshots" USING btree ("taken_at");