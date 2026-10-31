// Late joiners, end to end through the real store and the real phone runtime: they see no old numbers, their own numbers start 90 seconds after joining,
// prizes already awarded stay awarded, and every phone (early or late) reaches the same winners.
import { beforeEach, describe, expect, test } from "bun:test";
import { bytesToHex } from "@noble/hashes/utils";
import { sha256 } from "@noble/hashes/sha256";
import { type Env } from "../../../apps/edge/src/worker";
import { handle } from "../../../apps/edge/test/with-terms";
import { makeD1 } from "../../../apps/edge/test/d1-sqlite";
import { PhoneRuntime, type PhoneDeps } from "../src/phone-runtime";
import { settleAll } from "../src/game";
import { GRACE_ROUNDS, LATE_LAG_ROUNDS } from "../src/config";
import { countFromOf } from "../src/prize-engine";
import { deriveCalls, roundAt, roundTimeMs, type Fetcher, type Round } from "../src";

const SECRET = "org", EID = "ENG-LATE-1", START = 60_000, CALL_SECONDS = 6;
const rnd = (r: number) => bytesToHex(sha256(new TextEncoder().encode("fake" + r)));
let env: Env; let t = 0; let T0 = 0;
const head = (method: string, path: string, body?: unknown, h: Record<string, string> = {}) =>
  handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", ...h }, body: body === undefined ? undefined : JSON.stringify(body) }), env, T0 + t);
const api: PhoneDeps["api"] = async (method, path, body) => {
  const r = await head(method, path, body); const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error ?? "http " + r.status), { status: r.status });
  return j;
};
const fetcher: Fetcher = async (url) => { const last = url.split("/").pop()!; const nowR = roundAt(T0 + t); const r = last === "latest" ? nowR : Number(last); if (r > nowR) return { ok: false, status: 404, json: async () => ({}) }; return { ok: true, status: 200, json: async () => ({ round: r, randomness: rnd(r), signature: "aa" } as Round) }; };
const mkPhone = (n: number, earlyEnd = false) => {
  const mem = new Map<string, string>();
  const rt = new PhoneRuntime(EID, { noEarlyEnd: !earlyEnd, api, mono: () => t, store: { get: (k) => mem.get(k) ?? null, set: (k, v) => void mem.set(k, v) }, beacon: { fetcher, mirrors: ["https://a.test", "https://b.test", "https://c.test"], timeoutMs: 500 }, verify: (x) => x.signature === "aa" && x.randomness === rnd(x.round) });
  return { rt, phone: "9" + String(300000000 + n) };
};
const step = async (ps: ReturnType<typeof mkPhone>[], ms = 3000) => { t += ms; for (const p of ps) await p.rt.tick(); };
const FIRST = START; // effective first beacon round
const callRound = (k: number) => FIRST + k * (CALL_SECONDS / 3);
const ref = () => deriveCalls(EID, Array.from({ length: 75 }, (_, k) => rnd(callRound(k))));
const shape = (xs: { pattern: string; ordinal: number; idx: number; count: number }[]) => xs.filter((x) => x.pattern !== "lucky").map((x) => `${x.pattern}:${x.ordinal}:${x.idx}:${x.count}`).sort();

beforeEach(async () => {
  const d = makeD1();
  env = { DB: d.db, ORGANIZER_SECRET: SECRET, DAILY_WRITE_BUDGET: "1000000" };
  T0 = roundTimeMs(FIRST - 3); t = 0;
  await head("POST", "/api/z", { id: EID, startRound: FIRST - GRACE_ROUNDS, callSeconds: CALL_SECONDS, cap: 100 }, { "x-organizer": SECRET });
});

describe("joining after the game began", () => {
  test("a late joiner sees no old numbers, starts counting 90 seconds after joining, and every phone reaches the same winners as the whole-log rule", async () => {
    const a = mkPhone(1), b = mkPhone(2);
    for (const p of [a, b]) { await p.rt.boot(); expect(await p.rt.join(p.phone)).toBe(true); }
    for (let i = 0; i < 70; i++) await step([a, b]); // about 210 s in: roughly 35 numbers are out
    expect(a.rt.view().log.length).toBeGreaterThan(25);
    const c = mkPhone(3); await c.rt.boot(); expect(await c.rt.join(c.phone)).toBe(true);
    const cv = c.rt.view();
    expect(cv.late).not.toBeNull(); expect(cv.late!.countFromRound).toBe(countFromOf(Number(JSON.parse(JSON.stringify((c.rt as any).myJr))))); expect(cv.late!.countFromRound).toBeGreaterThan(roundAt(T0 + t));
    await step([a, b, c], 3000);
    expect(c.rt.view().log).toEqual([]); // nothing old is shown
    expect(c.rt.view().late!.secondsUntil).toBeGreaterThan(60); expect(c.rt.view().late!.secondsUntil).toBeLessThanOrEqual(LATE_LAG_ROUNDS * 3);
    const cf = (c.rt as any).myCountFrom as number; expect(cf).toBeGreaterThan(0);
    for (let i = 0; i < 300; i++) await step([a, b, c]);
    for (let i = 0; i < 6; i++) await step([a, b, c], 16000);
    const full = ref();
    expect(a.rt.view().log).toEqual(full); expect(b.rt.view().log).toEqual(full);
    expect(c.rt.view().log).toEqual(full.filter((_, k) => callRound(k) >= cf)); // exactly the numbers from its count-from round on
    expect(c.rt.view().late!.hidden).toBe(full.filter((_, k) => callRound(k) < cf).length); expect(c.rt.view().late!.secondsUntil).toBe(0);
    // the winners, by the whole-log rule with the same late-joiner rule
    const pids = [a.rt.pid!, b.rt.pid!, c.rt.pid!];
    const expected = settleAll(EID, pids, full, a.rt.cfg, 1, { countFrom: new Map([[c.rt.pid!, cf]]), callRounds: full.map((_, k) => callRound(k)) });
    const want = expected.map((x) => `${x.pattern}:${x.ordinal}:${x.idx}:${x.pids.length}`).sort();
    for (const p of [a, b, c]) { expect(p.rt.view().localWinners).toBe(true); expect(shape(p.rt.view().results)).toEqual(want); }
    // a prize c holds was completed with numbers it was allowed to count
    for (const w of c.rt.view().won) { const hit = expected.find((x) => x.pattern === w.pattern && x.ordinal === w.ordinal)!; expect(callRound(hit.idx)).toBeGreaterThanOrEqual(cf); }
  }, 120_000);
  test("prizes already awarded are gone: a late joiner's ticket can never take the 1st prize of a house that someone already won", async () => {
    const a = mkPhone(11), b = mkPhone(12);
    for (const p of [a, b]) { await p.rt.boot(); await p.rt.join(p.phone); }
    for (let i = 0; i < 200; i++) await step([a, b]); // 600 s: every number is out and every house is long awarded
    expect(a.rt.view().log.length).toBe(75);
    const first = a.rt.view().results.find((x) => x.pattern === "line" && x.ordinal === 1)!; expect(first).toBeTruthy();
    const c = mkPhone(13); await c.rt.boot(); await c.rt.join(c.phone);
    for (let i = 0; i < 20; i++) await step([a, b, c]);
    expect(c.rt.view().log).toEqual([]); // the game is over: nothing is left for this phone to see or win
    expect(c.rt.view().won).toEqual([]);
    expect(shape(a.rt.view().results)).toEqual(shape(c.rt.view().results)); // and the results everyone sees did not move
  }, 120_000);
  test("joining inside the 2-minute setup window is not late: everything counts", async () => {
    const a = mkPhone(21); await a.rt.boot(); await a.rt.join(a.phone);
    expect(a.rt.view().late).toBeNull();
    t = (callRound(0) - roundAt(T0)) * 3000 - 60_000; // 1 minute before the first number: inside the setup window
    const b = mkPhone(22); await b.rt.boot(); await b.rt.join(b.phone);
    expect(b.rt.view().late).toBeNull(); expect(((await (await head("GET", `/api/z/${EID}/participants`, undefined, { "x-organizer": SECRET })).json()) as any).participants.every((x: any) => x.jr === 0)).toBe(true);
  });
});
