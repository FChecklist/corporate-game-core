import { describe, expect, test } from "bun:test";
import { completionIndexKey, ticketsFor, activeBreak, callRoundR } from "../src/game";
import { roundEid, validateCfg } from "../src/config";
import { pickNumber } from "../src/index";
import { patternSets } from "../../shared/src/ticket";
import { DEMO_BREAK_AFTER, DEMO_BREAK_SECONDS, DEMO_CALL_SECONDS, DEMO_CORNERS, DEMO_EID, DEMO_PID, DEMO_RAND, DEMO_SEQ, demoCfg, demoRandomnessFor, demoRoundOf } from "../src/demo-script";

// Everything about the demo is re-derived here with the REAL game code, so the preloaded script cannot drift from the real game.
const ticket = ticketsFor(roundEid(DEMO_EID, 1), DEMO_PID, 1)[0]!;
const derive = () => { const out: number[] = []; for (let k = 0; k < 6; k++) out.push(pickNumber(DEMO_EID, k, DEMO_RAND[k]!, out)); return out; };

describe("the free demo game", () => {
  test("the scripted public randomness makes the real number-drawing call exactly the six scripted numbers", () => { expect(derive()).toEqual([...DEMO_SEQ]); });
  test("the demo ticket's four corners are the scripted corners", () => { expect([...patternSets(ticket, "corners")[0]!].sort((a, b) => a - b)).toEqual([...DEMO_CORNERS].sort((a, b) => a - b)); });
  test("Four corners are NOT complete after 5 numbers and ARE complete on the 6th, by the real winner check", () => {
    const log = derive();
    for (let n = 1; n <= 5; n++) expect(completionIndexKey([ticket], "corners", log.slice(0, n))).toBe(-1);
    expect(completionIndexKey([ticket], "corners", log)).toBe(5);
  });
  test("it is 3 numbers, then a 15-second break, then 3 numbers, at the real 9-second speed", () => {
    const first = 1000;
    expect(DEMO_CALL_SECONDS).toBe(9); expect(DEMO_BREAK_AFTER).toBe(3); expect(DEMO_BREAK_SECONDS).toBe(15);
    const cfg = demoCfg("https://youtu.be/abcdefghijk");
    const at = (k: number) => callRoundR(null, first, 3, cfg.breaks, 1, k)!;
    expect([0, 1, 2].map((k) => at(k + 1) - at(k)).slice(0, 2)).toEqual([3, 3]); // 9 s between numbers
    expect(at(3) - at(2)).toBe(3 + 5); // the 3rd to the 4th number: 9 s plus the 15-second break (5 rounds of 3 s)
    expect(at(4) - at(3)).toBe(3); expect(at(5) - at(4)).toBe(3);
    expect([0, 1, 2, 3, 4, 5].map((k) => demoRoundOf(first, k))).toEqual([0, 1, 2, 3, 4, 5].map(at));
    expect(activeBreak(null, first, 3, cfg.breaks, at(2) + 1)?.brk.seconds).toBe(15); // the break shows right after the 3rd number
    expect(activeBreak(null, first, 3, cfg.breaks, at(2) + 6)).toBeNull(); // and is over 15 seconds later
  });
  test("only the scripted rounds carry a scripted number; every other round is not scripted", () => {
    const first = 5000;
    for (let k = 0; k < 6; k++) expect(demoRandomnessFor(first, demoRoundOf(first, k))).toBe(DEMO_RAND[k]!);
    expect(demoRandomnessFor(first, first + 1)).toBeNull(); expect(demoRandomnessFor(first, demoRoundOf(first, 5) + 1)).toBeNull();
  });
  test("the demo settings are valid game settings: one prize, Four corners, one break; a YouTube link plays that, anything else shows the host message", () => {
    for (const url of ["https://youtu.be/abcdefghijk", "https://www.youtube.com/watch?v=abcdefghijk", "", "https://example.com/x", undefined]) { const v = validateCfg(demoCfg(url as any)); expect(v.ok).toBe(true); }
    const yt = demoCfg("https://youtu.be/abcdefghijk"); expect(yt.breaks[0]).toMatchObject({ kind: "youtube", seconds: 15, after: 3, mediaUrl: "https://youtu.be/abcdefghijk" });
    const none = demoCfg(""); expect(none.breaks[0]).toMatchObject({ kind: "speech", seconds: 15, title: "A short message from your host appears here" });
    expect(yt.rewards.map((r) => r.pattern)).toEqual(["corners"]);
  });
});
