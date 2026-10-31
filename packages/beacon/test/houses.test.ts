// The Bingo houses (patterns): the table, what each asks of one card, and the proof that the incremental engine gives exactly what the whole-log settlement gives for EVERY pattern.
import { describe, expect, test } from "bun:test";
import { FREE_CELL, PATTERN_RULES, cellOfNumber, generateTicket, ticketNumbers, type PatternId, type Ticket } from "../../shared/src/ticket";
import { HOUSE_ORDER, HOUSES_LINE, PATTERN_ORDER, PRIZE_HOUSES, defaultCfg, defaultRewards, keysInPlay, linesFor, maxWinnersFor, validateCfg, type EngagementCfg, type RewardLine } from "../src/config";
import { PrizeEngine, countFromOf } from "../src/prize-engine";
import { assignOrdinals, completionIndex, rankName, rankWinners, settleAll, stillToWin, ticketsFor } from "../src/game";
import { ticketCompletion, ticketStillNeeds, winningNumbers } from "../src/house-rules";
import { seededRand } from "../src";
import { ticketAt } from "../src/unique-ticket";

const ALL: PatternId[] = ["line", "twolines", "corners", "plus", "x", "frame", "stamp", "letterL", "letterT", "blackout"];
const shuffle75 = (seed: string): number[] => { const r = seededRand(seed); const a = Array.from({ length: 75 }, (_, i) => i + 1); for (let i = 74; i > 0; i--) { const j = r(i + 1); [a[i], a[j]] = [a[j]!, a[i]!]; } return a; };
const norm = (xs: { pattern: string; ordinal: number; idx: number; pids: string[] }[]) => xs.map((x) => `${x.pattern}:${x.ordinal}:${x.idx}:${[...x.pids].sort().join(",")}`).sort();
const mkPids = (n: number) => Array.from({ length: n }, (_, i) => `${i + 1}x00000000${(i + 1).toString(16).padStart(4, "0")}`);
const everyHouse = (): RewardLine[] => PRIZE_HOUSES.flatMap((h) => Array.from({ length: h.max }, (_, i) => ({ pattern: h.id, scope: "ticket" as const, ordinal: i + 1, text: "" })));
const cfgAll = (tickets: 1 | 2): EngagementCfg => ({ ...defaultCfg(), tickets, rewards: everyHouse() });

// ---- an independent description of every pattern, as pictures (X = must be marked). Nothing here reads PATTERN_RULES.
const PICTURES: Record<PatternId, string[][]> = {
  line: [], // any row, column or diagonal: handled in lines() below
  twolines: [],
  corners: [["X...X", ".....", ".....", ".....", "X...X"]],
  plus: [["..X..", "..X..", "XXXXX", "..X..", "..X.."]],
  x: [["X...X", ".X.X.", "..X..", ".X.X.", "X...X"]],
  frame: [["XXXXX", "X...X", "X...X", "X...X", "XXXXX"]],
  stamp: [["XX...", "XX...", ".....", ".....", "....."], ["...XX", "...XX", ".....", ".....", "....."], [".....", ".....", ".....", "XX...", "XX..."], [".....", ".....", ".....", "...XX", "...XX"]],
  letterL: [["X....", "X....", "X....", "X....", "XXXXX"]],
  letterT: [["XXXXX", "..X..", "..X..", "..X..", "..X.."]],
  blackout: [["XXXXX", "XXXXX", "XXXXX", "XXXXX", "XXXXX"]],
};
const cellsOfPicture = (p: string[]): number[] => p.flatMap((row, r) => [...row].map((ch, c) => (ch === "X" ? r * 5 + c : -1))).filter((x) => x >= 0);
const LINE_CELLS: number[][] = [
  ...[0, 1, 2, 3, 4].map((r) => [0, 1, 2, 3, 4].map((c) => r * 5 + c)), ...[0, 1, 2, 3, 4].map((c) => [0, 1, 2, 3, 4].map((r) => r * 5 + c)),
  [0, 6, 12, 18, 24], [4, 8, 12, 16, 20],
];
/** Reference: mark the card square by square and say after which call the pattern is complete (-1: never). Independent of house-rules.ts. */
function refCompletion(card: Ticket, pat: PatternId, log: readonly number[]): number {
  const marked = new Array(25).fill(false); marked[12] = true;
  const shapes = pat === "line" || pat === "twolines" ? LINE_CELLS : PICTURES[pat].map(cellsOfPicture);
  const need = pat === "twolines" ? 2 : 1;
  for (let i = 0; i < log.length; i++) {
    const c = cellOfNumber(card, log[i]!); if (c >= 0) marked[c] = true;
    if (shapes.filter((s) => s.every((x) => marked[x])).length >= need) return i;
  }
  return -1;
}

describe("the house table", () => {
  test("the ten Bingo houses, their order, labels and the most winners each may have (spec section 4.4)", () => {
    expect(PRIZE_HOUSES.map((h) => h.id)).toEqual(["line", "twolines", "corners", "plus", "x", "frame", "stamp", "letterL", "letterT", "blackout"]);
    expect(Object.fromEntries(PRIZE_HOUSES.map((h) => [h.id, h.max]))).toEqual({ line: 3, twolines: 2, corners: 3, plus: 2, x: 2, frame: 2, stamp: 3, letterL: 2, letterT: 2, blackout: 2 });
    expect(Object.fromEntries(PRIZE_HOUSES.map((h) => [h.id, h.label]))).toMatchObject({ line: "Line", corners: "Four Corners", x: "X", blackout: "Blackout" });
    expect(new Set(HOUSE_ORDER).size).toBe(10); expect(HOUSES_LINE).toContain("blackout = Blackout (up to 2 winners)");
    for (const h of PRIZE_HOUSES) expect(PATTERN_RULES[h.id]).toBeDefined();
  });
  test("a new game rewards Line, Four Corners, X and Blackout (the default prize set)", () => {
    expect([...PATTERN_ORDER]).toEqual(["line", "corners", "x", "blackout"]);
    expect(defaultRewards().map((r) => `${r.pattern}#${r.ordinal}`)).toEqual(["line#1", "corners#1", "x#1", "blackout#1"]);
    expect(keysInPlay(defaultCfg().rewards)).toEqual(["line", "corners", "x", "blackout"]);
  });
  test("how many squares each pattern needs (FREE is a square of the pattern but is never a number to call)", () => {
    const squares = (p: PatternId) => Math.max(...PATTERN_RULES[p].sets.map((s) => s.length));
    expect(squares("line")).toBe(5); expect(squares("corners")).toBe(4); expect(squares("plus")).toBe(9); expect(squares("x")).toBe(9);
    expect(squares("frame")).toBe(16); expect(squares("stamp")).toBe(4); expect(squares("letterL")).toBe(9); expect(squares("letterT")).toBe(9); expect(squares("blackout")).toBe(25);
    expect(PATTERN_RULES.line.sets.length).toBe(12); expect(PATTERN_RULES.stamp.sets.length).toBe(4);
    expect(PATTERN_RULES.twolines.need).toBe(2);
  });
  test("the pattern table agrees with the independent pictures", () => {
    for (const p of ALL.filter((x) => x !== "line" && x !== "twolines")) expect(PATTERN_RULES[p].sets.map((s) => [...s].sort((a, b) => a - b))).toEqual(PICTURES[p].map((pic) => cellsOfPicture(pic)));
    expect(PATTERN_RULES.line.sets.map((s) => [...s].sort((a, b) => a - b)).sort()).toEqual(LINE_CELLS.map((s) => [...s].sort((a, b) => a - b)).sort());
  });
});

describe("BG-03 each pattern completes on the exact call where its last square is marked, never earlier; FREE counts", () => {
  for (const pat of ALL) {
    test(`${pat}: 60 cards x 8 call orders agree with the pictures, call by call`, () => {
      for (let i = 0; i < 60; i++) {
        const card = ticketAt("BG03-" + pat, i * 13);
        for (let k = 0; k < 8; k++) {
          const log = shuffle75(`${pat}-${i}-${k}`);
          const want = refCompletion(card, pat, log);
          expect(ticketCompletion(card, pat, log)).toBe(want);
          expect(completionIndex(card, pat, log)).toBe(want);
          if (want >= 0) expect(ticketCompletion(card, pat, log.slice(0, want))).toBe(-1); // one call earlier it is not complete
        }
      }
    });
  }
  test("a pattern completes at the call of its LAST number: log made of exactly the pattern's numbers first", () => {
    for (const pat of ALL) {
      const card = ticketAt("EXACT", 3);
      for (const set of PATTERN_RULES[pat].sets.slice(0, 4)) {
        const flat = card.flat(); const nums = set.filter((c) => c !== FREE_CELL).map((c) => flat[c]!);
        const rest = ticketNumbers(card).filter((n) => !nums.includes(n)), others = Array.from({ length: 75 }, (_, i) => i + 1).filter((n) => !nums.includes(n) && !rest.includes(n));
        if (PATTERN_RULES[pat].need === 1) { const log = [...nums, ...rest, ...others]; expect(ticketCompletion(card, pat, log)).toBeLessThanOrEqual(nums.length - 1); expect(ticketCompletion(card, pat, log.slice(0, nums.length - 1))).toBe(-1); }
      }
    }
  });
  test("FREE counts as marked from the first call: a line through the centre needs only 4 numbers, a corner-only card needs all 4 corners", () => {
    const card = ticketAt("FREE", 1), flat = card.flat();
    const mid = [10, 11, 13, 14].map((c) => flat[c]!); // the middle row, centre left out
    expect(ticketStillNeeds(card, "line", new Set())).toBe(4);
    expect(ticketCompletion(card, "line", [...mid, ...Array.from({ length: 75 }, (_, i) => i + 1).filter((n) => !mid.includes(n))])).toBe(3);
    expect(ticketStillNeeds(card, "blackout", new Set())).toBe(24);
    expect(ticketStillNeeds(card, "corners", new Set())).toBe(4);
    expect(ticketStillNeeds(card, "plus", new Set())).toBe(8);
    expect(card[2]![2]).toBeNull(); expect(ticketNumbers(card)).toHaveLength(24);
  });
  test("still to win counts down to zero; Two Lines counts the two cheapest lines with shared squares counted once", () => {
    const card = ticketAt("STILL", 9), log = shuffle75("still");
    for (const pat of ALL) { const done = completionIndex(card, pat, log); let prev = 99; for (let i = 0; i <= done; i++) { const left = stillToWin(card, pat, log.slice(0, i + 1)); expect(left).toBeLessThanOrEqual(prev); prev = left; } expect(stillToWin(card, pat, log.slice(0, done + 1))).toBe(0); expect(stillToWin(card, pat, [])).toBeGreaterThan(0); }
    const flat = card.flat(); const row0 = [0, 1, 2, 3, 4].map((c) => flat[c]!), col0 = [5, 10, 15, 20].map((c) => flat[c]!);
    expect(ticketStillNeeds(card, "twolines", new Set([...row0, ...col0.slice(0, 2)]))).toBe(2); // row 0 done, column 0 needs its last 2
  });
  test("winning numbers to light up are the squares of the set that made the win", () => {
    const card = ticketAt("LIGHT", 4), log = shuffle75("light");
    for (const pat of ALL) { const idx = completionIndex(card, pat, log); const lit = winningNumbers(card, pat, log, idx); expect(lit.length).toBeGreaterThanOrEqual(PATTERN_RULES[pat].need === 2 ? 8 : 3); for (const n of lit) expect(log.slice(0, idx + 1)).toContain(n); }
    expect(winningNumbers(card, "corners", shuffle75("light"), completionIndex(card, "corners", shuffle75("light"))).length).toBe(4);
  });
});

describe("BG-04 / BG-18 no shared prize: one winner per ordinal, ties decided by fate", () => {
  const seatPid = (i: number) => i + "x00000000" + i.toString(16).padStart(4, "0");
  test("a tie on the same call for 2, 3 and 10 guests: each ordinal has exactly one winner, ordered by fate, the same every time", () => {
    for (const n of [2, 3, 10]) {
      const pids = Array.from({ length: n }, (_, i) => seatPid(i + 1));
      const ords = Array.from({ length: Math.min(n, 3) }, (_, i) => i + 1);
      const r = assignOrdinals("TIE-" + n, "corners", [[20, pids]], ords, 1);
      expect(r.length).toBe(ords.length);
      for (const s of r) { expect(s.pids.length).toBe(1); expect(s.tied).toBe(n); expect(s.idx).toBe(20); }
      expect(new Set(r.map((s) => s.pids[0])).size).toBe(r.length); // nobody wins two ordinals of one house here
      expect(JSON.stringify(assignOrdinals("TIE-" + n, "corners", [[20, [...pids].reverse()]], ords, 1))).toBe(JSON.stringify(r)); // the order of the list does not matter
      expect(r.map((s) => s.ordinal)).toEqual(ords);
    }
  });
  test("an earlier call always beats a later one; fate only orders guests on the SAME call", () => {
    const r = assignOrdinals("TIE-X", "line", [[30, ["2x00000000bbbb", "3x00000000cccc"]], [10, ["1x00000000aaaa"]]], [1, 2, 3], 1);
    expect(r[0]!.pids[0]).toBe("1x00000000aaaa"); expect(r[0]!.tied).toBeUndefined();
    expect(r.slice(1).every((s) => s.idx === 30 && s.tied === 2)).toBe(true);
  });
  test("real cards: every house, 400 guests: no ordinal has more than one winner and the engine equals settleAll", () => {
    const pids = mkPids(400), cfg = cfgAll(1);
    for (let s = 0; s < 6; s++) {
      const log = shuffle75("tie" + s), r = settleAll("TIE", pids, log, cfg), e = new PrizeEngine("TIE", cfg);
      e.addSeats(pids.map((pid) => ({ pid, countFrom: 0 }))); e.work(10_000); log.forEach((n, k) => e.feed(n, 100 + k));
      expect(norm(e.results())).toEqual(norm(r));
      const seen = new Set<string>(); for (const x of r) { expect(x.pids.length).toBe(1); const k = x.pattern + "#" + x.ordinal; expect(seen.has(k)).toBe(false); seen.add(k); }
    }
  });
  test("BG-19 ranking: unique ranks 1-10 in prize order, then call, then fate; a fate-decided tie is explained", () => {
    const pids = mkPids(400), cfg = cfgAll(1), log = shuffle75("rank"), r = settleAll("RANK", pids, log, cfg);
    const rows = rankWinners("RANK", cfg, r, 10);
    expect(rows.length).toBe(10); expect(rows.map((x) => x.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(rankName(1)).toBe("1st"); expect(rankName(5)).toBe("5th");
    const again = rankWinners("RANK", cfg, [...r].reverse(), 10); expect(JSON.stringify(again)).toBe(JSON.stringify(rows)); // stable whatever order the phone holds the results in
    const vi = (x: { pattern: string; ordinal: number }) => cfg.rewards.findIndex((l) => l.pattern === x.pattern && l.ordinal === x.ordinal);
    for (let i = 1; i < rows.length; i++) expect(vi(rows[i]!) > vi(rows[i - 1]!) || (vi(rows[i]!) === vi(rows[i - 1]!))).toBe(true);
    const tied = rankWinners("T", { ...defaultCfg() }, assignOrdinals("T", "line", [[5, ["1x00000000aaaa", "2x00000000bbbb"]]], [1], 1), 10);
    expect(tied[0]!.note).toMatch(/same number.*fixed public rule/); expect(tied[0]!.note).not.toMatch(/fate|lottery/i); // B04: plain words, no "fate"
  });
});

describe("the incremental engine gives exactly what settleAll gives, for every house (parity)", () => {
  for (const tickets of [1, 2] as const) {
    test(`${tickets} card(s): 160 participants, EVERY house with all its winners, same results at every few calls`, () => {
      const cfg = cfgAll(tickets), eid = "PAR-" + tickets, pids = mkPids(160), log = shuffle75("par" + tickets);
      const e = new PrizeEngine(eid, cfg); e.addSeats(pids.map((pid) => ({ pid, countFrom: 0 }))); expect(e.work(10_000)).toBe(true);
      for (let k = 0; k < 75; k++) { e.feed(log[k]!, 1000 + k * 3); if (k % 5 === 4 || k > 60) expect(norm(e.results())).toEqual(norm(settleAll(eid, pids, log.slice(0, k + 1), cfg))); }
      expect(e.results().length).toBeGreaterThan(8);
    });
  }
  for (const pat of ALL) {
    test(`${pat} alone, 2 cards, 3 call orders: engine equals the whole-log answer`, () => {
      const rewards: RewardLine[] = Array.from({ length: maxWinnersFor(pat) }, (_, i) => ({ pattern: pat, scope: "ticket", ordinal: i + 1, text: "" }));
      const cfg: EngagementCfg = { ...defaultCfg(), tickets: 2, rewards }, pids = mkPids(120);
      for (let k = 0; k < 3; k++) {
        const eid = `PAT-${pat}-${k}`, log = shuffle75(eid), e = new PrizeEngine(eid, cfg);
        e.addSeats(pids.map((pid) => ({ pid, countFrom: 0 }))); e.work(10_000); log.forEach((n, j) => e.feed(n, 500 + j));
        expect(norm(e.results())).toEqual(norm(settleAll(eid, pids, log, cfg)));
        expect(e.results().length).toBeGreaterThan(0);
      }
    });
  }
  test("late joiners: only numbers from their count-from round count; the engine and the whole-log answer agree along the way (every house)", () => {
    const cfg = cfgAll(1), eid = "PAR-LATE", start = 2000, pids = mkPids(80), log = shuffle75("late"), callRounds = log.map((_, k) => start + k * 3);
    const cf = new Map<string, number>(); pids.forEach((p, i) => { if (i >= 40) cf.set(p, countFromOf(start + 3 * (5 + (i % 30)))); });
    const e = new PrizeEngine(eid, cfg); e.addSeats(pids.map((pid) => ({ pid, countFrom: cf.get(pid) ?? 0 }))); e.work(10_000);
    for (let k = 0; k < 75; k++) { e.feed(log[k]!, callRounds[k]!); if (k % 6 === 5 || k === 74) expect(norm(e.results())).toEqual(norm(settleAll(eid, pids, log.slice(0, k + 1), cfg, 1, { countFrom: cf, callRounds: callRounds.slice(0, k + 1) }))); }
    expect(cf.size).toBe(40); expect([...cf.values()].every((v) => v > start)).toBe(true);
  });
  test("BG-06 a late joiner cannot win with numbers called before they joined, and prizes already awarded stay awarded", () => {
    const cfg: EngagementCfg = { ...defaultCfg(), rewards: [{ pattern: "line", scope: "ticket", ordinal: 1, text: "" }] }, eid = "PAR-NOWIN", start = 100, pid = "1x00000000aaaa", other = "2x00000000bbbb";
    const log = shuffle75("nowin"), callRounds = log.map((_, k) => start + k * 3);
    const full = settleAll(eid, [pid], log, cfg), first = full.find((x) => x.pattern === "line")!;
    const joinedAfter = new Map([[pid, callRounds[first.idx]! + 1]]);
    const masked = settleAll(eid, [pid], log, cfg, 1, { countFrom: joinedAfter, callRounds });
    expect(masked.find((x) => x.pattern === "line")?.idx ?? 999).toBeGreaterThan(first.idx);
    const e = new PrizeEngine(eid, cfg); e.addSeats([{ pid, countFrom: joinedAfter.get(pid)! }]); e.work(1000); log.forEach((n, k) => e.feed(n, callRounds[k]!));
    expect(norm(e.results())).toEqual(norm(masked));
    // the guest who was there from the start keeps the prize however late the other joined
    const both = new PrizeEngine(eid, cfg); both.addSeats([{ pid: other, countFrom: 0 }, { pid, countFrom: joinedAfter.get(pid)! }]); both.work(1000); log.forEach((n, k) => both.feed(n, callRounds[k]!));
    const w = both.results().find((x) => x.ordinal === 1)!; expect(w.pids).toContain(other); expect(w.pids).not.toContain(pid);
  });
  test("seats that arrive after numbers were already called are caught up (every house)", () => {
    const cfg = cfgAll(2), eid = "PAR-CATCH", start = 3000, pids = mkPids(60), log = shuffle75("catch"), callRounds = log.map((_, k) => start + k * 3);
    const cf = new Map<string, number>(); for (const p of pids.slice(30)) cf.set(p, countFromOf(start + 3 * 20));
    const e = new PrizeEngine(eid, cfg); e.addSeats(pids.slice(0, 30).map((pid) => ({ pid, countFrom: 0 }))); e.work(10_000);
    for (let k = 0; k < 50; k++) e.feed(log[k]!, callRounds[k]!);
    e.addSeats(pids.slice(30).map((pid) => ({ pid, countFrom: cf.get(pid)! }))); e.work(10_000);
    for (let k = 50; k < 75; k++) e.feed(log[k]!, callRounds[k]!);
    expect(norm(e.results())).toEqual(norm(settleAll(eid, pids, log, cfg, 1, { countFrom: cf, callRounds })));
  });
  test("seats built AFTER numbers were called give the same winners as seats built before (two cards, every house)", () => {
    const cfg = cfgAll(2), eid = "PAR-LATEBUILD", pids = mkPids(200), log = shuffle75("latebuild"), br = (k: number) => 5000 + k * 3;
    const a = new PrizeEngine(eid, cfg); a.addSeats(pids.map((pid) => ({ pid, countFrom: 0 }))); a.work(10_000);
    const b = new PrizeEngine(eid, cfg);
    for (let k = 0; k < 75; k++) { a.feed(log[k]!, br(k)); b.feed(log[k]!, br(k)); if (k === 29) { b.addSeats(pids.map((pid) => ({ pid, countFrom: 0 }))); b.work(10_000); } }
    expect(norm(b.results())).toEqual(norm(a.results()));
    expect(norm(a.results())).toEqual(norm(settleAll(eid, pids, log, cfg)));
  });
  test("building cards in small slices gives the same answer, and resetCalls plus the same feed gives the same answer again", () => {
    const cfg = cfgAll(2), eid = "PAR-SLICE", pids = mkPids(200), log = shuffle75("slice");
    const e = new PrizeEngine(eid, cfg); e.addSeats(pids.map((pid) => ({ pid, countFrom: 0 })));
    let slices = 0; let t = 0; while (!e.work(1, () => (t += 0.4))) slices++;
    expect(slices).toBeGreaterThan(20); expect(e.seatCount).toBe(200);
    for (let k = 0; k < 75; k++) e.feed(log[k]!, 100 + k);
    const a = norm(e.results()); expect(a).toEqual(norm(settleAll(eid, pids, log, cfg)));
    e.resetCalls(); expect(e.results()).toEqual([]); for (let k = 0; k < 75; k++) e.feed(log[k]!, 100 + k);
    expect(norm(e.results())).toEqual(a);
  });
  test("a seat is only counted once however many times it is offered", () => {
    const e = new PrizeEngine("PE-DUP", defaultCfg()); e.addSeats([{ pid: "1xabcdef012345", countFrom: 0 }, { pid: "1xabcdef012345", countFrom: 0 }]); e.addSeats([{ pid: "1xabcdef012345", countFrom: 99 }]);
    expect(e.seatCount).toBe(1);
  });
  test("10,000 seats with two cards are built in slices and each call is cheap enough for a phone", () => {
    const cfg = cfgAll(2), eid = "PE-BIG", pids = mkPids(10_000);
    const e = new PrizeEngine(eid, cfg); e.addSeats(pids.map((pid) => ({ pid, countFrom: 0 })));
    const t0 = performance.now(); while (!e.work(40)) { /* one slice per tick */ } const build = performance.now() - t0;
    const log = shuffle75("big"); const t1 = performance.now(); for (let k = 0; k < 75; k++) e.feed(log[k]!, 5000 + k); const feed = performance.now() - t1;
    console.log(`10,000 seats x 2 cards, every house: build ${Math.round(build)} ms in total, 75 calls ${Math.round(feed)} ms (${(feed / 75).toFixed(1)} ms per call)`);
    expect(e.results().length).toBeGreaterThan(0); expect(feed / 75).toBeLessThan(50);
  }, 180_000);
});

describe("the most winners per house, and the settings that carry them", () => {
  test("every house accepts exactly its maximum and refuses one more with a calm message", () => {
    for (const h of PRIZE_HOUSES) {
      const ok = validateCfg({ rewards: Array.from({ length: h.max }, (_, i) => ({ pattern: h.id, ordinal: i + 1, text: "" })) });
      expect(ok.ok).toBe(true);
      const bad = validateCfg({ rewards: Array.from({ length: h.max + 1 }, (_, i) => ({ pattern: h.id, ordinal: i + 1, text: "" })) });
      expect(bad.ok).toBe(false); if (!bad.ok) expect(bad.error).toContain("at most");
    }
  });
  test("every house together at its maximum fits in the reward limit; unknown houses and a repeated line are refused", () => {
    expect(validateCfg({ rewards: everyHouse() }).ok).toBe(true);
    expect(validateCfg({ rewards: [{ pattern: "early5", ordinal: 1 }] }).ok).toBe(false);
    expect(validateCfg({ rewards: [{ pattern: "full", ordinal: 1 }] }).ok).toBe(false);
    expect(validateCfg({ rewards: [{ pattern: "line", ordinal: 1 }, { pattern: "line", ordinal: 1 }] }).ok).toBe(false);
    expect(validateCfg({ rewards: [{ pattern: "line", ordinal: 2 }] }).ok).toBe(false); // a 2nd needs a 1st
    expect(linesFor(everyHouse(), "line").map((l) => l.ordinal)).toEqual([1, 2, 3]);
  });
  test("marking: auto is the default, tap is cosmetic and is kept; anything else is refused", () => {
    expect(defaultCfg().mark).toBeUndefined();
    const t = validateCfg({ mark: "tap" }); expect(t.ok && t.cfg.mark).toBe("tap");
    const a = validateCfg({ mark: "auto" }, t.ok ? t.cfg : undefined); expect(a.ok && a.cfg.mark).toBeUndefined();
    expect(validateCfg({ mark: "sometimes" }).ok).toBe(false);
  });
  test("a random card from the plain generator behaves like a keyed one", () => {
    const rand = seededRand("plain"); const c = generateTicket(rand);
    for (const pat of ALL) expect(ticketCompletion(c, pat, shuffle75("plain"))).toBe(refCompletion(c, pat, shuffle75("plain")));
  });
});
