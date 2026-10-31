// B14 (gap plan 2026-10-29): "everyone in one room: phones stay silent, the big screen speaks". The organizer's choice is kept with the game, shown to the phones and the big screen, and can be changed until the game starts.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { validateCfg, defaultCfg } from "../../../packages/beacon/src/config";
import { call, create, j, organizer, publish, reset, restore, uid } from "./param-harness";

beforeEach(() => reset());
afterEach(restore);

describe("the setting itself", () => {
  test("validateCfg keeps true, drops false, refuses anything that is not yes or no, and keeps it over an unrelated change", () => {
    const on = validateCfg({ roomMode: true }); expect(on.ok && on.cfg.roomMode).toBe(true);
    const kept = validateCfg({ name: "Party" }, (on as any).cfg); expect(kept.ok && kept.cfg.roomMode).toBe(true);
    const off = validateCfg({ roomMode: false }, (on as any).cfg); expect(off.ok && off.cfg.roomMode).toBeUndefined();
    expect(validateCfg({ roomMode: "yes" }).ok).toBe(false);
    expect(defaultCfg().roomMode).toBeUndefined();
  });
});

describe("through the API", () => {
  test("a new game is not a room game; the organizer can turn it on and off; /info tells the phones and the big screen", async () => {
    const o = await organizer(); const id = uid("RM");
    expect((await create(o.key, id)).status).toBe(200); expect((await publish(o.key, id)).status).toBe(200); // the public info exists once the game is published
    expect((await j(await call("GET", `/api/z/${id}/info`, undefined, o.h))).roomMode).toBe(false);
    expect((await call("PATCH", `/api/z/${id}/settings`, { roomMode: true }, o.h)).status).toBe(200);
    const info = await j(await call("GET", `/api/z/${id}/info`, undefined, o.h)); expect(info.roomMode).toBe(true);
    expect((await j(await call("GET", `/api/z/${id}/info`))).roomMode).toBe(true); // the public info the phones read
    expect((await call("PATCH", `/api/z/${id}/settings`, { cap: 120 }, o.h)).status).toBe(200); // an unrelated change keeps it
    expect((await j(await call("GET", `/api/z/${id}/info`))).roomMode).toBe(true);
    expect((await call("PATCH", `/api/z/${id}/settings`, { roomMode: false }, o.h)).status).toBe(200);
    expect((await j(await call("GET", `/api/z/${id}/info`))).roomMode).toBe(false);
    expect((await call("PATCH", `/api/z/${id}/settings`, { roomMode: "loud" }, o.h)).status).toBe(400);
  });
  test("creating a game with it on, and copying such a game, keep it", async () => {
    const o = await organizer(); const a = uid("RM");
    expect((await create(o.key, a, { roomMode: true })).status).toBe(200); expect((await publish(o.key, a)).status).toBe(200);
    expect((await j(await call("GET", `/api/z/${a}/info`))).roomMode).toBe(true);
    const cp = await call("POST", `/api/z/${a}/clone`, {}, o.h); expect(cp.status).toBe(200);
    const id = ((await cp.json()) as any).id; expect((await j(await call("GET", `/api/z/${id}/info`, undefined, o.h))).roomMode).toBe(true); // a copy keeps the choice
  });
});
