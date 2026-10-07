"use client";

import { doc, getDoc, onSnapshot } from "firebase/firestore";
import { tupleToPlot, unpackTuples, type MetaDoc, type PlotTuple, type Snapshot } from "@/data/snapshot";
import { firestore } from "./firebase";

const LOCAL = process.env.NEXT_PUBLIC_DATA === "local";

async function loadChunkLocal(id: string) {
  const r = await fetch(`/dev-snapshot/${id}.json`, { cache: "no-store" });
  return (await r.json()) as { version: string; data: string };
}

const LS_PREFIX = "nuca-chunk:";

/** Chunk cache in localStorage keyed by version (~1 MB total). Every access is guarded: storage may be full or blocked. */
function cachedChunk(id: string, version: string): string | null {
  try {
    const raw = localStorage.getItem(LS_PREFIX + id);
    if (!raw) return null;
    const v = JSON.parse(raw) as { version: string; data: string };
    return v.version === version ? v.data : null;
  } catch {
    return null;
  }
}

function storeChunk(id: string, version: string, data: string) {
  try {
    localStorage.setItem(LS_PREFIX + id, JSON.stringify({ version, data }));
  } catch {
    /* quota exceeded / private mode: just skip caching */
  }
}

async function loadChunkFirestore(id: string, version: string) {
  const hit = cachedChunk(id, version);
  if (hit) return { version, data: hit };
  const snap = await getDoc(doc(firestore(), "plots", id));
  const d = snap.data() as { version: string; data: string } | undefined;
  if (d) storeChunk(id, d.version, d.data);
  return d;
}

const tupleCache = new Map<string, { version: string; tuples: PlotTuple[] }>();

export async function buildSnapshot(meta: MetaDoc): Promise<Snapshot> {
  const parts = await Promise.all(
    meta.chunks.map(async (c) => {
      const hit = tupleCache.get(c.id);
      if (hit?.version === c.v) return hit.tuples;
      const d = LOCAL ? await loadChunkLocal(c.id) : await loadChunkFirestore(c.id, c.v);
      if (!d) return [];
      const tuples = await unpackTuples(d.data);
      tupleCache.set(c.id, { version: c.v, tuples });
      return tuples;
    }),
  );
  return { meta, plots: parts.flat().map((t) => tupleToPlot(t, meta)) };
}

/** Subscribe to the live meta doc; calls back with a fresh snapshot whenever data changes. */
export function subscribeSnapshot(onData: (s: Snapshot) => void, onError: (e: Error) => void): () => void {
  let lastMeta = "";
  const handle = async (meta: MetaDoc | null) => {
    if (!meta || !meta.chunks?.length) return onError(new Error("no-data"));
    const sig = `${meta.dataVersion}|${meta.statsAt}|${meta.lastError}`;
    if (sig === lastMeta) return;
    lastMeta = sig;
    try {
      // Unchanged chunks come from the in-memory/IndexedDB cache, so this only downloads what changed.
      onData(await buildSnapshot(meta));
    } catch (e) {
      onError(e instanceof Error ? e : new Error(String(e)));
    }
  };
  if (LOCAL) {
    const tick = () =>
      fetch("/dev-snapshot/meta.json", { cache: "no-store" })
        .then((r) => r.json())
        .then(handle)
        .catch(onError);
    void tick();
    const t = setInterval(tick, 60_000);
    return () => clearInterval(t);
  }
  return onSnapshot(
    doc(firestore(), "meta", "current"),
    (s) => void handle(s.exists() ? (s.data() as MetaDoc) : null),
    (e) => onError(e),
  );
}
