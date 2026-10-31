import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import * as w from "../packages/wording/src";
import * as ui from "../packages/ui/src";
import { MANIFESTS, checkManifest } from "../packages/manifest/src";
const root = join(import.meta.dir, "..");
describe("E10 wording guard", () => {
  test("E10 the word 'private' is refused, 'close group' is the group word", () => {
    expect(w.guardOk("a private game")).toBe(false); expect(w.guardOk("Private")).toBe(false);
    expect(w.GROUP_WORD).toBe("close group"); expect(w.guardOk("a close group game")).toBe(true);
  });
  test("E10 no shared message contains 'private'", () => {
    for (const [k, v] of Object.entries(w.MSG)) expect(w.guardOk(v), k).toBe(true);
    expect(w.guardOk(w.RETENTION_LINE) && w.guardOk(w.NO_PERSONAL_DETAILS)).toBe(true);
  });
  test("E10 English only (ASCII letters plus common punctuation/emoji)", () => {
    for (const [k, v] of Object.entries(w.MSG)) expect(/[^\u0000-\u007F\u2026\u2019\u{1F300}-\u{1FAFF}]/u.test(v), `${k} has non-English script`).toBe(false);
    expect(ui.enButton()).toContain("English");
  });
  test("E10 short copy: each message at most 120 characters", () => {
    for (const [k, v] of Object.entries(w.MSG)) expect(v.length, `${k} too long`).toBeLessThanOrEqual(120);
  });
  test("E10 retention line exact", () => expect(w.NO_PERSONAL_DETAILS).toBe("No personal details needed. All participant information is deleted within 24 hours of the game."));
});
const tokens = readFileSync(join(root, "packages/ui/src/tokens.css"), "utf8");
const comps = readFileSync(join(root, "packages/ui/src/components.css"), "utf8");
describe("E11 UI tokens", () => {
  test("E11 minimum tap is 44px", () => { expect(ui.MIN_TAP_PX).toBe(44); expect(tokens).toMatch(/--tap:\s*44px/); });
  test("E11 buttons and EN button use the tap token for min size", () => {
    for (const sel of [".btn{", ".en-btn{"]) {
      const rule = comps.split("\n").find((l) => l.startsWith(sel))!;
      expect(rule, sel).toContain("min-height:var(--tap)"); expect(rule, sel).toContain("min-width:var(--tap)");
    }
  });
  test("E11 no component sets a height under 44px", () => {
    for (const m of comps.matchAll(/(?<![-\w])(?:min-)?height:\s*(\d+)px/g)) expect(Number(m[1]), m[0]).toBeGreaterThanOrEqual(44);
  });
  test("E11 EN button never overlaps text: not absolutely/fixed positioned", () => {
    const rule = comps.split("\n").find((l) => l.startsWith(".en-btn{"))!;
    expect(rule, "EN button is taken out of flow and can overlap text").not.toMatch(/position:\s*(absolute|fixed)/);
  });
});
describe("E12 conformance harness", () => {
  const tools = readdirSync(join(root, "tools"));
  test("E12 tools/ has a conformance runner", () => {
    expect(tools.some((f) => /conform/i.test(f)), `tools/ has only: ${tools.join(", ")}`).toBe(true);
  });
  test("E12 checkManifest (the only rule checker) fails a broken manifest for manifest-level rules", () => {
    const broken: [string, (m: any) => void][] = [
      ["E1 rehearsal", (m) => (m.rehearsalMax = 7)], ["E1 label", (m) => (m.labels = ["Nope"])], ["E1 caps", (m) => (m.caps = { auto: 5, manual: 9 })],
      ["E7 golden", (m) => (m.goldenButton = "You won")], ["E8 final say", (m) => (m.organizerFinalSay = false)],
    ];
    for (const [rule, f] of broken) { const m: any = structuredClone(MANIFESTS.tambola); f(m); expect(checkManifest(m).length, `${rule} not caught`).toBeGreaterThan(0); }
  });
});
