/**
 * Read-only probe of the source's per-district tile endpoints, for districts the sync could not place
 * (no plot geometry and no tile bounds in the sector list). Prints one JSON line per district with the raw
 * bodies so the response shapes can be read off the run log. Same credentials as the sync job:
 *   FIREBASE_SERVICE_ACCOUNT='<json>' SOURCE_REFRESH_TOKEN='<token>' npx tsx scripts/tools/sector-tiles-probe.mts [--all]
 * `--all` checks tile availability for every district instead (one call each).
 */
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import type { MetaDoc } from "@/data/snapshot";
import { createTokenProvider } from "@/ingest/auth";
import { fetchJson } from "@/ingest/fetcher";
import { SOURCE } from "@/ingest/source";

const projectId = process.env.FIREBASE_PROJECT_ID ?? "nuca-lands-assistant";
const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
initializeApp(sa ? { credential: cert(JSON.parse(sa)), projectId } : { projectId });
const db = getFirestore();

const authDoc = db.doc("private/sourceAuth");
const auth = createTokenProvider(
  {
    async getRefreshToken() {
      const s = await authDoc.get();
      return (s.get("refreshToken") as string | undefined) ?? null;
    },
    async putRefreshToken(refreshToken) {
      await authDoc.set({ refreshToken, updatedAt: new Date().toISOString() });
    },
  },
  { staticToken: process.env.SOURCE_API_TOKEN || undefined, seedRefreshToken: process.env.SOURCE_REFRESH_TOKEN || undefined },
);

const all = process.argv.includes("--all");
const meta = (await db.doc("meta/current").get()).data() as MetaDoc;
const unplaced = meta.sectors.filter((s) => !s.c);
const control = meta.sectors.find((s) => s.c);
const targets = all ? meta.sectors : control ? [control, ...unplaced] : unplaced;
console.log(all ? `probing tile availability for all ${targets.length} districts` : `probing ${unplaced.length} unplaced district(s)${control ? " + 1 control" : ""}`);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const trunc = (v: unknown) => {
  const s = JSON.stringify(v);
  return s.length > 500 ? `${s.slice(0, 500)}…` : s;
};
const probe = async (path: string) => {
  try {
    return { ok: trunc(await fetchJson(path, { auth })) };
  } catch (e) {
    return { err: e instanceof Error ? e.message : String(e) };
  }
};

for (const s of targets) {
  const base = `/api/land-management/sector/${s.id}`;
  const out = all
    ? { city: meta.cities[s.city], name: s.name, id: s.id, placed: !!s.c, tilesAvailable: await probe(`${base}/tiles-available`) }
    : {
        city: meta.cities[s.city],
        name: s.name,
        id: s.id,
        placed: !!s.c,
        sector: await probe(`/api/app/sector/${s.id}`),
        tilesAvailable: await probe(`${base}/tiles-available`),
        tilesBounds: await probe(`${base}/tiles-bounds`),
        tileUrlTemplate: await probe(`${base}/tile-url-template`),
      };
  console.log(JSON.stringify(out));
  await sleep(SOURCE.pageDelayMs);
}
process.exit(0);
