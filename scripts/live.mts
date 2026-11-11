/**
 * The 1-minute loop (GitHub Actions `live.yml`, around the clock: cron-job.org dispatches it every 10 minutes and one job follows the other):
 *   FIREBASE_SERVICE_ACCOUNT='<json>' LIVE_MINUTES=350 npx tsx scripts/live.mts [--dry-run]
 * Probes every zone's last page about once a minute and re-walks only the zones that changed, so a booked plot shows
 * on the site (and fires the «مفضلتك» push) within about a minute. See src/ingest/live.ts and README "Data sync".
 *   LIVE_MINUTES     how long to loop (default 350: one GitHub job may run 6 h)
 *   --dry-run        crawl and log, write nothing, send nothing
 */
import { liveState, notifyWatchers, sendTestPushes, store, updateCensus } from "@/ingest/firestore-sync";
import { runLive } from "@/ingest/live";

const dryRun = process.argv.includes("--dry-run");
const minutes = Number(process.env.LIVE_MINUTES ?? 350);
let runs = 0;

const stats = await runLive(store, {
  durationMs: minutes * 60_000,
  dryRun,
  state: liveState,
  // 03:00 Cairo: the daily full pass (booked views, zone list), when hardly anyone books.
  fullHour: 3,
  async onRun(r) {
    runs++;
    if (!process.env.NO_PUSH) {
      if (r.newlyBookedLabels.length) {
        const pushes = await notifyWatchers(r.newlyBookedLabels);
        console.log(`[live] push: ${JSON.stringify(pushes)} for ${r.newlyBookedLabels.length} newly booked`);
      }
      if (r.newlyHeldLabels.length) {
        const pushes = await notifyWatchers(r.newlyHeldLabels, "held");
        console.log(`[live] push: ${JSON.stringify(pushes)} for ${r.newlyHeldLabels.length} newly held`);
      }
    }
    // The census is a count query; once every ~60 walks is plenty (the full one after the nightly pass).
    if (r.mode === "full") await updateCensus(true);
    else if (runs % 60 === 1) await updateCensus(false);
  },
  async onTick() {
    if (!process.env.NO_PUSH) await sendTestPushes();
  },
});
console.log(`[live] done: ${JSON.stringify(stats)}`);
process.exit(0);
