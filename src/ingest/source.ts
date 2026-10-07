export const SOURCE = {
  name: "baytwaten4all",
  apiUrl: (process.env.SOURCE_API_URL ?? "https://api.baytwaten4all.online").replace(/\/$/, ""),
  pageSize: Number(process.env.PAGE_SIZE ?? 1000),
  pageDelayMs: Number(process.env.PAGE_DELAY_MS ?? 1000),
};
