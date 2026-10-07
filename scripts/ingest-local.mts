/**
 * Runs the sync into a local JSON folder (no Firebase needed) — for development and for
 * generating `public/dev-snapshot/` that the site can load when NEXT_PUBLIC_DATA=local.
 *   npx tsx scripts/ingest-local.mts [--full] [--osm]
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import type { MetaDoc } from "@/data/snapshot";
import { runSync, type ChunkDoc, type Store } from "@/ingest/run";

const dir = path.join(process.cwd(), "public", "dev-snapshot");
mkdirSync(dir, { recursive: true });
const read = <T,>(f: string): T | null => (existsSync(path.join(dir, f)) ? JSON.parse(readFileSync(path.join(dir, f), "utf8")) : null);
const store: Store = {
  getMeta: async () => read<MetaDoc>("meta.json"),
  getChunk: async (id) => read<ChunkDoc>(`${id}.json`),
  async commit(chunks, meta) {
    for (const [id, doc] of Object.entries(chunks)) writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(doc));
    writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta));
  },
  putMeta: async (meta) => writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta)),
};
const args = new Set(process.argv.slice(2));
const r = await runSync(store, { forceFull: args.has("--full"), forceOsm: args.has("--osm") });
console.log(JSON.stringify({ ...r, changedChunks: r.changedChunks.length }));
process.exit(r.error ? 1 : 0);
