// Nothing that is shipped may carry an internal note: who asked for a wording, that anything is waiting for someone's review or approval, a to-do, or the name of any other legal entity.
// It scans every text file in the folders that are deployed (the website: apps/web/public, and the Pages functions) and fails with the file and the words found.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const ROOT = join(import.meta.dir, "../../..");
const SHIPPED = [join(ROOT, "apps/web/public"), join(ROOT, "pages/functions")];
const TEXT = new Set([".html", ".js", ".mjs", ".css", ".json", ".txt", ".xml", ".webmanifest", ".md", ".ts", ".svg", ".yaml", ".yml", ".sql", ""]);
const EVERYWHERE = /COUNSEL|\[●\]|legal(ly)?\s+(review|pending|sign-?off)|review\s+pending|pending\s+(legal|review|approval)|awaiting\s+(legal|counsel|lawyer|approval|review)|\blawyer\b|\badvocate\b|owner'?s?\s+(told|instruction|order|directive|decision)|\bTODO\b|\bFIXME\b|under review|not yet (reviewed|approved)|Shobha/i;
const LEGAL_PAGES = ["terms", "legal", "privacy", "refund-policy", "about", "contact", "pricing", "partner-terms", "subprocessors", "dpa", "legal-position"].map((n) => n + ".html");
const DRAFT = /\bdraft\b/i;

function* walk(dir: string): Generator<string> {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) { if (n !== "node_modules" && n !== "vendor") yield* walk(p); } else if (TEXT.has(extname(p).toLowerCase())) yield p;
  }
}

describe("no internal notes in anything that is shipped", () => {
  test("the pattern finds what it should (so an empty result means something)", () => {
    for (const bad of ["pending legal review", "awaiting counsel", "TODO: fix", "the owner's instruction", "not yet approved", "Shobha Kamal", "[●]", "FIXME"]) expect([bad, EVERYWHERE.test(bad)]).toEqual([bad, true]);
    for (const ok of ["Your game is saved as a draft", "Players are 18 or older", "The organizer decides"]) expect([ok, EVERYWHERE.test(ok)]).toEqual([ok, false]);
  });
  test("no file of the website or the Pages functions matches", () => {
    const hits: string[] = [];
    let files = 0;
    for (const dir of SHIPPED) for (const f of walk(dir)) {
      files++;
      const s = readFileSync(f, "utf8");
      const m = s.match(EVERYWHERE);
      if (m) hits.push(`${relative(ROOT, f)}: ${m[0]}`);
    }
    expect(files).toBeGreaterThan(50);
    expect(hits).toEqual([]);
  });
  test("the legal pages carry no 'draft' either (the word is fine in the product, for an unpublished game)", () => {
    const hits: string[] = [];
    for (const n of LEGAL_PAGES) {
      let s = ""; try { s = readFileSync(join(ROOT, "apps/web/public", n), "utf8"); } catch { continue; }
      if (DRAFT.test(s)) hits.push(n);
    }
    expect(hits).toEqual([]);
  });
});
