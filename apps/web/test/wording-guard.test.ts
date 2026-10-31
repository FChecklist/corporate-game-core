// WP-15 (gap plan 2026-10-29), B03, B04, B16, B17, B21: wording that must never come back.
// It reads the files that are shipped (pages, page scripts, e-mail and report text) as plain text and fails with the file and the words found.
//   B17  the word "private" (owner rule 2026-10-28: the games are ONLINE and CLOSE GROUP; never "private" in site, e-mails, reports, WhatsApp texts)
//   B16  "engagement" and "call board" on player screens, the big screen and the report (a person plays a GAME)
//   B04  "decided by fate" / "fate" / "ties share the prize": one plain tie rule (a fixed public rule puts cards in order; each prize goes to one card)
//   B19  "22 hours" / "23 hours": the report link and the erasure are stated once, and the report link figure is the one in lifecycle.ts
//   B03  a page must not promise a free AI assistant while the console hides the AI work link
//   B21  no Refer and earn or share-with-friends buttons on a real game's player screen
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PURGE_AFTER_MS, REPORT_LINK_MS } from "../../edge/src/lifecycle";

const ROOT = join(import.meta.dir, "../../..");
const PUB = join(ROOT, "apps/web/public");
const EDGE = join(ROOT, "apps/edge/src");
const read = (p: string) => readFileSync(p, "utf8");
const pub = (f: string) => join(PUB, f);
const edge = (f: string) => join(EDGE, f);

/** Code comments are not text a person reads: remove them, and class members that are written `private x` (a TypeScript keyword). */
export function visibleText(file: string, raw: string): string {
  if (/\.(html|txt|xml)$/.test(file)) return raw.replace(/<!--[\s\S]*?-->/g, " ");
  let t = raw.replace(/\/\*[\s\S]*?\*\//g, " ").split(/\r?\n/).map((l) => l.replace(/(^|[^:"'\\])\/\/.*$/, "$1")).join("\n");
  if (/\.ts$/.test(file)) t = t.split("\n").filter((l) => !/^\s*private\s/.test(l)).join("\n");
  return t;
}
const SKIP_JS = /^(zgame|control|reportgen|sw|zsw)\.js$|^vendor$/;
const pageFiles = () => readdirSync(PUB).filter((f) => /\.(html|txt|xml|js)$/.test(f) && !SKIP_JS.test(f)).map(pub);
const edgeFiles = () => readdirSync(EDGE).filter((f) => f.endsWith(".ts")).map(edge);
const toolFiles = () => [join(ROOT, "tools/make-legal-pages.mjs"), ...readdirSync(join(ROOT, "tools/legal")).map((f) => join(ROOT, "tools/legal", f))];
const allShipped = () => [...pageFiles(), ...edgeFiles(), ...toolFiles()];

/** Every place the pattern is found: "file: ...30 characters of context...". */
export function hits(files: string[], re: RegExp): string[] {
  const out: string[] = [];
  for (const f of files) {
    const t = visibleText(f, read(f));
    for (const m of t.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"))) out.push(f.slice(ROOT.length + 1).replace(/\\/g, "/") + ": " + t.slice(Math.max(0, m.index! - 30), m.index! + m[0].length + 30).replace(/\s+/g, " "));
  }
  return out;
}

const PRIVATE = /\bprivate\b/i;
const ENGAGEMENT = /engagement(?!Id)/i;
const FATE = /decided by fate|\bfate\b|ties? share|share the prize/i;
const PLAYER_FILES = () => [pub("z.js"), pub("z.html"), pub("big.js"), pub("big.html"), pub("report.html"), pub("report.js"), edge("pdf.ts"), edge("report-layout.ts")];
const AI_PROMISE = /\bAI\b (assistant|helper|work link)|your own AI|free AI|AI chat|AI link/i;

describe("the patterns find what they should (so an empty result means something)", () => {
  test("private", () => { for (const bad of ["Private by design", "a private game", "Keep it private."]) expect(PRIVATE.test(bad)).toBe(true); for (const ok of ["privacy", "Privacy Policy", "a close group game"]) expect(PRIVATE.test(ok)).toBe(false); });
  test("engagement, fate and the AI promise", () => {
    expect(ENGAGEMENT.test("This engagement was not found")).toBe(true); expect(ENGAGEMENT.test("d.engagementId")).toBe(false);
    for (const bad of ["decided by fate", "Ties share the prize.", "fate orders them"]) expect(FATE.test(bad)).toBe(true);
    for (const bad of ["Free AI assistant for organizers", "paste your AI link", "your own AI"]) expect(AI_PROMISE.test(bad)).toBe(true);
    expect(AI_PROMISE.test("Players are 18 or older")).toBe(false);
  });
  test("comments and TypeScript private members are not text", () => {
    expect(visibleText("a.ts", "const a = 1; // keep it private\n  private x = 2;\n/* private */ const b = 3;")).not.toMatch(/private/);
    expect(visibleText("a.js", 'const u = "https://x.test/private-looking";')).toMatch(/https:\/\/x/);
  });
});

describe("B17: the word 'private' is not used anywhere a person reads", () => {
  test("pages, page scripts, e-mails, reports, legal sources", () => { expect(hits(allShipped(), PRIVATE)).toEqual([]); });
});

describe("B16: a person plays a game, not an 'engagement' (player screens, big screen, report)", () => {
  test("no 'engagement' and no 'call board' there", () => {
    expect(hits(PLAYER_FILES(), ENGAGEMENT)).toEqual([]);
    expect(hits([...PLAYER_FILES(), pub("zc.js")], /call board/i)).toEqual([]);
  });
});

describe("B04: one plain tie rule", () => {
  test("no 'decided by fate', no 'ties share the prize' on the phone, the big screen, the report or the site", () => {
    expect(hits([pub("z.js"), pub("big.js"), edge("report-layout.ts"), pub("index.html"), pub("guide.js"), pub("organizer-guide.html"), pub("pricing.html")], FATE)).toEqual([]);
  });
  test("the home page says what happens when two cards finish together", () => { expect(read(pub("index.html"))).toMatch(/same number[^<]*fixed public rule[^<]*one card/); });
});

describe("B19: hours are stated once, from the lifecycle constants", () => {
  test("nobody says 22 or 23 hours (the promise is 'within 24 hours'); the real windows sit inside the promise", () => {
    // The legal texts (terms, privacy, legal, DPA, the ten facts and their sources) are the owner's final text, pinned word for word by other tests; their "23 hours" is not changed
    // until the lawyer has answered (owner ruling Q6, 2026-10-29: no retention window or deletion order is touched). Every other page, script, message and e-mail is checked.
    const LEGAL_PINNED = /(^|[\\/])(terms|privacy|legal|dpa|trust)\.html$|ai-facts\.ts$|tools[\\/]legal[\\/]|make-legal-pages\.mjs$/;
    expect(hits([...pageFiles(), ...edgeFiles(), ...toolFiles()].filter((f) => !LEGAL_PINNED.test(f)), /\b(22|23)[ -]?(hours?|h)\b/i)).toEqual([]);
    expect(PURGE_AFTER_MS).toBeLessThanOrEqual(24 * 3_600_000);
    expect(REPORT_LINK_MS).toBeLessThan(PURGE_AFTER_MS);
  });
  test("the guide says the report link works for exactly the hours in lifecycle.ts", () => {
    const g = read(pub("guide.html")), m = /report link works for (\d+) hours/.exec(g);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(REPORT_LINK_MS / 3_600_000);
    expect(read(join(ROOT, "tools/make-legal-pages.mjs"))).toMatch(new RegExp(`report link works for ${REPORT_LINK_MS / 3_600_000} hours`));
    expect(read(edge("ai-functions.ts"))).toContain(`opens for ${REPORT_LINK_MS / 3_600_000} hours`);
  });
});

describe("B03: no page promises an AI assistant that the console does not show", () => {
  const zc = read(pub("zc.js"));
  test("the console really hides the AI work link (if this fails the promise may come back)", () => {
    expect(zc).toMatch(/function aiBlock\(\) \{\s*return "";/);
    expect(zc).toMatch(/return ""; \/\/ the AI work link is not offered to the organizer or the host/);
  });
  test("the home page, the price list, the guide, the partner page and the console help do not mention it", () => {
    expect(hits(["index.html", "site.js", "pricing.html", "about.html", "guide.html", "partner.html", "contact.html"].map(pub), AI_PROMISE)).toEqual([]);
    expect(zc).not.toMatch(/Copy your AI link at the top/);
    expect(zc).not.toMatch(/Can the AI do this for me/);
    expect(zc).not.toMatch(/keys, e-mail, AI link/);
  });
});

describe("B21: a real game's player screen sells nothing", () => {
  const z = read(pub("z.js"));
  test("no Refer and earn, no 50% sharing line, no share-with-friends buttons", () => {
    expect(z).not.toMatch(/Refer (&amp;|&) earn/);
    expect(z).not.toMatch(/Earn 50%/);
    expect(z).not.toMatch(/partner\.html\?from=card/);
    expect(z).not.toMatch(/id="shr"|Share with friends/);
  });
});
