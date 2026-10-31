import { beforeEach, describe, expect, test } from "bun:test";
import { bytesToHex } from "@noble/hashes/utils";
import { sha256 } from "@noble/hashes/sha256";
import { type Env } from "../../../apps/edge/src/worker";
import { handle } from "../../../apps/edge/test/with-terms";
import { makeD1 } from "../../../apps/edge/test/d1-sqlite";
import { PhoneRuntime, type PhoneDeps } from "../src/phone-runtime";
import { ALL_PATTERNS, callRoundR, checkClaims, completionIndex, luckyRound, luckyWinners, scheduleFull, settleAll, ticketFor } from "../src/game";
import { GRACE_ROUNDS, defaultRewards, keysInPlay, linesFor, roundEid } from "../src/config";
import { deriveCalls, roundAt, roundTimeMs, type Fetcher, type Round } from "../src";
import { nextMessage, publicKeyFromSecret, readPublished, resolveControl, scheduleWithControl, signControlWithSecret, cfgOf, type KV } from "../src/control";

const SECRET = "org";
const KEY = "11".repeat(32);
const EID = "ENG-PHONE-1";
const START = 50_000;
const CALL_SECONDS = 6;
const rnd = (r: number) => bytesToHex(sha256(new TextEncoder().encode("fake" + r)));

let env: Env; let t = 0; let T0 = 0;
const D = {
  utc: () => T0 + t,
  headCall: (method: string, path: string, body?: unknown, h: Record<string, string> = {}) =>
    handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", ...h }, body: body === undefined ? undefined : JSON.stringify(body) }), env, T0 + t),
};
const api = (down: () => boolean = () => false): PhoneDeps["api"] => async (method, path, body) => {
  if (down()) throw new Error("offline");
  const r = await D.headCall(method, path, body);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error ?? "http " + r.status), { status: r.status });
  return j;
};
const beaconFetcher = (opt: { blocked?: () => boolean } = {}): Fetcher => async (url) => {
  if (opt.blocked?.()) throw new Error("blocked");
  const last = url.split("/").pop()!;
  const nowR = roundAt(D.utc());
  const r = last === "latest" ? nowR : Number(last);
  if (r > nowR) return { ok: false, status: 404, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => ({ round: r, randomness: rnd(r), signature: "aa" } as Round) };
};
const ALLPHONES: { rt: PhoneRuntime; mem: Map<string, string> }[] = []; // every phone made, so a test can send a phone's vote with that phone's own device id
const mkPhone = (n: number, o: { earlyEnd?: boolean; down?: () => boolean; blocked?: () => boolean; locked?: () => boolean; eid?: string; onApi?: (path: string) => void } = {}) => {
  const mem = new Map<string, string>();
  const rt = new PhoneRuntime(o.eid ?? EID, {
    noEarlyEnd: !o.earlyEnd,
    api: ((base) => (async (method: string, path: string, body?: unknown) => (o.onApi?.(path), o.locked?.() && /\/control$/.test(path) ? { locked: true } : base(method, path, body))) as PhoneDeps["api"])(api(o.down)), mono: () => t, store: { get: (k) => mem.get(k) ?? null, set: (k, v) => void mem.set(k, v) },
    beacon: { fetcher: beaconFetcher({ blocked: o.blocked }), mirrors: ["https://a.test", "https://b.test", "https://c.test"], timeoutMs: 500 },
    verify: (x) => x.signature === "aa" && x.randomness === rnd(x.round),
  });
  const made = { rt, mem, phone: "9" + String(100000000 + n) }; ALLPHONES.push(made); return made;
};
const step = async (phones: ReturnType<typeof mkPhone>[], ms = 3000) => { t += ms; for (const p of phones) await p.rt.tick(); };
const kvOf = (): KV => ({ get: async (k) => (await env.DB.prepare("SELECT v FROM kv WHERE k=?").bind(k).first<{ v: string }>())?.v ?? null, put: async () => {} });

beforeEach(async () => {
  const d = makeD1();
  env = { DB: d.db, ORGANIZER_SECRET: SECRET, DAILY_WRITE_BUDGET: "1000000" };
  T0 = roundTimeMs(START - 3); t = 0;
  await D.headCall("POST", "/api/z", { id: EID, startRound: START - GRACE_ROUNDS, callSeconds: CALL_SECONDS, cap: 200 }, { "x-organizer": SECRET });
});
const registerKey = async () => (await D.headCall("PUT", `/api/z/${EID}/control/key`, { publicKey: publicKeyFromSecret(KEY) }, { "x-organizer": SECRET })).status;
const publish = async (a: Parameters<typeof nextMessage>[2]) => {
  const f = (await readPublished(kvOf(), EID))!;
  const msg = signControlWithSecret(KEY, nextMessage(f, roundAt(D.utc()), a));
  const r = await D.headCall("POST", `/api/z/${EID}/control`, { message: msg });
  return { status: r.status, body: await r.json() };
};
const reference = (pauseState?: ReturnType<typeof resolveControl>) => {
  const sched = pauseState ? scheduleWithControl(pauseState, START, 2, 75) : Array.from({ length: 75 }, (_, k) => START + k * 2);
  return deriveCalls(EID, sched.map((r) => rnd(r!)));
};

/** Several different phones report the same winners, which is how a result gets accepted (nobody, not even the organizer, can post one). */
async function settleViaPhones(results: { pattern: string; ordinal?: number; round?: number; idx: number; pids: string[] }[], voters: string[]): Promise<number> {
  let last = 200;
  for (const pid of voters.slice(0, 30)) for (let i = 0; i < results.length; i += 3) last = (await D.headCall("POST", `/api/z/${EID}/vote`, { pid, device: ALLPHONES.find((p) => p.rt.pid === pid)?.mem.get("cbz:device"), results: results.slice(i, i + 3).map((x) => ({ ordinal: 1, round: 1, ...x })) })).status;
  return last;
}
describe("a phone from first open to full house", () => {
  test("open, join, wait for the first call, play all 75 calls, claim every pattern, and match the public reference", async () => {
    const a = mkPhone(1);
    await a.rt.boot();
    expect(a.rt.phase).toBe("join");
    expect(await a.rt.join(a.phone, "Asha")).toBe(true);
    expect(a.rt.phase).toBe("play");
    let v = await a.rt.tick();
    expect(v.log).toEqual([]); // first call is still in the future
    expect(v.nextCallInSec).not.toBeNull();
    for (let i = 0; i < 200; i++) await step([a]);
    v = await a.rt.tick();
    expect(v.log.length).toBe(75);
    expect(v.log).toEqual(reference());
    expect(v.phase).toBe("ended");
    expect(new Set(v.claimed)).toEqual(new Set(ALL_PATTERNS));
    expect(v.unsent).toBe(0);
  });
  test("calls are revealed one at a time as their rounds are published, never early", async () => {
    const a = mkPhone(2); await a.rt.boot(); await a.rt.join(a.phone);
    let last = 0;
    for (let i = 0; i < 40; i++) {
      const v = await (async () => { await step([a], 3000); return a.rt.view(); })();
      const expectedMax = Math.max(0, Math.floor((roundAt(D.utc()) - START) / 2) + 1);
      expect(v.log.length).toBeLessThanOrEqual(expectedMax);
      expect(v.log.length).toBeGreaterThanOrEqual(last);
      last = v.log.length;
    }
  });
  test("one ticket, one device: the same number on a second phone is refused; the organizer can let it move; a reload on the same phone keeps the ticket", async () => {
    const a = mkPhone(3); await a.rt.boot(); await a.rt.join(a.phone);
    expect(a.rt.pid).toMatch(/^\d+x[0-9a-f]{12}$/);
    const b = mkPhone(3); await b.rt.boot();
    expect(await b.rt.join("+91 " + a.phone.slice(0, 5) + " " + a.phone.slice(5))).toBe(false); // different device, same number, even typed another way
    expect(b.rt.error).toMatch(/another phone/i); expect(b.rt.pid).toBeNull();
    const c = new PhoneRuntime(EID, { ...a.rt.deps }); // the same phone reloads: remembered, same ticket
    await c.boot();
    expect(c.phase).toBe("play"); expect(c.pid).toBe(a.rt.pid); expect(c.ticket).toEqual(a.rt.ticket);
    expect(await c.join(a.phone)).toBe(true); // the same device asking again is simply let back in
    const un = await D.headCall("POST", `/api/z/${EID}/unbind`, { phone: a.phone }, { "x-organizer": SECRET });
    expect(un.status).toBe(200);
    expect(await b.rt.join(a.phone)).toBe(true); // the organizer let this person move: the new phone keeps the ticket
    expect(b.rt.pid).toBe(a.rt.pid); expect(b.rt.ticket).toEqual(a.rt.ticket);
    const back = mkPhone(3); await back.rt.boot();
    expect(await back.rt.join(a.phone)).toBe(false); // and now the old/any other phone is locked out again
  });
  test("a bad link says so and does nothing else", async () => {
    const x = new PhoneRuntime("NO-SUCH-ENG", mkPhone(4).rt.deps);
    await x.boot();
    expect(x.phase).toBe("missing");
  });
  test("a mobile number that is too short is refused with a human message, and the phone can retry", async () => {
    const a = mkPhone(5); await a.rt.boot();
    expect(await a.rt.join("123")).toBe(false);
    expect(a.rt.error).toMatch(/valid mobile/);
    expect(a.rt.phase).toBe("join");
    expect(await a.rt.join(a.phone)).toBe(true);
  });
});

describe("a crowd and the awkward cases", () => {
  test("40 phones, some late, some offline for a while, one behind a blocked network for a while: everyone ends with the identical log and the claims match the organizer's settlement", async () => {
    let off = false, blocked = false;
    const ps = Array.from({ length: 40 }, (_, i) => mkPhone(i + 10, i === 5 ? { down: () => off } : i === 6 ? { blocked: () => blocked } : {}));
    for (const p of ps) { await p.rt.boot(); await p.rt.join(p.phone); } // everyone joined in time; ten of them only open their phones mid-game
    for (let i = 0; i < 200; i++) {
      if (i === 20) off = true; if (i === 35) off = false;
      if (i === 40) blocked = true; if (i === 55) blocked = false;
      await step(i < 45 ? ps.slice(0, 30) : ps); // the last ten open their phones at step 45
    }
    for (let i = 0; i < 6; i++) await step(ps);
    const ref = reference();
    for (const p of ps) expect(p.rt.view().log).toEqual(ref);
    // organizer: everything it needs, from the public log + our store, and only from those
    const pids = (await (await D.headCall("GET", `/api/z/${EID}/participants`, undefined, { "x-organizer": SECRET })).json() as any).participants.map((x: any) => x.pid);
    expect(pids.length).toBe(40);
    const claims = (await (await D.headCall("GET", `/api/z/${EID}/claims`, undefined, { "x-organizer": SECRET })).json() as any).claims;
    const chk = checkClaims(EID, claims.map((c: any) => ({ pid: c.pid, pattern: c.pattern, idx: c.idx })), ref);
    expect(chk.bad).toEqual([]);
    expect(chk.good.length).toBe(40 * 4);
    const settled = settleAll(EID, pids, ref);
    expect(await settleViaPhones(settled, pids)).toBe(200);
    const pub = await (await D.headCall("GET", `/api/z/${EID}/results`)).json() as any;
    expect(pub.results.length).toBe(4);
    // every phone's own results view agrees
    for (const p of ps) { await step([p], 16000); expect(p.rt.view().results.length).toBe(4); }
  });
  test("a phone whose network drops while a claim is sent keeps it and sends it again later, exactly once", async () => {
    let off = false;
    const a = mkPhone(60, { down: () => off }); await a.rt.boot(); await a.rt.join(a.phone);
    const b = mkPhone(61); await b.rt.boot(); await b.rt.join(b.phone);
    for (let i = 0; i < 120; i++) { if (i === 10) off = true; await step([a]); }
    expect(a.rt.view().unsent).toBeGreaterThan(0); // completed something while its own link to our store was down
    off = false;
    for (let i = 0; i < 200; i++) await step([a]);
    expect(a.rt.view().unsent).toBe(0);
    const n = (await (await D.headCall("GET", `/api/z/${EID}/claims`, undefined, { "x-organizer": SECRET })).json() as any).claims.filter((c: any) => c.pid === a.rt.pid).length;
    expect(n).toBe(4);
  });
  test("a phone cannot claim something it has not completed: the organizer's check rejects it", async () => {
    const a = mkPhone(70); await a.rt.boot(); await a.rt.join(a.phone);
    await api()("POST", `/api/z/${EID}/claims`, { pid: a.rt.pid, claims: [{ pattern: "blackout", idx: 12 }] });
    const claims = (await (await D.headCall("GET", `/api/z/${EID}/claims`, undefined, { "x-organizer": SECRET })).json() as any).claims;
    expect(checkClaims(EID, claims, reference()).bad.length).toBe(1);
    // and settlement never uses it
    expect(settleAll(EID, [a.rt.pid!], reference()).find((s) => s.pattern === "blackout")!.idx).toBe(completionIndex(ticketFor(EID, a.rt.pid!), "blackout", reference()));
  });
  test("the beacon unreachable for a stretch: nothing is invented, and the phone catches up exactly afterwards", async () => {
    let blocked = false;
    const a = mkPhone(80, { blocked: () => blocked }); await a.rt.boot(); await a.rt.join(a.phone);
    for (let i = 0; i < 20; i++) await step([a]);
    const before = a.rt.view().log.slice();
    blocked = true;
    for (let i = 0; i < 30; i++) await step([a]);
    expect(a.rt.view().log).toEqual(before); // frozen, not guessed
    blocked = false;
    for (let i = 0; i < 200; i++) await step([a]);
    expect(a.rt.view().log).toEqual(reference());
  });
  test("a lying mirror that returns forged randomness is never believed", async () => {
    const liar: Fetcher = async (url) => {
      const last = url.split("/").pop()!;
      const r = last === "latest" ? roundAt(D.utc()) : Number(last);
      return { ok: true, status: 200, json: async () => ({ round: r, randomness: rnd(r + 1), signature: "aa" }) };
    };
    const a = mkPhone(90);
    (a.rt.deps as any).beacon = { fetcher: liar, mirrors: ["https://a.test"], timeoutMs: 300 };
    (a.rt.store as any).opts = (a.rt.deps as any).beacon;
    await a.rt.boot(); await a.rt.join(a.phone);
    for (let i = 0; i < 40; i++) await step([a]);
    expect(a.rt.view().log).toEqual([]);
  });
});

describe("pause, resume and stop", () => {
  test("a signed pause: nobody sees a number during it, everyone resumes together, and all logs equal the paused reference", async () => {
    expect(await registerKey()).toBe(200);
    const ps = Array.from({ length: 12 }, (_, i) => mkPhone(100 + i));
    for (const p of ps) { await p.rt.boot(); await p.rt.join(p.phone); }
    for (let i = 0; i < 30; i++) await step(ps);
    const r = await publish({ action: "pause", pauseForRounds: 20 });
    expect(r.status).toBe(200);
    const f = (await readPublished(kvOf(), EID))!;
    const st = resolveControl(cfgOf(f), f.messages);
    const iv = st.intervals[0]!;
    const lenAtStart = ps[0]!.rt.view().log.length;
    let during = new Set<number>();
    for (let i = 0; i < 200; i++) {
      await step(ps);
      const now = roundAt(D.utc());
      if (now >= iv.start && now < iv.end) during.add(ps[0]!.rt.view().log.length);
      if (now >= iv.start && now < iv.end) for (const p of ps) { expect(p.rt.view().paused).toBe(true); expect(p.rt.view().pausedFromRound).toBe(iv.start); } // B08: the page can say at what time the pause began
      if (now >= iv.end) expect(ps[0]!.rt.view().pausedFromRound).toBeNull();
    }
    const dl = [...during];
    expect(Math.max(...dl) - Math.min(...dl)).toBe(0); // no number appeared during the pause
    const ref = reference(st);
    for (const p of ps) expect(p.rt.view().log).toEqual(ref);
    expect(lenAtStart).toBeLessThan(75);
  });
  test("nobody can pause but the organizer: an unsigned or wrongly signed message is refused", async () => {
    await registerKey();
    const f = (await readPublished(kvOf(), EID))!;
    const m = signControlWithSecret("22".repeat(32), nextMessage(f, roundAt(D.utc()), { action: "pause", pauseForRounds: 10 }));
    expect((await D.headCall("POST", `/api/z/${EID}/control`, { message: m })).status).toBe(403);
    expect((await D.headCall("POST", `/api/z/${EID}/control`, { message: { ...m, sig: "00" } })).status).toBeGreaterThanOrEqual(400);
    expect((await D.headCall("PUT", `/api/z/${EID}/control/key`, { publicKey: publicKeyFromSecret("33".repeat(32)) })).status).toBe(403); // not the organizer
    expect((await D.headCall("PUT", `/api/z/${EID}/control/key`, { publicKey: publicKeyFromSecret("33".repeat(32)) }, { "x-organizer": SECRET })).status).toBe(409); // key cannot be swapped
  });
  test("when the control file cannot be reached the phone holds (shows 'checking') instead of revealing, then recovers", async () => {
    await registerKey();
    let down = false;
    const a = mkPhone(130, { down: () => false });
    const c = mkPhone(131);
    let controlDown = false;
    const realApi = a.rt.deps.api;
    (a.rt.deps as any).api = async (m: string, p: string, b?: unknown) => { if (controlDown && p.endsWith("/control")) throw new Error("outage"); return realApi(m, p, b); };
    await a.rt.boot(); await a.rt.join(a.phone); await c.rt.boot(); await c.rt.join(c.phone);
    for (let i = 0; i < 25; i++) await step([a, c]);
    expect(a.rt.view().mode).toBe("live");
    controlDown = true; down = true;
    let held = false;
    for (let i = 0; i < 12; i++) { await step([a, c]); if (a.rt.view().mode === "hold") held = true; }
    expect(held).toBe(true);
    const frozen = a.rt.view().log.length;
    expect(c.rt.view().log.length).toBeGreaterThanOrEqual(frozen);
    controlDown = false;
    for (let i = 0; i < 12; i++) await step([a, c]);
    expect(a.rt.view().mode).toBe("live");
    for (let i = 0; i < 200; i++) await step([a, c]);
    expect(a.rt.view().log).toEqual(reference());
  });
  test("stop ends the engagement for everyone at the same call", async () => {
    await registerKey();
    const ps = [mkPhone(140), mkPhone(141)];
    for (const p of ps) { await p.rt.boot(); await p.rt.join(p.phone); }
    for (let i = 0; i < 20; i++) await step(ps);
    expect((await publish({ action: "stop" })).status).toBe(200);
    for (let i = 0; i < 200; i++) await step(ps);
    const [x, y] = ps.map((p) => p.rt.view());
    expect(x!.phase).toBe("ended"); expect(y!.phase).toBe("ended");
    expect(x!.log).toEqual(y!.log);
    expect(x!.log.length).toBeLessThan(75);
  });
  test("an engagement with no key registered simply cannot be paused and plays on", async () => {
    const a = mkPhone(150); await a.rt.boot(); await a.rt.join(a.phone);
    for (let i = 0; i < 200; i++) await step([a]);
    expect(a.rt.view().mode).toBe("none");
    expect(a.rt.view().log).toEqual(reference());
  });
});

describe("an engagement that was not paid for by its start", () => {
  test("the phone holds and shows nothing while it is locked, says so, and carries on once it is unlocked", async () => {
    let locked = true;
    const a = mkPhone(7, { locked: () => locked });
    await a.rt.boot(); await a.rt.join(a.phone, "Asha");
    for (let i = 0; i < 30; i++) await step([a]); // well past the first call
    let v = a.rt.view();
    expect(v.locked).toBe(true); expect(v.mode).toBe("hold"); expect(v.log).toEqual([]); // not one number is revealed
    locked = false;
    for (let i = 0; i < 12; i++) await step([a]);
    v = a.rt.view();
    expect(v.locked).toBe(false); expect(v.log.length).toBeGreaterThan(0);
  });
});

describe("the free plan: how often phones ask about a pause", () => {
  const controlCalls = (log: string[]) => log.filter((p) => /\/control$/.test(p)).length;
  test("an engagement nobody can pause is hardly asked about, and not at all once it has started", async () => {
    const log: string[] = []; const a = mkPhone(11, { onApi: (p) => log.push(p) });
    await a.rt.boot(); await a.rt.join(a.phone, "A");
    for (let i = 0; i < 400; i++) await step([a]); // twenty minutes
    expect(controlCalls(log)).toBeLessThanOrEqual(3);
    expect(a.rt.view().log.length).toBeGreaterThan(20); // and it played normally
  });
  test("a mid-size engagement asks about every 30 seconds, a standard one every 9 to 12", async () => {
    await D.headCall("POST", "/api/z", { id: "ENG-LEAN", startRound: START - GRACE_ROUNDS, callSeconds: CALL_SECONDS, cap: 800 }, { "x-organizer": SECRET });
    await D.headCall("PUT", "/api/z/ENG-LEAN/control/key", { publicKey: publicKeyFromSecret(KEY) }, { "x-organizer": SECRET });
    const lean: string[] = [], std: string[] = [];
    const l = mkPhone(12, { eid: "ENG-LEAN", onApi: (p) => lean.push(p) });
    await registerKey(); const s = mkPhone(13, { onApi: (p) => std.push(p) });
    for (const p of [l, s]) { await p.rt.boot(); await p.rt.join(p.phone, "A"); }
    for (let i = 0; i < 200; i++) await step([l, s]); // ten minutes
    expect(controlCalls(lean)).toBeGreaterThan(8); expect(controlCalls(lean)).toBeLessThanOrEqual(26);
    expect(controlCalls(std)).toBeGreaterThan(40);
    expect(l.rt.view().log.length).toBeGreaterThan(10); // a longer interval does not stop the numbers
  });
});

describe("announcements and scratch cards on real phones", () => {
  test("a message from the organizer reaches the phone inside the pause check, a new one replaces it, and clearing removes it", async () => {
    expect(await registerKey()).toBe(200);
    const a = mkPhone(21); await a.rt.boot(); await a.rt.join(a.phone, "A");
    for (let i = 0; i < 6; i++) await step([a]);
    expect(a.rt.view().announcement).toBeNull();
    let at = 1_700_000_000_000; // the server enforces a few seconds between messages: move its clock on for each one
    const say = (text: string) => handle(new Request(`http://x/api/z/${EID}/announce`, { method: "POST", headers: { "content-type": "application/json", "x-organizer": SECRET }, body: JSON.stringify({ text }) }), env, (at += 10_000));
    expect((await say("Please take your seats")).status).toBe(200);
    for (let i = 0; i < 8; i++) await step([a]);
    const first = a.rt.view().announcement; expect(first?.text).toBe("Please take your seats");
    t += 6000; expect((await say("Rewards at the stage")).status).toBe(200);
    for (let i = 0; i < 8; i++) await step([a]);
    const second = a.rt.view().announcement; expect(second?.text).toBe("Rewards at the stage"); expect(second?.id).not.toBe(first?.id);
    expect(a.rt.view().log.length).toBeGreaterThan(0); // numbers carried on throughout
  });
});

describe("after the last call", () => {
  test("a claim that failed to send on the very last tick is still delivered afterwards", async () => {
    let off = false;
    const a = mkPhone(160, { down: () => off }); await a.rt.boot(); await a.rt.join(a.phone);
    // play to the end with our store reachable until the final stretch, then cut it, then restore
    for (let i = 0; i < 175; i++) await step([a]);
    off = true;
    for (let i = 0; i < 30; i++) await step([a]);
    expect(a.rt.view().phase).toBe("ended");
    const stuck = a.rt.view().unsent;
    off = false;
    for (let i = 0; i < 5; i++) await step([a]);
    expect(a.rt.view().unsent).toBe(0);
    expect(stuck).toBeGreaterThanOrEqual(0);
    const n = (await (await D.headCall("GET", `/api/z/${EID}/claims`, undefined, { "x-organizer": SECRET })).json() as any).claims.filter((c: any) => c.pid === a.rt.pid).length;
    expect(n).toBe(4);
  });
});

describe("a late joiner who cannot hear about a pause", () => {
  test("holds instead of guessing, never claims from a wrong log, and ends with the true log once it can ask", async () => {
    await registerKey();
    const a = mkPhone(170);
    await a.rt.boot(); await a.rt.join(a.phone);
    const b = mkPhone(171); await b.rt.boot(); await b.rt.join(b.phone); // joined in time; opens its page only after the pause, with the control file unreachable
    for (let i = 0; i < 30; i++) await step([a]);
    expect((await publish({ action: "pause", pauseForRounds: 20 })).status).toBe(200);
    for (let i = 0; i < 20; i++) await step([a]);
    // a phone joins now, with the control file unreachable for a while
    let controlDown = true;
    const realApi = b.rt.deps.api;
    (b.rt.deps as any).api = async (m: string, p: string, x?: unknown) => { if (controlDown && p.endsWith("/control")) throw new Error("outage"); return realApi(m, p, x); };
    for (let i = 0; i < 40; i++) { await step([a, b]); expect(b.rt.view().log).toEqual([]); expect(b.rt.view().mode).toBe("hold"); }
    controlDown = false;
    for (let i = 0; i < 12; i++) await step([a, b]);
    expect(b.rt.view().mode).toBe("live");
    for (let i = 0; i < 200; i++) await step([a, b]);
    const f = (await readPublished(kvOf(), EID))!;
    const ref = reference(resolveControl(cfgOf(f), f.messages));
    expect(b.rt.view().log).toEqual(ref);
    const claims = (await (await D.headCall("GET", `/api/z/${EID}/claims`, undefined, { "x-organizer": SECRET })).json() as any).claims.filter((c: any) => c.pid === b.rt.pid);
    expect(claims.length).toBe(4);
    expect(checkClaims(EID, claims, ref).bad).toEqual([]);
  });
});

describe("pause file read from a cached public copy", () => {
  test("when the engagement publishes a static file, the phone reads the pause file from it and does not ask the Worker", async () => {
    await registerKey();
    const a = mkPhone(180);
    let viaApi = 0, viaPublic = 0;
    const realApi = a.rt.deps.api;
    (a.rt.deps as any).api = async (m: string, p: string, x?: unknown) => { if (p.endsWith("/control")) viaApi++; if (p.endsWith("/info")) { const j = await realApi(m, p, x); return { ...j, controlUrl: "https://static.test/c/x.json" }; } return realApi(m, p, x); };
    (a.rt.deps as any).getPublic = async (url: string) => { viaPublic++; expect(url).toBe("https://static.test/c/x.json"); return realApi("GET", `/api/z/${EID}/control`); };
    await a.rt.boot(); await a.rt.join(a.phone);
    for (let i = 0; i < 30; i++) await step([a]);
    expect(viaPublic).toBeGreaterThan(0);
    expect(viaApi).toBe(0);
    expect(a.rt.view().mode).toBe("live");
  });
});

describe("brand breaks, reward lines and two tickets on real phones", () => {
  const setCfg = async (o: { tickets?: number; rewards?: unknown; breaks?: unknown }) =>
    env.DB.prepare("UPDATE engagement SET tickets=?, config=? WHERE id=?").bind(o.tickets ?? 1, JSON.stringify({ rewards: o.rewards, breaks: o.breaks }), EID).run();
  const breaks = [{ after: 5, seconds: 30, kind: "speech", title: "CEO message" }, { after: 40, seconds: 45, kind: "youtube", title: "Our story", mediaUrl: "https://youtu.be/abc" }];
  const refWith = (b: any[]) => deriveCalls(EID, (scheduleFull(null, START, 2, b, 75) as number[]).map((r) => rnd(r)));

  test("a brand break pauses the numbers for exactly its length, shows its card, and everyone's logs stay identical", async () => {
    await setCfg({ breaks });
    const ps = Array.from({ length: 6 }, (_, i) => mkPhone(200 + i));
    for (const p of ps) { await p.rt.boot(); await p.rt.join(p.phone); }
    let sawBreak = false; const during = new Set<number>(); let title = "";
    for (let i = 0; i < 260; i++) {
      await step(ps);
      const v = ps[0]!.rt.view();
      if (v.brk) { sawBreak = true; title = v.brk.title; if (v.brk.title === "CEO message") during.add(v.log.length); expect(v.brk.secondsLeft).toBeGreaterThanOrEqual(0); }
      if (v.brk) for (const p of ps) expect(p.rt.view().brk?.title).toBe(v.brk.title); // all phones show the same card at the same time (within a tick)
    }
    expect(sawBreak).toBe(true);
    expect(during.size).toBe(1); // the log did not grow while the break was showing
    expect([...during][0]).toBe(5);
    const ref = refWith(breaks);
    for (const p of ps) expect(p.rt.view().log).toEqual(ref);
    expect(ps[0]!.rt.view().brk).toBeNull();
    expect(title.length).toBeGreaterThan(0);
  });
  test("a phone that opens the page in the middle of a break shows the card and then the same numbers as everyone", async () => {
    await setCfg({ breaks });
    const early = mkPhone(210); await early.rt.boot(); await early.rt.join(early.phone);
    const late = mkPhone(211); await late.rt.boot(); await late.rt.join(late.phone); // joined in time, but only opens the page mid-break
    for (let i = 0; i < 18; i++) await step([early]); // call 5 is at ~round 10; the break runs ~10 rounds after it
    let sawCard = late.rt.view().brk !== null;
    await step([early, late]); sawCard = sawCard || late.rt.view().brk !== null;
    for (let i = 0; i < 250; i++) { await step([early, late]); if (late.rt.view().brk) sawCard = true; }
    expect(late.rt.view().log).toEqual(refWith(breaks));
    expect(early.rt.view().log).toEqual(late.rt.view().log);
    expect(sawCard).toBe(true);
  });
  test("a break together with a signed pause: both delay the calls and the logs still match the organizer's reference", async () => {
    await registerKey(); await setCfg({ breaks });
    const ps = [mkPhone(220), mkPhone(221)];
    for (const p of ps) { await p.rt.boot(); await p.rt.join(p.phone); }
    for (let i = 0; i < 30; i++) await step(ps);
    expect((await publish({ action: "pause", pauseForRounds: 20 })).status).toBe(200);
    for (let i = 0; i < 260; i++) await step(ps);
    const f = (await readPublished(kvOf(), EID))!; const st = resolveControl(cfgOf(f), f.messages);
    const ref = deriveCalls(EID, (scheduleFull(st, START, 2, breaks as any, 75) as number[]).map((r) => rnd(r)));
    for (const p of ps) expect(p.rt.view().log).toEqual(ref);
  });
  test("only the houses with a reward are claimed and shown; the rest are not in play", async () => {
    await setCfg({ rewards: [{ pattern: "line", scope: "ticket", ordinal: 1, text: "Voucher" }, { pattern: "blackout", scope: "ticket", ordinal: 1, text: "Hamper" }] });
    const a = mkPhone(230); await a.rt.boot(); await a.rt.join(a.phone);
    for (let i = 0; i < 200; i++) await step([a]);
    const v = a.rt.view();
    expect(new Set(v.claimed)).toEqual(new Set(["line", "blackout"]));
    expect(Object.keys(v.myIdx).sort()).toEqual(["blackout", "line"]);
    const n = (await (await D.headCall("GET", `/api/z/${EID}/claims`, undefined, { "x-organizer": SECRET })).json() as any).claims.filter((c: any) => c.pid === a.rt.pid).length;
    expect(n).toBe(2);
  });
  test("two cards: the phone holds two different cards, claims its houses, and the organizer's settlement agrees with the phone's own numbers", async () => {
    await setCfg({ tickets: 2, rewards: [{ pattern: "blackout", scope: "ticket", ordinal: 1, text: "Hamper" }, { pattern: "blackout", scope: "ticket", ordinal: 2, text: "Mug" }, { pattern: "corners", scope: "ticket", ordinal: 1, text: "Grand" }] });
    const ps = Array.from({ length: 12 }, (_, i) => mkPhone(240 + i));
    for (const p of ps) { await p.rt.boot(); await p.rt.join(p.phone); }
    for (let i = 0; i < 220; i++) await step(ps);
    const v = ps[0]!.rt.view();
    expect(v.tickets).toHaveLength(2);
    expect(JSON.stringify(v.tickets[0])).not.toBe(JSON.stringify(v.tickets[1]));
    expect(new Set(v.claimed)).toEqual(new Set(["blackout", "corners"]));
    const ref = refWith([]);
    const cfg = { tickets: 2 as const, rewards: [{ pattern: "blackout" as const, scope: "ticket" as const, ordinal: 1, text: "" }, { pattern: "blackout" as const, scope: "ticket" as const, ordinal: 2, text: "" }, { pattern: "corners" as const, scope: "ticket" as const, ordinal: 1, text: "" }], breaks: [], rounds: 1 };
    const pids = (await (await D.headCall("GET", `/api/z/${EID}/participants`, undefined, { "x-organizer": SECRET })).json() as any).participants.map((x: any) => x.pid);
    const claims = (await (await D.headCall("GET", `/api/z/${EID}/claims`, undefined, { "x-organizer": SECRET })).json() as any).claims;
    expect(checkClaims(EID, claims, ref, cfg).bad).toEqual([]);
    const settled = settleAll(EID, pids, ref, cfg);
    expect(settled.map((s) => `${s.pattern}#${s.ordinal}`).sort()).toEqual(["blackout#1", "blackout#2", "corners#1"].filter((k) => settled.some((s) => `${s.pattern}#${s.ordinal}` === k)).sort());
    expect(await settleViaPhones(settled.map((s) => ({ pattern: s.pattern, ordinal: s.ordinal, idx: s.idx, pids: s.pids })), pids)).toBe(200);
    // each phone can tell whether it received a published reward line by comparing its own completion call with the published one
    await step(ps, 16000);
    const pub = ps[0]!.rt.view().results;
    expect(pub.length).toBe(settled.length);
    for (const r of pub) { const mine = settled.find((s) => s.pattern === r.pattern && s.ordinal === r.ordinal)!; expect(r.idx).toBe(mine.idx); expect(r.count).toBe(mine.pids.length); }
  });
});

describe("lucky draw on phones", () => {
  test("every phone sees the draw; the phones work out the winners themselves from the public randomness and the seat list, and exactly the winners are told they won", async () => {
    await env.DB.prepare("UPDATE engagement SET config=? WHERE id=?").bind(JSON.stringify({ breaks: [{ after: 10, seconds: 30, kind: "lucky", title: "Lucky draw", winners: 3 }] }), EID).run();
    const ps = Array.from({ length: 8 }, (_, i) => mkPhone(300 + i));
    for (const p of ps) { await p.rt.boot(); await p.rt.join(p.phone); }
    let sawCard = false;
    for (let i = 0; i < 60; i++) { await step(ps); const b = ps[0]!.rt.view().brk; if (b) { sawCard = true; expect(b.kind).toBe("lucky"); expect(b.winners).toBe(3); } }
    expect(sawCard).toBe(true);
    // the organizer's console draws from the participant list with the public randomness of the round that ends the break
    const brk = { after: 10, seconds: 30, kind: "lucky" as const, title: "Lucky draw", winners: 3 as const };
    const round = luckyRound(null, START, 2, [brk], brk)!;
    const pids = (await (await D.headCall("GET", `/api/z/${EID}/participants`, undefined, { "x-organizer": SECRET })).json() as any).participants.map((x: any) => x.pid);
    const winners = luckyWinners(EID, 10, rnd(round), pids, 3);
    expect(winners).toHaveLength(3);
    for (let i = 0; i < 12; i++) await step(ps, 16000);
    for (const p of ps) { const v = p.rt.view(); expect(v.lucky[0]!.published).toBe(true); expect(v.lucky[0]!.won).toBe(winners.includes(p.rt.pid!)); }
    expect(ps.filter((p) => p.rt.view().lucky[0]!.won)).toHaveLength(3);
    // and the store holds the draw because several phones reported the same winners
    const stored = ((await (await D.headCall("GET", `/api/z/${EID}/results`)).json()) as any).results.find((x: any) => x.pattern === "lucky");
    expect(stored.winners).toEqual([...winners].sort());
  });
});

describe("lucky draw leaves out the people flagged as Organizer, Host or Co-host", () => {
  test("a phone flagged before the game never wins a lucky draw, and the other phones agree on the winners", async () => {
    await env.DB.prepare("UPDATE engagement SET config=? WHERE id=?").bind(JSON.stringify({ breaks: [{ after: 10, seconds: 30, kind: "lucky", title: "Lucky draw", winners: 10 }] }), EID).run();
    const ps = Array.from({ length: 6 }, (_, i) => mkPhone(400 + i));
    for (const p of ps) { await p.rt.boot(); await p.rt.join(p.phone); }
    const flagged = ps[0]!, seat = Number(/^(\d+)x/.exec(flagged.rt.pid!)![1]);
    expect((await D.headCall("POST", `/api/z/${EID}/mark`, { seat, role: "host" }, { "x-organizer": SECRET })).status).toBe(200);
    for (let i = 0; i < 80; i++) await step(ps);
    for (let i = 0; i < 12; i++) await step(ps, 16000);
    const lucky = ps.map((p) => p.rt.view().lucky[0]);
    for (const l of lucky) expect(l).toBeTruthy();
    expect(flagged.rt.view().lucky[0]!.won).toBe(false); // 10 winners asked from 6 phones: everyone else wins, the flagged one does not
    expect(ps.filter((p) => p.rt.view().lucky[0]!.won)).toHaveLength(5);
  });
});

describe("two rounds on real phones", () => {
  const refRound = (r: number, st: any = null) => deriveCalls(roundEid(EID, r), Array.from({ length: 75 }, (_, k) => rnd(callRoundR(st, START, 2, [], r, k)!)));
  const two = { rewards: undefined as unknown, rounds: 2 };
  const setRounds = () => env.DB.prepare("UPDATE engagement SET config=? WHERE id=?").bind(JSON.stringify({ rounds: 2 }), EID).run();

  test("round 1 plays out, an intermission follows, round 2 has new numbers and new tickets, and the engagement ends only after round 2", async () => {
    await setRounds();
    const ps = Array.from({ length: 6 }, (_, i) => mkPhone(400 + i));
    for (const p of ps) { await p.rt.boot(); await p.rt.join(p.phone); }
    expect(ps[0]!.rt.view().rounds).toBe(2);
    let sawInter = false, endOfRound1: any = null, secs: number[] = [];
    for (let i = 0; i < 420; i++) {
      await step(ps);
      const v = ps[0]!.rt.view();
      if (v.intermission) { sawInter = true; expect(v.intermission.round).toBe(2); expect(v.round).toBe(1); expect(v.phase).toBe("play"); secs.push(v.intermission.secondsLeft); if (!endOfRound1) endOfRound1 = { log: v.log.slice(), tickets: v.tickets }; }
    }
    expect(sawInter).toBe(true);
    expect(secs[0]! >= secs[secs.length - 1]!).toBe(true);
    expect(endOfRound1.log).toEqual(refRound(1));
    for (const p of ps) { const v = p.rt.view(); expect(v.round).toBe(2); expect(v.phase).toBe("ended"); expect(v.log).toEqual(refRound(2)); expect(v.intermission).toBeNull(); expect(JSON.stringify(v.tickets)).not.toBe(JSON.stringify(endOfRound1.tickets)); }
  });
  test("the engagement is not over after round 1: phones keep playing and wait for round 2", async () => {
    await setRounds();
    const a = mkPhone(410); await a.rt.boot(); await a.rt.join(a.phone);
    for (let i = 0; i < 160; i++) await step([a]);
    const v = a.rt.view();
    expect(v.log.length).toBe(75); expect(v.round).toBe(1); expect(v.phase).toBe("play");
    expect(v.nextCallInSec).not.toBeNull(); // counting down to round 2's first number
  });
  test("claims go to the store per round (4 each), the organizer's check passes for both, and results show per round with what each phone received", async () => {
    await setRounds();
    const ps = Array.from({ length: 10 }, (_, i) => mkPhone(420 + i));
    for (const p of ps) { await p.rt.boot(); await p.rt.join(p.phone); }
    for (let i = 0; i < 420; i++) await step(ps);
    const claims = (await (await D.headCall("GET", `/api/z/${EID}/claims`, undefined, { "x-organizer": SECRET })).json() as any).claims;
    expect(claims.filter((c: any) => c.round === 1)).toHaveLength(40);
    expect(claims.filter((c: any) => c.round === 2)).toHaveLength(40);
    const cfg = { tickets: 1 as const, rewards: defaultRewards(), breaks: [], rounds: 2 };
    const logs = { 1: refRound(1), 2: refRound(2) };
    const chk = checkClaims(EID, claims.map((c: any) => ({ pid: c.pid, pattern: c.pattern, idx: c.idx, round: c.round })), logs, cfg);
    expect(chk.bad).toEqual([]);
    const pids = (await (await D.headCall("GET", `/api/z/${EID}/participants`, undefined, { "x-organizer": SECRET })).json() as any).participants.map((x: any) => x.pid);
    const settled = [...settleAll(EID, pids, logs[1], cfg, 1), ...settleAll(EID, pids, logs[2], cfg, 2)];
    expect(settled.filter((s) => s.round === 1)).toHaveLength(4); expect(settled.filter((s) => s.round === 2)).toHaveLength(4);
    expect(await settleViaPhones(settled.map((s) => ({ pattern: s.pattern, ordinal: s.ordinal, round: s.round, idx: s.idx, pids: s.pids })), pids)).toBe(200);
    await step(ps, 16000);
    for (const p of ps) {
      const v = p.rt.view();
      expect(v.results.every((r) => (r.round ?? 1) === 2)).toBe(true); // the card shows the round being played
      expect(v.results).toHaveLength(4);
      const got1 = v.past.find((x) => x.round === 1)!.got.length;
      const expected1 = settled.filter((s) => s.round === 1 && s.pids.includes(p.rt.pid!)).length;
      expect(got1).toBe(expected1);
    }
  });
  test("a signed pause during round 1 also moves round 2, and every phone still matches the organizer's reference for both rounds", async () => {
    await registerKey(); await setRounds();
    const ps = [mkPhone(440), mkPhone(441)];
    for (const p of ps) { await p.rt.boot(); await p.rt.join(p.phone); }
    for (let i = 0; i < 40; i++) await step(ps);
    expect((await publish({ action: "pause", pauseForRounds: 20 })).status).toBe(200);
    for (let i = 0; i < 460; i++) await step(ps);
    const f = (await readPublished(kvOf(), EID))!; const st = resolveControl(cfgOf(f), f.messages);
    expect(ps[0]!.rt.view().log).toEqual(refRound(2, st));
    expect(ps[1]!.rt.view().log).toEqual(refRound(2, st));
    expect(ps[0]!.rt.view().phase).toBe("ended");
  });
  test("a stop between the rounds ends it for everyone and round 2 never starts", async () => {
    await registerKey(); await setRounds();
    const ps = [mkPhone(450), mkPhone(451)];
    for (const p of ps) { await p.rt.boot(); await p.rt.join(p.phone); }
    for (let i = 0; i < 165; i++) await step(ps);
    expect((await publish({ action: "stop" })).status).toBe(200);
    for (let i = 0; i < 260; i++) await step(ps);
    for (const p of ps) { const v = p.rt.view(); expect(v.phase).toBe("ended"); expect(v.round).toBe(1); }
  });
});

describe("winners hear it, and the engagement ends when the last prize is awarded", () => {
  test("two phones work out the winners themselves from the public seat list: nobody publishes anything, each winner hears it, and everyone sees it ended long before 90 numbers", async () => {
    const a = mkPhone(11, { earlyEnd: true }), b = mkPhone(12, { earlyEnd: true });
    for (const p of [a, b]) { await p.rt.boot(); expect(await p.rt.join(p.phone)).toBe(true); }
    const pids = [a.rt.pid!, b.rt.pid!];
    const ref = reference();
    const cfg = a.rt.cfg;
    const settledAt = (k: number) => settleAll(EID, pids, ref.slice(0, k), cfg, 1);
    const need = keysInPlayLines(cfg);
    let K = 0; for (let k = 1; k <= 75 && !K; k++) { const got = settledAt(k); if (need.every((n) => got.some((x) => x.pattern === n.key && x.ordinal === n.ordinal))) K = k; }
    expect(K).toBeGreaterThan(0); expect(K).toBeLessThan(75); // with two players every line is awarded before the last number
    for (let i = 0; i < 300 && a.rt.view().phase !== "ended"; i++) await step([a, b]);
    const results = settledAt(K);
    for (let i = 0; i < 8; i++) await step([a, b], 5000); // the last reports reach the store
    // nobody published anything: the phones agreed, and the store holds exactly what the software worked out
    const stored = ((await (await D.headCall("GET", `/api/z/${EID}/results`)).json()) as any).results as { pattern: string; ordinal: number; idx: number; count: number }[];
    expect(stored.map((x) => `${x.pattern}:${x.ordinal}:${x.idx}:${x.count}`).sort()).toEqual(results.map((x) => `${x.pattern}:${x.ordinal}:${x.idx}:${x.pids.length}`).sort());
    for (const [p, pid] of [[a, pids[0]!], [b, pids[1]!]] as const) {
      const v = p.rt.view();
      expect(v.phase).toBe("ended"); expect(v.endedByPrizes).toBe(true); expect(v.allAwarded).toBe(true); expect(v.localWinners).toBe(true);
      expect(v.log.length).toBe(K); // it stopped at the call that awarded the last prize
      const mine = results.filter((x) => x.pids.includes(pid)).map((x) => `${x.pattern}:${x.ordinal}`).sort();
      expect(v.won.map((w) => `${w.pattern}:${w.ordinal}`).sort()).toEqual(mine);
      for (const w of v.won) expect(Array.isArray(w.cells)).toBe(true);
    }
    expect(a.rt.view().won.length + b.rt.view().won.length).toBeGreaterThanOrEqual(need.length); // every line has a winner
  }, 60_000);
  test("a phone that cannot reach the seat list falls back to the results the other phones agreed on", async () => {
    const a = mkPhone(14, { earlyEnd: true }), b = mkPhone(15, { earlyEnd: true });
    { const real = a.rt.deps.api; (a.rt.deps as any).api = async (m: string, path: string, x?: unknown) => { if (/\/seats/.test(path)) throw new Error("outage"); return real(m, path, x); }; }
    for (const p of [a, b]) { await p.rt.boot(); expect(await p.rt.join(p.phone)).toBe(true); }
    const pids = [a.rt.pid!, b.rt.pid!], ref = reference(), cfg = a.rt.cfg, need = keysInPlayLines(cfg);
    const settledAt = (k: number) => settleAll(EID, pids, ref.slice(0, k), cfg, 1);
    let K = 0; for (let k = 1; k <= 75 && !K; k++) { const got = settledAt(k); if (need.every((n) => got.some((x) => x.pattern === n.key && x.ordinal === n.ordinal))) K = k; }
    for (let i = 0; i < 300 && a.rt.view().phase !== "ended"; i++) await step([a, b]);
    for (let i = 0; i < 8; i++) await step([a, b], 5000);
    const results = settledAt(K);
    expect(a.rt.view().localWinners).toBe(false); // it never had the seat list: it only heard the agreed results
    for (const [p, pid] of [[a, pids[0]!], [b, pids[1]!]] as const) {
      const v = p.rt.view();
      expect(v.phase).toBe("ended"); expect(v.endedByPrizes).toBe(true);
      expect(v.won.map((w) => `${w.pattern}:${w.ordinal}`).sort()).toEqual(results.filter((x) => x.pids.includes(pid)).map((x) => `${x.pattern}:${x.ordinal}`).sort());
    }
  }, 60_000);
  test("a house nobody completes keeps the engagement running to the last number (never ends on a guess)", async () => {
    const a = mkPhone(13); await a.rt.boot(); await a.rt.join(a.phone);
    for (let i = 0; i < 6; i++) await step([a], 5000);
    const v = a.rt.view();
    expect(v.allAwarded).toBe(false); expect(v.endedByPrizes).toBe(false); expect(v.phase).toBe("play");
  });
});
const keysInPlayLines = (cfg: PhoneRuntime["cfg"]) => keysInPlay(cfg.rewards).flatMap((key) => linesFor(cfg.rewards, key).map((l) => ({ key, ordinal: l.ordinal })));
