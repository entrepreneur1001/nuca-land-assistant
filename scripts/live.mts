/**
 * The 1-minute loop (GitHub Actions `live.yml`, started by cron-job.org at the start of the peak hours):
 *   FIREBASE_SERVICE_ACCOUNT='<json>' LIVE_MINUTES=350 npx tsx scripts/live.mts [--dry-run]
 * Probes every zone's last page about once a minute and re-walks only the zones that changed, so a booked plot shows
 * on the site (and fires the «مفضلتك» push) within about a minute. See src/ingest/live.ts and README "Data sync".
 *   LIVE_MINUTES     how long to loop (default 350: one GitHub job may run 6 h; the margin keeps it ending before the hourly run at :05)
 *   --dry-run        crawl and log, write nothing, send nothing
 */
import { notifyWatchers, store, updateCensus } from "@/ingest/firestore-sync";
import { runLive } from "@/ingest/live";

const dryRun = process.argv.includes("--dry-run");
const minutes = Number(process.env.LIVE_MINUTES ?? 350);
let runs = 0;

const stats = await runLive(store, {
  durationMs: minutes * 60_000,
  dryRun,
  async onRun(r) {
    runs++;
    if (process.env.NO_PUSH) return;
    if (r.newlyBookedLabels.length) {
      const pushes = await notifyWatchers(r.newlyBookedLabels);
      console.log(`[live] push: ${JSON.stringify(pushes)} for ${r.newlyBookedLabels.length} newly booked`);
    }
    // The census is a count query; once every ~15 walks is plenty.
    if (runs % 15 === 1) await updateCensus(false);
  },
});
console.log(`[live] done: ${JSON.stringify(stats)}`);
process.exit(0);
