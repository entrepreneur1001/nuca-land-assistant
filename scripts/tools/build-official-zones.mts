/**
 * Generate src/data/official-zones.ts: which official square (zone page + «المربع») is which tracker district/zone.
 *   npx tsx scripts/tools/build-official-zones.mts <crawl.json> [--snapshot public/dev-snapshot] [--write]
 * Matching tiers per square: (1) normalized name equality or containment, (2) plot-number overlap (Jaccard ≥ 0.5
 * and ≥ 1.5× the runner-up) against zones of the same city, (3) per-plot (plotNo, area, total) votes.
 * Prints a review report; --write emits the table (hand-edit the generated file afterwards if needed).
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { unpackTuples, type MetaDoc } from "@/data/snapshot";
import type { ZoneRow } from "@/ingest/nuca-plots";
import { normalizeName, type OfficialZoneEntry } from "@/ingest/official-map";

interface CrawledZone { zid: number; pid: number; cityId: number; cityName: string; name: string; egpPerM: number | null; available: ZoneRow[]; booked: ZoneRow[] }

const args = process.argv.slice(2);
const crawlFile = args.find((a) => !a.startsWith("--"));
if (!crawlFile) throw new Error("usage: build-official-zones.mts <crawl.json> [--snapshot dir] [--write]");
const snapDir = args.includes("--snapshot") ? args[args.indexOf("--snapshot") + 1] : path.join(process.cwd(), "public", "dev-snapshot");
const crawl = JSON.parse(readFileSync(crawlFile, "utf8")) as CrawledZone[];
const meta = JSON.parse(readFileSync(path.join(snapDir, "meta.json"), "utf8")) as MetaDoc;
const tuples = (await Promise.all(meta.chunks.map(async (c) => unpackTuples(JSON.parse(readFileSync(path.join(snapDir, `${c.id}.json`), "utf8")).data)))).flat();

// tracker: city → zone → { sector, plots }
interface TZone { city: string; zone: string; sector: string; nos: Set<string>; plots: { no: string; area: number; total: number }[] }
const tzones = new Map<string, TZone>();
for (const t of tuples) {
  const city = meta.cities[t[3]];
  const zone = meta.zones[t[5]] ?? "";
  const k = `${city}|${zone}`;
  const z = tzones.get(k) ?? { city, zone, sector: meta.sectors[t[4]]?.id ?? "", nos: new Set(), plots: [] };
  z.nos.add(t[2]);
  z.plots.push({ no: t[2], area: t[6], total: t[8] });
  tzones.set(k, z);
}
const cityByNorm = new Map(meta.cities.map((c) => [normalizeName(c), c]));
const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.5, Math.abs(b) * 0.005);

const cities: Record<number, string> = {};
const entries: OfficialZoneEntry[] = [];
const report: string[] = [];
for (const z of crawl) {
  const city = cityByNorm.get(normalizeName(z.cityName)) ?? z.cityName;
  cities[z.cityId] = city;
  const inCity = [...tzones.values()].filter((t) => t.city === city);
  const bySquare = new Map<string, ZoneRow[]>();
  for (const r of [...z.available, ...z.booked]) bySquare.set(r.square, [...(bySquare.get(r.square) ?? []), r]);
  const squares: OfficialZoneEntry["squares"] = {};
  for (const [square, rows] of bySquare) {
    const nsq = normalizeName(square);
    const nos = new Set(rows.map((r) => r.plotNo));
    let pick: TZone | null = null;
    let how = "";
    const named = inCity.filter((t) => normalizeName(t.zone) === nsq || normalizeName(t.zone).endsWith(nsq) || nsq.endsWith(normalizeName(t.zone)));
    if (named.length === 1) {
      pick = named[0];
      how = "name";
    } else {
      const scored = inCity.map((t) => ({ t, j: [...nos].filter((n) => t.nos.has(n)).length / new Set([...nos, ...t.nos]).size })).sort((a, b) => b.j - a.j);
      if (scored.length && scored[0].j >= 0.5 && (scored.length < 2 || scored[0].j >= 1.5 * scored[1].j)) {
        pick = scored[0].t;
        how = `jaccard ${scored[0].j.toFixed(2)}`;
      } else {
        const votes = new Map<string, number>();
        for (const r of rows) for (const t of inCity) if (t.plots.some((p) => p.no === r.plotNo && close(p.area, r.area) && close(p.total, r.total))) votes.set(t.zone, (votes.get(t.zone) ?? 0) + 1);
        const best = [...votes].sort((a, b) => b[1] - a[1])[0];
        if (best && best[1] >= Math.max(1, 0.8 * rows.length)) {
          pick = inCity.find((t) => t.zone === best[0])!;
          how = `plots ${best[1]}/${rows.length}`;
        } else {
          report.push(`UNMATCHED zid ${z.zid} ${city} «${square}» (${rows.length} rows); candidates: ${scored.slice(0, 3).map((s) => `«${s.t.zone}» ${s.j.toFixed(2)}`).join(", ") || "none in city"}`);
        }
      }
    }
    squares[nsq] = pick ? { sector: pick.sector, zone: pick.zone } : { sector: null, zone: square };
    if (pick) report.push(`ok zid ${z.zid} ${city} «${square}» → «${pick.zone}» [${how}]`);
  }
  entries.push({ zid: z.zid, pid: z.pid, cityId: z.cityId, city, name: z.name, squares });
}
const used = new Set(entries.flatMap((e) => Object.values(e.squares).map((s) => `${e.city}|${s.zone}`)));
for (const [k, t] of tzones) if (!used.has(k)) report.push(`TRACKER ZONE NOT MATCHED: ${t.city} «${t.zone}» (${t.plots.length} plots)`);
console.log(report.join("\n"));
console.log(`\n${entries.length} zones, ${entries.reduce((n, e) => n + Object.keys(e.squares).length, 0)} squares, ${report.filter((r) => r.startsWith("UNMATCHED")).length} unmatched squares, ${report.filter((r) => r.startsWith("TRACKER")).length} tracker zones unmatched`);

if (args.includes("--write")) {
  const file = path.join(process.cwd(), "src", "data", "official-zones.ts");
  const body = `/**
 * Official site zones (ViewZone.aspx?ID=zid) and their squares («المربع») mapped to the districts/zones of the
 * frozen snapshot, so plot ids stay stable. Generated by scripts/tools/build-official-zones.mts on ${new Date().toISOString().slice(0, 10)}
 * from a full crawl; hand-reviewed. Squares with sector null were not in the snapshot (their plots get new ids).
 */
import type { OfficialZoneEntry } from "@/ingest/official-map";

/** Official city id → city name as stored in meta.cities. */
export const OFFICIAL_CITIES: Record<number, string> = ${JSON.stringify(cities, null, 2)};

export const OFFICIAL_ZONES: OfficialZoneEntry[] = ${JSON.stringify(entries, null, 2)};
`;
  writeFileSync(file, body);
  console.log(`wrote ${file}`);
}
