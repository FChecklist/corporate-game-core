// The player page offers "Leave this game" and "What do you hold about me / delete me" (U5, U6): real page scripts in a DOM, real Worker code, in-memory database.
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { createHash } from "node:crypto";
import { newWorld, openPage, roundAt, T, type Page } from "./harness";

setDefaultTimeout(30_000);
const START = roundAt(T) + 1200;
const rnd = (r: number) => createHash("sha256").update("fake" + r).digest("hex");
let open: Page[] = [];
afterEach(async () => { for (const p of open) await p.close(); open = []; });

async function organizer() {
  const w = newWorld();
  const s = await w.json(await w.api("POST", "/api/start", { email: "boss@acme.com" }));
  return { ...w, token: s.token as string, aiKey: s.aiKey as string };
}
type O = Awaited<ReturnType<typeof organizer>>;
const rtFake = (win: any, nowMs: () => number) => {
  const Orig = win.ZG.PhoneRuntime;
  win.ZG.PhoneRuntime = class extends Orig {
    constructor(eid: string, deps: any) {
      super(eid, { ...deps, beacon: { fetcher: async (url: string) => { const last = url.split("/").pop()!; const r = last === "latest" ? roundAt(nowMs()) : Number(last); return { ok: true, status: 200, json: async () => ({ round: r, randomness: rnd(r), signature: "aa" }) }; } } });
    }
  };
};
async function player(o: O, id: string) {
  await o.api("POST", "/api/z", { id, startRound: START, callSeconds: 9, cap: 100 }, o.aiKey);
  await o.api("POST", `/api/z/${id}/publish`, { email: "boss@acme.com", phone: "98765 43210" }, o.token);
  const p = await openPage(o.world, { url: `http://localhost/z?e=${id}`, html: "z.html", scripts: ["audio.js", "zgame.js", "z.js", "rights.js"], tick: true, afterLoad: (win, f) => { if (f === "zgame.js") rtFake(win, () => o.world.now); } });
  open.push(p);
  await p.waitFor((x) => /Join the (game|engagement)/.test(x));
  (p.$("#nm") as any).value = "Maya Lopez"; p.click("#go");
  await p.waitFor((x) => /You are in|Your card|What you can win/.test(x));
  return p;
}
const body = (p: Page) => String(p.win.document.body.textContent ?? "").replace(/\s+/g, " ");
const until = async (p: Page, pred: () => boolean, ms = 6000) => { const t0 = Date.now(); while (!pred()) { if (Date.now() - t0 > ms) throw new Error("timed out; page says: " + body(p).slice(0, 800)); await new Promise((r) => setTimeout(r, 25)); } };
const count = (o: O, sql: string) => (o.world.raw.query(sql).get() as any).c as number;

describe("the player page offers the player's rights", () => {
  test("once the player has a card, the page shows both controls outside the game screen; they are real buttons with names", async () => {
    const o = await organizer(); const p = await player(o, "RP-1");
    await until(p, () => !!p.$("#rt-leave") && !!p.$("#rt-hold"));
    expect(p.$("#rt-leave").tagName).toBe("BUTTON"); expect(p.$("#rt-leave").textContent).toBe("Leave this game");
    expect(p.$("#rt-hold").textContent).toBe("What do you hold about me / delete me");
    expect(p.win.document.getElementById("app")!.contains(p.$("#rt-leave"))).toBe(false); // the game redraws #app every second: the controls must live outside it
  });
  test("Leave: asks first, then removes the seat and the name and says so in plain words", async () => {
    const o = await organizer(); const p = await player(o, "RP-2");
    await until(p, () => !!p.$("#rt-leave"));
    expect(count(o, "SELECT COUNT(*) c FROM seat WHERE eid='RP-2'")).toBe(1);
    p.click("#rt-leave"); await until(p, () => !!p.$("#rt-yes"));
    expect(body(p)).toMatch(/Leave this game\?/); expect(count(o, "SELECT COUNT(*) c FROM seat WHERE eid='RP-2'")).toBe(1); // asking is not leaving
    p.click("#rt-no"); expect(count(o, "SELECT COUNT(*) c FROM seat WHERE eid='RP-2'")).toBe(1);
    p.click("#rt-leave"); await until(p, () => !!p.$("#rt-yes")); p.click("#rt-yes");
    await until(p, () => /You have left the game/.test(body(p)));
    expect(body(p)).toMatch(/deleted/);
    expect(count(o, "SELECT COUNT(*) c FROM seat WHERE eid='RP-2'")).toBe(0); expect(count(o, "SELECT COUNT(*) c FROM participant WHERE eid='RP-2'")).toBe(0);
    expect(p.win.localStorage.getItem("cbz:device")).toBeNull(); // this phone forgot the game too
  });
  test("What do you hold about me: shows the promised time before sending, then the answer, what is held, and records the request", async () => {
    const o = await organizer(); const p = await player(o, "RP-3");
    await until(p, () => !!p.$("#rt-hold"));
    p.click("#rt-hold"); await until(p, () => !!p.$("#rt-form"));
    expect(body(p)).toMatch(/within 7 days/);
    expect(Array.from(p.win.document.querySelectorAll('input[name="rt-kind"]')).map((i: any) => i.value)).toEqual(["access", "correction", "erasure", "nomination"]);
    p.click("#rt-send");
    await until(p, () => /We have your request/.test(body(p)));
    expect(body(p)).toMatch(/Maya Lopez/); expect(body(p)).toMatch(/within 7 days/); expect(body(p)).toMatch(/Your \w+ number/);
    expect(o.world.raw.query("SELECT kind, status FROM data_request").all()).toEqual([{ kind: "access", status: "open" }]);
    expect(count(o, "SELECT COUNT(*) c FROM seat WHERE eid='RP-3'")).toBe(1); // asking to see is not deleting
  });
  test("Name another person (DPDP Act s14): choosing it shows the e-mail route; sending asks for 'nomination' and nothing is deleted", async () => {
    const o = await organizer(); const p = await player(o, "RP-N");
    await until(p, () => !!p.$("#rt-hold"));
    p.click("#rt-hold"); await until(p, () => !!p.$("#rt-form"));
    expect((p.$("#rt-nom") as any).hidden).toBe(true);
    (p.win.document.querySelector('input[value="nomination"]') as any).click(); await new Promise((r) => setTimeout(r, 20));
    expect((p.$("#rt-nom") as any).hidden).toBe(false); expect(body(p)).toContain("hello@corporatetambola.com"); expect(p.$("#rt-nom a")!.getAttribute("href")).toBe("mailto:hello@corporatetambola.com?subject=%5BBingo%5D%20");
    expect(p.$("#rt-send").textContent).toBe("Send"); expect((p.$("#rt-warn") as any).hidden).toBe(true);
    p.click("#rt-send");
    await until(p, () => /We have your request/.test(body(p)));
    expect(o.world.raw.query("SELECT kind, status FROM data_request").all()).toEqual([{ kind: "nomination", status: "open" }]);
    expect(count(o, "SELECT COUNT(*) c FROM seat WHERE eid='RP-N'")).toBe(1); // nothing is deleted
  });
  test("Delete me: the erasure choice warns, then deletes at once", async () => {
    const o = await organizer(); const p = await player(o, "RP-4");
    await until(p, () => !!p.$("#rt-hold"));
    p.click("#rt-hold"); await until(p, () => !!p.$("#rt-form"));
    (p.win.document.querySelector('input[value="erasure"]') as any).click(); await new Promise((r) => setTimeout(r, 20));
    expect((p.$("#rt-warn") as any).hidden).toBe(false); expect(p.$("#rt-send").textContent).toBe("Delete me now");
    p.click("#rt-send");
    await until(p, () => /deleted just now/i.test(body(p)));
    expect(count(o, "SELECT COUNT(*) c FROM seat WHERE eid='RP-4'")).toBe(0);
    expect(o.world.raw.query("SELECT kind, status FROM data_request").all()).toEqual([{ kind: "erasure", status: "done" }]);
  });
});
