// E-mail address is case-insensitive (owner rule 2026-10-30): NFKC, no spaces, lower case; never the employee ID cleaner.
import { describe, expect, test } from "bun:test";
import { emailKey } from "../src/emailkey";
import { normMail } from "../src/mode";
import { emailHashOf } from "../src/hostsetup";
import { empClean } from "../src/people";

describe("e-mail key", () => {
  test("all 16 upper/lower variants of the word 'demo' with the full-width at-sign are one address", () => {
    const out = new Set<string>();
    for (let m = 0; m < 16; m++) { const w = "demo".split("").map((c, i) => (m >> i) & 1 ? c.toUpperCase() : c).join(""); out.add(emailKey(`Rajat1＠${w}.COM`)); out.add(emailKey(`RAJAT1@${w}.com`)); }
    expect([...out]).toEqual(["rajat1@demo.com"]);
  });
  test("spaces, tabs, zero-width characters and full-width letters", () => {
    expect(emailKey("  raj at1 @demo.com\t")).toBe("rajat1@demo.com"); expect(emailKey("rajat1​@demo.com")).toBe("rajat1@demo.com"); expect(emailKey("ＲＡＪＡＴ１＠ＤＥＭＯ．ＣＯＭ")).toBe("rajat1@demo.com");
    expect(emailKey(undefined)).toBe("");
  });
  test("one hash and one comparison form for every case variant; the plus tag still goes", async () => {
    const hs = await Promise.all(["RAJAT1＠DEMO.COM", "Rajat1＠DEMO.COM", "rajat1＠DEMO.COM", "Rajat1＠Demo.com"].map(emailHashOf));
    expect(new Set(hs).size).toBe(1); expect(normMail("Rajat1+x＠Demo.com")).toBe("rajat1@demo.com");
  });
  test("the employee ID cleaner is not the e-mail cleaner", () => { expect(empClean("rajat1@demo.com")).toBe("RAJAT1DEMOCOM"); expect(emailKey("rajat1@demo.com")).toContain("@"); });
});
