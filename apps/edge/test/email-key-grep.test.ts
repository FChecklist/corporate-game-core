// No source file may lower-case an e-mail address by itself: every address goes through emailKey (owner rule 2026-10-30), so a new spot cannot slip past.
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";

test("no raw toLowerCase() on an e-mail variable anywhere in apps/edge/src", () => {
  const dir = new URL("../src/", import.meta.url), bad: string[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts") && x !== "emailkey.ts")) readFileSync(new URL(f, dir), "utf8").split("\n").forEach((l, i) => {
    if (/(e?mail|onFile)\w*(\?)?(\.\w+)*(\s*\?\?\s*"")?\)?(\.trim\(\))?\.toLowerCase\(\)/i.test(l)) bad.push(`${f}:${i + 1}`);
  });
  expect(bad).toEqual([]);
});
test("the check itself catches a planted raw lower-case", () => {
  const re = /(e?mail|onFile)\w*(\?)?(\.\w+)*(\s*\?\?\s*"")?\)?(\.trim\(\))?\.toLowerCase\(\)/i;
  expect(re.test('const email = b.email.trim().toLowerCase();')).toBe(true); expect(re.test('const email = emailKey(b.email);')).toBe(false);
});
