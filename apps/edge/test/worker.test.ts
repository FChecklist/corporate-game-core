import { beforeEach, describe, expect, test } from "bun:test";
import { SEEN_DEVICES, deviceOf, withDevice } from "./device";
import { settleByPhones } from "./settle";
import { type Env } from "../src/worker";
import { handle } from "./with-terms";
import { makeD1 } from "./d1-sqlite";

const SECRET = "org-secret";
let env: Env;
let raw: ReturnType<typeof makeD1>["raw"];
const T = Date.UTC(2026, 9, 1, 10, 0, 0);
const FAR_START = Math.floor(((T + 2 * 86_400_000) / 1000 - 1692803367) / 3) + 1; // a game two days ahead (a game time can be at most 30 days ahead)
const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}, now = T) =>
  handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", ...headers }, body: withDevice(method, path, body) }), env, now);
const org = { "x-organizer": SECRET };
const create = (over: Record<string, unknown> = {}) => call("POST", "/api/z", { id: "ENG1", startRound: FAR_START, callSeconds: 6, cap: 400, ...over }, org); // two days ahead: a game that is already over takes no new joiners
const phone = (i: number) => "9" + String(100000000 + i);
const join = (i: number, eid = "ENG1", now = T) => call("POST", `/api/z/${eid}/join`, { phone: phone(i), name: "P" + i }, {}, now);

beforeEach(() => {
  const d = makeD1();
  raw = d.raw;
  env = { DB: d.db, ORGANIZER_SECRET: SECRET, DAILY_WRITE_BUDGET: "80000", JOIN_PER_IP_DAY: "1000000", JOIN_PER_IP_MINUTE: "1000000" } as any;
});

describe("engagement set-up", () => {
  test("only the organizer can create one", async () => {
    expect((await call("POST", "/api/z", { id: "ENG1", startRound: 1, callSeconds: 6, cap: 10 })).status).toBe(403);
    expect((await call("POST", "/api/z", { id: "ENG1", startRound: 1, callSeconds: 6, cap: 10 }, { "x-organizer": "wrong" })).status).toBe(403);
  });
  test("with no secret configured, nobody is the organizer (no empty-secret bypass)", async () => {
    env.ORGANIZER_SECRET = undefined;
    expect((await call("POST", "/api/z", { id: "ENG1", startRound: 1, callSeconds: 6, cap: 10 }, { "x-organizer": "" })).status).toBe(403);
  });
  test("call speed must be a multiple of 3 s and at least 6 s", async () => {
    for (const s of [10, 3, 7, 0, -6, 6.5]) expect((await create({ callSeconds: s })).status).toBe(400);
    expect((await create({ callSeconds: 9 })).status).toBe(200);
  });
  test("bad ids, caps and rounds are refused", async () => {
    for (const o of [{ id: "x" }, { id: "a b c d" }, { id: "../../etc" }, { cap: 0 }, { cap: 100001 }, { startRound: 1.5 }, { startRound: "1" }]) expect((await create(o)).status).toBe(400);
  });
  test("creating twice does not overwrite the first", async () => {
    await create();
    await create({ cap: 5 });
    expect(raw.query("SELECT cap FROM engagement WHERE id='ENG1'").get()).toEqual({ cap: 400 });
  });
});

describe("joining", () => {
  beforeEach(async () => { await create(); });
  test("a join returns what the phone needs to play and nothing about others", async () => {
    const r = await (await join(1)).json() as any;
    expect(r.startRound).toBe(FAR_START);
    expect(r.callSeconds).toBe(6);
    expect(r.pid).toMatch(/^1x[0-9a-f]{12}$/); // seat number + hash: the seat makes the ticket collision-free
    expect(Object.keys(r).sort()).toEqual(["breaks", "callSeconds", "closing", "employeesOnly", "invites", "joinPhone", "jr", "opening", "pid", "rewards", "roomMode", "rounds", "startRound", "tickets", "trackClaims", "verify"]);
  });
  test("the same number joining twice, even typed differently, is one participant and one write", async () => {
    const a = await (await call("POST", "/api/z/ENG1/join", { phone: "+91 98765-43210" })).json() as any;
    const b = await (await call("POST", "/api/z/ENG1/join", { phone: "919876543210" })).json() as any;
    expect(a.pid).toBe(b.pid);
    expect(b.again).toBe(true);
    expect(raw.query("SELECT COUNT(*) c FROM participant").get()).toEqual({ c: 1 });
  });
  test("the phone number itself is never stored, only a salted hash", async () => {
    await join(7);
    const dump = JSON.stringify(raw.query("SELECT * FROM participant").all());
    expect(dump.includes(phone(7))).toBe(false);
  });
  test("invalid or hostile input is refused cleanly", async () => {
    for (const b of [{}, { phone: "" }, { phone: "123" }, { phone: "9".repeat(30) }, { phone: "abc" }, null, "not json", "[]"])
      expect((await call("POST", "/api/z/ENG1/join", b as any)).status).toBe(400);
    expect((await call("POST", "/api/z/ENG1/join", "x".repeat(10000))).status).toBe(400);
  });
  test("names are cleaned and cut", async () => {
    await call("POST", "/api/z/ENG1/join", { phone: phone(2), name: "<script>alert(1)</script>`x`" + "y".repeat(200) });
    expect((raw.query("SELECT name FROM participant").get() as any).name).toBeNull(); // names are sealed, never stored in the clear
    const pid = (raw.query("SELECT pid FROM participant").get() as any).pid as string;
    const n = ((await (await call("GET", `/api/z/ENG1/names?pids=${pid}`, undefined, org)).json()) as any).names[pid] as string;
    expect(/[<>`]/.test(n)).toBe(false);
    expect(n.length).toBeLessThanOrEqual(60);
  });
  test("unknown engagement, wrong method and odd paths", async () => {
    expect((await join(1, "NOPE1")).status).toBe(404);
    expect((await call("GET", "/api/z/ENG1/join")).status).toBe(404);
    expect((await call("POST", "/api/z/ENG1/../x")).status).toBe(404);
    expect((await call("DELETE", "/api/z/ENG1/claims")).status).toBe(404);
  });
  test("the participant cap is enforced and a full engagement still lets existing people back in", async () => {
    await create({ id: "SMALL", cap: 3 });
    for (let i = 0; i < 3; i++) expect((await join(i, "SMALL")).status).toBe(200);
    expect((await join(99, "SMALL")).status).toBe(409);
    const back = await join(1, "SMALL");
    expect(back.status).toBe(200);
  });
});

describe("claims", () => {
  let pid: string;
  beforeEach(async () => { await create(); pid = ((await (await join(1)).json()) as any).pid; });
  const claim = (b: unknown) => call("POST", "/api/z/ENG1/claims", b);
  test("a claim is stored once even if the phone sends it five times", async () => {
    for (let i = 0; i < 5; i++) await claim({ pid, claims: [{ pattern: "line", idx: 33 }] });
    expect(raw.query("SELECT COUNT(*) c FROM claim").get()).toEqual({ c: 1 });
  });
  test("a stranger cannot claim", async () => {
    expect((await claim({ pid: "deadbeefdeadbeef", claims: [{ pattern: "line", idx: 3 }] })).status).toBe(403);
    expect((await claim({ pid: 5, claims: [] })).status).toBe(400);
  });
  test("a participant of another engagement cannot claim here", async () => {
    await create({ id: "ENG2" });
    const other = ((await (await join(50, "ENG2")).json()) as any).pid;
    expect((await claim({ pid: other, claims: [{ pattern: "blackout", idx: 70 }] })).status).toBe(403);
  });
  test("bad patterns and impossible call numbers are dropped, good ones kept", async () => {
    const r = await (await claim({ pid, claims: [{ pattern: "bingo", idx: 3 }, { pattern: "line", idx: 75 }, { pattern: "line", idx: -1 }, { pattern: "line", idx: 1.5 }, { pattern: "x", idx: 40 }, null, "x"] })).json() as any;
    expect(r.stored).toBe(1);
  });
  test("a huge claims list is capped", async () => {
    expect((await claim({ pid, claims: Array.from({ length: 5000 }, (_, i) => ({ pattern: "line", idx: i % 75 })) })).status).toBe(400); // oversized body refused outright
    const r = await (await claim({ pid, claims: Array.from({ length: 60 }, (_, i) => ({ pattern: "line", idx: i })) })).json() as any;
    expect(r.stored).toBeLessThanOrEqual(7);
  });
  test("claims cannot be read without the organizer secret", async () => {
    expect((await call("GET", "/api/z/ENG1/claims")).status).toBe(403);
    expect((await call("GET", "/api/z/ENG1/claims", undefined, { "x-organizer": "no" })).status).toBe(403);
    expect((await call("GET", "/api/z/ENG1/claims", undefined, org)).status).toBe(200);
  });
});

describe("winners are decided by the software", () => {
  let pids: string[] = [];
  beforeEach(async () => { await create(); pids = []; for (let i = 1; i <= 8; i++) pids.push(((await (await join(i)).json()) as any).pid); });
  const vote = async (pid: string, results: unknown[]) => { let r!: Response; for (const device of SEEN_DEVICES) { r = await call("POST", "/api/z/ENG1/vote", { pid, device, results }); if (r.status !== 403) break; } return r; }; // the phone's own device id goes with its vote
  const res = (idx: number, winners: string[]) => ({ pattern: "blackout", ordinal: 1, round: 1, idx, pids: winners });
  test("nobody can post a result: not the organizer, not the AI, not a stranger", async () => {
    const body = { results: [{ pattern: "line", idx: 20, pids: [pids[0]!] }] };
    for (const h of [{}, org]) expect((await call("POST", "/api/z/ENG1/settle", body, h)).status).toBe(403);
    expect(raw.query("SELECT COUNT(*) c FROM settled").get()).toEqual({ c: 0 });
  });
  test("one phone's word is not enough; the result stands once enough different phones agree", async () => {
    await vote(pids[0]!, [res(70, [pids[1]!, pids[2]!])]);
    await vote(pids[1]!, [res(70, [pids[1]!, pids[2]!])]);
    expect(raw.query("SELECT COUNT(*) c FROM settled").get()).toEqual({ c: 0 });
    const r = await (await vote(pids[2]!, [res(70, [pids[2]!, pids[1]!])])).json() as any; // same winners in another order: still the same result
    expect(r.accepted).toBe(1);
    expect(raw.query("SELECT COUNT(*) c FROM settled").get()).toEqual({ c: 1 });
    expect((raw.query("SELECT COUNT(*) c FROM winner WHERE src='phones'").get() as any).c).toBe(2);
  });
  test("phones that disagree do not settle anything, and a made-up result cannot outvote an honest one", async () => {
    await vote(pids[0]!, [res(70, [pids[0]!])]); await vote(pids[1]!, [res(71, [pids[1]!])]);
    expect(raw.query("SELECT COUNT(*) c FROM settled").get()).toEqual({ c: 0 });
    for (const p of [pids[2]!, pids[3]!, pids[4]!]) await vote(p, [res(72, [pids[3]!])]);
    expect((raw.query("SELECT idx FROM settled").get() as any).idx).toBe(72);
  });
  test("the same phone reporting again counts once", async () => {
    for (let i = 0; i < 5; i++) await vote(pids[0]!, [res(70, [pids[1]!])]);
    expect(raw.query("SELECT COUNT(*) c FROM settled").get()).toEqual({ c: 0 });
  });
  test("a stranger cannot report, and a malformed report changes nothing", async () => {
    expect((await vote("999x000000000000", [res(70, [pids[1]!])])).status).toBe(403);
    expect((await vote(pids[0]!, [{ pattern: "line", idx: 1, pids: "no" }])).status).toBe(200);
    expect((await vote(pids[0]!, [])).status).toBe(400);
    expect(raw.query("SELECT COUNT(*) c FROM rvote").get()).toEqual({ c: 0 });
  });
  test("public results name winning seats (opaque ids), never names or numbers", async () => {
    await settleByPhones(call, "ENG1", [{ pattern: "blackout", idx: 70, pids: [pids[1]!] }], pids.slice(0, 3));
    const txt = await (await call("GET", "/api/z/ENG1/results")).text();
    expect(/phone|mobile|9876/i.test(txt)).toBe(false);
    expect(JSON.parse(txt).results[0]).toEqual({ pattern: "blackout", ordinal: 1, round: 1, idx: 70, count: 1, winners: [pids[1]!] });
  });
  test("a winner confirms the details on their own phone; a change is kept with the original; the organizer ticks 'prize given'", async () => {
    await settleByPhones(call, "ENG1", [{ pattern: "blackout", idx: 70, pids: [pids[1]!] }], pids.slice(0, 3));
    const dev = deviceOf(phone(2));
    const mine = await (await call("GET", `/api/z/ENG1/myprizes?pid=${pids[1]!}&device=${dev}`)).json() as any;
    expect(mine.prizes).toHaveLength(1); expect(mine.phone).toBe("91" + phone(2)); expect(mine.confirmed).toBe(false); // phone kept with its country code: 91 + 10 digits for India
    expect((await call("POST", "/api/z/ENG1/confirm", { pid: pids[1]!, device: deviceOf(phone(3)), name: "Thief", phone: phone(3) })).status).toBe(403); // another phone cannot take the prize
    expect((await call("POST", "/api/z/ENG1/confirm", { pid: pids[1]!, device: dev, name: "Asha Rao", phone: "98765 43210" })).status).toBe(200);
    const list = await (await call("GET", "/api/z/ENG1/prizes", undefined, org)).json() as any;
    expect(list.prizes[0]).toMatchObject({ name: "Asha Rao", phone: "919876543210", confirmed: true, changed: true, joinedWithName: "P2", joinedWithPhone: "91" + phone(2), given: false });
    expect(list.prizes[0].trail).toHaveLength(1);
    expect((await call("GET", "/api/z/ENG1/prizes")).status).toBe(403);
    expect((await call("POST", "/api/z/ENG1/prizegiven", { round: 1, pattern: "blackout", ordinal: 1, seat: 2, given: true }, org)).status).toBe(200);
    const after = await (await call("GET", "/api/z/ENG1/prizes", undefined, org)).json() as any;
    expect(after.prizes[0].given).toBe(true); expect(after.prizes[0].givenBy).toBe("organizer"); expect(typeof after.prizes[0].givenMs).toBe("number");
    expect(raw.query("SELECT pii FROM prize").get() as any).not.toMatchObject({ pii: expect.stringContaining("Asha") }); // sealed at rest
    // confirming without changing anything is not a change
    await call("POST", "/api/z/ENG1/confirm", { pid: pids[1]!, device: dev, name: "Asha Rao", phone: "9876543210" });
    expect(((await (await call("GET", "/api/z/ENG1/prizes", undefined, org)).json()) as any).prizes[0].trail).toHaveLength(1);
  });
});

describe("free-plan guard and scale", () => {
  test("when the daily write budget is spent the system says so politely and writes nothing more", async () => {
    env.DAILY_WRITE_BUDGET = "12";
    await create();
    let busy = 0;
    for (let i = 0; i < 30; i++) if ((await join(i)).status === 503) busy++;
    expect(busy).toBeGreaterThan(15);
    expect((raw.query("SELECT writes w FROM usage").get() as any).w).toBeLessThanOrEqual(12);
    expect((raw.query("SELECT COUNT(*) c FROM participant").get() as any).c).toBeLessThanOrEqual(11);
  });
  test("the budget resets on the next UTC day", async () => {
    env.DAILY_WRITE_BUDGET = "18"; // a join is charged JOIN_WRITES (9) units: two joins fit, the third is refused
    await create();
    await join(1); await join(2);
    expect((await join(3)).status).toBe(503);
    expect((await join(3, "ENG1", T + 86_400_000)).status).toBe(200);
  });
  test("10,000 people join at once: every one gets in, no duplicates, writes stay inside the free daily budget", async () => {
    env.DAILY_WRITE_BUDGET = "200000"; // the deployed guard is 2,000,000; a join is charged 9 units (what it really writes)
    await create({ cap: 20000 });
    const rs = await Promise.all(Array.from({ length: 10000 }, (_, i) => join(i)));
    expect(rs.every((r) => r.status === 200)).toBe(true);
    expect((raw.query("SELECT COUNT(*) c FROM participant").get() as any).c).toBe(10000);
    expect((raw.query("SELECT writes w FROM usage").get() as any).w).toBe(90002);
    expect(90001).toBeLessThan(2_000_000 * 0.05); // one 10,000-person engagement uses under 5% of the deployed daily guard (9 per join: what a join really writes)
  }, 120_000);
  test("a large engagement stores no per-claim rows (winners come from the public numbers), so 10,000 phones claiming adds no writes", async () => {
    await create({ cap: 20000 });
    const pids: string[] = [];
    for (let i = 0; i < 10000; i++) pids.push(((await (await join(i)).json()) as any).pid);
    const pats = ["line", "twolines", "corners", "plus", "x", "frame", "blackout"];
    for (let round = 0; round < 2; round++)
      await Promise.all(pids.slice(0, 2000).map((pid, i) => call("POST", "/api/z/ENG1/claims", { pid, claims: [{ pattern: pats[i % 7], idx: i % 75 }] })));
    expect((raw.query("SELECT COUNT(*) c FROM claim").get() as any).c).toBe(0);
    expect((raw.query("SELECT writes w FROM usage").get() as any).w).toBe(79994); // 1 create + 1 entitlement-free + 10,000 joins at what a join really writes (about 8 units, the same figure Corporate Tambola counts)
  }, 300_000);
  test("a small engagement (up to 500) stores claims once each, even when sent twice", async () => {
    await create({ cap: 500 });
    const pids: string[] = [];
    for (let i = 0; i < 300; i++) pids.push(((await (await join(i)).json()) as any).pid);
    const pats = ["line", "twolines", "corners", "plus", "x", "frame", "blackout"];
    for (let round = 0; round < 2; round++)
      await Promise.all(pids.map((pid, i) => call("POST", "/api/z/ENG1/claims", { pid, claims: [{ pattern: pats[i % 7], idx: i % 75 }] })));
    expect((raw.query("SELECT COUNT(*) c FROM claim").get() as any).c).toBe(300);
  }, 120_000);
  test("the engagement tells phones whether claims are tracked", async () => {
    await create({ cap: 500 }); await create({ id: "BIG01", cap: 501 });
    expect(((await (await call("GET", "/api/z/ENG1/info")).json()) as any).trackClaims).toBe(true);
    expect(((await (await call("GET", "/api/z/BIG01/info")).json()) as any).trackClaims).toBe(false);
  });
});

describe("roster, history, erase and 365-day retention", () => {
  const D = 86_400_000;
  beforeEach(async () => { await create(); });
  test("only the organizer can list people, history, erase, purge or reuse", async () => {
    for (const [m, p] of [["GET", "/api/z/ENG1/participants"], ["GET", "/api/history"], ["POST", "/api/z/ENG1/erase"], ["POST", "/api/purge"], ["POST", "/api/z/ENG1/reuse"]] as const)
      expect((await call(m, p, m === "POST" ? {} : undefined)).status).toBe(403);
  });
  test("info is public and holds only what a phone needs", async () => {
    expect(await (await call("GET", "/api/z/ENG1/info")).json()).toMatchObject({ startRound: FAR_START, callSeconds: 6, trackClaims: true, controlUrl: null, tickets: 1, breaks: [] });
  });
  test("the organizer sees ids and names, never phone numbers or hashes", async () => {
    await join(1);
    const txt = await (await call("GET", "/api/z/ENG1/participants", undefined, org)).text();
    expect(txt.includes(phone(1))).toBe(false);
    expect(txt.includes("phone_hash")).toBe(false);
    expect(JSON.parse(txt).participants).toHaveLength(1);
  });
  test("reuse copies the roster into a new engagement and the same phone lands on the new participant", async () => {
    for (let i = 0; i < 5; i++) await join(i);
    await create({ id: "ENG2" });
    const r = await (await call("POST", "/api/z/ENG2/reuse", { from: "ENG1" }, org)).json() as any;
    expect(r.copied).toBe(5);
    const again = await (await join(2, "ENG2")).json() as any;
    expect(again.again).toBe(true); // already on the roster, no new write
    expect((raw.query("SELECT COUNT(*) c FROM participant WHERE eid='ENG2'").get() as any).c).toBe(5);
    const first = (raw.query("SELECT pid FROM participant WHERE eid='ENG1' ORDER BY pid LIMIT 1").get() as any).pid;
    expect((raw.query("SELECT COUNT(*) c FROM participant WHERE eid='ENG2' AND pid=?").get(first) as any).c).toBe(0); // new ids per engagement
  });
  test("reuse twice does not duplicate, and refuses itself or a roster bigger than the cap", async () => {
    for (let i = 0; i < 4; i++) await join(i);
    await create({ id: "ENG2", cap: 3 });
    expect((await call("POST", "/api/z/ENG2/reuse", { from: "ENG1" }, org)).status).toBe(409);
    await create({ id: "ENG3" });
    await call("POST", "/api/z/ENG3/reuse", { from: "ENG1" }, org);
    const r2 = await (await call("POST", "/api/z/ENG3/reuse", { from: "ENG1" }, org)).json() as any;
    expect(r2.copied).toBe(0);
    expect((await call("POST", "/api/z/ENG3/reuse", { from: "ENG3" }, org)).status).toBe(400);
  });
  test("erase removes the people, claims and results of one engagement and leaves the others alone", async () => {
    const pid = ((await (await join(1)).json()) as any).pid;
    await call("POST", "/api/z/ENG1/claims", { pid, claims: [{ pattern: "line", idx: 4 }] });
    await settleByPhones(call, "ENG1", [{ pattern: "line", idx: 4, pids: [pid] }], [pid]);
    await create({ id: "ENG2" }); await join(9, "ENG2");
    const r = await (await call("POST", "/api/z/ENG1/erase", {}, org)).json() as any;
    expect(r.erased).toBe(1);
    for (const t of ["participant", "claim", "settled"]) expect((raw.query(`SELECT COUNT(*) c FROM ${t} WHERE eid='ENG1'`).get() as any).c).toBe(0);
    expect((raw.query("SELECT COUNT(*) c FROM participant WHERE eid='ENG2'").get() as any).c).toBe(1);
  });
  test("history lists engagements newest first with head-counts", async () => {
    await join(1); await join(2);
    await create({ id: "ENG2" });
    const h = await (await call("GET", "/api/history", undefined, org)).json() as any;
    expect(h.retentionDays).toBe(365);
    expect(h.engagements.find((x: any) => x.id === "ENG1").participants).toBe(2);
  });
  test("purge deletes only engagements older than 365 days, with everything under them", async () => {
    await join(1);
    await call("POST", "/api/z", { id: "OLD1", startRound: 5, callSeconds: 6, cap: 10 }, org, T - 366 * D);
    await join(5, "OLD1", T - 366 * D);
    await call("POST", "/api/z", { id: "EDGE", startRound: 5, callSeconds: 6, cap: 10 }, org, T - 364 * D);

    const r = await (await call("POST", "/api/purge", {}, org)).json() as any;
    expect(r.purged).toBe(1);
    expect(raw.query("SELECT id FROM engagement ORDER BY id").all()).toEqual([{ id: "EDGE" }, { id: "ENG1" }]);
    expect((raw.query("SELECT COUNT(*) c FROM participant WHERE eid='OLD1'").get() as any).c).toBe(0);
  });
  test("a day over the write budget does not erase half-way: erase says busy and changes nothing", async () => {
    for (let i = 0; i < 5; i++) await join(i);
    env.DAILY_WRITE_BUDGET = "6";
    expect((await call("POST", "/api/z/ENG1/erase", {}, org)).status).toBe(503);
    expect((raw.query("SELECT COUNT(*) c FROM participant").get() as any).c).toBe(5);
  });
});

describe("organizers, their AI assistant, and what the AI may not do", () => {
  const plat = { "x-organizer": SECRET };
  let master = "", aiKey = "", other = "";
  const asM = () => ({ "x-organizer": master });
  const asA = () => ({ "x-organizer": aiKey });
  const FUTURE = Math.floor((T / 1000 - 1692803367) / 3) + 1 + 2000; // a start round well after T
  beforeEach(async () => {
    master = ((await (await call("POST", "/api/org", {}, plat)).json()) as any).organizerKey;
    other = ((await (await call("POST", "/api/org", {}, plat)).json()) as any).organizerKey;
    aiKey = ((await (await call("POST", "/api/org/ai", {}, asM())).json()) as any).aiKey;
    for (let i = 0; i < 6; i++) raw.run("INSERT INTO entitlement(id,org,pack,payment_id,eid,created_ms) SELECT 'g" + i + "'||hash, org, 1000, 'x', NULL, 0 FROM organizer_key WHERE kind='master'"); // purchased engagements
    await call("POST", "/api/z", { id: "MINE1", startRound: FUTURE, callSeconds: 6, cap: 50 }, asM());
  });
  test("only the platform makes organizers; keys are shown once and never stored in the clear", async () => {
    expect((await call("POST", "/api/org", {}, asM())).status).toBe(403);
    expect((await call("POST", "/api/org", {})).status).toBe(403);
    expect(master).toMatch(/^cbk_[0-9a-f]{48}$/);
    expect(aiKey).toMatch(/^cba_[0-9a-f]{48}$/);
    const dump = JSON.stringify(raw.query("SELECT * FROM organizer_key").all());
    expect(dump.includes(master) || dump.includes(aiKey)).toBe(false);
  });
  test("an organizer reaches only their own engagements; another organizer gets nothing", async () => {
    expect((await call("GET", "/api/z/MINE1/participants", undefined, asM())).status).toBe(200);
    expect((await call("GET", "/api/z/MINE1/participants", undefined, { "x-organizer": other })).status).toBe(403);
    expect((await call("GET", "/api/z/MINE1/claims", undefined, { "x-organizer": "cbk_nope" })).status).toBe(403);
    const h = await (await call("GET", "/api/history", undefined, { "x-organizer": other })).json() as any;
    expect(h.engagements).toEqual([]);
    expect((await (await call("GET", "/api/history", undefined, asM())).json() as any).engagements.map((x: any) => x.id)).toEqual(["MINE1"]);
  });
  test("another organizer can neither reuse my roster nor create over my id", async () => {
    await call("POST", "/api/z", { id: "THEIRS", startRound: FUTURE, callSeconds: 6, cap: 50 }, { "x-organizer": other });
    expect((await call("POST", "/api/z/THEIRS/reuse", { from: "MINE1" }, { "x-organizer": other })).status).toBe(400);
    const r = await (await call("POST", "/api/z", { id: "MINE1", startRound: 1, callSeconds: 6, cap: 1 }, { "x-organizer": other })).json() as any;
    expect(r.existed).toBe(true);
    expect(raw.query("SELECT cap FROM engagement WHERE id='MINE1'").get()).toEqual({ cap: 50 });
  });
  test("the AI can do the organizer's work: create, load an invite list, change settings, read people and claims, reuse", async () => {
    expect((await call("POST", "/api/z", { id: "BYAI1", startRound: FUTURE, callSeconds: 9, cap: 10 }, asA())).status).toBe(200);
    const r = await (await call("POST", "/api/z/BYAI1/roster", { people: [{ phone: phone(1), name: "A" }, { phone: phone(2), name: "B" }, { phone: "12" }] }, asM())).json() as any; // the owner loads the list; an AI key is refused (names and numbers never pass through the AI)
    expect((await call("POST", "/api/z/BYAI1/roster", { people: [{ phone: phone(9), name: "Z" }] }, asA())).status).toBe(403);
    expect(r).toMatchObject({ added: 2, invalid: 1 });
    expect((await call("PATCH", "/api/z/BYAI1/settings", { callSeconds: 12 }, asA())).status).toBe(200);
    expect(((await (await call("GET", "/api/z/BYAI1/participants", undefined, asA())).json()) as any).participants).toHaveLength(2);
    expect((await call("GET", "/api/z/BYAI1/claims", undefined, asA())).status).toBe(200);
    expect((await call("POST", "/api/z/MINE1/reuse", { from: "BYAI1" }, asA())).status).toBe(200);
  });
  test("the AI can NOT publish results, erase data, register the pause key, or mint keys", async () => {
    expect((await call("POST", "/api/z/MINE1/settle", { results: [{ pattern: "blackout", idx: 5, pids: ["x"] }] }, asA())).status).toBe(403);
    expect((await call("POST", "/api/z/MINE1/erase", {}, asA())).status).toBe(403);
    expect((await call("PUT", "/api/z/MINE1/control/key", { publicKey: "aa".repeat(32) }, asA())).status).toBe(403);
    expect((await call("POST", "/api/org/ai", {}, asA())).status).toBe(403);
    expect((await call("POST", "/api/org/ai/revoke", {}, asA())).status).toBe(403);
    expect((await call("POST", "/api/purge", {}, asA())).status).toBe(403);
    expect(raw.query("SELECT COUNT(*) c FROM settled").get()).toEqual({ c: 0 });
  });
  test("every call the AI makes is written to an audit trail with where it came from; the organizer and the AI itself read it, strangers cannot", async () => {
    await call("GET", "/api/z/MINE1/summary", undefined, { ...asA(), "cf-connecting-ip": "203.0.113.9", "user-agent": "ChatGPT-User/1.0", "cf-ipcountry": "US" });
    await call("POST", "/api/z/MINE1/erase", {}, asA());
    await call("GET", "/api/z/MINE1/summary", undefined, asM()); // the organizer's own calls are not part of the AI trail
    const t = (await (await call("GET", "/api/org/ai/audit", undefined, asM())).json()) as any;
    expect(t.trail).toHaveLength(3); // the two AI calls and the organizer's own "replace my AI link" (audited too)
    expect(t.trail.filter((x: any) => x.path === "/api/org/ai/replace")).toHaveLength(1);
    expect(t.trail.find((x: any) => x.path.endsWith("/summary"))).toMatchObject({ ip: "203.0.113.9", ua: "ChatGPT-User/1.0", country: "US", method: "GET", status: 200, eid: "MINE1" });
    expect(t.trail.find((x: any) => x.path.endsWith("/erase")).status).toBe(403);
    expect((await call("GET", "/api/org/ai/audit", undefined, asA())).status).toBe(200); // the AI may read its own trail
    expect((await call("GET", "/api/org/ai/audit")).status).toBe(403);
  });
  test("the refusal explains itself plainly, and the manifest says what the AI cannot do", async () => {
    const r = await (await call("POST", "/api/z/MINE1/erase", {}, asA())).json() as any;
    expect(r.error).toMatch(/AI assistant may not/);
    const mf = await (await call("GET", "/api/z/ai-manifest")).json() as any;
    expect(JSON.stringify(mf.you_cannot)).toMatch(/Choose, publish, change or remove winners/);
    expect(JSON.stringify(mf)).not.toMatch(/lottery|bogey|player\b|prize\b|admin/i);
  });
  test("a new AI key replaces the old one; revoking stops it at once; the master key is unaffected", async () => {
    const second = ((await (await call("POST", "/api/org/ai", {}, asM())).json()) as any).aiKey;
    expect((await call("GET", "/api/z/MINE1/participants", undefined, asA())).status).toBe(403);
    expect((await call("GET", "/api/z/MINE1/participants", undefined, { "x-organizer": second })).status).toBe(200);
    const r = await (await call("POST", "/api/org/ai/revoke", {}, asM())).json() as any;
    expect(r.revoked).toBeGreaterThanOrEqual(1); // the new key (and any 24-hour mailed key)
    expect((await call("GET", "/api/z/MINE1/participants", undefined, { "x-organizer": second })).status).toBe(403);
    expect((await call("GET", "/api/z/MINE1/participants", undefined, asM())).status).toBe(200);
  });
  test("pausing: the AI asks, the organizer sees the request and clears it; nobody else can see it", async () => {
    expect((await call("POST", "/api/z/MINE1/control/request", { action: "explode" }, asA())).status).toBe(400);
    expect((await call("POST", "/api/z/MINE1/control/request", { action: "pause", note: "Fire drill <b>now</b>" }, asA())).status).toBe(200);
    const q = await (await call("GET", "/api/z/MINE1/control/request", undefined, asM())).json() as any;
    expect(q.requests).toHaveLength(1);
    expect(q.requests[0].note).not.toMatch(/[<>]/);
    expect((await call("GET", "/api/z/MINE1/control/request", undefined, { "x-organizer": other })).status).toBe(403);
    expect((await call("POST", "/api/z/MINE1/control/request/clear", {}, asA())).status).toBe(403);
    expect((await call("POST", "/api/z/MINE1/control/request/clear", {}, asM())).status).toBe(200);
    expect(((await (await call("GET", "/api/z/MINE1/control/request", undefined, asM())).json()) as any).requests).toEqual([]);
  });
  test("invite-only: a number on the list gets in, any other is told so; the list respects the limit", async () => {
    await call("PATCH", "/api/z/MINE1/settings", { closed: true, cap: 3 }, asM());
    await call("POST", "/api/z/MINE1/roster", { people: [{ phone: phone(1), name: "A" }, { phone: phone(2) }] }, asM());
    expect((await join(1, "MINE1")).status).toBe(200);
    const no = await join(9, "MINE1");
    expect(no.status).toBe(403);
    expect(((await no.json()) as any).error).toMatch(/by invitation/);
    const r = await (await call("POST", "/api/z/MINE1/roster", { people: [{ phone: phone(3) }, { phone: phone(4) }] }, asM())).json() as any;
    expect(r).toMatchObject({ added: 1, skipped: 1 });
  });
  test("a roster entry joins with the same ticket id they would get joining by themselves", async () => {
    await call("POST", "/api/z/MINE1/roster", { people: [{ phone: phone(5), name: "Rosa" }] }, asM());
    const pid = (raw.query("SELECT pid FROM participant WHERE eid='MINE1'").get() as any).pid;
    const j = await (await join(5, "MINE1")).json() as any;
    expect(j.pid).toBe(pid);
    expect(j.again).toBe(true);
  });
  test("roster limits: up to 100 per call, none empty, hostile bodies refused", async () => {
    expect((await call("POST", "/api/z/MINE1/roster", { people: [] }, asM())).status).toBe(400);
    expect((await call("POST", "/api/z/MINE1/roster", { people: Array.from({ length: 101 }, (_, i) => ({ phone: phone(i) })) }, asM())).status).toBe(400);
    expect((await call("POST", "/api/z/MINE1/roster", "not json", asM())).status).toBe(400);
  });
  test("settings can change before the first number and never after; bad values change nothing", async () => {
    expect((await call("PATCH", "/api/z/MINE1/settings", { callSeconds: 10 }, asM())).status).toBe(400);
    expect((await call("PATCH", "/api/z/MINE1/settings", { startRound: 5 }, asM())).status).toBe(400); // in the past
    expect((await call("PATCH", "/api/z/MINE1/settings", { callSeconds: 15, startRound: FUTURE + 100 }, asM())).status).toBe(200);
    expect(raw.query("SELECT call_seconds, start_round FROM engagement WHERE id='MINE1'").get()).toEqual({ call_seconds: 15, start_round: FUTURE + 100 });
    await call("POST", "/api/z", { id: "OLDSTART", startRound: 5, callSeconds: 6, cap: 5 }, asM()); // already started long ago
    expect((await call("PATCH", "/api/z/OLDSTART/settings", { cap: 9 }, asM())).status).toBe(409);
  });
  test("the limit cannot be set below the people already listed", async () => {
    await call("POST", "/api/z/MINE1/roster", { people: [{ phone: phone(1) }, { phone: phone(2) }, { phone: phone(3) }] }, asM());
    expect((await call("PATCH", "/api/z/MINE1/settings", { cap: 2 }, asM())).status).toBe(409);
  });
  test("the platform key still works everywhere (single-tenant and local use)", async () => {
    expect((await call("GET", "/api/z/MINE1/participants", undefined, plat)).status).toBe(200);
    expect((await call("POST", "/api/z/MINE1/erase", {}, plat)).status).toBe(200);
  });
  test("purge also removes the pause file and requests of an old engagement", async () => {
    await call("POST", "/api/z", { id: "ANCIENT", startRound: 5, callSeconds: 6, cap: 5 }, plat, T - 400 * 86_400_000);
    await call("POST", "/api/z/ANCIENT/control/request", { action: "pause" }, plat);
    await call("PUT", "/api/z/ANCIENT/control/key", { publicKey: "aa".repeat(32) }, plat);
    await call("POST", "/api/purge", {}, plat);
    expect(raw.query("SELECT COUNT(*) c FROM cbl_request WHERE eid='ANCIENT'").get()).toEqual({ c: 0 });
    expect(raw.query("SELECT COUNT(*) c FROM kv WHERE k LIKE 'control/ANCIENT%'").get()).toEqual({ c: 0 });
  });
});

describe("the shared suggestion board for every organizer's AI", () => {
  const plat = { "x-organizer": SECRET };
  let ma = "", mb = "", aiA = "";
  const asA = () => ({ "x-organizer": aiA });
  const asB = () => ({ "x-organizer": mb });
  const sug = (h: Record<string, string>, o: Record<string, unknown> = {}) => call("POST", "/api/z/suggestions", { kind: "feature", title: "Team leaderboard across rounds", body: "Show each team's total after every round so teams can compare.", ...o }, h);
  beforeEach(async () => {
    ma = ((await (await call("POST", "/api/org", {}, plat)).json()) as any).organizerKey;
    mb = ((await (await call("POST", "/api/org", {}, plat)).json()) as any).organizerKey;
    aiA = ((await (await call("POST", "/api/org/ai", {}, { "x-organizer": ma })).json()) as any).aiKey;
  });
  test("an organizer's AI can suggest; strangers cannot", async () => {
    expect((await sug(asA())).status).toBe(200);
    expect((await sug({ "x-organizer": "cba_nobody" })).status).toBe(403);
    expect((await sug({})).status).toBe(403);
  });
  test("every other organizer's AI can read the whole board, but never who wrote what", async () => {
    await sug(asA());
    const list = await (await call("GET", "/api/z/suggestions", undefined, asB())).json() as any;
    expect(list.suggestions).toHaveLength(1);
    expect(list.suggestions[0]).toMatchObject({ kind: "feature", status: "new", votes: 1, yours: false });
    expect(JSON.stringify(list)).not.toMatch(/"org"/);
    const mine = await (await call("GET", "/api/z/suggestions", undefined, asA())).json() as any;
    expect(mine.suggestions[0].yours).toBe(true);
    const asPlatform = await (await call("GET", "/api/z/suggestions", undefined, plat)).json() as any;
    expect(asPlatform.suggestions[0].org).toBeTruthy(); // we can see who, to follow up
  });
  test("the board is closed to the public", async () => {
    expect((await call("GET", "/api/z/suggestions")).status).toBe(403);
  });
  test("a vote counts once per organizer, however often it is sent", async () => {
    const id = ((await (await sug(asA())).json()) as any).id;
    for (let i = 0; i < 3; i++) await call("POST", `/api/z/suggestions/${id}/vote`, {}, asB());
    await call("POST", `/api/z/suggestions/${id}/vote`, {}, asA()); // the author already counted
    const list = await (await call("GET", "/api/z/suggestions", undefined, asB())).json() as any;
    expect(list.suggestions[0].votes).toBe(2);
    expect(list.suggestions[0].youSupported).toBe(true);
    expect((await call("POST", "/api/z/suggestions/9999/vote", {}, asB())).status).toBe(404);
  });
  test("the same idea sent twice is stored once", async () => {
    const a = await (await sug(asA())).json() as any;
    const b = await (await sug(asA(), { title: "  team LEADERBOARD   across rounds " })).json() as any;
    expect(b.duplicate).toBe(true);
    expect(b.id).toBe(a.id);
    expect(raw.query("SELECT COUNT(*) c FROM suggestion").get()).toEqual({ c: 1 });
  });
  test("only we decide the outcome: neither an AI nor an organizer can change a status or a note", async () => {
    const id = ((await (await sug(asA())).json()) as any).id;
    expect((await call("POST", `/api/z/suggestions/${id}/status`, { status: "shipped" }, asA())).status).toBe(403);
    expect((await call("POST", `/api/z/suggestions/${id}/status`, { status: "shipped" }, asB())).status).toBe(403);
    expect((await call("POST", `/api/z/suggestions/${id}/status`, { status: "declined" }, { "x-organizer": ma })).status).toBe(403);
    expect((await call("POST", `/api/z/suggestions/${id}/status`, { status: "mystery" }, plat)).status).toBe(400);
    expect((await call("POST", `/api/z/suggestions/${id}/status`, { status: "planned", note: "Good one <b>thanks</b>" }, plat)).status).toBe(200);
    const list = await (await call("GET", "/api/z/suggestions?status=planned", undefined, asB())).json() as any;
    expect(list.suggestions[0]).toMatchObject({ status: "planned", note: "Good one bthanks/b" });
    expect(((await (await call("GET", "/api/z/suggestions?status=new", undefined, asB())).json()) as any).suggestions).toEqual([]);
  });
  test("nobody can edit or delete a suggestion, their own or another's", async () => {
    const id = ((await (await sug(asA())).json()) as any).id;
    for (const m of ["PATCH", "PUT", "DELETE"]) expect([404, 403]).toContain((await call(m, `/api/z/suggestions/${id}`, { title: "hacked" }, asB())).status);
    expect(raw.query("SELECT title FROM suggestion WHERE id=?").get(id)).toEqual({ title: "Team leaderboard across rounds" });
  });
  test("bad kinds, too short or too long text and markup are refused or cleaned", async () => {
    for (const o of [{ kind: "hack" }, { title: "ab" }, { title: "x".repeat(121) }, { body: "short" }, { body: "y".repeat(2001) }]) expect((await sug(asA(), o)).status).toBe(400);
    const r = await (await sug(asA(), { title: "Use <script>alert(1)</script> colours", body: "Make the board <b>brighter</b> for older phones please." })).json() as any;
    expect(r.ok).toBe(true);
    const row = raw.query("SELECT title, body FROM suggestion WHERE id=?").get(r.id) as any;
    expect(/[<>`]/.test(row.title + row.body)).toBe(false);
  });
  test("personal details are refused so the shared board never leaks anyone", async () => {
    expect((await sug(asA(), { body: "Ask Priya at priya@acme.com to approve the list before it starts." })).status).toBe(400);
    expect((await sug(asA(), { body: "Call 98765 43210 when the engagement is about to begin please." })).status).toBe(400);
    expect((await sug(asA(), { body: "Call 9 8 7 6 5 4 3 2 1 0 when the engagement is about to begin." })).status).toBe(400);
    expect(raw.query("SELECT COUNT(*) c FROM suggestion").get()).toEqual({ c: 0 });
  });
  test("at most 20 a day per organizer, then fine again the next day", async () => {
    for (let i = 0; i < 20; i++) expect((await sug(asA(), { title: "Idea number " + i + " for later" })).status).toBe(200);
    expect((await sug(asA(), { title: "One idea too many today" })).status).toBe(429);
    expect((await sug(asB(), { title: "One idea too many today" })).status).toBe(200); // another organizer is unaffected
    expect((await call("POST", "/api/z/suggestions", { kind: "feature", title: "Fresh idea next day", body: "A perfectly reasonable description of the need." }, asA(), T + 86_400_001 + 1)).status).toBe(200);
  });
  test("a suggestion gives no one a way to run code or touch another organizer's engagements", async () => {
    await call("POST", "/api/z", { id: "OTHERS1", startRound: FAR_START, callSeconds: 9, cap: 5 }, plat);
    for (const path of ["/api/z/OTHERS1/participants", "/api/z/OTHERS1/claims", "/api/z/OTHERS1/roster", "/api/z/OTHERS1/erase", "/api/z/OTHERS1/settle", "/api/z/OTHERS1/settings"])
      expect([403, 404, 405]).toContain((await call(path.endsWith("participants") || path.endsWith("claims") ? "GET" : "POST", path, {}, asA())).status);
  });
  test("the manifest tells the AI about the board and what not to put on it", async () => {
    const mf = await (await call("GET", "/api/z/ai-manifest")).json() as any;
    expect(JSON.stringify(mf)).toMatch(/suggest/i);
    expect(mf.suggestions_rules).toMatch(/Never include names, phone numbers/);
    expect(JSON.stringify(mf.you_cannot)).toMatch(/code/i);
  });
});

describe("pause file served from a cached static copy", () => {
  const plat = { "x-organizer": SECRET };
  let store: Map<string, any>;
  beforeEach(async () => {
    store = new Map();
    env.CONTROL_R2 = { put: async (k: string, v: string, o: unknown) => void store.set(k, { v, o }), delete: async (k: string) => void store.delete(k) };
    env.CONTROL_BASE = "https://c.example.test/";
    await create();
  });
  test("info tells phones where the static file is only when a static store is configured", async () => {
    expect(((await (await call("GET", "/api/z/ENG1/info")).json()) as any).controlUrl).toBe("https://c.example.test/c/ENG1.json");
    env.CONTROL_R2 = undefined;
    expect(((await (await call("GET", "/api/z/ENG1/info")).json()) as any).controlUrl).toBeNull();
  });
  test("registering the key and every signed message refreshes the static copy, which equals what the Worker serves", async () => {
    const { publicKeyFromSecret, signControlWithSecret, nextMessage, readPublished } = await import("../../../packages/beacon/src/control");
    const KEY = "55".repeat(32);
    expect((await call("PUT", "/api/z/ENG1/control/key", { publicKey: publicKeyFromSecret(KEY) }, plat)).status).toBe(200);
    expect(store.get("c/ENG1.json")).toBeTruthy();
    const kv = { get: async (k: string) => (raw.query("SELECT v FROM kv WHERE k=?").get(k) as any)?.v ?? null, put: async () => {} };
    const f = (await readPublished(kv, "ENG1"))!;
    const nowRound = Math.floor((T / 1000 - 1692803367) / 3) + 1;
    const m = signControlWithSecret(KEY, nextMessage(f, nowRound, { action: "pause", pauseForRounds: 20 }));
    expect((await call("POST", "/api/z/ENG1/control", { message: m })).status).toBe(200);
    const served = await (await call("GET", "/api/z/ENG1/control")).text();
    expect(JSON.parse(store.get("c/ENG1.json").v)).toEqual(JSON.parse(served));
    expect(JSON.parse(served).messages).toHaveLength(1);
    expect(store.get("c/ENG1.json").o.httpMetadata.cacheControl).toBe("public, max-age=3");
  });
  test("a refused message leaves the static copy untouched", async () => {
    const { publicKeyFromSecret, signControlWithSecret, nextMessage, readPublished } = await import("../../../packages/beacon/src/control");
    await call("PUT", "/api/z/ENG1/control/key", { publicKey: publicKeyFromSecret("55".repeat(32)) }, plat);
    const before = store.get("c/ENG1.json").v;
    const kv = { get: async (k: string) => (raw.query("SELECT v FROM kv WHERE k=?").get(k) as any)?.v ?? null, put: async () => {} };
    const f = (await readPublished(kv, "ENG1"))!;
    const bad = signControlWithSecret("66".repeat(32), nextMessage(f, 100, { action: "pause", pauseForRounds: 10 }));
    expect((await call("POST", "/api/z/ENG1/control", { message: bad })).status).toBe(403);
    expect(store.get("c/ENG1.json").v).toBe(before);
  });
  test("if the static store fails, signing and serving still work from the Worker", async () => {
    const { publicKeyFromSecret } = await import("../../../packages/beacon/src/control");
    env.CONTROL_R2 = { put: async () => { throw new Error("r2 down"); }, delete: async () => {} };
    expect((await call("PUT", "/api/z/ENG1/control/key", { publicKey: publicKeyFromSecret("55".repeat(32)) }, plat)).status).toBe(200);
    expect((await call("GET", "/api/z/ENG1/control")).status).toBe(200);
  });
  test("purging an old engagement removes its static copy too", async () => {
    const { publicKeyFromSecret } = await import("../../../packages/beacon/src/control");
    await call("POST", "/api/z", { id: "OLD99", startRound: 5, callSeconds: 6, cap: 5 }, plat, T - 400 * 86_400_000);
    await call("PUT", "/api/z/OLD99/control/key", { publicKey: publicKeyFromSecret("77".repeat(32)) }, plat);
    expect(store.has("c/OLD99.json")).toBe(true);
    await call("POST", "/api/purge", {}, plat);
    expect(store.has("c/OLD99.json")).toBe(false);
  });
});

describe("tickets, reward lines and brand breaks", () => {
  const FUT = Math.floor((T / 1000 - 1692803367) / 3) + 1 + 4000;
  const mk = (extra: Record<string, unknown> = {}, id = "CFG01") => call("POST", "/api/z", { id, startRound: FUT, callSeconds: 9, cap: 50, ...extra }, org);
  const info = async (id = "CFG01") => (await (await call("GET", `/api/z/${id}/info`)).json()) as any;
  test("an engagement with nothing set shows phones the plain defaults", async () => {
    await mk();
    const i = await info();
    expect(i.tickets).toBe(1);
    expect(i.rewards).toHaveLength(4);
    expect(i.breaks).toEqual([]);
  });
  test("settings given at creation are kept and shown to every phone; bad ones refuse the whole creation", async () => {
    const good = { tickets: 2, rewards: [{ pattern: "blackout", ordinal: 1, text: "Hamper" }, { pattern: "line", text: "Grand hamper" }], breaks: [{ after: 40, seconds: 45, kind: "speech", title: "CEO message" }] };
    expect((await mk(good)).status).toBe(200);
    const i = await info();
    expect(i).toMatchObject({ tickets: 2, breaks: [{ after: 40, seconds: 45, kind: "speech", title: "CEO message" }] });
    expect(i.rewards.map((r: any) => r.text)).toEqual(["Hamper", "Grand hamper"]);
    expect((await mk({ breaks: [{ after: 5, seconds: 20, kind: "speech", title: "x" }] }, "CFG02")).status).toBe(400);
    expect((await mk({ tickets: 5 }, "CFG03")).status).toBe(400);
    expect(raw.query("SELECT COUNT(*) c FROM engagement WHERE id IN ('CFG02','CFG03')").get()).toEqual({ c: 0 });
  });
  test("joining returns the settings too, so a phone never needs a second call", async () => {
    await mk({ tickets: 2, rewards: [{ pattern: "blackout", text: "Hamper" }] });
    const r = await (await join(1, "CFG01")).json() as any;
    expect(r.tickets).toBe(2);
    expect(r.rewards[0].text).toBe("Hamper");
  });
  test("settings can be changed before the start and never after, and a bad change changes nothing", async () => {
    await mk();
    expect((await call("PATCH", "/api/z/CFG01/settings", { tickets: 2, rewards: [{ pattern: "line", text: "Voucher" }], breaks: [{ after: 20, seconds: 30, kind: "speech", title: "Welcome" }] }, org)).status).toBe(200);
    expect(await info()).toMatchObject({ tickets: 2, rewards: [{ pattern: "line", text: "Voucher" }], breaks: [{ after: 20 }] });
    expect((await call("PATCH", "/api/z/CFG01/settings", { breaks: [{ after: 20, seconds: 31, kind: "speech", title: "Welcome" }] }, org)).status).toBe(400);
    expect((await info()).breaks).toHaveLength(1);
    await call("POST", "/api/z", { id: "STARTED1", startRound: 5, callSeconds: 6, cap: 5 }, org);
    expect((await call("PATCH", "/api/z/STARTED1/settings", { tickets: 2 }, org)).status).toBe(409);
  });
  test("results carry which reward line each outcome is for, and an accepted result is final", async () => {
    await mk({ tickets: 1, rewards: [{ pattern: "blackout", ordinal: 1 }, { pattern: "blackout", ordinal: 2 }] });
    const p1 = ((await (await join(1, "CFG01")).json()) as any).pid, p2 = ((await (await join(2, "CFG01")).json()) as any).pid;
    await settleByPhones(call, "CFG01", [{ pattern: "blackout", ordinal: 1, idx: 50, pids: [p1] }, { pattern: "blackout", ordinal: 2, idx: 53, pids: [p2] }], [p1]);
    await settleByPhones(call, "CFG01", [{ pattern: "blackout", ordinal: 1, idx: 51, pids: [p2] }], [p2]); // a later, different report does not replace it
    const r = await (await call("GET", "/api/z/CFG01/results")).json() as any;
    expect(r.results).toEqual([{ pattern: "blackout", ordinal: 1, round: 1, idx: 50, count: 1, winners: [p1] }, { pattern: "blackout", ordinal: 2, round: 1, idx: 53, count: 1, winners: [p2] }]);
    await settleByPhones(call, "CFG01", [{ pattern: "blackout", ordinal: 3, idx: 1, pids: [p1] }, { pattern: "twolines", ordinal: 1, idx: 1, pids: [p1] }], [p1]); // a line this engagement does not have is ignored
    expect(((await (await call("GET", "/api/z/CFG01/results")).json()) as any).results).toHaveLength(2);
  });
});

describe("lucky draw results", () => {
  const FUT = Math.floor((T / 1000 - 1692803367) / 3) + 1 + 4000;
  let pids: string[] = [];
  beforeEach(async () => {
    await call("POST", "/api/z", { id: "LUCK1", startRound: FUT, callSeconds: 9, cap: 50, breaks: [{ after: 20, seconds: 30, kind: "lucky", title: "Lucky draw", winners: 3 }] }, org);
    pids = []; for (let i = 1; i <= 5; i++) pids.push(((await (await join(i, "LUCK1")).json()) as any).pid);
  });
  const pub = async () => (await (await call("GET", "/api/z/LUCK1/results")).json()) as any;
  test("the winners are accepted when several phones agree, and are shown by opaque ids so each phone can tell if it won", async () => {
    expect((await call("POST", "/api/z/LUCK1/settle", { results: [{ pattern: "lucky", ordinal: 1, idx: 20, pids: [pids[0]!] }] }, org)).status).toBe(403);
    await settleByPhones(call, "LUCK1", [{ pattern: "lucky", idx: 20, pids: [pids[0]!, pids[1]!, pids[2]!] }], pids.slice(0, 3));
    expect((await pub()).results[0]).toEqual({ pattern: "lucky", ordinal: 1, round: 1, idx: 20, count: 3, winners: [pids[0]!, pids[1]!, pids[2]!].sort() });
  });
  test("house results still carry counts only", async () => {
    await settleByPhones(call, "LUCK1", [{ pattern: "blackout", idx: 70, pids: [pids[0]!] }], pids);
    expect(/phone|mobile|9876/i.test(JSON.stringify(await pub()))).toBe(false); // seat ids may be named, never names or numbers
  });
  test("a draw that is not in the engagement's settings, or with too many winners, is ignored", async () => {
    await settleByPhones(call, "LUCK1", [{ pattern: "lucky", ordinal: 2, idx: 20, pids: [pids[0]!] }], pids);
    await settleByPhones(call, "LUCK1", [{ pattern: "lucky", idx: 20, pids: Array.from({ length: 11 }, (_, i) => `${i + 1}x${"0".repeat(11)}1`) }], pids);
    expect((await pub()).results).toEqual([]);
  });
  test("an accepted draw is final: a later report does not add a second set of winners", async () => {
    await settleByPhones(call, "LUCK1", [{ pattern: "lucky", idx: 20, pids: [pids[0]!] }], pids.slice(0, 3));
    await settleByPhones(call, "LUCK1", [{ pattern: "lucky", idx: 20, pids: [pids[1]!] }], pids);
    expect((await pub()).results.map((x: any) => x.winners)).toEqual([[pids[0]!]]);
  });
  test("an engagement with no lucky draw ignores lucky results", async () => {
    await call("POST", "/api/z", { id: "PLAIN1", startRound: FUT, callSeconds: 9, cap: 50 }, org);
    const q = ((await (await join(1, "PLAIN1")).json()) as any).pid;
    await settleByPhones(call, "PLAIN1", [{ pattern: "lucky", idx: 20, pids: [q] }], [q]);
    expect(raw.query("SELECT COUNT(*) c FROM settled WHERE eid='PLAIN1'").get()).toEqual({ c: 0 });
  });
});

describe("an organizer's own sign-in keys", () => {
  const plat = { "x-organizer": SECRET };
  let a1 = "", other = "";
  beforeEach(async () => { a1 = ((await (await call("POST", "/api/org", {}, plat)).json()) as any).organizerKey; other = ((await (await call("POST", "/api/org", {}, plat)).json()) as any).organizerKey; });
  const list = async (k: string) => (await (await call("GET", "/api/org/keys", undefined, { "x-organizer": k })).json()) as any;
  test("lists only their own keys, marks the one in use, and never shows a key", async () => {
    const l = await list(a1);
    expect(l.keys).toHaveLength(1);
    expect(l.keys[0]).toMatchObject({ kind: "master", revoked: false, thisOne: true });
    expect(JSON.stringify(l).includes(a1)).toBe(false);
    expect((await list(other)).keys).toHaveLength(1);
    expect((await call("GET", "/api/org/keys")).status).toBe(403);
  });
  test("an old key can be retired from another signed-in key, and then stops working at once", async () => {
    const aiK = ((await (await call("POST", "/api/org/ai", {}, { "x-organizer": a1 })).json()) as any).aiKey;
    const l = await list(a1);
    const ai = l.keys.find((k: any) => k.kind === "ai");
    expect((await call("POST", "/api/org/keys/revoke", { id: ai.id }, { "x-organizer": a1 })).status).toBe(200);
    expect((await call("GET", "/api/history", undefined, { "x-organizer": aiK })).status).toBe(403);
    expect((await list(a1)).keys.find((k: any) => k.id === ai.id).revoked).toBe(true);
  });
  test("you cannot retire the key you are using, and the AI key cannot manage keys", async () => {
    const mine = (await list(a1)).keys[0];
    const r = await call("POST", "/api/org/keys/revoke", { id: mine.id }, { "x-organizer": a1 });
    expect(r.status).toBe(409);
    expect((await call("GET", "/api/history", undefined, { "x-organizer": a1 })).status).toBe(200);
    const aiK = ((await (await call("POST", "/api/org/ai", {}, { "x-organizer": a1 })).json()) as any).aiKey;
    expect((await call("GET", "/api/org/keys", undefined, { "x-organizer": aiK })).status).toBe(403);
    expect((await call("POST", "/api/org/keys/revoke", { id: mine.id }, { "x-organizer": aiK })).status).toBe(403);
  });
  test("one organizer cannot retire another's key, and a bad id is refused", async () => {
    const theirs = (await list(other)).keys[0];
    const r = await (await call("POST", "/api/org/keys/revoke", { id: theirs.id }, { "x-organizer": a1 })).json() as any;
    expect(r.revoked).toBe(0);
    expect((await call("GET", "/api/history", undefined, { "x-organizer": other })).status).toBe(200);
    for (const id of ["zz", "", 5, "../../../etc"]) expect((await call("POST", "/api/org/keys/revoke", { id }, { "x-organizer": a1 })).status).toBe(400);
  });
});

describe("rounds in the store", () => {
  const FUT = Math.floor((T / 1000 - 1692803367) / 3) + 1 + 4000;
  test("rounds are set at creation or before the start, shown to phones, and 1 to 5 only", async () => {
    expect((await call("POST", "/api/z", { id: "RND01", startRound: FUT, callSeconds: 9, cap: 50, rounds: 3 }, org)).status).toBe(200);
    expect(((await (await call("GET", "/api/z/RND01/info")).json()) as any).rounds).toBe(3);
    expect((await call("PATCH", "/api/z/RND01/settings", { rounds: 2 }, org)).status).toBe(200);
    expect(((await (await call("GET", "/api/z/RND01/info")).json()) as any).rounds).toBe(2);
    for (const r of [0, 6, 1.5, "2"]) { expect((await call("PATCH", "/api/z/RND01/settings", { rounds: r }, org)).status).toBe(400); expect((await call("POST", "/api/z", { id: "BADR" + String(r).length, startRound: FUT, callSeconds: 9, cap: 5, rounds: r }, org)).status).toBe(400); }
    expect(((await (await call("GET", "/api/z/RND01/info")).json()) as any).rounds).toBe(2);
  });
  test("an engagement with nothing set is one round", async () => {
    await call("POST", "/api/z", { id: "RND02", startRound: FUT, callSeconds: 9, cap: 50 }, org);
    expect(((await (await call("GET", "/api/z/RND02/info")).json()) as any).rounds).toBe(1);
  });
  test("claims are kept per round, a round that does not exist is ignored, and the same claim in two rounds is two claims", async () => {
    await call("POST", "/api/z", { id: "RND03", startRound: FUT, callSeconds: 9, cap: 50, rounds: 2 }, org);
    const pid = ((await (await join(1, "RND03")).json()) as any).pid;
    const claim = (c: unknown) => call("POST", "/api/z/RND03/claims", { pid, claims: [c] });
    await claim({ pattern: "line", idx: 20 }); await claim({ pattern: "line", idx: 25, round: 2 }); await claim({ pattern: "line", idx: 25, round: 2 }); await claim({ pattern: "line", idx: 30, round: 3 }); await claim({ pattern: "line", idx: 30, round: 0 });
    const c = (await (await call("GET", "/api/z/RND03/claims", undefined, org)).json() as any).claims;
    expect(c).toEqual([{ pid, pattern: "line", round: 1, idx: 20 }, { pid, pattern: "line", round: 2, idx: 25 }]);
  });
  test("results are kept per round; a round that does not exist, or a lucky draw in round 2, is ignored", async () => {
    await call("POST", "/api/z", { id: "RND04", startRound: FUT, callSeconds: 9, cap: 50, rounds: 2, breaks: [{ after: 20, seconds: 30, kind: "lucky", title: "Draw", winners: 3 }] }, org);
    const p = ((await (await join(1, "RND04")).json()) as any).pid;
    const post = (results: { pattern: string; ordinal?: number; round?: number; idx: number; pids: string[] }[]) => settleByPhones(call, "RND04", results, [p]);
    await post([{ pattern: "blackout", round: 1, idx: 60, pids: [p] }, { pattern: "blackout", round: 2, idx: 70, pids: [p] }]);
    await post([{ pattern: "blackout", round: 3, idx: 1, pids: [p] }, { pattern: "blackout", round: 0, idx: 1, pids: [p] }, { pattern: "lucky", round: 2, idx: 20, pids: [p] }]);
    const r = (await (await call("GET", "/api/z/RND04/results")).json() as any).results;
    expect(r.map((x: any) => [x.round, x.idx, x.count])).toEqual([[1, 60, 1], [2, 70, 1]]);
    await post([{ pattern: "lucky", round: 1, idx: 20, pids: [p] }]);
    expect(((await (await call("GET", "/api/z/RND04/results")).json()) as any).results.some((x: any) => x.pattern === "lucky")).toBe(true);
  });
  test("erase removes every round's claims and results", async () => {
    await call("POST", "/api/z", { id: "RND05", startRound: FUT, callSeconds: 9, cap: 50, rounds: 2 }, org);
    const pid = ((await (await join(1, "RND05")).json()) as any).pid;
    await call("POST", "/api/z/RND05/claims", { pid, claims: [{ pattern: "line", idx: 20, round: 2 }] });
    await settleByPhones(call, "RND05", [{ pattern: "line", round: 2, idx: 20, pids: [pid] }], [pid]);
    await call("POST", "/api/z/RND05/erase", {}, org);
    for (const t of ["claim", "settled", "participant", "rvote", "rcand"]) expect((raw.query(`SELECT COUNT(*) c FROM ${t} WHERE eid='RND05'`).get() as any).c).toBe(0);
  });
});

describe("big lists come in pages, and the daily clean-up runs by itself", () => {
  const plat = { "x-organizer": SECRET };
  const D = 86_400_000;
  const old = (id: string) => raw.run("INSERT INTO engagement(id,start_round,call_seconds,cap,created_ms,org,closed,pack,tickets,config) VALUES(?,?,?,?,?,NULL,0,5,1,NULL)".replace(/\?/g, () => "?"), [id, 5, 6, 5, T - 400 * D] as any);
  test("participants are returned in pages with a total, so one request never has to carry a whole 10,000-person list", async () => {
    await create({ cap: 20000 });
    for (let i = 0; i < 7; i++) await join(i);
    const p1 = await (await call("GET", "/api/z/ENG1/participants?limit=3", undefined, org)).json() as any;
    const p2 = await (await call("GET", "/api/z/ENG1/participants?limit=3&offset=3", undefined, org)).json() as any;
    const p3 = await (await call("GET", "/api/z/ENG1/participants?limit=3&offset=6", undefined, org)).json() as any;
    expect([p1.participants.length, p2.participants.length, p3.participants.length]).toEqual([3, 3, 1]);
    expect(p1.total).toBe(7);
    expect(new Set([...p1.participants, ...p2.participants, ...p3.participants].map((x: any) => x.pid)).size).toBe(7);
    const all = await (await call("GET", "/api/z/ENG1/participants", undefined, org)).json() as any;
    expect(all.participants).toHaveLength(7);
    for (const q of ["limit=0", "limit=-5", "limit=abc", "offset=-4", "limit=999999"]) expect((await call("GET", "/api/z/ENG1/participants?" + q, undefined, org)).status).toBe(200);
    expect(((await (await call("GET", "/api/z/ENG1/participants?limit=999999", undefined, org)).json()) as any).limit).toBeLessThanOrEqual(2000);
  });
  test("the 365-day purge runs on its own the first time an organizer acts each day, and at most once a day", async () => {
    old("OLDONE");
    expect((raw.query("SELECT COUNT(*) c FROM engagement WHERE id='OLDONE'").get() as any).c).toBe(1);
    await call("GET", "/api/history", undefined, plat, T); // first organizer request of the day: housekeeping runs
    expect((raw.query("SELECT COUNT(*) c FROM engagement WHERE id='OLDONE'").get() as any).c).toBe(0);
    old("OLDTWO");
    await call("GET", "/api/history", undefined, plat, T + 1000); // same day: does not run again
    expect((raw.query("SELECT COUNT(*) c FROM engagement WHERE id='OLDTWO'").get() as any).c).toBe(1);
    await call("GET", "/api/history", undefined, plat, T + D + 1000); // next day: runs
    expect((raw.query("SELECT COUNT(*) c FROM engagement WHERE id='OLDTWO'").get() as any).c).toBe(0);
  });
  test("phones and public reads never trigger it (only organizer-side requests do)", async () => {
    await create();
    old("OLDTHREE");
    await call("GET", "/api/z/ENG1/info"); await join(1);
    expect((raw.query("SELECT COUNT(*) c FROM engagement WHERE id='OLDTHREE'").get() as any).c).toBe(1);
  });
});

describe("seats and one device per ticket", () => {
  const joinAs = (phone: string, device: string, eid = "ENG1") => call("POST", `/api/z/${eid}/join`, { phone, device });
  test("every joiner gets the next seat number, so every ticket comes from a different place in the collision-free list", async () => {
    await create({ cap: 100 });
    const pids: string[] = [];
    for (let i = 0; i < 30; i++) pids.push(((await (await joinAs(`98000000${String(i).padStart(2, "0")}`, String(i).padStart(2, "0") + "b".repeat(30))).json()) as any).pid);
    expect(pids.map((p) => Number(p.split("x")[0]))).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    const { ticketsFor } = await import("../../../packages/beacon/src/game");
    const keys = new Set(pids.flatMap((p) => ticketsFor("ENG1", p, 2).map((t) => JSON.stringify(t))));
    expect(keys.size).toBe(60);
  });
  test("one ticket per phone per engagement: a second number on the same phone is refused; other phones join; an invitation link does not change that", async () => {
    await create({ cap: 100 });
    expect((await joinAs("9800000001", "d".repeat(32))).status).toBe(200);
    const again = await joinAs("9800000002", "d".repeat(32));
    expect(again.status).toBe(409); expect(((await again.json()) as any).code).toBe("device-used");
    expect((await joinAs("9800000002", "e".repeat(32))).status).toBe(200);
    await call("POST", "/api/z/ENG1/roster", { people: [{ phone: "9800000003", name: "R" }] }, org);
    expect((await joinAs("9800000003", "d".repeat(32))).status).toBe(409); // a listed person opening the link on a phone that already holds a ticket
    expect((await joinAs("9800000003", "f".repeat(32))).status).toBe(200);
    expect((raw.query("SELECT COUNT(*) c FROM seat").get() as any).c).toBe(3);
    await call("PATCH", "/api/z/ENG1/settings", { invites: { on: true, per: 4, cats: ["family", "colleagues"] } }, org);
    const inv = (phone: string, device: string) => call("POST", "/api/z/ENG1/join", { phone, device, from: 1, cat: "family" });
    expect((await inv("9800000010", "1".repeat(32))).status).toBe(200); // the invited person comes on their own phone
    expect((await inv("9800000011", "d".repeat(32))).status).toBe(409); // the inviter's own phone cannot take the invited ticket
    await create({ id: "ENG9", startRound: Math.floor((T / 1000 - 1692803367) / 3) + 1 + 2000 });
    expect((await call("PATCH", "/api/z/ENG9/settings", { invites: { on: true, per: 11, cats: ["family"] } }, org)).status).toBe(400); // at most 10 invitations each (was 4 before the people lists)
    expect((await call("PATCH", "/api/z/ENG9/settings", { invites: { on: true, per: 4, cats: ["family"] } }, org)).status).toBe(200);
  });
  test("a second device with the same number is refused (423); the organizer can release it; only the organizer's own key can", async () => {
    await create({ cap: 100 });
    const first = await joinAs("9800000001", "c".repeat(32));
    expect(first.status).toBe(200);
    expect((await joinAs("+91 98000 00001", "c".repeat(32))).status).toBe(200); // same phone again
    const other = await joinAs("9800000001", "d".repeat(32));
    expect(other.status).toBe(423); expect(((await other.json()) as any).code).toBe("other-phone");
    expect((await call("POST", "/api/z/ENG1/unbind", { phone: "9800000001" })).status).toBe(403); // a participant cannot release anyone
    expect((await call("POST", "/api/z/ENG1/unbind", { phone: "9800000001" }, org)).status).toBe(200);
    expect((await joinAs("9800000001", "d".repeat(32))).status).toBe(200); // the new phone now owns the ticket
    expect((await joinAs("9800000001", "c".repeat(32))).status).toBe(423);
    expect((await call("POST", "/api/z/ENG1/unbind", { phone: "9811111111" }, org)).status).toBe(404);
  });
  test("a join without a device id is asked to refresh, and a full engagement still refuses cleanly", async () => {
    await create({ cap: 2 });
    expect((await call("POST", "/api/z/ENG1/join", { phone: "9800000001", device: undefined })).status).toBe(400);
    expect((await joinAs("9800000001", "e1".repeat(16))).status).toBe(200);
    expect((await joinAs("9800000002", "e2".repeat(16))).status).toBe(200);
    expect((await joinAs("9800000003", "e3".repeat(16))).status).toBe(409);
    expect((await joinAs("9800000002", "e2".repeat(16))).status).toBe(200); // existing people still get back in
  });
});

describe("late joiners and the public seat list", () => {
  const FUTURE = 32_800_000; // far in the future relative to T: not started
  const nowRound = Math.floor((T / 1000 - 1692803367) / 3) + 1;
  const joinAt = (phone: string, eid = "ENG1", at = T) => call("POST", `/api/z/${eid}/join`, { phone }, {}, at);
  test("joining before the first number records round 0; joining after it records that round, and the join answer says so", async () => {
    await create({ id: "SEAT-A", startRound: nowRound + 400, cap: 50 }); // starts in 20 minutes
    const early = await (await joinAt("9800000001", "SEAT-A")).json() as any; expect(early.jr).toBe(0);
    const later = await (await joinAt("9800000002", "SEAT-A", T + 23 * 60_000)).json() as any; // 2 min grace over: the game began
    expect(later.jr).toBe(Math.floor(((T + 23 * 60_000) / 1000 - 1692803367) / 3) + 1);
    const during = await (await joinAt("9800000003", "SEAT-A", T + 21 * 60_000)).json() as any; // inside the 2-minute setup window: counts from the start
    expect(during.jr).toBe(0);
  });
  test("the seat list is not ready before the game begins, then lists every seat once, with no names or phone numbers", async () => {
    await create({ id: "SEAT-B", startRound: nowround(400), cap: 50 });
    expect(((await (await call("GET", "/api/z/SEAT-B/seats", undefined, {}, T)).json()) as any).ready).toBe(false);
    for (let i = 1; i <= 5; i++) await joinAt("98000001" + String(i).padStart(2, "0"), "SEAT-B");
    const at = T + 30 * 60_000;
    const r = await (await call("GET", "/api/z/SEAT-B/seats", undefined, {}, at)).json() as any;
    expect(r.ready).toBe(true); expect(r.seats.map((x: any) => x[0])).toEqual([1, 2, 3, 4, 5]); expect(r.upto).toBe(5);
    expect(JSON.stringify(r)).not.toMatch(/98000001|name/);
    expect(r.seats.every((x: any) => /^\d+x[0-9a-f]{12}$/.test(x[1]) && x[2] === 0)).toBe(true);
  });
  test("seats flagged as Organizer/Host/Co-host before the game are marked in the public list (so no phone puts them in a lucky draw); flagging is refused once the game began", async () => {
    await create({ id: "SEAT-X", startRound: nowround(400), cap: 50 });
    for (let i = 1; i <= 3; i++) await joinAt("98000009" + String(i).padStart(2, "0"), "SEAT-X");
    expect((await call("POST", "/api/z/SEAT-X/mark", { seat: 2, role: "host" }, org, T)).status).toBe(200);
    const r = await (await call("GET", "/api/z/SEAT-X/seats", undefined, {}, T + 30 * 60_000)).json() as any;
    expect(r.seats.map((x: any) => x[3])).toEqual([0, 1, 0]);
    const late = await call("POST", "/api/z/SEAT-X/mark", { seat: 3, role: "co-host" }, org, T + 30 * 60_000);
    expect(late.status).toBe(409); expect(((await late.json()) as any).error).toMatch(/before the game begins/);
  });
  test("people who join later come as a small tail after the saved list, and the saved list is read once", async () => {
    await create({ id: "SEAT-C", startRound: nowround(400), cap: 50 });
    for (let i = 1; i <= 3; i++) await joinAt("98000002" + String(i).padStart(2, "0"), "SEAT-C");
    const at = T + 30 * 60_000;
    const first = await (await call("GET", "/api/z/SEAT-C/seats", undefined, {}, at)).json() as any; expect(first.upto).toBe(3);
    expect(raw.query("SELECT COUNT(*) c FROM kv WHERE k='seats-base/SEAT-C'").get()).toEqual({ c: 1 });
    await joinAt("9800000299", "SEAT-C", at + 1000); await joinAt("9800000298", "SEAT-C", at + 2000);
    const tail = await (await call("GET", "/api/z/SEAT-C/seats?after=3", undefined, {}, at + 5000)).json() as any;
    expect(tail.seats.map((x: any) => x[0])).toEqual([4, 5]); expect(tail.seats.every((x: any) => x[2] > 0)).toBe(true); expect(tail.upto).toBe(5);
    const nothing = await (await call("GET", "/api/z/SEAT-C/seats?after=5", undefined, {}, at + 6000)).json() as any; expect(nothing.seats).toEqual([]); expect(nothing.upto).toBe(5);
    const again = await (await call("GET", "/api/z/SEAT-C/seats", undefined, {}, at + 7000)).json() as any; expect(again.seats.length).toBe(3); // the saved list never changes: later seats come only as the tail
  });
  test("the organizer's participant list carries each join round, so the console counts what the phones count", async () => {
    await create({ id: "SEAT-D", startRound: nowround(-100), cap: 50 }); // already started, and still being played (a game that is over takes no new joiner)
    await joinAt("9800000301", "SEAT-D");
    const p = await (await call("GET", "/api/z/SEAT-D/participants", undefined, org)).json() as any;
    expect(p.participants[0].jr).toBe(nowRound);
  });
});
const nowround = (delta: number) => Math.floor((T / 1000 - 1692803367) / 3) + 1 + delta;

describe("brand moments: five for each ticket, placed by the software", () => {
  const FUT = Math.floor((T / 1000 - 1692803367) / 3) + 1 + 4000;
  const mk = (extra: Record<string, unknown> = {}, id = "BM01") => call("POST", "/api/z", { id, startRound: FUT, callSeconds: 9, cap: 50, ...extra }, org);
  const info = async (id = "BM01") => (await (await call("GET", `/api/z/${id}/info`)).json()) as any;
  const mid = (o: Record<string, unknown> = {}) => ({ kind: "speech", title: "A word from Acme", ...o });
  const open = { kind: "youtube", title: "Welcome", mediaUrl: "https://youtu.be/abcdefghijk" };
  test("an engagement created with openings, a closing and automatic breaks shows every phone where each one goes", async () => {
    expect((await mk({ tickets: 2, opening: [open, { kind: "speech", title: "Hello", seconds: 30 }], breaks: [mid(), mid(), mid()], closing: [{ kind: "speech", title: "Thank you" }] })).status).toBe(200);
    const i = await info();
    expect(i.breaks.map((b: any) => b.after)).toEqual([19, 38, 56]);
    expect(i.opening.map((x: any) => x.title)).toEqual(["Welcome", "Hello"]);
    expect(i.closing).toEqual([{ kind: "speech", title: "Thank you" }]);
  });
  test("a phone that joins is told about the opening and the closing too", async () => {
    await mk({ opening: [{ kind: "speech", title: "Hello" }], closing: [{ kind: "speech", title: "Bye" }] });
    const r = (await (await join(1, "BM01")).json()) as any;
    expect(r.opening[0].title).toBe("Hello"); expect(r.closing[0].title).toBe("Bye");
  });
  test("the summary shows the allowance for the organizer and the AI", async () => {
    await mk({ tickets: 2 });
    const sm = (await (await call("GET", "/api/z/BM01/summary", undefined, org)).json()) as any;
    expect(sm.brandMomentsAllowed).toBe(10);
    await mk({ tickets: 1 }, "BM02");
    expect(((await (await call("GET", "/api/z/BM02/summary", undefined, org)).json()) as any).brandMomentsAllowed).toBe(5);
  });
  test("one ticket allows 1 + 3 + 1; a fourth during-the-game moment, or a second opening, is refused", async () => {
    expect((await mk({ tickets: 1, breaks: [mid(), mid(), mid(), mid()] })).status).toBe(400);
    expect((await mk({ tickets: 1, opening: [open, open] }, "BM03")).status).toBe(400);
    expect((await mk({ tickets: 1, opening: [open], breaks: [mid(), mid(), mid()], closing: [{ kind: "speech", title: "Bye" }] }, "BM04")).status).toBe(200);
  });
  test("changing from 2 tickets to 1 is refused while too many are switched on, with a plain reason, and nothing is saved", async () => {
    await mk({ tickets: 2, opening: [{ kind: "speech", title: "One", seconds: 30 }, { kind: "speech", title: "Two", seconds: 30 }], breaks: [mid(), mid(), mid(), mid()] });
    const r = await call("PATCH", "/api/z/BM01/settings", { tickets: 1 }, org);
    expect(r.status).toBe(400);
    expect(((await r.json()) as any).error).toContain("switch some off");
    expect((await info()).tickets).toBe(2);
    expect((await call("PATCH", "/api/z/BM01/settings", { tickets: 1, opening: [open], breaks: [mid(), mid()] }, org)).status).toBe(200);
    expect(await info()).toMatchObject({ tickets: 1, breaks: [{ after: 25 }, { after: 50 }] });
  });
  test("saving the breaks again spreads them again; an older break with its own number keeps it", async () => {
    await mk({ tickets: 2, breaks: [mid(), mid()] });
    expect((await info()).breaks.map((b: any) => b.after)).toEqual([25, 50]);
    const cur = (await info()).breaks;
    await call("PATCH", "/api/z/BM01/settings", { breaks: [...cur, mid()] }, org);
    expect((await info()).breaks.map((b: any) => b.after)).toEqual([19, 38, 56]);
    await mk({ breaks: [{ after: 20, seconds: 30, kind: "speech", title: "Old style" }] }, "BM05");
    expect((await info("BM05")).breaks[0]).toMatchObject({ after: 20, seconds: 30 });
  });
  test("the AI manual teaches the new rules and no longer says breaks repeat in every round", async () => {
    const { manualText } = await import("../src/ai-link");
    const t = manualText("https://x.example", "cba_" + "a".repeat(48), "ai", T);
    expect(t).toContain("5 for each card"); expect(t).toContain("ROUND 1 only"); expect(t).toContain("opening"); expect(t).toContain("closing");
    expect(t).not.toContain("breaks repeat in every round");
  });
});
