// Email ID criterion (owner decision 2026-10-30): the organizer picks Employee ID or Email ID for the whole game; the list decides. Email IDs are case-insensitive (emailKey); an Email ID typed where an employee ID is asked is refused.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type Env } from "../src/worker";
import { handle } from "./with-terms";
import type { PayEnv } from "../src/pay";
import { normEmp, empHashOf, normId, badIdMessage, EMP_CLEAN_FROM_MS } from "../src/people";
import { makeD1 } from "./d1-sqlite";
import { setMode } from "../src/mode";

const T = Date.UTC(2026, 9, 1, 10, 0, 0);
const GEN = 1692803367;
const roundAt = (ms: number) => Math.floor((ms / 1000 - GEN) / 3) + 1;
const START = roundAt(T) + 1200; // one hour after T
let env: PayEnv; let raw: ReturnType<typeof makeD1>["raw"]; let ipN = 0;
const realFetch = globalThis.fetch;
const call = (method: string, path: string, body?: unknown, key?: string, now = T) =>
  handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", ...(key ? { "x-organizer": key } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }), env as Env, now);
const j = async (r: Response) => (await r.json()) as any;
const mob = (i: number) => "9" + String(100000000 + i);
const dev = (i: number) => (String(i).padStart(2, "0") + "b".repeat(32)).slice(0, 32);
const join = (id: string, body: Record<string, unknown>, now = T) => call("POST", `/api/z/${id}/join`, body, undefined, now);
const joinAs = (id: string, i: number, extra: Record<string, unknown> = {}, now = T) => join(id, { phone: mob(i), name: "G" + i, device: dev(i), ...extra }, now);
const rowsOf = (sql: string, ...v: unknown[]) => raw.prepare(sql).all(...(v as any[])) as any[];

async function setup(opts: { closed?: boolean; verify?: string; employeesOnly?: boolean; idKind?: string; invites?: unknown } = {}) {
  const st = await j(await handle(new Request("http://x/api/start", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": `7.7.7.${++ipN}` }, body: JSON.stringify({ email: `o${ipN}@acme.com` }) }), env as Env, T));
  const master = st.token as string;
  await call("POST", "/api/z", { id: "PPL-1", startRound: START, callSeconds: 6, cap: 100, ...(opts.closed ? { whoCanJoin: "list" } : {}) }, master);
  await call("POST", "/api/z/PPL-1/publish", { email: "boss@acme.com", phone: "98765 43210" }, master);
  const body = { ...(opts.invites ? { guestInvites: opts.invites } : {}), ...(opts.verify ? { verify: opts.verify } : {}), ...(opts.idKind ? { idKind: opts.idKind } : {}), ...(opts.employeesOnly !== undefined ? { employeesOnly: opts.employeesOnly } : {}) };
  if (Object.keys(body).length) expect((await call("PATCH", "/api/z/PPL-1/settings", body, master)).status).toBe(200);
  return { master };
}
const add = (key: string, people: unknown[]) => call("POST", "/api/z/PPL-1/people", { people }, key);

beforeEach(() => { const d = makeD1(); raw = d.raw; env = { DB: d.db, ORGANIZER_SECRET: "plat", DAILY_WRITE_BUDGET: "1000000", PUBLIC_ORIGIN: "https://bingo.test", PHONE_SALT: "salt" }; (globalThis as any).fetch = async () => new Response("{}", { status: 404 }); });
afterEach(() => { globalThis.fetch = realFetch; });

describe("Email ID criterion", () => {
  test("the setting is saved and shown to the join page", async () => {
    const t = await setup({ verify: "id", employeesOnly: true, idKind: "email" });
    const info = await j(await call("GET", "/api/z/PPL-1/info")); expect(info.idKind).toBe("email");
    expect((await call("PATCH", "/api/z/PPL-1/settings", { idKind: "phone" }, t.master)).status).toBe(400);
  });
  test("a listed person joins with the Email ID in any case; the same person typed four ways is one person", async () => {
    const t = await setup({ verify: "id", employeesOnly: true, idKind: "email" });
    const r = await j(await add(t.master, [{ name: "Asha", empId: "Rajat1＠Demo.com" }, { name: "Dup", empId: "RAJAT1@DEMO.COM" }, { name: "Bad", empId: "not-an-email" }]));
    expect(r.added).toBe(1); expect(r.duplicates).toBe(1); expect(r.invalid.length).toBe(1);
    expect(r.sameAfterCleaning).toEqual([{ raw: "RAJAT1@DEMO.COM", as: "rajat1@demo.com" }]);
    // the first typing joins; every other typing (another case, spaces, full-width at-sign) is the SAME person, already in from another phone
    expect((await joinAs("PPL-1", 1, { phone: undefined, empId: "rajat1@demo.com" })).status).toBe(200);
    for (const [i, typed] of [" Rajat1@Demo.com ", "RAJAT1＠DEMO.COM"].entries()) expect([typed, (await joinAs("PPL-1", i + 2, { phone: undefined, empId: typed })).status]).toEqual([typed, 423]);
  });
  test("an unlisted Email ID waits, a half address is refused plainly", async () => {
    const t = await setup({ verify: "id", employeesOnly: true, idKind: "email" }); await add(t.master, [{ name: "Asha", empId: "a@b.com" }]);
    const bad = await joinAs("PPL-1", 5, { phone: undefined, empId: "a@b" }); expect(bad.status).toBe(400); expect((await j(bad)).error).toMatch(/Email ID/);
    expect((await joinAs("PPL-1", 6, { phone: undefined, empId: "other@b.com" })).status).not.toBe(200);
  });
  test("an Email ID typed in an employee-ID game is refused (a game made before the deploy keeps the old words)", async () => {
    const t = await setup({ verify: "id", employeesOnly: true }); await add(t.master, [{ name: "Asha", empId: "RAJAT1DEMOCOM" }]);
    const r = await joinAs("PPL-1", 1, { phone: undefined, empId: "rajat1@demo.com" }); expect(r.status).toBe(400); expect((await j(r)).error).toMatch(/letters and numbers only/);
    expect(normId("rajat1@demo.com", "emp", EMP_CLEAN_FROM_MS + 1)).toBeNull(); expect(badIdMessage("rajat1@demo.com", "emp", EMP_CLEAN_FROM_MS + 1)).toMatch(/looks like an Email ID/); // a game made after the deploy
    expect(normId("RAJAT1＠Demo.com", "email")).toBe("rajat1@demo.com"); expect(normId("1B-678", "emp", EMP_CLEAN_FROM_MS + 1)).toBe("1B678");
  });
});
