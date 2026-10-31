// The phone page lists every house by name with a one-line "how to win": the names and lines come from the one shared table (PRIZE_HOUSES). These tests keep the page copies from drifting.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PRIZE_HOUSES } from "../../../packages/beacon/src/config";

const pub = (f: string) => readFileSync(new URL(`../public/${f}`, import.meta.url), "utf8");

describe("house names and how-to-win lines on the pages", () => {
  test("the built phone bundle (zgame.js) carries the shared table, so z.js, big.js and the console read the same names", () => {
    const js = pub("zgame.js");
    for (const h of PRIZE_HOUSES) { expect(js).toContain(h.label); expect(js).toContain(h.how.slice(0, 40)); }
    expect(js).toContain("PRIZE_HOUSES");
  });
  test("z.js reads the table for every house it has no older spelling for, and shows the how-to-win line in 'What you can win', 'Still to win', your prizes and the hurray card", () => {
    const z = pub("z.js");
    expect(z).toContain("ZG.PRIZE_HOUSES.forEach");
    expect(z).toContain("const HOW = ");
    expect((z.match(/howLine\(/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(z).toContain("HOW[list[0].pattern]"); // hurray card
    expect(z).toContain("not possible on your card");
  });
  test("preview.js (the organizer's preview of the card page) lists the same names and lines as the table", () => {
    const p = pub("preview.js");
    const how = JSON.parse(/const HOW = (\{.*?\});/s.exec(p)![1]!) as Record<string, string>;
    const names = JSON.parse(/const NAMES = (\{.*?\});/s.exec(p)![1]!) as Record<string, string>;
    for (const h of PRIZE_HOUSES) { expect(how[h.id]).toBe(h.how); expect(names[h.id]).toBe(h.label); }
  });
  test("the service worker cache name was bumped for this change", () => {
    const n = Number(/const CACHE = "cb-game-v(\d+)"/.exec(pub("zsw.js"))![1]);
    expect(n).toBeGreaterThanOrEqual(13);
  });
});
