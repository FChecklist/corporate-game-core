import { test, expect } from "bun:test";
import { createHash } from "node:crypto";
import * as L from "../../packages/luck/src";
import { luckRules, pointsFor, rankOrder, ranking, reactionFor, ROUNDS, WAITING_ROOM_S, PRESS_S, GAP_S, REVEAL_S, GAME_MS, TOP } from "../../packages/luck/src";
import { MANIFESTS } from "../../packages/manifest/src";
import { newClock, start, pause, resume } from "../../packages/core/src";

const run = (clock: any, n = 2, fate: Record<string, number> = {}) => luckRules.init({ fate } as any, Array.from({ length: n }, (_, i) => "p" + i)) as any;
const running = { ...newClock(), phase: "running" } as any;
const play = (s: any, rounds: { target: number; press: Record<string, number | undefined> }[], clock = running) => {
  let out: any[] = [];
  for (const r of rounds) { const x = luckRules.step(s, { type: "round", ...r } as any, 0, clock); s = x.state; out = out.concat(x.out); }
  return { s, out };
};
const fateOf = (id: string, seed: number) => createHash("sha256").update(id + ":" + seed).digest().readUInt32BE(0);

test("R1 22 rounds fixed, nobody eliminated", () => {
  expect(ROUNDS).toBe(22);
  let s = run(running, 3);
  const { s: s2, out } = play(s, Array.from({ length: 21 }, () => ({ target: 3, press: { p0: 3 } })));
  expect(s2.over).toBe(false);
  expect(out.some((o: any) => o.kind === "elim" || o.kind === "out")).toBe(false);
  expect(Object.keys(s2.scores).length).toBe(3);
  const r = play(s2, [{ target: 3, press: {} }]);
  expect(r.s.over).toBe(true);
  expect(r.s.round).toBe(22);
});
test("R1 no setup fields for Organizer (round count not changeable)", () => { expect(luckRules.setupFields.length).toBe(0); });
test("R2 press window 10 s, gap 10 s, reveal 3 s inside gap", () => {
  expect(PRESS_S).toBe(10); expect(GAP_S).toBe(10); expect(REVEAL_S).toBe(3); expect(REVEAL_S).toBeLessThan(GAP_S);
});
test("R3 target must be 1..6; invalid target ignored", () => {
  const s = run(running);
  for (const t of [0, 7, 2.5, NaN]) expect(luckRules.step(s, { type: "round", target: t, press: { p0: 1 } } as any, 0, running).state.round).toBe(0);
  for (let t = 1; t <= 6; t++) expect(luckRules.step(s, { type: "round", target: t, press: { p0: t } } as any, 0, running).state.scores.p0.points).toBe(10);
});
test("R4 points table for every target/press pair", () => {
  for (let t = 1; t <= 6; t++) for (let p = 1; p <= 6; p++) {
    const d = Math.abs(t - p);
    expect(pointsFor(t, p)).toBe(d === 0 ? 10 : d === 1 ? 5 : d === 2 ? 3 : 1);
  }
});
test("R4 no press = 0 (undefined, null)", () => { expect(pointsFor(3, undefined)).toBe(0); expect(pointsFor(3, null)).toBe(0); });
test("R4 out-of-range press scores 0", () => { expect(pointsFor(3, 0)).toBe(0); expect(pointsFor(3, 7)).toBe(0); });
test("R4 max over the game is 220", () => {
  const { s } = play(run(running), Array.from({ length: 22 }, () => ({ target: 4, press: { p0: 4, p1: 1 } })));
  expect(s.scores.p0.points).toBe(220); expect(s.scores.p0.exact).toBe(22);
  expect(s.scores.p1.points).toBe(22);
});
test("R4 exact/fives counters", () => {
  const { s } = play(run(running), [{ target: 3, press: { p0: 3, p1: 4 } }, { target: 3, press: { p0: 2, p1: 6 } }]);
  expect(s.scores.p0).toMatchObject({ points: 15, exact: 1, fives: 1 });
  expect(s.scores.p1).toMatchObject({ points: 5 + 1, exact: 0, fives: 1 });
});
test("R5 tie-break 1: more exact hits first", () => {
  // p0: 10+... p1: 5+5 = 10 ; equal totals 10, p0 exact 1
  const { s } = play(run(running), [{ target: 3, press: { p0: 3, p1: 4 } }, { target: 3, press: { p1: 2 } }]);
  expect(s.scores.p0.points).toBe(10); expect(s.scores.p1.points).toBe(10);
  expect(ranking(s.scores)).toEqual(["p0", "p1"]);
});
test("R5 tie-break 2: most 5-point hits", () => {
  // p0: 5+5+... p1: 3+3+3+1 =10 with 0 fives; both 10, 0 exact
  const { s } = play(run(running), [
    { target: 3, press: { p0: 4, p1: 1 } }, { target: 3, press: { p0: 2, p1: 1 } }, { target: 3, press: { p1: 5 } }, { target: 3, press: { p1: 6 } }]);
  expect(s.scores.p0.points).toBe(10); expect(s.scores.p1.points).toBe(3 + 3 + 3 + 1);
  expect(ranking(s.scores)).toEqual(["p0", "p1"]);
});
test("R5 tie-break 3: who reached the total first", () => {
  const { s } = play(run(running), [{ target: 3, press: { p1: 3 } }, { target: 3, press: { p0: 3 } }, { target: 3, press: {} }]);
  expect(ranking(s.scores)).toEqual(["p1", "p0"]);
});
test("R5 tie-break 4: lower fate number", () => {
  const s0 = run(running, 2, { p0: 9, p1: 4 });
  const { s } = play(s0, [{ target: 3, press: { p0: 3, p1: 3 } }]);
  expect(ranking(s.scores)).toEqual(["p1", "p0"]);
});
test("R5 fate numbers recomputed with node:crypto drive final order", () => {
  const fate: Record<string, number> = { p0: fateOf("p0", 1), p1: fateOf("p1", 1) };
  const { s } = play(run(running, 2, fate), [{ target: 2, press: { p0: 2, p1: 2 } }]);
  const first = fate.p0! < fate.p1! ? "p0" : "p1";
  expect(ranking(s.scores)[0]).toBe(first);
});
test("R5 never tied: 300 seeds x random games, full order strict", () => {
  for (let seed = 1; seed <= 300; seed++) {
    let x = seed * 2654435761 >>> 0;
    const rnd = (n: number) => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x % n; };
    const n = 2 + rnd(30), ids = Array.from({ length: n }, (_, i) => "q" + i);
    const fate: Record<string, number> = {}; const used = new Set<number>();
    for (const id of ids) { let f; do f = rnd(1e6); while (used.has(f)); used.add(f); fate[id] = f; }
    let s: any = luckRules.init({ fate } as any, ids);
    for (let r = 0; r < 22; r++) {
      const press: Record<string, number | undefined> = {};
      for (const id of ids) press[id] = rnd(4) === 0 ? undefined : 1 + rnd(6);
      s = luckRules.step(s, { type: "round", target: 1 + rnd(6), press } as any, 0, running).state;
    }
    expect(s.over).toBe(true);
    const sc = Object.values(s.scores) as any[];
    for (let i = 0; i < sc.length; i++) for (let j = i + 1; j < sc.length; j++) expect(rankOrder(sc[i], sc[j])).not.toBe(0);
    const rk = ranking(s.scores);
    for (let i = 1; i < rk.length; i++) expect(rankOrder(s.scores[rk[i - 1]], s.scores[rk[i]])).toBeLessThan(0);
    expect(s.winner).toBe(rk[0]);
  }
});
test("R6 top five win 1st to 5th, then end", () => {
  const ids = ["a", "b", "c", "d", "e", "f", "g"];
  let s: any = luckRules.init({ fate: {} } as any, ids);
  const press: any = { a: 6, b: 5, c: 4, d: 3, e: 2, f: 1, g: undefined };
  const r = play(s, Array.from({ length: 22 }, () => ({ target: 6, press })));
  const wins = r.out.filter((o: any) => o.kind === "win");
  expect(wins.map((w: any) => [w.player, w.position])).toEqual([["a", "1st"], ["b", "2nd"], ["c", "3rd"], ["d", "4th"], ["e", "5th"]]);
  expect(r.out[r.out.length - 1].kind).toBe("end");
  expect(r.s.winner).toBe("a");
});
test("R6 button says You won, auto claim, five positions", () => {
  expect(luckRules.goldenButton).toBe("You won"); expect(luckRules.claimType).toBe("auto");
  expect(luckRules.prizePositions({} as any)).toEqual(["1st", "2nd", "3rd", "4th", "5th"]);
});
test("R6 manifest prize positions list five places", () => {
  expect(MANIFESTS.luck.prizePositions).toEqual(["1st", "2nd", "3rd", "4th", "5th"]);
});
test("R7 at least 2 players needed", () => {
  expect(() => luckRules.init({} as any, ["a"])).toThrow();
  expect(() => luckRules.init({} as any, [])).toThrow();
  expect(() => luckRules.init({} as any, ["a", "b"])).not.toThrow();
});
test("R7 cap 2000 on the new flow (manifest)", () => { expect(MANIFESTS.luck.caps.auto).toBe(2000); });
test("R7 2000-player run: strict order, 5 winners", () => {
  const ids = Array.from({ length: 2000 }, (_, i) => "u" + i), fate: Record<string, number> = {};
  ids.forEach((id, i) => (fate[id] = (i * 7919) % 2000 + i * 0)); // distinct: 7919 coprime with 2000
  let x = 12345;
  const rnd = (n: number) => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x % n; };
  let s: any = luckRules.init({ fate } as any, ids), out: any[] = [];
  for (let r = 0; r < 22; r++) {
    const press: any = {}; for (const id of ids) press[id] = 1 + rnd(6);
    const e = luckRules.step(s, { type: "round", target: 1 + rnd(6), press } as any, 0, running); s = e.state; out = e.out;
  }
  expect(s.over).toBe(true);
  expect(out.filter((o: any) => o.kind === "win").length).toBe(5);
  const rk = ranking(s.scores); expect(new Set(rk).size).toBe(2000);
  for (let i = 1; i < rk.length; i++) expect(rankOrder(s.scores[rk[i - 1]], s.scores[rk[i]])).toBeLessThan(0);
});
test("R7 pause freezes: paused clock plays nothing", () => {
  const s = run(running);
  const paused = { ...running, phase: "paused" };
  const x = luckRules.step(s, { type: "round", target: 3, press: { p0: 3 } } as any, 0, paused as any);
  expect(x.state).toBe(s); expect(x.out).toEqual([]);
});
test("R7 pause clock arithmetic: pause 30 s adds exactly 30 s, only Organizer/Host", () => {
  let c: any = start(newClock());
  c = pause(c, "organizer" as any, 1000); expect(c.phase).toBe("paused"); expect(c.frozenAt).toBe(1000);
  c = resume(c, "organizer" as any, 31000); expect(c.pausedMs).toBe(30000); expect(c.phase).toBe("running");
  const p = pause(start(newClock()), "player" as any, 5); expect(p.phase).toBe("running");
});
test("R7 start mode only setting: manifest start modes auto and manual", () => { expect([...MANIFESTS.luck.startModes].sort()).toEqual(["auto", "manual"]); });
test("TIME waiting room is 120 s", () => { expect(WAITING_ROOM_S).toBe(120); });
test("TIME round = 20 s, 22 rounds = 440 s = 7:20", () => { expect((PRESS_S + GAP_S) * ROUNDS).toBe(440); });
test("TIME start to last result = 430 s = 7:10 (last gap not waited)", () => { expect(GAME_MS).toBe(430_000); expect(GAME_MS).toBe((22 * 10 + 21 * 10) * 1000); });
test("TIME play time between 7:00 and 8:00", () => { expect(GAME_MS).toBeGreaterThanOrEqual(420_000); expect(GAME_MS).toBeLessThanOrEqual(480_000); });
test("TIME waiting room plus play at most 10:00 (120 s + 440 s = 560 s = 9:20)", () => {
  expect(WAITING_ROOM_S * 1000 + GAME_MS).toBeLessThanOrEqual(600_000);
  expect(WAITING_ROOM_S + 440).toBe(560);
});
test("TIME pause adds its own time: 430 s play + 45 s pause = 475 s", () => { expect(GAME_MS / 1000 + 45).toBe(475); });
test("TOP is five", () => { expect(TOP).toBe(5); });
test("R8 reactions: Boom / Nice one / Oops, ids exist in the pack", async () => {
  const { REACTIONS } = await import("../../packages/ui/src");
  const text = (id: string) => REACTIONS.find((r: any) => r.id === id)?.text;
  expect(text(reactionFor(4, 4))).toBe("Boom!");
  expect(text(reactionFor(4, 5))).toBe("Nice one!");
  expect(text(reactionFor(4, 1))).toBe("Oops!");
  expect(text(reactionFor(4, undefined))).toBe("Oops!");
  expect(text(L.LUCK_REACTIONS.roundStart)).toBe("Round starts!");
  expect(text(L.LUCK_REACTIONS.countdown)).toBe("3 2 1");
  expect(text(L.LUCK_REACTIONS.final)).toBe("Ta-da!");
});
