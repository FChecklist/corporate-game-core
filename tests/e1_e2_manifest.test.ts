import { describe, expect, test } from "bun:test";
import { MANIFESTS, GAME_IDS, checkManifest, type Manifest } from "../packages/manifest/src";
const base = (): any => structuredClone(MANIFESTS.tambola);
describe("E1 manifest schema + checkManifest", () => {
  test("E1 manifest declares id, name, labels[], start modes, caps, rehearsal cap, pause support, claim type, golden label, prize positions, late-join", () => {
    const m: any = MANIFESTS.tambola;
    const missing = ["id", "name", "labels", "startModes", "caps", "rehearsalMax", "pauseSupport", "claimType", "goldenButton", "prizePositions", "lateJoin"].filter((k) => !(k in m));
    expect(missing, `manifest lacks fields: ${missing.join(", ")}`).toEqual([]);
  });
  test("E1 several labels are allowed", () => {
    const m = base(); m.labels = ["Claim", "Team"];
    expect(checkManifest(m), "Claim+Team should be accepted").toEqual([]);
  });
  test("E1 unknown label is rejected", () => {
    const m = base(); m.labels = ["Claim", "Bogus"];
    expect(checkManifest(m).length, "unknown label 'Bogus' accepted").toBeGreaterThan(0);
  });
  test("E1 missing fields are rejected", () => {
    for (const k of ["id", "title", "caps", "startModes", "goldenButton", "lateJoin", "rehearsalMax", "labels"]) {
      const m = base(); delete m[k];
      let rejected = false;
      try { rejected = checkManifest(m).length > 0; } catch { rejected = true; }
      expect(rejected, `manifest without '${k}' was accepted`).toBe(true);
    }
  });
  test("E1 caps above allowed are rejected", () => {
    for (const [id, auto, manual] of [["tambola", 100_001, 1_000], ["tambola", 100_000, 1_001], ["luck", 2_001, undefined], ["luckydraw", 100_001, undefined]] as const) {
      const m: any = structuredClone(MANIFESTS[id as keyof typeof MANIFESTS]); m.caps = manual ? { auto, manual } : { auto };
      expect(checkManifest(m).length, `${id} caps ${auto}/${manual} accepted`).toBeGreaterThan(0);
    }
  });
  test("E1 rehearsal cap wrong is rejected (Claim 20, others 10)", () => {
    const a = base(); a.rehearsalMax = 10;
    expect(checkManifest(a).length, "tambola with rehearsal 10 accepted").toBeGreaterThan(0);
    const b: any = structuredClone(MANIFESTS.luck); b.rehearsalMax = 20;
    expect(checkManifest(b).length, "luck with rehearsal 20 accepted").toBeGreaterThan(0);
    const c = base(); c.rehearsalMax = 15;
    expect(checkManifest(c).length, "rehearsal 15 accepted").toBeGreaterThan(0);
  });
});
describe("E2 six reference manifests", () => {
  test("E2 exactly six games", () => expect([...GAME_IDS].sort()).toEqual(["bingo", "luck", "luckydraw", "snakes", "tambola", "tictactoe"]));
  test("E2 all six validate", () => { for (const id of GAME_IDS) expect(checkManifest(MANIFESTS[id]), id).toEqual([]); });
  for (const id of ["tambola", "bingo"] as const) test(`E2 ${id}: Claim, four modes, caps 100000 auto / 1000 manual, rehearsal 20`, () => {
    const m = MANIFESTS[id];
    expect(m.labels).toEqual(["Claim"]); expect(m.caps).toEqual({ auto: 100_000, manual: 1_000 }); expect(m.rehearsalMax).toBe(20);
    expect([...m.startModes].sort()).toEqual(["auto", "manual"]); expect([...m.playModes].sort()).toEqual(["auto-called", "host-called"]);
  });
  for (const id of ["tictactoe", "snakes", "luck"] as const) test(`E2 ${id}: Elimination, start auto|manual only, cap 2000, rehearsal 10`, () => {
    const m = MANIFESTS[id];
    expect(m.labels).toEqual(["Elimination"]); expect([...m.startModes].sort()).toEqual(["auto", "manual"]);
    expect(m.caps.auto).toBe(2_000); expect(m.caps.manual).toBeUndefined(); expect(m.rehearsalMax).toBe(10);
  });
  test("E2 luckydraw: Lucky Draw, cap 100000, rehearsal 10, registration closes at draw time", () => {
    const m = MANIFESTS.luckydraw;
    expect(m.labels).toEqual(["Lucky Draw"]); expect(m.caps.auto).toBe(100_000); expect(m.rehearsalMax).toBe(10); expect(m.lateJoin).toEqual({ kind: "until-draw" });
  });
});
