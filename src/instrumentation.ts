export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startWorker } = await import("./ingest/worker");
  // Fire-and-forget: register() must not block server readiness.
  startWorker();
}
