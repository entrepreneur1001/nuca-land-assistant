// Export, per official zone id, the plots we know (number, id, lat/lng, area, status) from the local snapshot.
import { readFileSync, writeFileSync } from "node:fs";
import { unpackTuples, type MetaDoc, type PlotTuple } from "@/data/snapshot";
import { OFFICIAL_ZONES } from "@/data/official-zones";
import { normalizeName } from "@/ingest/official-map";
const dir = process.cwd() + "/public/dev-snapshot";
const meta = JSON.parse(readFileSync(dir + "/meta.json", "utf8")) as MetaDoc;
const all: PlotTuple[] = [];
for (const c of meta.chunks) all.push(...(await unpackTuples(JSON.parse(readFileSync(`${dir}/${c.id}.json`, "utf8")).data)));
// (sector id | zone name) → zid, from the mapping table.
const key = (sector: string | null, zone: string) => `${sector ?? ""}|${normalizeName(zone)}`;
const toZid = new Map<string, number>();
for (const z of OFFICIAL_ZONES) for (const sq of Object.values(z.squares)) toZid.set(key(sq.sector, sq.zone), z.zid);
const out: Record<string, { city: string; name: string; sector: string | null; plots: { no: string; id: string; lat: number | null; lng: number | null; area: number; booked: number }[] }> = {};
let unmapped = 0;
for (const t of all) {
  const s = t[4] >= 0 ? meta.sectors[t[4]] : undefined;
  const zone = t[5] >= 0 ? meta.zones[t[5]] : "";
  let zid = toZid.get(key(s?.id ?? null, zone));
  if (zid == null) { const m = /^o(\d+)-/.exec(t[0]); if (m) zid = +m[1]; }
  if (zid == null) { unmapped++; continue; }
  const z = OFFICIAL_ZONES.find((x) => x.zid === zid)!;
  (out[zid] ??= { city: z.city, name: z.name, sector: s?.id ?? null, plots: [] }).plots.push({ no: t[2], id: t[0], lat: t[13], lng: t[14], area: t[6], booked: t[15] });
}
writeFileSync(process.argv[2], JSON.stringify(out));
console.log("zones", Object.keys(out).length, "plots", all.length - unmapped, "unmapped", unmapped);
for (const [zid, z] of Object.entries(out)) {
  const located = z.plots.filter((p) => p.lat != null).length;
  console.log(zid, z.city, z.name, z.plots.length, "located", located);
}
