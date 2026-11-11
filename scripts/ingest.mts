/**
 * Data sync job (run by GitHub Actions every 15 min, or manually):
 *   FIREBASE_SERVICE_ACCOUNT='<json>' npx tsx scripts/ingest.mts [--full] [--zones] [--bootstrap] [--accept-large] [--dry-run]
 * Reads the official NUCA site (no credentials needed). Uses the Firestore emulator when FIRESTORE_EMULATOR_HOST is set.
 *   --full          also crawl the booked views (daily)
 *   --zones         re-discover the zone list now
 *   --bootstrap     allow starting with an empty store (no ids/coordinates to freeze)
 *   --accept-large  accept a run that marks more plots booked than the safety limit
 *   --dry-run       crawl and report, write nothing
 */
import { runSync } from "@/ingest/run";
import { notifyWatchers, store, updateCensus } from "@/ingest/firestore-sync";

const args = new Set(process.argv.slice(2));
const r = await runSync(store, {
  full: args.has("--full"),
  forceZones: args.has("--zones"),
  bootstrap: args.has("--bootstrap"),
  acceptLarge: args.has("--accept-large"),
  dryRun: args.has("--dry-run"),
});
let pushes: Awaited<ReturnType<typeof notifyWatchers>> | null = null;
if (!r.error && !r.dryRun && !process.env.NO_PUSH) {
  try {
    if (r.newlyBookedLabels.length) pushes = await notifyWatchers(r.newlyBookedLabels);
    if (r.newlyHeldLabels.length) await notifyWatchers(r.newlyHeldLabels, "held");
    await updateCensus(args.has("--full"));
  } catch (e) {
    console.warn(`push: skipped (${e instanceof Error ? e.message : e})`);
  }
}

console.log(
  JSON.stringify({ ...r, changedChunks: r.changedChunks.length, officialNew: r.officialNew.map((i) => i.nid), newlyBookedPlots: r.newlyBookedPlots.length, newlyBookedLabels: r.newlyBookedLabels.length, newlyHeldLabels: r.newlyHeldLabels.length, pushes }),
);
process.exit(r.error ? 1 : 0);
