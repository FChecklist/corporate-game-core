// WP-17 (gap plan 2026-10-29): the three test sign-ins (demo1/2/3@xyz.in, code 123456) must work ONLY while the whole service is in TEST mode.
// In LIVE mode they are nothing special: an address nobody confirmed, so the code is refused and no account or key is made.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { setMode } from "../src/mode";
import { T, W, call, j, one, q, reset, restore } from "./param-harness";

beforeEach(() => reset());
afterEach(restore);

const EMAILS = ["demo1@xyz.in", "demo2@xyz.in", "demo3@xyz.in"];
const verify = (email: string, code = "123456") => call("POST", "/api/auth/verify", { email, code }, { "cf-connecting-ip": "5.5.5.5" });

describe("test sign-ins (WP-17)", () => {
  test("LIVE mode (the default): the fixed code 123456 is refused for all three addresses and no account or key is made", async () => {
    for (const em of EMAILS) {
      expect((await call("POST", "/api/auth/email", { email: em }, { "cf-connecting-ip": "5.5.5.5" })).status).toBe(200); // same generic answer as any address
      const r = await verify(em); expect(r.status).toBe(400);
      expect((await j(r)).token).toBeUndefined();
    }
    expect(one("SELECT COUNT(*) c FROM organizer_email").c).toBe(0);
    expect(one("SELECT COUNT(*) c FROM organizer_key").c).toBe(0);
    expect(q("SELECT k FROM kv WHERE k LIKE 'tlg/%'")).toEqual([]);
  });
  test("LIVE mode: no e-mail is ever sent to a test address (even if one is asked for)", async () => {
    const { sendMail } = await import("../src/pay");
    for (const em of EMAILS) expect(await sendMail(W.env as any, (W.env as any).DB, em, "Your report", "text", T)).toBe(false);
    expect(one("SELECT COUNT(*) c FROM outbox WHERE to_addr LIKE '%xyz.in'").c).toBe(0);
  });
  test("TEST mode: the same three addresses sign in with 123456 (a wrong code and another address are still refused)", async () => {
    await setMode(W.env as any, "TEST", "t", T);
    for (const em of EMAILS) {
      const a = await j(await verify(em)); expect(a.token).toMatch(/^cbk_/);
      expect((await verify(em, "654321")).status).toBe(400);
    }
    expect((await verify("demo4@xyz.in")).status).toBe(400);
    expect(one("SELECT COUNT(*) c FROM organizer_email").c).toBe(3);
  });
  test("switching back to LIVE closes the door again at once", async () => {
    await setMode(W.env as any, "TEST", "t", T);
    expect((await verify("demo1@xyz.in")).status).toBe(200);
    await setMode(W.env as any, "LIVE", "t", T);
    expect((await verify("demo1@xyz.in")).status).toBe(400);
  });
});
