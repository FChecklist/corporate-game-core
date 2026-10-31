import { describe, expect, test } from "bun:test";
import { planPrizes, shareOut, validateManual, planHint, prizePlanner } from "../../packages/core/src";
const BUDGETS = [0, 1, 7, 99, 100, 101, 999, 1000, 1234, 5000, 9999, 12345, 100000, 777777];
const combos: [1 | 2, number][] = [[1, 4], [1, 6], [1, 8], [1, 10], [2, 12], [2, 14], [2, 16], [2, 20]];
describe("PLAN budget splits", () => {
  test("PLAN1 eight approved splits exist", () => {
    expect(prizePlanner.COUNTS[1]).toEqual([4, 6, 8, 10]); expect(prizePlanner.COUNTS[2]).toEqual([12, 14, 16, 20]);
    expect(prizePlanner.DEFAULT_COUNT).toEqual({ 1: 6, 2: 14 });
  });
  test("PLAN2 the amounts add up exactly to the budget", () => {
    for (const [t, c] of combos) for (const b of BUDGETS) {
      const p = planPrizes(t, c, b);
      expect(p.prizes.length, `${t}/${c}`).toBe(c);
      expect(p.prizes.reduce((s, r) => s + r.amount, 0), `${t}/${c}/${b}`).toBe(b);
      expect(p.total, `${t}/${c}/${b}`).toBe(b);
    }
  });
  test("PLAN2 percentages of every split add up to 100", () => {
    for (const [t, c] of combos) expect(prizePlanner.split(t, c).reduce((s, r) => s + r.pct, 0), `${t}/${c}`).toBeCloseTo(100, 9);
  });
  test("PLAN3 no prize is negative and every amount is a whole number", () => {
    for (const [t, c] of combos) for (const b of [...BUDGETS, -5, NaN, 12.7]) for (const r of planPrizes(t, c, b).prizes) {
      expect(r.amount, `${t}/${c}/${b}`).toBeGreaterThanOrEqual(0); expect(Number.isInteger(r.amount)).toBe(true);
    }
  });
  test("PLAN4 rounding: prizes are floored to whole units, the leftover goes to the biggest prize", () => {
    const p = planPrizes(1, 6, 101); // 15% = 15.15, 10% = 10.1, 30% = 30.3, 15% = 15.15
    const big = p.prizes.reduce((m, r) => (r.pct > m.pct ? r : m));
    for (const r of p.prizes) if (r !== big) expect(r.amount).toBe(Math.floor((101 * r.pct) / 100));
    expect(big.id).toBe("0:full:1");
    expect(big.amount).toBe(101 - p.prizes.filter((r) => r !== big).reduce((s, r) => s + r.amount, 0));
  });
  test("PLAN4 a fractional budget is floored to whole units", () => expect(planPrizes(1, 6, 1000.9).budget).toBe(1000));
  test("PLAN5 prizes of equal share get equal amounts (the leftover goes to the first biggest only)", () => {
    for (const [t, c] of combos) for (const b of BUDGETS) {
      const p = planPrizes(t, c, b), big = p.prizes.reduce((m, r) => (r.pct > m.pct ? r : m));
      for (const a of p.prizes) for (const z of p.prizes) if (a.pct === z.pct && a !== big && z !== big) expect(a.amount, `${t}/${c}/${b} ${a.id} ${z.id}`).toBe(z.amount);
    }
  });
  test("PLAN5 the leftover goes to the first of equally big prizes", () => {
    const p = planPrizes(2, 12, 1001);
    const bigs = p.prizes.filter((r) => r.pct === 30);
    expect(bigs.length).toBe(1);
    const t = planPrizes(1, 4, 1001); // 20,20,20,40
    expect(t.prizes.find((r) => r.pct === 40)!.amount).toBeGreaterThanOrEqual(400);
  });
  test("PLAN6 the plan is deterministic", () => {
    for (const [t, c] of combos) expect(planPrizes(t, c, 4321)).toEqual(planPrizes(t, c, 4321));
    expect(JSON.stringify(planPrizes(2, 14, 8888))).toBe(JSON.stringify(planPrizes(2, 14, 8888)));
  });
  test("PLAN6 an unapproved count falls back to the default", () => {
    expect(planPrizes(1, 5, 1000).count).toBe(6); expect(planPrizes(2, 99, 1000).count).toBe(14);
  });
  test("PLAN6 prize ids are unique", () => {
    for (const [t, c] of combos) { const ids = planPrizes(t, c, 1000).prizes.map((r) => r.id); expect(new Set(ids).size, `${t}/${c}`).toBe(ids.length); }
  });
});
describe("PLAN shares", () => {
  test("PLAN7 shares shown add up: share x winners + leftover = prize", () => {
    for (const a of [0, 1, 10, 99, 100, 1001, 12345]) for (const n of [1, 2, 3, 7, 10, 101]) {
      const r = shareOut(a, n);
      expect(r.share * n + r.leftover, `${a}/${n}`).toBe(a);
      expect(r.share).toBeGreaterThanOrEqual(0); expect(r.leftover).toBeGreaterThanOrEqual(0); expect(r.leftover).toBeLessThan(n);
    }
  });
  test("PLAN7 ties of equal share: everyone gets the same whole amount", () => expect(shareOut(100, 3)).toEqual({ share: 33, leftover: 1, winners: 3 }));
  test("PLAN7 no winners keeps the prize with the Organizer; no negative prize", () => {
    expect(shareOut(100, 0)).toEqual({ share: 0, leftover: 100, winners: 0 });
    expect(shareOut(-50, 2)).toEqual({ share: 0, leftover: 0, winners: 2 });
  });
  test("PLAN7 shareOut is deterministic and floors", () => { expect(shareOut(10, 4)).toEqual(shareOut(10, 4)); expect(shareOut(10, 4).share).toBe(2); });
});
describe("PLAN manual list and hint", () => {
  test("PLAN8 a manual list needs 1 to 30 prizes, an amount each, no duplicate id", () => {
    expect(validateManual([])).not.toEqual([]);
    expect(validateManual([{ id: "a", amount: 10 }])).toEqual([]);
    expect(validateManual([{ id: "a", amount: 0 }]).length).toBe(1);
    expect(validateManual([{ id: "a", amount: -1 }]).length).toBe(1);
    expect(validateManual([{ id: "a", amount: 1.5 }]).length).toBe(1);
    expect(validateManual([{ id: "a", amount: 1 }, { id: "a", amount: 1 }]).length).toBe(1);
    expect(validateManual(Array.from({ length: 31 }, (_, i) => ({ id: "p" + i, amount: 1 }))).length).toBeGreaterThan(0);
    expect(validateManual(Array.from({ length: 30 }, (_, i) => ({ id: "p" + i, amount: 1 })))).toEqual([]);
  });
  test("PLAN9 a small-prize hint is given under an average of 100, never a block", () => {
    expect(planHint(planPrizes(1, 6, 100))).not.toBe("");
    expect(planHint(planPrizes(1, 6, 100000))).toBe("");
    expect(planHint(planPrizes(1, 6, 0))).toBe("");
  });
});
