// B26 (gap plan 2026-10-29): the game log is saved when the game is over, by the scheduled job, whether or not the report e-mail can be sent; card numbers only; chained; kept with the game for 365 days.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { lifecycleTick, endBoundMs } from "../src/lifecycle";
import { lazyTickReset, purgeOld } from "../src/worker";
import { gameLogChainHolds, gameLogEvents, readGameLog } from "../src/gamelog";
import { sentReports } from "../src/pay";
import { GRACE_ROUNDS } from "../../../packages/beacon/src/config";
import { HOUR, MIN, T, W, call, create, j, join, one, organizer, q, reset, restore, startIn, uid } from "./param-harness";

beforeEach(() => { reset(); lazyTickReset(); sentReports.length = 0; });
afterEach(restore);
const tick = (now: number) => lifecycleTick(W.env as any, now);
const rms = (r: number) => (1692803367 + (r - 1) * 3) * 1000;

describe("the events of a finished game (pure)", () => {
  const base = { id: "G-1", startRound: 1000, callSeconds: 12, rounds: 1, breaks: [], endSrc: "schedule", winners: [], lines: { line: 2, blackout: 1 }, st: null as any };
  const callAt = (k: number) => rms(1000 + GRACE_ROUNDS + k * 4); // a call every 4 rounds (12 s)
  test("every call has a line with its time and public round; a win names the card; the end says why; time order", () => {
    const ev = gameLogEvents({ ...base, endMs: callAt(74) + 60_000, winners: [{ round: 1, pattern: "line", ordinal: 2, seat: 214, idx: 30 }, { round: 1, pattern: "blackout", ordinal: 1, seat: 9, idx: 74 }] });
    expect(ev.filter((e) => e.kind === "call").length).toBe(75);
    expect(ev[0]!.kind).toBe("start"); expect(ev[ev.length - 1]!.kind).toBe("end");
    expect(ev.find((e) => e.kind === "win")!.text).toMatch(/^2nd Line was won by card 214 on call 31/);
    expect(ev.find((e) => e.kind === "win" && /Blackout/.test(e.text))!.text).toMatch(/^Blackout was won by card 9/); // one blackout line: no "1st"
    expect(ev[ev.length - 1]!.text).toMatch(/All 75 numbers were called/);
    for (let i = 1; i < ev.length; i++) expect(ev[i]!.at).toBeGreaterThanOrEqual(ev[i - 1]!.at);
    expect(ev.find((e) => e.kind === "call")!.text).toMatch(/Call 1 at .*: the number is worked out from public round \d+\./);
  });
  test("a game that ended when every prize was awarded says so in the plain sentence, with the number of numbers", () => {
    const ev = gameLogEvents({ ...base, endMs: callAt(30) + 1000, endSrc: "phones", winners: [{ round: 1, pattern: "line", ordinal: 1, seat: 5, idx: 30 }] });
    expect(ev.filter((e) => e.kind === "call").length).toBe(31);
    expect(ev[ev.length - 1]!.text).toMatch(/^All prizes were awarded after 31 numbers\./);
  });
  test("pauses and restarts are written, and an organizer's end says who ended it", () => {
    const iv = { start: 1000 + GRACE_ROUNDS + 4 * 10 + 1, end: 1000 + GRACE_ROUNDS + 4 * 10 + 41 };
    const ev = gameLogEvents({ ...base, endMs: callAt(60), st: { intervals: [iv], stopRound: 1000 + GRACE_ROUNDS + 4 * 60 } });
    expect(ev.find((e) => e.kind === "pause")!.text).toMatch(/^Paused by the organizer at /);
    expect(ev.find((e) => e.kind === "restart")!.text).toMatch(/^Play restarted at /);
    expect(ev.find((e) => e.kind === "stop")!.text).toMatch(/^The organizer ended the game/);
    expect(ev[ev.length - 1]!.text).toMatch(/ended by the organizer after \d+ numbers/);
  });
  test("no name, no mobile number and no e-mail can get into a line", () => {
    const ev = gameLogEvents({ ...base, endMs: callAt(74) + 60_000, winners: [{ round: 1, pattern: "line", ordinal: 1, seat: 214, idx: 3 }] });
    expect(JSON.stringify(ev)).not.toMatch(/@|\b9\d{9}\b/);
  });
});

describe("through the real lifecycle", () => {
  async function playedGame() {
    const id = uid("LOG");
    expect((await create(undefined, id, { startRound: startIn(-2 * HOUR), callSeconds: 6, cap: 5000 })).status).toBe(200);
    for (let i = 1; i <= 3; i++) expect((await join(id, i, {}, T - 3 * HOUR)).status).toBe(200);
    W.raw.prepare("INSERT INTO winner(eid,round,pattern,ordinal,seat,idx,at_ms,src) VALUES(?,?,?,?,?,?,?,?)").run(id, 1, "line", 1, 2, 20, T - HOUR, "phones");
    const end = await endBoundMs(W.env as any, one("SELECT * FROM engagement WHERE id=?", id));
    return { id, end };
  }
  test("the log is saved at the end although no report e-mail address exists, once, with a chain that holds", async () => {
    const { id, end } = await playedGame(); // no contact e-mail was given: the report cannot be sent
    expect(one("SELECT COUNT(*) c FROM game_log WHERE eid=?", id).c).toBe(0);
    await tick(end - 10 * MIN); expect(one("SELECT COUNT(*) c FROM game_log WHERE eid=?", id).c).toBe(0); // still being played
    await tick(end + 5 * MIN);
    const n = one("SELECT COUNT(*) c FROM game_log WHERE eid=?", id).c; expect(n).toBeGreaterThan(70);
    await tick(end + 6 * MIN); await tick(end + 7 * MIN); expect(one("SELECT COUNT(*) c FROM game_log WHERE eid=?", id).c).toBe(n); // written once
    const lines = await readGameLog(W.env as any, id); expect(await gameLogChainHolds(id, lines)).toBe(true);
    const text = lines.map((l) => l.text).join("\n");
    expect(text).toMatch(/Line was won by card 2 on call 21/); expect(text).toMatch(/All 75 numbers were called/);
    expect(JSON.stringify(q("SELECT * FROM game_log WHERE eid=?", id))).not.toMatch(/@|98765|Guest/);
    W.raw.prepare("UPDATE game_log SET text='tampered' WHERE eid=? AND seq=5").run(id); // a changed line breaks the chain
    expect(await gameLogChainHolds(id, await readGameLog(W.env as any, id))).toBe(false);
  });
  test("the organizer reads it (JSON and CSV); a stranger and an anonymous caller cannot; it survives the players' data and goes with the game at 365 days", async () => {
    const o = await organizer("boss@acme.com"); const id = uid("LOG");
    expect((await create(undefined, id, { startRound: startIn(-2 * HOUR), callSeconds: 6, cap: 5000 })).status).toBe(200); // made by the platform key (a past start is refused for an organizer), then handed to the organizer
    W.raw.prepare("UPDATE engagement SET pack=100, org=(SELECT org FROM organizer_email LIMIT 1) WHERE id=?").run(id);
    for (let i = 1; i <= 2; i++) expect((await join(id, i, {}, T - 3 * HOUR)).status).toBe(200);
    const end = await endBoundMs(W.env as any, one("SELECT * FROM engagement WHERE id=?", id));
    await tick(end + 5 * MIN);
    const r = await call("GET", `/api/z/${id}/gamelog`, undefined, o.h, end + 6 * MIN); expect(r.status).toBe(200);
    const b = await j(r); expect(b.ready).toBe(true); expect(b.chainHolds).toBe(true); expect(b.lines.length).toBeGreaterThan(70); expect(b.keptUntilMs).toBeGreaterThan(end + 360 * 24 * HOUR);
    const csv = await call("GET", `/api/z/${id}/gamelog?format=csv`, undefined, o.h, end + 6 * MIN); expect(csv.status).toBe(200); expect(csv.headers.get("content-type")).toMatch(/text\/csv/);
    expect(await csv.text()).toMatch(/Line,Time,What,Proof/);
    const stranger = await organizer("other@acme.com");
    expect((await call("GET", `/api/z/${id}/gamelog`, undefined, stranger.h, end + 6 * MIN)).status).toBeGreaterThanOrEqual(401);
    expect((await call("GET", `/api/z/${id}/gamelog`, undefined, {}, end + 6 * MIN)).status).toBeGreaterThanOrEqual(401);
    await tick(end + 22 * HOUR); expect(one("SELECT COUNT(*) c FROM participant WHERE eid=?", id).c).toBe(0); // the players' data is gone
    expect(one("SELECT COUNT(*) c FROM game_log WHERE eid=?", id).c).toBeGreaterThan(70); // the log is not personal data and stays
    await purgeOld(W.env as any, end + 366 * 24 * HOUR);
    expect(one("SELECT COUNT(*) c FROM game_log WHERE eid=?", id).c).toBe(0); // gone with the game at the end of the 365th day
  });
});
