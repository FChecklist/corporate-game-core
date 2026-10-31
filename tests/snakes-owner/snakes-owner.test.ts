// Owner tests for Snakes, written from docs/SNAKES_RULES_BOOK.md (rules 1-47) and the owner numbers only.
import { describe, expect, test as bunTest, setDefaultTimeout } from "bun:test";
setDefaultTimeout(120_000);
const test = bunTest;
import { createHash } from "node:crypto";
import { newClock, start, pause, resume } from "../../packages/core/src";
import {
  snakesRules, ownerBoard, checkOwnerBoard, squareXY, squareKind, playersOn, standing, winnerOf, finalRanking, move, noteFor, reactionOf,
  WINDOW_MS, nextWindowAt, windowOpen, hasExtra, WAITING_ROOM_MS, TIME_LIMIT_CHOICES_MIN, timeLimitMsFor, DEFAULT_TIME_LIMIT_MS, REWARD_THROWS, OWNER_COUNTS,
  type Board, type SnakesState,
} from "../../packages/snakes/src";

const plainBoard: Board = { size: 100, snakes: {}, ladders: {} };
const running = start(newClock());
const gameIds = Array.from({ length: 20 }, (_, i) => `game-${i}-${createHash("sha256").update(String(i)).digest("hex").slice(0, 6)}`);
const mk = (n: number, setup: Record<string, unknown> = {}, board?: Board) => {
  const players = Array.from({ length: n }, (_, i) => `p${i}`);
  const fate = Object.fromEntries(players.map((p, i) => [p, i + 1]));
  return { players, s: snakesRules.init({ board: board ?? plainBoard, fate, ...setup }, players) as SnakesState };
};
const turn = (s: SnakesState, rolls: Record<string, number>, extra: Record<string, unknown> = {}, clock = running) => snakesRules.step(s, { type: "turn", rolls, ...extra } as any, 0, clock);
// independent reachability: exact finish, rolls 1..6
function reach(b: Board): boolean {
  const sp = b.specials ?? {}, nx = (s: number, r: number) => { const n = s + r; return n > 100 ? s : (b.snakes[n] ?? b.ladders[n] ?? n); };
  void sp;
  const can = new Set([100]); for (let c = true; c;) { c = false; for (let s = 1; s < 100; s++) if (!can.has(s) && [1, 2, 3, 4, 5, 6].some((r) => can.has(nx(s, r)))) { can.add(s); c = true; } }
  return can.size === 100;
}

describe("board R36-R43", () => {
  const T = 120_000;
  test("R37 squareXY boustrophedon from bottom-left", () => {
    expect(squareXY(1)).toEqual({ col: 0, row: 0 }); expect(squareXY(10)).toEqual({ col: 9, row: 0 });
    expect(squareXY(11)).toEqual({ col: 9, row: 1 }); expect(squareXY(20)).toEqual({ col: 0, row: 1 });
    expect(squareXY(21)).toEqual({ col: 0, row: 2 }); expect(squareXY(30)).toEqual({ col: 9, row: 2 });
    expect(squareXY(100)).toEqual({ col: 0, row: 9 });
    const cells = new Set(Array.from({ length: 100 }, (_, i) => { const c = squareXY(i + 1); return c.col + "," + c.row; })); expect(cells.size).toBe(100);
    for (let n = 1; n < 100; n++) { const a = squareXY(n), b = squareXY(n + 1); expect(Math.abs(a.col - b.col) + Math.abs(a.row - b.row)).toBe(1); }
  });
  test("R38 fixed counts and all 65 squares different, none on 1 or 100", () => {
    expect(OWNER_COUNTS).toEqual({ snakes: 30, ladders: 15, penalty: 10, reward: 10 });
    for (const id of gameIds) {
      const b = ownerBoard(id), sp = Object.entries(b.specials!);
      expect(b.size).toBe(100); expect(Object.keys(b.snakes).length).toBe(30); expect(Object.keys(b.ladders).length).toBe(15);
      expect(sp.filter(([, v]) => v.kind === "punishment").length).toBe(10); expect(sp.filter(([, v]) => v.kind === "reward").length).toBe(10);
      expect(sp.length).toBe(20);
      const all = [...Object.keys(b.snakes), ...Object.keys(b.ladders), ...sp.map(([q]) => q)].map(Number);
      expect(new Set(all).size).toBe(65); expect(all.some((q) => q === 1 || q === 100)).toBe(false);
    }
  });
  test("R39 all 45 lengths differ (>=3); longest snake 99->9, longest ladder 31->80", () => {
    for (const id of gameIds) {
      const b = ownerBoard(id);
      const lens = [...Object.entries(b.snakes).map(([f, t]) => +f - t), ...Object.entries(b.ladders).map(([f, t]) => t - +f)];
      expect(lens.length).toBe(45); expect(new Set(lens).size).toBe(45); expect(Math.min(...lens)).toBeGreaterThanOrEqual(3);
      expect(b.snakes[99]).toBe(9); expect(Math.max(...Object.entries(b.snakes).map(([f, t]) => +f - t))).toBe(90);
      expect(b.ladders[31]).toBe(80); expect(Math.max(...Object.entries(b.ladders).map(([f, t]) => t - +f))).toBe(49);
      for (const [f, t] of Object.entries(b.snakes)) expect(+f).toBeGreaterThan(t);
      for (const [f, t] of Object.entries(b.ladders)) expect(+f).toBeLessThan(t);
    }
  });
  test("R41 snake/ladder ends are plain squares (33 plain squares, ends may repeat)", () => {
    for (const id of gameIds) {
      const b = ownerBoard(id), act = new Set([1, 100, ...Object.keys(b.snakes).map(Number), ...Object.keys(b.ladders).map(Number), ...Object.keys(b.specials!).map(Number)]);
      expect(100 - act.size).toBe(33 + 0 * 1 + 0); // 100 - 65 - squares 1 and 100 = 33
      for (const t of [...Object.values(b.snakes), ...Object.values(b.ladders)]) { expect(act.has(t)).toBe(false); expect(t).toBeGreaterThanOrEqual(2); expect(t).toBeLessThanOrEqual(99); }
    }
  });
  test("R43 deterministic from game id; differs between ids", () => {
    for (const id of gameIds.slice(0, 10)) expect(JSON.stringify(ownerBoard(id))).toBe(JSON.stringify(ownerBoard(id)));
    expect(new Set(gameIds.map((i) => JSON.stringify(ownerBoard(i)))).size).toBeGreaterThan(15);
  });
  test("R43/R5 last square reachable from every square (independent check, 20 ids)", () => {
    for (const id of gameIds) { const b = ownerBoard(id); expect(reach(b)).toBe(true); expect(checkOwnerBoard(b)).toEqual([]); }
  });
  test("R43 checkOwnerBoard rejects broken boards", () => {
    const b = ownerBoard("x"), bad = (f: (c: Board) => void) => { const c = JSON.parse(JSON.stringify(b)) as Board; f(c); return checkOwnerBoard(c).length > 0; };
    expect(bad((c) => { c.size = 144; })).toBe(true);
    expect(bad((c) => { delete c.snakes[99]; })).toBe(true);
    expect(bad((c) => { delete c.ladders[31]; })).toBe(true);
    expect(bad((c) => { const k = Object.keys(c.specials!)[0]!; delete c.specials![+k]; })).toBe(true);
    expect(bad((c) => { const k = +Object.keys(c.specials!)[0]!; delete c.specials![k]; c.specials![1] = { kind: "reward" }; })).toBe(true);
  });
  test("R43 trap board is rejected: square 94-99 all snakes to 2 would trap", () => {
    const trap: Board = { size: 100, snakes: { 94: 2, 95: 2, 96: 2, 97: 2, 98: 2, 99: 2 }, ladders: {} };
    expect(reach(trap)).toBe(false); expect(checkOwnerBoard(trap)).toContain("nobody may be trapped");
  });
  test("R42 playersOn counts pawns per square", () => {
    const { s } = mk(4); s.pawns.p0!.at = 5; s.pawns.p1!.at = 5; s.pawns.p2!.at = 9;
    expect(playersOn(s)).toEqual({ 5: 2, 9: 1, 1: 1 });
  });
  test("R44 squareKind names each drawing", () => {
    const b = ownerBoard("kind"); expect(squareKind(b, 1)).toBe("start"); expect(squareKind(b, 100)).toBe("finish");
    expect(squareKind(b, 99)).toBe("snake-head"); expect(squareKind(b, 31)).toBe("ladder-foot");
    for (const [q, v] of Object.entries(b.specials!)) expect(squareKind(b, +q)).toBe(v.kind === "reward" ? "reward" : "penalty");
  });
  test("R36 one shared board for every player", () => {
    const { s, players } = mk(5); for (const p of players) expect(s.boards[p]).toBe(s.boards.p0);
  });
});

describe("moving R6-R11, R21, R30-R31, R40", () => {
  test("R6 pawn starts on 1", () => { const { s } = mk(3); for (const p of Object.values(s.pawns)) expect(p.at).toBe(1); });
  test("R6/R7 move by roll; ladder up, snake down", () => {
    const b: Board = { size: 100, snakes: { 20: 5 }, ladders: { 10: 40 } };
    expect(move(b, 1, 3)).toMatchObject({ to: 4 }); expect(move(b, 5, 5)).toMatchObject({ to: 40, ladder: true }); expect(move(b, 15, 5)).toMatchObject({ to: 5, snake: true });
  });
  test("R8 exact finish; overshoot not used; pass option finishes", () => {
    expect(move(plainBoard, 98, 3).to).toBe(98); expect(move(plainBoard, 98, 2).to).toBe(100); expect(move(plainBoard, 98, 6, true).to).toBe(100);
    const { s } = mk(1, {}, plainBoard); s.pawns.p0!.at = 98;
    expect(turn(s, { p0: 5 }).state.pawns.p0!.at).toBe(98);
    expect(turn(s, { p0: 2 }).state.pawns.p0!.finishedTurn).toBe(1);
  });
  test("R9 finished pawn stays finished", () => {
    const { s } = mk(2, {}, plainBoard); s.pawns.p0!.at = 98; let st = turn(s, { p0: 2, p1: 1 }).state;
    st = turn(st, { p0: 1, p1: 1 }).state; expect(st.pawns.p0!.at).toBe(100);
  });
  test("R10/R20 presence: no throw in window = stay, missed turn", () => {
    const { s } = mk(2, { mode: "presence" }, plainBoard);
    const r = turn(s, { p0: 4, p1: 4 }, { threw: ["p0"] }).state;
    expect(r.pawns.p0!.at).toBe(5); expect(r.pawns.p0!.missed).toBe(0); expect(r.pawns.p1!.at).toBe(1); expect(r.pawns.p1!.missed).toBe(1);
  });
  test("R10 fate mode: everyone throws by itself", () => {
    const { s } = mk(2, {}, plainBoard); const r = turn(s, { p0: 2, p1: 3 }).state; expect(r.pawns.p0!.at).toBe(3); expect(r.pawns.p1!.at).toBe(4);
  });
  test("R11/R25 paused: no turn is played, clocks frozen", () => {
    const { s } = mk(2, {}, plainBoard); const paused = pause(running, "organizer" as any, 1000);
    expect(paused.phase).toBe("paused");
    const r = turn(s, { p0: 3, p1: 3 }, { gameMs: 5000 }, paused);
    expect(r.state.pawns.p0!.at).toBe(1); expect(r.state.turn).toBe(0); expect(r.state.gameMs).toBe(0); expect(r.out).toEqual([]);
    const back = resume(paused, "organizer" as any, 61000); expect(back.phase).toBe("running"); expect(back.pausedMs).toBe(60000);
    expect(turn(s, { p0: 3, p1: 3 }, { gameMs: 5000 }, back).state.pawns.p0!.at).toBe(4);
  });
  test("R30/R40 reward square gives exactly 2 extra throws (hasExtra); extra used when taken", () => {
    expect(REWARD_THROWS).toBe(2);
    const b: Board = { size: 100, snakes: {}, ladders: {}, specials: { 5: { kind: "reward" } } };
    const { s } = mk(1, {}, b); let st = turn(s, { p0: 4 }).state;
    expect(st.pawns.p0!.extra).toBe(2); expect(hasExtra(st, "p0")).toBe(true);
    st = turn(st, { p0: 1 }).state; expect(st.pawns.p0!.extra).toBe(1); expect(hasExtra(st, "p0")).toBe(true);
    st = turn(st, { p0: 1 }).state; expect(hasExtra(st, "p0")).toBe(false);
    expect(noteFor({ ladder: false, snake: false, special: "reward", to: 5 })).toBe("Reward! 2 extra throws");
  });
  test("R31/R40 penalty square cuts the next throw, no missed mark", () => {
    const b: Board = { size: 100, snakes: {}, ladders: {}, specials: { 5: { kind: "punishment" } } };
    const { s } = mk(1, {}, b); let st = turn(s, { p0: 4 }).state; expect(st.pawns.p0!.at).toBe(5);
    st = turn(st, { p0: 3 }).state; expect(st.pawns.p0!.at).toBe(5); expect(st.pawns.p0!.missed).toBe(0);
    st = turn(st, { p0: 3 }).state; expect(st.pawns.p0!.at).toBe(8);
    expect(noteFor({ ladder: false, snake: false, special: "punishment", to: 5 })).toBe("Punishment! You lose your next throw");
  });
  test("R40 upgrade/downgrade squares are not used on the owner board", () => {
    for (const id of gameIds.slice(0, 10)) for (const v of Object.values(ownerBoard(id).specials!)) expect(["reward", "punishment"]).toContain(v.kind);
  });
  test("R34 notes", () => {
    expect(noteFor({ ladder: true, snake: false, to: 38 })).toBe("Ladder! Up to 38"); expect(noteFor({ ladder: false, snake: true, to: 12 })).toBe("Snake! Down to 12");
  });
  test("R47 reactions", () => {
    const f = { ladder: false, snake: false };
    expect(reactionOf({ ...f, snake: true })).toBe("snake_bite"); expect(reactionOf({ ...f, ladder: true })).toBe("ladder");
    expect(reactionOf({ ...f, special: "upgrade" })).toBe("upgrade"); expect(reactionOf({ ...f, special: "downgrade" })).toBe("downgrade");
    expect(reactionOf({ ...f, special: "reward" })).toBe("extra_throw"); expect(reactionOf({ ...f, special: "punishment" })).toBe("missed_turn");
    expect(reactionOf({ ...f, lost: true })).toBe("missed_turn"); expect(reactionOf({ ...f, finished: true })).toBe("finish"); expect(reactionOf({ ...f, roll: 6 })).toBe("six");
  });
});

describe("standing R22", () => {
  test("ahead/behind/same square/finishers/within", () => {
    const { s } = mk(5);
    s.pawns.p0!.at = 10; s.pawns.p1!.at = 20; s.pawns.p2!.at = 10; s.pawns.p3!.at = 3; s.pawns.p4!.at = 100; s.pawns.p4!.finishedTurn = 4;
    expect(standing(s, "p0")).toEqual({ ahead: 2, behind: 1, within: 1 });
    expect(standing(s, "p4")).toEqual({ ahead: 0, behind: 4, within: 0 });
    s.pawns.p1!.at = 99; expect(standing(s, "p4").behind).toBe(4); expect(standing(s, "p1").ahead).toBe(1);
  });
});

describe("prizes and ranking R12-R17, R24", () => {
  test("R12 milestone 75 goes to first on or past it", () => {
    const { s } = mk(2, {}, plainBoard); s.pawns.p1!.at = 70; const r = turn(s, { p0: 1, p1: 6 });
    expect(r.out).toContainEqual({ kind: "win", player: "p1", position: "milestone 75" });
  });
  test("R13 first five finishers win 1st..5th; game ends at the 5th", () => {
    const { s } = mk(7, {}, plainBoard); for (const p of Object.keys(s.pawns)) s.pawns[p]!.at = 99;
    const r = turn(s, Object.fromEntries(Object.keys(s.pawns).map((p) => [p, 1])));
    const wins = r.out.filter((o: any) => o.kind === "win" && o.position !== "milestone 75").map((o: any) => o.position);
    expect(wins).toEqual(["1st", "2nd", "3rd", "4th", "5th"]); expect(r.state.over).toBe(true); expect(r.out.at(-1)).toEqual({ kind: "end" });
  });
  test("R14 same-turn: higher square is moot at finish, then more ladders, fewer missed, then lower fate", () => {
    const { s } = mk(4, {}, plainBoard); for (const p of Object.keys(s.pawns)) s.pawns[p]!.at = 99;
    s.pawns.p0!.fate = 1; s.pawns.p1!.fate = 2; s.pawns.p2!.fate = 3; s.pawns.p3!.fate = 4;
    s.pawns.p3!.ladders = 2; s.pawns.p2!.missed = 0; s.pawns.p1!.missed = 3; s.pawns.p0!.missed = 3; s.pawns.p2!.ladders = 1; s.pawns.p1!.ladders = 1; s.pawns.p0!.ladders = 1;
    const r = turn(s, Object.fromEntries(Object.keys(s.pawns).map((p) => [p, 1])));
    expect(r.state.finishers).toEqual(["p3", "p2", "p0", "p1"]);
  });
  test("R15/R24 ranking: finishers in order, then by square/ladders/missed/fate; winnerOf = first", () => {
    const { s } = mk(5); s.finishers = ["p3", "p1"]; s.pawns.p3!.at = 100; s.pawns.p1!.at = 100;
    s.pawns.p0!.at = 50; s.pawns.p2!.at = 50; s.pawns.p4!.at = 60; s.pawns.p2!.ladders = 1;
    expect(finalRanking(s)).toEqual(["p3", "p1", "p4", "p2", "p0"]); expect(winnerOf(s)).toBe("p3");
  });
  test("R16/R17/R26 survivors: default 0 sends nobody out; with 2, front runners stay, finished not sent out, out come last", () => {
    const { s: s0 } = mk(4, { roundTurns: 1 }, plainBoard); expect(turn(s0, { p0: 1, p1: 2, p2: 3, p3: 4 }).state.out).toEqual([]);
    const { s } = mk(4, { survivors: 2, roundTurns: 1 }, plainBoard);
    const r = turn(s, { p0: 1, p1: 2, p2: 3, p3: 4 }); expect(r.state.out.sort()).toEqual(["p0", "p1"]);
    expect(finalRanking(r.state)).toEqual(["p3", "p2", "p1", "p0"]);
    const r2 = turn(r.state, { p0: 6, p1: 6, p2: 1, p3: 1 }); expect(r2.state.pawns.p0!.at).toBe(2); // out: no longer plays
    expect(finalRanking(r2.state).slice(0, 2)).toEqual(["p3", "p2"]);
  });
  test("R17 game ends when nobody is left in", () => {
    const { s } = mk(2, { survivors: 0, roundTurns: 1 }, plainBoard); s.pawns.p0!.at = 99; s.pawns.p1!.at = 99;
    expect(turn(s, { p0: 1, p1: 1 }).state.over).toBe(true);
  });
  test("R24 never tied: 300 seeds of random pawns, strict order by square, ladders, missed, fate", () => {
    for (let seed = 1; seed <= 300; seed++) {
      let x = seed * 2654435761 >>> 0; const rnd = (n: number) => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x % n; };
      const n = 2 + rnd(40), { s } = mk(n); const fates = Array.from({ length: n }, (_, i) => i + 1).sort(() => rnd(3) - 1);
      Object.keys(s.pawns).forEach((p, i) => { const w = s.pawns[p]!; w.at = 1 + rnd(4); w.ladders = rnd(2); w.missed = rnd(2); w.fate = fates[i]!; });
      const nf = rnd(Math.min(n, 5) + 1); s.finishers = Object.keys(s.pawns).slice(0, nf); for (const p of s.finishers) s.pawns[p]!.at = 100;
      const rk = finalRanking(s); expect(new Set(rk).size).toBe(n); expect(rk.length).toBe(n); expect(rk.slice(0, nf)).toEqual(s.finishers);
      for (let i = nf; i + 1 < n; i++) {
        const a = s.pawns[rk[i]!]!, b = s.pawns[rk[i + 1]!]!;
        const key = (w: typeof a) => [-w.at, -w.ladders, w.missed, w.fate]; const ka = key(a), kb = key(b);
        let c = 0; for (let k = 0; k < 4 && !c; k++) c = ka[k]! - kb[k]!; expect(c).toBeLessThan(0);
      }
      expect(winnerOf(s)).toBe(rk[0]);
    }
  });
  test("R24 sent-out players rank after everyone still in", () => {
    const { s } = mk(3); s.out = ["p2"]; s.pawns.p2!.at = 90; s.pawns.p0!.at = 3; s.pawns.p1!.at = 2; expect(finalRanking(s)).toEqual(["p0", "p1", "p2"]);
  });
});

describe("time R18, R20, R23, R25, R27, R45, R46", () => {
  test("R45 waiting room is exactly 120 s", () => expect(WAITING_ROOM_MS).toBe(120_000));
  test("R46 choices 7 or 8 only; others read as 8; default 8", () => {
    expect([...TIME_LIMIT_CHOICES_MIN]).toEqual([7, 8]);
    expect(timeLimitMsFor(7)).toBe(420_000); expect(timeLimitMsFor("7")).toBe(420_000); expect(timeLimitMsFor(8)).toBe(480_000);
    for (const v of [9, 10, 6, 0, -1, "abc", undefined, null, 7.5, 70]) expect(timeLimitMsFor(v)).toBe(480_000);
    expect(DEFAULT_TIME_LIMIT_MS).toBe(480_000);
    expect(mk(1).s.timeLimitMs).toBe(480_000); expect(mk(1, { timeLimitMinutes: "7" }).s.timeLimitMs).toBe(420_000); expect(mk(1, { timeLimitMinutes: 12 }).s.timeLimitMs).toBe(480_000);
  });
  test("R45 waiting room + play: 7 min -> 9:00, 8 min -> 10:00 (600 s)", () => {
    expect(WAITING_ROOM_MS + timeLimitMsFor(7)).toBe(540_000); expect(WAITING_ROOM_MS + timeLimitMsFor(8)).toBe(600_000);
  });
  test("R23 game ends at the time limit in game time (not before)", () => {
    for (const [m, lim] of [[7, 420_000], [8, 480_000]] as const) {
      const { s } = mk(2, { timeLimitMinutes: m }, plainBoard);
      expect(turn(s, { p0: 1, p1: 1 }, { gameMs: lim - 1 }).state.over).toBe(false);
      const r = turn(s, { p0: 1, p1: 1 }, { gameMs: lim }); expect(r.state.over).toBe(true); expect(r.out.at(-1)).toEqual({ kind: "end" });
    }
  });
  test("R23 default turn limit safety stop is 600", () => expect(mk(1).s.turnLimit).toBe(600));
  test("R20 window is 10 s per throw; next window opens 10 s after the last one opened", () => {
    expect(WINDOW_MS).toBe(10_000); expect(nextWindowAt(0)).toBe(10_000); expect(nextWindowAt(37_000)).toBe(47_000);
    expect(timeLimitMsFor(7) / WINDOW_MS).toBe(42); expect(timeLimitMsFor(8) / WINDOW_MS).toBe(48);
  });
  test("R27 window opens only after 10 s of game time and when settled", () => {
    expect(windowOpen({ settledMs: 0 }, 0, 9_999)).toBe(false); expect(windowOpen({ settledMs: 0 }, 0, 10_000)).toBe(true);
    expect(windowOpen({ settledMs: 5_000 }, 20_000, 40_000)).toBe(false); expect(windowOpen({ settledMs: 20_000 }, 20_000, 30_000)).toBe(true);
  });
  test("R27 step records settledMs = game time of the turn", () => {
    const { s } = mk(1, {}, plainBoard); expect(turn(s, { p0: 1 }, { gameMs: 12_000 }).state.settledMs).toBe(12_000);
  });
  test("R25 game time never runs backwards and a paused clock does not add to it", () => {
    const { s } = mk(1, {}, plainBoard); const a = turn(s, { p0: 1 }, { gameMs: 30_000 }).state;
    expect(turn(a, { p0: 1 }, { gameMs: 10_000 }).state.gameMs).toBe(30_000);
    const p = pause(running, "organizer" as any, 5); expect(turn(a, { p0: 1 }, { gameMs: 99_999_999 }, p).state).toBe(a);
  });
  test("R23 no more turns after game over", () => {
    const { s } = mk(1, {}, plainBoard); const o = turn(s, { p0: 1 }, { gameMs: 480_000 }).state; expect(turn(o, { p0: 1 }).state).toBe(o);
  });
});

describe("2000 players", () => {
  test("R23/R24 2000 players, nobody throws (presence): ends on time limit, ranking complete", () => {
    const n = 2000, { players, s: s0 } = mk(n, { timeLimitMinutes: 7, mode: "presence" });
    let s = s0; for (let t = 1; t <= 42 && !s.over; t++) s = turn(s, {}, { gameMs: t * WINDOW_MS, threw: [] }).state;
    expect(s.over).toBe(true); expect(s.gameMs).toBe(420_000); expect(s.pawns.p0!.missed).toBe(42);
    const rk = finalRanking(s); expect(rk.length).toBe(n); expect(new Set(rk).size).toBe(n); expect(rk[0]).toBe("p0"); // all equal: fate decides, lower wins
  });
  test("R24 2000 players with throws on the owner board: complete never-tied ranking", () => {
    const n = 2000, b = ownerBoard("big"), { players, s: s0 } = mk(n, { timeLimitMinutes: 7 }, b);
    let s = s0, x = 12345; const rnd = () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) % 6) + 1;
    for (let t = 1; t <= 42 && !s.over; t++) s = turn(s, Object.fromEntries(players.map((p) => [p, rnd()])), { gameMs: t * WINDOW_MS }).state;
    expect(s.gameMs).toBeLessThanOrEqual(420_000);
    const rk = finalRanking(s); expect(rk.length).toBe(n); expect(new Set(rk).size).toBe(n); expect(winnerOf(s)).toBe(rk[0]);
    expect(Object.values(playersOn(s)).reduce((a, c) => a + c, 0)).toBe(n);
    const st = standing(s, rk[0]!); expect(st.ahead + st.behind).toBeLessThanOrEqual(n - 1);
  });
});
