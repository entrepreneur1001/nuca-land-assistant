/// <reference lib="webworker" />
import type { Snapshot } from "@/data/snapshot";
import { computeDashboard } from "@/engine/compute";
import type { Profile } from "@/engine/scoring";

let snapshot: Snapshot | null = null;

self.onmessage = (e: MessageEvent) => {
  const msg = e.data as { type: "snapshot"; snapshot: Snapshot } | { type: "compute"; id: number; profile: Profile; now: number };
  if (msg.type === "snapshot") {
    snapshot = msg.snapshot;
    return;
  }
  if (!snapshot) return;
  try {
    const { dashboard, ranked, byId } = computeDashboard(snapshot, msg.profile, msg.now);
    const extras: Record<string, { s?: { low: number; mid: number; high: number }; n: number | null }> = {};
    for (const [id, v] of byId) extras[id] = { s: v.survival, n: v.neighbourShare };
    (self as unknown as Worker).postMessage({ id: msg.id, ok: true, dashboard, ranked, extras });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: msg.id, ok: false, error: String(err) });
  }
};
