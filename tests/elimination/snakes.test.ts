import { describe, expect, test } from "bun:test";
import { checkBoard, move, snakesRules, finalRanking, raceOrder, SIZES, type Board } from "../../packages/snakes/src";
import { MANIFESTS } from "../../packages/manifest/src";
import { goodBoard, emptyBoard, running, paused, players } from "./helpers";
const game = (n: number, setup: Record<string, unknown> = {}, b: Board = emptyBoard()) => {
  const ps = players(n), boards = Object.fromEntries(ps.map((p) => [p, b]));
  return snakesRules.init({ boards, ...setup }, ps, 0);
};
const turn = (s: any, rolls: Record<string, number>, threw?: string[]) => snakesRules.step(s, { type: "turn", rolls, threw }, 0, running());
describe("SNK1-SNK5 the board", () => {
  test("SNK1 boards of 100, 144 and 225 squares", () => expect(SIZES).toEqual([100, 144, 225]));
  test("SNK2 a sound board has no problems", () => expect(checkBoard(goodBoard())).toEqual([]));
  test("SNK2 fewer than 6 or more than 12 snakes or ladders is refused", () => {
    const b = goodBoard();
    expect(checkBoard({ ...b, snakes: { 97: 65 } }).length).toBeGreaterThan(0);
    expect(checkBoard({ ...b, ladders: { 3: 15 } }).length).toBeGreaterThan(0);
    const many: Record<number, number> = {}; for (let i = 0; i < 13; i++) many[40 + i * 4] = 20 + i * 4 - 2 + 0; // 13 snakes
    expect(checkBoard({ ...b, snakes: many }).length).toBeGreaterThan(0);
  });
  test("SNK3 nothing starts on square 1 or ends on the last square", () => {
    const b = goodBoard();
    expect(checkBoard({ ...b, ladders: { ...b.ladders, 1: 20 } }).length).toBeGreaterThan(0);
    expect(checkBoard({ ...b, ladders: { ...b.ladders, 92: 100 } }).length).toBeGreaterThan(0);
  });
  test("SNK3 no square is used twice", () => {
    const b = goodBoard();
    expect(checkBoard({ ...b, snakes: { ...b.snakes, 60: 45 } }).length).toBeGreaterThan(0);
  });
  test("SNK4 a ladder climbs 8 to 30 squares", () => {
    const b = goodBoard();
    expect(checkBoard({ ...b, ladders: { ...b.ladders, 3: 10 } }).length, "7 too short").toBeGreaterThan(0);
    expect(checkBoard({ ...b, ladders: { ...b.ladders, 3: 34 } }).length, "31 too long").toBeGreaterThan(0);
    expect(checkBoard({ ...b, ladders: { ...b.ladders, 3: 11 } }), "8 fine").toEqual([]);
    expect(checkBoard({ ...b, ladders: { ...b.ladders, 3: 33 } }), "30 fine").toEqual([]);
  });
  test("SNK4 a snake drops 8 to 40 squares", () => {
    const b = goodBoard(), { 97: _, ...rest } = b.snakes;
    expect(checkBoard({ ...b, snakes: { ...rest, 97: 90 } }).length, "7 too short").toBeGreaterThan(0);
    expect(checkBoard({ ...b, snakes: { ...rest, 97: 56 } }).length, "41 too long").toBeGreaterThan(0);
    expect(checkBoard({ ...b, snakes: { ...rest, 97: 57 } }), "40 fine").toEqual([]);
  });
  test("SNK5 nobody can be trapped", () => {
    // six consecutive snake heads 95..99 would block, but heads must also be legal: build a wall of snakes just before the end
    const b: Board = { size: 100, ladders: { 3: 15, 9: 30, 22: 45, 35: 60, 50: 75, 62: 85 }, snakes: { 94: 60, 95: 60 - 1, 96: 58, 97: 57, 98: 56, 99: 55 } };
    expect(checkBoard(b).length).toBeGreaterThan(0);
  });
});
describe("SNK6-SNK11 moving", () => {
  const b = goodBoard();
  test("SNK6 a pawn starts on square 1", () => expect(game(2).pawns.p1!.at).toBe(1));
  test("SNK6 the new square is old plus roll", () => expect(move(emptyBoard(), 10, 4).to).toBe(14));
  test("SNK7 a ladder takes the pawn up", () => expect(move(b, 1, 2)).toMatchObject({ to: 15, ladder: true }));
  test("SNK7 a snake head takes the pawn down", () => expect(move(b, 94, 3)).toMatchObject({ to: 65, snake: true }));
  test("SNK8 finishing needs the exact roll", () => {
    expect(move(emptyBoard(), 98, 2).to).toBe(100);
    expect(move(emptyBoard(), 98, 3).to).toBe(98);
    expect(move(emptyBoard(), 99, 6).to).toBe(99);
  });
  test("SNK8 with reach or pass any roll that reaches or passes finishes", () => {
    expect(move(emptyBoard(), 98, 6, true).to).toBe(100);
    expect(move(emptyBoard(), 99, 1, true).to).toBe(100);
  });
  test("SNK8 setup offers the reach or pass option", () => expect(snakesRules.setupFields.some((f) => f.key === "pass" && f.kind === "toggle")).toBe(true));
  test("SNK9 a pawn that has finished stays finished", () => {
    let s = game(2, { turnLimit: 60 });
    s = { ...s, pawns: { ...s.pawns, p1: { ...s.pawns.p1!, at: 99 } } };
    s = turn(s, { p1: 1, p2: 1 }).state;
    expect(s.pawns.p1!.at).toBe(100);
    s = turn(s, { p1: 3, p2: 1 }).state;
    expect(s.pawns.p1!.at).toBe(100);
  });
  test("SNK10 presence: a player who did not throw misses the turn and stays", () => {
    const s = game(2, { mode: "presence" }), r = turn(s, { p1: 3, p2: 3 }, ["p1"]).state;
    expect(r.pawns.p1!.at).toBe(4);
    expect(r.pawns.p2!.at).toBe(1);
    expect(r.pawns.p2!.missed).toBe(1);
  });
  test("SNK10 fate: every throw happens by itself", () => {
    const r = turn(game(2, { mode: "fate" }), { p1: 3, p2: 5 }).state;
    expect([r.pawns.p1!.at, r.pawns.p2!.at]).toEqual([4, 6]);
  });
  test("SNK11 while paused no turn is played", () => {
    const s = game(2), r = snakesRules.step(s, { type: "turn", rolls: { p1: 3, p2: 3 } }, 0, paused());
    expect(r.state).toEqual(s);
    expect(r.state.turn).toBe(0);
  });
});
describe("SNK12-SNK15 prizes", () => {
  test("SNK12 first on or past the milestone (default 75) at the end of a turn wins it", () => {
    let s = game(2); s = { ...s, pawns: { ...s.pawns, p1: { ...s.pawns.p1!, at: 72 }, p2: { ...s.pawns.p2!, at: 68 } } };
    const r = turn(s, { p1: 3, p2: 6 });
    expect(r.out).toContainEqual({ kind: "win", player: "p1", position: "milestone 75" });
    expect(r.state.milestoneWon[75]).toBe("p1");
  });
  test("SNK12 up to three milestones", () => {
    const s = game(2, { milestones: "20,40,60,80" });
    expect(s.milestones.length).toBe(3);
  });
  test("SNK13 the first five to land on the last square win 1st to 5th; the game ends at the 5th", () => {
    const ps = players(6); let s = game(6);
    const near = Object.fromEntries(ps.map((p) => [p, { ...s.pawns[p]!, at: 99, fate: +p.slice(1) }]));
    s = { ...s, pawns: near };
    const r = turn(s, Object.fromEntries(ps.map((p) => [p, 1])));
    const wins = r.out.filter((o: any) => o.kind === "win" && !String(o.position).startsWith("milestone")).map((o: any) => o.position);
    expect(wins).toEqual(["1st", "2nd", "3rd", "4th", "5th"]);
    expect(r.state.over).toBe(true);
    expect(r.out.at(-1)).toEqual({ kind: "end" });
    expect(snakesRules.goldenButton).toBe("You won");
    expect(snakesRules.claimType).toBe("auto");
  });
  test("SNK13 the game ends at the turn limit (default 60)", () => {
    expect(snakesRules.setupFields.find((f) => f.key === "turnLimit")!.default).toBe(60);
    expect(game(2).turnLimit).toBe(60);
    let s = game(2, { turnLimit: 2 });
    s = turn(s, { p1: 1, p2: 1 }).state; expect(s.over).toBe(false);
    s = turn(s, { p1: 1, p2: 1 }).state; expect(s.over).toBe(true);
  });
  test("SNK14 same turn: higher square, then more ladders, then fewer missed, then lower fate", () => {
    const P = (at: number, ladders: number, missed: number, fate: number) => ({ at, ladders, missed, fate });
    expect(raceOrder(P(80, 0, 9, 9), P(70, 5, 0, 0))).toBeLessThan(0);
    expect(raceOrder(P(80, 2, 9, 9), P(80, 1, 0, 0))).toBeLessThan(0);
    expect(raceOrder(P(80, 1, 1, 9), P(80, 1, 2, 0))).toBeLessThan(0);
    expect(raceOrder(P(80, 1, 1, 1), P(80, 1, 1, 2))).toBeLessThan(0);
  });
  test("SNK14 players reaching the last square on one turn are placed by the chain", () => {
    let s = game(2); s = { ...s, pawns: { p1: { ...s.pawns.p1!, at: 99, fate: 7, ladders: 0 }, p2: { ...s.pawns.p2!, at: 99, fate: 3, ladders: 0 } } };
    const r = turn(s, { p1: 1, p2: 1 });
    expect(r.out.filter((o: any) => o.position === "1st")[0]).toMatchObject({ player: "p2" });
  });
  test("SNK15 final ranking is complete: finishers in order, then the rest by square and the chain", () => {
    const P = (at: number, fate: number) => ({ at, ladders: 0, missed: 0, fate });
    const r = finalRanking({ finishers: ["c", "a"], pawns: { a: P(100, 1), b: P(50, 1), c: P(100, 2), d: P(60, 3), e: P(50, 0) } });
    expect(r).toEqual(["c", "a", "d", "e", "b"]);
  });
});
describe("SNK-E elimination notes", () => {
  test("SNK12 the golden button says You won and caps are 2000", () => {
    expect(MANIFESTS.snakes.goldenButton).toBe("You won");
    expect(MANIFESTS.snakes.caps.auto).toBe(2000);
  });
});
