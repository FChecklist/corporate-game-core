// Spec 410 (owner-approved) checked from the updated rules books, per game module. Rule ids SPEC*.
import { describe, expect, test } from "bun:test";
import { tttRules } from "../../packages/tictactoe/src";
import { luckRules } from "../../packages/luck/src";
import { snakesRules } from "../../packages/snakes/src";
import { MANIFESTS } from "../../packages/manifest/src";
import { canJoinLate, withLateWindow } from "../../packages/core/src";
import { emptyBoard, running, paused, players } from "./helpers";
const dice = (s: any, target: number, d: Record<string, number>, clock = running()) => luckRules.step(s, { type: "dice", target, dice: d }, 0, clock);
/** Play one whole Luck round of 10 dice rounds; `hits` = how many of the 10 each player hits on target 1 (the others miss). */
const luckRound = (s: any, hits: Record<string, number>) => {
  let r: any = { state: s, out: [] };
  for (let i = 0; i < 10; i++) r = dice(r.state, 1, Object.fromEntries(Object.keys(hits).map((p) => [p, i < hits[p]! ? 1 : 2])));
  return r;
};
const turn = (s: any, rolls: Record<string, number>, clock = running()) => snakesRules.step(s, { type: "turn", rolls }, 0, clock);
const snakes = (n: number, setup: Record<string, unknown> = {}) => {
  const ps = players(n);
  return snakesRules.init({ boards: Object.fromEntries(ps.map((p) => [p, emptyBoard()])), ...setup }, ps, 0);
};
describe("SPEC TTT frozen while paused", () => {
  test("SPEC1 a match result while paused changes nothing", () => {
    const s0 = tttRules.init({}, players(4), 0), m = s0.matches[0]![0]!;
    const r = tttRules.step(s0, { type: "matchResult", round: 1, index: 0, winner: m.a!, pointsA: 2, pointsB: 0 }, 0, paused());
    expect(r.state).toEqual(s0);
    expect(r.out).toEqual([]);
  });
  test("SPEC1 a tick while paused changes nothing, and the same result counts once play resumes", () => {
    const s0 = tttRules.init({}, players(2), 0), m = s0.matches[0]![0]!;
    expect(tttRules.step(s0, { type: "tick" }, 0, paused())).toEqual({ state: s0, out: [] });
    const r = tttRules.step(s0, { type: "matchResult", round: 1, index: 0, winner: m.a!, pointsA: 2, pointsB: 0 }, 0, running());
    expect(r.state.over).toBe(true);
  });
});
describe("SPEC Luck survivors and re-throw", () => {
  test("SPEC2 survivors 0: everybody plays on and nobody is out", () => {
    const r = luckRound(luckRules.init({ rounds: 3 }, players(3), 0), { p1: 5, p2: 3, p3: 0 });
    expect(r.state.alive).toEqual(["p1", "p2", "p3"]);
    expect(r.out.filter((o: any) => o.kind === "out")).toEqual([]);
  });
  test("SPEC3 the Organizer sets survivors: the best of the round stay in, the rest are out", () => {
    const r = luckRound(luckRules.init({ rounds: 3, survivors: 2 }, players(4), 0), { p1: 5, p2: 3, p3: 1, p4: 0 });
    expect(r.state.alive).toEqual(["p1", "p2"]);
    expect(r.out.filter((o: any) => o.kind === "out").map((o: any) => o.player).sort()).toEqual(["p3", "p4"]);
    expect(r.state.outRound).toEqual({ p3: 1, p4: 1 });
  });
  test("SPEC3 the number of survivors is a limit: with no more players than that, nobody else is out", () => {
    let r = luckRound(luckRules.init({ rounds: 3, survivors: 2 }, players(4), 0), { p1: 5, p2: 3, p3: 1, p4: 0 });
    r = luckRound(r.state, { p1: 1, p2: 4 });
    expect(r.state.alive).toEqual(["p1", "p2"]);
    expect(r.state.over).toBe(false);
  });
  test("SPEC4 players who are out no longer score", () => {
    const r = luckRound(luckRules.init({ rounds: 3, survivors: 1 }, players(3), 0), { p1: 5, p2: 3, p3: 1 });
    const x = dice(luckRules.init({ rounds: 3, survivors: 2 }, players(3), 0), 1, { p1: 1, p2: 1, p3: 1 });
    expect(x.state.scores.p3!.points).toBe(1);
    expect(r.state.scores.p2!.points).toBe(3);
  });
  test("SPEC5 one player left standing wins at once, before the last round", () => {
    const r = luckRound(luckRules.init({ rounds: 5, survivors: 1 }, players(3), 0), { p1: 5, p2: 3, p3: 1 });
    expect(r.state.over).toBe(true);
    expect(r.state.winner).toBe("p1");
    expect(r.out).toContainEqual({ kind: "win", player: "p1", position: "1st" });
    expect(r.out).toContainEqual({ kind: "end" });
  });
  test("SPEC6 a tie across the cut: only the tied throw again, nobody is out yet", () => {
    const r = luckRound(luckRules.init({ rounds: 3, survivors: 2 }, players(4), 0), { p1: 5, p2: 2, p3: 2, p4: 0 });
    expect(r.state.rethrow).toEqual({ sure: ["p1"], tied: ["p2", "p3"], need: 1 });
    expect(r.state.alive.length).toBe(4);
    expect(r.state.diceIndex).toBe(10);
  });
  test("SPEC6 a re-throw does not count as one of the 10 dice rounds, and repeats until the tie is gone", () => {
    let r = luckRound(luckRules.init({ rounds: 3, survivors: 2 }, players(4), 0), { p1: 5, p2: 2, p3: 2, p4: 0 });
    r = dice(r.state, 3, { p2: 3, p3: 3 });
    expect(r.state.rethrow).toBeDefined(); expect(r.state.diceIndex).toBe(10);
    r = dice(r.state, 3, { p2: 0, p3: 3 });
    expect(r.state.rethrow).toBeUndefined();
    expect(r.state.alive).toEqual(["p1", "p3"]);
    expect(r.state.diceIndex).toBe(10);
    expect(r.state.outRound).toEqual({ p2: 1, p4: 1 });
  });
  test("SPEC6 players with more points than the tied ones stay in without throwing", () => {
    let r = luckRound(luckRules.init({ rounds: 3, survivors: 2 }, players(4), 0), { p1: 5, p2: 2, p3: 2, p4: 0 });
    r = dice(r.state, 3, { p1: 3, p2: 0, p3: 3, p4: 3 }); // p1 and p4 dice are ignored
    expect(r.state.alive).toEqual(["p1", "p3"]);
    expect(r.state.scores.p1!.points).toBe(5);
  });
  test("SPEC7 nothing is thrown while paused, a re-throw waits too", () => {
    const r = luckRound(luckRules.init({ rounds: 3, survivors: 2 }, players(4), 0), { p1: 5, p2: 2, p3: 2, p4: 0 });
    expect(dice(r.state, 3, { p2: 3, p3: 0 }, paused()).state).toEqual(r.state);
  });
  test("SPEC8 the final order: players still in first, then those out, the later out the better", () => {
    let r = luckRound(luckRules.init({ rounds: 2, survivors: 3 }, players(4), 0), { p1: 4, p2: 3, p3: 2, p4: 0 });
    r = luckRound(r.state, { p1: 0, p2: 5, p3: 1 });
    expect(r.state.over).toBe(true);
    expect(r.out.filter((o: any) => o.kind === "win").map((o: any) => o.player)).toEqual(["p2", "p1", "p3", "p4"]);
  });
});
describe("SPEC Snakes survivors", () => {
  test("SPEC9 survivors 0: nobody is sent out at the end of a round", () => {
    let s: any = snakes(3);
    for (let i = 0; i < 10; i++) s = turn(s, { p1: 3, p2: 2, p3: 1 }).state;
    expect(s.out).toEqual([]);
  });
  test("SPEC10 the Organizer sets survivors: at the end of a round the front runners stay in, the rest are out", () => {
    let s: any = snakes(4, { survivors: 2, roundTurns: 3 });
    for (let i = 0; i < 2; i++) s = turn(s, { p1: 4, p2: 3, p3: 2, p4: 1 }).state;
    expect(s.out).toEqual([]);
    const r = turn(s, { p1: 4, p2: 3, p3: 2, p4: 1 });
    expect(r.state.out.sort()).toEqual(["p3", "p4"]);
    expect(r.out.filter((o) => o.kind === "out").length).toBe(2);
    expect(r.out).toContainEqual({ kind: "round", n: 2, alive: 2 });
  });
  test("SPEC10 a player who is out no longer moves; the cut is made again every round", () => {
    let s: any = snakes(4, { survivors: 2, roundTurns: 1 });
    s = turn(s, { p1: 4, p2: 3, p3: 2, p4: 1 }).state;
    const at = s.pawns.p3.at;
    s = turn(s, { p1: 1, p2: 3, p3: 6, p4: 6 }).state;
    expect(s.pawns.p3.at).toBe(at);
    s = turn(s, { p1: 1, p2: 3 }).state;
    expect(s.out.sort()).toEqual(["p3", "p4"]); // with 2 left and survivors 2 nobody else is out
  });
  test("SPEC11 the front-runner order is square, ladders, fewer missed turns, then fate: never a tie", () => {
    const s: any = snakes(3, { survivors: 1, roundTurns: 1, fate: { p1: 9, p2: 2, p3: 5 } });
    const r = turn(s, { p1: 3, p2: 3, p3: 3 });
    expect(r.state.out.sort()).toEqual(["p1", "p3"]);
  });
  test("SPEC12 last standing: the game ends when nobody is left in", () => {
    let s: any = snakes(2, { survivors: 1, roundTurns: 1 });
    const r = turn(s, { p1: 6, p2: 1 });
    expect(r.state.out).toEqual(["p2"]);
    expect(r.state.over).toBe(false); // the one left keeps racing for the end prizes
  });
  test("SPEC13 no turn is played while paused", () => {
    const s: any = snakes(3, { survivors: 1, roundTurns: 1 });
    expect(turn(s, { p1: 3, p2: 2, p3: 1 }, paused()).state).toEqual(s);
  });
});
describe("SPEC no join after round 1 unless the Organizer sets a late-join window", () => {
  for (const [id, mod] of [["tictactoe", tttRules], ["snakes", snakesRules], ["luck", luckRules]] as const) {
    test(`SPEC14 ${id} module carries the manifest's late-join rule`, () => expect(mod.lateJoin).toEqual(MANIFESTS[id].lateJoin));
    test(`SPEC14 ${id} joining closes after round 1; an Organizer window reopens it for a short time only`, () => {
      const c = { over: false, now: 0, msSinceRound1End: 1000 };
      expect(canJoinLate(mod.lateJoin, { ...c, round: 1 })).toBe(true);
      expect(canJoinLate(mod.lateJoin, { ...c, round: 2 })).toBe(false);
      const w = withLateWindow(mod.lateJoin, 30);
      expect(canJoinLate(w, { ...c, round: 3 })).toBe(true);
      expect(canJoinLate(w, { ...c, round: 3, msSinceRound1End: 31_000 })).toBe(false);
    });
  }
});
