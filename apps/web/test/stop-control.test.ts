// O7: the organizer presses End (Stop) in the console, the console signs the message, the Worker's control address accepts it, and every guest phone stops at the same call.
// The real console page script (zc.js) is clicked in a DOM; the signing key is the one the test registered (the browser's key store, IndexedDB, needs a real browser);
// the guest phones are the real PhoneRuntime reading from the same Worker and database. A second run without the click shows the phones playing on.
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { createHash } from "node:crypto";
import { newWorld, openPage, roundAt, roundMs, type Page } from "./harness";
import { PhoneRuntime, type PhoneDeps } from "../../../packages/beacon/src/phone-runtime";
import { GRACE_ROUNDS, PRIZE_HOUSES } from "../../../packages/beacon/src/config";
import { nextMessage, publicKeyFromSecret, readPublished, signControlWithSecret, type KV } from "../../../packages/beacon/src/control";
import { roundTimeMs, type Fetcher, type Round } from "../../../packages/beacon/src";

setDefaultTimeout(120_000);
const KEY = "11".repeat(32);
const START = 80_000;
const rnd = (r: number) => createHash("sha256").update("fake" + r).digest("hex");
let open: Page[] = [];
afterEach(async () => { for (const p of open) await p.close(); open = []; });

async function setup(eid: string) {
  const w = newWorld();
  const T0 = roundTimeMs(START - 3);
  w.world.now = T0 - 2 * 3_600_000; // the game is made and published two hours before it starts
  const s = await w.json(await w.api("POST", "/api/start", { email: "boss@acme.com" }));
  const token = s.token as string, aiKey = s.aiKey as string;
  expect((await w.api("POST", "/api/z", { id: eid, startRound: START - GRACE_ROUNDS, callSeconds: 6, cap: 100 }, aiKey)).status).toBe(200);
  expect((await w.api("POST", `/api/z/${eid}/publish`, { email: "boss@acme.com", phone: "98765 43210" }, token)).status).toBe(200);
  w.world.raw.prepare("UPDATE engagement SET pack=100 WHERE id=?").run(eid); // paid: the phones play
  expect((await w.api("PUT", `/api/z/${eid}/control/key`, { publicKey: publicKeyFromSecret(KEY) }, token)).status).toBe(200);
  w.world.now = T0;
  let t = 0;
  const phones = [1, 2, 3].map((n) => {
    const mem = new Map<string, string>();
    const fetcher: Fetcher = async (url) => { const last = url.split("/").pop()!, nowR = roundAt(T0 + t), r = last === "latest" ? nowR : Number(last); if (r > nowR) return { ok: false, status: 404, json: async () => ({}) }; return { ok: true, status: 200, json: async () => ({ round: r, randomness: rnd(r), signature: "aa" } as Round) }; };
    const api: PhoneDeps["api"] = async (method, path, body) => { const r = await w.api(method, path, body); const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error((j as any).error ?? "http " + r.status), { status: r.status }); return j; };
    const rt = new PhoneRuntime(eid, { noEarlyEnd: true, api, mono: () => t, store: { get: (k) => mem.get(k) ?? null, set: (k, v) => void mem.set(k, v) }, beacon: { fetcher, mirrors: ["https://a.test", "https://b.test", "https://c.test"], timeoutMs: 500 }, verify: (x) => x.signature === "aa" && x.randomness === rnd(x.round) } as PhoneDeps);
    return { rt, phone: "9" + String(100000000 + n) };
  });
  const step = async (ms = 3000) => { t += ms; w.world.now = T0 + t; for (const p of phones) await p.rt.tick(); };
  for (const p of phones) { await p.rt.boot(); await p.rt.join(p.phone); }
  return { w, token, aiKey, phones, step, now: () => T0 + t };
}

async function consoleWithEnd(x: Awaited<ReturnType<typeof setup>>, eid: string) {
  const kv: KV = { get: async (k) => (x.w.world.raw.prepare("SELECT v FROM kv WHERE k=?").get(k) as any)?.v ?? null, put: async () => {} };
  const p = await openPage(x.w.world, {
    url: `http://localhost/zc?e=${eid}`, html: "zc.html", scripts: ["zgame.js", "control.js", "zc.js"], session: { "cbz-org": x.token, "cbz-email": "boss@acme.com" },
    afterLoad: (win: any, f: string) => {
      if (f === "zgame.js" && win.ZG && !win.ZG.PRIZE_HOUSES) win.ZG.PRIZE_HOUSES = PRIZE_HOUSES;
      if (f === "control.js") { // the browser's key store is not there; the console still builds, signs and posts through the page's own TBControl.publish
        win.confirm = () => true;
        win.TBControl.sign = async (code: string, _a: unknown, action: any, o: any = {}) => signControlWithSecret(KEY, nextMessage((await readPublished(kv, code))!, roundAt(x.now()), { action, ...o }));
      }
    },
  });
  open.push(p); return p;
}
const wait = (ms = 60) => new Promise((r) => setTimeout(r, ms));

describe("O7: the console's End control stops the game on every phone", () => {
  test("pressing End in the console signs a stop; the Worker accepts it; every phone ends at the same call; without the press they play on", async () => {
    const x = await setup("O7-STOP");
    for (let i = 0; i < 25; i++) await x.step();
    expect(x.phones.map((p) => p.rt.view().phase)).not.toContain("ended");
    const before = x.phones[0]!.rt.view().log.length; expect(before).toBeGreaterThan(3); // numbers are being called

    const c = await consoleWithEnd(x, "O7-STOP");
    await c.waitFor((t) => /Last step|Your game|Controls/i.test(t));
    c.click('.zc-dot[data-open="9"]'); await c.waitFor((t) => /Controls/.test(t));
    const end = c.$('[data-ctl="stop"]'); expect(end).toBeTruthy(); expect(String(end.textContent)).toMatch(/end/i);
    c.click('[data-ctl="stop"]');
    await c.waitFor((t) => /Stop sent/.test(t));
    const f = (await readPublished({ get: async (k) => (x.w.world.raw.prepare("SELECT v FROM kv WHERE k=?").get(k) as any)?.v ?? null, put: async () => {} }, "O7-STOP"))!;
    expect(f.messages.map((m) => m.action)).toEqual(["stop"]); // the signed message is stored by the Worker
    for (let i = 0; i < 200; i++) await x.step();
    const views = x.phones.map((p) => p.rt.view());
    expect(views.map((v) => v.phase)).toEqual(["ended", "ended", "ended"]);
    expect(views[1]!.log).toEqual(views[0]!.log); expect(views[2]!.log).toEqual(views[0]!.log); // the same last number on every phone
    expect(views[0]!.log.length).toBeLessThan(75); // and it did not run to the end of the 75 numbers

    // the same game with nobody pressing End: the phones play on past that point
    const y = await setup("O7-GO");
    for (let i = 0; i < 25 + 200; i++) await y.step();
    expect(y.phones[0]!.rt.view().log.length).toBeGreaterThan(views[0]!.log.length);
    void wait; void roundMs;
  });
  test("a stop that was not signed by the organizer's key is refused and the phones play on", async () => {
    const x = await setup("O7-FORGE");
    for (let i = 0; i < 20; i++) await x.step();
    const kv: KV = { get: async (k) => (x.w.world.raw.prepare("SELECT v FROM kv WHERE k=?").get(k) as any)?.v ?? null, put: async () => {} };
    const msg = signControlWithSecret("22".repeat(32), nextMessage((await readPublished(kv, "O7-FORGE"))!, roundAt(x.now()), { action: "stop" }));
    const r = await x.w.api("POST", "/api/z/O7-FORGE/control", { message: msg }); expect(r.status).toBe(403);
    for (let i = 0; i < 40; i++) await x.step();
    expect(x.phones.map((p) => p.rt.view().phase)).not.toContain("ended");
  });
});
