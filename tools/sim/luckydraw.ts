// Lucky Draw simulation: random registrations and draws through luckyDrawRules (docs/LUCKYDRAW_RULES_BOOK.md). Usage: bun tools/sim/luckydraw.ts --games N --seed S [--from I]
import { luckyDrawRules, winnersFor, registerWhy, prizePlaces, DRAW_CAP, type DrawState } from "../../packages/luckydraw/src";
import { MANIFESTS } from "../../packages/manifest/src";
import { canJoinLate, newClock, pause, resume, start, normId, type IdKind, type Role } from "../../packages/core/src";
import { badNumber, int, lateJoinExpected, pick, playerCount, run, sha, shuffle, type Rng } from "./common";

const rawId = (r: Rng, i: number, kind: IdKind): string => kind === "email" ? (r() < 0.5 ? ` User${i}@Corp.Example ` : `user${i}@corp.example`) : pick(r, [`E${i}`, `e-${i}`, ` e ${i} `, `E/${i}`]);
let sumU = 0, cntU = 0; // where the first winner stands among the entries (0..1): every entry is equally likely, so the mean must be 0.5
run("luckydraw", "tools/sim/luckydraw.ts", (r, c) => {
  const n = playerCount(r), kind: IdKind = r() < 0.5 ? "emp" : "email", mode = r() < 0.5 ? "auto" : "manual", rehearsal = r() < 0.05; c.players = n;
  const wanted = r() < 0.3 ? int(r, 1, 3) : pick(r, [1, 5, 10, 100, n, n + 1, Math.ceil(n / 2), 50]) , closeAt = 1_000_000, eid = "LD" + int(r, 0, 1e6), ref = pick(r, ["0", "1", "17"]), beacon = "B" + int(r, 0, 1e9);
  const cap = rehearsal ? 10 : DRAW_CAP, setup = { eid, winners: wanted, draw: mode, closeAt, idKind: kind, ref, rehearsal, prizes: "Car, Phone , ,Pen" };
  let s = luckyDrawRules.init(setup, [], 0);
  let clk = start(newClock()), wall = 0;
  if (s.cap !== cap) c.v(`cap ${s.cap}, book says ${cap}${rehearsal ? " (rehearsal 10)" : ""}`);
  if (JSON.stringify(s.prizes) !== JSON.stringify(["Car", "Phone", "Pen"])) c.v(`prizes parsed as ${s.prizes}`);
  const refs: string[] = [], bySlot = new Map<string, string>(); // normalised id -> first raw spelling
  const expectEntries: string[] = [];
  // ---- registration: single events, batches, duplicates, junk, pauses, late
  let i = 0;
  while (i < n) {
    if (r() < 0.04) { // paused: nothing registers
      clk = pause(clk, pick(r, ["organizer", "host"] as const), wall);
      const res = luckyDrawRules.step(s, { type: "register", player: "PAUSED1" }, wall, clk), rm = luckyDrawRules.step(s, { type: "registerMany", players: ["PAUSED2"] }, wall, clk);
      const dr = luckyDrawRules.step(s, { type: "draw", by: "organizer", beacon }, wall, clk), tk = luckyDrawRules.step(s, { type: "tick", beacon }, closeAt + 5, clk);
      if (res.state !== s || rm.state !== s || dr.state !== s || tk.state !== s) c.v("something happened while paused (registered or drew)");
      wall += int(r, 1, 5000); clk = resume(clk, "host", wall);
    }
    const batch = r() < 0.5, take = Math.min(n - i, batch ? int(r, 1, 200) : 1), raws: string[] = [];
    for (let k = 0; k < take; k++, i++) { const raw = rawId(r, i, kind); raws.push(raw); }
    // the same person twice (different spelling) is refused; junk is refused
    const dup = raws.length && r() < 0.2 ? [raws[0]!.toUpperCase().trim()] : [], junk = r() < 0.05 ? pick(r, [["", "  "], ["!!!"], [kind === "emp" ? "a@b.c" : ""]]) : [];
    const all = [...raws, ...dup, ...junk];
    if (batch) s = luckyDrawRules.step(s, { type: "registerMany", players: all }, wall, clk).state;
    else for (const raw of all) s = luckyDrawRules.step(s, { type: "register", player: raw }, wall, clk).state;
    for (const raw of all) { const id = normId(kind, raw); if (id && !expectEntries.includes(id) && expectEntries.length < cap) expectEntries.push(id); }
    if (expectEntries.length >= cap && rehearsal) break;
  }
  if (s.entries.length !== expectEntries.length || s.entries.some((e, k) => e !== expectEntries[k])) c.v(`entries differ from the book's one-person-one-entry list (${s.entries.length} vs ${expectEntries.length})`);
  if (new Set(s.entries).size !== s.entries.length) c.v("an entry is in the draw twice");
  if (s.entries.length > cap) c.v(`${s.entries.length} entries over the cap ${cap}`);
  if (s.entries.length && registerWhy(s, s.entries[0]!, wall, clk) !== "You are already in the draw.") c.v("registerWhy for an existing entry is wrong");
  if (rehearsal && n > 10 && s.entries.length !== 10) c.v(`rehearsal holds ${s.entries.length}, book says up to 10`);
  if (rehearsal && n > 10 && luckyDrawRules.step(s, { type: "register", player: "ONEMORE1" }, wall, clk).state !== s) c.v("a full draw took another entry");
  // late registration is refused once the time is up (auto); manual closes at the press
  const lateClk = start(newClock()), tooLate = luckyDrawRules.step(s, { type: "register", player: "LATE99" }, closeAt, lateClk);
  if (mode === "auto" && tooLate.state !== s) c.v("a late registration was accepted at the draw time");
  if (mode === "auto" && registerWhy(s, "LATE99", closeAt, lateClk) !== "Registration is closed.") c.v("registerWhy at draw time is not 'Registration is closed.'");
  const jc = { round: 1, over: false, msSinceRound1End: 0, now: int(r, 0, 2 * closeAt), closeAt };
  if (canJoinLate(MANIFESTS.luckydraw.lateJoin, jc) !== lateJoinExpected(MANIFESTS.luckydraw.lateJoin, jc)) c.v("canJoinLate (until-draw) disagrees with the book");
  // ---- the draw
  const before = s;
  if (mode === "auto") {
    if (luckyDrawRules.step(s, { type: "tick", beacon }, closeAt - 1, clk).state !== before) c.v("auto draw happened before the draw time");
    if (luckyDrawRules.step(s, { type: "tick" }, closeAt + 10, clk).state !== before) c.v("auto draw happened without the beacon value");
    if (luckyDrawRules.step(s, { type: "draw", by: "organizer", beacon }, closeAt + 10, clk).state !== before) c.v("an auto draw was started by a press");
  } else {
    if (luckyDrawRules.step(s, { type: "tick", beacon }, closeAt + 10, clk).state !== before) c.v("a manual draw happened on a tick");
    for (const by of ["participant", "cohost", "family"] as Role[]) if (luckyDrawRules.step(s, { type: "draw", by, beacon }, wall, clk).state !== before) c.v(`${by} drew the winners`);
    if (luckyDrawRules.step(s, { type: "draw", by: "host", beacon: "" }, wall, clk).state !== before) c.v("a draw without a beacon value happened");
  }
  const res = mode === "auto" ? luckyDrawRules.step(s, { type: "tick", beacon }, closeAt + clk.pausedMs + int(r, 0, 5000), clk) : luckyDrawRules.step(s, { type: "draw", by: pick(r, ["organizer", "host"] as const), beacon }, wall, clk);
  const t: DrawState = res.state; s = t;
  if (!t.over || !t.drawn || t.beacon !== beacon) { c.v("the draw did not happen"); return "nodraw"; }
  // ---- independent oracle: rank = SHA-256 of CB1-LUCKY|eid|ref|beacon|ID, lowest wins, 1st first
  const ranked = [...s.entries].map((id) => [sha(`CB1-LUCKY|${eid}|${ref}|${beacon}|${id}`), id] as const).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)), expect = ranked.slice(0, wanted).map((x) => x[1]);
  const w = t.drawn;
  if (w.join() !== expect.join()) c.v("winners differ from the book's SHA-256 rule");
  if (w.length !== Math.min(wanted, s.entries.length)) c.v(`${w.length} winners for ${s.entries.length} entries and ${wanted} wanted (every entry wins when there are fewer entries than winners)`);
  if (new Set(w).size !== w.length || w.some((x) => !s.entries.includes(x))) c.v("a winner twice, or not an entry");
  const places = prizePlaces(w.length), wins = res.out.filter((o) => o.kind === "win") as { player: string; position: string }[];
  if (wins.length !== w.length || wins.some((x, k) => x.player !== w[k] || x.position !== places[k])) c.v("win outcomes do not match places 1st, 2nd, 3rd, 4th...");
  for (const p of places) if (wins.filter((x) => x.position === p).length !== 1) c.v(`place ${p} does not have exactly one holder`);
  if (res.out[res.out.length - 1]?.kind !== "end" || res.out.filter((o) => o.kind === "end").length !== 1) c.v("end not announced exactly once");
  // order of entries makes no difference; anybody with entries + beacon gets the same
  const mix = winnersFor(eid, ref, beacon, shuffle(r, [...s.entries, ...s.entries.slice(0, 3)]), wanted);
  if (mix.join() !== w.join()) c.v("winners depend on the order (or repeats) of the entries");
  if (winnersFor(eid, ref, beacon, s.entries, 0).length !== 0 || winnersFor(eid, ref, beacon, [], wanted).length !== 0) c.v("winnersFor invented a place");
  // once only
  const again = [luckyDrawRules.step(s, { type: "draw", by: "organizer", beacon: "OTHER" }, wall, clk), luckyDrawRules.step(s, { type: "tick", beacon: "OTHER" }, closeAt + 99, clk), luckyDrawRules.step(s, { type: "register", player: "AFTER77" }, 0, clk)];
  if (again.some((a) => a.state !== s || a.out.length)) c.v("the draw changed after it was done");
  if (registerWhy(s, "AFTER77", wall, clk) !== "The draw is done.") c.v("registerWhy after the draw is wrong");
  const nan = badNumber(s, ["closeAt"]); if (nan) c.v(`NaN: ${nan}`);
  if (w.length) { sumU += (s.entries.indexOf(w[0]!) + 0.5) / s.entries.length; cntU++; }
  return JSON.stringify([w, wins, s.entries.length, s.prizes]);
}, (v) => {
  if (cntU >= 2000 && Math.abs(sumU / cntU - 0.5) > 6 * Math.sqrt(1 / 12 / cntU)) v(`fairness: the first winner's average position is ${(sumU / cntU).toFixed(4)} over ${cntU} draws, expected 0.5`);
});
