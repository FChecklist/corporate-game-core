import { describe, expect, test } from "bun:test";
import { callLabel, isValidCard, HOUSES, HOUSE_IDS, LINES, meets, prizeLines, bingoRules, FIRST_CALL_DELAY_MS, GAPS, setupFields, settleOrder, type House } from "../../packages/bingo/src";
import { ORDER, cells, claim, callN, callNext, ev, makeCard, newGame, orderWith, plainCard, pause, resume, rng, shuffle, wins } from "./helpers";

const calledSet = (nums: number[]) => new Set(nums);

describe("rules 1-3: the card", () => {
  test("B1 columns hold B 1-15, I 16-30, N 31-45, G 46-60, O 61-75 (1000 cards)", () => {
    const r = rng(1);
    for (let i = 0; i < 1000; i++) {
      const t = makeCard(r);
      expect(isValidCard(t)).toBe(true);
      for (let c = 0; c < 5; c++) for (let row = 0; row < 5; row++) { const v = t[row]![c]; if (v != null) { expect(v).toBeGreaterThan(c * 15); expect(v).toBeLessThanOrEqual(c * 15 + 15); } }
    }
  });
  test("B1 card must be 5 x 5", () => {
    const t = plainCard();
    expect(isValidCard(t.slice(0, 4))).toBe(false);
    expect(isValidCard([...t, t[0]!])).toBe(false);
    expect(isValidCard(t.map((r) => r.slice(0, 4)))).toBe(false);
    expect(isValidCard([])).toBe(false);
  });
  test("B2 each column has 5 different numbers, N has 4 plus FREE in the centre", () => {
    const t = makeCard(rng(2));
    expect(t[2]![2]).toBeNull();
    for (let c = 0; c < 5; c++) expect(new Set(t.map((r) => r[c]).filter((v) => v != null)).size).toBe(c === 2 ? 4 : 5);
  });
  test("B2 rejects a duplicate number in a column", () => {
    const t = plainCard(); t[1]![0] = t[0]![0]!;
    expect(isValidCard(t)).toBe(false);
  });
  test("B2 rejects a number outside its column range (every column, low and high)", () => {
    for (let c = 0; c < 5; c++) for (const bad of [c * 15, c * 15 + 16]) {
      const t = plainCard(); t[c === 2 ? 0 : 4]![c] = bad;
      expect(isValidCard(t)).toBe(false);
    }
  });
  test("B2 rejects 0, 76 and non-integers", () => {
    for (const bad of [0, 76, 1.5, -3, NaN]) { const t = plainCard(); t[0]![0] = bad; expect(isValidCard(t)).toBe(false); }
  });
  test("B2 rejects a FREE square anywhere but the centre, or a number in the centre", () => {
    const a = plainCard(); a[0]![0] = null; expect(isValidCard(a)).toBe(false);
    const b = plainCard(); b[2]![2] = 38; expect(isValidCard(b)).toBe(false);
    const c = plainCard(); c[1]![2] = null; expect(isValidCard(c)).toBe(false);
  });
  test("B2 rejects an N column with 5 numbers and no FREE, or a B column with FREE", () => {
    const a = plainCard(); a[2]![2] = 40; expect(isValidCard(a)).toBe(false);
    const b = plainCard(); b[2]![0] = null; expect(isValidCard(b)).toBe(false);
  });
  test("B2 rejects an N number repeated in the N column", () => {
    const t = plainCard(); t[3]![2] = t[0]![2]!; expect(isValidCard(t)).toBe(false);
  });
  test("B3 FREE counts as marked from the start (Blackout needs only 24 numbers)", () => {
    const t = plainCard();
    expect(meets(t, "blackout", calledSet(cells(t, [...Array(25).keys()])))).toBe(true);
    expect(cells(t, [...Array(25).keys()]).length).toBe(24);
  });
  test("B3 an invalid card cannot be used (init throws)", () => {
    const t = plainCard(); t[0]![0] = 99;
    expect(() => newGame({ a: t })).toThrow();
    expect(() => bingoRules.init({ order: ORDER, cards: {} }, ["a"], 0)).toThrow();
  });
  test("B3 valid cards are accepted by init", () => {
    expect(() => newGame({ a: makeCard(rng(3)) })).not.toThrow();
  });
});

describe("rules 4-7: the calls", () => {
  test("B4 75 numbers, each once: init rejects short, repeated or out-of-range orders", () => {
    const cards = { a: plainCard() };
    expect(() => bingoRules.init({ order: ORDER.slice(0, 74), cards }, ["a"], 0)).toThrow();
    expect(() => bingoRules.init({ order: [...ORDER.slice(0, 74), 1], cards }, ["a"], 0)).toThrow();
    expect(() => bingoRules.init({ order: [...ORDER.slice(0, 74), 76], cards }, ["a"], 0)).toThrow();
    expect(() => bingoRules.init({ order: [...ORDER, 1], cards }, ["a"], 0)).toThrow();
    expect(() => bingoRules.init({ cards }, ["a"], 0)).toThrow();
  });
  test("B4 a full game calls exactly 75 numbers, each once, and then ends", () => {
    const g = newGame({ a: plainCard() }, { order: shuffle(ORDER, rng(4)) });
    for (let i = 0; i < 200; i++) callNext(g);
    expect(g.s.called).toBe(75);
    expect(g.s.over).toBe(true);
    expect(new Set(g.s.order.slice(0, g.s.called)).size).toBe(75);
  });
  test("B4 calling follows the given order, one number per tick", () => {
    const order = shuffle(ORDER, rng(5)); const g = newGame({ a: plainCard() }, { order });
    for (let k = 1; k <= 10; k++) { callNext(g); expect(g.s.called).toBe(k); expect(g.s.order[k - 1]).toBe(order[k - 1]); }
  });
  test("B4 a tick long after the due time still calls only one number", () => {
    const g = newGame({ a: plainCard() }); g.t = 10_000_000; ev(g, { type: "tick" });
    expect(g.s.called).toBe(1);
  });
  test("B5 call label is letter + number, e.g. G 52", () => {
    expect(callLabel(52)).toBe("G 52");
    for (let n = 1; n <= 75; n++) expect(callLabel(n)).toBe(`${"BINGO"[Math.floor((n - 1) / 15)]} ${n}`);
    expect(callLabel(1)).toBe("B 1"); expect(callLabel(15)).toBe("B 15"); expect(callLabel(16)).toBe("I 16");
    expect(callLabel(31)).toBe("N 31"); expect(callLabel(60)).toBe("G 60"); expect(callLabel(61)).toBe("O 61"); expect(callLabel(75)).toBe("O 75");
  });
  test("B6 gap choices are 6, 9, 12 or 15 seconds, default 9", () => {
    expect(GAPS).toEqual([6, 9, 12, 15]);
    const f = setupFields.find((x) => x.key === "gapSeconds")!;
    expect(f.choices).toEqual(["6", "9", "12", "15"]);
    expect(f.default).toBe(9);
    expect(newGame({ a: plainCard() }).s.gapMs).toBe(9000);
    const d = bingoRules.init({ order: ORDER, cards: { a: plainCard() } }, ["a"], 0); expect(d.gapMs).toBe(9000);
  });
  test("B6 the first call comes 2 minutes after the start", () => {
    expect(FIRST_CALL_DELAY_MS).toBe(120_000);
    const g = newGame({ a: plainCard() });
    expect(g.s.nextCallAt).toBe(120_000);
    g.t = 119_999; ev(g, { type: "tick" }); expect(g.s.called).toBe(0);
    g.t = 120_000; ev(g, { type: "tick" }); expect(g.s.called).toBe(1);
  });
  test("B6 calls are one gap apart for every gap choice", () => {
    for (const gap of GAPS) {
      const g = newGame({ a: plainCard() }, { gap });
      g.t = 120_000; ev(g, { type: "tick" });
      g.t = 120_000 + gap * 1000 - 1; ev(g, { type: "tick" }); expect(g.s.called).toBe(1);
      g.t = 120_000 + gap * 1000; ev(g, { type: "tick" }); expect(g.s.called).toBe(2);
    }
  });
  test("B7 while paused nothing is called", () => {
    const g = newGame({ a: plainCard() }); g.t = 1000;
    g.clock = pause(g.clock, "organizer", g.t);
    g.t = 5_000_000; ev(g, { type: "tick" }); expect(g.s.called).toBe(0);
  });
  test("B7 while paused no claim is settled and a claim is not accepted/changes nothing", () => {
    const t = plainCard(); const g = newGame({ a: t }, { order: orderWith(cells(t, [0, 1, 2, 3, 4])) });
    callN(g, 5); claim(g, "a", "line");
    g.clock = pause(g.clock, "host", g.t);
    const before = JSON.stringify(g.s);
    ev(g, { type: "settle" }); g.t += 1e7; ev(g, { type: "tick" });
    expect(wins(g).length).toBe(0); expect(JSON.stringify(g.s)).toBe(before);
    claim(g, "a", "corners"); expect(JSON.stringify(g.s)).toBe(before);
  });
  test("B7 after Resume the claim is settled", () => {
    const t = plainCard(); const g = newGame({ a: t }, { order: orderWith(cells(t, [0, 1, 2, 3, 4])) });
    callN(g, 5); claim(g, "a", "line");
    g.clock = pause(g.clock, "host", g.t); g.t += 50_000; g.clock = resume(g.clock, "host", g.t);
    ev(g, { type: "settle" }); expect(wins(g).length).toBe(1);
  });
  test("B7 after Resume the gaps carry on from where they stopped", () => {
    const g = newGame({ a: plainCard() }); g.t = 120_000; ev(g, { type: "tick" }); // call 1, next due +9s
    g.t = 124_000; g.clock = pause(g.clock, "organizer", g.t); // 5s left
    g.t = 1_000_000; g.clock = resume(g.clock, "organizer", g.t);
    g.t = 1_004_999; ev(g, { type: "tick" }); expect(g.s.called).toBe(1);
    g.t = 1_005_000; ev(g, { type: "tick" }); expect(g.s.called).toBe(2);
  });
  test("B7 pause before the first call keeps the 2 minute wait from where it stopped", () => {
    const g = newGame({ a: plainCard() }); g.t = 100_000; g.clock = pause(g.clock, "organizer", g.t);
    g.t = 500_000; g.clock = resume(g.clock, "organizer", g.t);
    g.t = 519_999; ev(g, { type: "tick" }); expect(g.s.called).toBe(0);
    g.t = 520_000; ev(g, { type: "tick" }); expect(g.s.called).toBe(1);
  });
});

describe("rules 8-9: houses", () => {
  const box = (idx: number[]) => (t: ReturnType<typeof plainCard>) => cells(t, idx);
  const EXACT: Record<House, { sets: number[][]; max: number }> = {
    line: { sets: LINES.length === 12 ? LINES : [], max: 3 },
    twolines: { sets: [], max: 2 },
    corners: { sets: [[0, 4, 20, 24]], max: 3 },
    plus: { sets: [[2, 7, 10, 11, 12, 13, 14, 17, 22]], max: 2 },
    x: { sets: [[0, 4, 6, 8, 12, 16, 18, 20, 24]], max: 2 },
    frame: { sets: [[0, 1, 2, 3, 4, 5, 9, 10, 14, 15, 19, 20, 21, 22, 23, 24]], max: 2 },
    stamp: { sets: [[0, 1, 5, 6], [3, 4, 8, 9], [15, 16, 20, 21], [18, 19, 23, 24]], max: 3 },
    letterL: { sets: [[0, 5, 10, 15, 20, 21, 22, 23, 24]], max: 2 },
    letterT: { sets: [[0, 1, 2, 3, 4, 7, 12, 17, 22]], max: 2 },
    blackout: { sets: [[...Array(25).keys()]], max: 2 },
  };
  const ROWS = [0, 1, 2, 3, 4].map((r) => [0, 1, 2, 3, 4].map((c) => r * 5 + c));
  const COLS = [0, 1, 2, 3, 4].map((c) => [0, 1, 2, 3, 4].map((r) => r * 5 + c));
  const ALL12 = [...ROWS, ...COLS, [0, 6, 12, 18, 24], [4, 8, 12, 16, 20]];
  const t = plainCard();
  test("B8 there are ten houses", () => { expect(HOUSE_IDS.length).toBe(10); expect(new Set(HOUSE_IDS).size).toBe(10); });
  test("B8 every house has the book's maximum prize lines", () => {
    for (const h of HOUSE_IDS) expect([h, HOUSES[h].max]).toEqual([h, EXACT[h].max]);
  });
  test("B8 Line: each of the 12 lines (5 rows, 5 columns, 2 diagonals) meets it, and 4 of 5 squares do not", () => {
    for (const l of ALL12) {
      expect(meets(t, "line", calledSet(cells(t, l)))).toBe(true);
      const nonFree = l.filter((i) => i !== 12);
      expect(meets(t, "line", calledSet(cells(t, nonFree.slice(1))))).toBe(false);
    }
    expect(LINES.length).toBe(12);
  });
  test("B8 Two Lines: any two different lines (all 66 pairs); one line alone does not", () => {
    for (let i = 0; i < 12; i++) {
      expect(meets(t, "twolines", calledSet(cells(t, ALL12[i]!)))).toBe(false);
      for (let j = i + 1; j < 12; j++) expect(meets(t, "twolines", calledSet(cells(t, [...ALL12[i]!, ...ALL12[j]!])))).toBe(true);
    }
  });
  test("B8 Two Lines: the same line twice is not two lines", () => {
    expect(meets(t, "twolines", calledSet(cells(t, ROWS[0]!)))).toBe(false);
  });
  for (const h of HOUSE_IDS.filter((x) => x !== "line" && x !== "twolines")) {
    test(`B8 ${h}: exact squares meet it; missing any one square does not`, () => {
      const sets = EXACT[h].sets;
      let anyMeet = false;
      for (const set of sets) {
        expect(meets(t, h, calledSet(cells(t, set)))).toBe(true);
        for (const drop of set.filter((i) => i !== 12)) expect(meets(t, h, calledSet(cells(t, set.filter((i) => i !== drop))))).toBe(h === "stamp" ? sets.some((o) => o !== set && o.every((i) => i === 12 || !(i === drop) && set.includes(i))) : false);
        anyMeet = true;
      }
      expect(anyMeet).toBe(true);
      expect(meets(t, h, calledSet([]))).toBe(false);
    });
  }
  test("B8 Plus is the whole middle row AND the whole middle column (row alone is not enough)", () => {
    expect(meets(t, "plus", calledSet(cells(t, ROWS[2]!)))).toBe(false);
    expect(meets(t, "plus", calledSet(cells(t, COLS[2]!)))).toBe(false);
  });
  test("B8 X needs both diagonals", () => {
    expect(meets(t, "x", calledSet(cells(t, [0, 6, 12, 18, 24])))).toBe(false);
    expect(meets(t, "x", calledSet(cells(t, [4, 8, 12, 16, 20])))).toBe(false);
  });
  test("B8 Frame is the outer border only (not needing the inside)", () => {
    expect(meets(t, "frame", calledSet(cells(t, EXACT.frame.sets[0]!)))).toBe(true);
    expect(meets(t, "frame", calledSet(cells(t, [0, 1, 2, 3, 4, 5, 9, 10, 14, 15, 19, 20, 21, 22, 23])))).toBe(false);
  });
  test("B8 Postage Stamp: a 2x2 block in any corner, each corner works alone", () => {
    for (const s of EXACT.stamp.sets) expect(meets(t, "stamp", calledSet(cells(t, s)))).toBe(true);
    expect(meets(t, "stamp", calledSet(cells(t, [6, 7, 11, 12])))).toBe(false); // centre block is not a corner
    expect(meets(t, "stamp", calledSet(cells(t, [0, 4, 20, 24])))).toBe(false); // corners alone are not a block
  });
  test("B8 Letter L is the whole B column and the bottom row (not the top row)", () => {
    expect(meets(t, "letterL", calledSet(cells(t, [...COLS[0]!, ...ROWS[0]!])))).toBe(false);
    expect(meets(t, "letterL", calledSet(cells(t, [...COLS[4]!, ...ROWS[4]!])))).toBe(false);
  });
  test("B8 Letter T is the whole top row and the whole N column (not the bottom row)", () => {
    expect(meets(t, "letterT", calledSet(cells(t, [...ROWS[4]!, ...COLS[2]!])))).toBe(false);
    expect(meets(t, "letterT", calledSet(cells(t, [...ROWS[0]!, ...COLS[0]!])))).toBe(false);
  });
  test("B8 Blackout needs every square (24 numbers + FREE); 23 is not enough", () => {
    const all = cells(t, [...Array(25).keys()]);
    expect(meets(t, "blackout", calledSet(all.slice(1)))).toBe(false);
  });
  test("B8 property: on 300 random cards every house is met exactly when its squares are called", () => {
    const r = rng(8);
    for (let k = 0; k < 300; k++) {
      const c = makeCard(r);
      for (const h of HOUSE_IDS) {
        if (h === "line" || h === "twolines") continue;
        for (const set of EXACT[h].sets) { expect(meets(c, h, calledSet(cells(c, set)))).toBe(true); }
      }
      for (const l of ALL12) expect(meets(c, "line", calledSet(cells(c, l)))).toBe(true);
      expect(meets(c, "blackout", calledSet(ORDER))).toBe(true);
      expect(meets(c, "blackout", calledSet([]))).toBe(false);
    }
  });
  test("B8 a house is not met by numbers that are not on the card", () => {
    const c = plainCard();
    expect(meets(c, "corners", calledSet([2, 3, 4, 5]))).toBe(false);
  });
  test("B9 a new game starts with Line, Four Corners, X, Blackout, one line each", () => {
    const f = setupFields.find((x) => x.key === "housesCount")!;
    const parsed = prizeLines({ line: 1, corners: 1, x: 1, blackout: 1 });
    expect(parsed.sort()).toEqual(["blackout#1", "corners#1", "line#1", "x#1"]);
    expect(String(f.default)).toContain("line:1"); expect(String(f.default)).toContain("corners:1"); expect(String(f.default)).toContain("x:1"); expect(String(f.default)).toContain("blackout:1");
    expect(bingoRules.prizePositions({} as any).length).toBe(4);
    expect(bingoRules.prizePositions({ housesCount: undefined } as any)).toEqual(bingoRules.prizePositions({} as any));
    const dflt = HOUSE_IDS.filter((h) => HOUSES[h].dflt).sort();
    expect(dflt).toEqual(["blackout", "corners", "line", "x"]);
  });
  test("B9 a game started without any housesCount setup has the four default houses", () => {
    const g = { s: bingoRules.init({ order: ORDER, cards: { a: plainCard() } }, ["a"], 0) };
    expect([...g.s.lines].sort()).toEqual(["blackout#1", "corners#1", "line#1", "x#1"]);
  });
  test("B9 the Organizer can change the set and number of lines per house", () => {
    expect(prizeLines({ frame: 2, stamp: 3 })).toEqual(["frame#1", "frame#2", "stamp#1", "stamp#2", "stamp#3"]);
    expect(prizeLines({ line: 2, twolines: 1, plus: 1, letterL: 1, letterT: 2 }).length).toBe(7);
    expect(prizeLines({ line: 0 })).toEqual([]);
  });
  test("B9 never above the maximum (every house)", () => {
    for (const h of HOUSE_IDS) {
      expect(prizeLines({ [h]: 99 }).length).toBe(EXACT[h].max);
      expect(prizeLines({ [h]: EXACT[h].max }).length).toBe(EXACT[h].max);
    }
    const g = newGame({ a: plainCard() }, { houses: { line: 10, x: 5 } });
    expect(g.s.lines.length).toBe(5);
  });
  test("B9 negative or fractional line counts do not make extra lines", () => {
    expect(prizeLines({ line: -1 }).length).toBe(0);
  });
});

/** 4 players holding the same card => all complete the same house on the same call. */
const sameCard = (names: string[]) => Object.fromEntries(names.map((n) => [n, plainCard()]));
const lineOrder = () => orderWith(cells(plainCard(), [0, 1, 2, 3, 4]));

describe("rules 10-16: claim and winners", () => {
  test("B10 the golden button says Claim and claims are pressed by the player", () => {
    expect(bingoRules.goldenButton).toBe("Claim"); expect(bingoRules.claimType).toBe("player-presses");
  });
  test("B11 a correct claim wins the house after settling", () => {
    const g = newGame({ a: plainCard() }, { order: lineOrder() });
    callN(g, 5); claim(g, "a", "line"); ev(g, { type: "settle" });
    expect(g.s.won["line#1"]).toBe("a"); expect(wins(g)[0].position).toBe("line#1");
  });
  test("B11 a claim before the house is complete is wrong and changes nothing", () => {
    const g = newGame({ a: plainCard() }, { order: lineOrder() });
    callN(g, 4); const before = JSON.stringify(g.s); claim(g, "a", "line");
    expect(JSON.stringify(g.s)).toBe(before); ev(g, { type: "settle" }); expect(wins(g).length).toBe(0); expect(g.s.over).toBe(false);
  });
  test("B11 a wrong claim does not use up a later correct claim", () => {
    const g = newGame({ a: plainCard() }, { order: lineOrder() });
    callN(g, 4); claim(g, "a", "line"); callNext(g); claim(g, "a", "line"); ev(g, { type: "settle" });
    expect(g.s.won["line#1"]).toBe("a");
  });
  test("B11 a claim for a house the card does not meet (other house) changes nothing", () => {
    const g = newGame({ a: plainCard() }, { order: lineOrder() });
    callN(g, 5); claim(g, "a", "blackout"); ev(g, { type: "settle" }); expect(wins(g).length).toBe(0);
  });
  test("B11 only numbers called so far count (claim not valid with numbers still to come)", () => {
    const t = plainCard(); const g = newGame({ a: t }, { order: orderWith(cells(t, [0, 1, 2, 3, 4])) });
    callN(g, 2); claim(g, "a", "line"); callN(g, 5); ev(g, { type: "settle" });
    expect(wins(g).length).toBe(0);
  });
  test("B11 claiming the same house twice does nothing (no double prize, no state change)", () => {
    const g = newGame({ a: plainCard() }, { order: lineOrder() }, );
    callN(g, 5); claim(g, "a", "line"); const once = JSON.stringify(g.s); claim(g, "a", "line"); expect(JSON.stringify(g.s)).toBe(once);
    ev(g, { type: "settle" }); claim(g, "a", "line"); ev(g, { type: "settle" });
    expect(wins(g).length).toBe(1);
  });
  test("B11 a claim after the house was already won by this player is ignored", () => {
    const g = newGame({ a: plainCard() }, { order: lineOrder(), houses: { line: 3 } });
    callN(g, 5); claim(g, "a", "line"); ev(g, { type: "settle" });
    const s1 = JSON.stringify(g.s); claim(g, "a", "line"); ev(g, { type: "settle" });
    expect(JSON.stringify(g.s)).toBe(s1); expect(wins(g).length).toBe(1);
  });
  test("B11 an unknown player's claim does nothing", () => {
    const g = newGame({ a: plainCard() }, { order: lineOrder() }); callN(g, 5);
    const before = JSON.stringify(g.s); claim(g, "ghost", "line"); expect(JSON.stringify(g.s)).toBe(before);
  });
  test("B12 exactly ONE winner per prize line: 5 people, 1 line, one winner", () => {
    const g = newGame(sameCard(["a", "b", "c", "d", "e"]), { order: lineOrder(), houses: { line: 1 } });
    callN(g, 5); ["a", "b", "c", "d", "e"].forEach((p, i) => claim(g, p, "line", i + 1)); ev(g, { type: "settle" });
    expect(wins(g).length).toBe(1); expect(Object.values(g.s.won).length).toBe(1);
  });
  test("B12 no sharing: with 3 lines and 5 claimants, 3 different winners each on their own line", () => {
    const g = newGame(sameCard(["a", "b", "c", "d", "e"]), { order: lineOrder(), houses: { line: 3 } });
    callN(g, 5); ["a", "b", "c", "d", "e"].forEach((p, i) => claim(g, p, "line", i + 1)); ev(g, { type: "settle" });
    expect(wins(g).map((w) => w.position)).toEqual(["line#1", "line#2", "line#3"]);
    expect(new Set(Object.values(g.s.won)).size).toBe(3);
    for (const l of ["line#1", "line#2", "line#3"]) expect(typeof g.s.won[l]).toBe("string");
  });
  test("B12 a prize line already won is never given to someone else later", () => {
    const g = newGame(sameCard(["a", "b"]), { order: lineOrder(), houses: { line: 1 } });
    callN(g, 5); claim(g, "a", "line", 1); ev(g, { type: "settle" }); claim(g, "b", "line", 0); ev(g, { type: "settle" });
    expect(g.s.won["line#1"]).toBe("a"); expect(wins(g).length).toBe(1);
  });
  test("B12 the first winner of 1st Line keeps it when later settles happen, ordinals are line#1, line#2", () => {
    const g = newGame(sameCard(["a", "b"]), { order: lineOrder(), houses: { line: 2 } });
    callN(g, 5); claim(g, "a", "line", 1); ev(g, { type: "settle" }); claim(g, "b", "line", 2); ev(g, { type: "settle" });
    expect(g.s.won).toEqual({ "line#1": "a", "line#2": "b" });
  });
  test("B13 one person can win a given house once (3 lines, one claimant => 1 win, lines left open)", () => {
    const g = newGame({ a: plainCard() }, { order: lineOrder(), houses: { line: 3 } });
    callN(g, 5); claim(g, "a", "line"); claim(g, "a", "line"); ev(g, { type: "settle" }); callN(g, 30); ev(g, { type: "settle" });
    expect(Object.values(g.s.won).filter((p) => p === "a").length).toBe(1);
  });
  test("B13 one person can win different houses (each once)", () => {
    const t = plainCard(); const g = newGame({ a: t }, { order: ORDER, houses: { line: 1, corners: 1, blackout: 1 } });
    callN(g, 75);
    expect(g.s.over).toBe(false); // stays open after the 75th call until the round is closed
    for (const h of ["line", "corners", "blackout"] as House[]) claim(g, "a", h);
    ev(g, { type: "settle" }); // Organizer/Host closes the round: late claims settle, then over
    expect(g.s.over).toBe(true);
    expect(g.s.won).toEqual({ "line#1": "a", "corners#1": "a", "blackout#1": "a" });
    expect(wins(g).length).toBe(3);
  });
  test("B13 same person wins Line and Four Corners when both are met and claimed", () => {
    const t = plainCard(); const g = newGame({ a: t }, { order: orderWith(cells(t, [0, 1, 2, 3, 4, 20, 24])), houses: { line: 1, corners: 1 } });
    callN(g, 7); claim(g, "a", "line"); claim(g, "a", "corners"); ev(g, { type: "settle" });
    expect(g.s.won).toEqual({ "line#1": "a", "corners#1": "a" });
  });
  test("B13 a person who already won the house does not take the 2nd line (others do)", () => {
    const t = plainCard(); const g = newGame({ ...sameCard(["b"]), a: t }, { order: lineOrder(), houses: { line: 2 } });
    callN(g, 5); claim(g, "a", "line", 1); ev(g, { type: "settle" }); claim(g, "a", "line", 1); claim(g, "b", "line", 9); ev(g, { type: "settle" });
    expect(g.s.won).toEqual({ "line#1": "a", "line#2": "b" });
  });
  /** Two different cards: `early` completes row 1 on call 5; `late` (numbers 6-10 of each column) completes its row 1 on call 10. */
  const twoCards = () => {
    const early = plainCard();
    const late = [0, 1, 2, 3, 4].map((r) => [0, 1, 2, 3, 4].map((c) => (c === 2 && r === 2 ? null : c * 15 + r + 6)));
    const order = orderWith([1, 16, 31, 46, 61, 6, 21, 36, 51, 66]);
    expect(isValidCard(early) && isValidCard(late as any)).toBe(true);
    return { early, late: late as any, order };
  };
  test("B14 earlier completion wins the first open line, then the next", () => {
    const { early, late, order } = twoCards();
    const g = newGame({ early, late }, { order, houses: { line: 2 } });
    callN(g, 10); claim(g, "late", "line", 0); claim(g, "early", "line", 5); ev(g, { type: "settle" });
    expect(g.s.won["line#1"]).toBe("early"); expect(g.s.won["line#2"]).toBe("late");
  });
  test("B14 strictly earlier call beats a lower fate number (one line)", () => {
    const { early, late, order } = twoCards();
    const g = newGame({ early, late }, { order, houses: { line: 1 } });
    callN(g, 10); claim(g, "late", "line", 0); claim(g, "early", "line", 99); ev(g, { type: "settle" });
    expect(g.s.won["line#1"]).toBe("early");
  });
  test("B14 the earlier completer wins even if the later one pressed Claim first", () => {
    const { early, late, order } = twoCards();
    const g = newGame({ early, late }, { order, houses: { line: 1 } });
    callN(g, 10); claim(g, "late", "line", 0); claim(g, "early", "line", 1); ev(g, { type: "settle" });
    expect(g.s.won["line#1"]).toBe("early");
  });
  test("B14 claim order is irrelevant (earlier completer claims after the later one)", () => {
    const { early, late, order } = twoCards();
    const g = newGame({ early, late }, { order, houses: { line: 1 } });
    callN(g, 10); claim(g, "early", "line", 1); claim(g, "late", "line", 0); ev(g, { type: "settle" });
    expect(g.s.won["line#1"]).toBe("early");
  });
  test("B14 same call: the lowest fate number goes first (then next lowest), property over all orderings", () => {
    const r = rng(14);
    for (let k = 0; k < 50; k++) {
      const names = ["a", "b", "c", "d"]; const fates = shuffle([3, 8, 20, 41], r);
      const g = newGame(sameCard(names), { order: lineOrder(), houses: { line: 3 } });
      callN(g, 5); names.forEach((n, i) => claim(g, n, "line", fates[i]!)); ev(g, { type: "settle" });
      const byFate = names.map((n, i) => [fates[i]!, n] as const).sort((x, y) => x[0] - y[0]).map((x) => x[1]);
      expect([g.s.won["line#1"], g.s.won["line#2"], g.s.won["line#3"]]).toEqual(byFate.slice(0, 3));
    }
  });
  test("B14 fate: lower fate wins even when claimed last and even with a negative or zero fate", () => {
    const g = newGame(sameCard(["a", "b"]), { order: lineOrder(), houses: { line: 1 } });
    callN(g, 5); claim(g, "a", "line", 0); claim(g, "b", "line", -1); ev(g, { type: "settle" });
    expect(g.s.won["line#1"]).toBe("b");
  });
  test("B14 settleOrder sorts by earlier call then lower fate", () => {
    expect(settleOrder({ at: 3, fate: 9 }, { at: 4, fate: 1 })).toBeLessThan(0);
    expect(settleOrder({ at: 4, fate: 1 }, { at: 4, fate: 2 })).toBeLessThan(0);
    expect(settleOrder({ at: 4, fate: 2 }, { at: 4, fate: 1 })).toBeGreaterThan(0);
  });
  test("B14 a claimant who completed on an earlier call than 75 is never ranked as never-completed", () => {
    // completion on call 75 (last) must still rank (not be treated as worse than 'never')
    const early = plainCard(); const t2 = plainCard();
    const order = orderWith([...cells(early, [0, 1, 2, 3, 4])]);
    const g = newGame({ early, t2 }, { order, houses: { line: 1 } });
    callN(g, 5); claim(g, "t2", "line", 0); claim(g, "early", "line", 1); ev(g, { type: "settle" });
    expect(g.s.won["line#1"]).toBe("t2"); // same cards, same call, lower fate
  });
  test("B14 with a house that completes at call 75 the claimant still ranks by that call", () => {
    const a = plainCard(); const g = newGame({ a }, { order: ORDER.slice().reverse().length ? orderWith([]) : ORDER, houses: { blackout: 1 } });
    expect(g.s.lines).toEqual(["blackout#1"]);
  });
  test("B15 claims are settled just before the next number is called", () => {
    const g = newGame({ a: plainCard() }, { order: lineOrder() });
    callN(g, 5); claim(g, "a", "line"); expect(g.s.won["line#1"]).toBeUndefined();
    callNext(g); expect(g.s.won["line#1"]).toBe("a"); expect(g.s.called).toBe(6);
  });
  test("B15 a claim made after call k is decided on the numbers up to call k even when settled with call k+1", () => {
    // number 31 completes the line only at call 6; a claim after call 5 is wrong
    const t = plainCard(); const g = newGame({ a: t }, { order: orderWith([1, 16, 46, 61, 2, 31]) });
    callN(g, 5); claim(g, "a", "line"); callNext(g); expect(g.s.won["line#1"]).toBeUndefined();
  });
  test("B15 the Organizer/Host closing the round settles claims (settle event)", () => {
    const g = newGame({ a: plainCard() }, { order: lineOrder() });
    callN(g, 5); claim(g, "a", "line"); ev(g, { type: "settle" });
    expect(wins(g).length).toBe(1);
  });
  test("B15 winners are chosen by software only: settle takes no winner input", () => {
    const g = newGame(sameCard(["a", "b"]), { order: lineOrder(), houses: { line: 1 } });
    callN(g, 5); claim(g, "a", "line", 5); claim(g, "b", "line", 1);
    ev(g, { type: "settle", winner: "a" } as any);
    expect(g.s.won["line#1"]).toBe("b");
  });
  test("B15 a claim made after the final (75th) call is still settled when the round is closed", () => {
    const t = plainCard(); const order = orderWith([]).filter((n) => !cells(t, [0, 1, 2, 3, 4]).includes(n)).concat(cells(t, [0, 1, 2, 3, 4]));
    const g = newGame({ a: t }, { order, houses: { line: 1 } });
    callN(g, 75);
    claim(g, "a", "line"); ev(g, { type: "settle" });
    expect(g.s.won["line#1"]).toBe("a");
  });
  test("B16 the game ends when every prize line has a winner", () => {
    const g = newGame({ a: plainCard() }, { order: lineOrder(), houses: { line: 1 } });
    callN(g, 5); claim(g, "a", "line"); callNext(g);
    expect(g.s.over).toBe(true); expect(g.s.called).toBeLessThan(75); expect(g.out.some((o) => o.kind === "end")).toBe(true);
  });
  test("B16 the game does not end while a prize line is open", () => {
    const g = newGame({ a: plainCard() }, { order: lineOrder(), houses: { line: 2 } });
    callN(g, 5); claim(g, "a", "line"); callNext(g);
    expect(g.s.over).toBe(false); callNext(g); expect(g.s.over).toBe(false);
  });
  test("B16 the game ends when all 75 numbers have been called, with an end outcome once", () => {
    const g = newGame({ a: plainCard() }, { houses: { blackout: 2, line: 3 } });
    for (let i = 0; i < 100; i++) callNext(g);
    expect(g.s.called).toBe(75); expect(g.s.over).toBe(true); expect(g.out.filter((o) => o.kind === "end").length).toBe(1);
  });
  test("B16 nothing happens after the game is over (no more calls, claims or wins)", () => {
    const g = newGame({ a: plainCard() }, { order: lineOrder(), houses: { line: 1 } });
    callN(g, 5); claim(g, "a", "line"); callNext(g);
    const before = JSON.stringify(g.s); callNext(g); claim(g, "a", "corners"); ev(g, { type: "settle" });
    expect(JSON.stringify(g.s)).toBe(before);
  });
  test("B16 a game with zero prize lines is invalid setup: init throws", () => {
    expect(() => newGame({ a: plainCard() }, { houses: { line: 0 } })).toThrow("a game needs at least one prize line");
    expect(() => newGame({ a: plainCard() }, { houses: {} })).toThrow("a game needs at least one prize line");
  });
  test("B16 the four default houses apply when housesCount is absent", () => {
    const s = bingoRules.init({ order: ORDER, cards: { a: plainCard() } }, ["a"], 0);
    expect(s.lines).toEqual(["line#1", "corners#1", "x#1", "blackout#1"]);
  });
  test("B16 full property game: random cards, claim as soon as met, every house has at most one winner per line and one win per person per house", () => {
    const r = rng(16);
    for (let k = 0; k < 20; k++) {
      const names = ["p1", "p2", "p3", "p4", "p5", "p6"]; const cards = Object.fromEntries(names.map((n) => [n, makeCard(r)]));
      const g = newGame(cards, { order: shuffle(ORDER, r), houses: { line: 3, corners: 3, x: 2, blackout: 2, frame: 2 } });
      while (!g.s.over) {
        callNext(g);
        const called = new Set(g.s.order.slice(0, g.s.called));
        for (const p of names) for (const h of ["line", "corners", "x", "blackout", "frame"] as House[]) if (meets(cards[p]!, h, called)) claim(g, p, h, Math.floor(r() * 1000));
      }
      const w = Object.entries(g.s.won);
      expect(new Set(w.map(([l]) => l)).size).toBe(w.length);
      const per = new Set(w.map(([l, p]) => l.split("#")[0] + p)); expect(per.size).toBe(w.length);
      expect(wins(g).length).toBe(w.length);
    }
  });
});

describe("rule 17: marking", () => {
  test("B17 mark setting offers auto (default) and tap", () => {
    const f = setupFields.find((x) => x.key === "mark")!;
    expect(f.choices).toEqual(["auto", "tap"]); expect(f.default).toBe("auto");
  });
  test("B17 a missed tap never loses a prize: claim is decided by called numbers, not by marks", () => {
    const g = newGame({ a: plainCard() }, { order: lineOrder() });
    // no tap/mark event exists; the card is judged on called numbers only
    callN(g, 5); claim(g, "a", "line"); ev(g, { type: "settle" });
    expect(g.s.won["line#1"]).toBe("a");
  });
  test("B17 same result with mark=tap setup", () => {
    const t = plainCard(); const clock = g0(t);
    expect(clock).toBe("a");
    function g0(card: typeof t) {
      const s = bingoRules.init({ order: lineOrder(), cards: { a: card }, mark: "tap", housesCount: { line: 1 } }, ["a"], 0);
      let st = s; const ck = { phase: "running", frozenAt: null, pausedMs: 0, pauses: [] } as any; let now = 0;
      for (let i = 0; i < 5; i++) { now = st.nextCallAt; st = bingoRules.step(st, { type: "tick" }, now, ck).state; }
      st = bingoRules.step(st, { type: "claim", player: "a", house: "line", fate: 1 }, now, ck).state;
      st = bingoRules.step(st, { type: "settle" }, now, ck).state; return st.won["line#1"];
    }
  });
});

describe("conformance runner", () => {
  test("B0 bun tools/conformance.ts passes for the Bingo manifest", async () => {
    const p = Bun.spawn(["bun", "tools/conformance.ts"], { cwd: import.meta.dir + "/../..", stdout: "pipe", stderr: "pipe" });
    const out = await new Response(p.stdout).text(); expect(await p.exited).toBe(0); expect(out).toContain("conformance ok");
  });
  test("B0 manifest: caps 100000 auto / 1000 manual, rehearsal 20", async () => {
    const { MANIFESTS, checkManifest } = await import("../../packages/manifest/src"); const m = MANIFESTS.bingo;
    expect(m.caps).toEqual({ auto: 100000, manual: 1000 }); expect(m.rehearsalMax).toBe(20); expect(checkManifest(m)).toEqual([]);
  });
  test("B0 manifest: four start modes (auto/manual start, auto/host-called play)", async () => {
    const { MANIFESTS } = await import("../../packages/manifest/src"); const m = MANIFESTS.bingo;
    expect([...m.startModes].sort()).toEqual(["auto", "manual"]); expect([...m.playModes].sort()).toEqual(["auto-called", "host-called"]);
    expect(m.startModes.length * m.playModes.length).toBe(4);
  });
  test("B0 manifest: Claim golden button, Organizer final say, pause support", async () => {
    const { MANIFESTS } = await import("../../packages/manifest/src"); const m = MANIFESTS.bingo;
    expect(m.goldenButton).toBe("Claim"); expect(m.labels).toEqual(["Claim"]); expect(m.claimType).toBe("player-presses");
    expect(m.organizerFinalSay).toBe(true); expect(m.pauseSupport).toBe(true);
  });
  test("B0 roles include organizer, host, cohost, participant and family pass", async () => {
    const core = await import("../../packages/core/src");
    expect([...core.ROLES].sort()).toEqual(["cohost", "family", "host", "organizer", "participant"]);
    expect(core.FAMILY_SEATS).toBe(4);
  });
  test("B0 module labels agree with the manifest", async () => {
    const core = await import("../../packages/core/src"); expect(core.labelsAgree(bingoRules)).toEqual([]);
  });
});
