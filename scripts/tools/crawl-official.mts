/**
 * One-off crawl of every official zone (available + booked views) for the mapping generator.
 *   npx tsx scripts/tools/crawl-official.mts --out <file.json> [--zones 4797,3586]
 * Writes [{ zid, pid, cityId, cityName, name, egpPerM, available: ZoneRow[], booked: ZoneRow[] }]; zones whose
 * crawl was incomplete are reported and left out (never a partial list).
 */
import { writeFileSync } from "node:fs";
import { fetchJsonPost, fetchText } from "@/ingest/fetcher";
import { crawlZone, createClient, discoverZones } from "@/ingest/nuca-plots";
import { OFFICIAL_SITE } from "@/ingest/official";

const args = process.argv.slice(2);
const out = args[args.indexOf("--out") + 1];
if (!out || args.indexOf("--out") < 0) throw new Error("--out <file.json> is required");
const only = args.includes("--zones") ? new Set(args[args.indexOf("--zones") + 1].split(",").map(Number)) : null;

const client = createClient((url, init) => fetchText(url, { method: init?.method, body: init?.body, headers: init?.headers }), { delayMs: OFFICIAL_SITE.delayMs });
const zones = (await discoverZones(client, fetchJsonPost)).filter((z) => !only || only.has(z.zid));
console.log(`${zones.length} zone(s) to crawl`);
const result = [];
const failed: number[] = [];
for (const [i, z] of zones.entries()) {
  const a = await crawlZone(client, z.zid, "available");
  const b = await crawlZone(client, z.zid, "booked");
  if (!a.ok || !b.ok) {
    failed.push(z.zid);
    console.log(`${i + 1}/${zones.length} zone ${z.zid} FAILED: ${a.error ?? b.error}`);
    continue;
  }
  result.push({ ...z, egpPerM: a.egpPerM, available: a.rows, booked: b.rows });
  console.log(`${i + 1}/${zones.length} zone ${z.zid} ${z.cityName} «${z.name}»: ${a.rows.length} available (${a.rows.filter((r) => r.status === "held").length} held), ${b.rows.length} booked`);
  writeFileSync(out, JSON.stringify(result));
}
console.log(`done: ${result.length} zones, ${result.reduce((n, z) => n + z.available.length + z.booked.length, 0)} plots${failed.length ? `, FAILED: ${failed.join(", ")}` : ""}`);
