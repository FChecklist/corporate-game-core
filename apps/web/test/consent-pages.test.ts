// The Terms boxes as a person meets them on the pages (real page scripts in a DOM, real Worker code, in-memory database): never ticked, the button stays off until
// every box is ticked, the request carries the ticks, and the server answer is shown if a box is missing. The other page tests tick the boxes for the person (harness tick option).
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { createHash } from "node:crypto";
import { newWorld, openPage, roundAt, T, type Page } from "./harness";

setDefaultTimeout(30_000);
const START = roundAt(T) + 1200;
const rnd = (r: number) => createHash("sha256").update("fake" + r).digest("hex");
let open: Page[] = [];
afterEach(async () => { for (const p of open) await p.close(); open = []; });

async function organizer(extra: Record<string, string> = {}) {
  const w = newWorld(extra);
  const s = await w.json(await w.api("POST", "/api/start", { email: "boss@acme.com" }));
  return { ...w, token: s.token as string, aiKey: s.aiKey as string, aiMessage: s.aiMessage as string };
}
type O = Awaited<ReturnType<typeof organizer>>;
const make = (o: O, id: string) => o.api("POST", "/api/z", { id, startRound: START, callSeconds: 9, cap: 100 }, o.aiKey);
const publish = (o: O, id: string) => o.api("POST", `/api/z/${id}/publish`, { email: "boss@acme.com", phone: "98765 43210" }, o.token);
async function page(o: O, url: string, html: string, scripts: string[], session: Record<string, string> = {}, extra: Partial<Parameters<typeof openPage>[1]> = {}) {
  const p = await openPage(o.world, { url: "http://localhost" + url, html, scripts, session, tick: false, ...extra }); open.push(p); return p;
}
const rtFake = (win: any, nowMs: () => number) => {
  const Orig = win.ZG.PhoneRuntime;
  win.ZG.PhoneRuntime = class extends Orig {
    constructor(eid: string, deps: any) {
      super(eid, { ...deps, beacon: { fetcher: async (url: string) => { const last = url.split("/").pop()!; const r = last === "latest" ? roundAt(nowMs()) : Number(last); return { ok: true, status: 200, json: async () => ({ round: r, randomness: rnd(r), signature: "aa" }) }; }, mirrors: ["https://a.test"], timeoutMs: 1000 } });
    }
  };
};
const tick = (p: Page, id: string) => { const i = p.win.document.getElementById(id) as any; i.checked = true; i.dispatchEvent(new p.win.Event("change", { bubbles: true })); };
const rows = (o: O, kind: string) => o.world.raw.query("SELECT * FROM consent_log WHERE kind=? ORDER BY at_ms, id").all(kind) as any[];

describe("K4 the join page", () => {
  test("two boxes before any name field, unticked; the button is off until both are ticked; the join carries both ticks and is stored", async () => {
    const o = await organizer(); await make(o, "CP-JOIN"); await publish(o, "CP-JOIN");
    const p = await page(o, "/z?e=CP-JOIN", "z.html", ["audio.js", "zgame.js", "z.js"], {}, { afterLoad: (win, f) => { if (f === "zgame.js") rtFake(win, () => o.world.now); } });
    await p.waitFor((x) => /Join the game/.test(x));
    const doc = p.win.document, boxes = Array.from(doc.querySelectorAll('[data-cbc="K4"] input[type=checkbox]')) as any[];
    expect(boxes.map((b) => b.checked)).toEqual([false, false]);
    expect(Array.from(doc.querySelectorAll('[data-cbc="K4"] label')).map((l: any) => l.textContent)).toEqual([
      "I agree that my name (and my mobile number, only if this game asks for it) is used for this game only and deleted within 24 hours after it ends. I know who invited me is recorded until then. If I win, my name (and my mobile number, if I gave one) and prize record are kept for 365 days so the prize can be handed over. We keep billing data for audit and tax reasons. This notice is available in Hindi on request.",
      "I am 18 or older."]);
    const html = p.html(); expect(html.indexOf('data-cbc="K4"')).toBeGreaterThan(-1); expect(html.indexOf('data-cbc="K4"')).toBeLessThan(html.indexOf('id="nm"')); // before any name field
    const go = p.$("#go") as any;
    expect([go.disabled, go.getAttribute("aria-disabled")]).toEqual([true, "true"]);
    (p.$("#nm") as any).value = "Asha"; go.click(); await new Promise((r) => setTimeout(r, 50)); // pressing a disabled button does nothing
    expect(o.world.raw.query("SELECT COUNT(*) c FROM participant").get()).toEqual({ c: 0 });
    tick(p, "cbc-K4-A"); expect((p.$("#go") as any).disabled).toBe(true);
    tick(p, "cbc-K4-B"); expect([(p.$("#go") as any).disabled, (p.$("#go") as any).getAttribute("aria-disabled")]).toEqual([false, "false"]);
    p.click("#go"); await p.waitFor((x) => /You are in|Your card|What you can win/.test(x));
    const k4 = rows(o, "K4"); expect(k4).toHaveLength(1); expect(k4[0]).toMatchObject({ kind: "K4", ref: "CP-JOIN", boxes: "A,B" });
    expect(p.errors).toEqual([]);
  });
});

describe("K1 publish on the console", () => {
  test("the Publish button is off until both boxes are ticked; the publish carries them", async () => {
    const o = await organizer(); await make(o, "CP-PUB");
    const p = await page(o, "/zc?e=CP-PUB", "zc.html", ["zgame.js", "control.js", "zc.js"], { "cbz-org": o.token, "cbz-aimsg": o.aiMessage, "cbz-email": "boss@acme.com" });
    await p.waitFor((x) => /Hello\. Let us start/.test(x)); p.click('.zc-dot[data-open="7"]');
    await p.waitFor((x) => /Publish \(free\)/.test(x)); p.click("#publishopen");
    await p.waitFor((x) => /Confirm and publish/.test(x));
    const doc = p.win.document;
    expect((Array.from(doc.querySelectorAll('[data-cbc="K1"] input')) as any[]).map((b) => b.checked)).toEqual([false, false]);
    expect([(p.$("#pubgo") as any).disabled, (p.$("#pubgo") as any).getAttribute("aria-disabled")]).toEqual([true, "true"]);
    (p.$("#pubPhone") as any).value = "98765 43210"; (p.$("#pubPhone") as any).dispatchEvent(new p.win.Event("input", { bubbles: true }));
    tick(p, "cbc-K1-A"); expect((p.$("#pubgo") as any).disabled).toBe(true);
    tick(p, "cbc-K1-B"); expect((p.$("#pubgo") as any).disabled).toBe(false);
    p.click("#pubgo"); await p.waitFor((x) => /Published/.test(x));
    const k1 = rows(o, "K1"); expect(k1).toHaveLength(1); expect(k1[0]).toMatchObject({ ref: "CP-PUB", boxes: "A,B" });
  });
});

describe("K2 the Create your game pop-up", () => {
  test("the box sits above the button, the button starts off, Google sign-up waits for the tick, and the sign-up carries the ticks", async () => {
    const site = await Bun.file(new URL("../public/site.js", import.meta.url)).text();
    expect(site).toContain('CBConsent.html("K2")'); expect(site).toContain('id="frGo" disabled aria-disabled="true"');
    expect(site.indexOf('CBConsent.html("K2")')).toBeLessThan(site.indexOf('id="frGo"'));
    expect(site).toContain('consent: CBConsent.payload(k2, "K2")'); expect(site).toContain('mountGoogle("signup", () => (CBConsent.all(k2, "K2")');
    const g = await Bun.file(new URL("../public/google.js", import.meta.url)).text();
    expect(g).toContain("Please tick the box to continue."); // the Google button never signs anyone up without the tick
  });
});

describe("K5 a Co-host takes the role", () => {
  test("until the box is ticked the Co-host sees only the acceptance; after it the console opens", async () => {
    const o = await organizer(); await make(o, "CP-COH"); await publish(o, "CP-COH");
    const ck = (await o.json(await o.api("POST", "/api/org/cohost", { label: "Ravi", phone: "9811100099", eid: "CP-COH" }, o.token))).cohostKey as string;
    const p = await page(o, "/zc?e=CP-COH", "zc.html", ["zgame.js", "control.js", "zc.js"], { "cbz-org": ck, "cbz-email": "boss@acme.com" });
    await p.waitFor((x) => /Before you start/.test(x));
    expect([(p.$("#roleacceptgo") as any).disabled]).toEqual([true]);
    expect((p.win.document.querySelector('[data-cbc="K5"] input') as any).checked).toBe(false);
    tick(p, "cbc-K5-A"); expect((p.$("#roleacceptgo") as any).disabled).toBe(false);
    p.click("#roleacceptgo"); await p.waitFor((x) => /Today's game|Invite people/.test(x));
    expect(rows(o, "K5")).toHaveLength(1);
  });
});

describe("K3 the payment page", () => {
  test("the pay button is off until the box is ticked", async () => {
    const o = await organizer({ TEST_MODE: "1" }); await make(o, "CP-PAY"); await publish(o, "CP-PAY");
    const p = await page(o, "/pay?e=CP-PAY", "pay.html", ["common.js", "pay.js"], { "cbz-org": o.token, "cbz-email": "boss@acme.com" });
    await p.waitFor((x) => /Payment/.test(x) && !!p.$("#paygo"));
    expect((p.win.document.querySelector('[data-cbc="K3"] input') as any).checked).toBe(false);
    expect([(p.$("#paygo") as any).disabled, (p.$("#paygo") as any).getAttribute("aria-disabled")]).toEqual([true, "true"]);
    tick(p, "cbc-K3-A"); expect((p.$("#paygo") as any).disabled).toBe(false);
  });
});
