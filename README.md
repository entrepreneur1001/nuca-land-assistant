# مساعد أراضي بيت الوطن · NUCA Land Assistant

A public, Arabic (Egyptian), phone-friendly site that answers:

> **With my rank and the money I paid, which NUCA plots can I realistically book, ideally on a garden, a corner (ناصية), and near already-built areas?**

It runs entirely on the **Firebase free (Spark) plan**:

```
baytwaten4all API ─┐
OpenStreetMap ─────┤→ GitHub Actions (every 15 min) → Firestore (meta + 8 gzipped plot chunks)
                                                          ↓
                         Firebase Hosting (static Next.js export) → browser computes everything
                                                          ↳ Firebase AI Logic (Gemini) on a button
                                                          ↳ Google Analytics for Firebase
```

The site is **read-only**. It never logs in to NUCA or books anything. Each visitor's settings (rank, amount paid, preferences) live only in their own browser (localStorage, shareable via a link).

## Develop

```bash
npm install
npm run sync:local -- --full   # fetch all plots + OSM into public/dev-snapshot (no Firebase needed; first run 10–30 min because of OSM)
npm run dev:local              # http://localhost:3000 reading the local snapshot
npm test                       # 40 tests
```

`npm run dev` (without `:local`) reads the live Firestore.

## Firebase setup (one time)

Project: **`nuca-lands-assistant`** (already created, web app registered; the config is in `src/lib/firebase.ts`, public by design).

Console steps (no CLI for these):
1. **Firestore**: create the database. Or enable the API at
   https://console.developers.google.com/apis/api/firestore.googleapis.com/overview?project=nuca-lands-assistant and then run
   `firebase firestore:databases:create "(default)" --location=eur3`.
2. **Authentication → Sign-in method → Anonymous: Enable** (used only to write the shared AI cache).
3. **AI Logic → Get started → Gemini Developer API** (free tier). Then set **per-user rate limit** (e.g. 5 requests/min).
   Optional: **App Check** with reCAPTCHA v3 to stop abuse.
4. **Analytics → Enable Google Analytics**. Then put the `measurementId` in `.env.local` as `NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=G-…` before building.
5. **Project settings → Service accounts → Generate new private key**. This is for the sync job.

Deploy:

```bash
npm run deploy        # tests + static build + firebase deploy (hosting + firestore rules)
```

## Data sync (GitHub Actions)

`.github/workflows/sync.yml` runs `scripts/ingest.mts` every 15 minutes (public repo, so Actions minutes are free):

```bash
gh secret set FIREBASE_SERVICE_ACCOUNT < service-account.json
gh workflow run sync.yml -f full=true -f osm=true     # first seed
```

Each run:
1. Polls the source's stats (tiny).
2. If anything changed, or 2 h have passed, re-downloads all plots (16 pages, 1 s apart). The data is validated with zod, and partial snapshots are rejected, so missing plots are never marked booked.
3. Weekly, or when new plots appear, queries **OpenStreetMap Overpass** per city for existing buildings and developed land. It computes each plot's distance to the nearest one. Plots without coordinates use their district's centre. If a city's query fails, that city keeps its previous distances.
4. Writes **only the chunks whose content changed**, plus `meta/current`. That's ~100–300 writes/day.

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
- **Score** (weights editable in «بحث متقدم → أوزان الترتيب»):

| Factor | Weight |
|---|---|
| reachability (فرصة إنك تلحقها) | 20 |
| near built (قربها من العمار) | 20 |
| garden/corner (حديقة/ناصية) | 20 |
| budget (مناسبة لميزانيتك) | 15 |
| preferred location | 10 |
| price/m² vs similar | 10 |
| area | 5 |

  - Hard filters: booked; down payment > paid + max extra; any feature set to «لازم».
  - Bands: لقطة ≥ 80, كويسة ≥ 65, تحت المراقبة ≥ 50.
  - A plot with < 30% survival is capped at «تحت المراقبة».
- **AI:**
  - Gemini runs through Firebase AI Logic, so no API key ships in the site.
  - It receives up to 40 diversified candidates. The answer is JSON in Egyptian Arabic, validated with zod; unknown land ids are dropped.
  - Results are cached in `ai_cache/{hash(profile+dataVersion+model)}`. There is a 30 s cooldown per browser, plus the AI Logic per-user limit.

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
