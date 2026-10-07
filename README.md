# NUCA Land Assistant

A local, phone-friendly dashboard that answers one question:

> **With my rank and budget, which still-available NUCA plots should I target, and which one should I pick if my turn comes now?**

It is **read-only**. It recommends; it never logs in to NUCA or books anything.

## Quick start

```bash
npm install
cp .env.example .env.local     # then put your GEMINI_API_KEY in .env.local
npm run dev                    # http://localhost:3000  (also on your LAN IP for your phone)
```

That's all. The database is an **embedded PostgreSQL (PGlite)** stored in `./data/pglite`, so there is nothing to install.
On first start the background worker downloads all ~15,500 plots (1–3 minutes). After that it keeps itself up to date.

Optional real PostgreSQL:

```bash
docker compose up -d db
echo "DATABASE_URL=postgres://nuca:nuca@localhost:5432/nuca" >> .env.local
npm run dev        # migrations run automatically on startup (or: npm run db:migrate)
```

Other scripts: `npm test` (Vitest), `npm run typecheck`, `npm run sync` (one-off ingest, **with the dev server stopped**: PGlite allows one process at a time), `npm run db:generate` (new migration after editing `src/db/schema.ts`).

Open **Settings** to set your rank, money paid, max extra payment, preferred cities and projects, area limits, garden/corner preference (*prefer* or *require*), and scoring weights.
Set `ADMIN_PASSWORD` to protect Settings and API writes with basic auth.

---

## Reconnaissance report (2026-10-07)

### Official site: `lands.nuca.gov.eg`
- Legacy ASP.NET WebForms (`__VIEWSTATE` postbacks). There is no JSON API.
- Public pages: home, `Cities.aspx`, `ViewCity.aspx?ID=<code>`. **Plot availability and booking require login** (`Account/Login.aspx`).
- We do **not** scrape it. That would mean automating a user session, which the project rules forbid. Plots keep NUCA's ID (`externalPlotId`) for cross-reference.

### Existing tracker: `baytwaten4all.online`
- An Angular SPA on an ABP Framework (.NET) backend at `https://api.baytwaten4all.online`. Its own backend syncs from NUCA, and its frontend refreshes every 60 s.
- It exposes **public, anonymous, read-only JSON** endpoints. We use only these GETs:

| Endpoint | Used for |
|---|---|
| `/api/app/dashboard/dashboard-statistics` | total / booked / available + `lastUpdate`. A cheap change detector, polled every 60 s |
| `/api/app/dashboard/enhanced-dashboard-statistics` | `allocatedBookings` (codes issued), big/low down-payment split |
| `/api/app/booking-allocation`, `/api/app/dashboard/allocation-statistics` | **daily booking-code batches** and how many plots each batch booked |
| `/api/app/land-plot?SkipCount&MaxResultCount=1000&Sorting=id` | all plots (16 pages, 1 s apart), synced only when stats change (5–30 min) |
| `/api/app/city`, `/api/app/sector` | city / sector (project) reference data, every 30 min |

- Plot fields: `id`, `externalPlotId`, `plotNumber`, `cityName`, `sectorName` (project), `zoneName`, `square`, `area`, `basePricePerMeter`, `corner` / `gardenView` / `seaOrNileView` (premium %), `totalPricePerMeter`, `totalPrice`, `downPayment` (25% of the price, **USD**), `isBooked`, `bookingDate`, `geoJson` polygon, `lastModificationTime`.
- Timestamps carry no time zone and are **Cairo local time**. We convert them to UTC.

### Booking mechanics (inferred from data)
- NUCA issues **batches of booking codes** to the next ranks in the queue, ~5 batches/week (200 per batch at first, 300 now). 3,300 codes had been issued by 2026-10-07.
- Only **~60–71%** of code holders actually book (per-batch data).
- So the queue moves by **codes issued**, not by plots booked. Rank 17,000 has ~13,700 people ahead, not 14,800.
- **Garden + corner plots are booked ~3× as often as plain plots** (28.7% vs 9.0% so far), so they disappear first.

---

## How the model works

All constants are in `src/engine/config.ts`. Everything is an estimate, and the UI shows ranges, not single numbers.

### 1. Queue (`src/engine/queue.ts`)
- **People ahead** `N = rank − codes issued` (assumption A1: codes go out in rank order).
- **Conversion** `p` = booked ÷ codes for recent *completed* batches (today's batch is excluded). Low / mid / high = min / mean / max.
- **Days to turn** = `N ÷ (codes per batch × batches per week ÷ 7)`. Best case lets batches grow ×1.33; worst case uses the smallest recent batch.
- **Bookings before your turn** `B = N × p` (low / mid / high).
- With no allocation data, it falls back to `codes ≈ booked ÷ 0.7`.

### 2. Where those bookings land (`src/engine/depletion.ts`)
- Each sector's demand weight = 75% its share of the last 7 days' bookings + 25% its share of inventory (smoothing).
- A step simulation hands out `B` bookings by weight among sectors that still have stock. **When a hot sector sells out, its demand spills over** to the others.
- Inside a sector, plots are picked by **learned feature weights**: booked-rate(feature combo) ÷ booked-rate(plain). Today: corner ×1.6, garden ×1.9, garden+corner ×3.2.
- **Survival probability** per plot uses weighted sampling without replacement: `P = exp(−w·t)`, with `t` solved so the expected number of picks equals the sector's bookings. It is computed for all three scenarios (pessimistic / expected / optimistic).
- Labels: REACHABLE ≥ 70%, RISKY 30–70%, UNLIKELY < 30%.
- **Estimated reachable** = sum of survival probabilities over your eligible plots.

### 3. Score (`src/engine/scoring.ts`)
Hard filters come first. A plot is excluded if it is booked, its down payment is above (paid + max extra), it breaks your area/price limits, it lacks a *required* garden/corner, or it is outside "only preferred cities".

`score = Σ weightᵢ × factorᵢ / Σ weights` (0–100). Default weights, editable in Settings:

| Factor | Weight | Meaning |
|---|---|---|
| reachability | 25 | expected survival probability |
| budget | 15 | 1 if what you paid covers the down payment; down to 0.4 at the edge of your extra budget |
| value | 10 | $/m² vs the median of *similar* plots (same city + same garden/corner combo) |
| area | 10 | closeness to preferred area, else size percentile |
| location | 15 | your city/project priority list; otherwise market popularity |
| premium | 20 | garden+corner 1.0, garden 0.75, corner 0.6, sea-only 0.4, none 0 |
| confidence | 5 | data freshness |

Bands: STRONG_BUY ≥ 80, GOOD ≥ 65, WATCH ≥ 50, else SKIP. A plot under 30% survival is capped at WATCH. Lists sort by band, then score. The Top 5 shows at most 2 plots per sector, so you see real alternatives.

### 4. Gemini (`src/ai/`)
- Runs server-side only (`GEMINI_API_KEY` from env). It receives up to 40 deterministic candidates (max 6 per sector) with their numbers, your profile and the market stats. It returns **structured JSON**, which is validated with zod.
- Any `land_id` it returns that we didn't supply is dropped. Invalid JSON falls back to the deterministic ranking.
- Results are cached in `ai_analyses`. A refresh happens only when your preferences change, ≥5% of candidates change, a top pick gets booked, the TTL passes (60 min), or you click **Re-analyze**. Calls are at least 60 s apart.

### 5. Ingestion & data quality (`src/ingest/`)
- The worker starts with the Next.js server (`src/instrumentation.ts`). The fetcher has a timeout and exponential backoff with jitter, and handles 429/5xx.
- Every plot is validated with zod; bad items are skipped and logged, and duplicates are removed.
- **A partial snapshot is rejected**, so missing plots are never marked booked.
- Each status change goes into `land_status_history`. The initial history is backfilled from the source's `bookingDate`.
- The UI shows when data last synced, plus a **⚠ stale banner** if stats haven't updated for 10 min or the inventory sync is overdue.

### Database
`cities`, `projects` (sectors), `lands`, `land_status_history`, `market_snapshots`, `allocations`, `ingest_runs`, `user_profile`, `ai_analyses`. See `src/db/schema.ts` and `drizzle/`.

## Caveats
- The data comes from a third-party tracker, not NUCA directly. Check the plot on the official site before booking.
- A1 (codes issued in rank order) and the conversion rates are inferred, not published by NUCA. If NUCA changes batch sizes or rules, the estimates shift. The worker re-learns from new data automatically.
