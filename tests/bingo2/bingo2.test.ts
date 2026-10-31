// Tests written only from docs/BINGO_RULES_BOOK.md. Test names start with the rule id (R1 ... R17).
import { describe, expect, test } from "bun:test";
import { bingoRules, settleFromLog, settleRounds, callLabel, isValidCard, prizeLines } from "../../packages/bingo/src";
import { mkCard, rowOf, flatNums, orderWith, orderOffCard, expectedTie, fate, RUNNING, play } from "./helpers";

const A = mkCard(0), B = mkCard(5), C = mkCard(10);
const LINE1 = { line: 1 }, LINE2 = { line: 2 };
const wonBy = (r: { house: string; ordinal: number; player: string }[]) => Object.fromEntries(r.map((x) => [`${x.house}#${x.ordinal}`, x.player]));

describe("R1-R3 card", () => {
  test("R1 helper cards are valid 5x5 with B 1-15 ... O 61-75", () => { for (const c of [A, B, C]) expect(isValidCard(c)).toBe(true); });
  test("R2 N column has 4 numbers and FREE centre; other columns 5", () => {
    expect(A[2]![2]).toBeNull(); expect(A.flat().filter((n) => n === null).length).toBe(1);
  });
  test("R3 a card with a wrong number in a column is not valid", () => {
    const bad = mkCard(0).map((r) => [...r]); bad[0]![0] = 16; expect(isValidCard(bad)).toBe(false);
  });
  test("R3 a card with a repeated number or missing FREE is not valid", () => {
    const dup = mkCard(0).map((r) => [...r]); dup[1]![0] = dup[0]![0]!; expect(isValidCard(dup)).toBe(false);
    const nofree = mkCard(0).map((r) => [...r]); nofree[2]![2] = 31; expect(isValidCard(nofree)).toBe(false);
  });
  test("R3 an invalid card cannot be used to start a game", () => {
    const bad = mkCard(0).map((r) => [...r]); bad[0]![0] = 16;
    expect(() => bingoRules.init({ order: orderWith([]), cards: { p: bad }, eid: "e" }, ["p"], 0)).toThrow();
  });
});

describe("R4-R6 calls", () => {
  test("R4 order must be the 75 numbers each once", () => {
    const dup = orderWith([]); dup[1] = dup[0]!;
    expect(() => bingoRules.init({ order: dup, cards: { p: A }, eid: "e" }, ["p"], 0)).toThrow();
    expect(() => bingoRules.init({ order: orderWith([]).slice(0, 74), cards: { p: A }, eid: "e" }, ["p"], 0)).toThrow();
  });
  test("R5 a call is letter + number", () => { expect(callLabel(52)).toBe("G 52"); expect(callLabel(1)).toBe("B 1"); expect(callLabel(75)).toBe("O 75"); expect(callLabel(31)).toBe("N 31"); expect(callLabel(16)).toBe("I 16"); });
  test("R6 first call comes 2 minutes after the start; default gap 9 s", () => {
    const s = bingoRules.init({ order: orderWith([]), cards: { p: A }, eid: "e" }, ["p"], 1000);
    expect(s.nextCallAt).toBe(121_000);
    expect(bingoRules.step(s, { type: "tick" }, 120_999, RUNNING).state.called).toBe(0);
    const s1 = bingoRules.step(s, { type: "tick" }, 121_000, RUNNING).state;
    expect(s1.called).toBe(1); expect(s1.nextCallAt).toBe(130_000);
  });
  test("R6 gaps of 6, 9, 12, 15 seconds are honoured", () => {
    for (const g of [6, 12, 15]) {
      const s = bingoRules.init({ order: orderWith([]), cards: { p: A }, eid: "e", gapSeconds: g }, ["p"], 0);
      const s1 = bingoRules.step(s, { type: "tick" }, 120_000, RUNNING).state;
      expect(s1.nextCallAt - 120_000).toBe(g * 1000);
    }
  });
});

describe("R8-R9 houses", () => {
  // Each pattern is called first, so its completion call is (cells needed - 1), 0-based.
  const cases: [string, number[][], number][] = [
    ["line", [[0, 1, 2, 3, 4]], 4], ["corners", [[0, 4, 20, 24]], 3], ["x", [[0, 6, 12, 18, 24, 4, 8, 16, 20]], 7],
    ["plus", [[10, 11, 12, 13, 14, 2, 7, 17, 22]], 7], ["frame", [[0, 1, 2, 3, 4, 20, 21, 22, 23, 24, 5, 10, 15, 9, 14, 19]], 15],
    ["stamp", [[18, 19, 23, 24]], 3], ["letterL", [[0, 5, 10, 15, 20, 21, 22, 23, 24]], 8], ["letterT", [[0, 1, 2, 3, 4, 7, 12, 17, 22]], 7],
    ["twolines", [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9]], 9], ["blackout", [Array.from({ length: 25 }, (_, i) => i)], 23],
  ];
  for (const [h, [cells], at] of cases) test(`R8 ${h} is met exactly when its squares are marked (FREE counts)`, () => {
    const nums = flatNums(A, cells!), log = orderWith(nums);
    const before = settleFromLog("e", [{ id: "p", cards: [A] }], log.slice(0, at), { [h]: 1 } as any);
    expect(before).toEqual([]);
    const r = settleFromLog("e", [{ id: "p", cards: [A] }], log, { [h]: 1 } as any);
    expect(r.length).toBe(1); expect(r[0]!.idx).toBe(at);
  });
  test("R8 stamp counts a 2x2 block in any corner", () => {
    for (const cells of [[0, 1, 5, 6], [3, 4, 8, 9], [15, 16, 20, 21], [18, 19, 23, 24]])
      expect(settleFromLog("e", [{ id: "p", cards: [A] }], orderWith(flatNums(A, cells)), { stamp: 1 })[0]!.idx).toBe(3);
  });
  test("R8 line counts any row, column or diagonal", () => {
    for (const cells of [[0, 5, 10, 15, 20], [4, 9, 14, 19, 24], [0, 6, 12, 18, 24], [4, 8, 12, 16, 20], [10, 11, 12, 13, 14]])
      expect(settleFromLog("e", [{ id: "p", cards: [A] }], orderWith(flatNums(A, cells)), LINE1)[0]!.idx).toBe(cells.includes(12) ? 3 : 4);
  });
  test("R8 maximum prize lines per house are capped", () => {
    const max = { line: 3, twolines: 2, corners: 3, plus: 2, x: 2, frame: 2, stamp: 3, letterL: 2, letterT: 2, blackout: 2 };
    const all = Object.fromEntries(Object.keys(max).map((h) => [h, 9]));
    const lines = prizeLines(all as any);
    for (const [h, m] of Object.entries(max)) expect(lines.filter((l) => l.startsWith(h + "#")).length).toBe(m);
  });
  test("R9 a new game starts with Line, Four Corners, X and Blackout, one line each", () => {
    expect(bingoRules.prizePositions!({} as any).sort()).toEqual(["blackout#1", "corners#1", "line#1", "x#1"]);
    const s = bingoRules.init({ order: orderWith([]), cards: { p: A }, eid: "e" }, ["p"], 0);
    expect(s.lines.sort()).toEqual(["blackout#1", "corners#1", "line#1", "x#1"]);
  });
  test("R9 the Organizer may change the set and the number of lines", () => {
    expect(bingoRules.prizePositions!({ housesCount: { plus: 2, frame: 1 } } as any).sort()).toEqual(["frame#1", "plus#1", "plus#2"]);
  });
});

describe("R10 no claim needed", () => {
  const order = orderWith(rowOf(A, 0));
  test("R10 the golden button says Claim", () => { expect(bingoRules.goldenButton).toBe("Claim"); });
  test("R10 settleFromLog gives the prize with no claim at all (offline phone)", () => {
    const r = settleFromLog("e", [{ id: "off", cards: [A] }], order, LINE1);
    expect(r.map((x) => [x.house, x.ordinal, x.player, x.idx])).toEqual([["line", 1, "off", 4]]);
  });
  test("R10 the running game gives the prize at the call with no claim event", () => {
    const g = play(bingoRules, { order, cards: { off: A }, eid: "e", housesCount: LINE1 }, ["off"]);
    expect(g.wins["line#1"]).toEqual({ player: "off", call: 5 });
  });
  test("R10 a claim event is accepted and changes nothing", () => {
    const s = bingoRules.init({ order, cards: { p: A }, eid: "e", housesCount: LINE1 }, ["p"], 0);
    const r = bingoRules.step(s, { type: "claim", player: "p", house: "line", fate: 0 } as any, 500_000, RUNNING);
    expect(r.state).toEqual(s); expect(r.out).toEqual([]);
  });
  test("R10 a claim before the house is complete wins nothing", () => {
    let s = bingoRules.init({ order, cards: { p: A }, eid: "e", housesCount: LINE1 }, ["p"], 0);
    s = bingoRules.step(s, { type: "tick" }, 120_000, RUNNING).state;
    const r = bingoRules.step(s, { type: "claim", player: "p", house: "line" } as any, 120_001, RUNNING);
    expect(r.out).toEqual([]); expect(r.state.won).toEqual({});
  });
  test("R10 claims pressed during play do not change who wins or when", () => {
    const setup = { order, cards: { p: A, q: B }, eid: "e", housesCount: { line: 2 } };
    const a = play(bingoRules, setup, ["p", "q"]), b = play(bingoRules, setup, ["p", "q"], { claims: true });
    expect(b.wins).toEqual(a.wins);
  });
  test("R10 a claim from a seat that did not complete (even with a fate) takes no prize", () => {
    const setup = { order, cards: { p: A, q: B }, eid: "e", housesCount: LINE1 };
    const g = play(bingoRules, setup, ["q", "p"], { claims: true }); // claims come from q, which never completes first
    expect(g.wins["line#1"]!.player).toBe("p");
  });
});

describe("R11 completion and cards per seat", () => {
  test("R11 a seat completes at the call where its card first meets the house", () => {
    const r = settleFromLog("e", [{ id: "p", cards: [A] }], orderWith(rowOf(A, 3)), LINE1);
    expect(r[0]!.idx).toBe(4);
  });
  test("R11 Two Lines needs two different lines", () => {
    const one = orderOffCard(rowOf(A, 0), A);
    expect(settleFromLog("e", [{ id: "p", cards: [A] }], one.slice(0, 56), { twolines: 1 })).toEqual([]);
    const two = orderOffCard([...rowOf(A, 0), ...rowOf(A, 1)], A);
    expect(settleFromLog("e", [{ id: "p", cards: [A] }], two, { twolines: 1 })[0]!.idx).toBe(9);
  });
  test("R11 FREE counts: a middle-row line needs only 4 numbers", () => {
    expect(settleFromLog("e", [{ id: "p", cards: [A] }], orderWith(rowOf(A, 2)), LINE1)[0]!.idx).toBe(3);
  });
  test("R11 two cards per seat: the best card counts", () => {
    const order = orderWith([...rowOf(A, 0), ...rowOf(B, 0)]);
    const r = settleFromLog("e", [{ id: "p", cards: [B, A] }], order, LINE1);
    expect(r[0]!.idx).toBe(4);
    const r2 = settleFromLog("e", [{ id: "p", cards: [B] }], order, LINE1);
    expect(r2[0]!.idx).toBe(9);
  });
  test("R11 setup.cards accepts one card or an array of two", () => {
    const order = orderWith(rowOf(B, 0));
    const g = play(bingoRules, { order, cards: { one: A, two: [A, B] }, eid: "e", housesCount: LINE1 }, ["one", "two"]);
    expect(g.wins["line#1"]).toEqual({ player: "two", call: 5 });
  });
  test("R11 more than two cards in a seat is refused", () => {
    expect(() => bingoRules.init({ order: orderWith([]), cards: { p: [A, B, C] }, eid: "e" }, ["p"], 0)).toThrow();
  });
  test("R12 a seat with two completing cards still wins a house once", () => {
    const order = orderWith([...rowOf(A, 0), ...rowOf(B, 0)]);
    const r = settleFromLog("e", [{ id: "p", cards: [A, B] }], order, LINE2);
    expect(r.length).toBe(1);
    const g = play(bingoRules, { order, cards: { p: [A, B] }, eid: "e", housesCount: LINE2 }, ["p"]);
    expect(Object.keys(g.wins)).toEqual(["line#1"]);
  });
});

describe("R12-R13 one winner per line, order of winning", () => {
  const order = orderWith([...rowOf(A, 0), ...rowOf(B, 0), ...rowOf(C, 0)]);
  const seats = [{ id: "c", cards: [C] }, { id: "a", cards: [A] }, { id: "b", cards: [B] }];
  test("R13 earlier call wins the first open line, next call the next line", () => {
    const r = settleFromLog("e", seats, order, { line: 3 });
    expect(wonBy(r)).toEqual({ "line#1": "a", "line#2": "b", "line#3": "c" });
    expect(r.map((x) => x.idx)).toEqual([4, 9, 14]);
  });
  test("R12 each prize line has exactly one winner; no line is shared", () => {
    const r = settleFromLog("e", seats, order, { line: 2 });
    expect(r.length).toBe(2); expect(new Set(r.map((x) => `${x.house}#${x.ordinal}`)).size).toBe(2);
  });
  test("R12 a third seat gets nothing when both lines are taken", () => {
    const r = settleFromLog("e", seats, order, LINE2);
    expect(r.map((x) => x.player)).toEqual(["a", "b"]);
  });
  test("R12 the running game gives each line to one player only", () => {
    const g = play(bingoRules, { order, cards: { a: A, b: B, c: C }, eid: "e", housesCount: { line: 3 } }, ["a", "b", "c"]);
    expect(g.wins).toEqual({ "line#1": { player: "a", call: 5 }, "line#2": { player: "b", call: 10 }, "line#3": { player: "c", call: 15 } });
  });
  test("R12 every seat wins a house once, across prize lines", () => {
    const o = orderWith(rowOf(A, 0));
    const r = settleFromLog("e", [{ id: "a", cards: [A] }], o, { line: 3, blackout: 1 });
    expect(r.filter((x) => x.house === "line").length).toBe(1);
  });
});

describe("R14 tie on the same call, fate = SHA-256", () => {
  const order = orderWith(rowOf(A, 0));
  test("R14 fate string is CB1-TIE|game id|seat|tie|house|line number (independent sha256)", () => {
    const ids = ["p1", "p2"], keys = { p1: 7, p2: 12 };
    const eid = "game-x", exp = expectedTie(eid, ids.map((id) => ({ id, key: (keys as any)[id] })), "line", [1, 2]);
    const r = settleFromLog(eid, ids.map((id) => ({ id, cards: [A], seat: (keys as any)[id] })), order, LINE2);
    expect(wonBy(r)).toEqual({ "line#1": exp[1]!, "line#2": exp[2]! });
    expect(r.every((x) => x.tied === 2)).toBe(true);
  });
  test("R14 three seats tied, two lines: lowest fate takes line 1, lowest of the rest line 2, third gets none", () => {
    const keys = [101, 102, 103], ids = ["x", "y", "z"], eid = "ev-77";
    const exp = expectedTie(eid, ids.map((id, i) => ({ id, key: keys[i]! })), "line", [1, 2]);
    const r = settleFromLog(eid, ids.map((id, i) => ({ id, cards: [A], seat: keys[i] })), order, LINE2);
    expect(wonBy(r)).toEqual({ "line#1": exp[1]!, "line#2": exp[2]! });
  });
  test("R14 seat is the seat number given; the player id when there is none", () => {
    const eid = "e1", ids = ["alpha", "beta", "gamma"];
    const exp = expectedTie(eid, ids.map((id) => ({ id, key: id })), "line", [1]);
    expect(wonBy(settleFromLog(eid, ids.map((id) => ({ id, cards: [A] })), order, LINE1))).toEqual({ "line#1": exp[1]! });
  });
  test("R14 tie winners differ with the seat number, not the player id", () => {
    const eid = "e2", seats = [{ id: "a", key: 5 }, { id: "b", key: 6 }];
    const flip = [{ id: "a", key: 6 }, { id: "b", key: 5 }];
    for (const s of [seats, flip]) {
      const exp = expectedTie(eid, s, "line", [1]);
      expect(wonBy(settleFromLog(eid, s.map((x) => ({ id: x.id, cards: [A], seat: x.key })), order, LINE1))).toEqual({ "line#1": exp[1]! });
    }
  });
  test("R14 the running game uses setup.seats for the tie", () => {
    const eid = "e3", ids = ["p", "q", "r"], keys = { p: 31, q: 32, r: 33 } as Record<string, number>;
    const exp = expectedTie(eid, ids.map((id) => ({ id, key: keys[id]! })), "line", [1, 2]);
    const g = play(bingoRules, { order, cards: { p: A, q: A, r: A }, eid, seats: keys, housesCount: LINE2 }, ids);
    expect(g.wins["line#1"]!.player).toBe(exp[1]!); expect(g.wins["line#2"]!.player).toBe(exp[2]!);
    expect(g.wins["line#1"]!.call).toBe(5); expect(g.wins["line#2"]!.call).toBe(5);
  });
  test("R14 fate differs per line: the order can change between line 1 and line 2 (hash is per line)", () => {
    // find an event id where fates of 2 seats order differently on line 1 and 2, then check the module follows it
    let eid = ""; for (let i = 0; i < 500; i++) { const e = "scan" + i; if ((fate(e, "a", "line", 1) < fate(e, "b", "line", 1)) !== (fate(e, "a", "line", 2) < fate(e, "b", "line", 2))) { eid = e; break; } }
    expect(eid).not.toBe("");
    const exp = expectedTie(eid, [{ id: "a", key: "a" }, { id: "b", key: "b" }], "line", [1, 2]);
    const r = settleFromLog(eid, [{ id: "a", cards: [A] }, { id: "b", cards: [A] }], order, LINE2);
    expect(wonBy(r)).toEqual({ "line#1": exp[1]!, "line#2": exp[2]! });
  });
  test("R14 tied seats take the next lines before any later call", () => {
    const o = orderWith([...rowOf(A, 0), ...rowOf(B, 0)]);
    const seats = [{ id: "a1", cards: [A] }, { id: "a2", cards: [A] }, { id: "b", cards: [B] }];
    const r = settleFromLog("e4", seats, o, { line: 3 });
    expect(r.map((x) => x.player).slice(0, 2).sort()).toEqual(["a1", "a2"]);
    expect(r[2]!.player).toBe("b");
  });
  test("R14 a different house uses its own house name in the fate", () => {
    const eid = "e5", o = orderWith(flatNums(A, [0, 4, 20, 24]));
    const exp = expectedTie(eid, [{ id: "a", key: "a" }, { id: "b", key: "b" }], "corners", [1]);
    expect(wonBy(settleFromLog(eid, [{ id: "a", cards: [A] }, { id: "b", cards: [A] }], o, { corners: 1 }))).toEqual({ "corners#1": exp[1]! });
  });
});

describe("R15 late joiners", () => {
  const callRounds = Array.from({ length: 75 }, (_, k) => Math.floor(k / 10) + 1);
  // Row 0 of A is called at calls 20..24 (beacon round 3); filler numbers come first.
  const filler = Array.from({ length: 75 }, (_, i) => i + 1).filter((n) => !rowOf(A, 0).includes(n) && !A.flat().includes(n)).slice(0, 20);
  const order = orderWith([...filler, ...rowOf(A, 0)]);
  test("R15 countFrom equal to the round of the calls: counts, call number stays global", () => {
    const r = settleFromLog("e", [{ id: "p", cards: [A], countFrom: 3 }], order, LINE1, 1, callRounds);
    expect(r[0]!.idx).toBe(24);
  });
  test("R15 calls before countFrom are treated as not called for that seat", () => {
    const r = settleFromLog("e", [{ id: "p", cards: [A], countFrom: 4 }], order, LINE1, 1, callRounds);
    expect(r.filter((x) => x.house === "line" && x.idx <= 24)).toEqual([]);
  });
  test("R15 a late joiner does not beat an on-time seat that completed in the calls it missed", () => {
    const r = settleFromLog("e", [{ id: "late", cards: [A], countFrom: 4 }, { id: "ontime", cards: [A] }], order, LINE1, 1, callRounds);
    expect(r[0]!.player).toBe("ontime");
  });
  test("R15 without countFrom every call counts", () => {
    expect(settleFromLog("e", [{ id: "p", cards: [A] }], order, LINE1, 1, callRounds)[0]!.idx).toBe(24);
  });
  test("R15 running game honours setup.countFrom and setup.callRounds", () => {
    const g = play(bingoRules, { order, cards: { late: A, ontime: A }, eid: "e", countFrom: { late: 4 }, callRounds, housesCount: LINE1 }, ["late", "ontime"]);
    expect(g.wins["line#1"]).toEqual({ player: "ontime", call: 25 });
    const g2 = play(bingoRules, { order, cards: { late: A }, eid: "e", countFrom: { late: 4 }, callRounds, housesCount: LINE1 }, ["late"]);
    expect(g2.wins["line#1"]).toBeUndefined();
  });
  test("R15 a late joiner with countFrom 3 ties with an on-time seat on the same call", () => {
    const r = settleFromLog("e", [{ id: "late", cards: [A], countFrom: 3 }, { id: "ontime", cards: [A] }], order, LINE2, 1, callRounds);
    expect(r.length).toBe(2); expect(r.every((x) => x.idx === 24 && x.tied === 2)).toBe(true);
  });
});

describe("R16 rounds", () => {
  const order1 = orderWith(rowOf(A, 0)), order2 = orderWith(rowOf(A, 0).slice().reverse());
  const ids = ["a", "b", "c"], keys: Record<string, number> = { a: 1, b: 2, c: 3 };
  const seats = ids.map((id) => ({ id, cards: [A], seat: keys[id] }));
  test("R16 round 1 keeps the game id, round 2 is <id>~r2 (fate strings)", () => {
    const r1 = settleFromLog("G", seats, order1, LINE1, 1), r2 = settleFromLog("G", seats, order2, LINE1, 2);
    expect(r1[0]!.player).toBe(expectedTie("G", ids.map((id) => ({ id, key: keys[id]! })), "line", [1])[1]!);
    expect(r2[0]!.player).toBe(expectedTie("G~r2", ids.map((id) => ({ id, key: keys[id]! })), "line", [1])[1]!);
    expect(r1[0]!.round).toBe(1); expect(r2[0]!.round).toBe(2);
  });
  test("R16 round 3 is G~r3", () => {
    const r3 = settleFromLog("G", seats, order1, LINE1, 3);
    expect(r3[0]!.player).toBe(expectedTie("G~r3", ids.map((id) => ({ id, key: keys[id]! })), "line", [1])[1]!);
  });
  test("R16 settleRounds settles each round on its own log", () => {
    const r = settleRounds("G", seats, [order1, order2], LINE1);
    expect(r.map((x) => x.round)).toEqual([1, 2]);
    expect(r[0]!.player).toBe(settleFromLog("G", seats, order1, LINE1, 1)[0]!.player);
    expect(r[1]!.player).toBe(settleFromLog("G", seats, order2, LINE1, 2)[0]!.player);
  });
  test("R16 a win in one round never affects another: the same seat can win both", () => {
    const one = [{ id: "solo", cards: [A] }];
    const r = settleRounds("G", one, [order1, order1], LINE1);
    expect(r.map((x) => [x.round, x.player])).toEqual([[1, "solo"], [2, "solo"]]);
  });
  test("R16 settleRounds passes callRounds per round", () => {
    const cr = Array.from({ length: 75 }, (_, k) => Math.floor(k / 10) + 1);
    const late = [{ id: "l", cards: [A], countFrom: 2 }];
    const r = settleRounds("G", late, [order1, order1], LINE1, [cr, cr]);
    expect(r.filter((x) => x.house === "line")).toEqual([]);
  });
  test("R16 the running game in round 2 uses G~r2 for fate", () => {
    const exp = expectedTie("G~r2", ids.map((id) => ({ id, key: keys[id]! })), "line", [1]);
    const g = play(bingoRules, { order: order1, cards: { a: A, b: A, c: A }, eid: "G", round: 2, seats: keys, housesCount: LINE1 }, ids);
    expect(g.wins["line#1"]!.player).toBe(exp[1]!);
  });
  test("R16 round 1 explicit round:1 keeps the plain game id", () => {
    const exp = expectedTie("G", ids.map((id) => ({ id, key: keys[id]! })), "line", [1]);
    const g = play(bingoRules, { order: order1, cards: { a: A, b: A, c: A }, eid: "G", round: 1, seats: keys, housesCount: LINE1 }, ids);
    expect(g.wins["line#1"]!.player).toBe(exp[1]!);
  });
});

describe("R17 settlement at each call, game end, pause", () => {
  const cardsFor = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`p${i}`, mkCard((i * 7) % 15 + (i % 3))]));
  test("R17 the running game equals settleFromLog over the full order (same winners, same call)", () => {
    const order = orderWith([8, 31, 62, 3, 47, 19, 70, 25, 54, 11].concat(Array.from({ length: 30 }, (_, i) => ((i * 37) % 75) + 1)));
    const cards = cardsFor(14), ids = Object.keys(cards), houses = { line: 2, corners: 2, x: 1, blackout: 2, frame: 1 };
    const g = play(bingoRules, { order, cards, eid: "EQ", housesCount: houses }, ids);
    const r = settleFromLog("EQ", ids.map((id) => ({ id, cards: [cards[id]!] })), order, houses);
    for (const x of r) expect(g.wins[`${x.house}#${x.ordinal}`]).toEqual({ player: x.player, call: x.idx + 1 });
    expect(Object.keys(g.wins).length).toBe(r.length);
  });
  test("R17 the running game equals settleFromLog with late joiners, seats and two cards", () => {
    const order = orderWith([5, 20, 35, 50, 65, 10, 25, 40, 55, 70]);
    const callRounds = Array.from({ length: 75 }, (_, k) => Math.floor(k / 5) + 1);
    const cards: Record<string, any> = { a: mkCard(0), b: [mkCard(3), mkCard(9)], c: mkCard(6), d: mkCard(12) };
    const seats: Record<string, number> = { a: 40, b: 41, c: 42, d: 43 }, countFrom = { c: 4, d: 8 }, houses = { line: 3, corners: 1, blackout: 1, stamp: 2 };
    const g = play(bingoRules, { order, cards, eid: "EQ2", seats, countFrom, callRounds, housesCount: houses }, Object.keys(cards));
    const r = settleFromLog("EQ2", Object.keys(cards).map((id) => ({ id, cards: Array.isArray(cards[id][0][0]) ? cards[id] : [cards[id]], seat: seats[id], countFrom: (countFrom as any)[id] })), order, houses, 1, callRounds);
    for (const x of r) expect(g.wins[`${x.house}#${x.ordinal}`]).toEqual({ player: x.player, call: x.idx + 1 });
    expect(Object.keys(g.wins).length).toBe(r.length);
  });
  test("R17 settleRounds equals the running game round by round", () => {
    const o1 = orderWith([1, 16, 31, 46, 61, 2, 17, 32, 47, 62]), o2 = orderWith([75, 60, 45, 30, 15, 74, 59, 44, 29, 14]);
    const cards = cardsFor(8), ids = Object.keys(cards), houses = { line: 2, corners: 1, blackout: 1 };
    const seats = ids.map((id) => ({ id, cards: [cards[id]!] }));
    const rr = settleRounds("RR", seats, [o1, o2], houses);
    [o1, o2].forEach((o, i) => {
      const g = play(bingoRules, { order: o, cards, eid: "RR", round: i + 1, housesCount: houses }, ids);
      const mine = rr.filter((x) => x.round === i + 1);
      for (const x of mine) expect(g.wins[`${x.house}#${x.ordinal}`]).toEqual({ player: x.player, call: x.idx + 1 });
      expect(Object.keys(g.wins).length).toBe(mine.length);
    });
  });
  test("R17 a win is given at the call itself, not later", () => {
    const order = orderWith(rowOf(A, 0));
    let s = bingoRules.init({ order, cards: { p: A }, eid: "e", housesCount: { line: 1, blackout: 1 } }, ["p"], 0), t = 0, outs: any[] = [];
    for (let i = 0; i < 4; i++) { t = s.nextCallAt; const r = bingoRules.step(s, { type: "tick" }, t, RUNNING); s = r.state; outs.push(...r.out); }
    expect(outs).toEqual([]);
    const r = bingoRules.step(s, { type: "tick" }, s.nextCallAt, RUNNING);
    expect(r.out).toEqual([{ kind: "win", player: "p", position: "line#1" }]);
  });
  test("R17 the game ends when every prize line has a winner", () => {
    const g = play(bingoRules, { order: orderWith(rowOf(A, 0)), cards: { p: A }, eid: "e", housesCount: LINE1 }, ["p"]);
    expect(g.ends).toBe(1); expect(g.endCall).toBe(5); expect(g.state.over).toBe(true);
  });
  test("R17 the game ends when call 75 is settled, with no extra call for late claims", () => {
    const order = orderWith([]), late = Array.from({ length: 75 }, () => 1);
    const setup = { order, cards: { p: A }, eid: "e", countFrom: { p: 5 }, callRounds: late, housesCount: LINE1 };
    let s = bingoRules.init(setup, ["p"], 0), ends = 0, endAt = -1;
    for (let i = 0; i < 80 && !s.over; i++) { const r = bingoRules.step(s, { type: "tick" }, s.nextCallAt, RUNNING); s = r.state; if (r.out.some((o: any) => o.kind === "end")) { ends++; endAt = s.called; } }
    expect(s.called).toBe(75); expect(s.over).toBe(true); expect(ends).toBe(1); expect(endAt).toBe(75);
  });
  test("R17 the 75th call's winners are still settled before the game ends", () => {
    // a seat whose Blackout is only completed by the last number
    const order = orderOffCard([], A); // 51 numbers off the card, then its 24: Blackout completes at call 75
    const g = play(bingoRules, { order, cards: { p: A }, eid: "e", housesCount: { blackout: 1 } }, ["p"]);
    expect(g.wins["blackout#1"]).toEqual({ player: "p", call: 75 });
    expect(g.ends).toBe(1);
  });
  test("R17 after the game is over, ticks and claims do nothing", () => {
    const g = play(bingoRules, { order: orderWith(rowOf(A, 0)), cards: { p: A }, eid: "e", housesCount: LINE1 }, ["p"]);
    for (const e of [{ type: "tick" }, { type: "claim", player: "p", house: "line" }, { type: "settle" }] as any[]) {
      const r = bingoRules.step(g.state, e, 9_999_999, RUNNING); expect(r.out).toEqual([]); expect(r.state).toEqual(g.state);
    }
  });
  test("R7 while paused nothing is called and nothing settles", () => {
    const order = orderWith(rowOf(A, 0));
    const s = bingoRules.init({ order, cards: { p: A }, eid: "e", housesCount: LINE1 }, ["p"], 0);
    const paused = { phase: "paused", frozenAt: 50_000, pausedMs: 0, pauses: [] } as any;
    for (const e of [{ type: "tick" }, { type: "settle" }, { type: "claim", player: "p", house: "line" }] as any[]) {
      const r = bingoRules.step(s, e, 9_999_999, paused); expect(r.state.called).toBe(0); expect(r.out).toEqual([]);
    }
  });
  test("R17 while paused a settle does not give a prize already complete", () => {
    const order = orderWith(rowOf(A, 0));
    let s = bingoRules.init({ order, cards: { p: A }, eid: "e", housesCount: LINE1 }, ["p"], 0);
    for (let i = 0; i < 4; i++) s = bingoRules.step(s, { type: "tick" }, s.nextCallAt, RUNNING).state;
    const paused = { phase: "paused", frozenAt: 600_000, pausedMs: 0, pauses: [] } as any;
    expect(bingoRules.step(s, { type: "tick" }, 700_000, paused)).toEqual({ state: s, out: [] });
  });
  test("R7 after Resume the gaps carry on from where they stopped", () => {
    const s = bingoRules.init({ order: orderWith([]), cards: { p: A }, eid: "e" }, ["p"], 0);
    // paused from 100 000 to 500 000 (400 000 ms), so the first call is due at wall time 520 000
    const resumed = { phase: "running", frozenAt: null, pausedMs: 400_000, pauses: [{ role: "organizer", from: 100_000, to: 500_000 }] } as any;
    expect(bingoRules.step(s, { type: "tick" }, 519_999, resumed).state.called).toBe(0);
    const s1 = bingoRules.step(s, { type: "tick" }, 520_000, resumed).state;
    expect(s1.called).toBe(1);
    expect(bingoRules.step(s1, { type: "tick" }, 528_999, resumed).state.called).toBe(1);
    expect(bingoRules.step(s1, { type: "tick" }, 529_000, resumed).state.called).toBe(2);
  });
  test("R7 a pause in the middle of play freezes the next call time", () => {
    let s = bingoRules.init({ order: orderWith([]), cards: { p: A }, eid: "e" }, ["p"], 0);
    s = bingoRules.step(s, { type: "tick" }, 120_000, RUNNING).state;
    const paused = { phase: "paused", frozenAt: 125_000, pausedMs: 0, pauses: [] } as any;
    expect(bingoRules.step(s, { type: "tick" }, 900_000, paused).state.called).toBe(1);
  });
});

describe("R17 conformance", () => {
  test("R17 bun tools/conformance.ts passes for Bingo", () => {
    const p = Bun.spawnSync(["bun", "tools/conformance.ts"], { cwd: new URL("../..", import.meta.url).pathname });
    const out = p.stdout.toString() + p.stderr.toString();
    expect(out).not.toMatch(/bingo:/); expect(p.exitCode).toBe(0); expect(out).toContain("conformance ok");
  });
});
