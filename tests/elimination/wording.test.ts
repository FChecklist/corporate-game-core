import { describe, expect, test } from "bun:test";
import { say, sayFor, MSG, NO_PERSONAL_DETAILS, RETENTION_LINE, GROUP_WORD, guardOk, BANNED_PLAYER_WORDS, BINGO_MSG, BINGO_HOUSE_NAMES, bingoSay, callLabel, spokenCall } from "../../packages/wording/src";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
const APPROVED = "No personal details needed. All participant information is deleted within 24 hours of the game.";
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return f === "node_modules" ? [] : statSync(p).isDirectory() ? walk(p) : [p]; });
const sources = walk(join(import.meta.dir, "../../packages")).filter((f) => /\.(ts|tsx|js|css|md)$/.test(f));
describe("WORD noun forms", () => {
  test("WORD1 Card form: Bingo says Card, not Ticket", () => {
    const t = sayFor("Card", "claim.k", { t: 12, p: "Full House" });
    expect(t).toBe("Card 12 has claimed Full House. Checking now…");
    expect(t).not.toMatch(/Ticket/);
  });
  test("WORD1 Entry form for the other games", () => {
    expect(sayFor("Entry", "claim.w", { t: 4 })).toBe("Entry 4's claim was not correct. The game continues.");
    expect(sayFor("Entry", "claim.a", { t: 4, p: "1st" })).not.toMatch(/Ticket/);
    expect(sayFor("Entry", "claim.a", { t: 4, p: "1st" })).toContain("Congratulations Entry 4 on winning 1st");
  });
  test("WORD1 Ticket form stays for Tambola", () => expect(sayFor("Ticket", "claim.k", { t: 3, p: "Corners" })).toBe("Ticket 3 has claimed Corners. Checking now…"));
  test("WORD1 every shared line has no Ticket left after the swap", () => {
    for (const code of Object.keys(MSG)) for (const n of ["Card", "Entry"] as const) expect(sayFor(n, code, { t: 1, p: "x" }), code).not.toMatch(/\bTicket/);
  });
  test("WORD2 shared lines: won, out, over, paused, wait, full", () => {
    expect(say("won", { p: "1st" })).toBe("You won 1st. Tap to open your prize card.");
    expect(say("out")).toBe("You are out."); expect(say("over")).toBe("Game over."); expect(say("paused")).toBe("Paused");
    expect(say("full")).toBe("This game is full.");
  });
  test("WORD2 an unknown code gives the generic line, a missing value gives nothing", () => {
    expect(say("nope")).toBe(MSG.generic);
    expect(say("won", {})).not.toContain("undefined");
  });
});
describe("WORD Bingo message codes", () => {
  test("WORD3 the five Bingo codes exist", () => expect(Object.keys(BINGO_MSG).sort()).toEqual(["bingo.call", "bingo.first", "bingo.free", "bingo.house.taken", "bingo.won"]));
  test("WORD3 the call line, win line, taken line", () => {
    expect(bingoSay("bingo.call", { l: "G", n: 52 })).toBe("Next number is G 52.");
    expect(bingoSay("bingo.won", { t: 7, h: "corners" })).toBe("Congratulations! Card 7 wins Four Corners.");
    expect(bingoSay("bingo.house.taken", { h: "blackout" })).toBe("Blackout has been won. It is no longer available.");
    expect(bingoSay("bingo.free")).toBe("FREE counts as marked.");
    expect(bingoSay("bingo.first")).toBe("The first number is called in 2 minutes.");
  });
  test("WORD3 house names", () => {
    expect(BINGO_HOUSE_NAMES.stamp).toBe("Postage Stamp"); expect(BINGO_HOUSE_NAMES.twolines).toBe("Two Lines"); expect(Object.keys(BINGO_HOUSE_NAMES).length).toBe(10);
  });
  test("WORD3 call labels and voice lines", () => {
    expect(callLabel(52)).toBe("G 52"); expect(callLabel(1)).toBe("B 1"); expect(callLabel(75)).toBe("O 75"); expect(callLabel(76)).toBe("76");
    expect(spokenCall(52)).toBe("Next number is Gee, five two, fifty-two. Gee, fifty-two.");
    expect(spokenCall(7)).toBe("Next number is Bee, seven. Bee, seven.");
  });
});
describe("WORD approved customer line", () => {
  test("WORD4 the retention line is exactly the approved text", () => expect(NO_PERSONAL_DETAILS).toBe(APPROVED));
  test("WORD4 wherever the line appears in the packages it is unchanged", () => {
    const hits = sources.filter((f) => /No personal details needed/i.test(readFileSync(f, "utf8")));
    expect(hits.length).toBeGreaterThan(0);
    for (const f of hits) { const txt = readFileSync(f, "utf8"); expect(txt.includes(APPROVED), f).toBe(true); expect((txt.match(/No personal details needed/gi) ?? []).length, f).toBe((txt.split(APPROVED).length - 1)); }
  });
  test("WORD4 no other wording of the 24-hour promise differs from the approved line", () => {
    for (const f of sources) for (const m of readFileSync(f, "utf8").matchAll(/[^"`\n]*deleted within 24 hours[^"`\n]*/g)) {
      if (m[0].includes(APPROVED) || m[0].includes(RETENTION_LINE)) continue;
      expect(m[0].includes("within 24 hours of the game"), f + ": " + m[0]).toBe(true);
    }
  });
});
describe("WORD plain English", () => {
  const lines = [...Object.entries(MSG), ...Object.entries(BINGO_MSG), ["retention", RETENTION_LINE], ["nopd", NO_PERSONAL_DETAILS]];
  test("WORD5 no 'private' game wording; use 'close group'", () => {
    expect(GROUP_WORD).toBe("close group");
    for (const [k, v] of lines) { expect(v, k).not.toMatch(/\bprivate\b/i); expect(guardOk(v!), k).toBe(true); }
    expect(guardOk("a private game")).toBe(false);
    expect(guardOk("a close group game")).toBe(true);
    expect(BANNED_PLAYER_WORDS.some((r) => r.test("engagement"))).toBe(true);
  });
  test("WORD6 every line is short (at most 120 characters) and one to three sentences", () => {
    for (const [k, v] of lines) { expect(v!.length, k).toBeLessThanOrEqual(120); expect((v!.match(/[.!?](\s|$)/g) ?? []).length, k).toBeLessThanOrEqual(3); }
  });
  test("WORD6 no jargon in player lines", () => {
    for (const [k, v] of lines) expect(v!, k).not.toMatch(/\b(elimination|manifest|payload|backend|API|error code)\b/i);
  });
  test("WORD6 no player-facing line in the packages' UI/wording says 'private'", () => {
    for (const f of sources.filter((x) => /packages\/(wording|ui)\//.test(x))) expect(readFileSync(f, "utf8").replace(/\/\/.*|\/\*[\s\S]*?\*\//g, "").replace(/BANNED_PLAYER_WORDS[^\n]*/g, ""), f).not.toMatch(/\bprivate\b/i);
  });
});
