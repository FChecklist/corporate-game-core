// B02 (gap plan 2026-10-29): new games use one speed (12 s) when the live site's setting ONLY_12S is on; an older game keeps the speed it has and can still be edited; a copy of an old game gets 12.
// Same mechanism as Corporate Tambola (worker.ts only12).
import { beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { withDevice } from "./device";
import { ONLY_12S_MSG, only12, type Env } from "../src/worker";
import { handle } from "./with-terms";
import { makeD1 } from "./d1-sqlite";
setDefaultTimeout(60_000);
const T = Date.UTC(2026, 9, 1, 10, 0, 0);
const roundAt = (ms: number) => Math.floor((ms / 1000 - 1692803367) / 3) + 1;
const START = roundAt(T) + 2400;
let env: Env; let raw: ReturnType<typeof makeD1>["raw"];
const P = { "x-organizer": "plat" };
const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", ...headers }, body: withDevice(method, path, body) }), env, T);
const mk = (on: boolean) => { const d = makeD1(); raw = d.raw; env = { DB: d.db, ORGANIZER_SECRET: "plat", DAILY_WRITE_BUDGET: "1000000", PUBLIC_ORIGIN: "http://localhost", PHONE_SALT: "salt", ...(on ? { ONLY_12S: "1" } : {}) } as any; };
const secs = (id: string) => (raw.query("SELECT call_seconds AS c FROM engagement WHERE id=?").get(id) as any).c;

describe("one speed for new games (B02)", () => {
  test("the setting is on only when it is exactly 1", () => { expect(only12({ ONLY_12S: "1" })).toBe(true); expect(only12({})).toBe(false); expect(only12({ ONLY_12S: "0" })).toBe(false); });
  beforeEach(() => mk(true));
  test("a new game: 9 is refused with a plain message, 12 (or none given) is accepted and stored as 12", async () => {
    const bad = await call("POST", "/api/z", { id: "NEW-9", startRound: START, callSeconds: 9, cap: 50 }, P);
    expect(bad.status).toBe(400); expect(((await bad.json()) as any).error).toBe(ONLY_12S_MSG);
    expect((await call("POST", "/api/z", { id: "NEW-12", startRound: START, callSeconds: 12, cap: 50 }, P)).status).toBe(200);
    expect((await call("POST", "/api/z", { id: "NEW-NONE", startRound: START, cap: 50 }, P)).status).toBe(200);
    expect(secs("NEW-NONE")).toBe(12); expect(secs("NEW-12")).toBe(12);
  });
  test("with the setting off nothing changes (an old 9 s game can still be made by the API)", async () => {
    mk(false);
    expect((await call("POST", "/api/z", { id: "OFF-9", startRound: START, callSeconds: 9, cap: 50 }, P)).status).toBe(200); expect(secs("OFF-9")).toBe(9);
  });
  test("an older 9 s game keeps 9 and can still be saved (size change); picking 6 for it is refused; copying it gives 12", async () => {
    mk(false); expect((await call("POST", "/api/z", { id: "OLD-9", startRound: START, callSeconds: 9, cap: 50 }, P)).status).toBe(200);
    env = { ...env, ONLY_12S: "1" } as any;
    expect((await call("PATCH", "/api/z/OLD-9/settings", { callSeconds: 9, cap: 60 }, P)).status).toBe(200); expect(secs("OLD-9")).toBe(9);
    expect((await call("PATCH", "/api/z/OLD-9/settings", { callSeconds: 6 }, P)).status).toBe(400);
    expect((await call("POST", "/api/z/OLD-9/clone", {}, P)).status).toBe(200);
    expect((raw.query("SELECT call_seconds AS c FROM engagement WHERE id<>'OLD-9' ORDER BY created_ms DESC LIMIT 1").get() as any).c).toBe(12);
  });
});
