import { chromium } from "@playwright/test";
const args = (process.env.PW_CHROMIUM_ARGS || "").split(" ").filter(Boolean);
const b = await chromium.launch({ args });
const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 } });
const p = await ctx.newPage();
const out = {};
for (const q of process.argv.slice(2)) {
  const r = await p.goto(`https://unsplash.com/s/photos/${q}?orientation=landscape&license=free`, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(e => null);
  await p.waitForSelector('img[src*="images.unsplash.com/photo-"]', { timeout: 45000 }).catch(() => {});
  out[q] = await p.evaluate(() => [...document.querySelectorAll('figure')].map(f => {
    const img = f.querySelector('img[src*="images.unsplash.com/photo-"]');
    if (!img) return null;
    return { src: img.src.split("?")[0], alt: img.alt };
  }).filter(Boolean).slice(0, 8));
  console.log(q, out[q].length, (await p.title()).slice(0,40));
}
const fs = await import("node:fs"); fs.writeFileSync(process.env.OUT, JSON.stringify(out, null, 1));
await b.close();
