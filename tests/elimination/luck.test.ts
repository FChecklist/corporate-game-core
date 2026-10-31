import { describe, expect, test } from "bun:test";
import { luckRules, hit, rankOrder, overall, DICE_PER_ROUND, WINDOWS, REVEAL_S, BREAK_S, type Score } from "../../packages/luck/src";
import { MANIFESTS } from "../../packages/manifest/src";
import { running, paused, players } from "./helpers";
const S = (points: number, best: number, hits: number, lastHitAt: number, fate: number): Score => ({ points, best, hits, lastHitAt, fate });
const init = (n = 3, setup: Record<string, unknown> = {}) => luckRules.init(setup, players(n), 0);
const dice = (s: any, target: number, d: Record<string, number>) => luckRules.step(s, { type: "dice", target, dice: d }, 0, running());
describe("LUCK1-LUCK5 the game", () => {
  test("LUCK1 1 to 20 rounds, default 10", () => {
    expect(init(2).rounds).toBe(10);
    expect(luckRules.setupFields.find((f) => f.key === "rounds")!.default).toBe(10);
    expect(init(2, { rounds: 1 }).rounds).toBe(1);
    expect(init(2, { rounds: 20 }).rounds).toBe(20);
    expect(() => init(2, { rounds: 0 })).toThrow();
    expect(() => init(2, { rounds: 21 })).toThrow();
  });
  test("LUCK1 every round has 10 dice rounds", () => {
    expect(DICE_PER_ROUND).toBe(10);
    let s: any = init(2, { rounds: 2 }), seen: any[] = [];
    for (let i = 0; i < 10; i++) { const r = dice(s, 3, {}); s = r.state; seen.push(...r.out); }
    expect(seen).toContainEqual({ kind: "round", n: 2, alive: 2 });
    expect(s.over).toBe(false);
  });
  test("LUCK2 press windows 6, 10 (default), 15 seconds; reveal 3; break 20", () => {
    expect(WINDOWS).toEqual([6, 10, 15]);
    expect(luckRules.setupFields.find((f) => f.key === "window")!.default).toBe(10);
    expect(REVEAL_S).toBe(3); expect(BREAK_S).toBe(20);
  });
  test("LUCK2 a target outside 1 to 6 is not played", () => {
    const s = init(2);
    for (const t of [0, 7, 2.5]) expect(dice(s, t, { p1: t }).state, String(t)).toEqual(s);
  });
  test("LUCK3 a dice showing the target scores that many points; others score nothing", () => {
    expect(hit(5, 5)).toBe(5); expect(hit(5, 4)).toBe(0); expect(hit(1, 1)).toBe(1);
  });
  test("LUCK3 points add up inside a round and across rounds", () => {
    let s: any = init(2, { rounds: 2 });
    for (let i = 0; i < 10; i++) s = dice(s, 2, { p1: 2, p2: 1 }).state;
    expect(s.scores.p1.points).toBe(20);
    expect(s.roundScores[0].p1.points).toBe(20);
    s = dice(s, 4, { p1: 4 }).state;
    expect(s.scores.p1.points).toBe(24);
    expect(s.roundScores[1].p1.points).toBe(4);
    expect(s.scores.p2.points).toBe(0);
  });
  test("LUCK4 at least 2 players are needed", () => expect(() => init(1)).toThrow());
  test("LUCK4 dice rounds are played in order, the game ends after the last", () => {
    let s: any = init(2, { rounds: 1 });
    for (let i = 0; i < 10; i++) s = dice(s, 1, { p1: 1 }).state;
    expect(s.over).toBe(true);
    expect(s.diceIndex).toBe(10);
    expect(dice(s, 1, { p1: 1 }).state).toEqual(s);
  });
  test("LUCK5 while paused nothing is played", () => {
    const s = init(2), r = luckRules.step(s, { type: "dice", target: 1, dice: { p1: 1 } }, 0, paused());
    expect(r.state).toEqual(s);
  });
});
describe("LUCK6-LUCK8 ranking", () => {
  test("LUCK6 most points first", () => expect(rankOrder(S(5, 1, 1, 9, 9), S(4, 6, 9, 1, 0))).toBeLessThan(0));
  test("LUCK6 equal points: highest single hit", () => expect(rankOrder(S(6, 6, 1, 9, 9), S(6, 3, 2, 1, 0))).toBeLessThan(0));
  test("LUCK6 then most hits", () => expect(rankOrder(S(6, 3, 2, 9, 9), S(6, 3, 1, 1, 0))).toBeLessThan(0));
  test("LUCK6 then who reached that score first", () => expect(rankOrder(S(6, 3, 2, 4, 9), S(6, 3, 2, 7, 0))).toBeLessThan(0));
  test("LUCK6 then fate, lower wins", () => expect(rankOrder(S(6, 3, 2, 4, 1), S(6, 3, 2, 4, 2))).toBeLessThan(0));
  test("LUCK7 the order is strict: the overall ranking never shares a place", () => {
    const sc = { a: S(3, 3, 1, 1, 3), b: S(3, 3, 1, 1, 1), c: S(3, 3, 1, 1, 2) };
    expect(overall(sc)).toEqual(["b", "c", "a"]);
  });
  test("LUCK7 every round has its own ranking by the running total in the overall one", () => {
    let s: any = init(2, { rounds: 2 });
    for (let i = 0; i < 10; i++) s = dice(s, 3, { p1: 3 }).state;
    for (let i = 0; i < 10; i++) s = dice(s, 3, { p2: 3 }).state;
    expect(overall(s.roundScores[0])[0]).toBe("p1");
    expect(overall(s.roundScores[1])[0]).toBe("p2");
    expect(s.scores.p1.points).toBe(30); expect(s.scores.p2.points).toBe(30);
  });
  test("LUCK8 the overall top five win 1st to 5th with 'You won' and no Claim", () => {
    let s: any = init(7, { rounds: 1 }), out: any[] = [];
    for (let i = 0; i < 10; i++) { const r = dice(s, 1, Object.fromEntries(players(7).map((p, k) => [p, i < 7 - k ? 1 : 2]))); s = r.state; out = out.concat(r.out); }
    const wins = out.filter((o) => o.kind === "win");
    expect(wins.map((w) => w.position)).toEqual(["1st", "2nd", "3rd", "4th", "5th"]);
    expect(wins.map((w) => w.player)).toEqual(["p1", "p2", "p3", "p4", "p5"]);
    expect(out.at(-1)).toEqual({ kind: "end" });
    expect(luckRules.goldenButton).toBe("You won");
    expect(luckRules.claimType).toBe("auto");
    expect(MANIFESTS.luck.labels).not.toContain("Claim");
  });
  test("LUCK8 prize places 1 to 5", () => expect(luckRules.prizePositions({})).toEqual(["1st", "2nd", "3rd", "4th", "5th"]));
});
