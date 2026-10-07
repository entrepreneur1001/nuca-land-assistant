// Applies migrations to DATABASE_URL (or the embedded PGlite DB). The app also migrates on startup.
import { getDb } from "@/db/client";

await getDb();
console.log("migrations applied");
process.exit(0);
