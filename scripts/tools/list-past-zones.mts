/**
 * Lists the zones of a city's earlier offerings: the projects its city page marks with a red ball (not open in the
 * current phase). They still publish their plan images, which the maps draw muted behind the current stage.
 *   npx tsx scripts/tools/list-past-zones.mts --city <cityId> --out <zones.tsv>
 * Writes the tab-separated rows scripts/plans/fetch_plans.py reads (zid, pid, cityId, city, name, flag, sectors;
 * flag is MISSING, sectors empty) followed by two more columns: stage and project name. Stage is the phase number
 * read from the project name (10, 9, 8 …; "9c" for a complementary phase) or 0 when the name gives none.
 */
import { writeFileSync } from "node:fs";
import { fetchJsonPost, fetchText } from "@/ingest/fetcher";
import { createClient, parseCitiesJson, parseCityPage, parseProjectPage } from "@/ingest/nuca-plots";
import { OFFICIAL_SITE, officialUrl } from "@/ingest/official";

const ORDINALS: [RegExp, number][] = [
  [/الحادي[ةه]? عشر/, 11],
  [/العاشر/, 10],
  [/التاسع/, 9],
  [/الثامن/, 8],
  [/السابع/, 7],
  [/السادس/, 6],
  [/الخامس/, 5],
  [/الرابع/, 4],
  [/الثالث/, 3],
  [/الثاني/, 2],
  [/الأول|الاول/, 1],
];

/** «المرحلة العاشرة …» → "10"; «المرحلة التاسعة التكميلية …» → "9c"; no «المرحلة» in the name → "0". */
export function stageOf(projectName: string): string {
  const at = projectName.indexOf("المرحل");
  if (at < 0) return "0";
  const rest = projectName.slice(at);
  const hit = ORDINALS.map(([re, n]) => ({ n, i: rest.search(re) })).filter((h) => h.i >= 0).sort((a, b) => a.i - b.i)[0];
  if (!hit) return "0";
  return `${hit.n}${/تكميل/.test(rest) ? "c" : ""}`;
}

const args = process.argv.slice(2);
const arg = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const cityId = Number(arg("--city"));
const out = arg("--out");
if (!cityId || !out) throw new Error("--city <cityId> --out <zones.tsv> are required");

const client = createClient((url, init) => fetchText(url, { method: init?.method, body: init?.body, headers: init?.headers }), { delayMs: OFFICIAL_SITE.delayMs });
const city = parseCitiesJson(await fetchJsonPost(officialUrl.cities(), {})).find((c) => c.id === cityId);
if (!city) throw new Error(`no city ${cityId} on the official site`);
const projects = parseCityPage(await client.get(officialUrl.city(cityId))).filter((p) => !p.green);
console.log(`${city.name}: ${projects.length} earlier project(s)`);
const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const rows: string[] = [];
const seen = new Set<number>();
for (const p of projects) {
  const zones = parseProjectPage(await client.get(officialUrl.project(p.pid)));
  const stage = stageOf(p.name);
  console.log(`  project ${p.pid} «${clean(p.name)}» stage ${stage}: ${zones.length} zone(s)`);
  for (const z of zones) {
    if (seen.has(z.zid)) continue;
    seen.add(z.zid);
    rows.push([z.zid, p.pid, cityId, city.name, clean(z.name), "MISSING", "", stage, clean(p.name)].join("\t"));
  }
}
writeFileSync(out, rows.join("\n") + "\n");
console.log(`${rows.length} zone(s) → ${out}`);
