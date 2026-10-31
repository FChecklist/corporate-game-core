// Real phones (the phone runtime, the Worker and a database) playing a game that rewards the new houses and Unlucky: every phone works out the same winners as the whole-log settlement,
// the store accepts them (several phones agree), a removed seat is kept out of Unlucky through the public seat list, and the winner's own phone knows it won.
import { beforeEach, describe, expect, test } from "bun:test";
import { bytesToHex } from "@noble/hashes/utils";
import { sha256 } from "@noble/hashes/sha256";
import { type Env } from "../../../apps/edge/src/worker";
import { handle } from "../../../apps/edge/test/with-terms";
import { makeD1 } from "../../../apps/edge/test/d1-sqlite";
import { PhoneRuntime, type PhoneDeps } from "../src/phone-runtime";
import { settleAll } from "../src/game";
import { GRACE_ROUNDS, PRIZE_HOUSES, type EngagementCfg } from "../src/config";
import { deriveCalls, roundAt, roundTimeMs, type Fetcher, type Round } from "../src";

const SECRET = "org", EID = "ENG-HOUSES-1", START = 50_000, CALL_SECONDS = 6;
const rnd = (r: number) => bytesToHex(sha256(new TextEncoder().encode("fake" + r)));
let env: Env; let t = 0; let T0 = 0;
const call = (method: string, path: string, body?: unknown, h: Record<string, string> = {}) =>
  handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", ...h }, body: body === undefined ? undefined : JSON.stringify(body) }), env, T0 + t);
const api: PhoneDeps["api"] = async (method, path, body) => {
  const r = await call(method, path, body); const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error ?? "http " + r.status), { status: r.status });
  return j;
};
const fetcher: Fetcher = async (url) => {
  const last = url.split("/").pop()!, nowR = roundAt(T0 + t), r = last === "latest" ? nowR : Number(last);
  if (r > nowR) return { ok: false, status: 404, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => ({ round: r, randomness: rnd(r), signature: "aa" } as Round) };
};
const mkPhone = (n: number) => {
  const mem = new Map<string, string>();
  const rt = new PhoneRuntime(EID, {
    noEarlyEnd: true, api, mono: () => t, store: { get: (k) => mem.get(k) ?? null, set: (k, v) => void mem.set(k, v) },
    beacon: { fetcher, mirrors: ["https://a.test", "https://b.test", "https://c.test"], timeoutMs: 500 },
    verify: (x) => x.signature === "aa" && x.randomness === rnd(x.round),
  });
  return { rt, phone: "9" + String(100000000 + n) };
};
const step = async (ps: ReturnType<typeof mkPhone>[], ms = 3000) => { t += ms; for (const p of ps) await p.rt.tick(); };
const reference = () => deriveCalls(EID, Array.from({ length: 75 }, (_, k) => rnd(START + k * 2)));

const REWARDS = [
  ...["line", "twolines", "corners", "plus", "x", "frame", "stamp", "letterL", "letterT", "blackout"].map((pattern) => ({ pattern, ordinal: 1, text: "" })),
  { pattern: "line", ordinal: 2, text: "" }, { pattern: "line", ordinal: 3, text: "" },
];
beforeEach(async () => {
  const d = makeD1();
  env = { DB: d.db, ORGANIZER_SECRET: SECRET, DAILY_WRITE_BUDGET: "1000000" };
  T0 = roundTimeMs(START - 3); t = 0;
  const r = await call("POST", "/api/z", { id: EID, startRound: START - GRACE_ROUNDS, callSeconds: CALL_SECONDS, cap: 200, rewards: REWARDS }, { "x-organizer": SECRET });
  expect(r.status).toBe(200);
});

const play = async (ps: ReturnType<typeof mkPhone>[]) => { for (const p of ps) { await p.rt.boot(); expect(await p.rt.join(p.phone)).toBe(true); } for (let i = 0; i < 215; i++) await step(ps); for (let i = 0; i < 6; i++) await step(ps, 5000); };
const expected = (cfg: EngagementCfg, pids: string[]) => settleAll(EID, pids, reference(), cfg);
const line = (x: { pattern: string; ordinal: number; idx: number }, n: number) => `${x.pattern}:${x.ordinal}:${x.idx}:${n}`;

describe("phones playing every house", () => {
  test("every phone works out the same winners as the whole-log settlement, and the store accepts them", async () => {
    const ps = [mkPhone(21), mkPhone(22), mkPhone(23), mkPhone(24)];
    await play(ps);
    const pids = ps.map((p) => p.rt.pid!), cfg = ps[0]!.rt.cfg;
    expect(cfg.rewards.some((l) => l.pattern === "twolines")).toBe(true); // the game really carries the extra houses
    expect(PRIZE_HOUSES.length).toBe(10);
    const want = expected(cfg, pids);
    expect(want.some((x) => x.pattern === "blackout")).toBe(true);
    for (const p of ps) {
      const v = p.rt.view();
      expect(v.localWinners).toBe(true); expect(v.log.length).toBe(75);
      expect(v.results.map((x) => line(x, x.count)).sort()).toEqual(want.map((x) => line(x, x.pids.length)).sort());
    }
    const stored = ((await (await call("GET", `/api/z/${EID}/results`)).json()) as any).results as { pattern: string; ordinal: number; idx: number; count: number; winners?: string[] }[];
    expect(stored.map((x) => line(x, x.count)).sort()).toEqual(want.map((x) => line(x, x.pids.length)).sort());
    // every win a phone reports is a house it really completed at the call named, and the squares to light are the called ones
    for (const p of ps) for (const w of p.rt.view().won) { expect(want.some((x) => x.pattern === w.pattern && x.ordinal === w.ordinal && x.idx === w.idx && x.pids.includes(p.rt.pid!))).toBe(true); expect(w.cells.length).toBeGreaterThan(2); }
  }, 120_000);
});

describe("the store enforces the maximum winners per house", () => {
  test("settings refuse a third Plus winner with a calm message and keep what was saved", async () => {
    expect((await call("POST", "/api/z", { id: "FUT-1", startRound: START + 10_000, callSeconds: CALL_SECONDS, cap: 50, rewards: REWARDS }, { "x-organizer": SECRET })).status).toBe(200);
    const bad = await call("PATCH", `/api/z/FUT-1/settings`, { rewards: [{ pattern: "plus", ordinal: 1, text: "" }, { pattern: "plus", ordinal: 2, text: "" }, { pattern: "plus", ordinal: 3, text: "" }] }, { "x-organizer": SECRET });
    expect(bad.status).toBe(400);
    const j = (await bad.json()) as any; expect(j.error).toContain("Plus"); expect(j.error).toMatch(/at most 2 winners/);
    const info = (await (await call("GET", `/api/z/FUT-1/info`)).json()) as any;
    expect(info.rewards.length).toBe(REWARDS.length); // unchanged
    const ok = await call("PATCH", `/api/z/FUT-1/settings`, { rewards: [{ pattern: "blackout", ordinal: 1, text: "" }, { pattern: "blackout", ordinal: 2, text: "" }, { pattern: "line", ordinal: 1, text: "" }, { pattern: "line", ordinal: 2, text: "" }, { pattern: "line", ordinal: 3, text: "Torch" }] }, { "x-organizer": SECRET });
    expect(ok.status).toBe(200);
    expect(((await (await call("GET", `/api/z/FUT-1/info`)).json()) as any).rewards.length).toBe(5);
  });
  test("a saved game with 3 Line winners loads, plays and can be read back", async () => {
    const d = makeD1(); env = { DB: d.db, ORGANIZER_SECRET: SECRET, DAILY_WRITE_BUDGET: "1000000" };
    const create = await call("POST", "/api/z", { id: "OLD-1", startRound: START - GRACE_ROUNDS, callSeconds: CALL_SECONDS, cap: 50 }, { "x-organizer": SECRET });
    expect(create.status).toBe(200);
    await env.DB.prepare("UPDATE engagement SET config=? WHERE id=?").bind(JSON.stringify({ rewards: [1, 2, 3].map((ordinal) => ({ pattern: "line", scope: "ticket", ordinal, text: "" })) }), "OLD-1").run();
    const info = (await (await call("GET", `/api/z/OLD-1/info`)).json()) as any;
    expect(info.rewards.map((l: any) => l.ordinal)).toEqual([1, 2, 3]);
  });
});
