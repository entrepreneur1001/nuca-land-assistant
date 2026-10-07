"use client";

import type { Snapshot } from "@/data/snapshot";
import { computeDashboard, type Dashboard, type RankedLand } from "@/engine/compute";
import type { Profile } from "@/engine/scoring";

export interface EngineResult {
  dashboard: Dashboard;
  ranked: RankedLand[];
  extras: Record<string, { s?: { low: number; mid: number; high: number }; n: number | null }>;
}

const WORKER_TIMEOUT_MS = 8000;

function inline(snapshot: Snapshot, profile: Profile): EngineResult {
  const { dashboard, ranked, byId } = computeDashboard(snapshot, profile, Date.now());
  const extras: EngineResult["extras"] = {};
  for (const [id, v] of byId) extras[id] = { s: v.survival, n: v.neighbourShare };
  return { dashboard, ranked, extras };
}

/** Runs the engine in a Web Worker when possible (keeps phones responsive); falls back to the main thread. */
export class Engine {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, { resolve: (r: EngineResult) => void; reject: (e: Error) => void; profile: Profile }>();
  private snapshot: Snapshot | null = null;

  constructor() {
    try {
      // Bundled separately by `npm run build:worker` (Turbopack doesn't compile worker entries here).
      this.worker = new Worker(`/engine.worker.js?v=${process.env.NEXT_PUBLIC_BUILD_ID ?? "dev"}`, { type: "module" });
      this.worker.onmessage = (e) => {
        const { id, ok, error, ...rest } = e.data;
        const p = this.pending.get(id);
        if (!p) return;
        this.pending.delete(id);
        if (ok) p.resolve(rest as EngineResult);
        else p.reject(new Error(error));
      };
      this.worker.onerror = () => this.abandonWorker();
    } catch {
      this.worker = null;
    }
  }

  /** Worker failed: finish everything in flight on the main thread. */
  private abandonWorker() {
    this.worker?.terminate();
    this.worker = null;
    for (const [id, p] of this.pending) {
      this.pending.delete(id);
      try {
        p.resolve(inline(this.snapshot!, p.profile));
      } catch (e) {
        p.reject(e instanceof Error ? e : new Error(String(e)));
      }
    }
  }

  setSnapshot(s: Snapshot) {
    this.snapshot = s;
    this.worker?.postMessage({ type: "snapshot", snapshot: s });
  }

  compute(profile: Profile): Promise<EngineResult> {
    if (!this.snapshot) return Promise.reject(new Error("no snapshot"));
    if (!this.worker) return Promise.resolve(inline(this.snapshot, profile));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, profile });
      this.worker!.postMessage({ type: "compute", id, profile, now: Date.now() });
      setTimeout(() => {
        if (this.pending.has(id)) this.abandonWorker();
      }, WORKER_TIMEOUT_MS);
    });
  }

  dispose() {
    this.worker?.terminate();
  }
}
