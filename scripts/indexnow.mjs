// Tells Bing / Yandex (IndexNow) about every URL in the live sitemap. Run after a deploy: `node scripts/indexnow.mjs`
// The key file public/<KEY>.txt must already be live at the site root.
const SITE = "https://nuca-lands-assistant.web.app";
const KEY = "76ea7fb07113cdafddd9eb3fd794bab0";

const sitemap = await (await fetch(`${SITE}/sitemap.xml`)).text();
const urlList = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
if (!urlList.length) throw new Error("No URLs in the live sitemap; deploy first.");

const r = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({ host: new URL(SITE).host, key: KEY, keyLocation: `${SITE}/${KEY}.txt`, urlList }),
});
console.log(`IndexNow: ${urlList.length} URLs → HTTP ${r.status}`); // 200/202 = accepted
