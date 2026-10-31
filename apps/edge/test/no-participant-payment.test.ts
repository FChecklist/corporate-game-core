// LR-1: no code path takes money from a participant. A participant joins, plays and wins without ever being asked for, or able to give, a payment.
// The only payers are the organizer (or someone the organizer gave the pay link to) for the licence fee, and nobody pays "into" a game.
import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { handle } from "./with-terms";
import { type Env as WorkerEnv } from "../src/worker";
import { makeD1 } from "./d1-sqlite";

const T = Date.UTC(2026, 9, 13, 10, 0, 0), GEN = 1692803367;
const START = Math.floor((T / 1000 - GEN) / 3) + 1200;
let env: WorkerEnv; let raw: ReturnType<typeof makeD1>["raw"]; let ip = 0;
const call = (method: string, path: string, body?: unknown, key?: string) =>
  handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", "cf-connecting-ip": `6.6.6.${++ip % 200}`, ...(key ? { "x-organizer": key } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }), env, T);
const j = async (r: Response) => (await r.json()) as any;
const rd = (rel: string) => readFileSync(new URL("../../../" + rel, import.meta.url), "utf8");
const dev = (i: number) => i.toString(16).padStart(4, "0").repeat(8);
beforeEach(() => { const d = makeD1(); raw = d.raw; ip = 0; env = { DB: d.db, ORGANIZER_SECRET: "plat", DAILY_WRITE_BUDGET: "100000000", PUBLIC_ORIGIN: "https://bingo.test", PHONE_SALT: "salt", DATA_KEY: "k", TEST_MODE: "1" } as WorkerEnv; });

describe("LR-1: no code path takes money from a participant", () => {
  test("the pages a participant sees contain no payment call, no payment provider and no price", () => {
    for (const f of ["apps/web/public/z.js", "apps/web/public/zgame.js", "apps/web/public/big.js", "apps/web/public/demo.js", "apps/web/public/z.html", "apps/web/public/big.html", "apps/web/public/demo.html", "packages/beacon/src/phone-runtime.ts"]) {
      const s = rd(f);
      expect([f, /\/api\/(checkout|payments|paylink)|razorpay|checkout\.js|\bpaygo\b|TB\.pay\b|amount_paid|\bprice\(/i.test(s)]).toEqual([f, false]);
    }
  });
  test("only the payment pages are allowed to load the payment provider (the page headers the build writes)", () => {
    const b = rd("pages/build.mjs");
    const paycsp = b.match(/const PAYCSP = [^\n]*/)![0];
    expect(paycsp).toContain("https://checkout.razorpay.com");
    const usingPay = [...b.matchAll(/\["(\/[a-z-]+)", PAYCSP, (?:true|false)\]/g)].map((m) => m[1]).sort();
    expect(usingPay).toEqual(["/pay", "/paylink", "/paytest"]); // no game, phone, big-screen or demo page is among them
    for (const p of ["/z", "/big", "/demo", "/preview"]) expect(b).toContain(`["${p}", ${p === "/big" ? "PLAINCSP" : "GAMECSP"},`);
  });
  test("joining, playing and the public answers create no payment, order, invoice or entitlement, and show no payment link", async () => {
    const k = (await j(await call("POST", "/api/start", { email: "boss@acme.com" }))).token as string;
    expect((await call("POST", "/api/z", { id: "LR1-1", startRound: START, callSeconds: 6, cap: 100 }, k)).status).toBe(200);
    expect((await call("POST", "/api/z/LR1-1/publish", { email: "boss@acme.com", phone: "98765 43210" }, k)).status).toBe(200);
    const before = JSON.stringify(["payment", "invoice", "entitlement", "refund", "paylink", "ledger"].map((t) => { try { return raw.query(`SELECT COUNT(*) c FROM ${t}`).get(); } catch { return null; } }));
    for (let i = 0; i < 5; i++) {
      // a participant may even try to send payment details along: they are ignored, nothing is created
      const r = await call("POST", "/api/z/LR1-1/join", { name: `Player ${i}`, device: dev(i + 1), amount: 500, payment: { id: "pay_x" }, price: 1 });
      expect(r.status).toBe(200);
      const body = JSON.stringify(await r.json());
      expect(body).not.toMatch(/razorpay|payUrl|checkout|amount|price|invoice|payment/i);
    }
    expect(raw.query("SELECT COUNT(*) c FROM participant").get()).toEqual({ c: 5 });
    const after = JSON.stringify(["payment", "invoice", "entitlement", "refund", "paylink", "ledger"].map((t) => { try { return raw.query(`SELECT COUNT(*) c FROM ${t}`).get(); } catch { return null; } }));
    expect(after).toBe(before);
    for (const path of ["/api/z/LR1-1/info", "/api/z/LR1-1/seats"]) {
      const s = JSON.stringify(await j(await call("GET", path)));
      expect([path, /razorpay|payUrl|checkout|invoice/i.test(s)]).toEqual([path, false]);
    }
  });
  test("every route that makes a payment needs the payer's e-mail and a licence pack, and none takes a game id from a participant's card", async () => {
    // the participant's card id (pid) and seat are not accepted as a payer: a checkout for a game needs an organizer key or a pay link the organizer made
    const k = (await j(await call("POST", "/api/start", { email: "boss@acme.com" }))).token as string;
    await call("POST", "/api/z", { id: "LR1-2", startRound: START, callSeconds: 6, cap: 100 }, k);
    await call("POST", "/api/z/LR1-2/publish", { email: "boss@acme.com", phone: "98765 43210" }, k);
    const joined = await j(await call("POST", "/api/z/LR1-2/join", { name: "Maya Lopez", device: dev(9) }));
    const r = await call("POST", "/api/checkout", { eid: "LR1-2", org: "Maya", email: "maya@x.com", country: "IN", currency: "INR", pid: joined.pid, name: "Maya Lopez" });
    expect(r.status).toBeGreaterThanOrEqual(400); // not an organizer, not a pay link: nothing to pay for
    const r2 = await call("POST", "/api/z/LR1-2/paylink", {}, undefined);
    expect(r2.status).toBeGreaterThanOrEqual(400);
    expect(raw.query("SELECT COUNT(*) c FROM payment WHERE eid='LR1-2'").get()).toEqual({ c: 0 });
  });
});
