// The Corporate Bingo website wears the shared Corporate Games look (owner order 29 Oct 2026): one brand kit, one games bar, one six-item menu,
// the logo, the plain wording ("close group", never the banned word), and honest search tags (canonical, Open Graph, sitemap).
// The brand kit lives in C:\ct\test-sites\corporate-brand-kit and the bar in C:\ct\test-sites\corporate-games-bar; this site carries identical copies, pinned below.
// If a pin fails: copy the canonical files again (python -I vendor.py bingo <public folder> --console --no-manifest --apply), then pin the new numbers. Never edit a copy.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";

const PUB = new URL("../public/", import.meta.url), ORIGIN = "https://bingo.corporatetambola.com";
const rd = (f: string) => readFileSync(new URL(f, PUB), "utf8");
const sha = (f: string, text = true) => {
  let b = readFileSync(new URL(f, PUB));
  if (text) b = Buffer.from(b.toString("utf8").split(String.fromCharCode(13)).join("")); // line endings do not count (git may check files out with CRLF)
  return createHash("sha256").update(b).digest("hex");
};

// every public page that carries the website header (the work pages and the console have their own shells)
const SITE_PAGES = ["index", "how-it-works", "guide", "brochure", "organizer-guide", "404", "offline", "about", "contact", "pricing", "legal", "terms", "privacy", "legal-position", "dpa", "subprocessors", "refund-policy", "partner-terms", "partner", "helpdesk", "signin"];
const SIX = ["How it works", "Free demo game", "Guide", "Brochure", "Refer & earn", "Log in"];
const navLabels = (html: string) => {
  const nav = /<nav class="ck-nav"[^>]*>([\s\S]*?)<\/nav>/.exec(html)?.[1] ?? "";
  return [...nav.replace(/<span class="ck-dots"[\s\S]*?<\/span>/, "").matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)].map((m) => m[1]!.replace(/&amp;/g, "&").trim());
};

describe("the shared Corporate Games brand kit", () => {
  test("css and js are identical to the canonical copy", () => {
    expect(sha("tokens.css")).toBe("32566fe7a4bdd8d2880459d353dadff1f7d97f23ab7228d94313ef7e80017638");
    expect(sha("fonts.css")).toBe("94ca9271029ca0e0cdb269698e334dd8dedc001f5ca2c4a5d228a6dc11306a9c");
    expect(sha("components.css")).toBe("22196acdfbda615dfa2b0bf5bc61568155f9acfa94b979af36f1c3c11b46b786");
    expect(sha("console.css")).toBe("14de55d41bf22a56b7ab4d162258d191a3b2924b96ac74af2ea0c907ae785429");
    expect(sha("brandkit.js")).toBe("00dabcc77138e157a432705f18cc9145bf50164421bc08d173f7424d517f802b");
    expect(sha("theme-init.js")).toBe("8ff0eb6def5cf8a95b54a2b81738a022b7a7a2b2dc76325fed78c455e45c6d7f");
  });
  test("the two fonts and the logo are identical, and the font file the page preloads is the one the css names", () => {
    expect(sha("fonts/Inter-normal-400.woff2", false)).toBe("3100e775e8616cd2611beecfa23a4263d7037586789b43f035236a2e6fbd4c62");
    expect(sha("fonts/Fraunces-normal-500-700.woff2", false)).toBe("7234ed860a9cc83045413c4faee63c960a8f2d1917adcf728119307d56e0d783");
    expect(sha("favicon.svg")).toBe("5f06c353bdd73ebd980600f44e7316ee228ff850cacd57ab04173bc3ab7711f0");
    const f = rd("fonts.css"); expect(f).toContain("/fonts/Inter-normal-400.woff2"); expect(f).toContain("/fonts/Fraunces-normal-500-700.woff2");
    expect(f).not.toMatch(/https?:\/\//); // no font is loaded from another site
  });
  test("the games bar is identical to the canonical copy", () => {
    expect(sha("gamesbar.js")).toBe("16f02208af3c84cef63d81cdfcbc788f1baf23957ed71e912d44cafd4f881b98");
    expect(sha("gamesbar.css")).toBe("6b0311de98525de646e637a28102163dfecf9fde35b8befe0344a5e16fff8b5b");
  });
  test("every site page links the kit styles, the fonts and the games bar, with a version number, and the build ships them all", () => {
    const build = readFileSync(new URL("../../../pages/build.mjs", import.meta.url), "utf8");
    for (const f of ["tokens.css", "fonts.css", "fonts-extra.css", "components.css", "console.css", "bingo-site.css", "bingo-console.css", "brandkit.js", "theme-init.js", "gamesbar.js", "gamesbar.css", "favicon.svg", "how-it-works.html", "guide.html"]) expect([f, build.includes(`"${f}"`)]).toEqual([f, true]);
    for (const p of SITE_PAGES.filter((x) => x !== "signin")) {
      const h = rd(p + ".html");
      for (const s of ["tokens.css", "components.css", "bingo-site.css"]) expect([p, new RegExp(`<link rel="stylesheet" href="/${s.replace(".", "\\.")}\\?v=\\d+">`).test(h)]).toEqual([p, true]);
      expect([p, /<script src="\/theme-init\.js\?v=\d+"><\/script>/.test(h)]).toEqual([p, true]);
      expect([p, /<script src="\/brandkit\.js\?v=\d+" defer><\/script>/.test(h)]).toEqual([p, true]);
      if (p !== "offline") expect([p, /<script src="\/gamesbar\.js\?v=\d+" defer><\/script>/.test(h)]).toEqual([p, true]);
    }
  });
});

describe("the header menu: exactly six items, in the owner's order", () => {
  for (const p of SITE_PAGES) test(`${p}.html: How it works | Free demo game | Guide | Brochure | Refer & earn | Log in`, () => {
    expect(navLabels(rd(p + ".html"))).toEqual(SIX);
  });
  test("the menu points at pages that exist, and the free demo game is the 10-person demo", () => {
    const h = rd("index.html"), nav = /<nav class="ck-nav"[^>]*>([\s\S]*?)<\/nav>/.exec(h)![1]!;
    const hrefs = [...nav.matchAll(/<a href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual(["/how-it-works", "/zc.html?demo=1", "/guide", "/brochure", "/partner", "/#login"]);
    for (const f of ["how-it-works.html", "guide.html", "brochure.html", "partner.html", "zc.html", "brochure.pdf"]) expect([f, existsSync(new URL(f, PUB))]).toEqual([f, true]);
    expect(readFileSync(new URL("../../../packages/beacon/src/config.ts", import.meta.url), "utf8")).toMatch(/DEMO_CAP\s*=\s*10/);
    for (const banned of ["Free AI assistant", "WhatsApp us", "Pricing</a>", ">Video<"]) expect(nav).not.toContain(banned);
  });
  test("the header carries the one logo: the kit badge with CORPORATE small above Bingo", () => {
    for (const p of SITE_PAGES) {
      const h = rd(p + ".html"), brand = /<a class="ck-brand"[^>]*>([\s\S]*?)<\/a>/.exec(h)?.[1] ?? "";
      expect([p, brand.includes('href="#i-bingo"')]).toEqual([p, true]);
      expect([p, brand.includes("<i>Corporate</i><b>Bingo</b>")]).toEqual([p, true]);
      expect([p, h.includes('<symbol id="i-bingo"')]).toEqual([p, true]); // the badge is drawn in the page, from the kit sprite
    }
    const tr = rd("trust.html"); expect(tr).toContain('<img class="ck-badge" src="/favicon.svg"'); expect(tr).toContain("<i>Corporate</i><b>Bingo</b>"); expect(navLabels(tr)).toEqual(SIX);
  });
});

describe("app icons, share card and manifest use the same logo and colours", () => {
  const png = (f: string) => { const b = readFileSync(new URL(f, PUB)); expect(b.subarray(1, 4).toString()).toBe("PNG"); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
  test("every icon is a real picture of the right size", () => {
    expect(png("icon-192.png")).toEqual([192, 192]); expect(png("icon-512.png")).toEqual([512, 512]);
    expect(png("icon-maskable-192.png")).toEqual([192, 192]); expect(png("icon-maskable-512.png")).toEqual([512, 512]);
    expect(png("apple-touch-icon.png")).toEqual([180, 180]); expect(png("favicon-32.png")).toEqual([32, 32]); expect(png("og-card.png")).toEqual([1200, 630]);
  });
  test("manifest and page colours are the kit blue, not the old teal", () => {
    const m = JSON.parse(rd("manifest.webmanifest")); expect(m.theme_color).toBe("#0B3D91"); expect(m.background_color).toBe("#FFFAF2"); expect(m.name).toBe("Corporate Bingo");
    for (const p of SITE_PAGES) { const h = rd(p + ".html"); expect([p, h.includes('name="theme-color" content="#0B3D91"')]).toEqual([p, true]); expect([p, h.includes("#0B5D5B")]).toEqual([p, false]); }
    for (const p of ["zc", "z"]) expect([p, rd(p + ".html").includes('name="theme-color" content="#0B3D91"')]).toEqual([p, true]);
  });
});

describe("plain wording", () => {
  // the owner banned one word (p-r-i-v-a-t-e): say "close group". Built from pieces so this file itself stays clean.
  const BANNED = new RegExp(["pri", "vate"].join(""), "i");
  const TEXT_FILES = () => readdirSync(PUB).filter((f) => /\.(html|txt|xml|webmanifest|css)$/.test(f) && f !== "robots.txt");
  test("no public page, sitemap, manifest, style sheet or llms.txt uses it", () => { for (const f of TEXT_FILES()) expect([f, BANNED.test(rd(f))]).toEqual([f, false]); });
  test("none of the scripts that write words for customers uses it", () => {
    for (const f of ["site.js", "common.js", "zc.js", "z.js", "partner.js", "helpdesk.js", "signin.js", "pay.js", "paylink.js", "report.js", "big.js", "preview.js", "demo.js", "ai-link.js", "helpdesk-accept.js", "helpdesk-approve.js", "offline.js", "pwa.js"]) {
      if (existsSync(new URL(f, PUB))) expect([f, BANNED.test(rd(f))]).toEqual([f, false]);
    }
  });
  test("the strapline and the games are named the way the brand kit says, and only English is used", () => {
    const h = rd("index.html"); expect(h).toContain("Online games for company events"); expect(h).toMatch(/close group/i); expect(h).toContain("This week, which teams will you engage with");
    for (const f of TEXT_FILES()) expect([f, /[\u0900-\u097F\u4E00-\u9FFF\u0600-\u06FF]/.test(rd(f))]).toEqual([f, false]);
  });
});

describe("canonical address, share tags, sitemap", () => {
  const CLEAN: Record<string, string> = { index: "/", "how-it-works": "/how-it-works", guide: "/guide", brochure: "/brochure", partner: "/partner", helpdesk: "/helpdesk", pricing: "/pricing", about: "/about", contact: "/contact", legal: "/legal", terms: "/terms", privacy: "/privacy", "legal-position": "/legal-position", dpa: "/dpa", subprocessors: "/subprocessors", "refund-policy": "/refund-policy", "partner-terms": "/partner-terms", trust: "/trust" };
  const sm = rd("sitemap.xml"), locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!);
  test("each indexable page has one canonical address, the same in Open Graph and in the sitemap, and the share picture exists", () => {
    expect(locs.sort()).toEqual(Object.values(CLEAN).map((p) => ORIGIN + p).sort());
    for (const [p, path] of Object.entries(CLEAN)) {
      const h = rd(p + ".html");
      expect([p, h.match(/<link rel="canonical" href="([^"]+)"/)?.[1]]).toEqual([p, ORIGIN + path]);
      expect([p, h.match(/<meta property="og:url" content="([^"]+)"/)?.[1]]).toEqual([p, ORIGIN + path]);
      expect([p, h.match(/<meta property="og:image" content="([^"]+)"/)?.[1]]).toEqual([p, ORIGIN + "/og-card.png"]);
      expect([p, h.match(/<meta name="twitter:image" content="([^"]+)"/)?.[1]]).toEqual([p, ORIGIN + "/og-card.png"]);
      expect([p, /<meta property="og:site_name" content="Corporate Bingo">/.test(h)]).toEqual([p, true]);
    }
    expect(existsSync(new URL("og-card.png", PUB))).toBe(true);
  });
  test("the old guide address says noindex and sends people to the guide; 404 and offline are not indexed; robots.txt names the sitemap", () => {
    const og = rd("organizer-guide.html"); expect(og).toContain('name="robots" content="noindex'); expect(og).toContain('url=/guide'); expect(sm).not.toContain("organizer-guide");
    for (const p of ["404", "offline", "signin"]) expect([p, /name="robots" content="noindex/.test(rd(p + ".html"))]).toEqual([p, true]);
    expect(rd("robots.txt")).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
  });
});
