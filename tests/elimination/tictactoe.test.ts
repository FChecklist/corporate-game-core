import { describe, expect, test } from "bun:test";
import { boardResult, play, boardWinner, bracket, gamePoints, ranking, tttRules, MOVE_CLOCKS, MAX_GAMES, type Board } from "../../packages/tictactoe/src";
import { MANIFESTS } from "../../packages/manifest/src";
import { running, paused, players } from "./helpers";
const E = (): Board => Array(9).fill(null);
const mk = (s: string): Board => [...s].map((c) => (c === "X" || c === "O" ? c : null));
describe("TTT1-TTT3 one game", () => {
  test("TTT1 nine squares, X moves first", () => {
    expect(E().length).toBe(9);
    expect(play(E(), 0, "O")).toBeNull();
    expect(play(E(), 0, "X")![0]).toBe("X");
  });
  test("TTT1 O moves second, then X again", () => {
    const b1 = play(E(), 0, "X")!, b2 = play(b1, 1, "O")!;
    expect(b2[1]).toBe("O");
    expect(play(b2, 2, "O")).toBeNull();
    expect(play(b2, 2, "X")).not.toBeNull();
  });
  test("TTT2 a taken square is refused", () => expect(play(mk("X........"), 0, "O")).toBeNull());
  test("TTT2 a square not on the board is refused", () => {
    for (const sq of [-1, 9, 1.5, NaN]) expect(play(E(), sq, "X"), String(sq)).toBeNull();
  });
  test("TTT2 a move out of turn is refused", () => expect(play(mk("X........"), 4, "X")).toBeNull());
  test("TTT2 nothing moves after the game is decided", () => expect(play(mk("XXXOO...."), 8, "O")).toBeNull());
  test("TTT3 three in a row, column or diagonal wins", () => {
    const lines = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
    for (const l of lines) for (const m of ["X", "O"] as const) { const b = E(); l.forEach((i) => (b[i] = m)); expect(boardResult(b), l.join() + m).toBe(m); }
  });
  test("TTT3 a full board with no three in a row is a draw", () => expect(boardResult(mk("XOXXOOOXX"))).toBe("draw"));
  test("TTT3 a game still going has no result", () => expect(boardResult(mk("XO......."))).toBeNull());
});
describe("TTT4-TTT7 one board between two players", () => {
  const fate = { a: 5, b: 2 };
  test("TTT4 the first game with a winner ends the board", () => {
    expect(boardWinner([{ winner: "a" }], fate)).toBe("a");
    expect(boardWinner([{ winner: "draw" }, { winner: "b" }], fate)).toBe("b");
    expect(boardWinner([{ winner: "draw" }, { winner: "draw" }, { winner: "a" }], fate)).toBe("a");
  });
  test("TTT5 a drawn game is replayed, up to three games in all", () => {
    expect(MAX_GAMES).toBe(3);
    expect(boardWinner([], fate)).toBeNull();
    expect(boardWinner([{ winner: "draw" }], fate)).toBeNull();
    expect(boardWinner([{ winner: "draw" }, { winner: "draw" }], fate)).toBeNull();
  });
  test("TTT6 three draws: the lower fate number wins", () => {
    const d = [{ winner: "draw" as const }, { winner: "draw" as const }, { winner: "draw" as const }];
    expect(boardWinner(d, { a: 5, b: 2 })).toBe("b");
    expect(boardWinner(d, { a: 1, b: 2 })).toBe("a");
  });
  test("TTT7 two clock-outs in a row lose the board at once", () => {
    expect(boardWinner([], fate, "a")).toBe("b");
    expect(boardWinner([{ winner: "draw" }], fate, "b")).toBe("a");
  });
});
describe("TTT8-TTT10 the knockout", () => {
  const names = (n: number) => players(n);
  test("TTT8 every player is an entrant, places are the next power of two", () => {
    for (const n of [2, 3, 4, 5, 7, 8, 9, 16, 17]) {
      const r1 = bracket(names(n)).flat(), size = 2 ** Math.ceil(Math.log2(n));
      expect(r1.length, "n=" + n).toBe(size);
      expect(r1.filter(Boolean).sort(), "n=" + n).toEqual(names(n).sort());
    }
  });
  test("TTT8 byes only fill empty places and two byes never meet", () => {
    for (let n = 2; n <= 40; n++) for (const pair of bracket(names(n))) expect(pair.some(Boolean), "n=" + n).toBe(true);
  });
  test("TTT8 a bye wins without playing", () => {
    const s = tttRules.init({}, names(3), 0);
    const bye = s.matches[0]!.filter((m) => !m.a || !m.b);
    expect(bye.length).toBe(1);
    expect(bye[0]!.winner).toBe(bye[0]!.a || bye[0]!.b);
  });
  test("TTT9 winners move up and the last winner is the champion who wins with 'You won'", () => {
    const s0 = tttRules.init({}, names(2), 0), m = s0.matches[0]![0]!;
    const r = tttRules.step(s0, { type: "matchResult", round: 1, index: 0, winner: m.a!, pointsA: 2, pointsB: 0 }, 0, running());
    expect(r.state.over).toBe(true);
    expect(r.state.champion).toBe(m.a!);
    expect(r.out).toContainEqual({ kind: "win", player: m.a!, position: "1st" });
    expect(tttRules.goldenButton).toBe("You won");
    expect(tttRules.claimType).toBe("auto");
  });
  test("TTT10 the loser is out and a later match opens when both earlier matches are finished", () => {
    const s0 = tttRules.init({}, names(4), 0), [m0, m1] = s0.matches[0]!;
    const r1 = tttRules.step(s0, { type: "matchResult", round: 1, index: 0, winner: m0!.a!, pointsA: 2, pointsB: 0 }, 0, running());
    expect(r1.out).toContainEqual(expect.objectContaining({ kind: "out", player: m0!.b }));
    expect(r1.state.matches.length).toBe(1);
    const r2 = tttRules.step(r1.state, { type: "matchResult", round: 1, index: 1, winner: m1!.b!, pointsA: 0, pointsB: 2 }, 0, running());
    expect(r2.state.matches.length).toBe(2);
    expect(r2.state.matches[1]![0]).toMatchObject({ a: m0!.a, b: m1!.b });
  });
  test("TTT10 a result for a decided match changes nothing", () => {
    const s0 = tttRules.init({}, names(4), 0), m0 = s0.matches[0]![0]!;
    const r1 = tttRules.step(s0, { type: "matchResult", round: 1, index: 0, winner: m0.a!, pointsA: 2, pointsB: 0 }, 0, running());
    const r2 = tttRules.step(r1.state, { type: "matchResult", round: 1, index: 0, winner: m0.b!, pointsA: 0, pointsB: 2 }, 0, running());
    expect(r2.state).toEqual(r1.state);
    expect(r2.out).toEqual([]);
  });
  test("TTT10 a result naming someone who is not in the match changes nothing", () => {
    const s0 = tttRules.init({}, names(4), 0);
    const r = tttRules.step(s0, { type: "matchResult", round: 1, index: 0, winner: "stranger", pointsA: 2, pointsB: 0 }, 0, running());
    expect(r.state).toEqual(s0);
    expect(r.out).toEqual([]);
  });
});
describe("TTT11-TTT12 points and ranking", () => {
  test("TTT11 a game won gives 2 points, a draw 1, a forfeit counts as a win for the other", () => {
    expect(gamePoints("a", "a")).toBe(2); expect(gamePoints("a", "b")).toBe(0);
    expect(gamePoints("draw", "a")).toBe(1); expect(gamePoints("draw", "b")).toBe(1);
  });
  test("TTT12 order: round reached, then total points, then last match points, then lower fate", () => {
    const r = ranking({ reached: { a: 3, b: 3, c: 2, d: 2, e: 2, f: 1 }, points: { a: 4, b: 6, c: 4, d: 4, e: 4, f: 0 }, lastPoints: { a: 2, b: 2, c: 2, d: 1, e: 1, f: 0 }, fate: { a: 1, b: 2, c: 3, d: 9, e: 4, f: 5 } });
    expect(r).toEqual(["b", "a", "c", "e", "d", "f"]);
  });
  test("TTT12 every rank is unique", () => {
    const reached = Object.fromEntries(players(8).map((p) => [p, 1]));
    const fate = Object.fromEntries(players(8).map((p, i) => [p, 8 - i]));
    const r = ranking({ reached, points: {}, lastPoints: {}, fate });
    expect(new Set(r).size).toBe(8);
    expect(r[0]).toBe("p8");
  });
  test("TTT12 places 1 to 5 are named", () => expect(tttRules.prizePositions({})).toEqual(["1st", "2nd", "3rd", "4th", "5th"]));
});
describe("TTT13-TTT14 settings and clock", () => {
  test("TTT13 move clock choices are 10, 20, 30, 60 with 20 default", () => {
    expect(MOVE_CLOCKS).toEqual([10, 20, 30, 60]);
    const f = tttRules.setupFields.find((x) => x.key === "moveClock")!;
    expect(f.choices).toEqual(["10", "20", "30", "60"]);
    expect(f.default).toBe(20);
  });
  test("TTT13 a tick while paused changes nothing", () => {
    const s0 = tttRules.init({}, players(2), 0);
    expect(tttRules.step(s0, { type: "tick" }, 0, paused()).state).toEqual(s0);
  });
  test("TTT14 the Organizer has no final say", () => expect(MANIFESTS.tictactoe.organizerFinalSay).toBe(false));
});
// Spec 410 Elimination type (core reference), checked for all three Elimination games. Rule ids ELIM*.
import { elimInit, submit, closeRound, canJoinLate, withLateWindow, capFor, rehearsalLimit, shouldStart, canControlClock, canEditSetup, getsEndPdf, ROLES, MAX_LATE_WINDOW_S } from "../../packages/core/src";
const IDS = ["tictactoe", "snakes", "luck"] as const;
const setup = (tieRule: "replay-once" | "rethrow" = "replay-once", survivors?: number) => ({ roundMs: 1000, tieRule, survivors });
describe("ELIM rounds and out rules", () => {
  test("ELIM1 a player who sent no result in time is out next round", () => {
    let s = elimInit(setup(), ["a", "b", "c"], 0);
    s = submit(s, "a", { outcome: "win" }, 500); s = submit(s, "b", { outcome: "win" }, 500);
    s = closeRound(s, 1000);
    expect(s.alive).toEqual(["a", "b"]);
    expect(s.out[0]).toMatchObject({ player: "c", round: 1 });
    expect(s.round).toBe(2);
  });
  test("ELIM1 a result sent after the deadline does not count", () => {
    let s = elimInit(setup(), ["a", "b"], 0);
    s = submit(s, "a", { outcome: "win" }, 500); s = submit(s, "b", { outcome: "win" }, 1001);
    expect(closeRound(s, 1000).alive).toEqual(["a"]);
  });
  test("ELIM1 the round does not close before its deadline", () => {
    const s = elimInit(setup(), ["a", "b"], 0);
    expect(closeRound(s, 999)).toEqual(s);
  });
  test("ELIM2 a loss means out, the last standing wins", () => {
    let s = elimInit(setup(), ["a", "b"], 0);
    s = submit(s, "a", { outcome: "win" }, 1); s = submit(s, "b", { outcome: "loss" }, 1);
    s = closeRound(s, 1000);
    expect(s.over).toBe(true);
    expect(s.winner).toBe("a");
    expect(s.out.map((o) => o.player)).toEqual(["b"]);
  });
  test("ELIM2 nothing changes after the game is over", () => {
    let s = elimInit(setup(), ["a", "b"], 0);
    s = submit(s, "a", { outcome: "win" }, 1); s = submit(s, "b", { outcome: "loss" }, 1); s = closeRound(s, 1000);
    expect(submit(s, "b", { outcome: "win" }, 1001)).toEqual(s);
    expect(closeRound(s, 5000)).toEqual(s);
  });
  test("ELIM3 TTT tie: replay once, then the first mover is out", () => {
    let s = elimInit(setup("replay-once"), ["a", "b"], 0);
    s = submit(s, "a", { outcome: "tie", firstMover: true }, 1); s = submit(s, "b", { outcome: "tie", firstMover: false }, 1);
    s = closeRound(s, 1000);
    expect(s.over, "first tie replays").toBe(false);
    expect(s.alive.sort()).toEqual(["a", "b"]);
    expect(s.round).toBe(1);
    s = submit(s, "a", { outcome: "tie", firstMover: true }, 1500); s = submit(s, "b", { outcome: "tie", firstMover: false }, 1500);
    s = closeRound(s, 2000);
    expect(s.over).toBe(true);
    expect(s.winner).toBe("b");
    expect(s.out[0]!.player).toBe("a");
  });
  test("ELIM4 Luck re-throw: a tie is thrown again, nobody is out", () => {
    let s = elimInit(setup("rethrow"), ["a", "b"], 0);
    for (const k of [1000, 2000, 3000]) {
      s = submit(s, "a", { outcome: "tie" }, k - 500); s = submit(s, "b", { outcome: "tie" }, k - 500);
      s = closeRound(s, k);
      expect(s.over).toBe(false); expect(s.alive.sort()).toEqual(["a", "b"]);
    }
  });
  test("ELIM5 Organizer sets survivors per round: the lowest scores are out", () => {
    let s = elimInit(setup("rethrow", 2), ["a", "b", "c", "d"], 0);
    const sc = { a: 10, b: 30, c: 20, d: 5 } as Record<string, number>;
    for (const p of Object.keys(sc)) s = submit(s, p, { outcome: "win", score: sc[p] }, 1);
    s = closeRound(s, 1000);
    expect(s.alive.sort()).toEqual(["b", "c"]);
    expect(s.out.map((o) => o.player).sort()).toEqual(["a", "d"]);
  });
  test("ELIM5 a tie at the survivor cut is thrown again among the tied", () => {
    let s = elimInit(setup("rethrow", 2), ["a", "b", "c"], 0);
    const sc = { a: 30, b: 20, c: 20 } as Record<string, number>;
    for (const p of Object.keys(sc)) s = submit(s, p, { outcome: "win", score: sc[p] }, 1);
    s = closeRound(s, 1000);
    expect(s.over).toBe(false);
    expect(s.alive.length).toBe(3);
  });
});
describe("ELIM manifests: modes, caps, joining, roles", () => {
  for (const id of IDS) {
    test(`ELIM6 ${id} rounds run by software: start-only play, rounds in both start modes`, () => {
      expect(MANIFESTS[id].playModes).toEqual(["start-only"]);
      expect([...MANIFESTS[id].startModes].sort()).toEqual(["auto", "manual"]);
      expect(shouldStart("auto", 100, 100, null)).toBe(true);
      expect(shouldStart("manual", 100, 100, "host")).toBe(true);
      expect(shouldStart("manual", 100, 100, "participant")).toBe(false);
    });
    test(`ELIM7 ${id} cap 2000 and rehearsal 10`, () => {
      expect(capFor(MANIFESTS[id], false)).toBe(2000); expect(capFor(MANIFESTS[id], true)).toBe(2000);
      expect(rehearsalLimit(MANIFESTS[id])).toBe(10);
    });
    test(`ELIM8 ${id} no join after round 1 unless the Organizer sets a late-join window`, () => {
      const rule = MANIFESTS[id].lateJoin, c = { over: false, now: 0, msSinceRound1End: 1000 };
      expect(canJoinLate(rule, { ...c, round: 1 })).toBe(true);
      expect(canJoinLate(rule, { ...c, round: 2 })).toBe(false);
      const w = withLateWindow(rule, 60);
      expect(canJoinLate(w, { ...c, round: 2 })).toBe(true);
      expect(canJoinLate(w, { ...c, round: 2, msSinceRound1End: 61_000 })).toBe(false);
      expect(canJoinLate(w, { ...c, round: 2, over: true })).toBe(false);
      expect(withLateWindow(rule, 9999).windowSeconds).toBe(MAX_LATE_WINDOW_S);
      expect(withLateWindow(rule, -5).windowSeconds).toBe(0);
    });
    test(`ELIM9 ${id} golden button auto-claims and says You won; no Organizer final say`, () => {
      expect(MANIFESTS[id].goldenButton).toBe("You won");
      expect(MANIFESTS[id].claimType).toBe("auto");
      expect(MANIFESTS[id].organizerFinalSay).toBe(false);
    });
  }
  test("ELIM10 roles: only Organizer and Host control the clock; only Organizer edits setup; co-hosts get no end PDF", () => {
    expect([...ROLES].sort()).toEqual(["cohost", "family", "host", "organizer", "participant"]);
    for (const r of ROLES) {
      expect(canControlClock(r), r).toBe(r === "organizer" || r === "host");
      expect(canEditSetup(r), r).toBe(r === "organizer");
      expect(getsEndPdf(r), r).toBe(r === "organizer" || r === "host");
    }
  });
});
