export type LandStatus = "available" | "booked";

export interface SnapshotItem {
  id: string;
  status: LandStatus;
  sourceUpdatedAt?: Date | null;
  totalPrice?: number;
}

export type ExistingItem = SnapshotItem;

export interface StatusChange {
  landId: string;
  oldStatus: LandStatus | null;
  newStatus: LandStatus;
}

export interface DiffResult {
  /** Snapshot accepted as complete enough to trust. */
  accepted: boolean;
  reason?: string;
  inserted: string[];
  /** Rows whose data changed (status or source timestamp/price). */
  updated: string[];
  unchanged: string[];
  changes: StatusChange[];
  newlyBooked: string[];
  newlyAvailable: string[];
  /** Present in DB but absent from this snapshot. Never treated as booked. */
  missing: string[];
}

/**
 * Compare a freshly fetched inventory snapshot to what we already store.
 * A snapshot is rejected (no writes should happen) when it is partial: fewer
 * unique items than `minCompleteness` of the source-reported total.
 */
export function diffSnapshot(
  existing: Map<string, ExistingItem>,
  snapshot: SnapshotItem[],
  opts: { expectedTotal: number; allPagesOk: boolean; minCompleteness?: number },
): DiffResult {
  const empty: DiffResult = {
    accepted: false,
    inserted: [],
    updated: [],
    unchanged: [],
    changes: [],
    newlyBooked: [],
    newlyAvailable: [],
    missing: [],
  };
  if (!opts.allPagesOk) return { ...empty, reason: "one or more pages failed" };
  const minCompleteness = opts.minCompleteness ?? 0.98;
  const unique = new Map(snapshot.map((s) => [s.id, s]));
  if (opts.expectedTotal > 0 && unique.size < opts.expectedTotal * minCompleteness) {
    return { ...empty, reason: `partial snapshot: ${unique.size}/${opts.expectedTotal}` };
  }

  const r: DiffResult = { ...empty, accepted: true };
  for (const [id, cur] of unique) {
    const prev = existing.get(id);
    if (!prev) {
      r.inserted.push(id);
      r.changes.push({ landId: id, oldStatus: null, newStatus: cur.status });
      continue;
    }
    const statusChanged = prev.status !== cur.status;
    const dataChanged =
      statusChanged ||
      (cur.sourceUpdatedAt?.getTime() ?? 0) !== (prev.sourceUpdatedAt?.getTime() ?? 0) ||
      (cur.totalPrice !== undefined && cur.totalPrice !== prev.totalPrice);
    if (dataChanged) r.updated.push(id);
    else r.unchanged.push(id);
    if (statusChanged) {
      r.changes.push({ landId: id, oldStatus: prev.status, newStatus: cur.status });
      if (cur.status === "booked") r.newlyBooked.push(id);
      else r.newlyAvailable.push(id);
    }
  }
  for (const id of existing.keys()) if (!unique.has(id)) r.missing.push(id);
  return r;
}
