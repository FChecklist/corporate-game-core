import { describe, expect, test } from "bun:test";
import {
  normalize, generateTicket, isValidTicket, ticketNumbers, patternSets, columnRange, letterOf, callLabel, spokenPhrase, numberWords,
  price, PACKS, proposeBreakPositions, rewardName, maskNumber,
} from "../src";

describe("phone numbers (handout section 12, default country IN)", () => {
  const ok = (raw: string, e164: string, cc = "IN") => {
    const r = normalize(raw, cc);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.e164).toBe(e164);
  };
  test("mandated formats", () => {
    ok("98200 44556", "+919820044556");
    ok("+91 99876 11223", "+919987611223");
    ok("09123456780", "+919123456780");
    ok("0091 9988776655", "+919988776655");
    ok("919812312312", "+919812312312");
    ok("+65 9123 4567", "+6591234567");
    ok("+971 50 765 4321", "+971507654321");
  });
  test("rejections", () => {
    expect(normalize("12345", "IN")).toEqual({ ok: false, reason: "Too short" });
    expect(normalize("98765abc10", "IN")).toEqual({ ok: false, reason: "Contains letters" });
    expect(normalize("", "IN")).toEqual({ ok: false, reason: "No number found" });
    expect(normalize("1".repeat(16), "IN")).toEqual({ ok: false, reason: "Too long" });
  });
  test("changed flag", () => {
    const a = normalize("+919820044556", "IN");
    const b = normalize("98200 44556", "IN");
    expect(a.ok && a.changed).toBe(false);
    expect(b.ok && b.changed).toBe(true);
  });
  test("masking hides the middle digits", () => {
    const m = maskNumber("+919820044556");
    expect(m).toContain("•");
    expect(m.endsWith("556")).toBe(true);
  });
});

describe("cards", () => {
  test("10,000 generated cards are all structurally valid", () => {
    for (let i = 0; i < 10000; i++) expect(isValidTicket(generateTicket())).toBe(true);
  });
  test("a card has 24 numbers, a FREE centre and the right column ranges", () => {
    const t = generateTicket();
    expect(ticketNumbers(t).length).toBe(24);
    expect(t[2]![2]).toBeNull();
    for (let c = 0; c < 5; c++) for (let r = 0; r < 5; r++) if (!(r === 2 && c === 2)) { const [lo, hi] = columnRange(c); expect(t[r]![c]!).toBeGreaterThanOrEqual(lo); expect(t[r]![c]!).toBeLessThanOrEqual(hi); }
  });
  test("pattern sets have the right sizes (FREE is left out of every set)", () => {
    const t = generateTicket();
    expect(patternSets(t, "line").length).toBe(12);
    expect(patternSets(t, "corners")[0]!.length).toBe(4);
    expect(patternSets(t, "plus")[0]!.length).toBe(8);
    expect(patternSets(t, "x")[0]!.length).toBe(8);
    expect(patternSets(t, "frame")[0]!.length).toBe(16);
    expect(patternSets(t, "stamp").length).toBe(4);
    expect(patternSets(t, "blackout")[0]!.length).toBe(24);
  });
  test("letters: 1-15 B, 16-30 I, 31-45 N, 46-60 G, 61-75 O", () => {
    expect([1, 15, 16, 30, 31, 45, 46, 60, 61, 75].map(letterOf).join("")).toBe("BBIINNGGOO");
    expect(callLabel(7)).toBe("B 7"); expect(callLabel(52)).toBe("G 52"); expect(callLabel(75)).toBe("O 75");
    expect(letterOf(0)).toBe(""); expect(letterOf(76)).toBe("");
  });
});

describe("spoken phrase (letter and number, said twice)", () => {
  test("examples", () => {
    expect(spokenPhrase(7)).toBe("Next number is Bee, seven. Bee, seven.");
    expect(spokenPhrase(52)).toBe("Next number is Gee, five two, fifty-two. Gee, fifty-two.");
    expect(spokenPhrase(10)).toBe("Next number is Bee, one zero, ten. Bee, ten.");
    expect(spokenPhrase(75)).toBe("Next number is Oh, seven five, seventy-five. Oh, seventy-five.");
    expect(spokenPhrase(31)).toBe("Next number is En, three one, thirty-one. En, thirty-one.");
  });
  test("all 75 have words and bounds are enforced", () => {
    for (let n = 1; n <= 75; n++) expect(numberWords(n).length).toBeGreaterThan(2);
    expect(() => numberWords(0)).toThrow();
    expect(() => numberWords(76)).toThrow();
  });
});

describe("pricing and breaks", () => {
  test("no GST is charged: the rupee price is the whole amount; no tax abroad either", () => {
    expect(price(1000, "INR")).toEqual({ total: 7099, base: 7099, tax: 0 });
    expect(price(1000, "USD")).toEqual({ total: 101, base: 101, tax: 0 });
  });
  test("owner rule 2026-10-09: every price is the old GST-inclusive price (list price + 18%) rounded to the nearest number ending in 99", () => {
    const oldList = [1999, 2999, 3999, 4999, 5999, 9999, 14999, 24999];
    const nearest99 = (x: number) => { const lo = Math.floor((x + 1) / 100) * 100 - 1, hi = lo + 100; return x - lo <= hi - x ? lo : hi; };
    PACKS.forEach(([n, inr], i) => {
      expect(inr % 100).toBe(99);
      expect(inr).toBe(nearest99(Math.round(oldList[i]! * 1.18 * 100) / 100));
      expect(price(n, "INR").total).toBe(inr);
    });
    expect(PACKS.map((p) => p[1])).toEqual([2399, 3499, 4699, 5899, 7099, 11799, 17699, 29499]);
  });
  test("break positions are near-equal and capped at 3", () => {
    expect(proposeBreakPositions(3)).toEqual([19, 38, 56]);
    expect(() => proposeBreakPositions(4)).toThrow();
  });
  test("reward names", () => {
    expect(rewardName("line", "ticket", 2, 3)).toBe("2nd Line");
    expect(rewardName("blackout", "ticket", 1, 1)).toBe("Blackout");
    expect(rewardName("corners", "ticket", 1, 1)).toBe("Four Corners");
  });
});
