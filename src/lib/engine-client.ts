"use client";

import type { Snapshot } from "@/data/snapshot";
import { computeDashboard, type Dashboard, type RankedLand } from "@/engine/compute";
import type { Profile } from "@/engine/scoring";

export interface EngineResult {
  dashboard: Dashboard;
  ranked: RankedLand[];
  extras: Record<string, { s?: { low: number; mid: number; high: number }; n: number | null }>;
}

/** Runs the engine in a Web Worker when possible (keeps phones responsive), else inline. */
export class Engine {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, (r: EngineResult | Error) => void>();
  private snapshot: Snapshot | null = null;

  constructor() {
    try {
      this.worker = new Worker(new URL("../workers/engine.worker.ts", import.meta.url), { type: "module" });
      this.worker.onmessage = (e) => {
        const { id, ok, error, ...rest } = e.data;
        const cb = this.pending.get(id);
        this.pending.delete(id);
        cb?.(ok ? (rest as EngineResult) : new Error(error));
      };
      this.worker.onerror = () => {
        this.worker = null;
      };
    } catch {
      this.worker = null;
    }
  }

  setSnapshot(s: Snapshot) {
    this.snapshot = s;
    this.worker?.postMessage({ type: "snapshot", snapshot: s });
  }

  compute(profile: Profile): Promise<EngineResult> {
    const now = Date.now();
    if (!this.worker) {
      if (!this.snapshot) return Promise.reject(new Error("no snapshot"));
      const { dashboard, ranked, byId } = computeDashboard(this.snapshot, profile, now);
      const extras: EngineResult["extras"] = {};
      for (const [id, v] of byId) extras[id] = { s: v.survival, n: v.neighbourShare };
      return Promise.resolve({ dashboard, ranked, extras });
    }
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, (r) => (r instanceof Error ? reject(r) : resolve(r)));
      this.worker!.postMessage({ type: "compute", id, profile, now });
    });
  }

  dispose() {
    this.worker?.terminate();
  }
}
