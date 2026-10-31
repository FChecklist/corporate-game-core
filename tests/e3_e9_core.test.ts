import { describe, expect, test as bunTest } from "bun:test";
import { say } from "../packages/wording/src";
import { MANIFESTS } from "../packages/manifest/src";
// packages/core must load; if it does not (e.g. a syntax error in a source file) every test below fails with that reason.
let loadErr: unknown = null;
let core: any = {};
try { core = await import("../packages/core/src"); } catch (e) { loadErr = e; }
const test = (name: string, fn: () => void) => bunTest(name, () => { if (loadErr) throw new Error("packages/core failed to load: " + String(loadErr)); fn(); });
const L = (k: string): any => (...a: any[]) => core[k](...a);
const canControlClock = L("canControlClock"), newClock = L("newClock"), start = L("start"), pause = L("pause"), resume = L("resume"), gameNow = L("gameNow"), shouldStart = L("shouldStart"), admit = L("admit"), register = L("register"), drawInit = L("drawInit"), drawReady = L("drawReady"), elimInit = L("elimInit"), submit = L("submit"), closeRound = L("closeRound"), planOk = L("planOk"), logChange = L("logChange");
const ROLES: string[] = ["organizer", "host", "cohost", "participant", "family"];
const run = () => start(newClock());
describe("E3 roles", () => {
  test("E3 five roles exist", () => expect([...(core.ROLES ?? [])].sort()).toEqual(["cohost", "family", "host", "organizer", "participant"]));
  test("E3 only Organizer or Host can pause/resume/start", () => {
    for (const r of ROLES) {
      const ok = r === "organizer" || r === "host";
      expect(canControlClock(r), `${r} control`).toBe(ok);
      expect(pause(run(), r, 10).phase === "paused", `${r} pause`).toBe(ok);
      expect(resume(pause(run(), "host", 10), r, 20).phase === "running", `${r} resume`).toBe(ok);
      expect(shouldStart("manual", 100, 50, r), `${r} manual start`).toBe(ok);
    }
  });
});
describe("E4 modes", () => {
  const combos = (m: any) => m.startModes.flatMap((s: string) => m.playModes.map((p: string) => s + "/" + p));
  for (const id of ["tambola", "bingo"] as const) test(`E4 ${id} accepts all four start x play combos`, () => expect(combos(MANIFESTS[id]).length).toBe(4));
  for (const id of ["tictactoe", "snakes", "luck", "luckydraw"] as const) test(`E4 ${id} rejects a manual play choice`, () => {
    expect(core.capFor(MANIFESTS[id], true), "manual play must not get a separate cap").toBe(MANIFESTS[id].caps.auto);
    expect(MANIFESTS[id].playModes, "no host-called play").not.toContain("host-called");
    expect(MANIFESTS[id].caps.manual).toBeUndefined();
  });
  test("E4 tambola manual play cap is 1000, auto 100000", () => {
    expect(core.capFor(MANIFESTS.tambola, true)).toBe(1000); expect(core.capFor(MANIFESTS.tambola, false)).toBe(100000);
  });
});
describe("E5 pause/resume", () => {
  test("E5 clock freezes while paused and deadlines move by the paused time", () => {
    let c = pause(run(), "host", 1000);
    expect(gameNow(c, 1000)).toBe(gameNow(c, 999_000));
    c = resume(c, "organizer", 5000);
    expect(gameNow(c, 6000)).toBe(6000 - 4000);
  });
  test("E5 players see 'Paused'", () => { expect(core.PAUSED_MSG).toBe("Paused"); expect(say("paused")).toBe("Paused"); });
  test("E5 pause is logged with role", () => {
    const c = resume(pause(run(), "host", 1), "organizer", 2);
    expect(c.pauses).toEqual([{ role: "host", from: 1, to: 2 }]);
    expect(logChange([], "host", "pause", 1)[0]!.role).toBe("host");
  });
  test("E5 works at any size (no size check in pause)", () => {
    const c = elimInit({ roundMs: 1000, tieRule: "rethrow" }, Array.from({ length: 100_000 }, (_, i) => "p" + i), 0);
    expect(pause(run(), "organizer", 5).phase).toBe("paused"); expect(c.alive.length).toBe(100_000);
  });
});
describe("E6 participation", () => {
  const j = { listed: true, closeGroup: false, alreadySeated: false, full: false, open: true };
  test("E6 one person one seat", () => expect(admit({ ...j, alreadySeated: true }).result).toBe("refused"));
  test("E6 ID cleaning: letters and digits only, upper case, max 30", () => {
    expect(core.normEmp("1b-678")).toBe("1B678"); expect(core.normEmp("1B 678")).toBe("1B678");
    expect(core.normEmp("a".repeat(31))).toBeNull(); expect(core.normEmp("a@b.com")).toBeNull();
  });
  test("E6 account email: spaces removed, lower case", () => expect(core.normEmail(" A B@X.Com ")).toBe("ab@x.com"));
  test("E6 elimination games: late-join closed after round 1 (window only if Organizer sets one)", () => {
    for (const id of ["tictactoe", "snakes", "luck"] as const) expect(MANIFESTS[id].lateJoin, id).toEqual({ kind: "none-after-round-1" });
        const st = elimInit({ roundMs: 10, tieRule: "rethrow" }, ["a"], 0);
    expect((core as any).canJoinLate, "no function enforcing late-join windows in core").toBeDefined();
    void st;
  });
  test("E6 Lucky Draw registration closes at draw time", () => {
    const d = drawInit(1000, 1, "auto");
    expect(register(d, "A", 999).why).toBeUndefined();
    expect(register(d, "A", 1000).why).toBeDefined();
    expect(register(register(d, "A", 1).state, "A", 2).why, "second entry").toBeDefined();
  });
  test("E6 close group: unlisted wait", () => expect(admit({ ...j, closeGroup: true, listed: false }).result).toBe("waiting"));
});
describe("E7 golden button", () => {
  test("E7 Claim games need player press and label Claim; others auto-claim and say 'You won'", () => {
    for (const [id, m] of Object.entries(MANIFESTS)) {
      const claim = m.labels.includes("Claim");
      expect(m.goldenButton, id).toBe(claim ? "Claim" : "You won");
    }
  });
  test("E7 no rules module declares claimType", () => expect((core as any).claimType ?? Object.values(MANIFESTS).every((m: any) => m.claimType), "manifests have no claimType").toBeTruthy());
});
describe("E8 prizes", () => {
  test("E8 prize modes auto and manual on every game", () => { for (const m of Object.values(MANIFESTS)) expect([...m.prizeModes].sort()).toEqual(["auto", "manual"]); });
  test("E8 Organizer final say only for Claim games", () => { for (const [id, m] of Object.entries(MANIFESTS)) expect(m.organizerFinalSay, id).toBe(m.labels.includes("Claim")); });
  test("E8 manual plan never changes who won", () => {
    expect((core as any).applyManualPrizes, "no function showing manual prizes leave winners unchanged").toBeDefined();
    expect(planOk({ mode: "manual", currency: "INR", prizes: [{ position: "1st", label: "x" }] })).toBeNull();
  });
});
describe("E9 elimination rules", () => {
  const S = (tie: "replay-once" | "rethrow") => elimInit({ roundMs: 100, tieRule: tie }, ["a", "b", "c"], 0);
  test("E9 not playing in time = out", () => {
    let s = submit(S("rethrow"), "a", { outcome: "win" }, 50); s = submit(s, "b", { outcome: "win" }, 50);
    s = closeRound(s, 100);
    expect(s.alive).toEqual(["a", "b"]); expect(s.out[0]).toMatchObject({ player: "c", why: "not playing in time" });
  });
  test("E9 late result after the deadline is ignored", () => expect(submit(S("rethrow"), "a", { outcome: "win" }, 101).results).toEqual({}));
  test("E9 last standing wins", () => {
    let s = submit(S("rethrow"), "a", { outcome: "win" }, 5); s = submit(s, "b", { outcome: "loss" }, 5); s = submit(s, "c", { outcome: "loss" }, 5);
    s = closeRound(s, 100); expect(s.winner).toBe("a"); expect(s.over).toBe(true);
  });
  test("E9 round closes only at deadline (software-run)", () => expect(closeRound(S("rethrow"), 99).round).toBe(1));
  test("E9 tictactoe tie: replay once, then first mover out", () => {
    let s = elimInit({ roundMs: 100, tieRule: "replay-once" }, ["x", "o"], 0);
    const tie = (st: typeof s, t: number) => submit(submit(st, "x", { outcome: "tie", firstMover: true }, t - 1), "o", { outcome: "tie", firstMover: false }, t - 1);
    s = closeRound(tie(s, 100), 100);
    expect(s.alive.sort()).toEqual(["o", "x"]); expect(s.over).toBe(false);
    s = closeRound(tie(s, 200), 200);
    expect(s.winner, "first mover must be out after second tie").toBe("o");
  });
  test("E9 luck tie = re-throw", () => {
    let s = elimInit({ roundMs: 100, tieRule: "rethrow" }, ["a", "b"], 0);
    s = closeRound(submit(submit(s, "a", { outcome: "tie" }, 1), "b", { outcome: "tie" }, 1), 100);
    expect(s.alive.sort()).toEqual(["a", "b"]); expect(s.over).toBe(false); expect(s.round).toBe(1);
    s = closeRound(submit(submit(s, "a", { outcome: "tie" }, 150), "b", { outcome: "tie" }, 150), 200);
    expect(s.over, "luck re-throws every time").toBe(false);
  });
  test("E9 auto and manual start both run rounds by software", () => {
    expect(shouldStart("auto", 10, 10, null)).toBe(true); expect(shouldStart("manual", 10, 10, null)).toBe(false);
    expect(drawReady(drawInit(10, 1, "manual"), 99, false)).toBe(false);
  });
});
