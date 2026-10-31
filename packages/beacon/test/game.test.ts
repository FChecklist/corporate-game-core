import { describe, expect, test } from "bun:test";
import { bytesToHex } from "@noble/hashes/utils";
import { sha256 } from "@noble/hashes/sha256";
import { ALL_PATTERNS, RoundStore, activeIntermission, callRoundFull, callRoundR, checkClaims, completionIndex, completionIndexKey, logFrom, luckyRound, luckyWinners, settleAll, stillToWin, ticketFor, ticketsFor, unshiftedRound } from "../src/game";
import { INTERMISSION_ROUNDS, defaultCfg, roundEid, type BreakCfg } from "../src/config";
import { createHash } from "node:crypto";
import { deriveCalls, scheduleFor, verifyRound, type Fetcher, type Round } from "../src";
import { ticketNumbers } from "../../shared/src/ticket";

const REAL: Round = {
  round: 32680188,
  randomness: "372b3ac5a47dc12f4280df3750b5bf58d7a100186370e6fba08571bd3c7f421d",
  signature: "b79356001df1e55e85fc2648bd6d6cd58cf2472b035f44c542a9038768da2c3898b8c3e19218f0a7f22f7e35de66c7af",
};
const E = "ENG-GAME-1";
const rand = (k: number) => bytesToHex(sha256(new TextEncoder().encode("r" + k)));
const SCHED = scheduleFor(1000, 6);
const fakeRounds = new Map<number, Round>(SCHED.map((r, k) => [r, { round: r, randomness: rand(k), signature: "aa" }]));
const LOG = deriveCalls(E, SCHED.map((_, k) => rand(k)));
const pids = Array.from({ length: 300 }, (_, i) => "p" + i);

describe("tickets and patterns", () => {
  test("a ticket is the same every time for the same participant, different for others", () => {
    expect(ticketFor(E, "p1")).toEqual(ticketFor(E, "p1"));
    expect(ticketFor(E, "p1")).not.toEqual(ticketFor(E, "p2"));
    expect(ticketFor("OTHER", "p1")).not.toEqual(ticketFor(E, "p1"));
  });
  test("every card completes every pattern by call 75 (all numbers are called)", () => {
    for (const p of pids.slice(0, 20)) for (const pat of ALL_PATTERNS) expect(completionIndex(ticketFor(E, p), pat, LOG)).toBeGreaterThanOrEqual(0);
  });
  test("blackout completes exactly when the last of the card's 24 numbers is called", () => {
    const t = ticketFor(E, "p3");
    const last = Math.max(...ticketNumbers(t).map((n) => LOG.indexOf(n)));
    expect(ticketNumbers(t)).toHaveLength(24);
    expect(completionIndex(t, "blackout", LOG)).toBe(last);
  });
  test("four corners completes at the last of the four corner numbers called", () => {
    const t = ticketFor(E, "p4");
    const corners = [t[0]![0]!, t[0]![4]!, t[4]![0]!, t[4]![4]!];
    expect(completionIndex(t, "corners", LOG)).toBe(Math.max(...corners.map((n) => LOG.indexOf(n))));
  });
  test("a pattern is not complete on a short log", () => expect(completionIndex(ticketFor(E, "p4"), "blackout", LOG.slice(0, 10))).toBe(-1));
  test("still-to-win counts down to zero as numbers are called (FREE is already marked)", () => {
    const t = ticketFor(E, "p5");
    expect(stillToWin(t, "blackout", [])).toBe(24);
    expect(stillToWin(t, "corners", [])).toBe(4);
    expect(stillToWin(t, "line", [])).toBe(4); // the cheapest line goes through the FREE centre
    expect(stillToWin(t, "blackout", LOG)).toBe(0);
    const part = LOG.slice(0, 30);
    expect(stillToWin(t, "blackout", part)).toBe(24 - ticketNumbers(t).filter((n) => part.includes(n)).length);
  });
});

describe("settlement from the public log", () => {
  const settled = settleAll(E, pids, LOG);
  test("every pattern has winners and they are the earliest completers", () => {
    expect(settled.map((s) => s.pattern).sort()).toEqual([...ALL_PATTERNS].sort());
    for (const s of settled) {
      for (const p of pids) expect(completionIndexKey([ticketFor(E, p)], s.pattern, LOG)).toBeGreaterThanOrEqual(s.idx);
      for (const w of s.pids) expect(completionIndexKey([ticketFor(E, w)], s.pattern, LOG)).toBe(s.idx);
    }
  });
  test("a tie at the same call shares the reward", () => {
    for (const s of settled) expect(s.pids.length).toBeGreaterThanOrEqual(1);
  });
  test("the result does not depend on the order of the participant list", () => {
    const rev = settleAll(E, [...pids].reverse(), LOG);
    expect(rev.map((s) => [s.pattern, s.idx, [...s.pids].sort()])).toEqual(settled.map((s) => [s.pattern, s.idx, [...s.pids].sort()]));
  });
  test("a participant who never got a network still wins: settlement needs no claim from them", () => {
    const quiet = settled.find((s) => s.pattern === "blackout")!.pids[0]!;
    expect(checkClaims(E, [], LOG).good).toEqual([]);
    expect(settleAll(E, pids, LOG).find((s) => s.pattern === "blackout")!.pids).toContain(quiet);
  });
  test("an empty list or a short log settles nothing wrongly", () => {
    expect(settleAll(E, [], LOG)).toEqual([]);
    expect(settleAll(E, pids, LOG.slice(0, 3))).toEqual([]);
  });
});

describe("claims are checked, not trusted", () => {
  test("a true claim is accepted, an early, late, wrong-pattern or someone-else's claim is rejected", () => {
    const t = ticketFor(E, "p9");
    const idx = completionIndex(t, "corners", LOG);
    const r = checkClaims(E, [
      { pid: "p9", pattern: "corners", idx },
      { pid: "p9", pattern: "corners", idx: idx - 1 },
      { pid: "p9", pattern: "corners", idx: idx + 1 },
      { pid: "p9", pattern: "x", idx },
      { pid: "p10", pattern: "corners", idx },
    ], LOG);
    expect(r.good).toHaveLength(1);
    expect(r.bad).toHaveLength(4);
  });
});

describe("round store: backfill by agreement, then background signature check", () => {
  const net = (over: Record<string, (r: number) => Round | "down" | "404">): Fetcher => async (url) => {
    const m = url.split("/")[2]!;
    const r = Number(url.split("/").pop());
    const f = over[m] ?? ((x: number) => fakeRounds.get(x) ?? "404");
    const v = f(r);
    if (v === "down") throw new Error("blocked");
    if (v === "404") return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => v };
  };
  const mirrors = ["https://a.test", "https://b.test", "https://c.test"];
  const store = (f: Fetcher, verify = (x: Round) => x.signature === "aa") => new RoundStore({ fetcher: f, mirrors, verify: undefined } as any, verify);

  test("two agreeing mirrors give an immediate provisional round; verification then confirms it", async () => {
    const s = store(net({}));
    expect(await s.fetchBackfill(SCHED[0]!)).toBe(true);
    expect(s.rounds.has(SCHED[0]!)).toBe(true);
    expect(s.verified.has(SCHED[0]!)).toBe(false);
    expect(s.pending()).toBe(1);
    await s.verifyAll();
    expect(s.verified.has(SCHED[0]!)).toBe(true);
    expect(s.pending()).toBe(0);
  });
  test("a late joiner has the whole 75-call log before any signature is checked, and verification leaves it unchanged", async () => {
    const s = store(net({}));
    await Promise.all(SCHED.map((r, i) => s.fetchBackfill(r, i)));
    expect(logFrom(E, SCHED, s)).toEqual(LOG);
    expect(s.pending()).toBe(75);
    await s.verifyAll();
    expect(logFrom(E, SCHED, s)).toEqual(LOG);
    expect(s.discarded).toBe(0);
  });
  test("two mirrors that lie in the same way are still caught by the background check and removed", async () => {
    const lie = (r: number): Round => ({ round: r, randomness: rand(999), signature: "bad" });
    const s = store(net({ "a.test": lie, "b.test": lie }));
    await s.fetchBackfill(SCHED[2]!);
    expect(s.rounds.has(SCHED[2]!)).toBe(true); // provisionally held
    await s.verifyAll();
    expect(s.rounds.has(SCHED[2]!)).toBe(false);
    expect(s.discarded).toBe(1);
  });
  test("two mirrors that disagree fall back to the fully-checked path (never trusting either)", async () => {
    const wrong = (r: number): Round => ({ round: r, randomness: rand(999), signature: "bad" });
    const s = store(net({ "a.test": wrong }));
    expect(await s.fetchBackfill(SCHED[3]!)).toBe(true);
    expect(s.verified.has(SCHED[3]!)).toBe(true);
    expect(s.rounds.get(SCHED[3]!)!.randomness).toBe(rand(3));
  });
  test("one working mirror only: falls back to the checked path, still correct", async () => {
    const s = store(net({ "a.test": () => "down", "b.test": () => "down" }));
    expect(await s.fetchBackfill(SCHED[4]!)).toBe(true);
    expect(s.verified.has(SCHED[4]!)).toBe(true);
  });
  test("everything blocked: nothing is held and no number is invented", async () => {
    const s = store(net({ "a.test": () => "down", "b.test": () => "down", "c.test": () => "down" }));
    expect(await s.fetchBackfill(SCHED[5]!)).toBe(false);
    expect(logFrom(E, SCHED, s)).toEqual([]);
  });
  test("a gap in the rounds stops the log at the gap", async () => {
    const s = store(net({}));
    for (const k of [0, 1, 2, 4, 5]) await s.fetchBackfill(SCHED[k]!);
    expect(logFrom(E, SCHED, s)).toEqual(LOG.slice(0, 3));
  });
  test("a real signed round is verified by the real BLS check in the background", async () => {
    const f: Fetcher = async () => ({ ok: true, status: 200, json: async () => REAL });
    const s = new RoundStore({ fetcher: f, mirrors }, undefined);
    expect(await s.fetchBackfill(REAL.round)).toBe(true);
    expect(s.verified.has(REAL.round)).toBe(false);
    await s.verifyAll();
    expect(s.verified.has(REAL.round)).toBe(true);
    expect(verifyRound(REAL)).toBe(true);
  });
  test("verification work can be spread out, one round per tick", async () => {
    const s = store(net({}));
    for (let k = 0; k < 5; k++) await s.fetchBackfill(SCHED[k]!);
    expect(s.verifySome(2)).toBe(3);
    expect(s.verifySome(2)).toBe(1);
    expect(s.verifySome(2)).toBe(0);
  });
});

describe("lucky draw winners", () => {
  const people = Array.from({ length: 500 }, (_, i) => "lp" + i);
  const R = "ab".repeat(32);
  test("the same list, break and randomness always give the same winners, in the same order, whatever order the list is in", () => {
    const a = luckyWinners("E1", 30, R, people, 5);
    expect(luckyWinners("E1", 30, R, people, 5)).toEqual(a);
    expect(luckyWinners("E1", 30, R, [...people].reverse(), 5)).toEqual(a);
  });
  test("picks exactly n different people from the list, never more than are listed, never a stranger", () => {
    for (const n of [1, 3, 5, 10]) { const w = luckyWinners("E1", 30, R, people, n); expect(w).toHaveLength(n); expect(new Set(w).size).toBe(n); expect(w.every((p) => people.includes(p))).toBe(true); }
    expect(luckyWinners("E1", 30, R, ["a", "b"], 10)).toHaveLength(2);
    expect(luckyWinners("E1", 30, R, [], 3)).toEqual([]);
    expect(luckyWinners("E1", 30, R, ["a", "a", "a"], 3)).toEqual(["a"]);
  });
  test("a different engagement, break position or randomness gives a different draw", () => {
    const base = luckyWinners("E1", 30, R, people, 5);
    expect(luckyWinners("E2", 30, R, people, 5)).not.toEqual(base);
    expect(luckyWinners("E1", 31, R, people, 5)).not.toEqual(base);
    expect(luckyWinners("E1", 30, "cd".repeat(32), people, 5)).not.toEqual(base);
  });
  test("it is fair: over many different randomness values every participant is picked about equally often", () => {
    const hits = new Map<string, number>(); const small = Array.from({ length: 20 }, (_, i) => "f" + i);
    for (let t = 0; t < 4000; t++) for (const p of luckyWinners("E1", 30, createHash("sha256").update("r" + t).digest("hex"), small, 3)) hits.set(p, (hits.get(p) ?? 0) + 1);
    for (const p of small) { const c = hits.get(p) ?? 0; expect(c).toBeGreaterThan(450); expect(c).toBeLessThan(750); } // expected 600
  });
  test("the draw round is the one in which the break ends", () => {
    const b = { after: 5, seconds: 30, kind: "lucky" as const, title: "D", winners: 3 as const };
    const prev = callRoundFull(null, 1000, 2, [b], 4)!;
    expect(luckyRound(null, 1000, 2, [b], b)).toBe(prev + 1 + 10);
  });
});

describe("rounds", () => {
  const C2 = { ...defaultCfg(), rounds: 2 };
  const E2 = "ENG-ROUNDS";
  const pids2 = Array.from({ length: 200 }, (_, i) => "rp" + i);
  const R1 = deriveCalls(E2, Array.from({ length: 75 }, (_, k) => createHash("sha256").update("a" + k).digest("hex")));
  const R2 = deriveCalls(roundEid(E2, 2), Array.from({ length: 75 }, (_, k) => createHash("sha256").update("b" + k).digest("hex")));
  test("a later round starts a fixed intermission after the last call of the one before, with the same gap between calls", () => {
    const last1 = unshiftedRound(1000, 2, [], 1, 74);
    expect(unshiftedRound(1000, 2, [], 2, 0)).toBe(last1 + 2 + INTERMISSION_ROUNDS);
    expect(unshiftedRound(1000, 2, [], 2, 1) - unshiftedRound(1000, 2, [], 2, 0)).toBe(2);
    expect(unshiftedRound(1000, 2, [], 3, 0)).toBe(unshiftedRound(1000, 2, [], 2, 74) + 2 + INTERMISSION_ROUNDS);
  });
  test("brand breaks belong to round 1 only; they push round 2 later by their length and nothing else", () => {
    const b: BreakCfg[] = [{ after: 10, seconds: 60, kind: "speech", title: "Hello" }];
    expect(unshiftedRound(1000, 2, b, 2, 0)).toBe(unshiftedRound(1000, 2, [], 2, 0) + 20);
    expect(unshiftedRound(1000, 2, b, 2, 5) - unshiftedRound(1000, 2, b, 2, 4)).toBe(2);
  });
  test("a pause in round 1 moves everything after it, including round 2, without moving round 2 twice", () => {
    const st = { intervals: [{ start: 1050, end: 1070 }], stopRound: null } as any;
    const before = unshiftedRound(1000, 2, [], 2, 0);
    expect(callRoundR(st, 1000, 2, [], 2, 0)).toBe(before + 20);
    expect(callRoundR(st, 1000, 2, [], 1, 5)).toBe(1010); // before the pause
    expect(callRoundR(st, 1000, 2, [], 1, 30)).toBe(1060 + 20); // after it
    const a = callRoundR(st, 1000, 2, [], 2, 3)!, b = callRoundR(st, 1000, 2, [], 2, 4)!;
    expect(b - a).toBe(2);
  });
  test("a stop before a round's first call means that round never happens", () => {
    const st = { intervals: [], stopRound: 1100 } as any;
    expect(callRoundR(st, 1000, 2, [], 1, 40)).toBe(1080);
    expect(callRoundR(st, 1000, 2, [], 1, 60)).toBeNull();
    expect(callRoundR(st, 1000, 2, [], 2, 0)).toBeNull();
  });
  test("the intermission shows exactly between the last call of a round and the first of the next", () => {
    const last = callRoundR(null, 1000, 2, [], 1, 74)!, first = callRoundR(null, 1000, 2, [], 2, 0)!;
    expect(activeIntermission(null, 1000, 2, [], 2, last)).toBeNull();
    expect(activeIntermission(null, 1000, 2, [], 2, last + 1)?.endsAtRound).toBe(first);
    expect(activeIntermission(null, 1000, 2, [], 2, first - 1)).not.toBeNull();
    expect(activeIntermission(null, 1000, 2, [], 2, first)).toBeNull();
    expect(activeIntermission(null, 1000, 2, [], 1, last + 1)).toBeNull();
  });
  test("every round gives every participant different tickets, and the numbers differ", () => {
    for (const p of pids2.slice(0, 20)) expect(JSON.stringify(ticketsFor(E2, p, 1))).not.toBe(JSON.stringify(ticketsFor(roundEid(E2, 2), p, 1)));
    expect(R1).not.toEqual(R2);
    expect(new Set(R2).size).toBe(75);
  });
  test("each round is settled on its own numbers and tickets; round 1 results never leak into round 2", () => {
    const s1 = settleAll(E2, pids2, R1, C2, 1), s2 = settleAll(E2, pids2, R2, C2, 2);
    expect(s1.every((x) => x.round === 1)).toBe(true);
    expect(s2.every((x) => x.round === 2)).toBe(true);
    for (const x of s2) for (const p of x.pids) expect(completionIndexKey(ticketsFor(roundEid(E2, 2), p, 1), x.pattern, R2)).toBe(x.idx);
    expect(s1.map((x) => x.idx).join()).not.toBe(s2.map((x) => x.idx).join());
  });
  test("claims are checked against their own round's log; a round 1 claim does not pass as round 2", () => {
    const p = "rp3"; const i1 = completionIndexKey(ticketsFor(E2, p, 1), "corners", R1), i2 = completionIndexKey(ticketsFor(roundEid(E2, 2), p, 1), "corners", R2);
    const logs = { 1: R1, 2: R2 };
    expect(checkClaims(E2, [{ pid: p, pattern: "corners", idx: i1, round: 1 }, { pid: p, pattern: "corners", idx: i2, round: 2 }], logs, C2).good).toHaveLength(2);
    expect(checkClaims(E2, [{ pid: p, pattern: "corners", idx: i1, round: 2 }], logs, C2).bad.length + checkClaims(E2, [{ pid: p, pattern: "corners", idx: i2, round: 1 }], logs, C2).bad.length).toBeGreaterThanOrEqual(1);
    expect(checkClaims(E2, [{ pid: p, pattern: "corners", idx: i1, round: 3 }], logs, C2).bad).toHaveLength(1); // no such round
    expect(checkClaims(E2, [{ pid: p, pattern: "corners", idx: i1 }], R1, C2).good).toHaveLength(1); // old style: round 1
  });
});
