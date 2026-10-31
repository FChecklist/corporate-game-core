// Screenshots of the public pages for a human to look at: node apps/web/tools/shots.mjs [pageNames...]
// Serves apps/web/public on a local port (clean addresses like /guide work), opens Chrome headless through playwright-core, and writes
// C:\ct\test-sites\data\ui\site-bingo\<page>-<width>-<light|dark>.png at 360, 390, 768, 1280 and 1920 wide, plus keyboard.json (the Tab order through the
// header menu) and axe.json (accessibility check: contrast, names, roles). HEAVY: take the lock first (mkdir C:/ct/heavy.lock) and have more than 1 GB free.
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { createRequire } from "node:module";

const ROOT = resolve(import.meta.dirname, "../public"), OUT = process.env.SHOTS_OUT || "C:/ct/test-sites/data/ui/site-bingo";
const require = createRequire(import.meta.url);
const NM = process.env.NODE_MODULES || "C:/ct/test-sites/bingo/node_modules";
const { chromium } = require(NM + "/playwright-core");
const axeSrc = readFileSync(NM + "/axe-core/axe.min.js", "utf8");
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".json": "application/json", ".webmanifest": "application/manifest+json", ".ico": "image/x-icon", ".webp": "image/webp", ".txt": "text/plain", ".xml": "application/xml" };
const PAGES = { index: "/", "how-it-works": "/how-it-works", guide: "/guide", brochure: "/brochure", partner: "/partner", privacy: "/privacy", pricing: "/pricing", trust: "/trust", signin: "/signin", zc: "/zc.html?demo=1", "404": "/404.html", offline: "/offline.html" };
const WIDTHS = [360, 390, 768, 1280, 1920], MODES = ["light", "dark"];
const want = process.argv.slice(2), names = want.length ? want : Object.keys(PAGES);

const srv = createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p === "/") p = "/index.html"; else if (!extname(p)) p += ".html";
  const f = join(ROOT, p);
  if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404, { "content-type": "text/plain" }); res.end("not found"); return; }
  res.writeHead(200, { "content-type": TYPES[extname(f)] || "application/octet-stream", "cache-control": "no-store" }); res.end(readFileSync(f));
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const base = "http://127.0.0.1:" + srv.address().port;
mkdirSync(OUT, { recursive: true });
const exe = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ["--disable-gpu", "--no-sandbox"] });
const keyboard = {}, axe = {};
for (const mode of MODES) {
  const ctx = await browser.newContext({ colorScheme: mode, viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.route("**/api/**", (r) => r.fulfill({ status: 404, body: "{}" }));
  for (const n of names) {
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.goto(base + PAGES[n], { waitUntil: "networkidle" }).catch(() => {});
      await page.waitForTimeout(250);
      await page.screenshot({ path: `${OUT}/${n}-${w}-${mode}.png`, fullPage: true });
    }
    if (mode === "light" && !["zc", "offline"].includes(n)) {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(base + PAGES[n], { waitUntil: "networkidle" }).catch(() => {});
      const seq = [];
      for (let i = 0; i < 18; i++) { await page.keyboard.press("Tab"); seq.push(await page.evaluate(() => { const a = document.activeElement; return a ? (a.tagName + ":" + (a.textContent || a.getAttribute("aria-label") || a.className || "").trim().slice(0, 40)) : ""; })); }
      keyboard[n] = seq;
      await page.screenshot({ path: `${OUT}/${n}-1280-tab.png` });
    }
    if (!["zc"].includes(n)) {
      await page.addScriptTag({ content: axeSrc }).catch(() => {});
      axe[n + "-" + mode] = await page.evaluate(async () => { try { const r = await window.axe.run(document, { resultTypes: ["violations"] }); return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, sample: (v.nodes[0] && v.nodes[0].target.join(" ")) || "" })); } catch (e) { return String(e); } });
    }
  }
  await ctx.close();
}
writeFileSync(OUT + "/keyboard.json", JSON.stringify(keyboard, null, 1)); writeFileSync(OUT + "/axe.json", JSON.stringify(axe, null, 1));
await browser.close(); srv.close();
console.log("screenshots in", OUT);
