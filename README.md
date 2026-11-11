# مساعد أراضي بيت الوطن · NUCA Land Assistant

A public, Arabic (Egyptian), phone-friendly site that answers:

> **With my rank and the money I paid, which NUCA plots can I realistically book, ideally on a garden, a corner (ناصية), and near already-built areas?**

Everything runs on free tiers: **Firebase (Spark)** Hosting, Firestore, AI Logic, Analytics, plus **GitHub Actions** for the sync, triggered by **cron-job.org**: a loop that catches bookings within about a minute during Cairo working hours, hourly otherwise.

```
lands.nuca.gov.eg (official: zone tables + news) ─┐
OpenStreetMap (only for plots new to the snapshot) ┤→ cron-job.org → GitHub Actions (~1-min loop Sun–Thu 10–22 Cairo; hourly otherwise) → Firestore (meta + 8 gzipped plot chunks, AI cache)
                                                          ↓ public read
          Firebase Hosting (static Next.js export) → the visitor's browser computes the ranking (Web Worker)
                                                   ↳ Gemini via Firebase AI Logic (App Check / Fraud Defense)
                                                   ↳ Google Analytics for Firebase
```

No Gemini API key is used or stored anywhere. AI Logic calls Gemini on behalf of the Firebase project.

The site is **read-only**. It reads the public pages of NUCA's official lands portal, never logs in and never books anything. Each visitor's settings (rank, amount paid, preferences) live only in their own browser (localStorage, shareable via a link).

## Develop

```bash
npm install
npx tsx scripts/tools/pull-snapshot.mts   # copy the production snapshot into public/dev-snapshot (ids, coordinates, history)
npm run sync:local -- --dry-run           # crawl the official site and print what would change, write nothing
npm run sync:local                        # update public/dev-snapshot from the official site (~7 min for 111 zones, no credentials)
npm run dev:local                         # http://localhost:3000 reading the local snapshot
npm test
```

`npm run dev` (without `:local`) reads the live Firestore.

Seed Firestore from a local snapshot: `GOOGLE_APPLICATION_CREDENTIALS=service-account.json npx tsx scripts/seed-from-local.mts`

## Setup (one time)

Done already:
- project `nuca-lands-assistant`, web app, Firestore, Analytics (`G-GBV8B6PJ55`), Anonymous auth, AI Logic (Gemini Developer API)
- Firestore rules deployed
- GitHub secret `FIREBASE_SERVICE_ACCOUNT` set

Remaining:
1. **reCAPTCHA key for App Check (Fraud Defense).** App Check is enforced on AI Logic, so without this the AI button fails. Classic reCAPTCHA v3 is deprecated in App Check; the app uses `ReCaptchaEnterpriseProvider`.
   1. Create (or migrate) a key in Google Cloud → Security → Fraud Defense (reCAPTCHA). Domains: every hosting domain, e.g. `maly-ai.web.app`, `maly-ai.firebaseapp.com`, `nuca-lands-assistant.web.app`, `localhost`.
   2. In Firebase console → App Check → Apps → web app → **Fraud Defense**, paste the **site key**.
   3. Put the same **site key** (public) in `.env.local` as `NEXT_PUBLIC_RECAPTCHA_SITE_KEY=…`, then `npm run deploy`.
2. Optional: AI Logic → Settings → set a per-user rate limit (e.g. 5 requests/min).

Local dev: register an App Check *debug token* (Firebase console → App Check → Manage debug tokens) and put it in `.env.local` as `NEXT_PUBLIC_APPCHECK_DEBUG_TOKEN=…`. It is only used by `next dev`.

Deploy: `npm run deploy` (tests, static build, then `firebase deploy` of hosting + Firestore rules).

## Data sync (cron-job.org → GitHub Actions)

`.github/workflows/sync.yml` runs `scripts/ingest.mts` (public repo, so Actions minutes are free). The cadence is **about every minute Sunday–Thursday 10:00–22:00 Africa/Cairo (the live loop below), and hourly the rest of the time**.

### The live loop (peak hours, ~1 minute)

Re-walking every zone every minute would be ~570 requests a minute against a government site behind a firewall, so the loop (`.github/workflows/live.yml` → `scripts/live.mts` → `src/ingest/live.ts`) detects changes instead:

- **Probe.** A booking removes a plot from its zone's available view and shifts every later page by one, so the zone's **last page** loses a row (or disappears) whenever any plot in it is booked, and gains one when a plot is offered again. The probe compares only that row count: the site orders tied rows differently from one request to the next, so comparing the rows themselves flagged changes that weren't there. The site accepts a page's postback state again later, so replaying "go to page N" with the hidden fields of page N−1 (saved from the last walk) reads the last page with **one request**; a one-page zone is a plain GET. A postback for a page that no longer exists answers with the error page, which also counts as a change.
- **Each minute:** probe zones most overdue first for up to 40 s (zones with plots every minute, empty zones every 5 minutes, zones that changed in the last hour first), walk only the zones whose probe changed with `runSync({ onlyZones })`, and send the «مفضلتك» pushes. Every 5th minute it also walks the zones walked longest ago (held flags, and a booking and a release in the same zone within one minute, which leave the count unchanged); every 15th it re-reads the news. A quiet minute costs ~50 requests (~1 per second, the same pace as a normal crawl) and no Firestore writes. If most probes fail (site down or blocking us) it backs off for 5 minutes instead of turning failures into walks.
- **Start:** a normal walk of every zone (~7 min) seeds the probes.
- **Schedule:** cron-job.org dispatches `live.yml` at 10:00 and 15:52, Sun–Thu (two jobs). Each job loops for 350 minutes (a GitHub job may run 6 h); the 15:52 dispatch waits in the shared `sync` concurrency group and starts when the morning job ends (~15:55). Normal `sync.yml` runs that fire meanwhile queue behind the loop, so only one process writes `meta/current` at a time. GitHub keeps one pending run per group and a newer one replaces it, which is why the morning loop must end before the hourly dispatch at 16:05 (the 350-minute margin).
- Measured on 2026-11-11: 56 of 111 zones had plots on offer, a probe takes ~1.35 s, and a "go to the last page" postback (`Page$Last`) is refused by the site's event validation, hence the replay of page N−1.

The 5-minute runs are *quick* runs (`quick` input): they crawl the stalest zones for 3 minutes (zones not reached go first next run, so every zone is re-read about every 10 minutes) and skip the OpenStreetMap distance work, which waits for the hourly run. A full crawl of all zones takes ~7 minutes at the site's safe pace (2 workers, 750 ms), so it cannot fit a 5-minute slot.

GitHub's own `schedule:` cron is **not** the trigger: GitHub runs scheduled workflows best-effort and, with `*/15`, this repo observed gaps of 2–6 hours. The workflow keeps an hourly `schedule:` only as a backup. The real trigger is [cron-job.org](https://cron-job.org) (free, timezone-aware), which calls GitHub's `workflow_dispatch` API.

```bash
gh secret set FIREBASE_SERVICE_ACCOUNT < service-account.json
gh workflow run sync.yml -f full=true                  # a full pass (available + booked views)
gh workflow run live.yml -f minutes=20 -f dry_run=true # try the live loop for 20 minutes, writing nothing
```

The official site needs no credentials. (Until Nov 2026 the data came from a third-party tracker with an OAuth token; that secret and the `private/sourceAuth` document are gone.)

### One-time trigger setup

1. **GitHub token.** GitHub → Settings → Developer settings → Fine-grained personal access tokens → *Generate new token*. Repository access: only `entrepreneur1001/nuca-land-assistant`. Permissions: **Actions → Read and write** (nothing else). Pick the longest expiry and put the renewal date in your calendar; when it expires, the 5-minute cadence silently falls back to the hourly GitHub cron.
2. **cron-job.org jobs.** Create two jobs with the same request and only the schedule different:
   - URL: `https://api.github.com/repos/entrepreneur1001/nuca-land-assistant/actions/workflows/sync.yml/dispatches`
   - Method: `POST`. Body: `{"ref":"main"}` (Job A: `{"ref":"main","inputs":{"quick":"true"}}`)
   - Headers: `Authorization: Bearer <the token>`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`, `Content-Type: application/json`, `User-Agent: nuca-sync-trigger`
   - Timezone: `Africa/Cairo`. Treat HTTP `204` as success. Turn on failure notifications (email).
   - **Jobs L1/L2, live loop:** URL `…/actions/workflows/live.yml/dispatches`, body `{"ref":"main"}`, at `10:00` (L1) and `15:52` (L2), days `Sun–Thu`.
   - **Job A, peak (quick):** *disabled since the live loop* (it would only queue behind it). Was: minutes `0,10,15,…,55` (every 5 except `5`), hours `10–21`, days `Sun–Thu`, body `{"ref":"main","inputs":{"quick":"true"}}`.
   - **Job B, off-hours:** minute `5`, every hour, every day. (Inside the window it takes Job A's minute-5 slot and runs a normal pass, which catches up on OpenStreetMap.)
3. **Check.** Press *Run now* on Job A, then `gh run list --workflow=sync.yml --limit 5 --json event,createdAt,conclusion` should show a `workflow_dispatch` run within about a minute. After an hour inside the window, runs land every 5 minutes.

The token lives only in cron-job.org. Nothing secret is stored in this repo.

### The official source

[lands.nuca.gov.eg](https://lands.nuca.gov.eg/) is an ASP.NET WebForms site whose public pages carry everything the app needs, except coordinates:

- **Zone tables.** Cities (`Cities.aspx/GetSiteCities`) → projects marked available for this phase (`ViewCity.aspx`) → zones (`ViewProject.aspx`) → `ViewZone.aspx?ID=<zid>`: a 20-row paged table (square «المربع», plot number, area, base price/m², corner/garden/sea premiums, final price/m², total, down payment, status; prices in USD) plus the zone's EGP price per m². Paging and the available/booked toggle are form postbacks with the page's `__VIEWSTATE`. 111 zones in Nov 2026.
- **Three plot states.** In the available view the status label is empty (free) or «حجز مبدئى» (someone filed a preliminary booking request; the plot is still bookable and the first down-payment transfer wins). The booked view lists «غير متاحة» plots. The app keeps all three: `held` plots count as available, show a ⏳ badge and are not scored differently (yet).
- **News.** `NewsList.aspx` posts a daily item such as «تم الانتهاء من التسجيلات حتى مسلسل 10000 … بدء من مسلسل 10001 حتى مسلسل 10700 غدا …»: the serial («مسلسل», the applicant's rank) through which booking codes were issued and the next day's range. `src/ingest/nuca-news.ts` parses them; they are the only source of codes issued and batch size.
- **Fetching rules.** Unknown paths and HEAD requests answer `302 → Error.aspx`, which then returns HTTP 200 with an error text, so a redirect is a failure and success means "a table/news list parsed". Requests are paced (750 ms between a worker's requests, 2 zones at a time) and retried with backoff. From GitHub's runners the paging POSTs (which carry the page's `__VIEWSTATE`) stall at the default MTU of 1500 while GETs work: a path-MTU blackhole towards the host. The workflow lowers the runner's interface MTU to 1300 before the sync, which makes them go through (verified with `diag.yml`). The site's firewall resets Node's default TLS handshake from some networks (GitHub's runners included) while accepting one capped at TLS 1.2, which is all the server speaks, so `src/ingest/tls.ts` caps the ingest process at TLS 1.2 (`OFFICIAL_TLS_MAX=default` to undo). `gh workflow run diag.yml` prints what a runner can reach.

The site publishes **no coordinates, no booking timestamps and no per-batch bookings**. Phase 11 is closed (NUCA announced there will be no complementary phase), so those come from the snapshot built before Nov 2026 and are frozen by plot id: `src/data/official-zones.ts` maps every official square to the district/zone of that snapshot, so plot ids, URLs, coordinates and OpenStreetMap distances stay valid. Booking times are now the first run that saw the plot booked.

### Each run

1. Fetches the news list and merges new items (by `NID`) into `meta.officialNews`. A failure here never fails the run.
2. Uses the cached zone list, re-discovering it once a day (or with `--zones`).
3. Crawls the **available view of every zone**, stalest first, within a 13-minute budget (a full pass is ~570 requests, 6–8 minutes). `--full` (run nightly at 03:17 Cairo) also crawls the booked views. A zone whose pages did not all parse is skipped as a whole: its plots keep their previous status. Zones not reached wait for the next run, which starts with them. Each request times out after 15 s (the site occasionally hangs a connection), so a bad zone costs seconds, not minutes.
4. Derives statuses: a known plot missing from its zone's available view is booked (timestamp = now); rows present take their label (free/held) and the official prices. Unknown squares get deterministic new ids with no coordinates. Safety gates: zero zones crawled → the run fails and keeps the last good data; more than 1,500 newly booked plots in one run → refused unless `--accept-large`; no previous snapshot → refused unless `--bootstrap`.
5. For plots new to the snapshot, queries **OpenStreetMap Overpass** for buildings around their district centre (`src/data/sector-views.ts`, the previous centre, or `src/data/district-centres.ts`). Existing plots keep their stored distances.
6. Fills building rules (الاشتراطات البنائية) from `src/data/building-rules.ts`, copied from NUCA's 11th-phase terms booklet (lands.nuca.gov.eg/Files/Handbook.pdf).
7. Synthesizes the daily code batches from the news (`meta.allocations`: codes = the announced range, bookings = plots seen booked that Cairo day, `meta.bookingsByDay`) and writes **only the chunks whose content changed**, plus `meta/current` (`statsAt` = this run; `fullSyncAt` = the oldest zone's last successful refresh, i.e. the moment the whole inventory is complete as of).

A failed run keeps the last good data and records `lastError` in `meta/current`. The site's "stale" badge allows 45 minutes inside the window and 90 minutes outside it, and 3 hours without a complete pass (`src/engine/compute.ts`).

### Bootstrap / regenerating the mapping

```bash
npx tsx scripts/tools/pull-snapshot.mts                                   # production snapshot → public/dev-snapshot
npx tsx scripts/tools/crawl-official.mts --out /tmp/official-plots.json  # every zone, both views (~40 min)
npx tsx scripts/tools/build-official-zones.mts /tmp/official-plots.json --write   # prints the review report, writes src/data/official-zones.ts
npm run sync:local -- --dry-run                                           # compare counts with the previous market before deploying
```

### Zone plans on the map (public/plans)

The official site publishes a plan image per zone (`ViewZone.aspx` → OpenSeadragon Deep Zoom tiles): every offered plot in yellow with its number, on the zone's street layout. These are georeferenced offline and shipped as `public/plans/<zid>.webp` (the plan, cropped) + `public/plans/<zid>.json` (`w`, `h`, the map position of three image corners, and one polygon per plot id in image pixels) + `public/plans/index.json` (zone → city, district, bounds). The maps draw the plan as a rotated image overlay with one polygon per plot (`src/components/plan-layer.ts`, `src/lib/plans.ts`), and the sync gives plots that never had coordinates the centroid of their polygon (`src/ingest/plan-places.ts`, step 3b of the run), so building distances and the area maps work for them too. Existing coordinates are never overwritten.

How a plan is georeferenced (tools in `scripts/plans/`, see its README): the yellow plots are extracted as polygons and their numbers read with Apple Vision; for zones whose plots already have coordinates, a similarity transform (scale, rotation, translation) is fitted to those coordinates (typical rms 2–4 m); zones without coordinates are placed by matching the plan's roads to OpenStreetMap, by chaining to a neighbouring plan that shows the same drawing, or from hand control points, and every placement is checked against satellite imagery before export. Plans are north-up except where noted (Sadat's districts are drawn rotated).

## Model

All constants: `src/engine/config.ts`, `src/engine/nearbuilt.ts`.

- **Queue:**
  - People ahead = rank − booking codes issued. Codes go out in one batch per working day, Sunday–Thursday in Cairo time (Friday and Saturday are off; public holidays are not modelled). Batches were 200 codes, 300 from 1 Oct 2026 and 700 from 8 Nov 2026.
  - Codes issued, the batch size and the next batch day come from the **official news** (`officialQueue` in `src/engine/queue.ts`): the latest «حتى مسلسل N» and the announced «من A حتى B» range, which counts as issued from its announced hour (default 11:00 Cairo). When the synthesized batches are newer than the latest news item, they are used instead. With no data at all the fallback is 700 codes per batch.
  - Conversion = booked ÷ codes for recently completed batches (~60–71%), where "booked" is the plots seen booked on the batch's Cairo day.
  - Bookings before your turn = people ahead × conversion, plus pending bookings from people already called: today's batch still booking, and a share (10% expected, 25% worst) of earlier code holders who haven't booked and may book late (`MODEL.lateBookingShare`).
  - The ETA walks the working-day calendar. The expected and worst cases keep the latest batch size; the best case assumes NUCA grows batches by a third (700 → 933).
- **Depletion:**
  - Future bookings are spread across districts by last-week demand (25% smoothed toward inventory). A district that sells out spills its demand over to the others.
  - Inside a district, plots are picked using weights learned from what was already booked: garden+corner ≈3.2×, garden ≈1.9×, corner ≈1.6×.
  - Survival = `exp(−w·t)` (weighted sampling without replacement).
- **Near already-built (قربها من العمار):** `0.6 × distance score + 0.4 × booked-neighbour score`.
  - Distance score: full credit at ≤ 0.5 km, zero at ≥ 5 km.
  - Booked-neighbour score: share of plots within 400 m (or the same zone) already booked; 50%+ = full.
  - The 🏘️ badge shows at ≤ 1.5 km. "Unknown" → 0.3.
- **Frontage (الواجهة):** what the plot faces. NUCA doesn't publish it; `scripts/surroundings/build.mts` measures it offline from each plot's outline on the official zone plan and writes `public/surroundings.json`, which the browser merges into the plots (`src/lib/surroundings.ts`).
  - Faces = within reach of the plot's edge with no other plan plot in between (border gaps < 2.5 m don't count), so the second row behind a road-front plot is not "on the road": main road (OSM motorway…tertiary) ≤ 100 m from its centreline; compound (`public/compounds`) ≤ 120 m from its outline; existing buildings (OSM) ≤ 80 m; services land («اراضي خدمات», the solid pink on the official plan, traced by `scripts/surroundings/services_land.py` into `services-land.json`) ≤ 60 m, i.e. across the street. Across a main road still counts (the front row on a highway faces what is on the other side).
  - Premium compound = in the pricier third of compounds within 10 km (Nawy's lowest listed price).
  - Factor (`src/engine/surroundings.ts`): premium compound 1, compound 0.9, main road 0.8, buildings 0.75, services land 0.75, near a compound (outline ≤ 500 m, anything in between, e.g. across a highway) 0.7 / premium 0.8; +0.1 when two apply; +0.05 for a university/college/hospital/mall/club/station ≤ 1.5 km (`public/places`, where present). An inner plot, or one not measured, is neutral at 0.5, so the factor lifts good frontage without lowering other plots' bands.
  - Badges 🛣️ / 🏰 / 🏠, a profile preference («لازم» = faces at least one), a search filter and sort. Plots without an outline fall back to the older OSM road distance (≤ 30 m).
  - Re-run the script after new plans, compounds or places land: `npx tsx scripts/surroundings/build.mts` (OSM answers cached in `data/surroundings/osm`; `--refresh` to ask again, `--zone` for some zones, `--debug` for per-zone dumps).
- **Apartments per floor (عدد الشقق في الدور):** set by the plot's area under the Ministry of Housing notice for the 11th offering (`src/engine/units.ts`).
  - ≤ 550 m² → 2; 551–750 m² → 3; 751–950 m² → 4; ≥ 951 m² → 5. Conditions: unit ≥ 100 m² incl. services/balconies, parking, utilities capacity.
  - 3, 4 or 5 units shows the 🏢 badge and adds +0.1 / +0.2 / +0.3 to the garden/corner factor. It has a profile preference and a search filter; «لازم» excludes 2-unit plots.
  - **New Alamein** is exempt: the city sets units *per plot* by block (block 1: 29–44, block 10: 21–35, block 11: 18–45). Those plots have no per-floor number, no badge and no bonus, but count as multi-unit for «لازم» and the filter.
- **Score** (weights editable in «بحث متقدم → أوزان الترتيب»):

| Factor | Weight |
|---|---|
| reachability (فرصة إنك تلحقها) | 20 |
| near built (قربها من العمار) | 20 |
| frontage (الواجهة: طريق / كمبوند / مباني) | 20 |
| garden/corner (حديقة/ناصية) | 20 |
| preferred location | 10 |
| price/m² vs similar | 10 |
| area | 5 |
| booking speed (بتتحجز بسرعة دلوقتي) | 15, only near your turn |

  - Booking speed (`engine/demand.ts`) is the share of a district's inventory booked in the last 7 days, blended 70/30 with its city's share and scaled 0–1. A district with fewer than 5 recent bookings leans on its city's figure. Where people are booking now is a crowd signal that the place is good.
  - It counts fully when your turn is ≤ 3 days away and fades to 0 at 21 days. Far ranks score as if it weren't there, because fast-selling districts will be gone by then, which survival already covers.

  - Hard filters: booked; down payment > amount paid; any feature set to «لازم».
  - Bands: لقطة ≥ 80, كويسة ≥ 65, تحت المراقبة ≥ 50.
  - A plot with < 30% survival is capped at «تحت المراقبة».
- **AI (Firebase AI Logic):**
  - The browser sends Gemini the backend-computed candidates through AI Logic, protected by App Check. There is no API key.
  - It receives up to 40 diversified candidates. The answer is JSON in Egyptian Arabic, validated with zod; unknown land ids are dropped.
  - Results are cached in `ai_cache/{hash(profile+dataVersion+model)}`.
  - Limits: 30 s cooldown per browser, plus the AI Logic per-user rate limit and App Check.
  - Visitors write the cache through anonymous auth. Firestore rules allow create-only, with size and shape checks.

## Free-tier budget

| Resource | Spark limit | Our use |
|---|---|---|
| Firestore reads | 50k/day | ~10 per first visit, 1–3 per return visit (chunks cached by version in IndexedDB) |
| Firestore writes | 20k/day | ~100–300/day, plus up to ~60/hour in the peak (the live loop writes only when a zone changed, and every 5 minutes) |
| GitHub Actions | 2,000 min/month on private repos; free on public | two ~6 h live jobs on weekdays + ~12 hourly runs/day (public repo) |
| Egress | ~10 GiB/month | ~1 MB per first visit (gzipped chunks) |
| Hosting transfer | 360 MB/day | ~0.5 MB of JS/CSS per first visit |

## Caveats

- The data is read from the public pages of the official NUCA site every 5–10 minutes; a plot can still be taken between two runs. Verify a plot on the NUCA site before booking.
- "Booked" means the plot is not offered right now; NUCA cancels preliminary bookings whose transfer never arrives, so a plot can come back. «حجز مبدئى» (⏳) means someone has a pending request on it; you can still book it, the first transfer wins.
- Booking times before Nov 2026 come from the earlier snapshot; later ones are the sync run that first saw the plot booked (5–10-minute resolution).
- "Codes are issued in rank order" and the conversion rates are inferred, not published by NUCA.
- OpenStreetMap coverage in new cities is incomplete. The distance shown is to the nearest *mapped* building.
