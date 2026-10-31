// Tests written from docs/LUCKYDRAW_RULES_BOOK.md only. Test names start with the rule id (R1..R12).
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { luckyDrawRules as M, registerWhy, DRAW_CAP, type DrawState, type DrawEvent } from "../../packages/luckydraw/src";
import { newClock, pause, resume, start } from "../../packages/core/src";
import { MANIFESTS } from "../../packages/manifest/src";

const run = start(newClock());
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const setup = (o: Record<string, unknown> = {}) => ({ eid: "G1", winners: 1, draw: "auto", closeAt: 1000, idKind: "emp", ref: "0", ...o });
const mk = (o: Record<string, unknown> = {}, now = 0): DrawState => M.init(setup(o) as any, [], now);
const step = (s: DrawState, e: DrawEvent, now = 0, clock = run) => M.step(s, e, now, clock);
const reg = (s: DrawState, ids: string[], now = 0) => ids.reduce((st, p) => step(st, { type: "register", player: p }, now).state, s);
const ids = (n: number) => Array.from({ length: n }, (_, i) => `E${String(i + 1).padStart(4, "0")}`);
const expected = (eid: string, ref: string, beacon: string, entries: string[], n: number) =>
  [...entries].map((id) => [sha(`CB1-LUCKY|${eid}|${ref}|${beacon}|${id}`), id] as const).sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(0, n).map((x) => x[1]);

describe("R1 entering once", () => {
  test("R1 second registration of the same person does nothing", () => {
    const s1 = reg(mk(), ["E0001"]);
    const s2 = step(s1, { type: "register", player: "E0001" }).state;
    expect(s2.entries).toEqual(s1.entries);
    expect(s2.entries.length).toBe(1);
  });
  test("R1 same person in different letter case/spacing is still one entry (email)", () => {
    const s = reg(mk({ idKind: "email" }), ["A@x.com", " a@X.com "]);
    expect(s.entries.length).toBe(1);
  });
  test("R1 refusal message is 'You are already in the draw.'", () => {
    const s = reg(mk(), ["E0001"]);
    expect(registerWhy(s, "E0001", 0, run)).toBe("You are already in the draw.");
  });
});

describe("R2 registration closes at draw time", () => {
  test("R2 auto: registration at the published time is refused, before it accepted", () => {
    const s = mk({ closeAt: 1000 });
    expect(step(s, { type: "register", player: "E1" }, 999).state.entries.length).toBe(1);
    expect(step(s, { type: "register", player: "E1" }, 1000).state.entries.length).toBe(0);
    expect(registerWhy(s, "E1", 1000, run)).toBe("Registration is closed.");
  });
  test("R2 manual: open until Draw is pressed, closed after", () => {
    let s = reg(mk({ draw: "manual", closeAt: undefined }), ["E1"], 5e9);
    expect(s.entries.length).toBe(1);
    s = step(s, { type: "draw", by: "organizer", beacon: "b" }).state;
    expect(step(s, { type: "register", player: "E2" }, 5e9).state.entries).toEqual(["E1"]);
  });
  test("R2 registerMany after close is refused", () => {
    const s = mk({ closeAt: 1000 });
    expect(step(s, { type: "registerMany", players: ["E1", "E2"] }, 1000).state.entries.length).toBe(0);
  });
});

describe("R3 caps", () => {
  test("R3 cap is 100000", () => { expect(DRAW_CAP).toBe(100000); expect(mk().cap).toBe(100000); });
  test("R3 a setup cap above 100000 cannot exceed 100000", () => { expect(mk({ cap: 500000 }).cap).toBe(100000); });
  test("R3 rehearsal holds up to 10 and refuses the 11th: 'The draw is full.'", () => {
    const s = reg(mk({ rehearsal: true }), ids(11));
    expect(s.entries.length).toBe(10);
    expect(registerWhy(s, "ZZZ", 0, run)).toBe("The draw is full.");
  });
  test("R3 registerMany respects the rehearsal limit of 10", () => {
    expect(step(mk({ rehearsal: true }), { type: "registerMany", players: ids(25) }).state.entries.length).toBe(10);
  });
  test("R3 a full draw (small cap) refuses more", () => {
    expect(reg(mk({ cap: 3 }), ids(5)).entries.length).toBe(3);
  });
  test("R3 manifest rehearsal max is 10", () => { expect(MANIFESTS.luckydraw.rehearsalMax).toBe(10); });
});

describe("R4 pause", () => {
  const paused = pause(run, "organizer", 100);
  test("R4 paused: nothing registers", () => {
    expect(step(mk(), { type: "register", player: "E1" }, 200, paused).state.entries.length).toBe(0);
    expect(step(mk(), { type: "registerMany", players: ["E1"] }, 200, paused).state.entries.length).toBe(0);
  });
  test("R4 paused: nothing is drawn, even past the draw time with a beacon", () => {
    const s = reg(mk({ closeAt: 1000 }), ["E1"]);
    const r = step(s, { type: "tick", beacon: "b" }, 5000, paused);
    expect(r.state.drawn).toBeNull(); expect(r.out).toEqual([]);
    const m = reg(mk({ draw: "manual" }), ["E1"]);
    expect(step(m, { type: "draw", by: "host", beacon: "b" }, 0, paused).state.drawn).toBeNull();
  });
  test("R4 draw time waits: pause 100..600 then resume, draw is due at wall 1500 not 1000", () => {
    const s = reg(mk({ closeAt: 1000 }), ["E1"]);
    const c = resume(pause(run, "organizer", 100), "organizer", 600);
    expect(step(s, { type: "tick", beacon: "b" }, 1200, c).state.drawn).toBeNull();
    expect(step(s, { type: "register", player: "E2" }, 1200, c).state.entries.length).toBe(2);
    expect(step(s, { type: "tick", beacon: "b" }, 1500, c).state.drawn).toEqual(["E1"]);
  });
  test("R4 after resume, registration and draw continue", () => {
    const c = resume(pause(run, "host", 10), "host", 20);
    const s = reg(mk(), ["E1"], 30);
    expect(step(s, { type: "register", player: "E2" }, 30, c).state.entries.length).toBe(2);
  });
});

describe("R5 no organizer final say", () => {
  test("R5 manifest organizerFinalSay is false", () => { expect(MANIFESTS.luckydraw.organizerFinalSay).toBe(false); });
  test("R5 nothing after the draw changes the result (no override)", () => {
    const s = step(reg(mk({ draw: "manual" }), ids(5)), { type: "draw", by: "organizer", beacon: "b" }).state;
    for (const e of [{ type: "draw", by: "organizer", beacon: "other" }, { type: "tick", beacon: "x" }] as DrawEvent[])
      expect(step(s, e, 9999).state.drawn).toEqual(s.drawn);
  });
});

describe("R6 winners and prizes set by the Organizer", () => {
  test("R6 number of winners drawn equals setup.winners", () => {
    const r = step(reg(mk({ winners: 3 }), ids(10)), { type: "tick", beacon: "b" }, 1000);
    expect(r.state.drawn?.length).toBe(3);
  });
  test("R6 at least one winner is required", () => {
    expect(() => mk({ winners: 0 })).toThrow();
  });
  test("R6 prize places: 1st, 2nd, 3rd, 4th, 5th", () => {
    expect(M.prizePositions!({ winners: 5 } as any)).toEqual(["1st", "2nd", "3rd", "4th", "5th"]);
  });
  test("R6 prize list is a comma list, one per place", () => {
    expect(mk({ prizes: "TV, Phone ,Mug" }).prizes).toEqual(["TV", "Phone", "Mug"]);
  });
  test("R6 prize text never changes who won", () => {
    const a = step(reg(mk({ winners: 2, prizes: "A,B" }), ids(8)), { type: "tick", beacon: "b" }, 1000).state.drawn;
    const b = step(reg(mk({ winners: 2, prizes: "Z" }), ids(8)), { type: "tick", beacon: "b" }, 1000).state.drawn;
    expect(a).toEqual(b);
  });
});

describe("R7 who draws", () => {
  test("R7 auto: no draw before the draw time", () => {
    expect(step(reg(mk(), ["E1"]), { type: "tick", beacon: "b" }, 999).state.drawn).toBeNull();
  });
  test("R7 auto: no draw at the time without a beacon, draws at the first tick that has one", () => {
    const s = reg(mk(), ["E1"]);
    expect(step(s, { type: "tick" }, 1000).state.drawn).toBeNull();
    expect(step(s, { type: "tick", beacon: "b" }, 1001).state.drawn).toEqual(["E1"]);
  });
  test("R7 auto: a tick draws at exactly the draw time", () => {
    expect(step(reg(mk(), ["E1"]), { type: "tick", beacon: "b" }, 1000).state.drawn).toEqual(["E1"]);
  });
  test("R7 manual: Organizer and Host can press Draw", () => {
    for (const by of ["organizer", "host"] as const)
      expect(step(reg(mk({ draw: "manual" }), ["E1"]), { type: "draw", by, beacon: "b" }).state.drawn).toEqual(["E1"]);
  });
  test("R7 manual: Co-host, participant, family are rejected", () => {
    for (const by of ["cohost", "participant", "family"] as const) {
      const r = step(reg(mk({ draw: "manual" }), ["E1"]), { type: "draw", by, beacon: "b" });
      expect(r.state.drawn).toBeNull(); expect(r.out).toEqual([]);
    }
  });
  test("R7 manual: a tick never draws", () => {
    expect(step(reg(mk({ draw: "manual" }), ["E1"]), { type: "tick", beacon: "b" }, 1e12).state.drawn).toBeNull();
  });
  test("R7 auto: a Draw press does not draw before the time", () => {
    expect(step(reg(mk(), ["E1"]), { type: "draw", by: "organizer", beacon: "b" }, 10).state.drawn).toBeNull();
  });
});

describe("R8 rank is SHA-256 of CB1-LUCKY|id|ref|beacon|ID, lowest wins", () => {
  const entries = ids(40);
  test("R8 winners equal an independent node:crypto computation", () => {
    const s = reg(mk({ eid: "GAME-7", ref: "42", winners: 5 }), entries);
    const r = step(s, { type: "tick", beacon: "beacon-xyz" }, 1000);
    expect(r.state.drawn).toEqual(expected("GAME-7", "42", "beacon-xyz", entries, 5));
  });
  test("R8 default reference is '0'", () => {
    const s = reg(mk({ ref: undefined, winners: 3 }), entries);
    expect(step(s, { type: "tick", beacon: "bb" }, 1000).state.drawn).toEqual(expected("G1", "0", "bb", entries, 3));
  });
  test("R8 manual draw uses the same rule", () => {
    const s = reg(mk({ draw: "manual", winners: 4 }), entries);
    expect(step(s, { type: "draw", by: "host", beacon: "q" }).state.drawn).toEqual(expected("G1", "0", "q", entries, 4));
  });
  test("R8 a different beacon, reference or game id changes the ranking", () => {
    const a = expected("G1", "0", "b1", entries, 40), b = expected("G1", "0", "b2", entries, 40), c = expected("G2", "0", "b1", entries, 40);
    expect(a).not.toEqual(b); expect(a).not.toEqual(c);
  });
});

describe("R9 what the code proves", () => {
  const entries = ids(30);
  const draw = (list: string[], beacon = "B", extra = {}) => step(reg(mk({ winners: 5, ...extra }), list), { type: "tick", beacon }, 1000).state.drawn;
  test("R9 same entries + same beacon give the same winners", () => { expect(draw(entries)).toEqual(draw(entries)); });
  test("R9 order of registration does not change winners", () => {
    expect(draw([...entries].reverse())).toEqual(draw(entries));
    expect(draw([...entries.slice(10), ...entries.slice(0, 10)])).toEqual(draw(entries));
  });
  test("R9 one entry cannot win twice", () => {
    const w = draw(entries, "B", { winners: 20 })!; expect(new Set(w).size).toBe(w.length);
  });
  test("R9 fewer entries than winners: every entry wins, no place invented", () => {
    const r = step(reg(mk({ winners: 10 }), ["E1", "E2", "E3"]), { type: "tick", beacon: "B" }, 1000);
    expect([...r.state.drawn!].sort()).toEqual(["E1", "E2", "E3"]);
    expect(r.out.filter((o) => o.kind === "win").length).toBe(3);
  });
  test("R9 no entries: nobody wins, still ends", () => {
    const r = step(mk(), { type: "tick", beacon: "B" }, 1000);
    expect(r.state.drawn).toEqual([]); expect(r.out).toEqual([{ kind: "end" }]);
  });
  test("R9 different beacons can give different winners", () => {
    const set = new Set(["a", "b", "c", "d", "e", "f"].map((b) => draw(entries, b)!.join()));
    expect(set.size).toBeGreaterThan(1);
  });
});

describe("R10 a draw happens once", () => {
  test("R10 second beacon or draw press changes nothing", () => {
    const s0 = reg(mk({ draw: "manual", winners: 2 }), ids(10));
    const r1 = step(s0, { type: "draw", by: "organizer", beacon: "one" });
    const r2 = step(r1.state, { type: "draw", by: "host", beacon: "two" });
    expect(r2.state.drawn).toEqual(r1.state.drawn); expect(r2.out).toEqual([]);
  });
  test("R10 late registration after the draw changes nothing", () => {
    const r1 = step(reg(mk(), ids(5)), { type: "tick", beacon: "b" }, 1000);
    const r2 = step(r1.state, { type: "register", player: "NEW" }, 1001);
    expect(r2.state.entries).toEqual(r1.state.entries); expect(r2.state.drawn).toEqual(r1.state.drawn);
    expect(registerWhy(r1.state, "NEW", 1001, run)).toBe("The draw is done.");
  });
});

describe("R11 after the draw", () => {
  test("R11 golden button says 'You won' and the claim is automatic", () => {
    expect(M.goldenButton).toBe("You won"); expect(M.claimType).toBe("auto");
    expect(MANIFESTS.luckydraw.goldenButton).toBe("You won");
  });
  test("R11 reports win {player, 1st} ... then end", () => {
    const r = step(reg(mk({ winners: 3 }), ids(6)), { type: "tick", beacon: "b" }, 1000);
    const w = r.state.drawn!;
    expect(r.out).toEqual([
      { kind: "win", player: w[0], position: "1st" }, { kind: "win", player: w[1], position: "2nd" },
      { kind: "win", player: w[2], position: "3rd" }, { kind: "end" },
    ]);
  });
});

describe("R12 batch registration", () => {
  test("R12 registerMany equals one-by-one result (with duplicates and bad IDs)", () => {
    const list = ["E1", "E2", "E1", "E3", "", "E2", "E4"];
    const one = reg(mk({ cap: 3 }), list), many = step(mk({ cap: 3 }), { type: "registerMany", players: list }).state;
    expect(many.entries).toEqual(one.entries);
  });
  test("R12 registerMany then draw equals one-by-one then draw", () => {
    const list = ids(50);
    const a = step(reg(mk({ winners: 4 }), list), { type: "tick", beacon: "b" }, 1000).state.drawn;
    const b = step(step(mk({ winners: 4 }), { type: "registerMany", players: list }).state, { type: "tick", beacon: "b" }, 1000).state.drawn;
    expect(b).toEqual(a);
  });
  test("R12 registerMany skips people already in", () => {
    const s = reg(mk(), ["E1"]);
    expect(step(s, { type: "registerMany", players: ["E1", "E2"] }).state.entries).toEqual(["E1", "E2"]);
  });
});

describe("Conformance", () => {
  test("R5 bun tools/conformance.ts passes (includes the Lucky Draw manifest)", () => {
    const r = spawnSync("bun", ["tools/conformance.ts"], { cwd: new URL("../..", import.meta.url).pathname, encoding: "utf8" });
    expect(r.stdout + r.stderr).toContain("conformance ok");
    expect(r.status).toBe(0);
  });
});
