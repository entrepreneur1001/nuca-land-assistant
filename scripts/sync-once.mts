import { runOnce, workerState } from "@/ingest/worker";
import { getDb } from "@/db/client";
import { sql } from "drizzle-orm";

await runOnce();
const db = await getDb();
const r = await db.execute(sql`select status, count(*)::int as n from lands group by status`);
console.log("lands by status:", (r as unknown as { rows: unknown[] }).rows ?? r);
console.log("worker:", { lastStats: workerState.lastStats, lastError: workerState.lastError });
process.exit(0);
