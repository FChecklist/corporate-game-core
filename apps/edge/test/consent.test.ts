// The Terms boxes (consent.ts). This file uses the REAL Worker with no helper that ticks for you: the server must refuse every action below without the tick.
// 1 refused without the tick   2 accepted with the tick   3 the stored row, read back from the database   4 a new Terms version asks again
// 5 the wording on the pages equals the agreed wording   6 no internal notes (apps/web/test/no-internal-notes.test.ts)   7 no account, IP or phone columns in consent_log
import { beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { handle, type Env } from "../src/worker";
import { CONSENT_TEXT, CONSENT_VERSION, boxesOf, hasConsent, wordingOf, type ConsentKind } from "../src/consent";
import { TERMS_VERSION } from "../src/brand";
import { makeD1 } from "./d1-sqlite";

const T = Date.UTC(2026, 9, 13, 10, 0, 0), GEN = 1692803367;
const START = Math.floor((T / 1000 - GEN) / 3) + 1200;
let env: Env; let raw: ReturnType<typeof makeD1>["raw"]; let ip = 0;
const call = (method: string, path: string, body?: unknown, key?: string, now = T) =>
  handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", "cf-connecting-ip": `7.7.7.${++ip % 200}`, ...(key ? { "x-organizer": key } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }), env, now);
const j = async (r: Response) => (await r.json()) as any;
const ticks = (k: ConsentKind, v = CONSENT_VERSION) => ({ v, boxes: boxesOf(k) });
const rows = (kind: string) => raw.query("SELECT * FROM consent_log WHERE kind=? ORDER BY at_ms, id").all(kind) as any[];
const hashOf = (k: ConsentKind) => createHash("sha256").update(wordingOf(k).join("\n")).digest("hex");
const dev = (i: number) => i.toString(16).padStart(4, "0").repeat(8);

beforeEach(() => {
  const d = makeD1({ strictHosts: true }); raw = d.raw; ip = 0;
  env = { DB: d.db, ORGANIZER_SECRET: "plat", DAILY_WRITE_BUDGET: "100000000", PUBLIC_ORIGIN: "https://bingo.test", PHONE_SALT: "salt", DATA_KEY: "k", TEST_MODE: "1" } as Env;
});

async function organizer(email = "boss@acme.com") { const r = await j(await call("POST", "/api/start", { email, consent: ticks("K2") })); return r.token as string; }
async function draft(key: string, id: string, cap = 100) { expect((await call("POST", "/api/z", { id, startRound: START, callSeconds: 6, cap }, key)).status).toBe(200); return id; }
const PUB = { email: "boss@acme.com", phone: "98765 43210" };
async function published(id: string) { const key = await organizer(); await draft(key, id); expect((await call("POST", `/api/z/${id}/publish`, { ...PUB, consent: ticks("K1") }, key)).status).toBe(200); return key; }

const refusal = async (r: Response, kind: ConsentKind) => {
  expect(r.status).toBe(400);
  const b = await j(r);
  expect(b).toEqual({ error: "Please tick the box to continue.", code: "consent-required", kind, version: TERMS_VERSION });
};

describe("1. refused without the tick (and with a missing box or an old version)", () => {
  test("K2: no account is made", async () => {
    await refusal(await call("POST", "/api/start", { email: "a@acme.com" }), "K2");
    await refusal(await call("POST", "/api/start", { email: "a@acme.com", consent: { v: CONSENT_VERSION, boxes: [] } }), "K2");
    expect(raw.query("SELECT COUNT(*) c FROM organizer_email").get()).toEqual({ c: 0 });
  });
  test("K1: the game stays a draft unless both boxes are ticked", async () => {
    const key = await organizer(); const id = await draft(key, "CON-1");
    await refusal(await call("POST", `/api/z/${id}/publish`, PUB, key), "K1");
    await refusal(await call("POST", `/api/z/${id}/publish`, { ...PUB, consent: { v: CONSENT_VERSION, boxes: ["A"] } }, key), "K1");
    expect(raw.query("SELECT pack FROM engagement WHERE id=?").get(id)).toEqual({ pack: 0 });
    expect(raw.query("SELECT COUNT(*) c FROM kv WHERE k=?").get(`pub/${id}`)).toEqual({ c: 0 });
  });
  test("K3: no payment is created, on the checkout and on the pay link alike", async () => {
    const key = await published("CON-2");
    const pay = { eid: "CON-2", org: "Acme Ltd", email: "boss@acme.com", country: "IN", taxId: "", currency: "INR", pack: 100 };
    await refusal(await call("POST", "/api/checkout", pay, key), "K3");
    const link = await j(await call("POST", "/api/z/CON-2/paylink", {}, key)); const tok = new URL(link.url).searchParams.get("t")!;
    await refusal(await call("POST", `/api/paylink/${tok}/checkout`, { name: "Ravi Kumar", email: "r@acme.com", country: "IN" }), "K3");
    expect(raw.query("SELECT COUNT(*) c FROM payment").get()).toEqual({ c: 0 });
  });
  test("K4: no seat, no name, no number is kept", async () => {
    await published("CON-3");
    const body = { name: "Maya Lopez", device: dev(1) };
    await refusal(await call("POST", "/api/z/CON-3/join", body), "K4");
    await refusal(await call("POST", "/api/z/CON-3/join", { ...body, consent: { v: CONSENT_VERSION, boxes: ["A"] } }), "K4");
    expect(raw.query("SELECT COUNT(*) c FROM seat").get()).toEqual({ c: 0 });
    expect(raw.query("SELECT COUNT(*) c FROM participant").get()).toEqual({ c: 0 });
  });
  test("K5: a Host cannot go on with the setup and a Co-host cannot do anything until the role is accepted", async () => {
    const master = await organizer(); await draft(master, "CON-4");
    const host = (await j(await call("POST", "/api/org/host", { label: "Priya", email: "priya@acme.com" }, master))).hostKey as string;
    await refusal(await call("POST", "/api/host/setup/email", { email: "priya@acme.com" }, host), "K5");
    const co = (await j(await call("POST", "/api/org/cohost", { label: "Ravi", phone: "9876500001", e: "CON-4" }, master))).cohostKey as string;
    await refusal(await call("GET", "/api/z/CON-4/people", undefined, co), "K5");
    expect((await j(await call("GET", "/api/z/CON-4/cohost", undefined, co))).roleAccepted).toBe(false);
    await refusal(await call("POST", "/api/org/role/accept", {}, co), "K5");
    expect(rows("K5")).toHaveLength(0);
  });
  test("K6: no person is added to a list without the tick", async () => {
    const key = await published("CON-5");
    await refusal(await call("POST", "/api/z/CON-5/people", { people: [{ name: "Ravi", phone: "9876500001" }] }, key), "K6");
    await refusal(await call("POST", "/api/z/CON-5/roster", { people: [{ name: "Ravi", phone: "9876500001" }] }, key), "K6");
    expect(raw.query("SELECT COUNT(*) c FROM person").get()).toEqual({ c: 0 });
    expect(raw.query("SELECT COUNT(*) c FROM seat").get()).toEqual({ c: 0 });
  });
});

describe("2 and 3. accepted with the tick; the row is read back from the database", () => {
  test("K2 sign-up", async () => {
    const r = await call("POST", "/api/start", { email: "a@acme.com", consent: ticks("K2") }, undefined, T + 5); expect(r.status).toBe(200);
    const org = (raw.query("SELECT org FROM organizer_email").get() as any).org;
    const row = rows("K2"); expect(row.length).toBe(1);
    expect(row[0]).toMatchObject({ subject: org, kind: "K2", ref: org, version: TERMS_VERSION, boxes: "A", text_hash: hashOf("K2"), at_ms: T + 5 });
    expect(row[0].id).toMatch(/^[0-9a-f]{24}$/);
  });
  test("K1 publish", async () => {
    const key = await organizer(); const id = await draft(key, "CON-6");
    const ok = await call("POST", `/api/z/${id}/publish`, { ...PUB, consent: ticks("K1") }, key, T + 9); expect(ok.status).toBe(200);
    const org = (raw.query("SELECT org FROM engagement WHERE id=?").get(id) as any).org;
    expect(rows("K1")).toHaveLength(1);
    expect(rows("K1")[0]).toMatchObject({ subject: org, kind: "K1", ref: id, version: TERMS_VERSION, boxes: "A,B", text_hash: hashOf("K1"), at_ms: T + 9 });
  });
  test("K3 checkout", async () => {
    const key = await published("CON-7");
    const ok = await call("POST", "/api/checkout", { eid: "CON-7", org: "Acme Ltd", email: "boss@acme.com", country: "IN", taxId: "", currency: "INR", consent: ticks("K3") }, key, T + 3); expect(ok.status).toBe(200);
    const pay = raw.query("SELECT id, org FROM payment").get() as any;
    expect(rows("K3")[0]).toMatchObject({ subject: pay.org, kind: "K3", ref: pay.id, version: TERMS_VERSION, boxes: "A", text_hash: hashOf("K3"), at_ms: T + 3 });
  });
  test("K4 join: both boxes, stored under the seat, and the person comes in", async () => {
    await published("CON-8");
    const ok = await call("POST", "/api/z/CON-8/join", { name: "Maya Lopez", device: dev(2), consent: ticks("K4") }, undefined, T + 7); expect(ok.status).toBe(200);
    const pid = (await j(ok)).pid;
    expect(raw.query("SELECT COUNT(*) c FROM participant").get()).toEqual({ c: 1 });
    expect(rows("K4")).toHaveLength(1);
    expect(rows("K4")[0]).toMatchObject({ subject: pid, kind: "K4", ref: "CON-8", version: TERMS_VERSION, boxes: "A,B", text_hash: hashOf("K4"), at_ms: T + 7 });
    // coming back to the same card does not ask again
    expect((await call("POST", "/api/z/CON-8/join", { name: "Maya Lopez", device: dev(2) })).status).toBe(200);
    expect(rows("K4")).toHaveLength(1);
  });
  test("K4 adults only: box B says only that the person is 18 or older (no parent's-device alternative); box A says what is kept; neither is ticked for the person; a join with only A is refused; the exact wording is hashed with the row", async () => {
    const [a, b] = boxesOf("K4").map((x) => (CONSENT_TEXT.K4 as any)[x] as string); expect(b).toBe("I am 18 or older.");
    expect(wordingOf("K4").join(" ")).not.toMatch(/parent|guardian|device with/i);
    for (const part of ["deleted within 24 hours", "who invited me is recorded until then", "prize record are kept for 365 days", "We keep billing data for audit and tax reasons.", "Hindi on request"]) expect(a).toContain(part);
    expect(a).not.toMatch(/forever|for ever|permanent/i);
    await published("CON-A18"); const body = { name: "Maya Lopez", device: dev(1) };
    expect((await call("POST", "/api/z/CON-A18/join", { ...body, consent: { v: CONSENT_VERSION, boxes: ["A"] } })).status).toBe(400); // the age box is required by the server
    expect((await call("POST", "/api/z/CON-A18/join", { ...body, consent: { v: CONSENT_VERSION, boxes: ["B"] } })).status).toBe(400);
    expect((await call("POST", "/api/z/CON-A18/join", { ...body, consent: { v: "2026-10-14", boxes: ["A", "B"] } })).status).toBe(400); // the old version no longer counts
    expect((await call("POST", "/api/z/CON-A18/join", { ...body, consent: ticks("K4") }, undefined, T + 9)).status).toBe(200);
    expect(rows("K4")[0]).toMatchObject({ boxes: "A,B", version: CONSENT_VERSION, text_hash: hashOf("K4") });
  });
  test("K5 Host setup and Co-host role", async () => {
    const master = await organizer(); await draft(master, "CON-9");
    const host = (await j(await call("POST", "/api/org/host", { label: "Priya", email: "priya@acme.com" }, master))).hostKey as string;
    expect((await call("POST", "/api/host/setup/email", { email: "priya@acme.com", consent: ticks("K5") }, host, T + 1)).status).toBe(200);
    const co = (await j(await call("POST", "/api/org/cohost", { label: "Ravi", phone: "9876500001", e: "CON-9" }, master))).cohostKey as string;
    expect((await call("POST", "/api/org/role/accept", { consent: ticks("K5") }, co, T + 2)).status).toBe(200);
    expect((await call("GET", "/api/z/CON-9/people", undefined, co)).status).toBe(200);
    expect((await j(await call("GET", "/api/z/CON-9/cohost", undefined, co))).roleAccepted).toBe(true);
    const r = rows("K5"); expect(r).toHaveLength(2);
    for (const x of r) expect(x).toMatchObject({ kind: "K5", version: TERMS_VERSION, boxes: "A", text_hash: hashOf("K5") });
    expect(r.map((x) => x.at_ms)).toEqual([T + 1, T + 2]);
    expect(r[0].subject).toMatch(/^h:/); expect(r[1].subject).toMatch(/^c:/);
  });
  test("K6 people list", async () => {
    const key = await published("CON-10");
    const ok = await call("POST", "/api/z/CON-10/people", { people: [{ name: "Ravi", phone: "9876500001" }], consent: ticks("K6") }, key, T + 4); expect(ok.status).toBe(200);
    expect(rows("K6")).toHaveLength(1);
    expect(rows("K6")[0]).toMatchObject({ kind: "K6", ref: "CON-10", version: TERMS_VERSION, boxes: "A", text_hash: hashOf("K6"), at_ms: T + 4 });
  });
});

describe("4. a new Terms version asks again", () => {
  test("a request that carries an older version is refused; a tick stored under an older version does not count", async () => {
    const OLD = "2026-10-09";
    await refusal(await call("POST", "/api/start", { email: "a@acme.com", consent: ticks("K2", OLD) }), "K2");
    const key = await organizer("b@acme.com"); const id = await draft(key, "CON-11");
    await refusal(await call("POST", `/api/z/${id}/publish`, { ...PUB, consent: ticks("K1", OLD) }, key), "K1");
    expect((await call("POST", `/api/z/${id}/publish`, { ...PUB, consent: ticks("K1") }, key)).status).toBe(200);
    // a Co-host who accepted under the old version is asked again
    const co = (await j(await call("POST", "/api/org/cohost", { label: "Ravi", phone: "9876500001", e: id }, key))).cohostKey as string;
    expect((await call("POST", "/api/org/role/accept", { consent: ticks("K5") }, co)).status).toBe(200);
    expect((await call("GET", `/api/z/${id}/people`, undefined, co)).status).toBe(200);
    raw.run("UPDATE consent_log SET version=? WHERE kind='K5'", [OLD]);
    await refusal(await call("GET", `/api/z/${id}/people`, undefined, co), "K5");
    expect(await hasConsent(env.DB, (raw.query("SELECT subject FROM consent_log WHERE kind='K5'").get() as any).subject, "K5")).toBe(false);
  });
});

describe("5. the wording on the pages is the agreed wording", () => {
  const AGREED = JSON.parse(readFileSync(new URL("../src/consent-text.json", import.meta.url), "utf8"));
  const pageWindow = () => { // consent.js as the browser runs it
    const win: any = new Window({ url: "http://localhost/", settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true } });
    new Function("window", "document", readFileSync(new URL("../../web/public/consent.js", import.meta.url), "utf8")).call(win, win, win.document);
    return win;
  };
  test("version", () => { expect(AGREED.version).toBe(TERMS_VERSION); expect(pageWindow().CBConsent.version).toBe(TERMS_VERSION); });
  test("every box a page draws says exactly what the agreed text says (string compare of the label text)", () => {
    const win = pageWindow();
    for (const kind of ["K1", "K2", "K3", "K4", "K5", "K6"] as const) {
      const host = win.document.createElement("div"); host.innerHTML = win.CBConsent.html(kind); win.document.body.appendChild(host);
      const labels = Array.from(host.querySelectorAll("label")).map((l: any) => l.textContent);
      expect([kind, labels]).toEqual([kind, Object.keys(AGREED[kind]).map((b) => AGREED[kind][b])]);
      expect([kind, win.CBConsent.text[kind]]).toEqual([kind, AGREED[kind]]);
      expect([kind, CONSENT_TEXT[kind]]).toEqual([kind, AGREED[kind]]); // what the server checks
    }
  });
  test("never ticked in advance; each box has a real label; the page words are links that open in a new tab", () => {
    const win = pageWindow();
    const host = win.document.createElement("div"); host.innerHTML = win.CBConsent.html("K1"); win.document.body.appendChild(host);
    for (const i of Array.from(host.querySelectorAll("input[type=checkbox]")) as any[]) { expect(i.checked).toBe(false); expect(host.querySelector(`label[for="${i.id}"]`)).toBeTruthy(); }
    const hrefs = Array.from(host.querySelectorAll("label a")).map((a: any) => [a.textContent, a.getAttribute("href"), a.getAttribute("target"), a.getAttribute("rel")]);
    expect(hrefs).toEqual([["Terms & Conditions", "/terms.html", "_blank", "noopener"], ["Privacy Policy", "/privacy.html", "_blank", "noopener"], ["Refund Policy", "/refund-policy.html", "_blank", "noopener"]]);
  });
  test("the button stays disabled (and aria-disabled) until every box of the point is ticked", () => {
    const win = pageWindow();
    const host = win.document.createElement("div"); host.innerHTML = win.CBConsent.html("K4") + `<button id="b" data-needs="K4">go</button>`; win.document.body.appendChild(host);
    win.CBConsent.wire(host, "K4", {});
    const b = host.querySelector("#b") as any, [a, c] = Array.from(host.querySelectorAll("input")) as any[];
    expect([b.disabled, b.getAttribute("aria-disabled")]).toEqual([true, "true"]);
    a.checked = true; a.dispatchEvent(new win.Event("change")); expect(b.disabled).toBe(true);
    c.checked = true; c.dispatchEvent(new win.Event("change")); expect([b.disabled, b.getAttribute("aria-disabled")]).toEqual([false, "false"]);
    a.checked = false; a.dispatchEvent(new win.Event("change")); expect(b.disabled).toBe(true);
  });
});

describe("7. the record holds no account, IP address, browser or phone data", () => {
  test("the columns of consent_log are exactly these", () => {
    const cols = (raw.query("PRAGMA table_info(consent_log)").all() as any[]).map((c) => c.name);
    expect(cols).toEqual(["id", "subject", "kind", "ref", "version", "boxes", "text_hash", "at_ms"]);
    for (const c of cols) expect(c).not.toMatch(/ip|addr|agent|phone|mobile|email|account|user|device/i);
  });
  test("a join stores no phone number, name or network address in consent_log", async () => {
    await published("CON-12");
    await call("POST", "/api/z/CON-12/join", { name: "Maya Lopez", phone: "98765 43210", device: dev(3), consent: ticks("K4") });
    const dump = JSON.stringify(raw.query("SELECT * FROM consent_log").all());
    expect(dump).not.toMatch(/98765|43210|Maya|Lopez|7\.7\.7|boss@acme/);
  });
});

describe("erasure and records", () => {
  test("the participant's rows are erased with the participant's data; the organizer's rows stay", async () => {
    await published("CON-13");
    await call("POST", "/api/z/CON-13/join", { name: "Maya Lopez", device: dev(4), consent: ticks("K4") });
    expect(rows("K4")).toHaveLength(1);
    const { erasePersonal } = await import("../src/lifecycle");
    await erasePersonal(env as any, "CON-13", T + 3 * 86_400_000, "test");
    expect(rows("K4")).toHaveLength(0);
    expect(rows("K1")).toHaveLength(1); expect(rows("K2")).toHaveLength(1);
  });
  test("the new account keeps the old continuity row (organizer_terms) with the same version", async () => {
    await organizer("c@acme.com");
    expect(raw.query("SELECT version, via FROM organizer_terms").all()).toEqual([{ version: TERMS_VERSION, via: "start" }]);
  });
});

describe("a Co-host who has not accepted the role cannot pay or use credit (found by the permissions scenario family: the payment routes ran before the K5 gate)", () => {
  test("checkout, proforma and credit are refused with consent-required until the K5 box is ticked", async () => {
    const key = await organizer("pay-co@acme.com"); const id = await draft(key, "CON-PAY");
    const co = (await j(await call("POST", "/api/org/cohost", { label: "Ravi", phone: "9876500001", e: id }, key))).cohostKey as string;
    for (const [p, b] of [["/api/checkout", { eid: id, email: "x@acme.com", consent: ticks("K3") }], ["/api/proforma", { eid: id }], ["/api/org/credit", {}], [`/api/z/${id}/pay-with-credit`, {}]] as const) {
      const r = await call("POST", p, b, co); const x = await j(r);
      expect([p, r.status, x.code]).toEqual([p, 400, "consent-required"]);
      expect(x.kind).toBe("K5");
    }
    expect((await call("POST", "/api/org/role/accept", { consent: ticks("K5") }, co)).status).toBe(200);
    const after = await call("POST", "/api/checkout", { eid: id, email: "x@acme.com", consent: ticks("K3") }, co);
    expect((await j(after)).code).not.toBe("consent-required"); // after the tick the normal payment rules apply
  });
});
