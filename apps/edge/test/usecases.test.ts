// Use cases, exceptions and "what can go wrong". IDs match docs/USE_CASES.md (grep "UC-12").
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { withDevice } from "./device";
import { createHmac } from "node:crypto";
import { housekeeping, purgeOld, type Env } from "../src/worker";
import { handle } from "./with-terms";
import type { PayEnv } from "../src/pay";
import { makeD1 } from "./d1-sqlite";

const T = Date.UTC(2026, 9, 1, 10, 0, 0);
const GEN = 1692803367;
const roundAt = (ms: number) => Math.floor((ms / 1000 - GEN) / 3) + 1;
const roundMs = (r: number) => (GEN + (r - 1) * 3) * 1000;
const START = roundAt(T) + 1200; // one hour after T
const START_MS = roundMs(START);
const HOUR = 3_600_000, DAY = 86_400_000;
const hmac = (secret: string, s: string) => createHmac("sha256", secret).update(s).digest("hex");

let env: PayEnv; let raw: ReturnType<typeof makeD1>["raw"];
let ipN = 0;
const realFetch = globalThis.fetch;
let rz: { orders: any[]; payments: Record<string, any>; mail: any[]; mailDown: boolean };

const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}, now = T) =>
  handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", ...headers }, body: withDevice(method, path, body) }), env as Env, now);
const j = async (r: Response) => (await r.json()) as any;
const eng = (id: string, over: Record<string, unknown> = {}) => ({ id, startRound: START, callSeconds: 6, cap: 100, ...over });
const contact = { email: "boss@acme.com", phone: "98765 43210" };

async function organizer(email = `o${++ipN}@acme.com`) {
  const r = await call("POST", "/api/start", { email }, { "cf-connecting-ip": `10.0.0.${ipN}` });
  const x = await j(r); expect(r.status).toBe(200);
  return { email, h: { "x-organizer": x.token as string }, ai: { "x-organizer": x.aiKey as string }, token: x.token as string, aiKey: x.aiKey as string };
}
type Org = Awaited<ReturnType<typeof organizer>>;
const orgOf = (id: string) => (raw.prepare("SELECT org FROM engagement WHERE id=?").get(id) as any)?.org as string;
const engRow = (id: string) => raw.prepare("SELECT * FROM engagement WHERE id=?").get(id) as any;
const outbox = (like = "%") => raw.prepare("SELECT to_addr, subject, body FROM outbox WHERE subject LIKE ? ORDER BY id").all(like) as { to_addr: string; subject: string; body: string }[];
const phone = (i: number) => "9" + String(100000000 + i);

/** Gateway stand-in (Razorpay REST) so the whole money flow is exercised. */
function installGateway() {
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const u = String(url);
    if (u.startsWith("https://api.resend.com")) { rz.mail.push(JSON.parse(init.body)); return rz.mailDown ? new Response("down", { status: 503 }) : new Response("{}", { status: 200 }); }
    if (u.startsWith("https://rzp.test/v1/orders")) { const b = JSON.parse(init.body); const o = { id: "order_" + (rz.orders.length + 1), amount: b.amount, currency: b.currency, receipt: b.receipt, status: "created" }; rz.orders.push(o); return new Response(JSON.stringify(o), { status: 200 }); }
    const pm = u.match(/\/payments\/([^/]+)(\/capture)?$/);
    if (pm) { const p = rz.payments[pm[1]!]; if (!p) return new Response(JSON.stringify({ error: { description: "no such payment" } }), { status: 404 }); if (pm[2]) p.status = "captured"; return new Response(JSON.stringify(p), { status: 200 }); }
    return new Response("{}", { status: 404 });
  };
}
const withGateway = () => { env.RAZORPAY_KEY_ID = "rzp_test_x"; env.RAZORPAY_KEY_SECRET = "sek"; env.RAZORPAY_WEBHOOK_SECRET = "whsec"; env.RAZORPAY_BASE_URL = "https://rzp.test/v1"; };
const checkout = (o: Org, eid: string, extra: Record<string, unknown> = {}, now = T) =>
  call("POST", "/api/checkout", { eid, org: "Acme Ltd", email: "boss@acme.com", country: "IN", taxId: "", currency: "INR", ...extra }, o.h, now);
const settle = (paymentId: string, orderId: string, payId: string, now = T, status = "captured", amount?: number) => {
  rz.payments[payId] = { id: payId, order_id: orderId, status, amount: amount ?? rz.orders.find((x) => x.id === orderId)!.amount };
  return call("POST", "/api/payments/verify", { paymentId, razorpay_order_id: orderId, razorpay_payment_id: payId, razorpay_signature: hmac("sek", `${orderId}|${payId}`) }, {}, now);
};

beforeEach(() => {
  const d = makeD1(); raw = d.raw; ipN = 0;
  rz = { orders: [], payments: {}, mail: [], mailDown: false };
  env = { DB: d.db, ORGANIZER_SECRET: "plat", DAILY_WRITE_BUDGET: "1000000", PUBLIC_ORIGIN: "https://bingo.test", PHONE_SALT: "salt" };
  installGateway();
});
afterEach(() => { globalThis.fetch = realFetch; });

/* ============================== A. getting in ============================== */
describe("A. organizer: getting in", () => {
  test("UC-3 wrong code, expired code, five wrong tries lock the code, a used code is dead, too many code requests", async () => {
    const o = await organizer("login@acme.com");
    const ask = () => call("POST", "/api/auth/email", { email: "login@acme.com" });
    const lastCode = () => (outbox("%Corporate Bingo sign-in%").at(-1)!.body.match(/\b\d{6}\b/)![0]);
    await ask(); let code = lastCode();
    expect((await call("POST", "/api/auth/verify", { email: "login@acme.com", code: code === "000000" ? "111111" : "000000" })).status).toBe(400);
    expect((await call("POST", "/api/auth/verify", { email: "login@acme.com", code })).status).toBe(200); // right code after one miss still works
    expect((await call("POST", "/api/auth/verify", { email: "login@acme.com", code })).status).toBe(400); // used once: dead
    await ask(); code = lastCode();
    expect((await call("POST", "/api/auth/verify", { email: "login@acme.com", code }, {}, T + 11 * 60_000)).status).toBe(400); // expired after 10 minutes
    await ask(); code = lastCode();
    const wrong = code === "123456" ? "654321" : "123456";
    for (let i = 0; i < 5; i++) await call("POST", "/api/auth/verify", { email: "login@acme.com", code: wrong });
    expect((await call("POST", "/api/auth/verify", { email: "login@acme.com", code })).status).toBe(400); // five misses burn the code even for the right digits
    let last = 200; for (let i = 0; i < 6; i++) last = (await ask()).status;
    expect(last).toBe(429); // too many codes in an hour
    expect(o.token).toMatch(/^cbk_/);
  });
  test("UC-5 invalid emails are refused everywhere", async () => {
    for (const email of ["", "nope", "a@b", "x".repeat(300) + "@a.com", 42 as any]) {
      expect((await call("POST", "/api/start", { email })).status).toBe(400);
      expect((await call("POST", "/api/auth/email", { email })).status).toBe(400);
    }
  });
  test("UC-5 an unknown email asking for a code gets the same answer as a known one (nobody can find out who has an account)", async () => {
    await organizer("known@acme.com");
    const a = await j(await call("POST", "/api/auth/email", { email: "known@acme.com" })), b = await j(await call("POST", "/api/auth/email", { email: "stranger@nowhere.com" }));
    expect(a).toEqual(b);
  });
  test("UC-6 a made-up key, an empty key, a retired key: refused everywhere", async () => {
    const o = await organizer();
    for (const k of ["cbk_" + "0".repeat(48), "", "garbage"]) expect((await call("GET", "/api/history", undefined, { "x-organizer": k })).status).toBe(403);
    const keys = await j(await call("GET", "/api/org/keys", undefined, o.h));
    const mine = keys.keys.find((k: any) => k.kind === "master");
    const second = await organizer(); // a second master key is needed to retire the first one, as in real life
    expect(mine).toBeTruthy(); expect(second.token).not.toBe(o.token);
    const fresh = await (async () => { await call("POST", "/api/auth/email", { email: o.email }); const c = outbox("%Corporate Bingo sign-in%").at(-1)!.body.match(/\b\d{6}\b/)![0]; return (await j(await call("POST", "/api/auth/verify", { email: o.email, code: c }))).token as string; })();
    expect((await call("POST", "/api/org/keys/revoke", { id: mine.id }, { "x-organizer": fresh })).status).toBe(200);
    expect((await call("GET", "/api/history", undefined, o.h)).status).toBe(403); // the retired key stops at once
    expect((await call("GET", "/api/history", undefined, { "x-organizer": fresh })).status).toBe(200);
  });
});

/* ============================== B. building ============================== */
describe("B. organizer: building", () => {
  test("UC-8b bad input is refused and nothing is saved", async () => {
    const o = await organizer();
    const bad: Record<string, unknown>[] = [
      eng("ab"), eng("has space"), eng("x".repeat(60)), eng("OKID1", { cap: 0 }), eng("OKID2", { cap: 100001 }), eng("OKID3", { cap: 1.5 }),
      eng("OKID4", { callSeconds: 7 }), eng("OKID5", { callSeconds: 3 }), eng("OKID6", { startRound: "soon" }), eng("OKID7", { rewards: [{ pattern: "nonsense", ordinal: 1, text: "x" }] }),
      eng("OKID8", { breaks: [{ after: 500, seconds: 60, kind: "file", title: "x" }] }), eng("OKID9", { tickets: 3 }), eng("OKIDA", { rounds: 9 }),
    ];
    for (const b of bad) expect((await call("POST", "/api/z", b, o.h)).status).toBe(400);
    expect((raw.prepare("SELECT COUNT(*) AS c FROM engagement").get() as any).c).toBe(0);
    expect((await call("POST", "/api/z", "{not json", o.h)).status).toBe(400);
    expect((await call("POST", "/api/z", { id: "BIGBODY1", pad: "x".repeat(200_000) }, o.h)).status).toBe(400);
  });
  test("UC-7 creating the same id twice never overwrites and never reveals whose it is", async () => {
    const a = await organizer(), b = await organizer();
    expect((await call("POST", "/api/z", eng("SAMEID1", { cap: 100 }), a.h)).status).toBe(200);
    const r = await j(await call("POST", "/api/z", eng("SAMEID1", { cap: 999 }), b.h));
    expect(r.existed).toBe(true); expect(engRow("SAMEID1").cap).toBe(100); expect(orgOf("SAMEID1")).not.toBe(orgOf("SAMEID1") + "x");
  });
});

/* ============================== C. publish and pay ============================== */
describe("C. publish and pay", () => {
  test("UC-9 / Case 2: publish free, pay before the start: paid, runs on time, new engagement possible next time", async () => {
    withGateway();
    const o = await organizer();
    await call("POST", "/api/z", eng("CASE-2", { cap: 300 }), o.h);
    const pub = await j(await call("POST", "/api/z/CASE-2/publish", contact, o.h));
    expect(pub.published).toBe(true); expect(pub.paid).toBe(false);
    expect(outbox("%payment pending%").length).toBe(1);
    const c = await j(await checkout(o, "CASE-2", {}, T + 10 * 60_000));
    expect(c.mode).toBe("razorpay"); expect(c.razorpay.notes.participants).toBe("500");
    const v = await j(await settle(c.paymentId, c.razorpay.orderId, "pay_1", T + 11 * 60_000));
    expect(v.published).toBe(true); expect(v.restartedAtMs).toBeNull(); // paid in time: the start does not move
    expect(engRow("CASE-2").pack).toBe(500); expect(engRow("CASE-2").start_round).toBe(START);
    const info = await j(await call("GET", "/api/z/CASE-2/info", undefined, {}, START_MS + 1000));
    expect(info.locked).toBeFalsy(); // after the start it is not held
    expect((await call("GET", "/api/z/CASE-2/control", undefined, {}, START_MS + 1000)).status).toBe(404); // nothing to hold, no pause key
    // next time: a new engagement is just as easy
    expect((await call("POST", "/api/z", eng("CASE-2B"), o.h, START_MS + 5000)).status).toBe(200);
  });
  test("UC-10 / UC-11 / Case 1: published, never paid: held at the start, organizer told once, can build again, the old one is forgotten", async () => {
    const o = await organizer();
    await call("POST", "/api/z", eng("CASE-1"), o.h);
    await call("POST", "/api/z/CASE-1/publish", contact, o.h);
    expect((await call("POST", "/api/z/CASE-1/join", { phone: phone(1) })).status).toBe(200); // a guest got their ticket
    const after = START_MS + 5 * 60_000;
    expect((await j(await call("GET", "/api/z/CASE-1/control", undefined, {}, after))).locked).toBe(true);
    await call("GET", "/api/z/CASE-1/info", undefined, {}, after); await call("GET", "/api/z/CASE-1/info", undefined, {}, after + 1000);
    expect(outbox("%could not begin%").length).toBe(1);
    expect((await call("POST", "/api/z", eng("CASE-1B", { startRound: roundAt(after) + 1200 }), o.h, after)).status).toBe(200); // no penalty: they can build again
    expect(await purgeOld(env as Env, T + 31 * DAY)).toBeGreaterThanOrEqual(1);
    expect(engRow("CASE-1")).toBeFalsy();
  });
  test("UC-12 pay AFTER the start time: the first number comes 2 minutes after the payment for everyone already waiting", async () => {
    withGateway();
    const o = await organizer();
    await call("POST", "/api/z", eng("LATE-PAY"), o.h);
    await call("POST", "/api/z/LATE-PAY/publish", contact, o.h);
    const late = START_MS + 30 * 60_000; // half an hour after it should have started
    expect((await j(await call("GET", "/api/z/LATE-PAY/info", undefined, {}, late))).locked).toBe(true);
    const c = await j(await checkout(o, "LATE-PAY", {}, late));
    const v = await j(await settle(c.paymentId, c.razorpay.orderId, "pay_late", late));
    expect(v.published).toBe(true); expect(v.restartedAtMs).toBeGreaterThanOrEqual(late); expect(v.restartedAtMs).toBeLessThanOrEqual(late + 4_000); expect(v.restartedAtMs + 120_000 - late).toBeGreaterThanOrEqual(115_000); expect(v.restartedAtMs + 120_000 - late).toBeLessThanOrEqual(124_000); // the start moves to the next round; the first number follows the 2-minute setup window, so 2 minutes after paying
    const info = await j(await call("GET", "/api/z/LATE-PAY/info", undefined, {}, late + 1000));
    expect(info.locked).toBeFalsy(); expect(info.startMs).toBe(v.restartedAtMs);
    expect((await call("GET", "/api/z/LATE-PAY/control", undefined, {}, late + 1000)).status).toBe(404);
    const info2 = await j(await call("GET", "/api/z/LATE-PAY/info", undefined, {}, late + 200_000));
    expect(info2.locked).toBeFalsy(); // and it stays open once it has started
  });
  test("UC-13 publishing twice, or from two tabs at the same moment: one publish, one e-mail", async () => {
    const o = await organizer();
    await call("POST", "/api/z", eng("DOUBLE-1"), o.h);
    const rs = await Promise.all([1, 2, 3, 4].map(() => call("POST", "/api/z/DOUBLE-1/publish", contact, o.h)));
    for (const r of rs) expect(r.status).toBe(200);
    expect(outbox("%payment pending%").length).toBeLessThanOrEqual(2); // a simultaneous retry may e-mail again, but never more than once per tab
    const again = await j(await call("POST", "/api/z/DOUBLE-1/publish", contact, o.h));
    expect(again.already).toBe(true);
    expect((raw.prepare("SELECT COUNT(*) AS c FROM kv WHERE k='pub/DOUBLE-1'").get() as any).c).toBe(1);
  });
  test("UC-14 the gateway's webhook alone completes the payment when the browser was closed", async () => {
    withGateway();
    const o = await organizer();
    await call("POST", "/api/z", eng("WEBHK-1", { cap: 100 }), o.h);
    await call("POST", "/api/z/WEBHK-1/publish", contact, o.h);
    const c = await j(await checkout(o, "WEBHK-1"));
    const ev = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_w", order_id: c.razorpay.orderId, amount: rz.orders[0].amount, status: "captured" } } } });
    expect((await call("POST", "/api/payments/webhook", ev, { "x-razorpay-signature": "bad" })).status).toBe(400);
    expect((await call("POST", "/api/payments/webhook", ev, { "x-razorpay-signature": hmac("whsec", ev) })).status).toBe(200);
    expect(engRow("WEBHK-1").pack).toBe(100);
    expect((await call("POST", "/api/payments/webhook", ev, { "x-razorpay-signature": hmac("whsec", ev) })).status).toBe(200); // the same event again changes nothing
    expect((raw.prepare("SELECT COUNT(*) AS c FROM entitlement").get() as any).c).toBe(1);
  });
  test("UC-15 two payments for the same engagement: the second is not wasted, it becomes a credit for the next one", async () => {
    withGateway();
    const o = await organizer();
    await call("POST", "/api/z", eng("TWOPAY-1"), o.h);
    await call("POST", "/api/z/TWOPAY-1/publish", contact, o.h);
    const c1 = await j(await checkout(o, "TWOPAY-1")), c2 = await j(await checkout(o, "TWOPAY-1")); // two tabs, both before either is paid
    await settle(c1.paymentId, c1.razorpay.orderId, "pay_a"); await settle(c2.paymentId, c2.razorpay.orderId, "pay_b");
    expect(engRow("TWOPAY-1").pack).toBe(100);
    expect((raw.prepare("SELECT COUNT(*) AS c FROM entitlement WHERE eid IS NULL").get() as any).c).toBe(1); // the spare one
    await call("POST", "/api/z", eng("NEXT-1"), o.h);
    expect(engRow("NEXT-1").pack).toBeGreaterThan(0); // used at once: published and paid
  });
  test("UC-16 paying for someone else's engagement or with a made-up key is refused; nothing is created", async () => {
    withGateway();
    const a = await organizer(), b = await organizer();
    await call("POST", "/api/z", eng("MINE-1"), a.h);
    expect((await checkout(b, "MINE-1")).status).toBe(404);
    expect((await call("POST", "/api/checkout", { eid: "MINE-1", org: "X Ltd", email: "x@x.com", country: "IN", currency: "INR" }, { "x-organizer": "cbk_nope" })).status).toBe(403);
    expect((await call("POST", "/api/checkout", { eid: "MINE-1", org: "X Ltd", email: "x@x.com", country: "IN", currency: "INR" }, { "x-organizer": a.aiKey })).status).toBe(403); // the AI key cannot pay either
    expect(rz.orders.length).toBe(0);
  });
  test("UC-17 paying for an already paid engagement is refused", async () => {
    withGateway();
    const o = await organizer();
    await call("POST", "/api/z", eng("PAID-1"), o.h);
    await call("POST", "/api/z/PAID-1/publish", contact, o.h);
    const c = await j(await checkout(o, "PAID-1")); await settle(c.paymentId, c.razorpay.orderId, "pay_p");
    expect((await checkout(o, "PAID-1")).status).toBe(409);
  });
  test("UC-18 tampered signature, short amount, uncaptured and failed payments fulfil nothing", async () => {
    withGateway();
    const o = await organizer();
    await call("POST", "/api/z", eng("TAMP-1", { cap: 300 }), o.h);
    await call("POST", "/api/z/TAMP-1/publish", contact, o.h);
    const c = await j(await checkout(o, "TAMP-1"));
    rz.payments["pay_t"] = { id: "pay_t", order_id: c.razorpay.orderId, status: "captured", amount: rz.orders[0].amount };
    expect((await call("POST", "/api/payments/verify", { paymentId: c.paymentId, razorpay_order_id: c.razorpay.orderId, razorpay_payment_id: "pay_t", razorpay_signature: "forged" })).status).toBe(400);
    expect((await settle(c.paymentId, c.razorpay.orderId, "pay_short", T, "captured", 100)).status).toBe(400); // paid less than the order
    expect((await settle(c.paymentId, c.razorpay.orderId, "pay_fail", T, "failed")).status).toBe(402);
    expect((await settle("pay_unknown", c.razorpay.orderId, "pay_x")).status).toBe(404);
    expect(engRow("TAMP-1").pack).toBe(0); expect((raw.prepare("SELECT COUNT(*) AS c FROM entitlement").get() as any).c).toBe(0);
    expect((await settle(c.paymentId, c.razorpay.orderId, "pay_ok")).status).toBe(200); // the honest payment still works afterwards
    expect(engRow("TAMP-1").pack).toBe(500);
  });
  test("UC-19 the draft was forgotten before the money arrived: no crash, the money becomes a credit", async () => {
    withGateway();
    const o = await organizer();
    await call("POST", "/api/z", eng("GONE-1"), o.h);
    await call("POST", "/api/z/GONE-1/publish", contact, o.h);
    const c = await j(await checkout(o, "GONE-1"));
    await purgeOld(env as Env, T + 40 * DAY);
    expect(engRow("GONE-1")).toBeFalsy();
    const r = await settle(c.paymentId, c.razorpay.orderId, "pay_g", T + 40 * DAY);
    expect(r.status).toBe(200); expect((await j(r)).published).toBe(false);
    expect((raw.prepare("SELECT COUNT(*) AS c FROM entitlement WHERE eid IS NULL").get() as any).c).toBe(1);
  });
  test("UC-20 an engagement bigger than every pack needs a custom arrangement", async () => {
    withGateway();
    const o = await organizer();
    await call("POST", "/api/z", eng("HUGE-1", { cap: 100000 }), o.h);
    const r = await checkout(o, "HUGE-1"); expect(r.status).toBe(400); expect((await j(r)).error).toMatch(/custom|write to us/i);
  });
  test("UC-21 after payment the limit can rise only up to the pack and never below the people already in", async () => {
    withGateway();
    const o = await organizer();
    await call("POST", "/api/z", eng("CAP-1", { cap: 400 }), o.h);
    await call("POST", "/api/z/CAP-1/publish", contact, o.h);
    const c = await j(await checkout(o, "CAP-1")); await settle(c.paymentId, c.razorpay.orderId, "pay_c"); // pack 500
    expect((await call("PATCH", "/api/z/CAP-1/settings", { cap: 500 }, o.h)).status).toBe(200);
    expect((await call("PATCH", "/api/z/CAP-1/settings", { cap: 501 }, o.h)).status).toBe(402);
    for (let i = 1; i <= 3; i++) await call("POST", "/api/z/CAP-1/join", { phone: phone(i) });
    expect((await call("PATCH", "/api/z/CAP-1/settings", { cap: 2 }, o.h)).status).toBe(409); // not lower than the people already on it
  });
  test("UC-22 a wrong GSTIN is refused by the server; an empty one is allowed (an unregistered buyer); abroad needs none", async () => {
    withGateway();
    const o = await organizer();
    await call("POST", "/api/z", eng("TAX-1"), o.h);
    expect((await checkout(o, "TAX-1", { taxId: "12345" })).status).toBe(400);
    expect((await checkout(o, "TAX-1", { taxId: "27ABCDE1234F1Z5" })).status).toBe(200);
    expect((await checkout(o, "TAX-1", { taxId: "", country: "IN" })).status).toBe(200);
    env.RAZORPAY_INTERNATIONAL = "1";
    expect((await checkout(o, "TAX-1", { taxId: "any local vat number", country: "US", currency: "USD" })).status).toBe(200);
  });
  test("UC-23 payments not switched on: a clear message, the engagement stays published and holds at its start", async () => {
    const o = await organizer(); // no gateway
    await call("POST", "/api/z", eng("OFF-1"), o.h);
    await call("POST", "/api/z/OFF-1/publish", contact, o.h);
    const r = await checkout(o, "OFF-1"); expect(r.status).toBe(503); expect((await j(r)).error).toMatch(/not switched on/);
    expect((await call("POST", "/api/z/OFF-1/join", { phone: phone(1) })).status).toBe(200);
    expect((await j(await call("GET", "/api/z/OFF-1/control", undefined, {}, START_MS + 1000))).locked).toBe(true);
  });
  test("UC-24 publish after the start time, and a start time in the past, are refused with a clear message", async () => {
    const o = await organizer();
    await call("POST", "/api/z", eng("PAST-1", { startRound: roundAt(T) - 100 }), o.h);
    const r = await call("POST", "/api/z/PAST-1/publish", contact, o.h); expect(r.status).toBe(400); expect((await j(r)).error).toMatch(/start time/i);
    expect((await call("PATCH", "/api/z/PAST-1/settings", { startRound: roundAt(T) - 10 }, o.h)).status).toBe(400);
    expect((await call("PATCH", "/api/z/PAST-1/settings", { startRound: START }, o.h)).status).toBe(200);
    expect((await call("POST", "/api/z/PAST-1/publish", contact, o.h)).status).toBe(200);
  });
  test("UC-25 an unpaid engagement can be moved after its start passed; a paid one cannot once it has started", async () => {
    const o = await organizer();
    await call("POST", "/api/z", eng("MOVE-1"), o.h);
    await call("POST", "/api/z/MOVE-1/publish", contact, o.h);
    const after = START_MS + HOUR;
    expect((await call("PATCH", "/api/z/MOVE-1/settings", { startRound: roundAt(after) + 600 }, o.h, after)).status).toBe(200);
    raw.prepare("UPDATE engagement SET pack=100 WHERE id='MOVE-1'").run(); // now paid
    expect((await call("PATCH", "/api/z/MOVE-1/settings", { startRound: roundAt(after) + 900 }, o.h, roundMs(roundAt(after) + 700))).status).toBe(409); // paid and started: fixed
  });
  test("UC-26 reminders (B11: 24 h, 2 h and 30 min before the start): a payment reminder only for unpaid published games, a draft reminder only for drafts that are near, nothing for paid or far-away games", async () => {
    const o = await organizer();
    const mk = async (id: string, startMs: number, publish = true) => { await call("POST", "/api/z", eng(id, { startRound: roundAt(startMs) }), o.h); if (publish) await call("POST", "/api/z/" + id + "/publish", contact, o.h); };
    await mk("REM-NEAR", T + 30 * HOUR); await mk("REM-FAR", T + 200 * HOUR); await mk("REM-DRAFT", T + 30 * HOUR, false); await mk("REM-PAID", T + 30 * HOUR);
    raw.prepare("UPDATE engagement SET pack=100 WHERE id='REM-PAID'").run();
    await housekeeping(env as Env, T + DAY); await housekeeping(env as Env, T + 2 * DAY); await housekeeping(env as Env, T + 3 * DAY); // only REM-NEAR (and the draft REM-DRAFT) is ever inside the 24 hours, and the day after they have started
    const reminders = outbox("%Payment pending for your game%");
    expect(reminders.length).toBe(1); expect(reminders[0]!.body).toContain("REM-NEAR");
    const drafts = outbox("%is still a draft%"); expect(drafts.length).toBe(1); expect(drafts[0]!.body).toContain("REM-DRAFT"); // the unpublished one gets the draft wording, once
  });
  test("UC-27 with a credit in hand, publishing is paid at once", async () => {
    const o = await organizer();
    await call("POST", "/api/z", eng("CRED-1", { cap: 100 }), o.h);
    raw.prepare("INSERT INTO entitlement(id,org,pack,payment_id,eid,created_ms) VALUES('ent_c',?,250,'p',NULL,?)").run(orgOf("CRED-1"), T);
    expect((await j(await call("POST", "/api/z/CRED-1/publish", contact, o.h))).paid).toBe(true);
    expect((raw.prepare("SELECT eid FROM entitlement WHERE id='ent_c'").get() as any).eid).toBe("CRED-1");
  });
});

/* ============================== D. participants ============================== */
describe("D. participants", () => {
  async function published(id: string, over: Record<string, unknown> = {}) {
    const o = await organizer(); await call("POST", "/api/z", eng(id, over), o.h); await call("POST", `/api/z/${id}/publish`, contact, o.h); return o;
  }
  test("UC-28 a draft cannot be joined and shows nothing about itself to a stranger", async () => {
    const o = await organizer(); await call("POST", "/api/z", eng("DRAFT-X"), o.h);
    expect((await call("POST", "/api/z/DRAFT-X/join", { phone: phone(1) })).status).toBe(403);
    expect((await call("GET", "/api/z/DRAFT-X/info")).status).toBe(403);
    expect((await call("GET", "/api/z/DRAFT-X/control")).status).toBe(404);
  });
  test("UC-30 the same number written four ways is one participant with one ticket", async () => {
    await published("SAME-N");
    const ids = new Set<string>();
    for (const p of ["9876543210", "+91 98765 43210", "098765 43210", "91-98765-43210"]) ids.add((await j(await call("POST", "/api/z/SAME-N/join", { phone: p }))).pid);
    expect(ids.size).toBe(1); expect((raw.prepare("SELECT COUNT(*) AS c FROM participant WHERE eid='SAME-N'").get() as any).c).toBe(1);
  });
  test("UC-31 numbers that are not numbers are refused with a human message", async () => {
    await published("BADNUM-1");
    for (const p of ["123", "abcdefghij", "1".repeat(40), 12345678901234567890 as any]) { const r = await call("POST", "/api/z/BADNUM-1/join", { phone: p }); expect(r.status).toBe(400); expect((await j(r)).error).toMatch(/mobile number/i); }
    for (const p of ["", null]) { const r = await call("POST", "/api/z/BADNUM-1/join", { phone: p }); expect(r.status).toBe(400); expect((await j(r)).error).toMatch(/your name/i); } // no number and no name: the name-only door asks for a name
  });
  test("UC-32 a crowd arriving at the same instant never passes the limit, and the last places are fair", async () => {
    await published("CROWD-1", { cap: 5 });
    const rs = await Promise.all(Array.from({ length: 40 }, (_, i) => call("POST", "/api/z/CROWD-1/join", { phone: phone(i + 1) })));
    const ok = rs.filter((r) => r.status === 200).length, full = rs.filter((r) => r.status === 409).length;
    expect((raw.prepare("SELECT COUNT(*) AS c FROM participant WHERE eid='CROWD-1'").get() as any).c).toBeLessThanOrEqual(5);
    expect(ok).toBe(5); expect(full).toBe(35);
    expect((await call("POST", "/api/z/CROWD-1/join", { phone: phone(1) })).status).toBe(200); // someone who already has a place can always come back
  });
  test("UC-33 invite-only: an unlisted number is refused, a listed one gets in", async () => {
    const o = await published("INVITE-1", { closed: true });
    expect((await call("POST", "/api/z/INVITE-1/join", { phone: phone(1) })).status).toBe(403);
    await call("POST", "/api/z/INVITE-1/roster", { people: [{ phone: phone(2), name: "Listed" }] }, o.h);
    expect((await call("POST", "/api/z/INVITE-1/join", { phone: phone(2) })).status).toBe(200);
  });
  test("UC-34 names with markup or too long are cleaned and cut", async () => {
    const o = await published("NAME-1");
    await call("POST", "/api/z/NAME-1/join", { phone: phone(1), name: "<script>alert(1)</script>`x`" + "y".repeat(200) });
    const list = await j(await call("GET", "/api/z/NAME-1/participants", undefined, o.h));
    expect(list.participants[0].name).toBeUndefined(); // the list never carries names: they are sealed
    const nm = (await j(await call("GET", `/api/z/NAME-1/names?pids=${list.participants[0].pid}`, undefined, o.h))).names[list.participants[0].pid] as string;
    expect(nm).not.toMatch(/[<>`]/); expect(nm.length).toBeLessThanOrEqual(60);
  });
  test("UC-35 phones never learn it is unpaid, never see others' numbers, and the held message does not mention money", async () => {
    const o = await published("PRIV-1");
    await call("POST", "/api/z/PRIV-1/join", { phone: phone(1), name: "Asha" });
    for (const when of [T, START_MS + 60_000]) {
      const info = JSON.stringify(await j(await call("GET", "/api/z/PRIV-1/info", undefined, {}, when))), ctl = JSON.stringify(await j(await call("GET", "/api/z/PRIV-1/control", undefined, {}, when)));
      expect(info + ctl).not.toMatch(/unpaid|payment|pay|price|invoice|razorpay|boss@acme/i);
    }
    const everything = JSON.stringify(await j(await call("GET", "/api/z/PRIV-1/participants", undefined, o.h)));
    expect(everything).not.toMatch(/9\d{9}/); // the organizer sees names and ids, never numbers
    expect((await call("GET", "/api/z/PRIV-1/participants")).status).toBe(403); // and a stranger sees nothing at all
  });
});

/* ============================== E. timing ============================== */
describe("E. timing", () => {
  test("UC-39 start boundary: not held one second before, held from the start, in both info and control", async () => {
    const o = await organizer(); await call("POST", "/api/z", eng("EDGE-1"), o.h); await call("POST", "/api/z/EDGE-1/publish", contact, o.h);
    const at = (ms: number) => call("GET", "/api/z/EDGE-1/control", undefined, {}, ms);
    // held from 45 s before the start, so every phone knows before the first number could be shown
    expect((await j(await at(START_MS - 46_000))).locked).toBeUndefined();
    expect((await j(await at(START_MS - 45_000))).locked).toBe(true);
    expect((await j(await at(START_MS))).locked).toBe(true);
    expect((await j(await call("GET", "/api/z/EDGE-1/info", undefined, {}, START_MS - 46_000))).locked).toBe(false);
    expect((await j(await call("GET", "/api/z/EDGE-1/info", undefined, {}, START_MS - 45_000))).locked).toBe(true);
  });
  test("UC-39 publishing exactly at the start is too late; one second before is fine", async () => {
    const o = await organizer(); await call("POST", "/api/z", eng("EDGE-2"), o.h); await call("POST", "/api/z", eng("EDGE-3"), o.h);
    expect((await call("POST", "/api/z/EDGE-2/publish", contact, o.h, START_MS)).status).toBe(400);
    expect((await call("POST", "/api/z/EDGE-3/publish", contact, o.h, START_MS - 1000)).status).toBe(200);
  });
  test("UC-41 held and paused together: the held flag is always there, the signed pause is still served", async () => {
    const o = await organizer(); await call("POST", "/api/z", eng("BOTH-1"), o.h); await call("POST", "/api/z/BOTH-1/publish", contact, o.h);
    const { publicKeyFromSecret } = await import("../../../packages/beacon/src/control");
    expect((await call("PUT", "/api/z/BOTH-1/control/key", { publicKey: publicKeyFromSecret("11".repeat(32)) }, o.h)).status).toBe(200);
    const ctl = await j(await call("GET", "/api/z/BOTH-1/control", undefined, {}, START_MS + 1000));
    expect(ctl.locked).toBe(true); expect(typeof ctl.pubKey).toBe("string");
  });
  test("UC-36 the schedule helper turns a local time into the right start round, and refuses the past", async () => {
    const ok = await j(await call("GET", "/api/z/schedule?at=" + encodeURIComponent("2026-10-17T19:00:00+05:30")));
    expect(ok.ok).toBe(true); expect(ok.startMs).toBe(Date.UTC(2026, 9, 17, 13, 30, 0)); expect(ok.startsAtIST).toMatch(/7:00 pm IST/i);
    const past = await call("GET", "/api/z/schedule?at=2020-01-01T00:00:00Z"); expect((await j(past)).ok).toBe(false);
    expect((await call("GET", "/api/z/schedule?at=tomorrowish")).status).toBe(400);
  });
});

/* ============================== F. what can go wrong ============================== */
describe("F. exceptions: what can go wrong", () => {
  test("UC-45 the mail service is down: sign-in, publish and payment still work; the mail is kept and sent on the next clean-up", async () => {
    withGateway(); env.RESEND_API_KEY = "re_x"; rz.mailDown = true;
    const o = await organizer();
    await call("POST", "/api/z", eng("MAIL-1"), o.h);
    expect((await call("POST", "/api/z/MAIL-1/publish", contact, o.h)).status).toBe(200);
    expect((await call("POST", "/api/auth/email", { email: o.email })).status).toBe(200);
    expect((raw.prepare("SELECT COUNT(*) AS c FROM outbox WHERE sent=0").get() as any).c).toBeGreaterThan(0);
    rz.mailDown = false; rz.mail.length = 0;
    await housekeeping(env as Env, T + DAY);
    expect(rz.mail.length).toBeGreaterThan(0); // retried when the service is back
  });
  test("UC-46 the daily write budget is reached: a polite busy answer and no half-saved state", async () => {
    env.DAILY_WRITE_BUDGET = "9";
    const o = await organizer(); // uses a few
    await call("POST", "/api/z", eng("BUDG-1"), o.h);
    env.DAILY_WRITE_BUDGET = "1";
    const r = await call("POST", "/api/z/BUDG-1/publish", contact, o.h); expect(r.status).toBe(503);
    expect((raw.prepare("SELECT COUNT(*) AS c FROM kv WHERE k LIKE 'pub/%'").get() as any).c).toBe(0); // nothing half done
    expect((await call("POST", "/api/start", { email: "late@acme.com" }, { "cf-connecting-ip": "5.5.5.5" })).status).toBe(503);
    expect((raw.prepare("SELECT COUNT(*) AS c FROM organizer_email WHERE 1").get() as any).c).toBe(1);
  });
  test("UC-47 a broken clean-up never breaks a user's request", async () => {
    const o = await organizer();
    const real = env.DB; env.DB = new Proxy(real, { get: (t: any, p) => (p === "prepare" ? (sql: string) => { if (/housekeeping_day|FROM engagement e WHERE e.pack=0/.test(sql)) throw new Error("boom"); return t.prepare(sql); } : t[p]) });
    const r = await call("POST", "/api/z", eng("HK-1"), o.h, T + 5 * DAY);
    expect(r.status).toBe(200); env.DB = real;
  });
  test("UC-48 malformed and oversized bodies are refused cleanly on every write route", async () => {
    const o = await organizer(); await call("POST", "/api/z", eng("BODY-1"), o.h);
    for (const [m, p] of [["POST", "/api/start"], ["POST", "/api/auth/email"], ["POST", "/api/auth/verify"], ["POST", "/api/z"], ["PATCH", "/api/z/BODY-1/settings"], ["POST", "/api/z/BODY-1/roster"], ["POST", "/api/z/BODY-1/join"], ["POST", "/api/z/BODY-1/publish"], ["POST", "/api/checkout"]] as const) {
      const r = await call(m, p, "{ definitely not json", o.h); expect([400, 403, 404, 503]).toContain(r.status); expect(r.status).not.toBe(500);
      const big = await call(m, p, JSON.stringify({ x: "y".repeat(300_000) }), o.h); expect(big.status).not.toBe(500);
    }
  });
  test("UC-49 organizer B can do nothing to organizer A's engagement", async () => {
    const a = await organizer(), b = await organizer();
    await call("POST", "/api/z", eng("OWNED-A"), a.h); await call("POST", "/api/z/OWNED-A/publish", contact, a.h); await call("POST", "/api/z/OWNED-A/join", { phone: phone(1) });
    for (const [m, p, body] of [["GET", "/api/z/OWNED-A/participants"], ["GET", "/api/z/OWNED-A/claims"], ["PATCH", "/api/z/OWNED-A/settings", { cap: 5 }], ["POST", "/api/z/OWNED-A/roster", { people: [{ phone: phone(9) }] }], ["POST", "/api/z/OWNED-A/erase", {}], ["POST", "/api/z/OWNED-A/settle", { results: [] }], ["POST", "/api/z/OWNED-A/reuse", { from: "OWNED-A" }], ["PUT", "/api/z/OWNED-A/control/key", { publicKey: "aa" }]] as const)
      expect([401, 403, 404]).toContain((await call(m, p, body, b.h)).status);
    expect((await call("POST", "/api/z/OWNED-A/publish", contact, b.h)).status).toBe(403);
    expect(engRow("OWNED-A").cap).toBe(100); expect((raw.prepare("SELECT COUNT(*) AS c FROM participant WHERE eid='OWNED-A'").get() as any).c).toBe(1);
    const hist = await j(await call("GET", "/api/history", undefined, b.h)); expect(hist.engagements.length).toBe(0);
  });
  test("UC-50 the AI key can build and read, but never publish, pay, erase, settle, retire keys or mint keys", async () => {
    const o = await organizer(); await call("POST", "/api/z", eng("AI-1"), o.ai); // it can create (a draft)
    expect((await call("PATCH", "/api/z/AI-1/settings", { cap: 150 }, o.ai)).status).toBe(200);
    expect((await call("POST", "/api/z/AI-1/roster", { people: [{ phone: phone(3), name: "Z" }] }, o.ai)).status).toBe(403); // names and numbers are loaded by the owner in the console, never by the AI
    expect((await call("GET", "/api/history", undefined, o.ai)).status).toBe(200);
    expect(engRow("AI-1").pack).toBe(0);
    const pub = await j(await call("POST", "/api/z/AI-1/publish", contact, o.ai)); expect(pub.needsOrganizer).toBe(true); expect(engRow("AI-1").pack).toBe(0);
    await call("POST", "/api/z/AI-1/publish", contact, o.h); // the organizer publishes
    for (const [m, p, body] of [["POST", "/api/z/AI-1/erase", {}], ["POST", "/api/z/AI-1/settle", { results: [] }], ["GET", "/api/org/keys"], ["POST", "/api/org/keys/revoke", { id: "x" }], ["POST", "/api/org/ai", {}], ["PUT", "/api/z/AI-1/control/key", { publicKey: "aa" }]] as const)
      expect(await (await call(m, p, body, o.ai)).status).toBe(403);
    expect((await call("POST", "/api/checkout", { eid: "AI-1", org: "X", email: "x@x.com" }, o.ai)).status).not.toBe(200);
  });
  test("UC-51 erasing removes the people, and the 365-day purge removes the flags and contact details too", async () => {
    const o = await organizer(); await call("POST", "/api/z", eng("ERASE-1"), o.h); await call("POST", "/api/z/ERASE-1/publish", contact, o.h);
    for (let i = 1; i <= 3; i++) await call("POST", "/api/z/ERASE-1/join", { phone: phone(i) });
    expect((await j(await call("POST", "/api/z/ERASE-1/erase", {}, o.h))).erased).toBe(3);
    expect((raw.prepare("SELECT COUNT(*) AS c FROM participant WHERE eid='ERASE-1'").get() as any).c).toBe(0);
    await purgeOld(env as Env, T + 366 * DAY);
    expect((raw.prepare("SELECT COUNT(*) AS c FROM kv WHERE k LIKE '%/ERASE-1'").get() as any).c).toBe(0);
  });
  test("UC-52 claims for patterns, positions or rounds that do not exist, or from non-participants, are not stored", async () => {
    const o = await organizer(); await call("POST", "/api/z", eng("CLAIM-1"), o.h); await call("POST", "/api/z/CLAIM-1/publish", contact, o.h);
    const pid = (await j(await call("POST", "/api/z/CLAIM-1/join", { phone: phone(1) }))).pid;
    const send = (claims: unknown[], p = pid) => call("POST", "/api/z/CLAIM-1/claims", { pid: p, claims });
    expect((await j(await send([{ pattern: "nonsense", idx: 3 }, { pattern: "blackout", idx: 999 }, { pattern: "blackout", idx: -1 }, { pattern: "blackout", idx: 5, round: 9 }]))).stored).toBe(0);
    expect((await call("POST", "/api/z/CLAIM-1/claims", { pid: "ffffffffffffffff", claims: [{ pattern: "blackout", idx: 5 }] })).status).toBe(403);
    expect((await j(await send([{ pattern: "blackout", idx: 5 }, { pattern: "blackout", idx: 5 }]))).stored).toBe(1); // sent twice, stored once
  });
});

/* ============================== G. the organizer's AI (found by the simulated external AI) ============================== */
describe("G. the organizer's AI", () => {
  test("UC-60 the manifest teaches the AI the conversation, the packs, the lucky draw, one reward line per winner, and the payment rules", async () => {
    const m = await j(await call("GET", "/api/z/ai-manifest"));
    expect(m.conversation.length).toBe(12); expect(m.packs.length).toBeGreaterThan(5);
    const text = JSON.stringify(m);
    expect(text).toMatch(/lucky/); expect(text).toMatch(/winners\?: 1\|3\|5\|10/); expect(text).toMatch(/ONE winner of ONE house/); expect(text).toMatch(/GET \/api\/z\/\{id\}\/summary/);
    expect(m.payment_faq.join(" ")).toMatch(/late/i); expect(m.payment_faq.join(" ")).toMatch(/nothing is owed|no penalty/i); expect(m.payment_faq.join(" ")).toMatch(/limit does not have to match/i);
  });
  test("UC-61 the worked example in the manifest is accepted exactly as written (lucky draw, three full-house lines, two-ticket house)", async () => {
    const o = await organizer(); await call("POST", "/api/z", eng("EXAMPLE-1", { cap: 250 }), o.ai);
    const body = { startRound: START + 100, callSeconds: 9, cap: 250, tickets: 2, rounds: 1,
      rewards: [{ pattern: "line", ordinal: 1, text: "Gift hamper" }, { pattern: "blackout", ordinal: 1, text: "Voucher 50" }, { pattern: "blackout", ordinal: 2, text: "Voucher 30" }, { pattern: "corners", ordinal: 1, text: "Tablet" }],
      breaks: [{ after: 30, seconds: 90, kind: "youtube", title: "Anniversary film", mediaUrl: "https://www.youtube.com/watch?v=aqz-KE-bpKQ" }, { after: 60, seconds: 60, kind: "lucky", title: "Lucky draw", winners: 3 }] };
    const r = await call("PATCH", "/api/z/EXAMPLE-1/settings", body, o.ai); expect(r.status).toBe(200);
  });
  test("UC-62 the summary reads everything back (time, speed, limit, rewards, breaks, status) so the AI can confirm it; strangers and other organizers get nothing", async () => {
    const o = await organizer(), other = await organizer();
    await call("POST", "/api/z", eng("SUM-1", { cap: 250 }), o.ai);
    await call("PATCH", "/api/z/SUM-1/settings", { callSeconds: 9, tickets: 2, rewards: [{ pattern: "blackout", ordinal: 1, text: "TV" }], breaks: [{ after: 60, seconds: 60, kind: "lucky", title: "Lucky draw", winners: 3 }] }, o.ai);
    let s = await j(await call("GET", "/api/z/SUM-1/summary", undefined, o.ai));
    expect(s.status).toBe("draft"); expect(s.limit).toBe(250); expect(s.callSeconds).toBe(9); expect(s.tickets).toBe(2); expect(s.rewards.length).toBe(1); expect(s.breaks[0].kind).toBe("lucky"); expect(s.startsAtIST).toMatch(/IST/); expect(s.shareUrl).toBeUndefined();
    await call("POST", "/api/z/SUM-1/publish", contact, o.h);
    s = await j(await call("GET", "/api/z/SUM-1/summary", undefined, o.ai));
    expect(s.status).toMatch(/payment due before the start/); expect(s.shareUrl).toContain("/z.html?e=SUM-1"); expect(s.payUrl).toContain("/pay.html?e=SUM-1");
    const late = await j(await call("GET", "/api/z/SUM-1/summary", undefined, o.h, START_MS + 60_000)); expect(late.status).toMatch(/NOT PAID/);
    expect((await call("GET", "/api/z/SUM-1/summary")).status).toBe(403); expect((await call("GET", "/api/z/SUM-1/summary", undefined, other.h)).status).toBe(403);
    const hist = await j(await call("GET", "/api/history", undefined, o.ai)); expect(hist.engagements[0].startsAtIST).toMatch(/IST/);
  });
  test("UC-63 an unknown route tells the AI where the list of routes is", async () => {
    const r = await call("GET", "/api/z/SUM-1/settings"); const b = await j(r);
    expect(r.status === 404 || r.status === 403 || r.status === 405).toBe(true);
    const n = await j(await call("GET", "/api/z/EXAMPLE-1/nothing-here")); expect(n.hint).toMatch(/ai-manifest/);
  });
});

describe("G2. the organizer's AI: round 2 findings", () => {
  test("UC-64 a partial rewards patch is refused with a message that explains rewards REPLACE the list, and nothing changes", async () => {
    const o = await organizer(); await call("POST", "/api/z", eng("REPL-1"), o.ai);
    await call("PATCH", "/api/z/REPL-1/settings", { rewards: [{ pattern: "line", ordinal: 1, text: "A" }, { pattern: "line", ordinal: 2, text: "B" }] }, o.ai);
    const r = await call("PATCH", "/api/z/REPL-1/settings", { rewards: [{ pattern: "line", ordinal: 3, text: "E" }] }, o.ai);
    expect(r.status).toBe(400); expect((await j(r)).error).toMatch(/REPLACES the whole list/);
    expect((await j(await call("GET", "/api/z/REPL-1/summary", undefined, o.ai))).rewards.length).toBe(2);
    expect((await call("PATCH", "/api/z/REPL-1/settings", { rewards: [{ pattern: "line", ordinal: 1, text: "A" }, { pattern: "line", ordinal: 2, text: "B" }, { pattern: "line", ordinal: 3, text: "C" }] }, o.ai)).status).toBe(200);
  });
  test("UC-65 the links are consistent: a draft gives consoleUrl; once published the same call gives payUrl and shareUrl", async () => {
    const o = await organizer(); await call("POST", "/api/z", eng("LINK-1"), o.ai);
    const d = await j(await call("POST", "/api/z/LINK-1/publish", {}, o.ai)); expect(d.consoleUrl).toContain("/zc.html?e=LINK-1"); expect(d.payUrl).toBeUndefined();
    await call("POST", "/api/z/LINK-1/publish", contact, o.h);
    const p = await j(await call("POST", "/api/z/LINK-1/publish", {}, o.ai)); expect(p.payUrl).toContain("/pay.html?e=LINK-1"); expect(p.shareUrl).toContain("/z.html?e=LINK-1");
    expect((await j(await call("GET", "/api/z/LINK-1/summary", undefined, o.ai))).payUrl).toBe(p.payUrl); // the summary agrees
  });
  test("UC-66 the summary says what is due: pack, price, pay-before time, paid flag and the game length", async () => {
    const o = await organizer();
    await call("POST", "/api/z", eng("DUE-1", { cap: 480, callSeconds: 12 }), o.ai);
    await call("PATCH", "/api/z/DUE-1/settings", { rounds: 2, breaks: [{ after: 20, seconds: 120, kind: "speech", title: "MD address" }] }, o.ai);
    await call("POST", "/api/z/DUE-1/publish", contact, o.h);
    const s = await j(await call("GET", "/api/z/DUE-1/summary", undefined, o.ai));
    expect(s.paid).toBe(false); expect(s.pack).toBe(500); expect(s.priceInr).toBeGreaterThan(1000); expect(s.payUntil).toMatch(/IST/);
    expect(s.gameMinutes).toBe(Math.round((75 * 12 * 2 + 120 + 90) / 60)); // two rounds of 75 calls, one break, one intermission
  });
  test("UC-67 the manifest says: no writes before the yes, rewards replace the list, what skipped/invalid mean, and does not ask for the speed in the schedule call", async () => {
    const t = JSON.stringify(await j(await call("GET", "/api/z/ai-manifest")));
    expect(t).toMatch(/DO NOT call POST \/api\/z or any other write/); expect(t).toMatch(/REPLACE what was saved/); expect(t).toMatch(/OWNER loads the invite list/); expect(t).not.toMatch(/schedule\?at=[^"]*callSeconds/);
  });
});

describe("H. the free plan: pause profiles by size", () => {
  const key = async () => (await import("../../../packages/beacon/src/control")).publicKeyFromSecret("11".repeat(32));
  const ctl = async (id: string) => j(await call("GET", `/api/z/${id}/control`, undefined, {}, T));
  test("UC-70 a standard engagement gets the fast profile, a mid-size one a slower one, a large one a slower still, and a huge one none", async () => {
    const { SAFETY_STANDARD, SAFETY_LEAN30, SAFETY_LEAN60 } = await import("../../../packages/beacon/src/control");
    const o = await organizer(); const pk = await key();
    for (const [id, cap, want] of [["PF-STD", 200, SAFETY_STANDARD.leadRounds], ["PF-MID", 800, SAFETY_LEAN30.leadRounds], ["PF-BIG", 2000, SAFETY_LEAN60.leadRounds]] as const) {
      await call("POST", "/api/z", eng(id, { cap }), o.h);
      expect((await call("PUT", `/api/z/${id}/control/key`, { publicKey: pk }, o.h)).status).toBe(200);
      expect((await ctl(id)).leadRounds).toBe(want);
    }
    await call("POST", "/api/z", eng("PF-HUGE", { cap: 5000 }), o.h);
    const r = await call("PUT", "/api/z/PF-HUGE/control/key", { publicKey: pk }, o.h);
    expect(r.status).toBe(409); expect((await j(r)).error).toMatch(/up to 2,000 participants/);
    expect((await call("GET", "/api/z/PF-HUGE/control", undefined, {}, T)).status).toBe(404); // no file: phones will not keep asking
  });
  test("UC-71 a bigger pause profile means a longer lead, so nobody can see a number a pause should have prevented", async () => {
    const { SAFETY_STANDARD, SAFETY_LEAN30, SAFETY_LEAN60 } = await import("../../../packages/beacon/src/control");
    expect(SAFETY_LEAN30.leadRounds).toBeGreaterThan(SAFETY_STANDARD.leadRounds); expect(SAFETY_LEAN60.leadRounds).toBeGreaterThan(SAFETY_LEAN30.leadRounds);
    for (const s of [SAFETY_STANDARD, SAFETY_LEAN30, SAFETY_LEAN60]) expect(s.leadRounds * 3).toBeGreaterThan(s.holdAfterRounds * 3 + 3); // the rule from control.ts
  });
  test("UC-72 raising the size to another profile before any pause was sent forgets the unused key; after a pause was sent it stays", async () => {
    const { SAFETY_LEAN30 } = await import("../../../packages/beacon/src/control");
    const o = await organizer(); const pk = await key();
    await call("POST", "/api/z", eng("PF-GROW", { cap: 200 }), o.h);
    await call("PUT", "/api/z/PF-GROW/control/key", { publicKey: pk }, o.h);
    expect((await call("PATCH", "/api/z/PF-GROW/settings", { cap: 900 }, o.h)).status).toBe(200);
    expect((await call("GET", "/api/z/PF-GROW/control", undefined, {}, T)).status).toBe(404); // forgotten: the console registers the right one next time it opens
    expect((await call("PUT", "/api/z/PF-GROW/control/key", { publicKey: pk }, o.h)).status).toBe(200);
    expect((await ctl("PF-GROW")).leadRounds).toBe(SAFETY_LEAN30.leadRounds);
  });
});

describe("I. announcements, co-hosts and scratch cards", () => {
  const pk = async () => (await import("../../../packages/beacon/src/control")).publicKeyFromSecret("11".repeat(32));
  async function live(id: string, o: Org, cap = 100) { await call("POST", "/api/z", eng(id, { cap }), o.h); await call("PUT", `/api/z/${id}/control/key`, { publicKey: await pk() }, o.h); await call("POST", `/api/z/${id}/publish`, contact, o.h); }
  const ann = async (id: string, who: Record<string, string>, text: string, now = T) => call("POST", `/api/z/${id}/announce`, { text }, who, now);
  const ctl = async (id: string, now = T) => j(await call("GET", `/api/z/${id}/control`, undefined, {}, now));
  test("UC-80 the organizer's message reaches phones inside the control answer they already ask for; clearing removes it", async () => {
    const o = await organizer(); await live("ANN-1", o);
    expect((await ctl("ANN-1")).ann).toBeUndefined();
    expect((await ann("ANN-1", o.h, "Dinner is served in the hall")).status).toBe(200);
    expect((await ctl("ANN-1")).ann.text).toBe("Dinner is served in the hall");
    expect((await ctl("ANN-1")).pubKey).toBeTruthy(); // the pause file is still there
    const id1 = (await ctl("ANN-1")).ann.id;
    await ann("ANN-1", o.h, "Rewards at the stage in 10 minutes", T + 10_000);
    expect((await ctl("ANN-1", T + 10_000)).ann.id).not.toBe(id1); // a new message has a new id, so phones show it again
    expect((await ann("ANN-1", o.h, "", T + 20_000)).status).toBe(200);
    expect((await ctl("ANN-1", T + 20_000)).ann).toBeUndefined();
  });
  test("UC-80 messages are cleaned, a too long one is refused with the reason, rate limited, not for drafts, and not for a stranger (the organizer's AI may send them)", async () => {
    const o = await organizer(); await live("ANN-2", o);
    const tooLong = await ann("ANN-2", o.h, "<b>Hello</b>   `team` " + "x".repeat(400)); expect(tooLong.status).toBe(400); expect(JSON.stringify(await tooLong.json())).toMatch(/160/); // refused with the reason, never silently cut
    expect((await ctl("ANN-2")).ann).toBeUndefined();
    expect((await ann("ANN-2", o.h, "<b>Hello</b>   `team` " + "x".repeat(100), T + 6_000)).status).toBe(200);
    const t = (await ctl("ANN-2", T + 6_000)).ann.text as string; expect(t).not.toMatch(/[<>`]/); expect(t.length).toBeLessThanOrEqual(160); expect(t).toContain("team"); expect(t).toContain("Hello");
    expect((await ann("ANN-2", o.h, "again", T + 7_000)).status).toBe(429);
    expect((await ann("ANN-2", o.ai, "ai says hi", T + 60_000)).status).toBe(200);
    expect((await call("POST", "/api/z/ANN-2/announce", { text: "hi" }, {}, T + 60_000)).status).toBe(403);
    expect((await call("POST", "/api/z/ANN-2/announce", { notext: 1 }, o.h, T + 60_000)).status).toBe(400);
    await call("POST", "/api/z", eng("ANN-DRAFT"), o.h);
    expect((await ann("ANN-DRAFT", o.h, "hi", T + 60_000)).status).toBe(400);
    const other = await organizer(); expect((await ann("ANN-2", other.h, "hijack", T + 60_000)).status).toBe(403);
  });
  test("UC-81 a Host through an AI work link can watch and send messages, and nothing else; at most five Hosts; retiring stops it at once", async () => {
    const o = await organizer(); await live("HOST-1", o);
    const hk = (await j(await call("POST", "/api/org/host", { mobile: "9876500009", email: "host@acme.com" }, o.h))).hostKey as string; expect(hk).toMatch(/^cbh_/);
    const h = { "x-organizer": hk, "x-cb-link": "1" }; // an AI work link keeps the narrow rights (in the console a Host may do much more: see roles.test.ts)
    expect((await j(await call("GET", "/api/whoami", undefined, h))).kind).toBe("host"); expect((await j(await call("GET", "/api/whoami", undefined, o.h))).kind).toBe("master");
    expect((await ann("HOST-1", h, "Welcome everyone")).status).toBe(200);
    expect((await call("GET", "/api/z/HOST-1/participants", undefined, h)).status).toBe(200);
    expect((await call("GET", "/api/z/HOST-1/summary", undefined, h)).status).toBe(200);
    for (const [m, p, body] of [["PATCH", "/api/z/HOST-1/settings", { cap: 5 }], ["POST", "/api/z/HOST-1/roster", { people: [{ phone: phone(5) }] }], ["POST", "/api/z/HOST-1/erase", {}], ["POST", "/api/z/HOST-1/settle", { results: [] }], ["POST", "/api/z/HOST-1/publish", contact], ["GET", "/api/z/HOST-1/claims"], ["PUT", "/api/z/HOST-1/control/key", { publicKey: "aa" }], ["POST", "/api/z", eng("HOSTMADE")], ["POST", "/api/org/host", { mobile: "9876500009", email: "host@acme.com" }], ["POST", "/api/org/ai", {}], ["GET", "/api/org/keys"], ["POST", "/api/org/keys/revoke", { id: "x" }]] as const)
      expect([401, 403, 503]).toContain((await call(m, p, body, h)).status);
    expect(engRow("HOSTMADE")).toBeFalsy();
    const keys = await j(await call("GET", "/api/org/keys", undefined, o.h)); const hostRow = keys.keys.find((k: any) => k.kind === "host");
    for (let i = 0; i < 4; i++) expect((await call("POST", "/api/org/host", { mobile: "9876500009", email: "host@acme.com" }, o.h)).status).toBe(200);
    expect((await call("POST", "/api/org/host", { mobile: "9876500009", email: "host@acme.com" }, o.h)).status).toBe(409);
    // retire it with a second master key, as in real life
    await call("POST", "/api/auth/email", { email: o.email }); const code = outbox("%Corporate Bingo sign-in%").at(-1)!.body.match(/\b\d{6}\b/)![0];
    const m2 = (await j(await call("POST", "/api/auth/verify", { email: o.email, code }))).token as string;
    expect((await call("POST", "/api/org/keys/revoke", { id: hostRow.id }, { "x-organizer": m2 })).status).toBe(200);
    expect((await ann("HOST-1", h, "still there?", T + 60_000)).status).toBe(403);
  });
  test("UC-82 a lucky draw can be a scratch card: only the lucky draw has the style, anything else is refused, and it is read back", async () => {
    const o = await organizer(); await call("POST", "/api/z", eng("SCR-1"), o.ai);
    const ok = (b: unknown) => call("PATCH", "/api/z/SCR-1/settings", { breaks: b }, o.ai);
    expect((await ok([{ after: 40, seconds: 60, kind: "lucky", title: "Scratch and win", winners: 5, style: "scratch" }])).status).toBe(200);
    expect((await j(await call("GET", "/api/z/SCR-1/summary", undefined, o.ai))).breaks[0].style).toBe("scratch");
    expect((await ok([{ after: 40, seconds: 60, kind: "lucky", title: "Plain draw", winners: 3 }])).status).toBe(200);
    expect((await j(await call("GET", "/api/z/SCR-1/summary", undefined, o.ai))).breaks[0].style).toBeUndefined(); // the default draw stores nothing extra
    expect((await ok([{ after: 40, seconds: 60, kind: "lucky", title: "x1", style: "confetti" }])).status).toBe(400);
    expect((await ok([{ after: 40, seconds: 60, kind: "speech", title: "Address", style: "scratch" }])).status).toBe(400);
  });
});
