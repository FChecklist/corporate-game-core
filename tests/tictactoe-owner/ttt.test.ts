import { test, expect } from "bun:test";
import { createHash } from "node:crypto";
import * as T from "../../packages/tictactoe/src";
import { MANIFESTS } from "../../packages/manifest/src";
import { newClock, start } from "../../packages/core/src/modes";

const E: T.Board = Array(9).fill(null);
const run = (clock = start(newClock())) => clock;
const ids = (n: number) => Array.from({ length: n }, (_, i) => "p" + String(i).padStart(4, "0"));
const mk = (players: string[], fate: Record<string, number> = {}) => T.tttRules.init({ fate } as any, players) as T.TttState;
const step = (s: T.TttState, e: T.TttEvent, c = run()) => T.tttRules.step(s, e, 0, c);
const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

test("R01 X moves first, O second; O first refused", () => {
  expect(T.play(E, 0, "O")).toBeNull();
  const b = T.play(E, 0, "X")!; expect(b[0]).toBe("X");
  expect(T.play(b, 1, "X")).toBeNull(); // out of turn
  expect(T.play(b, 1, "O")![1]).toBe("O");
});
test("R01 taken square and out-of-range refused", () => {
  const b = T.play(E, 4, "X")!;
  expect(T.play(b, 4, "O")).toBeNull(); expect(T.play(b, 9, "O")).toBeNull(); expect(T.play(b, -1, "O")).toBeNull();
});
test("R01 all eight lines win", () => {
  for (const l of [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]]) {
    const b: T.Board = [...E]; l.forEach((i) => (b[i] = "O")); expect(T.boardResult(b)).toBe("O");
  }
});
test("R01 full board without a line is a draw; empty is running", () => {
  expect(T.boardResult(["X","O","X","X","O","O","O","X","X"])).toBe("draw");
  expect(T.boardResult(E)).toBeNull();
});
test("R01 no move after game is won", () => {
  let b: T.Board = E; for (const [i, m] of [[0,"X"],[3,"O"],[1,"X"],[4,"O"],[2,"X"]] as const) b = T.play(b, i, m)!;
  expect(T.boardResult(b)).toBe("X"); expect(T.play(b, 8, "O")).toBeNull();
});
test("R02 waiting room 120 s", () => expect(T.WAIT_SECONDS).toBe(120));
test("R03 three stages of 300 s", () => { expect(T.STAGES).toBe(3); expect(T.STAGE_SECONDS).toBe(300); });
test("R03 play 900 s (15:00) and total 1020 s (17:00)", () => {
  expect(T.STAGES * T.STAGE_SECONDS).toBe(900); expect((T as any).PLAY_SECONDS).toBe(900);
  expect(T.WAIT_SECONDS + T.STAGES * T.STAGE_SECONDS).toBe(1020); expect((T as any).TOTAL_SECONDS).toBe(1020);
});
test("R03 play time same for 2 and 2000 players (constants only)", () => {
  for (const n of [2, 2000]) expect(T.STAGES * T.STAGE_SECONDS).toBe(900);
});
test("R04 pause freezes: game and stageEnd events change nothing", () => {
  const s = mk(ids(4)); const paused = { ...newClock(), phase: "paused" as const, frozenAt: 5 };
  expect(step(s, { type: "game", a: "p0000", b: "p0001", winner: "a" }, paused).state).toBe(s);
  expect(step(s, { type: "stageEnd" }, paused).state).toBe(s);
  expect(step(s, { type: "stageEnd" }, paused).out).toEqual([]);
});
test("R04 pause then resume: events count again, pause time accumulated", async () => {
  const m = await import("../../packages/core/src/modes");
  let c = start(newClock()); c = m.pause(c, "host" as any, 1000); expect(c.phase).toBe("paused");
  c = m.resume(c, "host" as any, 4000); expect(c.phase).toBe("running"); expect(c.pausedMs).toBe(3000);
  const s = step(mk(ids(2)), { type: "game", a: "p0000", b: "p0001", winner: "a" }, c).state;
  expect(s.stats.p0000!.points).toBe(2);
});
test("R05 pairing: nearby points, no repeat opponent", () => {
  let s = mk(ids(4));
  s = step(s, { type: "game", a: "p0000", b: "p0001", winner: "a" }).state;
  s = step(s, { type: "game", a: "p0002", b: "p0003", winner: "a" }).state;
  const { pairs } = T.pairFree(s, ids(4));
  expect(pairs.length).toBe(2);
  const k = pairs.map((p) => [...p].sort().join()).sort();
  expect(k).toEqual(["p0000,p0002", "p0001,p0003"]);
});
test("R05 never the same opponent twice in a row (4 players, many games)", () => {
  let s = mk(ids(4)); const r = rng(7);
  for (let g = 0; g < 30; g++) {
    const { pairs } = T.pairFree(s, ids(4));
    for (const [a, b] of pairs) {
      expect(s.stats[a]?.lastOpp).not.toBe(b);
      s = step(s, { type: "game", a, b, winner: (["a", "b", "draw"] as const)[Math.floor(r() * 3)]! }).state;
    }
  }
});
test("R05 every free player paired exactly once", () => {
  const f = ids(10), { pairs, bye } = T.pairFree(mk(f), f);
  expect(bye).toBeNull(); expect(new Set(pairs.flat()).size).toBe(10);
});
test("R06 odd: one sits out, gets 1 point", () => {
  const s = mk(ids(5)); const { pairs, bye } = T.pairFree(s, ids(5));
  expect(pairs.length).toBe(2); expect(bye).not.toBeNull();
  const t = T.applyBye(s, bye!); expect(t.stats[bye!]!.points).toBe(1); expect(t.stats[bye!]!.stagePoints).toBe(1);
});
test("R06 bye is the lowest-ranked free player", () => {
  const f = ids(3), s = mk(f, { p0000: 1, p0001: 2, p0002: 3 });
  expect(T.pairFree(s, f).bye).toBe("p0002");
});
test("R06 bye once per stage per player: rotates", () => {
  const f = ids(3); let s = mk(f, { p0000: 1, p0001: 2, p0002: 3 }); const got: string[] = [];
  for (let i = 0; i < 3; i++) { const b = T.pairFree(s, f).bye!; got.push(b); s = T.applyBye(s, b); }
  expect(new Set(got).size).toBe(3);
});
test("R06 bye is a point, not a win", () => {
  const s = T.applyBye(mk(ids(3)), "p0001"); expect(s.stats.p0001!.wins).toBe(0);
});
test("R07 win 2, draw 1, loss 0", () => {
  expect([T.gamePoints("a", "a"), T.gamePoints("a", "b"), T.gamePoints("draw", "a"), T.gamePoints("draw", "b")]).toEqual([2, 0, 1, 1]);
  let s = step(mk(ids(2)), { type: "game", a: "p0000", b: "p0001", winner: "b" }).state;
  expect(s.stats.p0001).toMatchObject({ points: 2, wins: 1 }); expect(s.stats.p0000).toMatchObject({ points: 0, wins: 0 });
  s = step(s, { type: "game", a: "p0000", b: "p0001", winner: "draw" }).state;
  expect(s.stats.p0001!.points).toBe(3); expect(s.stats.p0001!.wins).toBe(1);
});
test("R07 X and O alternate between a player's games (module exposes a helper)", () => {
  expect(typeof (T as any).markFor).toBe("function"); // book: alternation is a rule; no code for it found
});
test("R08 move clock 10 s, sudden death 5 s", () => {
  expect(T.MOVE_SECONDS).toBe(10); expect(T.SUDDEN_SECONDS).toBe(5);
  expect(T.moveClockFor(false)).toBe(10); expect(T.moveClockFor(true)).toBe(5);
});
test("R08 missed move: opponent moves; both miss: draw", () => {
  expect(T.afterMissedMove(true, false)).toBe("opponent-moves");
  expect(T.afterMissedMove(true, true)).toBe("draw");
});
test("R09 game running at stage end = draw (1 point each)", () => {
  const s = step({ ...mk(ids(2)), stage: 3 }, { type: "stageEnd", running: [{ a: "p0000", b: "p0001" }] }).state;
  expect(s.stats.p0000!.points).toBe(1); expect(s.stats.p0001!.points).toBe(1);
});
test("R10 stage 1 keeps 50% rounded up, at least 1", () => {
  expect([T.keepAfter(1, 10), T.keepAfter(1, 11), T.keepAfter(1, 1), T.keepAfter(1, 2000)]).toEqual([5, 6, 1, 1000]);
  expect([T.keepAfter(2, 5), T.keepAfter(2, 1)]).toEqual([3, 1]);
});
test("R10 2000 players: 2000 -> 1000 -> 500 -> final", () => {
  const p = ids(2000); const fate: Record<string, number> = {}; p.forEach((x, i) => (fate[x] = i));
  let s = mk(p, fate); expect(s.alive.length).toBe(2000);
  s = step(s, { type: "stageEnd" }).state; expect(s.alive.length).toBe(1000); expect(s.stage).toBe(2);
  s = step(s, { type: "stageEnd" }).state; expect(s.alive.length).toBe(500); expect(s.stage).toBe(3);
  const r = step(s, { type: "stageEnd" }); expect(r.state.over).toBe(true); expect(r.state.ranking!.length).toBe(500);
  expect(r.out.filter((o) => o.kind === "win").length).toBe(5);
});
test("R10 cut sends bottom out with out events and fresh stagePoints", () => {
  let s = mk(ids(4)); s = step(s, { type: "game", a: "p0000", b: "p0001", winner: "a" }).state;
  s = step(s, { type: "game", a: "p0002", b: "p0003", winner: "a" }).state;
  const r = step(s, { type: "stageEnd" });
  expect(r.out.filter((o) => o.kind === "out").length).toBe(2); expect(r.state.alive.length).toBe(2);
  expect(r.state.out.every((o) => o.stage === 1)).toBe(true);
});
test("R10 final: top five win 1st-5th, then end", () => {
  let s = mk(ids(8)); s = { ...s, stage: 3 };
  const r = step(s, { type: "stageEnd" });
  expect(r.out.filter((o) => o.kind === "win").map((o: any) => o.position)).toEqual(["1st", "2nd", "3rd", "4th", "5th"]);
  expect(r.out.at(-1)!.kind).toBe("end");
});
test("R10 fewer than five alive: only that many win", () => {
  const r = step({ ...mk(ids(3)), stage: 3 }, { type: "stageEnd" });
  expect(r.out.filter((o) => o.kind === "win").length).toBe(3);
});
test("R10 no Claim button: golden 'You won', auto claim", () => {
  expect(T.tttRules.goldenButton).toBe("You won"); expect(T.tttRules.claimType).toBe("auto");
});
test("R10 five prize positions in manifest", () => {
  expect(MANIFESTS.tictactoe.prizePositions.length).toBe(5);
});
test("R11 order: points, wins, last-stage points, fate", () => {
  const st = (points: number, wins: number, stagePoints: number): T.Stat => ({ points, wins, stagePoints, byeStages: [] });
  const stats = { a: st(5, 1, 0), b: st(6, 0, 0), c: st(5, 2, 0), d: st(5, 2, 3), e: st(5, 2, 3), f: st(5, 2, 3) };
  const fate = { a: 0, b: 0, c: 0, d: 9, e: 4, f: 7 };
  expect(T.order({ stats, fate }, Object.keys(stats))).toEqual(["b", "e", "f", "d", "c", "a"]);
});
test("R11 lower fate wins", () => {
  expect(T.order({ stats: {}, fate: { x: 5, y: 2 } }, ["x", "y"])).toEqual(["y", "x"]);
});
test("R11 never tied: 250 random seeds, strict total order independent of input order", () => {
  for (let seed = 1; seed <= 250; seed++) {
    const r = rng(seed), n = 2 + Math.floor(r() * 40), p = ids(n), stats: Record<string, T.Stat> = {}, fate: Record<string, number> = {};
    const perm = [...p].sort(() => r() - 0.5); perm.forEach((x, i) => (fate[x] = i)); // fates distinct
    for (const x of p) stats[x] = { points: Math.floor(r() * 4), wins: Math.floor(r() * 3), stagePoints: Math.floor(r() * 3), byeStages: [] };
    const a = T.order({ stats, fate }, p), b = T.order({ stats, fate }, [...p].reverse());
    expect(a).toEqual(b); expect(new Set(a).size).toBe(n);
    for (let i = 1; i < n; i++) {
      const x = stats[a[i - 1]!]!, y = stats[a[i]!]!;
      const k = (q: T.Stat, f: number) => [-q.points, -q.wins, -q.stagePoints, f];
      const kx = k(x, fate[a[i - 1]!]!), ky = k(y, fate[a[i]!]!);
      expect(JSON.stringify(kx) === JSON.stringify(ky)).toBe(false);
      let c = 0; for (let j = 0; j < 4 && !c; j++) c = kx[j]! - ky[j]!; expect(c).toBeLessThan(0);
    }
  }
});
test("R11 fate numbers derived independently with SHA-256 are distinct and order uses them", () => {
  const p = ids(300), fate: Record<string, number> = {};
  for (const x of p) fate[x] = createHash("sha256").update("seed:" + x).digest().readUInt32BE(0);
  const o = T.order({ stats: {}, fate }, p);
  const exp = [...p].sort((a, b) => fate[a]! - fate[b]!);
  expect(o).toEqual(exp);
});
test("R12 points and wins carry over, stage points reset", () => {
  let s = mk(ids(2)); s = step(s, { type: "game", a: "p0000", b: "p0001", winner: "a" }).state;
  s = step(s, { type: "stageEnd" }).state;
  expect(s.stage).toBe(2); expect(s.alive).toEqual(["p0000"]);
  expect(s.stats.p0000).toMatchObject({ points: 2, wins: 1, stagePoints: 0 });
});
test("R12 stage points count only in current stage, decide ties", () => {
  const stats: Record<string, T.Stat> = { a: { points: 4, wins: 2, stagePoints: 1, byeStages: [] }, b: { points: 4, wins: 2, stagePoints: 2, byeStages: [] } };
  expect(T.order({ stats, fate: { a: 0, b: 1 } }, ["a", "b"])).toEqual(["b", "a"]);
});
test("R13 standing: place and places to the cut line", () => {
  const stats: Record<string, T.Stat> = {}; const alive = ids(10); alive.forEach((x, i) => (stats[x] = { points: 10 - i, wins: 0, stagePoints: 0, byeStages: [] }));
  const s = { stats, fate: {}, alive, stage: 1 };
  expect(T.standing(s, "p0000")).toMatchObject({ place: 1, keep: 5, safe: true, placesToLine: 4 });
  expect(T.standing(s, "p0004")).toMatchObject({ place: 5, safe: true, placesToLine: 0 });
  expect(T.standing(s, "p0005")).toMatchObject({ place: 6, safe: false, placesToLine: 1 });
});
test("R14 reactions: 2.5 s show, gap 22 s, max 15", () => {
  expect(T.REACTION_SHOW_MS).toBe(2500); expect(T.REACTION_GAP_MS).toBe(22000); expect(T.REACTION_MAX).toBe(15);
});
test("R14 reactionGate gap and cap", () => {
  const g = T.reactionGate(); expect(g.allow(0)).toBe(true); expect(g.allow(21_999)).toBe(false); expect(g.allow(22_000)).toBe(true);
  let n = 2; for (let t = 44_000; t < 2_000_000; t += 22_000) if (g.allow(t)) n++;
  expect(n).toBe(15);
});
test("R15 cap 2000 and no organizer final say", () => {
  expect(MANIFESTS.tictactoe.caps.auto).toBe(2000); expect(MANIFESTS.tictactoe.organizerFinalSay).toBe(false);
});
test("R15 no setup fields (only prize text and start mode)", () => expect(T.setupFields.length).toBe(0));
test("R15 2000-player pairing: all paired, no bye, deterministic", () => {
  const p = ids(2000), r = T.pairFree(mk(p), p);
  expect(r.pairs.length).toBe(1000); expect(r.bye).toBeNull(); expect(new Set(r.pairs.flat()).size).toBe(2000);
  expect(T.pairFree(mk(p), p)).toEqual(r);
});
test("R15 2001 players: exactly one bye", () => {
  const p = ids(2001), r = T.pairFree(mk(p), p); expect(r.bye).not.toBeNull(); expect(r.pairs.length).toBe(1000);
});
