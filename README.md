# مساعد أراضي بيت الوطن · NUCA Land Assistant

A public, Arabic (Egyptian), phone-friendly site that answers:

> **With my rank and the money I paid, which NUCA plots can I realistically book, ideally on a garden, a corner (ناصية), and near already-built areas?**

Everything runs on free tiers: **Firebase (Spark)** Hosting, Firestore, AI Logic, Analytics, plus **GitHub Actions** for the 15-minute sync.

```
baytwaten4all API ─┐
OpenStreetMap ─────┤→ GitHub Actions (every 15 min) → Firestore (meta + 8 gzipped plot chunks, AI cache)
                                                          ↓ public read
          Firebase Hosting (static Next.js export) → the visitor's browser computes the ranking (Web Worker)
                                                   ↳ Gemini via Firebase AI Logic (App Check / Fraud Defense)
                                                   ↳ Google Analytics for Firebase
```

No Gemini API key is used or stored anywhere. AI Logic calls Gemini on behalf of the Firebase project.

The site is **read-only**. It never logs in to NUCA or books anything. Each visitor's settings (rank, amount paid, preferences) live only in their own browser (localStorage, shareable via a link).

## Develop

```bash
npm install
npm run sync:local -- --full   # fetch all plots + OSM into public/dev-snapshot (no Firebase needed; first run 10–30 min because of OSM)
npm run dev:local              # http://localhost:3000 reading the local snapshot
npm test                       # 51 tests
```

`npm run dev` (without `:local`) reads the live Firestore.

Seed Firestore from a local snapshot (saves the first OSM runs):
`GOOGLE_APPLICATION_CREDENTIALS=service-account.json npx tsx scripts/seed-from-local.mts`

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

## Data sync (GitHub Actions)

`.github/workflows/sync.yml` runs `scripts/ingest.mts` every 15 minutes (public repo, so Actions minutes are free):

```bash
gh secret set FIREBASE_SERVICE_ACCOUNT < service-account.json
gh workflow run sync.yml -f full=true -f osm=true     # first seed
```

Each run:
1. Polls the source's stats (tiny).
2. If anything changed, or 2 h have passed, re-downloads all plots (16 pages, 1 s apart). The data is validated with zod, and partial snapshots are rejected, so missing plots are never marked booked.
3. Queries **OpenStreetMap Overpass** for existing buildings and developed land within 5 km of each district centre. It computes each plot's distance to the nearest one. Plots without coordinates use their district's centre.
   - Each run refreshes at most 3 cities, choosing those whose data is older than 7 days or that gained new plots. That keeps every run short.
   - If a city's query fails, that city keeps its previous distances.
   - The same run also fetches main roads (3 km around each district centre) for the plot → main-road distance.
4. Fills building rules (الاشتراطات البنائية) the source leaves empty from `src/data/building-rules.ts`. That table is copied from NUCA's official 11th-phase terms booklet (lands.nuca.gov.eg/Files/Handbook.pdf). Source values always win, field by field.
5. Writes **only the chunks whose content changed**, plus `meta/current`. That's ~100–300 writes/day.

## Model

All constants: `src/engine/config.ts`, `src/engine/nearbuilt.ts`.

- **Queue:**
  - People ahead = rank − booking codes issued (codes go out in daily batches of ~300, about 5 batches a week).
  - Conversion = booked ÷ codes for recently completed batches (~60–71%).
  - The ETA comes in best/expected/worst cases.
- **Depletion:**
  - Future bookings are spread across districts by last-week demand (25% smoothed toward inventory). A district that sells out spills its demand over to the others.
  - Inside a district, plots are picked using weights learned from what was already booked: garden+corner ≈3.2×, garden ≈1.9×, corner ≈1.6×.
  - Survival = `exp(−w·t)` (weighted sampling without replacement).
- **Near already-built (قربها من العمار):** `0.6 × distance score + 0.4 × booked-neighbour score`.
  - Distance score: full credit at ≤ 0.5 km, zero at ≥ 5 km.
  - Booked-neighbour score: share of plots within 400 m (or the same zone) already booked; 50%+ = full.
  - The 🏘️ badge shows at ≤ 1.5 km. "Unknown" → 0.3.
- **On a main road (على شارع رئيسي):** NUCA doesn't publish this, so it is derived from OpenStreetMap.
  - Distance from the plot's outline to the nearest motorway/trunk/primary/secondary/tertiary road (`src/engine/roads.ts`).
  - ≤ 30 m from the road's centreline counts as facing it (🛣️ badge, preference, filter). It adds +0.2 to the garden/corner factor, and «لازم» makes it a hard filter.
  - Plots without coordinates, or in cities with no mapped main roads, are "unknown" (never treated as on a road).
- **Apartments per floor (عدد الشقق في الدور):** set by the plot's area under the city authority's licensing rule (`src/engine/units.ts`).
  - < 730 m² → 2; 730–950 m² → 3 (licensing fee for the 3rd unit); > 950 m² → 4 (fee for the 4th unit + parking requirements).
  - 3 or 4 units shows the 🏢 badge and adds +0.1 / +0.2 to the garden/corner factor. It has a profile preference and a search filter; «لازم» excludes 2-unit plots.
- **Score** (weights editable in «بحث متقدم → أوزان الترتيب»):

| Factor | Weight |
|---|---|
| reachability (فرصة إنك تلحقها) | 20 |
| near built (قربها من العمار) | 20 |
| garden/corner (حديقة/ناصية) | 20 |
| preferred location | 10 |
| price/m² vs similar | 10 |
| area | 5 |

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
| Firestore writes | 20k/day | ~100–300/day |
| Egress | ~10 GiB/month | ~1 MB per first visit (gzipped chunks) |
| Hosting transfer | 360 MB/day | ~0.5 MB of JS/CSS per first visit |

## Caveats

- The data comes from a third-party tracker of the official NUCA inventory. Verify a plot on the NUCA site before booking.
- "Codes are issued in rank order" and the conversion rates are inferred, not published by NUCA.
- OpenStreetMap coverage in new cities is incomplete. The distance shown is to the nearest *mapped* building.
