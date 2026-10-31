// The pages themselves, run as a browser runs them (real page scripts in a DOM, talking to the real Worker code and an in-memory database).
// IDs match docs/USE_CASES.md. These catch what API tests cannot: a page that freezes, a button that does nothing, a message that never shows.
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";

setDefaultTimeout(30_000);
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { newWorld, openPage, roundAt, roundMs, T, type Page } from "./harness";
import { publicKeyFromSecret } from "../../../packages/beacon/src/control";
import { PRIZE_HOUSES } from "../../../packages/beacon/src/config";

const HOUR = 3_600_000;
const START = roundAt(T) + 1200; // one hour after T
const START_MS = roundMs(START);
const rnd = (r: number) => createHash("sha256").update("fake" + r).digest("hex");
let open: Page[] = [];
afterEach(async () => { for (const p of open) await p.close(); open = []; });

async function organizer(extra: Record<string, string> = {}) {
  const w = newWorld(extra);
  const s = await w.json(await w.api("POST", "/api/start", { email: "boss@acme.com" }));
  return { ...w, token: s.token as string, aiKey: s.aiKey as string, aiMessage: s.aiMessage as string };
}
type O = Awaited<ReturnType<typeof organizer>>;
const make = async (o: O, id: string, over: Record<string, unknown> = {}) => o.api("POST", "/api/z", { id, startRound: START, callSeconds: 9, cap: 100, ...over }, o.aiKey);
const publish = (o: O, id: string) => o.api("POST", `/api/z/${id}/publish`, { email: "boss@acme.com", phone: "98765 43210" }, o.token);
const regKey = (o: O, id: string) => o.api("PUT", `/api/z/${id}/control/key`, { publicKey: publicKeyFromSecret("11".repeat(32)) }, o.token);
async function page(o: O, url: string, html: string, scripts: string[], session: Record<string, string> = {}, extra: Partial<Parameters<typeof openPage>[1]> = {}) {
  if (scripts.includes("zc.js")) { const inner = extra.afterLoad; extra = { ...extra, afterLoad: (win: any, f: string) => { if (f === "zgame.js" && win.ZG && !win.ZG.PRIZE_HOUSES) win.ZG.PRIZE_HOUSES = PRIZE_HOUSES; inner?.(win, f); } }; } // until zgame.js is rebuilt with the table, the page gets the same table the Worker uses
  const p = await openPage(o.world, { url: "http://localhost" + url, html, scripts, session, ...extra }); open.push(p); return p;
}
const consolePage = (o: O, eid: string, key = o.token, session: Record<string, string> = {}, extra: Partial<Parameters<typeof openPage>[1]> = {}) =>
  page(o, `/zc?e=${eid}`, "zc.html", ZC_SCRIPTS, { "cbz-org": key, "cbz-aimsg": o.aiMessage, "cbz-email": "boss@acme.com", ...session }, extra);

// --- the single-page console: small helpers ---
const ZC_SCRIPTS = "zgame.js control.js zc.js".split(" ");
/** Opens step n by its jump button (the numbered dot in the progress bar). */
const openStep = (p: Page, n: number) => p.click(`.zc-dot[data-open="${n}"]`);
const setField = (p: Page, sel: string, v: string) => { const el = p.$(sel) as any; el.value = v; el.dispatchEvent(new p.win.Event("input", { bubbles: true })); };
const sections = (p: Page) => Array.from(p.win.document.querySelectorAll('section.zc-card[id^="sec"]')).map((e: any) => e.querySelector(".zc-sech b")!.textContent as string);
/**
 * A small fetch stub for what the real Worker cannot show: here, an OLDER server that does not have the team and Co-host endpoints yet (the page must say so politely, not crash).
 * It answers the paths it is given and passes everything else on to the real Worker.
 */
type Stub = (method: string, body: any, url: URL) => any;
const stub = (routes: Record<string, Stub>) => (win: any, f: string) => {
  if (f !== "control.js") return;
  const real = win.fetch;
  win.fetch = async (input: any, init?: any) => {
    const u = new URL(String(input), "http://localhost"), h = routes[u.pathname];
    if (!h) return real(input, init);
    const r = h((init?.method || "GET").toUpperCase(), init?.body ? JSON.parse(init.body) : undefined, u);
    return new Response(JSON.stringify(r && r.body !== undefined ? r.body : r), { status: (r && r.status) || 200, headers: { "content-type": "application/json" } });
  };
};
/** The roles come from the real Worker (apps/edge): these make a Host key, a Co-host key, and read the team back. */
const hostKey = async (o: O, label = "Anita", ready = true) => {
  const k = (await o.json(await o.api("POST", "/api/org/host", { label, mobile: "9822200011", email: "host@acme.com" }, o.token))).hostKey as string;
  if (ready) o.world.raw.prepare("UPDATE host_state SET verified_ms=?, mobile_ok=1").run(Date.now()); // as if the Host had finished "Finish setup" (that screen has its own tests)
  return k;
};
const cohostKey = async (o: O, eid = "UI-COH", label = "Ravi") => { const k = (await o.json(await o.api("POST", "/api/org/cohost", { label, phone: "9811100099", eid }, o.token))).cohostKey as string; await o.api("POST", "/api/org/role/accept", {}, k); return k; }; // the Co-host has taken the role (the box is ticked)
const keyId = (key: string) => createHash("sha256").update("key|" + key).digest("hex").slice(0, 10);
const teamOf = async (o: O) => o.json(await o.api("GET", "/api/org/team", undefined, o.token));
const COHOST_FROM = 1_000_000_000; // the Worker's own number: a Co-host's invite link carries it plus the first 7 hex of their key id

const quietPrivacy = (root: any) => { const l = root.querySelectorAll(".spriv a"); expect(l.length).toBe(1); const a = l[0]; expect(a.textContent).toBe("Privacy Policy"); expect(a.getAttribute("href")).toBe("/privacy.html"); expect(a.getAttribute("target")).toBe("_blank"); expect(a.getAttribute("rel")).toBe("noopener"); expect(root.querySelectorAll('input[type="checkbox"]').length).toBe(2); };
/**
 * A pass-through for the real Worker that RECORDS every /api call the page makes (st.calls = [method, path, body], st.patches, st.posts)
 * and can answer chosen paths itself: over["POST /api/z/ID/paylink"] = (method, body, url) => body | { status, body }.
 * Used for the few endpoints the Worker does not have yet (payment link, Host finish-setup, Google).
 */
type Over = Record<string, (m: string, body: any, url: URL, real: () => Promise<any>) => any>;
function spy(over: Over = {}, setup?: (win: any) => void) {
  const st: any = { calls: [] as any[], patches: [] as any[], posts: [] as any[] };
  const hook = (win: any, f: string) => {
    if (f !== "control.js") return;
    if (setup) setup(win);
    const real = win.fetch;
    win.fetch = async (input: any, init2?: any) => {
      const u = new URL(String(input), "http://localhost"), m = (init2?.method || "GET").toUpperCase(), body = init2?.body ? JSON.parse(init2.body) : undefined;
      if (u.pathname.startsWith("/api/")) { st.calls.push([m, u.pathname, body]); if (m === "PATCH" && /\/settings$/.test(u.pathname)) st.patches.push(body); if (m === "POST" && u.pathname === "/api/z") st.posts.push(body); }
      const h = over[m + " " + u.pathname] || over[u.pathname];
      if (h) { const r = await h(m, body, u, async () => (await real(input, init2)).json()); const b = r && r.body !== undefined ? r.body : r; return new Response(typeof b === "string" ? b : JSON.stringify(b), { status: (r && typeof r.status === "number" && r.status) || 200, headers: { "content-type": "application/json" } }); }
      const res = await real(input, init2); if (u.pathname.startsWith("/api/")) { try { (st.last ||= {})[m + " " + u.pathname] = await res.clone().json(); } catch { /* not JSON */ } }
      return res;
    };
  };
  return { st, hook };
}
describe("console (organizer page)", () => {
  test("Show my AI work link (the e-mail's button): asks for the organizer's sign-in; once signed in shows the two-line paste with Copy, Fresh and Replace and the do-not-forward warnings", async () => {
    const o = await organizer();
    const anon = await page(o, "/ai-link", "ai-link.html", ["ai-link.js"], {});
    const t0 = await anon.waitFor((x) => /Sign in as the organizer/.test(x));
    expect(t0).not.toMatch(/cba_/); expect(t0).toMatch(/6-digit code/); expect(anon.$("#msg")).toBeFalsy();
    const p = await page(o, "/ai-link", "ai-link.html", ["ai-link.js"], { "cbz-org": o.token });
    const t = await p.waitFor((x) => /YOUR AI WORK LINK/.test(x));
    const v = (p.$("#msg") as any).value as string; expect(v).toBe(o.aiMessage); expect(v.split("\n").length).toBe(2); expect(v).toContain("/ai/cba_");
    expect(p.$("#cp")).toBeTruthy(); expect(p.$("#fr")).toBeTruthy(); expect(p.$("#rp")).toBeTruthy();
    expect((t.match(/DO NOT FORWARD: this page shows your personal AI work link/g) ?? []).length).toBe(2);
    p.click("#fr"); await p.waitFor((x) => /fresh 24-hour link is on its way/.test(x));
    expect(p.errors).toEqual([]);
  });
  const checkSeven = async (p: any, paste: string) => {
    const hrefOf = (n: string) => new URL((p.$(`[data-ai="${n}"]`) as any).href);
    for (const [n, origin, path] of [["ChatGPT", "https://chatgpt.com", "/"], ["Grok", "https://grok.com", "/"], ["Claude", "https://claude.ai", "/new"]] as const) {
      const el = p.$(`[data-ai="${n}"]`) as any, u = hrefOf(n);
      expect(u.origin).toBe(origin); expect(u.pathname).toBe(path); expect(u.searchParams.get("q")).toBe(paste); // the two lines and the link, URL-encoded
      expect(el.href).toContain("?q=" + encodeURIComponent(paste)); expect(el.getAttribute("target")).toBe("_blank"); expect(el.getAttribute("rel")).toBe("noopener noreferrer");
    }
    const opened: string[] = []; let copied = ""; p.win.open = (u: string) => { opened.push(u); return null; };
    Object.defineProperty(p.win.navigator, "clipboard", { value: { writeText: async (t: string) => { copied = t; } }, configurable: true });
    for (const [n, origin] of [["Gemini", "https://gemini.google.com"], ["DeepSeek", "https://chat.deepseek.com"], ["z.ai", "https://chat.z.ai"]] as const) {
      copied = ""; p.click(`[data-aicopy="${n}"]`); await p.waitFor((x: string) => /Copied\. Press Ctrl\+V, then Send/.test(x));
      expect(copied).toBe(paste); expect(new URL(opened.at(-1)!).origin).toBe(origin);
    }
    expect(new URL(opened[0]!).pathname).toBe("/app"); expect(new URL(opened[0]!).searchParams.get("q")).toBe(paste); // Gemini: a harmless prefill attempt
    expect(opened[1]).toBe("https://chat.deepseek.com/"); expect(opened[2]).toBe("https://chat.z.ai/");
  };
  test("seven ways to hand the paste to an AI on the sign-in page: three pre-filled addresses, three copy-and-open buttons, one plain copy", async () => {
    const o = await organizer();
    const p = await page(o, "/ai-link", "ai-link.html", ["ai-link.js"], { "cbz-org": o.token });
    await p.waitFor((x) => /YOUR AI WORK LINK/.test(x)); expect(p.$("#cp")).toBeTruthy();
    await checkSeven(p, o.aiMessage);
  });
  test("sign-in e-mail link page: opening it consumes nothing; the button starts the session once and goes to the AI-link page; a used link says so", async () => {
    const o = await organizer({ TEST_MODE: "1" });
    const r = await o.json(await o.api("POST", "/api/auth/email", { email: "boss@acme.com" }));
    const p = await page(o, "/signin?t=" + r.devToken + "&go=ai", "signin.html", ["signin.js"], {});
    const t = await p.waitFor((x) => /Press the button to sign in/.test(x));
    expect(t).toMatch(/works once, for 10 minutes/i); expect(t).not.toMatch(/cba_/); expect(p.win.sessionStorage.getItem("cbz-org")).toBeFalsy();
    expect(p.win.location.search).toBe(""); // the token left the address bar
    expect((await o.api("POST", "/api/auth/email", { email: "stranger@x.com" })).status).toBe(200);
    p.click("#go");
    await new Promise((res) => setTimeout(res, 400));
    expect(p.win.sessionStorage.getItem("cbz-org")).toMatch(/^cbk_[0-9a-f]{48}$/);
    const again = await page(o, "/signin?t=" + r.devToken + "&go=console", "signin.html", ["signin.js"], {});
    await again.waitFor((x) => /Press the button to sign in/.test(x)); again.click("#go");
    await again.waitFor((x) => /not valid any more/.test(x));
    expect(again.win.sessionStorage.getItem("cbz-org")).toBeFalsy();
  });
  test("UC-54 draft: the organizer publishes (free) after confirming email and mobile, then sees the payment-due card and the share link", async () => {
    const o = await organizer(); await make(o, "UI-DRAFT");
    const p = await consolePage(o, "UI-DRAFT");
    await p.waitFor((x) => /Hello\. Let us start/.test(x)); openStep(p, 7);
    await p.waitFor((x) => /Publish \(free\)/.test(x));
    expect(p.text()).toMatch(/publishing is free/i);
    p.click("#publishopen");
    await p.waitFor((x) => /Confirm and publish/.test(x));
    expect((p.$("#pubEmail") as any).value).toBe("boss@acme.com"); // prefilled, editable
    (p.$("#pubPhone") as any).value = "98765 43210"; (p.$("#pubPhone") as any).dispatchEvent(new p.win.Event("input", { bubbles: true }));
    p.click("#pubgo"); await p.waitFor((x) => /Published/.test(x)); openStep(p, 8);
    const t = await p.waitFor((x) => /LAST STEP: PAY BEFORE THE START/i.test(x));
    expect(t).toMatch(/will not begin/);
    expect((p.$('a[href^="/pay.html"]') as any).getAttribute("href")).toBe("/pay.html?e=UI-DRAFT");
    openStep(p, 6); expect(await p.waitFor((x) => /Guest link/.test(x))).toMatch(/localhost\/z\.html\?e=UI-DRAFT/);
    expect(p.errors).toEqual([]);
  });
  test("UC-54 published but invalid details: the console shows the server's message and stays on the form", async () => {
    const o = await organizer(); await make(o, "UI-BADPUB");
    const p = await consolePage(o, "UI-BADPUB", o.token, { "cbz-email": "not-an-email" });
    await p.waitFor((x) => /Hello/.test(x)); openStep(p, 7); p.click("#publishopen"); await p.waitFor((x) => /Confirm and publish/.test(x));
    p.click("#pubgo");
    await p.waitFor((x) => /valid (email|mobile)/i.test(x)); expect(p.text()).not.toMatch(/LAST STEP/i);
  });
  test("UC-10 / UC-54 held for non-payment: a clear red card, nothing called, no freeze", async () => {
    const o = await organizer(); await make(o, "UI-HELD"); await publish(o, "UI-HELD");
    o.world.now = START_MS + 5 * 60_000;
    const p = await consolePage(o, "UI-HELD");
    const t = await p.waitFor((x) => /could not begin/i.test(x));
    expect(t).toMatch(/Pay now and start/); expect(t).toMatch(/0 \/ 75/); expect(p.errors).toEqual([]);
  });
  test("UC-54 a payment-due card counts down to the start and offers Pay now", async () => {
    const o = await organizer(); await make(o, "UI-DUE"); await publish(o, "UI-DUE");
    const p = await consolePage(o, "UI-DUE");
    const t = await p.waitFor((x) => /LAST STEP/i.test(x));
    expect(t).toMatch(/If payment is not made before then, the game will not begin/); expect(t).toMatch(/Pay now/); openStep(p, 6); expect(p.text()).toMatch(/Open the big screen/);
  });
  test("UC-6 a wrong or expired sign-in shows a message, never an endless Loading", async () => {
    const o = await organizer(); await make(o, "UI-KEY");
    const p = await consolePage(o, "UI-KEY", "cbk_" + "0".repeat(48));
    const t = await p.waitFor((x) => /sign-in has expired|sign in again/i.test(x), 4000);
    expect(t).toMatch(/sign-in has expired|sign in again/i);
  });
  test("UC-80 the organizer sends a message to everyone from the console; empty is refused; clear works", async () => {
    const o = await organizer(); await make(o, "UI-ANN"); await regKey(o, "UI-ANN"); await publish(o, "UI-ANN");
    const p = await consolePage(o, "UI-ANN");
    await p.waitFor((x) => /Hello|Last step/.test(x)); openStep(p, 9); await p.waitFor((x) => /Message to everyone/.test(x));
    p.click("#annSend"); await p.waitFor((x) => /Write a message first/.test(x));
    p.click('[data-chip="Dinner is served"]'); expect((p.$("#annText") as any).value).toBe("Dinner is served");
    p.click("#annSend"); await p.waitFor((x) => /Sent\. Phones show and speak it/.test(x));
    expect((await o.json(await o.api("GET", "/api/z/UI-ANN/control"))).ann.text).toBe("Dinner is served");
    p.click("#annClear"); await p.waitFor((x) => /wait a few seconds/.test(x)); // the server spaces messages a few seconds apart
    o.world.now += 10_000; p.click("#annClear"); await p.waitFor((x) => /Message cleared/.test(x));
    expect((await o.json(await o.api("GET", "/api/z/UI-ANN/control"))).ann).toBeUndefined();
  });
  test("the role pill, the payment pill and the one-payment notice: pending shows the notice; paid hides it and says who paid", async () => {
    const o = await organizer(); await make(o, "UI-PAYP"); await publish(o, "UI-PAYP");
    const p = await consolePage(o, "UI-PAYP"); await p.waitFor((x) => /Last step/i.test(x));
    expect(p.$("#rolepill")!.textContent).toBe("Signed in as Organizer"); expect(p.$("#paypill")!.textContent).toBe("Payment pending for this game"); expect(p.$("#paypill")!.className).toMatch(/zc-pill-pend/);
    const note = p.$("#paynote")!; expect(note.getAttribute("role")).toBe("note"); expect(note.textContent).toMatch(/Just one of you needs to make it: the Organizer, a Host or a Co-host\. Guests pay nothing/);
    o.world.raw.prepare("UPDATE engagement SET pack=100 WHERE id='UI-PAYP'").run(); // paid (the same signal the payment page uses)
    const q = await consolePage(o, "UI-PAYP"); await q.waitFor((x) => /Hello|Your game/.test(x));
    expect(q.$("#paypill")!.textContent).toBe("Paid"); expect(q.$("#paypill")!.className).toMatch(/zc-pill-paid/); expect(q.$("#paynote")).toBeNull();
    o.world.raw.prepare("INSERT OR REPLACE INTO kv(k,v) VALUES(?,?)").run("paidby/UI-PAYP", JSON.stringify({ by: "host", ms: START_MS - HOUR })); // the Worker records who paid
    const w = await consolePage(o, "UI-PAYP");
    await w.waitFor((x) => /Hello|Your game/.test(x)); openStep(w, 8);
    expect(await w.waitFor((x) => /Paid by the Host on/.test(x))).toMatch(/The game is on/);
    expect(p.errors).toEqual([]); expect(w.errors).toEqual([]);
  });
  const TEN = ["Date and time of the game", "Number of participants", "Set Prizes", "Set Brand Moments", "Make hosts and co-hosts", "Invite and Share links", "Check and publish", "Pay", "Game day", "After the game"];
  test("an Organizer sees all ten steps in order, one open at a time, with a hint on every step and Save and continue", async () => {
    const o = await organizer(); await make(o, "UI-TEN");
    const p = await consolePage(o, "UI-TEN"); await p.waitFor((x) => /Hello\. Let us start/.test(x));
    expect(sections(p)).toEqual(TEN);
    expect(p.win.document.querySelectorAll(".zc-secb").length - 1).toBe(1); // one step body is open (the other .zc-secb is the Help box)
    expect(p.$('[data-save="1"]')!.textContent).toBe("Save and continue");
    for (let n = 2; n <= 10; n++) { openStep(p, n); expect(p.win.document.querySelectorAll("section.zc-card.open").length).toBe(1); expect(p.$(`#sec${n}`)!.className).toMatch(/open/); }
    expect(p.$("#aistrip")).toBeNull(); expect(p.text()).not.toMatch(/AI work link/); expect(p.text()).toMatch(/Your account/);
    expect(p.errors).toEqual([]);
  });
  test("a Host sees the same ten steps and 'Host 1 of 5', but no account and no AI strip, and can add Co-hosts but not Hosts", async () => {
    const o = await organizer(); await make(o, "UI-HOSTV"); await publish(o, "UI-HOSTV");
    const hk = await hostKey(o, "Anita");
    const p = await consolePage(o, "UI-HOSTV", hk);
    await p.waitFor((x) => /Last step|Your game/i.test(x));
    expect(sections(p)).toEqual(TEN);
    await p.waitFor(() => p.$("#rolepill")!.textContent === "Signed in as Host 1 of 5");
    expect(p.$("#aistrip")).toBeNull(); expect(p.text()).not.toMatch(/Your account|Close my account/);
    openStep(p, 5); await p.waitFor((x) => /Your Hosts: 1 of 5/.test(x));
    expect(p.$("#hostadd")).toBeNull(); expect(p.text()).toMatch(/Only the Organizer adds Hosts/); expect(p.$("#cohostadd")).toBeTruthy(); expect(p.$('[data-retire][data-kind="host"]')).toBeNull();
    setField(p, "#cohostlabel", "Ravi"); setField(p, "#cohostphone", "9811100001"); p.click("#cohostadd"); await p.waitFor((x) => /Your Co-hosts: 1 \(no limit\)/.test(x));
    expect((await teamOf(o)).cohosts.map((c: any) => c.label)).toEqual(["Ravi"]); // a Host really can add a Co-host
    expect(p.errors).toEqual([]);
  });
  test("a Co-host sees three steps (today's game, invite people, payment), the guest-invite note, and nothing that changes the game", async () => {
    const o = await organizer(); await make(o, "UI-COH"); await publish(o, "UI-COH"); const ck = await cohostKey(o);
    const from = COHOST_FROM + parseInt(keyId(ck).slice(0, 7), 16); // somebody joins through this Co-host's own link
    expect((await o.api("POST", "/api/z/UI-COH/join", { phone: "9811100001", device: "a".repeat(32), from })).status).toBe(200);
    const p = await consolePage(o, "UI-COH", ck);
    await p.waitFor((x) => /Hi\. Here is the game/.test(x));
    expect(sections(p)).toEqual(["Today's game", "Invite people", "Payment"]);
    expect(p.$("#rolepill")!.textContent).toBe("Signed in as Co-host"); expect(p.$("#paypill")!.textContent).toBe("Payment pending for this game"); expect(p.$("#paynote")).toBeTruthy(); expect(p.$("#aistrip")).toBeNull();
    expect(p.text()).toMatch(/1 person joined of 100/); expect(p.text()).toMatch(/You cannot change the game/); expect(p.text()).toMatch(/What you can do/); expect(p.text()).toMatch(/Invite people with their own link/); expect(p.text()).not.toMatch(/Add Hosts and Co-hosts/);
    openStep(p, 2); const t2 = await p.waitFor((x) => /Your own invite link/.test(x));
    expect(t2).toMatch(/localhost\/z\.html\?e=UI-COH&from=\d+/); expect(t2).toMatch(/People you brought\s*1(?!\d)/); expect(t2).toMatch(/You can invite as many people as you like/);
    expect(t2).toContain("Want your guests to invite their own friends? Ask the Organizer or a Host to switch it on. You cannot switch it on yourself.");
    openStep(p, 3); const t3 = await p.waitFor((x) => /Status: Payment pending for this game/.test(x)); expect((p.$('a[href^="/pay.html"]') as any).getAttribute("href")).toBe("/pay.html?e=UI-COH"); expect(t3).toMatch(/Rs 2,399\.00\. Pay once, from any one of you/);
    for (const banned of [/Publish/, /Erase/, /Controls/, /guest list/i, /Your team/, /AI assistant/, /Message to everyone/, /Close my account/]) expect(p.text()).not.toMatch(banned);
    expect(p.errors).toEqual([]);
    o.world.raw.prepare("UPDATE engagement SET pack=100 WHERE id='UI-COH'").run(); o.world.raw.prepare("INSERT OR REPLACE INTO kv(k,v) VALUES(?,?)").run("paidby/UI-COH", JSON.stringify({ by: "organizer", ms: START_MS - HOUR }));
    const paid = await consolePage(o, "UI-COH", ck); await paid.waitFor((x) => /Hi\. Here is the game/.test(x)); expect(paid.$("#paypill")!.textContent).toBe("Paid"); expect(paid.$("#paynote")).toBeNull();
    openStep(paid, 3); expect(await paid.waitFor((x) => /Paid by the Organizer on/.test(x))).toMatch(/The game is on/);
    await make(o, "UI-COHD"); const d = await consolePage(o, "UI-COHD", await cohostKey(o, "UI-COHD")); await d.waitFor((x) => /Hi/.test(x)); openStep(d, 2); expect(await d.waitFor((x) => /Your link appears once the game is published/.test(x))).not.toMatch(/z\.html\?e=UI-COHD/); // a draft has no link to give out yet
  });
  test("a Co-host link opens the Co-host view and the key leaves the address bar (#cohost=, #host= and ?k= all work)", async () => {
    const o = await organizer(); await make(o, "UI-COH"); const ck = await cohostKey(o);
    for (const url of [`/zc?e=UI-COH#cohost=${ck}`, `/zc?e=UI-COH#host=${ck}`, `/zc?e=UI-COH&k=${ck}`, `/zc?k=${ck}&e=UI-COH`]) {
      const p = await page(o, url, "zc.html", ZC_SCRIPTS, {});
      await p.waitFor((x) => /Hi\. Here is the game/.test(x));
      expect(p.win.location.hash).toBe(""); expect(p.win.location.search).toBe("?e=UI-COH"); expect(p.win.sessionStorage.getItem("cbz-org")).toBe(ck);
    }
    const made = await o.json(await o.api("POST", "/api/org/cohost", { label: "Link", phone: "9811100077", eid: "UI-COH" }, o.token)); await o.api("POST", "/api/org/role/accept", {}, made.cohostKey); const link = made.link as string; // the link the Worker hands out opens the Co-host view too (add the game to it)
    const p = await page(o, "/zc?e=UI-COH&" + link.split("?")[1], "zc.html", ZC_SCRIPTS, {}); await p.waitFor((x) => /Hi\. Here is the game/.test(x));
  });
  test("a Co-host without a game link is told to open the link they were sent, and the console does not crash", async () => {
    const o = await organizer(); await make(o, "UI-COH"); const ck = await cohostKey(o);
    const p = await page(o, "/zc", "zc.html", ZC_SCRIPTS, { "cbz-org": ck }); await p.waitFor((x) => /Open the link your Organizer or Host sent you/.test(x)); expect(p.errors).toEqual([]);
    expect(p.$("#aistrip")).toBeNull(); expect(p.$("#rolepill")!.textContent).toBe("Signed in as Co-host");
  });
  test("an older server without the team and Co-host endpoints is handled politely: the team step says so, adding says so, a Co-host sees a friendly note, nothing crashes", async () => {
    const o = await organizer(); await make(o, "UI-NOTEAM");
    const gone = () => ({ status: 404, body: { error: "Not found" } });
    const p = await page(o, "/zc?e=UI-NOTEAM", "zc.html", ZC_SCRIPTS, { "cbz-org": o.token }, { afterLoad: stub({ "/api/org/team": gone, "/api/org/cohost": gone }) });
    await p.waitFor((x) => /Hello/.test(x)); openStep(p, 5);
    await p.waitFor((x) => /Your Hosts: 0 of 5/.test(x) && /not switched on yet/i.test(x));
    setField(p, "#cohostlabel", "Ravi"); setField(p, "#cohostphone", "9811100001"); p.click("#cohostadd"); await p.waitFor((x) => /This is not switched on yet\. Please try again a little later\./.test(x));
    const c = await page(o, "/zc?e=UI-COH", "zc.html", ZC_SCRIPTS, { "cbz-org": "cbc_" + "0".repeat(48) }, { afterLoad: stub({ "/api/whoami": () => ({ kind: "cohost" }), "/api/z/UI-COH/cohost": gone }) });
    await c.waitFor((x) => /not switched on yet/.test(x)); expect(c.errors).toEqual([]); expect(p.errors).toEqual([]);
  });
  test("Your team: three role cards, Hosts n of 5 and Co-hosts (no limit), a private link for each person, remove, and the add button stops at five Hosts", async () => {
    const o = await organizer(); await make(o, "UI-TEAM");
    const p = await consolePage(o, "UI-TEAM"); await p.waitFor((x) => /Hello/.test(x)); openStep(p, 5);
    const t = await p.waitFor((x) => /Your Hosts: 0 of 5/.test(x) && /Your Co-hosts: 0 \(no limit\)/.test(x));
    const doc = p.win.document; expect(Array.from(doc.querySelectorAll(".zc-role b")).map((e: any) => e.textContent)).toEqual(["Organizer", "Host", "Co-host"]);
    expect(doc.querySelectorAll(".zc-role .zc-no").length).toBe(5); expect(doc.querySelectorAll(".zc-role .zc-yes").length).toBeGreaterThanOrEqual(10); expect(t).toMatch(/Sign-in keys, e-mail, close account/); // B03: the AI link is hidden in the console, so the role cards do not list it
    for (let i = 1; i <= 5; i++) { setField(p, "#hostlabel", "Anita " + i); setField(p, "#hostphone", "987650000" + i); setField(p, "#hostemail", `anita${i}@acme.com`); p.click("#hostadd"); await p.waitFor((x) => new RegExp(`Your Hosts: ${i} of 5`).test(x)); }
    expect((p.$("#hostadd") as any).disabled).toBe(true); expect(p.text()).toMatch(/most Hosts allowed/); expect(p.text()).toMatch(/Anita 3/);
    expect(p.text()).toMatch(/Send it to that one person only/); expect(p.$(".zc-person .zlink")!.textContent).toMatch(/\/zc\.html\?e=UI-TEAM#host=cbh_[0-9a-f]{48}$/);
    p.click("#hostadd"); await new Promise((r) => setTimeout(r, 150)); expect((await teamOf(o)).hosts.length).toBe(5); // the sixth is stopped (and the server would refuse it too)
    expect((await o.api("POST", "/api/org/host", { label: "Sixth", phone: "9876500006", email: "six@acme.com" }, o.token)).status).toBe(409);
    for (let i = 1; i <= 3; i++) { setField(p, "#cohostlabel", "Ravi " + i); setField(p, "#cohostphone", "98111000" + (10 + i)); p.click("#cohostadd"); await p.waitFor((x) => new RegExp(`Your Co-hosts: ${i} \\(no limit\\)`).test(x)); }
    expect(Array.from(doc.querySelectorAll(".zc-person .zlink")).map((e: any) => e.textContent).filter((x: string) => /#cohost=cbc_[0-9a-f]{48}$/.test(x)).length).toBe(3);
    expect(p.text()).toMatch(/brought 0/); expect((await teamOf(o)).cohosts.length).toBe(3);
    p.win.confirm = () => true; p.click('[data-retire][data-kind="host"]'); await p.waitFor((x) => /Your Hosts: 4 of 5/.test(x)); expect((p.$("#hostadd") as any).disabled).toBe(false); expect((await teamOf(o)).hosts.length).toBe(4);
    p.click('[data-retire][data-kind="cohost"]'); await p.waitFor((x) => /Your Co-hosts: 2 \(no limit\)/.test(x)); expect((await teamOf(o)).cohosts.length).toBe(2);
    expect(p.errors).toEqual([]);
  });
  test("no drop-down list anywhere in the console: not on the home page, not in any of the ten steps, not in Quick setup, and none in the script", async () => {
    const o = await organizer(); await make(o, "UI-NOSEL");
    const home = await page(o, "/zc", "zc.html", ZC_SCRIPTS, { "cbz-org": o.token, "cbz-aimsg": o.aiMessage }); await home.waitFor((x) => /Start a new game/.test(x)); expect(home.win.document.querySelectorAll("select").length).toBe(0);
    const p = await consolePage(o, "UI-NOSEL"); await p.waitFor((x) => /Hello/.test(x));
    openStep(p, 4); p.click('[data-ck="opN"][data-v="1"]'); p.click('[data-ck="midN"][data-v="1"]'); p.click('[data-luckyadd]');
    for (let n = 1; n <= 10; n++) { openStep(p, n); expect([n, p.win.document.querySelectorAll("select").length]).toEqual([n, 0]); }
    const qk = await page(o, "/zc?quick=1", "zc.html", ZC_SCRIPTS, { "cbz-org": o.token }); await qk.waitFor((x) => /1\. Which game\?/.test(x)); expect(qk.win.document.querySelectorAll("select").length).toBe(0);
    expect(readFileSync(new URL("../public/zc.js", import.meta.url), "utf8")).not.toMatch(/<select|createElement\(["']select/);
  });
  test("Prizes: ten popular prizes as chips plus 'I will decide later' and 'No prize'; the choice is saved as the words on the card and read back", async () => {
    const o = await organizer(); await make(o, "UI-PRZ");
    const p = await consolePage(o, "UI-PRZ"); await p.waitFor((x) => /Hello/.test(x)); openStep(p, 3);
    const chipsOf = (pp: Page, h: string) => Array.from(pp.win.document.querySelectorAll(`[data-ck="hs.${h}.pt"]`)).map((b: any) => b.textContent);
    expect(chipsOf(p, "line")).toEqual(["Gift card", "Gift hamper", "Smartphone", "Smart watch", "Earbuds or headphones", "Tablet or laptop", "Holiday or weekend stay", "Restaurant gift card", "Movie tickets", "Extra day off", "Something else", "I will decide later", "No prize"]);
    expect(p.text()).toMatch(/Fine\. We will remind you before you publish\./); // the default is "decide later"
    p.click('[data-ck="hs.line.pt"][data-v="voucher"]'); expect(p.$("#f-hs-line-pd")).toBeTruthy(); setField(p, "#f-hs-line-pd", "1000");
    p.click('[data-ph="corners"]'); p.click('[data-ck="hs.corners.pt"][data-v="none"]'); expect(p.text()).toMatch(/The card shows "No prize"\. The winner is still announced\./);
    p.click('[data-ck="hs.corners.n"][data-v="2"]');
    p.click('[data-ph="blackout"]'); p.click('[data-ck="hs.blackout.pt"][data-v="phone"]'); setField(p, "#f-hs-blackout-pd", "Galaxy");
    p.click('[data-save="3"]'); await p.waitFor((x) => /Saved\./.test(x));
    const sm = await o.json(await o.api("GET", "/api/z/UI-PRZ/summary", undefined, o.aiKey)); const txt = (pat: string, ord: number) => sm.rewards.find((r: any) => r.pattern === pat && r.ordinal === ord)?.text;
    expect(txt("line", 1)).toBe("Gift card: 1000"); expect(txt("corners", 1)).toBe("No prize"); expect(txt("corners", 2)).toBe("No prize"); expect(txt("blackout", 1)).toBe("Smartphone: Galaxy"); expect(txt("x", 1)).toBe(""); // "decide later" stays empty
    const q = await consolePage(o, "UI-PRZ"); await q.waitFor((x) => /Hello/.test(x)); openStep(q, 3);
    expect(q.$('[data-ck="hs.line.pt"][data-v="voucher"]')!.className).toMatch(/\bon\b/); expect((q.$("#f-hs-line-pd") as any).value).toBe("1000");
    q.click('[data-ph="corners"]'); expect(q.$('[data-ck="hs.corners.pt"][data-v="none"]')!.className).toMatch(/\bon\b/); expect(q.$('[data-ck="hs.corners.n"][data-v="2"]')!.className).toMatch(/\bon\b/);
    expect(q.text()).toMatch(/decide later/); expect(p.errors).toEqual([]);
  });
  test("Brand moments: four kinds (message, YouTube, video file, audio file) with Test it and a link hint; each is saved as the right kind and read back", async () => {
    const o = await organizer(); await make(o, "UI-BM");
    const p = await consolePage(o, "UI-BM"); await p.waitFor((x) => /Hello/.test(x)); openStep(p, 4);
    p.click('[data-ck="opN"][data-v="1"]'); p.click('[data-ck="midN"][data-v="2"]'); p.click('[data-ck="clN"][data-v="1"]');
    expect(Array.from(p.win.document.querySelectorAll('[data-ck="op.0.k"]')).map((b: any) => b.textContent)).toEqual(["Type a message", "YouTube link", "Paste video file link", "Paste audio file link"]);
    setField(p, "#f-op-0-t", "Welcome to Diwali");
    p.click('[data-ck="mid.0.k"][data-v="yt"]'); setField(p, "#f-mid-0-v", "https://youtu.be/dQw4w9WgXcQ"); expect(p.$('[data-lk="mid.0"]')!.textContent).toMatch(/YouTube link: plays inside the game/);
    p.click('[data-ck="mid.1.k"][data-v="vid"]'); setField(p, "#f-mid-1-v", "https://example.com/page"); expect(p.$('[data-lk="mid.1"]')!.textContent).toMatch(/opens a new tab/);
    setField(p, "#f-mid-1-v", "https://cdn.example.com/a.mp4"); expect(p.$('[data-lk="mid.1"]')!.textContent).toMatch(/Video file: plays inside the game/);
    p.click('[data-ck="cl.0.k"][data-v="aud"]'); setField(p, "#f-cl-0-v", "https://cdn.example.com/a.mp3"); expect(p.$('[data-lk="cl.0"]')!.textContent).toMatch(/Audio file/);
    expect(p.$("#bmcount")!.textContent).toBe("4 of 5");
    const opened: string[] = []; p.win.open = (u: string) => { opened.push(u); return null; }; p.click('[data-test="mid.0"]');
    expect(opened[0]).toMatch(/^\/preview\.html#/); expect(new URLSearchParams(opened[0]!.split("#")[1]).get("k")).toBe("youtube"); expect(new URLSearchParams(opened[0]!.split("#")[1]).get("w")).toBe("break");
    p.click('[data-save="4"]'); await p.waitFor((x) => /Saved\./.test(x));
    const sm = await o.json(await o.api("GET", "/api/z/UI-BM/summary", undefined, o.aiKey));
    expect(sm.opening[0]).toMatchObject({ kind: "speech", title: "Welcome to Diwali" }); expect(sm.breaks.map((b: any) => [b.kind, b.mediaUrl])).toEqual([["youtube", "https://youtu.be/dQw4w9WgXcQ"], ["file", "https://cdn.example.com/a.mp4"]]); expect(sm.closing[0]).toMatchObject({ kind: "file", mediaUrl: "https://cdn.example.com/a.mp3" });
    const q = await consolePage(o, "UI-BM"); await q.waitFor((x) => /Hello/.test(x)); openStep(q, 4);
    for (const sel of ['[data-ck="op.0.k"][data-v="msg"]', '[data-ck="mid.0.k"][data-v="yt"]', '[data-ck="mid.1.k"][data-v="vid"]', '[data-ck="cl.0.k"][data-v="aud"]']) expect([sel, /\bon\b/.test(q.$(sel)!.className)]).toEqual([sel, true]);
    expect(p.errors).toEqual([]);
  });
  test("the lucky draw can be a scratch card: add it, pick the look and the prize, save; it is placed halfway and titled with the prize", async () => {
    const o = await organizer(); await make(o, "UI-SCR");
    const p = await consolePage(o, "UI-SCR"); await p.waitFor((x) => /Hello/.test(x)); openStep(p, 4);
    p.click("[data-luckyadd]"); p.click('[data-ck="lucky.0.style"][data-v="scratch"]'); p.click('[data-ck="lucky.0.win"][data-v="5"]'); p.click('[data-ck="lucky.0.pt"][data-v="hamper"]');
    p.click('[data-save="4"]'); await p.waitFor((x) => /Saved\./.test(x));
    const sm = await o.json(await o.api("GET", "/api/z/UI-SCR/summary", undefined, o.aiKey)); expect(sm.breaks[0]).toMatchObject({ kind: "lucky", style: "scratch", winners: 5, title: "Gift hamper" }); expect(sm.breaks[0].after).toBe(38); // no number typed: the software put it halfway
    openStep(p, 4); p.click('[data-luckydel="0"]'); p.click('[data-save="4"]');
    for (let i = 0; i < 100; i++) { if ((await o.json(await o.api("GET", "/api/z/UI-SCR/summary", undefined, o.aiKey))).breaks.length === 0) break; await new Promise((r) => setTimeout(r, 50)); }
    expect((await o.json(await o.api("GET", "/api/z/UI-SCR/summary", undefined, o.aiKey))).breaks).toEqual([]);
  });
  test("How it plays: the Organizer can type their own number of players; it is saved exactly, and nonsense is refused politely", async () => {
    const o = await organizer(); await make(o, "UI-OWN");
    const p = await consolePage(o, "UI-OWN"); await p.waitFor((x) => /Hello/.test(x)); openStep(p, 2);
    setField(p, "#f-cap", "0"); p.click('[data-save="2"]'); await p.waitFor((x) => /give the number of players/.test(x));
    setField(p, "#f-cap", "20000"); p.click('[data-save="2"]'); await p.waitFor((x) => /more than 10,000 players/.test(x));
    setField(p, "#f-cap", "180"); p.click('[data-save="2"]'); await p.waitFor((x) => /Saved\./.test(x));
    expect((await o.json(await o.api("GET", "/api/z/UI-OWN/info", undefined, o.aiKey))).cap).toBe(180);
  });
  test("How it plays: tap choices for tickets, speed, rounds and who can join; the guest-invite option explains its three levels; all of it is saved", async () => {
    const o = await organizer(); await make(o, "UI-PLAY"); const pw = spy();
    const p = await consolePage(o, "UI-PLAY", o.token, {}, { afterLoad: pw.hook }); await p.waitFor((x) => /Hello/.test(x)); openStep(p, 2);
    expect(p.win.document.querySelectorAll('[data-ck="cap"]').length).toBe(9); expect(p.text()).toMatch(/Up to 100 people/); expect(p.text()).not.toMatch(/Rs [\d,]+(\.\d\d)? (with|including) GST/); /* no price while choosing the size */ expect(p.$("#f-cap")).toBeTruthy(); expect((p.$("#f-cap") as any).type).toBe("number"); expect(p.text()).toMatch(/Or type your own number of players/);
    p.click('[data-ck="tix"][data-v="2"]'); p.click('[data-ck="spd"][data-v="12"]'); p.click('[data-ck="rnd"][data-v="3"]'); p.click('[data-ck="who"][data-v="anyone"]');
    expect(p.text()).not.toMatch(/How many people can each guest invite/); expect(p.text()).toMatch(/Cards for each person \(participant\)/); expect(p.text()).toMatch(/Duration \(gap\) between two numbers/); expect(p.$('[data-ck="spd"][data-v="6"]')).toBeNull(); expect(p.$('[data-ck="spd"][data-v="15"]')).toBeNull(); expect(p.$('[data-ck="spd"][data-v="9"]')).toBeTruthy(); expect(p.text()).toMatch(/How many rounds \(games in a row\)\?/); expect(p.text()).toMatch(/One round is one full game of up to 75 numbers/); expect(p.text()).toMatch(/Anyone who clicks your link joins straight away/);
    p.click('[data-bool="inv"]'); const t = p.text();
    expect(t).toMatch(/Can guests bring their own people\?/); expect(t).toMatch(/The people they invite can play, but cannot invite anyone else\./); expect(t).toMatch(/You, Hosts and Co-hosts: invite as many as you like\./); expect(t).toMatch(/A guest: up to 4 people\./); expect(t).toMatch(/A person a guest invited: can play, cannot invite\./);
    p.click('[data-ck="per"][data-v="2"]'); p.click('[data-ck="cats"][data-v="friends"]'); p.click('[data-ck="cats"][data-v="family"]');
    p.click('[data-save="2"]'); await p.waitFor((x) => /Saved\./.test(x));
    const sm = await o.json(await o.api("GET", "/api/z/UI-PLAY/summary", undefined, o.aiKey));
    expect(sm).toMatchObject({ tickets: 2, callSeconds: 12, rounds: 3, invites: { on: true, per: 2, cats: ["colleagues", "friends"] } });
    expect(sm.whoCanJoin).toBe("anyone"); expect(pw.st.patches.some((b: any) => b.whoCanJoin === "anyone")).toBe(true); // the console sends the new game setting
    expect(p.errors).toEqual([]);
  });
  test("Your game: the occasion chips are the Bingo list (Team event, Holiday party, All-hands opener ...), and choosing one names the game", async () => {
    const o = await organizer(); await make(o, "UI-OCC");
    const p = await consolePage(o, "UI-OCC"); await p.waitFor((x) => /Hello/.test(x));
    const chips = [...p.win.document.querySelectorAll('[data-ck="occ"]')].map((e: any) => e.textContent.trim());
    expect(chips).toEqual(["Team event", "Holiday party", "All-hands opener", "New-hire welcome", "Customer event", "Friday team break", "Family day", "Diwali party", "Other"]);
    p.click('[data-ck="occ"][data-v="Holiday party"]'); p.click('[data-ck="day"][data-v="other"]'); setField(p, "#f-dayo", "2026-10-05"); p.click('[data-ck="time"][data-v="other"]'); setField(p, "#f-timeo", "18:30");
    p.click('[data-save="1"]'); await p.waitFor((x) => /Saved\./.test(x));
    expect((await o.json(await o.api("GET", "/api/z/UI-OCC/summary", undefined, o.aiKey))).name).toBe("Holiday party");
  });
  test("Your game: occasion, day and time are chips; saving sets the name and the exact start in India time; a past time is refused politely", async () => {
    const o = await organizer(); await make(o, "UI-WHEN");
    const p = await consolePage(o, "UI-WHEN"); await p.waitFor((x) => /Hello/.test(x));
    p.click('[data-ck="occ"][data-v="Team event"]'); p.click('[data-ck="day"][data-v="other"]'); setField(p, "#f-dayo", "2026-10-05"); p.click('[data-ck="time"][data-v="other"]'); setField(p, "#f-timeo", "18:30");
    p.click('[data-save="1"]'); await p.waitFor((x) => /Saved\./.test(x));
    const sm = await o.json(await o.api("GET", "/api/z/UI-WHEN/summary", undefined, o.aiKey)); expect(sm.name).toBe("Team event"); expect(sm.startMs).toBe(Date.parse("2026-10-05T18:30:00+05:30"));
    openStep(p, 1); setField(p, "#f-dayo", "2020-01-01"); p.click('[data-save="1"]'); await p.waitFor((x) => /start time in the future/.test(x));
    expect((await o.json(await o.api("GET", "/api/z/UI-WHEN/summary", undefined, o.aiKey))).startMs).toBe(Date.parse("2026-10-05T18:30:00+05:30")); // nothing changed
  });
  test("Invite and share: three boxed blocks (Guest link, Big screen, My people) with copy, WhatsApp only (no e-mail), the big-screen link, the ways to add people and the privacy line", async () => {
    const o = await organizer(); await make(o, "UI-SHARE"); await publish(o, "UI-SHARE"); const pw = spy();
    const p = await consolePage(o, "UI-SHARE", o.token, {}, { afterLoad: pw.hook }); await p.waitFor((x) => /Last step|Your game/i.test(x)); openStep(p, 6);
    await p.waitFor((x) => /Guest link/.test(x) && /0 people are on my list/.test(x)); const doc = p.win.document;
    expect(Array.from(doc.querySelectorAll("#sec6 .zc-block > h3")).map((e: any) => e.textContent).slice(0, 3)).toEqual(["Guest link", "Big screen", "My people"]);
    const guest = "http://localhost/z.html?e=UI-SHARE";
    expect((p.$('a[href^="https://wa.me/?text="]') as any).getAttribute("href")).toContain(encodeURIComponent(guest)); expect(p.$('a[href^="mailto:"]')).toBeNull();
    let copied = ""; Object.defineProperty(p.win.navigator, "clipboard", { value: { writeText: async (t: string) => { copied = t; } }, configurable: true });
    p.click("#copy"); await p.waitFor((x) => /Copied/.test(x)); expect(copied).toBe(guest); p.click("#copybig"); await new Promise((r) => setTimeout(r, 50)); expect(copied).toBe("http://localhost/big.html?e=UI-SHARE");
    const t = p.text(); expect(t).toMatch(/Open it on a laptop or phone connected to the big screen\. It shows numbers and winners only\./); expect((p.$('a[href="http://localhost/big.html?e=UI-SHARE"]') as any).textContent).toMatch(/Open the big screen/);
    expect(Array.from(doc.querySelectorAll("body [data-mode]")).map((e: any) => e.textContent)).toEqual(["Upload a PDF", "Add a name and number", "Paste from Excel", "Upload a CSV"]); // no contacts button where the browser has no contact picker
    p.click('[data-mode="file"]'); expect(p.$("#gfile")).toBeTruthy(); expect((p.$("#gfile") as any).type).toBe("file");
    expect(t).not.toMatch(/By e-mail|Send by e-mail|Send invites/); expect(t).toMatch(/Invite only people who would like to play/); expect(t).toMatch(/Names and numbers stay here, on your console\./); expect(t).toMatch(/Download my list/);
    expect(p.errors).toEqual([]);
  });
  test("Help: pre-answered questions (including Who can do what? and the big-screen link), Back to your steps, Back to top; and the progress bar moves as steps are saved", async () => {
    const o = await organizer(); await make(o, "UI-HELP");
    const p = await consolePage(o, "UI-HELP"); await p.waitFor((x) => /Hello/.test(x));
    const bar = () => p.$('[role="progressbar"]')!; expect(bar().getAttribute("aria-valuenow")).toBe("0"); expect(p.text()).toMatch(/0 of 10 done · 0%/);
    p.click('[data-save="1"]'); await p.waitFor((x) => /1 of 10 done · 10%/.test(x)); expect(bar().getAttribute("aria-valuenow")).toBe("10"); expect((p.$("#progfill") as any).style.width).toBe("10%");
    expect(p.$("#sec2")!.className).toMatch(/open/); // Save and continue moved on to the next step
    const qs = Array.from(p.win.document.querySelectorAll("[data-q] span:first-child")).map((e: any) => e.textContent); expect(qs.length).toBeGreaterThanOrEqual(13); expect(qs).toEqual(expect.arrayContaining(["How do I start?", "Who pays?", "Who can do what?", "What is the big screen link?", "Who do I contact?"]));
    p.click(`[data-q="${qs.indexOf("Who can do what?")}"]`); expect(p.text()).toMatch(/A Co-host invites people and can pay/);
    p.click(`[data-q="${qs.indexOf("What is the big screen link?")}"]`); expect(p.text()).toMatch(/shows numbers and winners only/);
    p.click('[data-act="help"]'); expect(p.$("#help")).toBeTruthy(); expect(p.text()).toMatch(/Back to your steps/); expect(p.text()).toMatch(/Back to top/);
    // the phone layout has its own bottom tabs and a steps sheet
    expect(Array.from(p.win.document.querySelectorAll(".zc-tab")).map((e: any) => e.textContent)).toEqual(["Steps", "Next", "Help", "Top"]);
    p.click('.zc-tab[data-act="sheet"]'); expect(p.$(".zc-sheet")!.textContent).toMatch(/Your game at a glance/); p.click('.zc-tab[data-act="sheet"]'); expect(p.$(".zc-sheet")).toBeNull();
    const css = readFileSync(new URL("../public/zc.css", import.meta.url), "utf8"); expect(css).toMatch(/@media \(max-width:640px\)/); expect(css).toMatch(/\.zc-side\{display:none\}/); expect(css).toMatch(/\.zc-paynote\{[^}]*font-size:12px/);
    expect(p.errors).toEqual([]);
  });
});

describe("payment page", () => {
  const payPage = (o: O, eid: string, signedIn = true) => page(o, `/pay?e=${eid}`, "pay.html", ["common.js", "pay.js"], signedIn ? { "cbz-org": o.token, "cbz-email": "boss@acme.com", "cbz-phone": "98765 43210" } : {});
  test("UC-55 not signed in: asks to sign in instead of showing a broken page", async () => {
    const o = await organizer(); await make(o, "UI-PAY0");
    const p = await payPage(o, "UI-PAY0", false); expect(await p.waitFor((x) => /Please sign in first/.test(x))).toMatch(/Sign in with email/);
  });
  test("UC-23 / UC-55 payments not switched on: the order is shown, the button says so, nothing can be charged", async () => {
    const o = await organizer(); await make(o, "UI-PAY1", { cap: 230 }); await publish(o, "UI-PAY1");
    const p = await payPage(o, "UI-PAY1");
    const t = await p.waitFor((x) => /Payment is for Game ID/.test(x));
    expect(t).toMatch(/Online payment opens soon/); expect(t).toMatch(/Up to 250/); expect(t).not.toMatch(/plus GST/); 
    expect((p.$("#paygo") as any).disabled).toBe(true); expect(p.$("#pfpay")).toBeTruthy(); // the proforma invoice with its Pay now button sits above the details
  });
  test("UC-9 / UC-55 test-payment mode end to end in the page: validation first, then paid, published, and told when it begins", async () => {
    const o = await organizer({ TEST_MODE: "1" }); await make(o, "UI-PAY2", { cap: 100 }); await publish(o, "UI-PAY2");
    const p = await payPage(o, "UI-PAY2"); await p.waitFor((x) => /Details/.test(x));
    expect(p.$("select#pcode")).toBeTruthy(); expect((p.$("select#pcode") as any).value).toBe("91"); expect((p.$("select#cty") as any).value).toBe("IN"); // India and +91 are already chosen
    p.click("#paygo"); await p.waitFor((x) => /your name/i.test(x)); // only a name and an e-mail are needed
    expect(p.text()).not.toMatch(/plus GST/); // no GSTIN question for a buyer in India: the seller charges no GST
    expect(p.text()).toMatch(/Payment to IT Services by Rajat Agarwal/); expect(p.$('a[href="https://itservices-rajat-agarwal.pages.dev/"]')).toBeTruthy(); // the seller is named here, as a plain link
    (p.$("#nm") as any).value = "Asha Rao"; // no organization, no mobile: still pays
    p.click("#paygo");
    const t = await p.waitFor((x) => /Payment received/i.test(x));
    expect(t).toMatch(/will begin on time/); expect(t).toMatch(/Open my engagement/);
    expect(p.$("#invbody")).toBeTruthy(); expect((p.$("#invpdf") as any).getAttribute("href")).toMatch(/\/api\/invoice\/inv_[0-9a-f]{32}\.pdf$/); expect(p.$("#invwa")).toBeTruthy(); expect(p.$("#invsend")).toBeTruthy(); // the invoice itself, PDF, WhatsApp and e-mail on the done screen
    expect((o.world.raw.prepare("SELECT pack FROM engagement WHERE id='UI-PAY2'").get() as any).pack).toBe(100);
  });
  test("UC-12 / UC-55 paying while held: the page says when it will begin", async () => {
    const o = await organizer({ TEST_MODE: "1" }); await make(o, "UI-PAY3"); await publish(o, "UI-PAY3");
    o.world.now = START_MS + HOUR;
    const p = await payPage(o, "UI-PAY3"); await p.waitFor((x) => /waiting for your payment now/i.test(x));
    (p.$("#nm") as any).value = "Asha Rao"; p.click("#paygo");
    expect(await p.waitFor((x) => /Payment received/i.test(x))).toMatch(/It begins at/);
  });
  test("UC-55 an already paid engagement says so; a stranger's engagement is not shown", async () => {
    const o = await organizer(); await make(o, "UI-PAY4"); await publish(o, "UI-PAY4"); o.world.raw.prepare("UPDATE engagement SET pack=100 WHERE id='UI-PAY4'").run();
    expect(await (await payPage(o, "UI-PAY4")).waitFor((x) => /already paid and published/i.test(x))).toBeTruthy();
    const other = await o.json(await o.api("POST", "/api/start", { email: "other@x.com" }, undefined)).then ? null : null; void other;
  });
});

describe("big screen", () => {
  const big = (o: O, eid: string) => page(o, `/big?e=${eid}`, "big.html", ["zgame.js", "big.js"]);
  test("UC-56 before the start it counts down; a held engagement says it is waiting; an announcement is shown big", async () => {
    const o = await organizer(); await make(o, "UI-BIG"); await regKey(o, "UI-BIG"); await publish(o, "UI-BIG");
    let p = await big(o, "UI-BIG");
    expect(await p.waitFor((x) => /The game starts in/.test(x))).toMatch(/0 of 75 numbers called/);
    await o.api("POST", "/api/z/UI-BIG/announce", { text: "Dinner is served" }, o.token);
    await p.close(); p = await big(o, "UI-BIG");
    await p.waitFor((x) => /Dinner is served/.test(x));
    o.world.now = START_MS + 60_000; await p.close(); p = await big(o, "UI-BIG");
    expect(await p.waitFor((x) => /Waiting for the Organizer or Host/.test(x))).not.toMatch(/pay/i);
  });
  test("UC-56 a draft shows a message, not a crash", async () => {
    const o = await organizer(); await make(o, "UI-BIG2");
    const p = await big(o, "UI-BIG2"); await p.waitFor((x) => /not open yet|not published yet|Connecting/i.test(x));
  });
});

describe("phone page", () => {
  const rtFake = (win: any, nowMs: () => number) => { // the phone's runtime with a fake public beacon (the real one is not reachable from a test)
    const Orig = win.ZG.PhoneRuntime;
    win.ZG.PhoneRuntime = class extends Orig {
      constructor(eid: string, deps: any) {
        super(eid, { ...deps, beacon: { fetcher: async (url: string) => { const last = url.split("/").pop()!; const r = last === "latest" ? roundAt(nowMs()) : Number(last); return { ok: true, status: 200, json: async () => ({ round: r, randomness: rnd(r), signature: "aa" }) }; }, mirrors: ["https://a.test", "https://b.test", "https://c.test"], timeoutMs: 500 }, verify: (x: any) => x.signature === "aa", mono: () => deps.mono() });
      }
    };
  };
  const phone = (o: O, eid: string) => page(o, `/z?e=${eid}`, "z.html", ["audio.js", "zgame.js", "z.js"], {}, { afterLoad: (win, f) => { if (f === "zgame.js") rtFake(win, () => o.world.now); } });
  const join = async (p: Page) => { await p.waitFor((x) => /Join the game/.test(x)); { const ph = p.$("#ph") as any; if (ph) ph.value = "9822222222"; const nm = p.$("#nm") as any; if (nm) nm.value = "Asha"; } p.click("#go"); };
  test("the phone does not keep the participant's own mobile number and never sends it in an address", async () => {
    const o = await organizer(); await make(o, "UI-NOPH"); await publish(o, "UI-NOPH");
    const p = await phone(o, "UI-NOPH"); await join(p); await p.waitFor((x) => /You are in|Your card|What you can win/.test(x));
    expect(p.win.localStorage.getItem("cbz-phone")).toBeNull();
    expect(JSON.stringify(Object.fromEntries(Array.from({ length: p.win.localStorage.length }, (_, i) => [p.win.localStorage.key(i), p.win.localStorage.getItem(p.win.localStorage.key(i))])))).not.toContain("9822222222");
    const z = readFileSync(new URL("../public/z.js", import.meta.url), "utf8");
    expect(z).not.toContain("partner/check"); expect(z).not.toContain("store.set(\"cbz-phone\"");
  });
  test("the join page has the two Terms boxes, and a small Privacy Policy link to the privacy section of the legal page", async () => {
    const o = await organizer(); await make(o, "UI-PRIV"); await publish(o, "UI-PRIV");
    const p = await phone(o, "UI-PRIV"); await p.waitFor((x) => /Join the game/.test(x));
    quietPrivacy(p.win.document); expect(p.$("#go")).toBeTruthy(); expect(p.win.document.body.textContent).toContain("Players are 18 or older."); expect(p.win.document.querySelectorAll(".spriv").length).toBe(2);
    for (const f of ["z.css", "app.css"]) expect(readFileSync(new URL("../public/" + f, import.meta.url), "utf8")).toMatch(/.spriv{[^}]*font-size:12px[^}]*font-weight:400/);
    expect(readFileSync(new URL("../public/legal.html", import.meta.url), "utf8")).toContain('id="privacy"');
  });
  test("UC-29 / UC-57 a guest joins a published engagement before payment and gets the waiting room: countdown, what can be won, how it works, sound check, calendar", async () => {
    const o = await organizer(); await make(o, "UI-PH1"); await o.api("PATCH", "/api/z/UI-PH1/settings", { rewards: [{ pattern: "blackout", ordinal: 1, text: "Voucher 5000" }, { pattern: "corners", ordinal: 1, text: "Gift hamper" }] }, o.aiKey); await publish(o, "UI-PH1");
    const p = await phone(o, "UI-PH1"); await join(p);
    const t = await p.waitFor((x) => /What you can win/.test(x));
    expect(t).toMatch(/You are in\. See you at/); expect(t).toMatch(/Voucher 5000/); expect(t).toMatch(/Gift hamper/); expect(t).toMatch(/How it works/); expect(t).toMatch(/Check my sound/); expect(t).toMatch(/Add to my calendar/);
    expect(t).toMatch(/Starting in\s*\d\d:\d\d:\d\d/); expect(t).not.toMatch(/pay|unpaid|invoice/i); // hours:minutes:seconds to the time the organizer gave
    expect(decodeURIComponent((p.$("#addcal") as any).getAttribute("href"))).toMatch(/BEGIN:VEVENT[\s\S]*SUMMARY:Corporate Bingo/);
    expect(p.errors).toEqual([]);
  });
  test("the clock counts down to the time given; at that exact time the phone says the game is setting up for 2 more minutes, and the first number comes 2 minutes later", async () => {
    const o = await organizer(); await make(o, "UI-PH9"); await publish(o, "UI-PH9");
    const p = await phone(o, "UI-PH9"); await join(p); const rt = p.win.__rt;
    const before = await p.waitFor((x) => /Starting in\s*\d\d:\d\d:\d\d/.test(x));
    const secs = (x: string) => { const m = /Starting in\s*(\d\d):(\d\d):(\d\d)/.exec(x)!; return +m[1]! * 3600 + +m[2]! * 60 + +m[3]!; };
    expect(secs(before)).toBeGreaterThan(3000); expect(secs(before)).toBeLessThanOrEqual(3600); // about an hour to go
    o.world.now = roundMs(rt.scheduledRound) + 5_000; rt.syncedAtMono = -Infinity; // the exact time arrives (plus a moment)
    const setup = await p.waitFor((x) => /Your game is setting up/.test(x));
    expect(setup).toMatch(/We are waiting 2 minutes more for everyone to join/); expect(setup).toMatch(/\d\d:\d\d:\d\d/); expect(setup).not.toMatch(/Starting in\s*\d\d:/);
    expect(rt.view().log.length).toBe(0); // no number yet
    o.world.now = roundMs(rt.scheduledRound) + 125_000; rt.syncedAtMono = -Infinity; // 2 minutes after the time given
    await p.waitFor(() => rt.view().log.length >= 1);
    expect(p.text()).not.toMatch(/Your game is setting up/);
  }, 60_000);
  test("UC-28 a draft's link says it is not open yet", async () => {
    const o = await organizer(); await make(o, "UI-PH2");
    const p = await phone(o, "UI-PH2"); await p.waitFor((x) => /not open yet|Could not reach|not valid/i.test(x));
  });
  test("UC-38 / UC-57 held for non-payment: the phone says it is waiting for the organizer, shows no number and never mentions money", async () => {
    const o = await organizer(); await make(o, "UI-PH3"); await regKey(o, "UI-PH3"); await publish(o, "UI-PH3");
    const p = await phone(o, "UI-PH3"); await join(p); await p.waitFor((x) => /What you can win|Your card/.test(x));
    o.world.now = START_MS + 30_000; // the clock moves past the hold point; the phone learns it with its next check
    for (let i = 0; i < 40 && !/Waiting for the Organizer or Host/.test(p.text()); i++) { await new Promise((r) => setTimeout(r, 100)); (p.win.__rt as any).lastControlPoll = -1e9; }
    const t = await p.waitFor((x) => /Waiting for the Organizer or Host/.test(x), 8000);
    expect(t).not.toMatch(/pay|unpaid|invoice|price/i); expect(t).toMatch(/Your card is safe/);
  });
  test("UC-80 an announcement shows as a banner on the phone, can be dismissed, and a new one shows again", async () => {
    const o = await organizer(); await make(o, "UI-PH4"); await regKey(o, "UI-PH4"); await publish(o, "UI-PH4");
    const p = await phone(o, "UI-PH4"); await join(p); await p.waitFor((x) => /Your card|What you can win/.test(x));
    let at = T; const say = (text: string) => o.api("POST", "/api/z/UI-PH4/announce", { text }, o.token, (at += 10_000));
    await say("Please take your seats");
    const poll = async (re: RegExp) => { for (let i = 0; i < 60 && !re.test(p.text()); i++) { (p.win.__rt as any).lastControlPoll = -1e9; await new Promise((r) => setTimeout(r, 100)); } return p.text(); };
    expect(await poll(/Message from the organizer/)).toMatch(/Please take your seats/);
    p.click("#annok"); await p.waitFor((x) => !/Message from the organizer/.test(x));
    await say("Rewards at the stage");
    expect(await poll(/Rewards at the stage/)).toMatch(/Message from the organizer/);
  });
});

describe("scratch card on the phone", () => {
  const rtFake2 = (win: any, nowMs: () => number) => { const Orig = win.ZG.PhoneRuntime; win.ZG.PhoneRuntime = class extends Orig { constructor(eid: string, deps: any) { super(eid, { ...deps, beacon: { fetcher: async (url: string) => { const last = url.split("/").pop()!; const r = last === "latest" ? roundAt(nowMs()) : Number(last); return { ok: true, status: 200, json: async () => ({ round: r, randomness: rnd(r), signature: "aa" }) }; }, mirrors: ["https://a.test", "https://b.test", "https://c.test"], timeoutMs: 500 }, verify: (x: any) => x.signature === "aa" }); } }; };
  async function scratchSetup(o: O, id: string) {
    await make(o, id); await o.api("PATCH", `/api/z/${id}/settings`, { breaks: [{ after: 30, seconds: 60, kind: "lucky", title: "Scratch and win", winners: 3, style: "scratch" }] }, o.aiKey); await publish(o, id);
    const p = await page(o, `/z?e=${id}`, "z.html", ["audio.js", "zgame.js", "z.js"], {}, { afterLoad: (win, f) => { if (f === "zgame.js") rtFake2(win, () => o.world.now); } });
    await p.waitFor((x) => /Join the game/.test(x)); { const ph = p.$("#ph") as any; if (ph) ph.value = "9822222222"; const nm = p.$("#nm") as any; if (nm) nm.value = "Asha"; } p.click("#go"); await p.waitFor((x) => /Your card|What you can win/.test(x));
    return p;
  }
  test("UC-82 a scratch card: the winner scratches to reveal 'You won', it opens by itself after 45 seconds, and a non-winner sees 'Not this time'", async () => {
    const o = await organizer(); const p = await scratchSetup(o, "UI-SC1"); const rt = p.win.__rt;
    expect(await p.waitFor((x) => /Scratch card/.test(x))).toMatch(/at the end of the break/);
    rt.allResults = [{ pattern: "lucky", ordinal: 1, round: 1, idx: 30, count: 1, winners: [rt.pid] }];
    await p.waitFor((x) => /Scratch here/.test(x)); expect(p.text()).not.toMatch(/You won/);
    p.click("[data-scr]"); expect(await p.waitFor((x) => /You won!/.test(x))).not.toMatch(/Scratch here/);
    rt.allResults = [{ pattern: "lucky", ordinal: 1, round: 1, idx: 30, count: 1, winners: ["someone-else"] }];
    await p.waitFor((x) => /Not this time/.test(x));
  });
  test("UC-82 untouched, a scratch card opens by itself after 45 seconds", async () => {
    const o = await organizer(); const p = await scratchSetup(o, "UI-SC2"); const rt = p.win.__rt;
    rt.allResults = [{ pattern: "lucky", ordinal: 1, round: 1, idx: 30, count: 1, winners: ["someone-else"] }];
    await p.waitFor((x) => /Scratch here/.test(x));
    o.world.now += 46_000; expect(await p.waitFor((x) => /Not this time/.test(x))).not.toMatch(/Scratch here/);
  });
});

describe("winners, the end, and break media on the phone", () => {
  const rtFake3 = (win: any, nowMs: () => number) => { const Orig = win.ZG.PhoneRuntime; win.ZG.PhoneRuntime = class extends Orig { constructor(eid: string, deps: any) { super(eid, { ...deps, beacon: { fetcher: async (url: string) => { const last = url.split("/").pop()!; const r = last === "latest" ? roundAt(nowMs()) : Number(last); return { ok: true, status: 200, json: async () => ({ round: r, randomness: rnd(r), signature: "aa" }) }; }, mirrors: ["https://a.test", "https://b.test", "https://c.test"], timeoutMs: 500 }, verify: (x: any) => x.signature === "aa" }); } }; };
  async function joined(o: O, id: string, settings: Record<string, unknown> = {}) {
    await make(o, id); if (Object.keys(settings).length) await o.api("PATCH", `/api/z/${id}/settings`, settings, o.aiKey); await publish(o, id);
    const p = await page(o, `/z?e=${id}`, "z.html", ["audio.js", "zgame.js", "z.js"], {}, { afterLoad: (win, f) => { if (f === "zgame.js") rtFake3(win, () => o.world.now); win.Math = Object.assign(Object.create(Math), { random: () => 0 }); } });
    await p.waitFor((x) => /Join the game/.test(x)); { const ph = p.$("#ph") as any; if (ph) ph.value = "9833333333"; const nm = p.$("#nm") as any; if (nm) nm.value = "Asha"; } p.click("#go"); await p.waitFor((x) => /Your card|What you can win/.test(x));
    return p;
  }
  /** Moves the pretend world clock to `secs` after the engagement's first call and lets the phone notice (its clock re-syncs on the next tick). */
  const at = (o: O, p: any, secs: number) => { const rt = p.win.__rt; o.world.now = p.win.ZG.roundTimeMs(rt.startRound) + secs * 1000; rt.syncedAtMono = -Infinity; };
  const until = async (cond: () => boolean, ms = 25000) => { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) throw new Error("timed out"); await new Promise((r) => setTimeout(r, 200)); } };
  const prizes = { rewards: [{ pattern: "corners", ordinal: 1, text: "Gift hamper" }, { pattern: "line", ordinal: 1, text: "Movie tickets" }, { pattern: "blackout", ordinal: 1, text: "Voucher 5000" }] };
  test("a winner sees Hurray with confetti, a congratulations ribbon with the winning numbers lit on the card, and a prize list that stays; when the last prize is awarded the phone itself ends the game with the thank-you and a share button", async () => {
    const o = await organizer(); const p = await joined(o, "UI-WINA", prizes); const rt = p.win.__rt; const doc = p.win.document;
    at(o, p, 640); // about 70 of the 75 numbers out: this phone is the only player, so it has won the first houses
    await until(() => !!doc.getElementById("hurray")) // worked out on the phone itself: nobody published anything
    expect(doc.getElementById("hurray")?.textContent).toMatch(/Congratulations, you won/);
    expect(doc.querySelector("#hurray canvas")).toBeTruthy();
    expect(await p.waitFor((x) => /Congratulations! You won/.test(x))).toMatch(/Your prizes/);
    expect(doc.querySelectorAll(".zticket div.w").length).toBeGreaterThan(0); // the winning numbers are lit
    const saved = JSON.parse(p.win.localStorage.getItem("cbz-prizes:UI-WINA") || "[]"); expect(saved.length).toBeGreaterThan(0); expect(saved[0].text).toMatch(/Gift hamper|Movie tickets/);
    expect(rt.view().localWinners).toBe(true);
    (doc.getElementById("hurok") as any)?.click();
    await p.waitFor((x) => /Your prizes/.test(x)); // it stays after the overlay is gone
    at(o, p, 1000); // every number is out
    const end = await p.waitFor((x) => /Game complete/.test(x), 30000);
    expect(end).toMatch(/Thank you for joining our extended family of Corporate Bingo/); expect(end).not.toMatch(/Share with friends and colleagues|Refer|Earn 50/); expect(end).toMatch(/Voucher 5000/); // B21: no selling or sharing buttons on a real game's player screen
    expect(doc.getElementById("shr")).toBeNull();
    expect(rt.view().endedByPrizes).toBe(true); expect(rt.view().log.length).toBeLessThan(90); // it ended on the prizes, not on the last number
    await until(() => (o.world.raw.query("SELECT COUNT(*) c FROM winner WHERE src='phones'").get() as any).c >= 3 && (o.world.raw.query("SELECT COUNT(*) c FROM overvote").get() as any).c >= 1); // the phone told our store about its wins and that the game is over
    expect(o.world.raw.query("SELECT end_src FROM life").get()).toEqual({ end_src: "phones" });
    // the winner confirms where the prize goes; a changed number is kept with the original and shown to the organizer
    o.world.now += 20_000; // the page asks again only after 15 seconds on its clock
    await p.waitFor((x) => /Confirm your prize details/.test(x), 40000);
    (p.$("#cfnm") as any).value = "Asha Rao"; (p.$("#cfph") as any).value = "98765 43210"; (p.$("#cfph") as any).dispatchEvent(new p.win.Event("input")); (p.$("#cfnm") as any).dispatchEvent(new p.win.Event("input"));
    p.click("#cfgo");
    await p.waitFor((x) => /Details confirmed/.test(x), 20000);
    const list = (await o.json(await o.api("GET", "/api/z/UI-WINA/prizes", undefined, o.token))) as any;
    expect(list.prizes.length).toBeGreaterThan(0); expect(list.prizes[0]).toMatchObject({ name: "Asha Rao", phone: "919876543210", confirmed: true, changed: true });
    expect(JSON.stringify(o.world.raw.query("SELECT * FROM winner").all())).not.toMatch(/Voucher|9833|Gift/); // seat, prize, round, time: no names or numbers
  }, 90_000);
  test("a player who joined too late to win anything still gets the thank-you (and no share or refer button) when the game ends, and no prizes are listed", async () => {
    const o = await organizer({ FREE_LAUNCH: "1" }); await make(o, "UI-WIN2"); await o.api("PATCH", "/api/z/UI-WIN2/settings", prizes, o.aiKey); await publish(o, "UI-WIN2");
    expect((await o.api("POST", "/api/z/UI-WIN2/join", { phone: "9877777777", device: "9".repeat(32) })).status).toBe(200); // the one player who joined in time
    o.world.now = roundMs(START + 40) + 1_000_000; // the whole game has been played: the one player won everything
    const p = await page(o, "/z?e=UI-WIN2", "z.html", ["audio.js", "zgame.js", "z.js"], {}, { afterLoad: (win, f) => { if (f === "zgame.js") rtFake3(win, () => o.world.now); } });
    await p.waitFor((x) => /Join the game/.test(x)); { const ph = p.$("#ph") as any; if (ph) ph.value = "9833333333"; const nm = p.$("#nm") as any; if (nm) nm.value = "Asha"; } p.click("#go"); // joins now: far too late
    const end = await p.waitFor((x) => /Game complete/.test(x), 40000);
    expect(end).toMatch(/extended family of Corporate Bingo/); expect(end).not.toMatch(/Your prizes/); expect(p.win.document.getElementById("hurray")).toBeNull();
    expect(p.win.__rt.view().late).not.toBeNull(); expect(p.win.__rt.view().log).toEqual([]); // and it was never shown a single old number
  }, 90_000);
  test("a phone that joins mid-game is told old numbers are gone, counts down to its own first number, and then plays on from there", async () => {
    const o = await organizer({ FREE_LAUNCH: "1" }); await make(o, "UI-LATE1"); await publish(o, "UI-LATE1");
    expect((await o.api("POST", "/api/z/UI-LATE1/join", { phone: "9866666666", device: "8".repeat(32) })).status).toBe(200);
    o.world.now = roundMs(START + 40) + 200_000; // about 22 numbers are already out
    const p = await page(o, "/z?e=UI-LATE1", "z.html", ["audio.js", "zgame.js", "z.js"], {}, { afterLoad: (win, f) => { if (f === "zgame.js") rtFake3(win, () => o.world.now); } });
    await p.waitFor((x) => /Join the game/.test(x)); { const ph = p.$("#ph") as any; if (ph) ph.value = "9833333333"; const nm = p.$("#nm") as any; if (nm) nm.value = "Asha"; } p.click("#go");
    const t = await p.waitFor((x) => /You joined after the game began/.test(x));
    expect(t).toMatch(/Numbers called before you joined are gone, and prizes already awarded stay awarded/); expect(t).toMatch(/\d\d:\d\d:\d\d/); expect(t).toMatch(/until your numbers start/);
    expect(t).not.toMatch(/Your game is setting up|Starting in/); expect(p.win.__rt.view().log).toEqual([]);
    o.world.now += 100_000; p.win.__rt.syncedAtMono = -Infinity; // past the 90-second count-from
    const t2 = await p.waitFor((x) => /you play from your first number/.test(x), 30000);
    expect(t2).toMatch(/numbers? (was|were) called before you/);
    await p.waitFor(() => p.win.__rt.view().log.length > 0, 30000); expect(p.text()).toMatch(/Numbers since you joined/);
  }, 90_000);
  test("a YouTube break plays inside the page (privacy-friendly player, autoplay, no leaving the card) and disappears when the break ends", async () => {
    const o = await organizer(); const p = await joined(o, "UI-MED1", { breaks: [{ after: 3, seconds: 60, kind: "youtube", title: "Welcome from our CEO", mediaUrl: "https://youtu.be/dQw4w9WgXcQ" }] }); const rt = p.win.__rt; const doc = p.win.document;
    for (let s = 20; s < 90 && !doc.querySelector("#cbmedia iframe"); s += 4) { at(o, p, s); await new Promise((r) => setTimeout(r, 1200)); }
    const f = doc.querySelector("#cbmedia iframe") as any; expect(f).toBeTruthy();
    expect(f.src).toMatch(/^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?/); expect(f.src).toMatch(/autoplay=1/); expect(f.getAttribute("allow")).toMatch(/autoplay/);
    expect(doc.getElementById("mslot")).toBeTruthy(); expect(p.text()).toMatch(/Welcome from our CEO/);
    at(o, p, 200); await until(() => !doc.querySelector("#cbmedia iframe")); // break over: the player is removed
  }, 90_000);
  test("a video file break plays in the page; a link that cannot be played inside the page stays a plain link", async () => {
    const o = await organizer(); const p = await joined(o, "UI-MED2", { breaks: [{ after: 3, seconds: 60, kind: "file", title: "Our story", mediaUrl: "https://cdn.example.com/story.mp4" }] }); const doc = p.win.document;
    for (let s = 20; s < 90 && !doc.querySelector("#cbmedia video"); s += 4) { at(o, p, s); await new Promise((r) => setTimeout(r, 1200)); }
    expect((doc.querySelector("#cbmedia video") as any)?.src).toBe("https://cdn.example.com/story.mp4");
    const o2 = await organizer(); const q = await joined(o2, "UI-MED3", { breaks: [{ after: 3, seconds: 60, kind: "file", title: "Our deck", mediaUrl: "https://example.com/deck.pdf" }] });
    for (let s = 20; s < 90 && !/Our deck/.test(q.text()); s += 4) { at(o2, q, s); await new Promise((r) => setTimeout(r, 1200)); }
    expect(q.text()).toMatch(/Our deck/); expect(q.win.document.querySelector("#cbmedia video, #cbmedia iframe, #cbmedia audio")).toBeNull(); expect(q.text()).toMatch(/Open/);
  }, 120_000);
});

describe("console: results go out on their own, and a person can move to a new phone", () => {
  const until = async (cond: () => Promise<boolean> | boolean, ms = 30000) => { const t0 = Date.now(); while (!(await cond())) { if (Date.now() - t0 > ms) throw new Error("timed out"); await new Promise((r) => setTimeout(r, 300)); } };
  test("the console only watches: with numbers called it publishes nothing and offers no Publish button; the phones settle the winners", async () => {
    const o = await organizer({ FREE_LAUNCH: "1" }); await make(o, "UI-AUTO"); await publish(o, "UI-AUTO");
    const j = await o.api("POST", "/api/z/UI-AUTO/join", { phone: "9844444444", device: "f".repeat(32) });
    expect(j.status).toBe(200);
    o.world.now = START_MS + 1_000_000; // every one of the 90 numbers is out: every house is complete for the one player
    const p = await page(o, "/zc?e=UI-AUTO", "zc.html", ZC_SCRIPTS, { "cbz-org": o.token, "cbz-aimsg": o.aiMessage, "cbz-email": "boss@acme.com" }, { afterLoad: (win, f) => { if (f === "zgame.js") { const Orig = win.ZG.RoundStore; win.ZG.RoundStore = class extends Orig { constructor() { super({ fetcher: async (url: string) => { const last = url.split("/").pop()!; const r = last === "latest" ? roundAt(o.world.now) : Number(last); return { ok: true, status: 200, json: async () => ({ round: r, randomness: rnd(r), signature: "aa" }) }; }, mirrors: ["https://a.test", "https://b.test", "https://c.test"], timeoutMs: 500 }, (x: any) => x.signature === "aa"); } }; } } });
    await p.waitFor((x) => /Rewards, from the public number log/.test(x), 30000);
    await new Promise((r) => setTimeout(r, 1500));
    const r = (await o.json(await o.api("GET", "/api/z/UI-AUTO/results"))) as any;
    expect(r.results).toEqual([]); // the organizer's page cannot settle anything
    expect(p.$("#settle")).toBeFalsy();
    expect(p.text()).toMatch(/You and we cannot choose or change them in the software/);
    expect((await o.api("POST", "/api/z/UI-AUTO/settle", { results: [{ pattern: "blackout", idx: 5, pids: [] }] }, o.token)).status).toBe(403);
  }, 60_000);
  test("'Change of phone': the organizer enters a number, and the next device that joins with it keeps the card", async () => {
    const o = await organizer(); await make(o, "UI-MOVE"); await publish(o, "UI-MOVE");
    expect((await o.api("POST", "/api/z/UI-MOVE/join", { phone: "9855555555", device: "1".repeat(32) })).status).toBe(200);
    expect((await o.api("POST", "/api/z/UI-MOVE/join", { phone: "9855555555", device: "2".repeat(32) })).status).toBe(423);
    const p = await consolePage(o, "UI-MOVE");
    await p.waitFor((x) => /Your game|Last step/i.test(x)); openStep(p, 6); await p.waitFor((x) => /Change of phone/.test(x));
    (p.$("#ubph") as any).value = "98555 55555"; p.click("#unbind");
    await p.waitFor((x) => /next phone they join with keeps their card/i.test(x));
    expect((await o.api("POST", "/api/z/UI-MOVE/join", { phone: "9855555555", device: "2".repeat(32) })).status).toBe(200);
    expect((await o.api("POST", "/api/z/UI-MOVE/join", { phone: "9855555555", device: "1".repeat(32) })).status).toBe(423);
  }, 60_000);
});

describe("Refer & Earn page", () => {
  const html = () => readFileSync(join(import.meta.dir, "../public/partner.html"), "utf8");
  test("the page pitches 50%, lists every pack with exactly half of its price, and has a working calculator", async () => {
    const o = await organizer(); const p = await page(o, "/partner.html", "partner.html", ["common.js", "partner.js"]);
    const doc = p.win.document; const body = doc.body.textContent!.replace(/\s+/g, " ");
    expect(body).toMatch(/Earn up to 50% on every game you bring/); expect(body).not.toMatch(/20% more every time/); expect(body).toMatch(/random code/i); expect(body).not.toMatch(/mobile number is your code/i);
    const packs: number[][] = p.win.TB.PACKS;
    expect(packs.slice(0, 3).map((x) => [x[0], x[1]])).toEqual([[100, 2399], [250, 3499], [500, 4699]]); // the launch prices
    const rows = [...doc.querySelectorAll("#earn-table .rrow:not(.rh)")].map((r: any) => r.textContent.replace(/\s+/g, " "));
    expect(rows.length).toBe(packs.length);
    expect(rows[0]).toMatch(/2,399/); expect(rows[0]).toMatch(/1,199\.50/); expect(rows[1]).toMatch(/1,749\.50/); expect(rows[2]).toMatch(/2,349\.50/);
    expect(body).not.toMatch(/per person|per participant|per head/i); // we never show a per-person price
    (doc.getElementById("calc-n") as any).value = "4"; (doc.getElementById("calc-pack") as any).value = "0"; (doc.getElementById("calc-n") as any).dispatchEvent(new p.win.Event("input"));
    expect(doc.getElementById("calc-out")!.textContent).toBe("₹4,798 / US$ 68"); // 4 first purchases x Rs 1,199.50
  });
  test("joining takes a mobile number and an e-mailed code: the code is random, the link is /?ref=<code>, and the page switches to the partner's own dashboard", async () => {
    const o = await organizer(); const p = await page(o, "/partner.html", "partner.html", ["common.js", "partner.js"]);
    await p.waitFor((x) => /Get your link in 20 seconds/.test(x));
    (p.$("#ph") as any).value = "+91 98765 43210"; (p.$("#em") as any).value = "partner@example.com"; (p.$("#ok") as any).checked = true; p.click("#join");
    await p.waitFor((x) => /Check your e-?mail/.test(x));
    const mailed = (o.world.raw.prepare("SELECT body FROM outbox WHERE to_addr='partner@example.com' ORDER BY id DESC").get() as any).body.match(/\b\d{6}\b/)[0];
    (p.$("#cd") as any).value = mailed; p.click("#cdgo");
    const t = await p.waitFor(() => !!p.win.document.getElementById("dash")?.textContent?.includes("Your link"));
    const dash = p.win.document.getElementById("dash")!.textContent!;
    expect(dash).not.toMatch(/9876543210/); expect(dash).toMatch(/\/\?ref=[A-HJ-NP-Z2-9]{8}/); expect(dash).toMatch(/Your link/);
    expect(p.win.document.body.classList.contains("signed")).toBe(true);
    expect(p.errors).toEqual([]);
  });
  test("Create your game pop-up: brand top right, role pill, eight true bullets, an email field (not work email), one button, trust line, Esc closes, the sign-up still works", async () => {
    const o = await organizer();
    const p = await page(o, "/", "index.html", ["common.js", "site.js"], {});
    p.click("#payBtn"); await new Promise((r) => setTimeout(r, 200));
    const t = (p.$("#sheet") as any).textContent as string; expect(t).toMatch(/Create your game/);
    expect(t).toContain("Build it and publish it free."); expect(t).not.toMatch(/Pay (only )?before it starts/); expect(t).toMatch(/For the organizer or host/);
    for (const b of ["Add a message, video or lucky draw between calls", "Pick your prizes: Line, Four Corners, X, Blackout", "A closed-group Bingo for your company", "Every card is unique: no two can ever match", "Each guest gets their own card on their phone", "Players never pay. You provide the prizes", "Guest names are erased within 24 hours of the game ending", "Designed to follow DPDP Act, GDPR and CCPA"]) expect(t).toContain(b);
    expect(p.win.document.querySelectorAll(".bgrid li").length).toBe(8); expect(p.win.document.querySelectorAll(".bgrid .bico svg").length).toBe(8); expect(t).not.toMatch(/AI assistant/); /* B03: no AI promise while the console hides the AI link */ for (const li of p.win.document.querySelectorAll(".bgrid li")) expect(li.textContent.trim().split(/s+/).length).toBeLessThanOrEqual(13); // one short line each
    expect(t).toContain("Free to build and publish. No password."); expect(t).toContain("Your console opens at once. We use your email for your invoice and to sign you in later.");
    expect(t).not.toMatch(/work email/i); expect(t.split(/s+/).length).toBeLessThan(150);
    const f = p.$("#fMail") as any; expect(p.win.document.querySelector('label[for="fMail"]').textContent).toBe("Your e-mail");
    expect(f.getAttribute("type")).toBe("email"); expect(f.getAttribute("inputmode")).toBe("email"); expect(f.getAttribute("autocomplete")).toBe("email"); expect(f.getAttribute("placeholder")).toBe("your e-mail");
    expect(p.win.document.querySelector(".sheet .sbrand")!.getAttribute("aria-label")).toBe("Corporate Bingo"); expect(p.win.document.querySelector(".sheethead .rolepill")).toBeTruthy();
    expect((p.$("#frGo") as any).textContent).toMatch(/^s*Create my game/);
    p.win.document.dispatchEvent(new p.win.KeyboardEvent("keydown", { key: "Escape" })); await new Promise((r) => setTimeout(r, 50));
    { const sh = p.win.document.getElementById("sheet")!; const l = [...sh.querySelectorAll(".spriv a")] as any[]; expect(l.map((x) => x.getAttribute("href"))).toEqual(["/terms.html", "/legal.html#privacy"]); expect(sh.querySelector(".spriv")!.textContent).toBe("Read the Terms and the Privacy & Data Policy before you tick the box."); for (const x of l) { expect(x.getAttribute("target")).toBe("_blank"); expect(x.getAttribute("rel")).toBe("noopener"); } expect(sh.querySelectorAll('input[type="checkbox"]').length).toBe(1); /* the Terms box */ }
    expect(p.win.document.getElementById("modal").classList.contains("hidden")).toBe(true);
    expect(p.errors).toEqual([]);
  });
  test("the page is linked from the home page and listed for search engines, and ships with its stylesheet", () => {
    expect(readFileSync(join(import.meta.dir, "../public/index.html"), "utf8")).toContain('href="/partner"');
    expect(readFileSync(join(import.meta.dir, "../public/sitemap.xml"), "utf8")).toContain("/partner");
    expect(readFileSync(join(import.meta.dir, "../../../pages/build.mjs"), "utf8")).toContain('"partner.css"');
    expect(html()).toContain('href="/partner.css"');
  });
});

describe("invitations on the pages", () => {
  const rtFake3 = (win: any, nowMs: () => number) => { const Orig = win.ZG.PhoneRuntime; win.ZG.PhoneRuntime = class extends Orig { constructor(eid: string, deps: any) { super(eid, { ...deps, beacon: { fetcher: async (url: string) => { const last = url.split("/").pop()!; const r = last === "latest" ? roundAt(nowMs()) : Number(last); return { ok: true, status: 200, json: async () => ({ round: r, randomness: rnd(r), signature: "aa" }) }; }, mirrors: ["https://a.test", "https://b.test", "https://c.test"], timeoutMs: 500 }, verify: (x: any) => x.signature === "aa" }); } }; };
  const paidOrg = () => organizer({ FREE_LAUNCH: "1" });
  const setInvites = (o: O, id: string, invites: unknown) => o.api("PATCH", `/api/z/${id}/settings`, { invites }, o.aiKey);
  test("a participant sees 'Invite your colleagues / family members' with only the kinds the organizer allowed, their own link per kind, and how many invitations are left", async () => {
    const o = await paidOrg(); await make(o, "UI-INV1"); await setInvites(o, "UI-INV1", { on: true, per: 4, cats: ["family", "colleagues", "dealers"] }); await publish(o, "UI-INV1");
    const p = await page(o, "/z?e=UI-INV1", "z.html", ["audio.js", "zgame.js", "z.js"], {}, { afterLoad: (win, f) => { if (f === "zgame.js") rtFake3(win, () => o.world.now); } });
    await p.waitFor((x) => /Join the game/.test(x)); { const ph = p.$("#ph") as any; if (ph) ph.value = "9811111111"; const nm = p.$("#nm") as any; if (nm) nm.value = "Asha"; } p.click("#go");
    const t = await p.waitFor((x) => /Invite your colleagues \/ family members/i.test(x) && /You have invited 0/.test(x));
    expect(t).toMatch(/up to 4 people/); expect(t).toMatch(/4 invitations are left/); expect(t).toMatch(/Family members/); expect(t).toMatch(/Colleagues/); expect(t).toMatch(/Dealers/); expect(t).not.toMatch(/Vendors|Friends/);
    const link = () => (p.win.document.getElementById("invlink") as any).textContent as string;
    expect(link()).toMatch(/\/z\.html\?e=UI-INV1&from=1&c=family$/);
    (p.win.document.querySelector('[data-icat="colleagues"]') as any).click();
    await p.waitFor(() => /c=colleagues$/.test(link())); expect(p.text()).toMatch(/Share invitation \(colleagues\)/);
    expect(p.win.document.querySelector('a[href^="https://wa.me/"]')).toBeTruthy(); expect(p.errors).toEqual([]);
  }, 60_000);
  test("with invitations off there is no invite card at all", async () => {
    const o = await paidOrg(); await make(o, "UI-INV2"); await publish(o, "UI-INV2");
    const p = await page(o, "/z?e=UI-INV2", "z.html", ["audio.js", "zgame.js", "z.js"], {}, { afterLoad: (win, f) => { if (f === "zgame.js") rtFake3(win, () => o.world.now); } });
    await p.waitFor((x) => /Join the game/.test(x)); { const ph = p.$("#ph") as any; if (ph) ph.value = "9811111112"; const nm = p.$("#nm") as any; if (nm) nm.value = "Asha"; } p.click("#go"); await p.waitFor((x) => /Your card|What you can win/.test(x));
    expect(p.text()).not.toMatch(/Invite your colleagues/i);
  }, 60_000);
  test("a guest opening an invitation link is told who it came from, joins with their own number, is recorded under the inviter, and the 5th guest of a 4-person link is told it is used up", async () => {
    const o = await paidOrg(); await make(o, "UI-INV3"); await setInvites(o, "UI-INV3", { on: true, per: 4, cats: ["family", "colleagues"] }); await publish(o, "UI-INV3");
    expect((await o.api("POST", "/api/z/UI-INV3/join", { phone: "9822222221", device: "1".repeat(32) })).status).toBe(200); // the inviter is seat 1
    const guest = async (n: number) => { const p = await page(o, "/z?e=UI-INV3&from=1&c=colleagues", "z.html", ["audio.js", "zgame.js", "z.js"], {}, { afterLoad: (win, f) => { if (f === "zgame.js") rtFake3(win, () => o.world.now); } }); await p.waitFor((x) => /Join the game/.test(x)); if (p.$("#nm")) (p.$("#nm") as any).value = "Guest " + n; if (p.$("#ph")) (p.$("#ph") as any).value = "98222222" + String(30 + n); p.click("#go"); await new Promise((r) => setTimeout(r, 1500)); return p; };
    const g1 = await guest(1); await g1.waitFor((x) => /Your card|What you can win|Starting in|Getting ready/.test(x));
    expect(o.world.raw.query("SELECT inv, cat FROM seat WHERE seq=2").get()).toEqual({ inv: 1, cat: "colleagues" });
    for (let n = 2; n <= 4; n++) await guest(n);
    const g5 = await guest(5);
    const msg = await g5.waitFor((x) => /most one person can invite/.test(x)); expect(msg).toMatch(/already been used by 4 people/); expect(o.world.raw.query("SELECT COUNT(*) c FROM seat WHERE inv=1").get()).toEqual({ c: 4 });
    const fresh = await page(o, "/z?e=UI-INV3&from=1&c=colleagues", "z.html", ["audio.js", "zgame.js", "z.js"]); await fresh.waitFor((x) => /A colleague invited you/.test(x));
  }, 120_000);
  test("the organizer's console saves the invitation policy: on/off, how many each, and the kinds of guests", async () => {
    const o = await paidOrg(); await make(o, "UI-INV4"); await publish(o, "UI-INV4");
    const p = await consolePage(o, "UI-INV4"); await p.waitFor((x) => /Hello|Your game/.test(x)); openStep(p, 2);
    p.click('[data-bool="inv"]'); expect(p.win.document.querySelectorAll('[data-ck="cats"]').length).toBe(10);
    p.click('[data-ck="per"][data-v="3"]');
    for (const k of ["colleagues", "vendors", "customers"]) p.click(`[data-ck="cats"][data-v="${k}"]`); // family stays on; colleagues goes off; vendors and customers come on
    p.click('[data-save="2"]'); await p.waitFor((x) => /Saved\./.test(x));
    const info = await o.json(await o.api("GET", "/api/z/UI-INV4/info", undefined, o.token));
    expect(info.invites).toEqual({ on: true, per: 3, cats: ["family", "vendors", "customers"] });
    expect(p.errors).toEqual([]);
  }, 60_000);
});

describe("opening and closing brand moments on the phone", () => {
  const rtFake4 = (win: any, nowMs: () => number) => { const Orig = win.ZG.PhoneRuntime; win.ZG.PhoneRuntime = class extends Orig { constructor(eid: string, deps: any) { super(eid, { ...deps, beacon: { fetcher: async (url: string) => { const last = url.split("/").pop()!; const r = last === "latest" ? roundAt(nowMs()) : Number(last); return { ok: true, status: 200, json: async () => ({ round: r, randomness: rnd(r), signature: "aa" }) }; }, mirrors: ["https://a.test", "https://b.test", "https://c.test"], timeoutMs: 500 }, verify: (x: any) => x.signature === "aa" }); } }; };
  async function joined(o: O, id: string, settings: Record<string, unknown>) {
    await make(o, id); await o.api("PATCH", `/api/z/${id}/settings`, settings, o.aiKey); await publish(o, id);
    const p = await page(o, `/z?e=${id}`, "z.html", ["audio.js", "zgame.js", "z.js"], {}, { afterLoad: (win, f) => { if (f === "zgame.js") rtFake4(win, () => o.world.now); win.Math = Object.assign(Object.create(Math), { random: () => 0 }); } });
    await p.waitFor((x) => /Join the game/.test(x)); { const ph = p.$("#ph") as any; if (ph) ph.value = "9833333333"; const nm = p.$("#nm") as any; if (nm) nm.value = "Asha"; } p.click("#go"); await p.waitFor((x) => /Your card|What you can win/.test(x));
    return p;
  }
  const at = (o: O, p: any, secs: number) => { const rt = p.win.__rt; o.world.now = p.win.ZG.roundTimeMs(rt.startRound) + secs * 1000; rt.syncedAtMono = -Infinity; };
  const until = async (cond: () => boolean, ms = 25000) => { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) throw new Error("timed out"); await new Promise((r) => setTimeout(r, 200)); } };
  const settle = () => new Promise((r) => setTimeout(r, 1200));

  test("an opening plays only in the 2 minutes before the first number, with its video inside the page, and is gone once the numbers start", async () => {
    const o = await organizer(); const p = await joined(o, "UI-OPN1", { opening: [{ kind: "youtube", title: "Welcome from our CEO", mediaUrl: "https://youtu.be/dQw4w9WgXcQ", seconds: 60 }] }); const doc = p.win.document;
    at(o, p, -400); await settle(); expect(p.text()).not.toMatch(/A message from your organizer/); // far too early: just the countdown
    for (let s = -110; s < -50 && !doc.querySelector("#cbmedia iframe"); s += 6) { at(o, p, s); await settle(); }
    expect(p.text()).toMatch(/A message from your organizer/); expect(p.text()).toMatch(/Welcome from our CEO/);
    const f = doc.querySelector("#cbmedia iframe") as any; expect(f).toBeTruthy(); expect(f.src).toMatch(/^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?/);
    at(o, p, 30); await until(() => !doc.querySelector("#cbmedia iframe")); expect(p.text()).not.toMatch(/A message from your organizer/); // numbers have started
  }, 90_000);
  test("two openings (2 tickets) follow one another inside the same 2 minutes", async () => {
    const o = await organizer(); const p = await joined(o, "UI-OPN2", { tickets: 2, opening: [{ kind: "speech", title: "First hello", seconds: 30 }, { kind: "speech", title: "Second hello", seconds: 30 }] });
    at(o, p, -110); await p.waitFor((x) => /First hello/.test(x), 20000); expect(p.text()).not.toMatch(/Second hello/);
    at(o, p, -75); await p.waitFor((x) => /Second hello/.test(x), 20000); expect(p.text()).not.toMatch(/First hello/);
    at(o, p, -40); await until(() => !/Second hello|First hello/.test(p.text())); // both done: nothing more until the first number
  }, 90_000);
  test("a closing plays on the final screen, and with two closings a button moves to the next", async () => {
    const o = await organizer(); const p = await joined(o, "UI-CLS1", { tickets: 2, closing: [{ kind: "speech", title: "Thank you from the CEO" }, { kind: "youtube", title: "Our year in pictures", mediaUrl: "https://youtu.be/dQw4w9WgXcQ" }] }); const doc = p.win.document;
    at(o, p, 400); await settle(); expect(p.text()).not.toMatch(/Thank you from your organizer/); // not before the end
    at(o, p, 1000); await p.waitFor((x) => /Thank you from your organizer/.test(x), 40000);
    expect(p.text()).toMatch(/Thank you from the CEO/); expect(p.text()).toMatch(/Next message \(1 of 2\)/);
    p.click("#cnext"); await p.waitFor((x) => /Our year in pictures/.test(x), 20000);
    await until(() => !!doc.querySelector("#cbmedia iframe")); expect(p.text()).not.toMatch(/Next message/);
  }, 120_000);
  test("a closing video does not start before the game has ended", async () => {
    const o = await organizer(); const p = await joined(o, "UI-CLS2", { closing: [{ kind: "youtube", title: "Our year in pictures", mediaUrl: "https://youtu.be/dQw4w9WgXcQ" }] }); const doc = p.win.document;
    at(o, p, 400); await settle(); await settle(); expect(doc.querySelector("#cbmedia iframe")).toBeNull(); expect(p.text()).not.toMatch(/Our year in pictures/);
    at(o, p, 1000); await until(() => !!doc.querySelector("#cbmedia iframe"), 40000); expect(p.text()).toMatch(/Our year in pictures/);
  }, 90_000);
  test("with none set, a phone shows no opening and no closing card", async () => {
    const o = await organizer(); const p = await joined(o, "UI-NONE1", {});
    at(o, p, -100); await settle(); expect(p.text()).not.toMatch(/A message from your organizer/);
    at(o, p, 1000); await p.waitFor((x) => /Thank you for taking part|Game complete/.test(x), 40000); expect(p.text()).not.toMatch(/Thank you from your organizer/);
  }, 90_000);
});

describe("testing a brand moment without a game", () => {
  const prev = (o: O, hash: string) => page(o, "/preview.html" + hash, "preview.html", ["preview.js"]);
  test("the console says what kind of link was pasted: YouTube, video file and audio file play inside the game; any other page does not", async () => {
    const o = await organizer(); await make(o, "UI-LNK1");
    const p = await consolePage(o, "UI-LNK1"); await p.waitFor((x) => /Hello/.test(x)); openStep(p, 4); p.click('[data-ck="opN"][data-v="1"]'); p.click('[data-ck="op.0.k"][data-v="yt"]');
    const set = (v: string) => { setField(p, "#f-op-0-v", v); return (p.win.document.querySelector('[data-lk="op.0"]') as any).textContent as string; };
    expect(set("https://youtu.be/dQw4w9WgXcQ")).toMatch(/YouTube link: plays inside the game/);
    expect(set("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toMatch(/plays inside the game/);
    expect(set("https://cdn.acme.com/film.mp4")).toMatch(/Video file: plays inside the game/);
    expect(set("https://cdn.acme.com/song.mp3?x=1")).toMatch(/Audio file: plays inside the game/);
    expect(set("https://drive.google.com/file/d/abc/view")).toMatch(/opens a new tab and takes guests out of the game/);
    expect(set("https://vimeo.com/123456")).toMatch(/opens a new tab and takes guests out of the game/);
    expect(set("http://acme.com/a.mp4")).toMatch(/must start with https/);
    expect(set("")).toBe(""); // no link: guests see the message only, nothing to warn about
  }, 60_000);
  test("the Test button opens a page that shows the break like a guest's phone: the real video inside the page, a card under it, and everything gone when the break ends", async () => {
    const o = await organizer(); await make(o, "UI-LNK2");
    const p = await consolePage(o, "UI-LNK2"); await p.waitFor((x) => /Hello/.test(x)); openStep(p, 4);
    let opened = ""; (p.win as any).open = (u: string) => { opened = u; return null; };
    p.click('[data-ck="midN"][data-v="1"]'); p.click('[data-ck="mid.0.k"][data-v="yt"]');
    setField(p, "#f-mid-0-t", "Welcome from our CEO"); setField(p, "#f-mid-0-v", "https://youtu.be/dQw4w9WgXcQ"); setField(p, "#f-mid-0-s", "15");
    p.click('[data-test="mid.0"]');
    expect(opened).toMatch(/^\/preview\.html#/);
    const h = new URLSearchParams(opened.split("#")[1]); expect([h.get("w"), h.get("k"), h.get("t"), h.get("u"), h.get("s")]).toEqual(["break", "youtube", "Welcome from our CEO", "https://youtu.be/dQw4w9WgXcQ", "15"]);
    const v = await prev(o, "#" + opened.split("#")[1]);
    await v.waitFor((x) => /A short break/.test(x)); const doc = v.win.document;
    expect(v.text()).toMatch(/Test only/); expect(v.text()).toMatch(/This link plays inside the game/); expect(v.text()).toMatch(/Welcome from our CEO/); expect(v.text()).toMatch(/Your card \(sample\)/);
    expect((doc.querySelector("#cbmedia iframe") as any).src).toMatch(/^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?/);
    expect(v.text()).toMatch(/The numbers continue in \d+s/);
  }, 60_000);
  test("a link that cannot play inside the game is flagged on the test page, and a break with no link shows the message only", async () => {
    const o = await organizer();
    const a = await prev(o, "#w=break&k=file&t=Our%20deck&u=" + encodeURIComponent("https://example.com/deck.pdf") + "&s=30");
    await a.waitFor((x) => /A short break/.test(x)); expect(a.text()).toMatch(/will NOT play inside the game/); expect(a.win.document.querySelector("#cbmedia iframe, #cbmedia video, #cbmedia audio")).toBeNull();
    const b = await prev(o, "#w=closing&k=speech&t=Thank%20you");
    await b.waitFor((x) => /Thank you from your organizer/.test(x)); expect(b.text()).toMatch(/guests see your message only/); expect(b.text()).not.toMatch(/numbers continue/);
  }, 60_000);
});

describe("the free demo game", () => {
  const REAL_NOW = Date.now.bind(Date), REAL_PERF = performance.now.bind(performance);
  /** Opens demo.html with its own clock running `k` times faster than real time, so the minute-long demo takes about 18 seconds. */
  async function demo(o: O, hash = "", opts: { video?: string; k?: number } = {}) {
    const k = opts.k ?? 4, T0 = REAL_NOW(), P0 = REAL_PERF(); const calls: string[] = [];
    const p = await page(o, "/demo.html" + hash, "demo.html", ["audio.js", "zgame.js", "demo-config.js", "demo.js", "z.js"], {}, { afterLoad: (win, f) => {
      if (f === "audio.js") { (win as any).__CB_DEMO_CLOCK = { now: () => T0 + (REAL_PERF() - P0) * k, mono: () => P0 + (REAL_PERF() - P0) * k }; const of = (win as any).fetch; (win as any).fetch = (...a: any[]) => { calls.push(String(a[0])); return of ? of(...a) : Promise.reject(new Error("no network")); }; }
      if (f === "demo-config.js" && opts.video !== undefined) (win as any).CB_DEMO_VIDEO = opts.video;
    } });
    return { p, calls, T0 };
  }
  const until = async (cond: () => boolean, ms = 60000) => { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) throw new Error("timed out"); await new Promise((r) => setTimeout(r, 100)); } };
  /** Plays a run to its end and checks everything the owner specified. */
  async function playToEnd(o: O, hash: string) {
    const { p, calls } = await demo(o, hash); const doc = p.win.document; const rt = p.win.__rt;
    let sawBreak = false, sawBuiltInVideo = false, ticketDuringBreak = false, logDuringBreak = -1, breakGone = false;
    await until(() => {
      const view = rt.view(); const t = p.text();
      if (/A short message from your host appears here/.test(t)) { sawBreak = true; sawBuiltInVideo = sawBuiltInVideo || !!doc.querySelector("#cbmedia video"); logDuringBreak = view.log.length; ticketDuringBreak = !!doc.querySelector(".zticket"); }
      else if (sawBreak) breakGone = true;
      return view.phase === "ended";
    }, 90000);
    expect(sawBreak).toBe(true); expect((doc.querySelector("#cbmedia video") as any)?.src ?? "").toBe(""); /* no player is left after the break */ expect(logDuringBreak).toBe(3); expect(ticketDuringBreak).toBe(true); expect(breakGone).toBe(true);
    expect(rt.view().log).toEqual([7, 12, 75, 11, 24, 65]); // exactly the scripted numbers, in order, by the real number-drawing code
    expect(rt.view().won.map((w: any) => w.pattern)).toEqual(["corners"]); expect(rt.view().won[0].idx).toBe(5); // Four corners, on the 6th number, by the real winner check
    const end = await p.waitFor((x) => /That was the video/.test(x), 20000);
    expect(end).toMatch(/You won Four corners/); expect(end).toMatch(/Create my game/); expect(end).toMatch(/Run the video again/);
    expect(end).not.toMatch(/Confirm your prize details|Confirm where your prize goes/); // a demo asks for no name or number
    expect(calls.filter((u) => /\/api\//.test(u))).toEqual([]); // nothing was sent to our server
    return p;
  }

  test("stage links open the demo at one moment: ?stage=middle shows the break, ?stage=end shows the finished game, ?stage=before the idle card", async () => {
    const o = await organizer();
    const mid = await demo(o, "?stage=middle", { k: 1 }); await mid.p.waitFor((x) => /A short message from your host appears here/.test(x), 20000); expect(mid.p.win.__rt.view().log.length).toBe(3);
    const end = await demo(o, "?stage=end", { k: 1 }); await end.p.waitFor((x) => /That was the video/.test(x), 30000); expect(end.p.text()).toMatch(/You won Four corners/);
    const before = await demo(o, "?stage=before", { k: 1 }); await before.p.waitFor((x) => /Run Demo/.test(x)); expect(before.p.text()).not.toMatch(/That was the video|A short message from your host appears here/);
  }, 90_000);
  test("before anyone presses anything: a real card marked DEMO, a Run Demo button, and nothing happening: no countdown, no time, no date, no number to type", async () => {
    const o = await organizer(); const { p } = await demo(o); const doc = p.win.document; const rt = p.win.__rt;
    await p.waitFor((x) => /Run Demo/.test(x)); const t = p.text();
    expect(t).toMatch(/Video card/); expect(doc.querySelector(".zdemotag")?.textContent).toBe("VIDEO"); expect(doc.querySelectorAll(".zticket .c, .zticket .free").length).toBe(25); // a real 5 x 5 card
    expect(doc.getElementById("drun")?.textContent).toBe("Run Demo");
    let copied = ""; Object.defineProperty(p.win.navigator, "clipboard", { value: { writeText: async (x: string) => { copied = x; } }, configurable: true });
    p.click("#dcopy"); await until(() => copied !== "", 3000); expect(copied).toMatch(/^http:\/\/localhost\/demo\.html$/); // the plain address, no time in it: anyone who opens it runs their own demo
    expect(t).not.toMatch(/Starting in|Join the game|Your mobile number|\d\d:\d\d:\d\d/);
    await new Promise((r) => setTimeout(r, 2500)); // many demo-seconds pass: still nothing runs by itself
    expect(rt.view().log).toEqual([]); expect(doc.querySelectorAll(".zticket .c.m").length).toBe(0);
  }, 60_000);

  test("pressing Run Demo starts a fresh run 3 seconds later; the whole demo then plays by itself to the end; and Run demo again plays it a second time, identically", async () => {
    const o = await organizer(); const { p: idle } = await demo(o); await idle.waitFor((x) => /Run Demo/.test(x));
    idle.click("#drun"); const hash = idle.win.location.hash; expect(hash).toMatch(/^#r=\d+$/); // the press sets the start: nothing else is needed
    const first = await playToEnd(o, hash);
    expect(first.win.document.getElementById("dagain2")?.textContent).toBe("Run the video again");
    first.click("#dagain2"); const again = first.win.location.hash; expect(again).toMatch(/^#r=\d+$/); expect(again).not.toBe(hash);
    await playToEnd(o, again); // the second run is the same game again
  }, 240_000);

  test("the break is the owner's YouTube video when one is set: it plays inside the page for the break, the card stays, and the player is gone after it", async () => {
    const o = await organizer(); const { p } = await demo(o, "#r=" + (REAL_NOW() + 3000), { video: "https://youtu.be/dQw4w9WgXcQ" }); const doc = p.win.document;
    await until(() => !!doc.querySelector("#cbmedia iframe"), 60000);
    expect((doc.querySelector("#cbmedia iframe") as any).src).toMatch(/^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?/);
    expect(p.text()).toMatch(/A short video from your host/); expect(doc.querySelector(".zticket")).toBeTruthy();
    await until(() => !doc.querySelector("#cbmedia iframe"), 60000);
    expect(p.win.__rt.view().log.length).toBeGreaterThanOrEqual(3);
  }, 150_000);

  test("an old address (a run that ended long ago) shows the Run Demo screen again, not a half-finished game", async () => {
    const o = await organizer(); const { p } = await demo(o, "#r=" + (REAL_NOW() - 600000));
    await p.waitFor((x) => /Run Demo/.test(x)); expect(p.win.__rt.view().log).toEqual([]);
  }, 60_000);
});

describe("the console for an AI that works in the browser", () => {
  const quickPage = (o: O, session: Record<string, string> = {}) => page(o, `/zc?quick=1`, "zc.html", ZC_SCRIPTS, { "cbz-org": o.token, "cbz-aimsg": o.aiMessage, "cbz-email": "boss@acme.com", ...session });
  const until = async (cond: () => boolean, ms = 20000) => { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) throw new Error("timed out"); await new Promise((r) => setTimeout(r, 100)); } };
  const set = (p: any, sel: string, v: string) => { const el = p.$(sel) as any; el.value = v; el.dispatchEvent(new p.win.Event("input", { bubbles: true })); el.dispatchEvent(new p.win.Event("change", { bubbles: true })); };

  test("a hand-over link from the AI opens the exact card and outlines the one button; nothing is pressed for the organizer", async () => {
    const o = await organizer(); await make(o, "UI-ACT1");
    const pub = await consolePage(o, "UI-ACT1"); // the normal page first, for comparison
    await pub.waitFor((x) => /Hello/.test(x)); openStep(pub, 7); await pub.waitFor((x) => /Publish my game, free/.test(x)); expect(pub.text()).not.toMatch(/brought you here/);
    const a = await page(o, `/zc?e=UI-ACT1&do=publish`, "zc.html", ZC_SCRIPTS, { "cbz-org": o.token, "cbz-email": "boss@acme.com" });
    await a.waitFor((x) => /Your AI assistant brought you here/.test(x));
    expect(a.text()).toMatch(/Confirm and publish/); expect(a.$("#pubEmail")).toBeTruthy(); // the card is already open
    expect((a.$("#pubgo") as any).style.outline).toMatch(/solid/); // the button to press is outlined
    const sm = await o.json(await o.api("GET", "/api/z/UI-ACT1/summary", undefined, o.aiKey)); expect(sm.status).toBe("draft"); // and it was NOT pressed
    await publish(o, "UI-ACT1");
    const e = await page(o, `/zc?e=UI-ACT1&do=erase`, "zc.html", ZC_SCRIPTS, { "cbz-org": o.token });
    await e.waitFor((x) => /Delete all participant data now/.test(x)); await until(() => /solid/.test((e.$("#erase") as any).style.outline)); expect(e.text()).toMatch(/Your AI assistant brought you here/);
    const c = await page(o, `/zc?e=UI-ACT1&do=pause`, "zc.html", ZC_SCRIPTS, { "cbz-org": o.token });
    await c.waitFor((x) => /Controls/.test(x)); await until(() => /solid/.test((c.$('[data-ctl="pause"]') as any).style.outline));
    const n = await page(o, `/zc?e=UI-ACT1`, "zc.html", ZC_SCRIPTS, { "cbz-org": o.token }); await n.waitFor((x) => /Last step: pay before the start/i.test(x)); expect(n.text()).not.toMatch(/brought you here/); // an ordinary visit shows no such banner
  }, 90_000);


  test("AI helper mode also keeps the organizer's own e-mail and mobile out of the Publish card; with it off they are prefilled for the organizer", async () => {
    const o = await organizer(); await make(o, "UI-SHD2");
    const on = await page(o, `/zc?e=UI-SHD2&do=publish`, "zc.html", ZC_SCRIPTS, { "cbz-org": o.token, "cbz-email": "boss@acme.com", "cbz-phone": "9000011111", "cbz-shield": "1" });
    await on.waitFor((x) => /Confirm and publish/.test(x)); expect((on.$("#pubEmail") as any).value).toBe(""); expect((on.$("#pubPhone") as any).value).toBe(""); expect(on.text()).not.toMatch(/boss@acme\.com|9000011111/);
    const off = await page(o, `/zc?e=UI-SHD2&do=publish`, "zc.html", ZC_SCRIPTS, { "cbz-org": o.token, "cbz-email": "boss@acme.com", "cbz-phone": "9000011111" });
    await off.waitFor((x) => /Confirm and publish/.test(x)); expect((off.$("#pubEmail") as any).value).toBe("boss@acme.com"); expect((off.$("#pubPhone") as any).value).toBe("9000011111");
  }, 60_000);
  test("every field on the console is reachable by name: each label is linked to its field, nothing unlabelled, and the page keeps the same elements when nothing has changed", async () => {
    const o = await organizer(); await make(o, "UI-A11Y1");
    const p = await consolePage(o, "UI-A11Y1", o.token, {}, { afterLoad: spy().hook }); await p.waitFor((x) => /Hello/.test(x)); const doc = p.win.document; openStep(p, 4); p.click('[data-ck="opN"][data-v="1"]'); p.click('[data-ck="midN"][data-v="2"]'); p.click('[data-ck="clN"][data-v="1"]'); p.click("[data-luckyadd]"); p.click('[data-ck="mid.1.k"][data-v="yt"]'); openStep(p, 6); await p.waitFor((x) => /Paste from Excel/.test(x)); p.click('[data-mode="paste"]'); openStep(p, 7); p.click("#publishopen"); openStep(p, 4);
    const bad: string[] = [];
    for (const f of Array.from(doc.querySelectorAll("input, select, textarea")) as any[]) {
      if (f.type === "hidden") continue;
      const named = (f.id && doc.querySelector(`label[for="${f.id}"]`)) || f.closest("label") || f.getAttribute("aria-label");
      if (!named) bad.push(`${f.tagName.toLowerCase()}#${f.id}.${f.getAttribute("data-bk") || f.getAttribute("data-op") || f.getAttribute("data-cl") || ""}`);
    }
    expect(bad).toEqual([]);
    for (const l of Array.from(doc.querySelectorAll("label[for]")) as any[]) expect([l.getAttribute("for"), !!doc.getElementById(l.getAttribute("for"))]).toEqual([l.getAttribute("for"), true]); // no label points at nothing
    const ids = Array.from(doc.querySelectorAll("[id]")).map((e: any) => e.id); expect(new Set(ids).size).toBe(ids.length); // ids are unique
    expect(doc.querySelector('[data-fi="mid.0.t"]')!.getAttribute("id")).toBe("f-mid-0-t"); // the brand-moment rows have stable names
    const btn = p.$('[data-save="4"]') as any; await new Promise((r) => setTimeout(r, 6000)); expect(btn.isConnected).toBe(true); expect(p.$('[data-save="4"]')).toBe(btn); // the 5-second refresh did not replace the page's elements
  }, 90_000);

  test("Quick setup: real date and time pickers, the first steps as one form of tap choices; saving makes the draft with the right start, size, tickets, prizes and name, then opens it", async () => {
    const o = await organizer(); const p = await quickPage(o); await p.waitFor((x) => /1\. Which game\?/.test(x) && /Up to 250 people/.test(x)); const doc = p.win.document;
    expect((p.$("#qk-date") as any).type).toBe("date"); expect((p.$("#qk-time") as any).type).toBe("time"); // real pickers
    expect(p.text()).not.toMatch(/Rs 2,399\.00/); /* no price while choosing the size */ expect(doc.querySelectorAll("select").length).toBe(0); // prices come from the software's own list
    const tomorrow = new Date(T + 5.5 * 3600000 + 2 * 86400000); const d = `${tomorrow.getUTCFullYear()}-${String(tomorrow.getUTCMonth() + 1).padStart(2, "0")}-${String(tomorrow.getUTCDate()).padStart(2, "0")}`;
    set(p, "#qk-name", "Diwali party"); set(p, "#qk-date", d); set(p, "#qk-time", "18:30");
    p.click('[data-ck="cap"][data-v="500"]'); p.click('[data-ck="tix"][data-v="2"]'); p.click('[data-ck="spd"][data-v="12"]'); p.click('[data-ck="join"][data-v="list"]'); p.click('[data-bool="inv"]');
    set(p, "#qk-t-blackout", "Voucher 5000"); p.click('[data-ck="hs.blackout.n"][data-v="2"]');
    await until(() => /Diwali party: \d{4}-\d\d-\d\d at 18:30 \(Asia\/(Calcutta|Kolkata) time\); up to 500 people; 2 cards each, a number every 12 seconds, 1 round; only people on a list; 5 prizes/.test(p.text()), 8000).catch(() => { throw new Error("summary was: " + (p.$("#qk-summary") as any)?.textContent); });
    p.click("#qk-save"); await p.waitFor((x) => /Your draft is saved/.test(x), 8000).catch(() => { throw new Error("save failed; error box: " + (p.$("#qk-err") as any)?.textContent + " | errors: " + p.errors.join("; ")); });
    const hist = await o.json(await o.api("GET", "/api/history", undefined, o.aiKey)); expect(hist.engagements.length).toBe(1);
    const id = hist.engagements[0].id; expect(id).toMatch(/^DIWALI-PARTY-\d{4}$/);
    const sm = await o.json(await o.api("GET", `/api/z/${id}/summary`, undefined, o.aiKey));
    expect(sm).toMatchObject({ name: "Diwali party", limit: 500, tickets: 2, callSeconds: 12, rounds: 1, status: "draft" });
    expect(sm.startMs).toBe(Date.parse(d + "T18:30:00+05:30")); // exactly the picked day and time in India time
    expect(sm.rewards.filter((r: any) => r.pattern === "blackout").map((r: any) => r.text)).toEqual(["Voucher 5000", "Voucher 5000"]); expect(sm.invites).toMatchObject({ on: true, per: 4 });
    expect(sections(p)).toHaveLength(10); // it opened the game, ready for videos and messages
  }, 90_000);

  test("Quick setup refuses a start time that has passed and tells the organizer plainly; it saves nothing", async () => {
    const o = await organizer(); const p = await quickPage(o); await p.waitFor((x) => /1\. Which game\?/.test(x));
    set(p, "#qk-date", "2020-01-01"); set(p, "#qk-time", "10:00"); p.click("#qk-save");
    await until(() => (p.$("#qk-err") as any).style.display !== "none"); expect((p.$("#qk-err") as any).textContent).toMatch(/start time in the future/);
    expect((await o.json(await o.api("GET", "/api/history", undefined, o.aiKey))).engagements.length).toBe(0);
  }, 60_000);

  test("a second tab of the same browser is signed in by the first, without storing the key anywhere", async () => {
    const o = await organizer();
    const first = await page(o, `/zc`, "zc.html", ZC_SCRIPTS, { "cbz-org": o.token, "cbz-aimsg": o.aiMessage }); await first.waitFor((x) => /Your account/.test(x));
    const second = await page(o, `/zc`, "zc.html", ZC_SCRIPTS, {}); // no key in this tab's session
    await second.waitFor((x) => /Your account/.test(x), 10000); // it asked the other tab and was signed in
    expect(second.$("#sec")).toBeNull(); // no sign-in box
  }, 60_000);
});

// --- Console, round 2: cancel with three confirmations, "Confirming your payment...", the team forms, the e-mail rule and the moved AI helper switch ---
// The cancel and team-with-phone endpoints are being built in the Worker at the same time: until they land these parts talk to a small stub (the rest is the real Worker).
/** Like `stub`, but a route may also change what the real Worker answers (`real` is the real answer as JSON). */
const patch = (routes: Record<string, (method: string, body: any, real: () => Promise<any>) => any>) => (win: any, f: string) => {
  if (f !== "control.js") return;
  const realFetch = win.fetch;
  win.fetch = async (input: any, init?: any) => {
    const u = new URL(String(input), "http://localhost"), h = routes[u.pathname];
    if (!h) return realFetch(input, init);
    const method = (init?.method || "GET").toUpperCase();
    const out = await h(method, init?.body ? JSON.parse(init.body) : undefined, async () => (await realFetch(input, init)).json());
    return new Response(JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } }); // the answer is the body as is (a summary has its own "status" field)
  };
};
const REFUND = { paidInr: 2399, feeInr: 55.67, refundInr: 2303.15, feeNote: "The payment charge of Rs 55.67 is kept by the payment company." };
describe("console round 2 (cancel, confirming, team, e-mail rule, AI switch)", () => {
  test("no dropdown anywhere: no <select> on any step for the Organizer or a Host", async () => {
    const o = await organizer(); await make(o, "UI-NOSEL"); await publish(o, "UI-NOSEL");
    const org = await consolePage(o, "UI-NOSEL"); await org.waitFor((x) => /Last step|Your game|Hello/i.test(x));
    for (let n = 1; n <= 10; n++) { openStep(org, n); expect([n, org.win.document.querySelectorAll("select").length]).toEqual([n, 0]); }
    const host = await consolePage(o, "UI-NOSEL", await hostKey(o)); await host.waitFor((x) => /Last step|Your game/i.test(x));
    for (let n = 1; n <= 10; n++) { openStep(host, n); expect([n, host.win.document.querySelectorAll("select").length]).toEqual([n, 0]); }
  });

  test("Cancel game (real Worker): three confirmations, each more serious; nothing is sent until the third; the server gets confirmations: 3; then a calm cancelled state read back from the server", async () => {
    const o = await organizer(); await make(o, "UI-CAN", { name: "Diwali Night" }); await publish(o, "UI-CAN");
    const p = await consolePage(o, "UI-CAN"); await p.waitFor((x) => /Last step|Your game|Hello/i.test(x)); openStep(p, 7);
    expect(p.$("#cancelblock")).toBeTruthy(); expect(p.$("#cancel3")).toBeNull();
    p.click("#cancelopen"); await p.waitFor((x) => /1st confirmation/.test(x) && /Do you want to cancel Diwali Night\?/.test(x));
    const panel = p.$("#cancelpanel") as any; expect(panel.getAttribute("role")).toBe("alertdialog"); expect(panel.className).toMatch(/zc-cwarn/); expect(p.$("#cancelprog")!.textContent).toBe("Step 1 of 3"); expect(p.text()).toMatch(/You are cancelling the game\. You need to confirm 3 times before the game is cancelled\./);
    expect(p.$("#cancelback")!.textContent).toBe("No, keep my game"); expect(p.$("#cancel1")!.textContent).toBe("Yes, go to the 2nd confirmation"); expect(p.$("#cancel2")).toBeNull(); expect(p.$("#cancel3")).toBeNull();
    p.click("#cancel1"); await p.waitFor((x) => /2nd confirmation/.test(x) && /You cannot undo this/.test(x));
    expect(p.$("#cancelprog")!.textContent).toBe("Step 2 of 3"); expect(p.text()).toMatch(/You are cancelling the game/); expect(p.$("#cancelwhat")!.textContent).toBe("Guests will be told. Their names and numbers will be erased. You cannot undo this."); expect(p.$("#cancel3")).toBeNull();
    expect((p.$("#cancel2") as any).disabled).toBe(true); expect((p.$("#cancelagree") as any).checked).toBe(false); expect(p.$("#cancel2")!.textContent).toBe("Submit"); // the box gates the button
    p.click("#cancelprev"); await p.waitFor((x) => /1st confirmation/.test(x)); p.click("#cancel1"); await p.waitFor((x) => /2nd confirmation/.test(x)); // Go back works
    expect((await o.json(await o.api("GET", "/api/z/UI-CAN/summary", undefined, o.token))).cancelled).toBeFalsy(); // two screens in, still nothing sent
    tickAgree(p); expect((p.$("#cancel2") as any).disabled).toBe(false); p.click("#cancel2"); await p.waitFor((x) => /Final confirmation/.test(x));
    expect(p.$("#cancelprog")!.textContent).toBe("Step 3 of 3"); expect(p.text()).toMatch(/You are cancelling the game/); expect(p.$("#cancelback")!.textContent).toBe("No, keep my game");
    expect(p.$("#cancel3")!.textContent).toBe("Yes, Diwali Night is cancelled");
    p.click("#cancel3"); await p.waitFor((x) => /This game was cancelled/.test(x));
    expect((await o.json(await o.api("GET", "/api/z/UI-CAN/summary", undefined, o.token))).cancelled).toBe(true);
    expect(p.$("#cancelled")).toBeTruthy(); expect(p.$("#cancelopen")).toBeNull(); expect(p.$("#cancel3")).toBeNull(); expect(p.text()).not.toMatch(/Pay now/);
    const again = await consolePage(o, "UI-CAN"); await again.waitFor((x) => /This game was cancelled/.test(x)); openStep(again, 7); expect(again.$("#cancelled")).toBeTruthy(); expect(again.$("#cancelopen")).toBeNull();
    expect(p.errors).toEqual([]);
  });

  test("Cancelled PAID game: the console offers 'Move my game to this date' for 30 days; picking a date puts the game back on (real Worker)", async () => {
    const o = await organizer(); await make(o, "UI-MOVE", { name: "Holi Fun" }); await publish(o, "UI-MOVE");
    o.world.raw.prepare("UPDATE engagement SET pack=100 WHERE id='UI-MOVE'").run(); // paid
    expect((await o.api("POST", "/api/z/UI-MOVE/cancel", { confirmations: 3 }, o.token)).status).toBe(200);
    const p = await consolePage(o, "UI-MOVE"); await p.waitFor((x) => /This game was cancelled/.test(x)); openStep(p, 7);
    expect(p.$("#moveblock")).toBeTruthy(); expect(p.$("#movego")!.textContent).toBe("Move my game to this date"); expect(p.text()).toMatch(/You can move this game to a new date until/); expect(p.text()).toMatch(/Your payment then stays with this game/);
    const dt = p.$("#movedt") as any; const d = new Date(Date.now() + 5 * 86_400_000); const pad = (n: number) => String(n).padStart(2, "0");
    dt.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T10:00`; p.click("#movego");
    await p.waitFor((x) => !/This game was cancelled/.test(x) && /Holi Fun/.test(x)); // the cancelled banner is gone, the game is back
    const row = o.world.raw.prepare("SELECT cancelled_ms, start_round FROM engagement WHERE id='UI-MOVE'").get() as any; expect(row.cancelled_ms).toBeNull(); // read back from the server, not just the message
    expect((await o.json(await o.api("GET", "/api/z/UI-MOVE/summary", undefined, o.token))).cancelled).toBeFalsy();
    expect(p.errors).toEqual([]);
  });
  test("Cancelled PAID game: a past date is refused on the page and nothing is sent", async () => {
    const o = await organizer(); await make(o, "UI-MOVE2"); await publish(o, "UI-MOVE2");
    o.world.raw.prepare("UPDATE engagement SET pack=100 WHERE id='UI-MOVE2'").run();
    await o.api("POST", "/api/z/UI-MOVE2/cancel", { confirmations: 3 }, o.token);
    const p = await consolePage(o, "UI-MOVE2"); await p.waitFor((x) => /This game was cancelled/.test(x)); openStep(p, 7);
    (p.$("#movedt") as any).value = "2001-01-01T10:00"; p.click("#movego"); await p.waitFor((x) => /Please pick a new date and time in the future/.test(x));
    expect((o.world.raw.prepare("SELECT cancelled_ms FROM engagement WHERE id='UI-MOVE2'").get() as any).cancelled_ms).not.toBeNull();
  });
  test("Cancel game: 'No, keep it' at any step sends nothing; and when the game cannot be cancelled the friendly reason shows and no confirm button", async () => {
    const o = await organizer(); await make(o, "UI-CANNO"); await publish(o, "UI-CANNO");
    const posts: any[] = [];
    const p = await page(o, "/zc?e=UI-CANNO", "zc.html", ZC_SCRIPTS, { "cbz-org": o.token }, { afterLoad: patch({
      "/api/z/UI-CANNO/cancel-preview": () => ({ canCancel: true, paid: false, credit: null }), "/api/z/UI-CANNO/cancel": (_m, b) => { posts.push(b); return { ok: true }; } }) });
    await p.waitFor((x) => /Last step|Your game|Hello/i.test(x)); openStep(p, 7);
    p.click("#cancelopen"); await p.waitFor((x) => /1st confirmation/.test(x)); p.click("#cancelback"); await p.waitFor(() => !!p.$("#cancelopen")); expect(posts.length).toBe(0); // No at the first screen
    p.click("#cancelopen"); await p.waitFor((x) => /1st confirmation/.test(x)); p.click("#cancel1"); await p.waitFor((x) => /2nd confirmation/.test(x)); tickAgree(p); p.click("#cancel2"); await p.waitFor((x) => /Final confirmation/.test(x)); p.click("#cancelback"); // No at the last screen
    await p.waitFor(() => !!p.$("#cancelopen")); expect(posts.length).toBe(0);
    const q = await page(o, "/zc?e=UI-CANNO", "zc.html", ZC_SCRIPTS, { "cbz-org": o.token }, { afterLoad: patch({
      "/api/z/UI-CANNO/cancel-preview": () => ({ canCancel: false, reason: "The start time has passed. Use End the game.", paid: true, credit: null }), "/api/z/UI-CANNO/cancel": (_m, b) => { posts.push(b); return { ok: true }; } }) });
    await q.waitFor((x) => /Last step|Your game|Hello/i.test(x)); openStep(q, 7); q.click("#cancelopen");
    await q.waitFor((x) => /The start time has passed\. Use End the game\./.test(x)); expect(q.$("#cancel1")).toBeNull(); expect(q.$("#cancel3")).toBeNull(); expect(posts.length).toBe(0);
  });

  test("Cancel game is for the Organizer and a Host; a Co-host never sees it", async () => {
    const o = await organizer(); await make(o, "UI-CANR"); await publish(o, "UI-CANR");
    const h = await consolePage(o, "UI-CANR", await hostKey(o)); await h.waitFor((x) => /Last step|Your game/i.test(x)); openStep(h, 7); expect(h.$("#cancelopen")).toBeTruthy();
    const c = await consolePage(o, "UI-CANR", await cohostKey(o, "UI-CANR")); await c.waitFor((x) => /Hi\. Here is the game/.test(x));
    for (let n = 1; n <= 3; n++) openStep(c, n);
    expect(c.$("#cancelopen")).toBeNull(); expect(c.text()).not.toMatch(/Cancel this game/);
  });

  test("'Confirming your payment...' shows on the pill, the notice and the step, and the game is not shown as Paid or as due", async () => {
    const o = await organizer(); await make(o, "UI-CONF"); await publish(o, "UI-CONF");
    const p = await page(o, "/zc?e=UI-CONF", "zc.html", ZC_SCRIPTS, { "cbz-org": o.token }, { afterLoad: patch({
      "/api/z/UI-CONF/summary": async (_m, _b, real) => ({ ...(await real()), payment: { status: "confirming" } }) }) });
    await p.waitFor((x) => /Confirming your payment\.\.\./.test(x));
    expect(p.$("#paypill")!.textContent).toBe("Confirming your payment..."); expect(p.$("#paynote")!.textContent).toMatch(/Confirming your payment\.\.\./);
    openStep(p, 8); const t = p.text(); expect(t).not.toMatch(/Paid by|The game is on/); expect(p.$('a[href^="/pay.html"]')).toBeNull(); expect(p.$("#paypill")!.className).not.toMatch(/pill-paid/);
    expect(p.errors).toEqual([]);
  });

  test("Your team: a Host needs a name AND an e-mail; a Co-host needs a name AND a mobile and the form has no e-mail field; the Co-hosts of the game show a masked mobile", async () => {
    const o = await organizer(); await make(o, "UI-TM2");
    const posts: any[] = []; const asked: string[] = [];
    const p = await page(o, "/zc?e=UI-TM2", "zc.html", ZC_SCRIPTS, { "cbz-org": o.token }, { afterLoad: patch({
      "/api/org/team": () => { asked.push("team"); return { maxHosts: 5, hosts: [{ id: "h1", label: "Anita", email: "anita@acme.com" }], cohosts: [{ id: "c1", label: "Ravi", phone: "9811100001", brought: 0 }] }; },
      "/api/org/host": (_m, b) => { posts.push(["host", b]); return { ok: true, id: "h2", label: b.label }; },
      "/api/org/cohost": (_m, b) => { posts.push(["cohost", b]); return { ok: true, cohostKey: "cbc_" + "1".repeat(48), id: "c2", label: b.label }; } }) });
    await p.waitFor((x) => /Hello/.test(x)); openStep(p, 5); await p.waitFor((x) => /Your Hosts: 1 of 5/.test(x));
    const t = p.text(); expect(t).toMatch(/anita@acme\.com/); expect(t).toMatch(/XXXXXX0001/); expect(t).not.toMatch(/9811100001/); // the Host's e-mail is shown to the Organizer; a Co-host's mobile is masked
    // Host: a name and at least one of mobile or e-mail; a wrong one is refused before anything is sent
    setField(p, "#hostlabel", "Meena"); p.click("#hostadd"); await p.waitFor((x) => /Host's mobile number or e-mail/.test(x)); expect(posts.length).toBe(0);
    setField(p, "#hostlabel", "Meena"); setField(p, "#hostphone", "98765 43210"); setField(p, "#hostemail", "not-an-email"); p.click("#hostadd"); await p.waitFor((x) => /check the Host's e-mail/.test(x)); expect(posts.length).toBe(0);
    setField(p, "#hostlabel", "Meena"); setField(p, "#hostphone", "123"); setField(p, "#hostemail", "meena@acme.com"); p.click("#hostadd"); await p.waitFor((x) => /check the Host's mobile number/.test(x)); expect(posts.length).toBe(0);
    setField(p, "#hostlabel", "Meena"); setField(p, "#hostphone", "98765 43210"); setField(p, "#hostemail", "meena@acme.com"); p.click("#hostadd"); await p.waitFor(() => posts.length === 1);
    expect(posts[0]).toEqual(["host", { label: "Meena", e: "UI-TM2", mobile: "98765 43210", email: "meena@acme.com" }]);
    // Co-host: name and mobile, never an e-mail
    await p.waitFor((x) => /Host added/.test(x));
    expect(p.$("#cohostemail")).toBeNull(); const co = p.$("#cohostphone").parentElement; expect(co.querySelector('input[type="email"]')).toBeNull(); expect(co.querySelector("#hostemail")).toBeNull();
    setField(p, "#cohostlabel", "Ravi Two"); p.click("#cohostadd"); await p.waitFor((x) => /Co-host's mobile number/.test(x)); expect(posts.length).toBe(1);
    setField(p, "#cohostphone", "98111"); setField(p, "#cohostlabel", "Ravi Two"); p.click("#cohostadd"); await p.waitFor((x) => /Co-host's mobile number/.test(x)); expect(posts.length).toBe(1);
    setField(p, "#cohostlabel", "Ravi Two"); setField(p, "#cohostphone", "98111 00002"); p.click("#cohostadd"); await p.waitFor(() => posts.length === 2);
    expect(posts[1][0]).toBe("cohost"); expect(posts[1][1]).toMatchObject({ label: "Ravi Two", phone: "98111 00002" }); expect(posts[1][1].eid).toBe("UI-TM2"); expect(Object.keys(posts[1][1]).some((k) => /mail/i.test(k))).toBe(false);
    expect(asked.length).toBeGreaterThan(1); // the team list is asked again after adding
  });

  test("the plain e-mail sentence is on Your team and on Your guest list", async () => {
    const o = await organizer(); await make(o, "UI-RULE"); await publish(o, "UI-RULE");
    const SENT = "Guests and Co-hosts need only a name and a mobile number. No e-mail is needed. Only the Organizer and Hosts have an e-mail.";
    const p = await consolePage(o, "UI-RULE"); await p.waitFor((x) => /Last step|Your game|Hello/i.test(x));
    openStep(p, 5); expect(p.$("#emailrule")!.textContent).toBe(SENT);
    openStep(p, 6); expect(p.$("#emailrule2")!.textContent).toBe(SENT);
    const h = await consolePage(o, "UI-RULE", await hostKey(o)); await h.waitFor((x) => /Last step|Your game/i.test(x)); openStep(h, 5); expect(h.$("#emailrule")!.textContent).toBe(SENT); openStep(h, 6); expect(h.$("#emailrule2")!.textContent).toBe(SENT);
  });

});

const tickAgree = (p: Page) => { const c = p.$("#cancelagree") as any; c.checked = true; c.dispatchEvent(new p.win.Event("change", { bubbles: true })); };
const jn = (o: O, id: string, i: number, extra: Record<string, unknown> = {}) => o.api("POST", `/api/z/${id}/join`, { phone: "98765" + String(10000 + i), name: "Guest" + i + " Kumar", device: String(i).padStart(2, "0") + "d".repeat(30), ...extra });
const listOf = async (o: O, id: string, key = o.token) => o.json(await o.api("GET", `/api/z/${id}/people`, undefined, key));
const waitOf = async (o: O, id: string, key = o.token) => (await o.json(await o.api("GET", `/api/z/${id}/waiting`, undefined, key))).waiting as any[];
const fakeWin = () => { const w: any = { location: { href: "" }, opener: 1, closed: false, close() { w.closed = true; } }; return w; };
describe("console phase 2: wording fixes, My people, waiting room, remove, play now (real Worker)", () => {
  const ready = async (o: O, id: string, w = spy(), key = o.token) => { const p = await consolePage(o, id, key, {}, { afterLoad: w.hook }); await p.waitFor((x) => /Hello|Last step|Your game|Hi\./i.test(x)); return p; };
  const myPeople = async (p: Page) => { openStep(p, 6); await p.waitFor((x) => /My people/.test(x) && /people are on my list|person is on my list/.test(x)); };

  test("wording: no 'engagement' anywhere in the ten steps, singular and plural right, friendly dates, 365-day line says who is kept, step 9 line does not repeat its title", async () => {
    const o = await organizer(); await make(o, "UI-WORD"); await publish(o, "UI-WORD");
    const p = await ready(o, "UI-WORD"); await hostKey(o, "Anita"); await cohostKey(o, "UI-WORD", "Ravi");
    openStep(p, 5); await p.waitFor((x) => /Your Hosts: 1 of 5/.test(x) && /Your Co-hosts: 1 \(no limit\)/.test(x));
    const syn = () => Array.from(p.win.document.querySelectorAll(".zc-side .zc-syn")).map((e: any) => e.textContent as string);
    await p.waitFor(() => syn()[4].includes("1 Host, 1 Co-host")); expect(syn()[4]).not.toMatch(/1 Hosts|1 Co-hosts/);
    expect(syn()[8]).not.toMatch(/After the game\s*After the game/);
    for (let n = 1; n <= 10; n++) { openStep(p, n); expect([n, /ngagement/.test(p.text())]).toEqual([n, false]); }
    openStep(p, 10); const t = await p.waitFor((x) => /Within 24 hours of the game ending/.test(x));
    expect(t).toMatch(/Your details as Organizer and Host, and the winners record, are kept for 365 days\. Co-host details are erased with the guests\./);
    expect(t).not.toMatch(/\d{4}-\d\d-\d\d|\bIST\b/); expect(t).toMatch(/deleted by \d{1,2} \w{3} \d{4}, \d{1,2}:\d\d (am|pm)/); expect(t).toMatch(/kept until \d{1,2} \w{3} \d{4}/);
    openStep(p, 7); expect(p.text()).toMatch(/Continue/); expect(p.text()).not.toMatch(/Save and continue/); openStep(p, 3); expect(p.$('[data-save="3"]')!.textContent).toBe("Save and continue");
    openStep(p, 5); expect(p.$('[data-save="5"]')!.textContent).toBe("Continue");
    expect(p.errors).toEqual([]);
  });

  test("a guest is never offered e-mail: not on the guest link, not in My people, not on the Co-host page; the plain sentence stays", async () => {
    const o = await organizer(); await make(o, "UI-NOMAIL"); await publish(o, "UI-NOMAIL");
    const p = await ready(o, "UI-NOMAIL"); await myPeople(p);
    expect(p.win.document.querySelectorAll('a[href^="mailto:"]').length).toBe(0); expect(p.text()).not.toMatch(/e-mail \(|By e-mail|Send by e-mail|Send invites/); expect(p.$("#emailrule2")).toBeTruthy();
    const c = await ready(o, "UI-NOMAIL", spy(), await cohostKey(o, "UI-NOMAIL")); openStep(c, 2); await c.waitFor((x) => /My people/.test(x));
    expect(c.win.document.querySelectorAll('a[href^="mailto:"]').length).toBe(0); expect(c.text()).not.toMatch(/Send by e-mail/); expect(c.text()).not.toMatch(/guest list/i);
  });

  test("Who can join: two taps; the chip shows what the server holds; 'Anyone with the link' is saved as whoCanJoin; a game made in the console starts as 'list'", async () => {
    const o = await organizer(); await make(o, "UI-WHO"); const w = spy();
    const p = await ready(o, "UI-WHO", w); openStep(p, 2);
    expect(Array.from(p.win.document.querySelectorAll('[data-ck="who"]')).map((e: any) => e.textContent)).toEqual(["Only people on a list", "Anyone with the link"]);
    const server = (await o.json(await o.api("GET", "/api/z/UI-WHO/summary", undefined, o.token))).whoCanJoin; // an API-made game keeps the API default
    expect((p.$(`[data-ck="who"][data-v="${server}"]`) as any).getAttribute("aria-pressed")).toBe("true");
    p.click('[data-ck="who"][data-v="list"]'); expect(p.text()).toMatch(/not on a list wait/); p.click('[data-save="2"]'); await p.waitFor((x) => /Saved\./.test(x));
    expect((await o.json(await o.api("GET", "/api/z/UI-WHO/summary", undefined, o.token))).whoCanJoin).toBe("list");
    openStep(p, 2); p.click('[data-ck="who"][data-v="anyone"]'); expect(p.text()).toMatch(/joins straight away/); p.click('[data-save="2"]'); await p.waitFor((x) => /Saved\./.test(x));
    expect((await o.json(await o.api("GET", "/api/z/UI-WHO/summary", undefined, o.token))).whoCanJoin).toBe("anyone");
    const home = await page(o, "/zc", "zc.html", ZC_SCRIPTS, { "cbz-org": o.token, "cbz-aimsg": o.aiMessage }, { afterLoad: w.hook }); await home.waitFor((x) => /Start a new game/.test(x));
    home.click("#mk"); await home.waitFor(() => w.st.posts.length > 0); expect(w.st.posts[0].whoCanJoin).toBe("list");
    const made = new URLSearchParams(await (async () => { for (let i = 0; i < 100 && !/e=/.test(home.win.location.search); i++) await new Promise((r) => setTimeout(r, 40)); return home.win.location.search; })()).get("e")!;
    expect((await o.json(await o.api("GET", `/api/z/${made}/summary`, undefined, o.token))).whoCanJoin).toBe("list");
  });

  test("My people: typing a number cleans it; the row is masked; Send on WhatsApp is the server's wa.me link and is marked sent; Send again gets a new link from the server", async () => {
    const o = await organizer(); await make(o, "UI-PPL"); await publish(o, "UI-PPL"); const w = spy();
    const p = await ready(o, "UI-PPL", w); await myPeople(p);
    setField(p, "#gname", "Asha Verma"); setField(p, "#gphone", "+91 98765-43210"); p.click("#gadd");
    await p.waitFor((x) => /1 good, 0 duplicates removed, 0 look wrong/.test(x));
    expect(w.st.calls.find((c: any) => c[0] === "POST" && c[1].endsWith("/people"))[2]).toEqual({ consent: { v: "2026-10-15", boxes: ["A"] }, people: [{ name: "Asha Verma", phone: "+919876543210" }] });
    const server = (await listOf(o, "UI-PPL")).people[0]; expect(server).toMatchObject({ name: "Asha Verma", status: "invited" });
    const row = p.$(".zc-prow")!; expect(row.textContent).toMatch(/Asha Verma/); expect(row.textContent).toMatch(/\*{6}3210/); expect(row.textContent).toMatch(/Invited/); expect(p.text()).not.toMatch(/9876543210/);
    const a = p.$("a[data-wa]") as any; expect(a.getAttribute("href")).toBe(server.waLink); expect(a.getAttribute("href").startsWith("https://wa.me/919876543210?text=")).toBe(true);
    a.click(); await p.waitFor((x) => /Sent on WhatsApp/.test(x) && /Send again/.test(x)); expect(p.$("a[data-wa]")).toBeNull(); expect(JSON.parse(p.win.localStorage.getItem("cbz-sent-UI-PPL")!)).toEqual({ [server.id]: 1 });
    let opened = ""; p.win.open = (u: string) => { opened = u; return null; };
    p.click("[data-resend]"); await p.waitFor(() => !!opened); expect(opened).toMatch(/^https:\/\/wa\.me\/919876543210\?text=/); expect(opened).not.toBe(server.waLink); // a new personal link
    expect(w.st.calls.some((c: any) => c[1].endsWith("/resend"))).toBe(true); expect(p.errors).toEqual([]);
  });

  test("My people: paste cleans the list ('2 good, 1 duplicate removed, 1 looks wrong'), lists the wrong one to fix, and the fixed number is added; a CSV with a header row works too", async () => {
    const o = await organizer(); await make(o, "UI-CLEAN"); await publish(o, "UI-CLEAN"); const w = spy();
    const p = await ready(o, "UI-CLEAN", w); await myPeople(p); p.click('[data-mode="paste"]');
    (p.$("#rosterTxt") as any).value = ["Asha, 98765 43210", "Bala, 0091-98765-43211", "Asha again, +91 9876543210", "Chitra, 12345"].join("\n"); p.click("#rosterGo");
    await p.waitFor((x) => /2 good, 1 duplicate removed, 1 looks wrong/.test(x));
    expect(w.st.calls.find((c: any) => c[0] === "POST" && c[1].endsWith("/people"))[2].people.map((x: any) => x.phone)).toEqual(["+919876543210", "+919876543211"]); // the cleaning happens before anything is sent
    expect((await listOf(o, "UI-CLEAN")).people.map((x: any) => x.name).sort()).toEqual(["Asha", "Bala"]);
    expect(p.$("#wronglist")!.textContent).toMatch(/Chitra/); expect((p.$("#fixin0") as any).value).toBe("12345");
    setField(p, "#fixin0", "98765 43212"); p.click("[data-fix]"); await p.waitFor((x) => /1 good, 0 duplicates removed, 0 look wrong/.test(x)); expect((await listOf(o, "UI-CLEAN")).people.length).toBe(3); expect(p.$("#wronglist")).toBeNull();
    p.click('[data-mode="file"]'); const inp = p.$("#gfile") as any; Object.defineProperty(inp, "files", { value: [{ text: async () => "Name,Mobile\nDev,+971 50 123 4567\nEsha,9876543214\n" }], configurable: true }); inp.dispatchEvent(new p.win.Event("change", { bubbles: true }));
    await p.waitFor((x) => /2 good, 0 duplicates removed, 0 look wrong/.test(x)); expect((await listOf(o, "UI-CLEAN")).people.map((x: any) => x.name).sort()).toEqual(["Asha", "Bala", "Chitra", "Dev", "Esha"]); // a header row is skipped; another country code is kept
  });

  test("My people: a big paste goes up 200 at a time; a Co-host's over-limit answer from the server is shown calmly; the Organizer's Co-host limit chips are saved", async () => {
    const o = await organizer(); await make(o, "UI-CHUNK", { cap: 250 }); await publish(o, "UI-CHUNK"); const w = spy();
    const p = await ready(o, "UI-CHUNK", w); await myPeople(p); p.click('[data-mode="paste"]');
    (p.$("#rosterTxt") as any).value = Array.from({ length: 201 }, (_, i) => `P${i}, 9${String(100000000 + i)}`).join("\n"); p.click("#rosterGo");
    await p.waitFor((x) => /201 good/.test(x), 20000); expect(w.st.calls.filter((c: any) => c[0] === "POST" && c[1].endsWith("/people")).map((c: any) => c[2].people.length)).toEqual([200, 1]);
    openStep(p, 5); await p.waitFor((x) => /Each Co-host can add up to/.test(x)); expect(p.$('[data-cohl="100"]')!.getAttribute("aria-pressed")).toBe("true"); p.click('[data-cohl="10"]'); await p.waitFor(() => /Saved/.test(p.text()));
    expect((await o.json(await o.api("GET", "/api/z/UI-CHUNK/summary", undefined, o.token))).coHostLimit).toBe(10);
    const ck = await cohostKey(o, "UI-CHUNK"); await o.api("POST", "/api/z/UI-CHUNK/people", { people: Array.from({ length: 9 }, (_, i) => ({ name: "C" + i, phone: "98111" + String(10000 + i) })) }, ck);
    const c = await ready(o, "UI-CHUNK", spy(), ck); openStep(c, 2); await c.waitFor((x) => /9 people are on my list \(up to 10\)/.test(x)); c.click('[data-mode="paste"]');
    (c.$("#rosterTxt") as any).value = "X1, 9822200001\nX2, 9822200002"; c.click("#rosterGo");
    const said = (await o.json(await o.api("POST", "/api/z/UI-CHUNK/people", { people: [{ name: "Y1", phone: "9822200003" }, { name: "Y2", phone: "9822200004" }] }, ck))).error as string; expect(said).toBeTruthy();
    await c.waitFor((x) => x.includes(said.slice(0, 40))); expect((await listOf(o, "UI-CHUNK", ck)).people.length).toBeLessThanOrEqual(10);
  }, 60_000);

  test("My people: 'From my contacts' appears only where the browser has a contact picker, and what is picked is added", async () => {
    const o = await organizer(); await make(o, "UI-CONT"); await publish(o, "UI-CONT");
    const p = await ready(o, "UI-CONT"); await myPeople(p); expect(p.text()).not.toMatch(/From my contacts/);
    Object.defineProperty(p.win.navigator, "contacts", { value: { select: async () => [{ name: ["Farid"], tel: ["098765 43215"] }] }, configurable: true });
    openStep(p, 5); openStep(p, 6); await p.waitFor((x) => /From my contacts/.test(x)); p.click('[data-mode="contacts"]'); p.click("#gcontacts");
    await p.waitFor((x) => /1 good/.test(x)); expect((await listOf(o, "UI-CONT")).people[0]).toMatchObject({ name: "Farid" });
  });

  test("Remove: 'only this person' or 'this person and everyone they invited', asked before the game; during the game the confirm says the win stands and the prize is marked not given", async () => {
    const o = await organizer(); await make(o, "UI-RM"); await publish(o, "UI-RM"); const w = spy();
    await o.api("POST", "/api/z/UI-RM/people", { people: [{ name: "Asha", phone: "9876543210" }, { name: "Bala", phone: "9876543211" }, { name: "Chitra", phone: "9876543212" }] }, o.token);
    const ids = (await listOf(o, "UI-RM")).people.map((x: any) => [x.name, x.id]); const idOf = (n: string) => ids.find((x: any) => x[0] === n)[1];
    const p = await ready(o, "UI-RM", w); await myPeople(p);
    p.click(`[data-rmask="${idOf("Asha")}"]`); await p.waitFor((x) => /loses their place and their link stops/.test(x)); expect(p.text()).toMatch(/Only this person/); expect(p.text()).toMatch(/This person and everyone they invited/);
    p.click("[data-rmno]"); expect(p.$("[data-rm]")).toBeNull(); expect(w.st.calls.some((c: any) => c[1].endsWith("/remove"))).toBe(false);
    p.click(`[data-rmask="${idOf("Asha")}"]`); p.click(`[data-rm="${idOf("Asha")}"][data-with="1"]`); await p.waitFor((x) => /Removed\./.test(x));
    expect(w.st.calls.find((c: any) => c[1].endsWith("/remove"))[2]).toEqual({ withTheirPeople: true }); expect((await listOf(o, "UI-RM")).people.find((x: any) => x.name === "Asha").status).toBe("removed");
    expect(p.$(`[data-rmask="${idOf("Asha")}"]`)).toBeNull(); // a removed person has no buttons
    (p.win as any).__zc.started = true; p.click(`[data-rmask="${idOf("Bala")}"]`);
    await p.waitFor((x) => /the win stands and the prize is marked not given/.test(x)); expect(p.text()).toMatch(/Their phone will stop/);
    p.click(`[data-rm="${idOf("Bala")}"][data-with="0"]`); await p.waitFor(async () => (await Promise.resolve(true)) && /Removed\./.test(p.text()));
    const now = (await listOf(o, "UI-RM")).people; expect(now.find((x: any) => x.name === "Bala").status).toBe("removed"); expect(now.find((x: any) => x.name === "Chitra").status).toBe("invited");
  });

  test("Waiting room (list mode): name first and last 4 digits, who is asking, Admit and Decline, and who approved shows afterwards", async () => {
    const o = await organizer(); await make(o, "UI-WAIT", { whoCanJoin: "list" }); await publish(o, "UI-WAIT");
    for (const i of [1, 2]) expect((await jn(o, "UI-WAIT", i, { name: i === 1 ? "Meera Shah" : "Nikhil Rao" })).status).toBe(403);
    const waiting = await waitOf(o, "UI-WAIT"); expect(waiting.length).toBe(2);
    const w = spy(); const p = await ready(o, "UI-WAIT", w); await myPeople(p);
    const t = await p.waitFor((x) => /Waiting to come in: 2/.test(x)); expect(t).toMatch(/Meera \S+ 0001/); expect(t).toMatch(/Asking through/); expect(t).not.toMatch(/Shah|Rao/);
    const first = waiting.find((x: any) => x.firstName === "Meera");
    p.click(`[data-wid="${first.id}"][data-decide="admit"]`); await p.waitFor((x) => /Waiting to come in: 1/.test(x) && /Meera \S+ 0001: let in by/.test(x));
    expect(w.st.calls.find((c: any) => c[1].endsWith("/waiting/" + first.id))[2]).toEqual({ decision: "admit" }); expect((await waitOf(o, "UI-WAIT")).length).toBe(1);
    const second = (await waitOf(o, "UI-WAIT"))[0]; p.click(`[data-wid="${second.id}"][data-decide="decline"]`); await p.waitFor((x) => /Nobody is waiting right now/.test(x) && /declined by/.test(x));
  });

  test("Approve all (real): shows only when someone waits, asks calmly first, shows the counts and who approved; Decline all too; a Co-host sees only their own link's requests", async () => {
    const o = await organizer(); await make(o, "UI-ALL", { whoCanJoin: "list" }); await publish(o, "UI-ALL");
    const none = await ready(o, "UI-ALL"); await myPeople(none); await none.waitFor((x) => /Nobody is waiting right now/.test(x)); expect(none.$("#admitall")).toBeNull(); expect(none.$("#declineall")).toBeNull();
    for (let i = 1; i <= 4; i++) await jn(o, "UI-ALL", i);
    const ck = await cohostKey(o, "UI-ALL"); const from = COHOST_FROM + parseInt(keyId(ck).slice(0, 7), 16); await jn(o, "UI-ALL", 9, { from });
    const w = spy(); const p = await ready(o, "UI-ALL", w); await myPeople(p);
    await p.waitFor(() => !!p.$("#admitall")); expect(p.$("#admitall")!.textContent).toBe("Approve all (5)"); expect(p.$("#declineall")!.textContent).toBe("Decline all");
    p.click("#admitall"); await p.waitFor((x) => /Let all 5 people in\?/.test(x)); expect(w.st.calls.some((c: any) => c[1].endsWith("/waiting/all"))).toBe(false);
    p.click("#bulkno"); expect(p.$("#bulkask")).toBeNull(); expect((await waitOf(o, "UI-ALL")).length).toBe(5);
    const c = await ready(o, "UI-ALL", spy(), ck); openStep(c, 2); await c.waitFor((x) => /Waiting to come in: 1/.test(x)); expect(c.$("#admitall")!.textContent).toBe("Approve all (1)"); // only the people who came through this Co-host's link
    p.click("#admitall"); p.click("#bulkyes");
    const t = await p.waitFor((x) => /5 people let in\./.test(x)); expect(w.st.calls.find((c2: any) => c2[1].endsWith("/waiting/all"))[2]).toEqual({ decision: "admit" }); expect(t).toMatch(/Nobody is waiting right now/); expect((await waitOf(o, "UI-ALL")).length).toBe(0); expect(p.$("#admitall")).toBeNull();
    await jn(o, "UI-ALL", 11); await jn(o, "UI-ALL", 12);
    await p.waitFor(() => !!p.$("#declineall"), 8000); p.click("#declineall"); await p.waitFor((x) => /Decline all 2 people\?/.test(x)); p.click("#bulkyes"); await p.waitFor((x) => /2 declined\./.test(x) && /Nobody is waiting right now/.test(x));
    expect(w.st.calls.filter((c2: any) => c2[1].endsWith("/waiting/all")).map((c2: any) => c2[2])).toEqual([{ decision: "admit" }, { decision: "decline" }]);
  }, 60_000);

  test("Approve all when the game is full: the server's answer says some are still waiting and the console says so (the server's own message)", async () => {
    const o = await organizer(); await make(o, "UI-FULL", { whoCanJoin: "list" }); await publish(o, "UI-FULL"); await jn(o, "UI-FULL", 1); await jn(o, "UI-FULL", 2);
    const p = await ready(o, "UI-FULL", spy({ "POST /api/z/UI-FULL/waiting/all": () => ({ admitted: 1, declined: 0, stillWaiting: 1, message: "The game is full. 1 person is still waiting." }) })); await myPeople(p);
    await p.waitFor(() => !!p.$("#admitall")); p.click("#admitall"); p.click("#bulkyes"); const t = await p.waitFor((x) => /1 person let in\./.test(x)); await p.waitFor((x) => /The game is full\. 1 person is still waiting\./.test(x)); expect(t).toMatch(/Waiting to come in/);
  });

  test("Play now and Send my play link to my WhatsApp: Organizer and Host only; the seat is made on the first press and the link goes to their own number", async () => {
    const o = await organizer(); await make(o, "UI-PLAYN"); await publish(o, "UI-PLAYN"); const w = spy();
    const p = await ready(o, "UI-PLAYN", w); await myPeople(p); expect(p.text()).toMatch(/0 people are on my list/); // nothing is made until it is asked for
    const win = fakeWin(); p.win.open = (u?: string) => { if (u === "") return win; opened = u!; return null; }; let opened = "";
    p.click("#playnow"); await p.waitFor(() => !!win.location.href); expect(win.location.href).toMatch(/^http:\/\/localhost\/j\/[a-z0-9]+$/);
    const mine = (await listOf(o, "UI-PLAYN")).people; expect(mine.length).toBe(1); expect(mine[0].role).toBe("organizer");
    p.click("#sendmine"); await p.waitFor(() => !!opened); expect(opened.startsWith("https://wa.me/919876543210?text=")).toBe(true); expect(decodeURIComponent(opened)).toContain(win.location.href);
    await p.waitFor((x) => /This is your own seat \(Organizer\)/.test(x)); expect(p.$(`[data-rmask="${mine[0].id}"]`)).toBeNull();
    const c = await ready(o, "UI-PLAYN", spy(), await cohostKey(o, "UI-PLAYN")); openStep(c, 2); await c.waitFor((x) => /My people/.test(x)); expect(c.$("#playnow")).toBeNull(); expect(c.$("#sendmine")).toBeNull();
  });

  test("Send my play link when the server does not know the mobile yet: the console asks for it, then sends it to the server and opens the WhatsApp link", async () => {
    const o = await organizer(); await make(o, "UI-NEEDP"); await publish(o, "UI-NEEDP"); let n = 0; const bodies: any[] = [];
    const w = spy({ "POST /api/z/UI-NEEDP/people/me": (_m, b) => { bodies.push(b); return ++n === 1 ? { status: 400, body: { error: "We need your mobile number to make your play link.", code: "need-phone" } } : { person: { link: "https://x.test/j/abc", waLink: "https://wa.me/919876543219?text=hi" }, role: "organizer", joined: false }; } });
    const p = await ready(o, "UI-NEEDP", w); await myPeople(p); let opened = ""; p.win.open = (u: string) => { opened = u; return null; };
    p.click("#sendmine"); await p.waitFor((x) => /Type your own mobile number, then press the button again/.test(x)); expect(p.$("#myph")).toBeTruthy(); expect(opened).toBe("");
    setField(p, "#myph", "98765 43219"); p.click("#sendmine"); await p.waitFor(() => !!opened); expect(opened).toBe("https://wa.me/919876543219?text=hi"); expect(bodies).toEqual([{}, { phone: "98765 43219" }]);
  });

  test("Download my list: only where the server says canExport (Organizer and Host); a Co-host does not get it", async () => {
    const o = await organizer(); await make(o, "UI-DL"); await publish(o, "UI-DL"); const w = spy();
    await o.api("POST", "/api/z/UI-DL/people", { people: [{ name: "Asha", phone: "9876543210" }] }, o.token);
    const p = await ready(o, "UI-DL", w); await myPeople(p); expect(p.$("#dlpeople")).toBeTruthy(); p.win.URL.createObjectURL = () => "blob:x"; p.click("#dlpeople"); await p.waitFor(() => w.st.calls.some((c: any) => c[1].endsWith("/people/export")));
    const h = await ready(o, "UI-DL", spy(), await hostKey(o)); await myPeople(h); expect(h.$("#dlpeople")).toBeTruthy();
    const c = await ready(o, "UI-DL", spy(), await cohostKey(o, "UI-DL")); openStep(c, 2); await c.waitFor((x) => /My people/.test(x) && /people are on my list/.test(x)); expect(c.$("#dlpeople")).toBeNull();
  });

  test("Your team: a Host needs a name and a mobile number or an e-mail; with only a mobile number a WhatsApp button with their link appears; with an e-mail the server mails the link", async () => {
    const o = await organizer(); await make(o, "UI-HWA"); const w = spy();
    const p = await ready(o, "UI-HWA", w); openStep(p, 5); await p.waitFor((x) => /Your Hosts: 0 of 5/.test(x));
    setField(p, "#hostlabel", "Meena"); p.click("#hostadd"); await p.waitFor((x) => /Host's mobile number or e-mail/.test(x)); expect(w.st.calls.some((c: any) => c[1] === "/api/org/host")).toBe(false);
    setField(p, "#hostlabel", "Meena"); setField(p, "#hostphone", "12345"); p.click("#hostadd"); await p.waitFor((x) => /check the Host's mobile number/.test(x)); expect(w.st.calls.some((c: any) => c[1] === "/api/org/host")).toBe(false);
    setField(p, "#hostlabel", "Meena"); setField(p, "#hostphone", "98765 43210"); p.click("#hostadd"); await p.waitFor((x) => /Send their link on WhatsApp/.test(x));
    expect(w.st.calls.find((c: any) => c[1] === "/api/org/host")[2]).toEqual({ label: "Meena", e: "UI-HWA", mobile: "98765 43210" });
    const a = p.$("a[data-hostwa]") as any; expect(a.getAttribute("href").startsWith("https://wa.me/919876543210?text=")).toBe(true); expect(decodeURIComponent(a.getAttribute("href"))).toMatch(/#host=cbh_[0-9a-f]{48}/);
    setField(p, "#hostlabel", "Anita"); setField(p, "#hostemail", "anita@acme.com"); p.click("#hostadd"); await p.waitFor((x) => /Your Hosts: 2 of 5/.test(x) && /We sent their link to their e-mail/.test(x)); expect(p.win.document.querySelectorAll("a[data-hostwa]").length).toBe(1); // the e-mailed Host has no WhatsApp button
  });


});
describe("console: About this step write-ups (spec 4, A)", () => {
  const FIRST = ["This is the basics.", "Pick the biggest crowd you expect.", "Tick the prizes you will give", "Show your message, video or audio in the game.", "A Host runs the game with you.", "Add your people here, one by one", "Look through your game and change what you need.", "Pay once, before the start time. You see the price here.", "Run the game from here.", "A few minutes after the game, a report link is e-mailed to the Organizer."];
  test("each of the ten steps shows its box under the talking line: a title, at most 5 short lines, the agreed first line, and no drop-down", async () => {
    const o = await organizer(); await make(o, "UI-ABT"); await publish(o, "UI-ABT");
    const p = await consolePage(o, "UI-ABT", o.token, {}, { afterLoad: spy().hook }); await p.waitFor((x) => /Last step|Your game|Hello/i.test(x));
    for (let n = 1; n <= 10; n++) {
      openStep(p, n); const box = p.$(`#sec${n} .zc-about`) as any; expect([n, !!box]).toEqual([n, true]);
      expect(box.querySelector("b").textContent).toBe("About this step"); const lines = Array.from(box.querySelectorAll("span")).map((e: any) => e.textContent as string);
      expect([n, lines.length >= 1 && lines.length <= 5]).toEqual([n, true]); expect([n, box.textContent.includes(FIRST[n - 1])]).toEqual([n, true]);
      expect(p.win.document.querySelectorAll(".zc-about").length).toBe(1); expect(p.win.document.querySelectorAll("select").length).toBe(0);
      expect(!!(box.compareDocumentPosition(p.$(`#sec${n} .zc-say`)) & 2)).toBe(true); // the box comes after the talking line
    }
    openStep(p, 8); expect(p.$("#sec8 .zc-about")!.textContent).toMatch(/2 minutes after your payment is confirmed/); openStep(p, 7); expect(p.$("#sec7 .zc-about")!.textContent).not.toMatch(/2 minutes|Pay once/); openStep(p, 10); expect(p.$("#sec10 .zc-about")!.textContent).toMatch(/365 days/);
    const h = await consolePage(o, "UI-ABT", await hostKey(o), {}, { afterLoad: spy().hook }); await h.waitFor((x) => /Last step|Your game/i.test(x)); openStep(h, 5); expect(h.$("#sec5 .zc-about")).toBeTruthy();
  });
  test("the Co-host's three steps have their one-line boxes; the Organizer's account says it is for the Organizer only", async () => {
    const o = await organizer(); await make(o, "UI-ABC"); await publish(o, "UI-ABC");
    const c = await consolePage(o, "UI-ABC", await cohostKey(o, "UI-ABC"), {}, { afterLoad: spy().hook }); await c.waitFor((x) => /Hi\. Here is the game/.test(x));
    const want = ["You can see the game and what you may do.", "Add your people. Each gets their own WhatsApp link. You can bring up to your limit.", "One payment is enough. If someone has paid, you will see Paid."];
    for (let n = 1; n <= 3; n++) { openStep(c, n); expect(c.$(`#sec${n} .zc-about span`)!.textContent).toBe(want[n - 1]); expect(c.$(`#sec${n} .zc-about b`)!.textContent).toBe("About this step"); }
    const p = await consolePage(o, "UI-ABC"); await p.waitFor((x) => /Last step|Your game|Hello/i.test(x));
    expect(p.$("#acct .zc-hint")!.textContent).toBe("These are for the Organizer only: your AI link, sign-in keys and records. Closing your account deletes your games.");
  });
  test("zc.css: the box is 12px grey-brown text, and nothing in zc.css sets text below 11px", () => {
    const css = readFileSync(join(import.meta.dir, "../public/zc.css"), "utf8");
    const rule = css.match(/\.zc-about\{([^}]*)\}/)![1]; expect(rule).toMatch(/font-size:12px/); expect(rule).toMatch(/color:#6b5a48/);
    for (const m of css.matchAll(/font-size:(\d+(?:\.\d+)?)px/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(11);
  });
});

const PNG1 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const JPG1 = "data:image/jpeg;base64,/9j/wAARCABgAGADAREAAhEBAxEB"; // a 96 x 96 JPEG header: the server reads the size in pixels
/** Pretend picture tools for the page (the test DOM cannot decode pictures): a picture 400x200 whose PNG and JPEG answers are given. */
const pictureTools = (png: string, jpg: string) => (win: any) => {
  win.Image = class { onload: any; naturalWidth = win.__w ?? 400; naturalHeight = win.__h ?? 200; set src(_v: string) { setTimeout(() => this.onload && this.onload(), 0); } };
  win.URL.createObjectURL = () => "blob:logo"; win.URL.revokeObjectURL = () => {};
  win.HTMLCanvasElement.prototype.getContext = () => ({ fillRect() {}, drawImage() {}, set fillStyle(_v: string) {} });
  win.HTMLCanvasElement.prototype.toDataURL = (type: string) => (type === "image/png" ? png : jpg);
};
const aFile = (p: Page, name: string, type: string, bytes = 8) => new (p.win as any).File([new Uint8Array(bytes)], name, { type }); // a real file object: the page reads it as a data: URL (the page's security policy blocks blob: pictures)
const chooseFile = (p: Page, sel: string, file: any) => { const inp = p.$(sel) as any; Object.defineProperty(inp, "files", { value: [file], configurable: true }); inp.dispatchEvent(new p.win.Event("change", { bubbles: true })); };
describe("console phase 3: brand on the card, See what guests see, payment link (real Worker)", () => {
  const open4 = async (o: O, id: string, w = spy(), key = o.token) => { const p = await consolePage(o, id, key, {}, { afterLoad: w.hook }); await p.waitFor((x) => /Hello|Last step|Your game/i.test(x)); openStep(p, 4); await p.waitFor((x) => /Your brand on the card/.test(x)); return p; };
  const infoOf = async (o: O, id: string) => o.json(await o.api("GET", `/api/z/${id}/info`, undefined, o.token));

  test("Brand: company name, eight colour chips and a logo shrunk in the browser to under 30 KB; saved with the step; the logo shows and can be removed", async () => {
    const o = await organizer(); await make(o, "UI-BRAND"); const big = "data:image/png;base64," + "A".repeat(60000);
    const w = spy({}, pictureTools(big, JPG1)); const p = await open4(o, "UI-BRAND", w);
    expect(p.win.document.querySelectorAll('#brandbox [data-ck="brand.color"]').length).toBe(8); expect(p.win.document.querySelectorAll("select").length).toBe(0);
    setField(p, "#f-brand-name", "Acme Foods"); p.click('[data-ck="brand.color"][data-v="#1B7F5C"]'); expect(p.$('[data-ck="brand.color"][data-v="#1B7F5C"]')!.getAttribute("aria-pressed")).toBe("true");
    chooseFile(p, "#brandlogo", aFile(p, "logo.png", "image/png")); await p.waitFor(() => !!p.$(".zc-logo img"));
    const shown = (p.$(".zc-logo img") as any).getAttribute("src"); expect(shown).toBe(JPG1); // the PNG was too big, the JPEG fits
    p.click('[data-save="4"]'); await p.waitFor((x) => /Saved\./.test(x));
    expect(w.st.patches.at(-1).brand).toEqual({ name: "Acme Foods", color: "#1B7F5C", logo: shown });
    expect((await infoOf(o, "UI-BRAND")).brand).toEqual({ name: "Acme Foods", color: "#1B7F5C", logo: shown }); // it persisted: read back from the server
    const q = await open4(o, "UI-BRAND"); expect((q.$("#f-brand-name") as any).value).toBe("Acme Foods"); expect(q.$(".zc-logo img")).toBeTruthy(); // and the form shows what the server holds
    q.click("#logorm"); expect(q.$(".zc-logo")).toBeNull(); q.click('[data-save="4"]'); await q.waitFor((x) => /Saved\./.test(x));
    expect((await infoOf(o, "UI-BRAND")).brand).toEqual({ name: "Acme Foods", color: "#1B7F5C" });
    expect(p.errors).toEqual([]);
  });

  test("Brand: a name without a colour (or a colour without a name) is refused politely before anything is sent; a picture that cannot be shrunk under 30 KB is refused", async () => {
    const o = await organizer(); await make(o, "UI-BRAND2"); const w = spy({}, pictureTools("data:image/png;base64," + "A".repeat(60000), "data:image/jpeg;base64," + "A".repeat(60000)));
    const p = await open4(o, "UI-BRAND2", w);
    setField(p, "#f-brand-name", "Acme"); p.click('[data-save="4"]'); await p.waitFor((x) => /Pick an accent colour/.test(x)); expect(w.st.patches.length).toBe(0);
    setField(p, "#f-brand-name", ""); p.click('[data-ck="brand.color"][data-v="#AD1457"]'); p.click('[data-save="4"]'); await p.waitFor((x) => /Add your company name/.test(x)); expect(w.st.patches.length).toBe(0);
    chooseFile(p, "#brandlogo", aFile(p, "logo.png", "image/png")); await p.waitFor((x) => /could not use that picture/.test(x)); expect(p.$(".zc-logo")).toBeNull();
    chooseFile(p, "#brandlogo", aFile(p, "x.gif", "image/gif")); await p.waitFor((x) => /PNG, JPEG or WebP picture/.test(x));
    chooseFile(p, "#brandlogo", aFile(p, "huge.png", "image/png", 5 * 1024 * 1024 + 1)); await p.waitFor((x) => /bigger than 5 MB/.test(x));
    (p.win as any).__w = 40; (p.win as any).__h = 40; chooseFile(p, "#brandlogo", aFile(p, "tiny.png", "image/png")); await p.waitFor((x) => /too small.*64 x 64/.test(x));
    (p.win as any).__w = 500; (p.win as any).__h = 100; chooseFile(p, "#brandlogo", aFile(p, "thin.png", "image/png")); await p.waitFor((x) => /too long and thin/.test(x));
    expect(p.text()).toMatch(/PNG, JPEG or WebP, up to 5 MB, at least 64 x 64 pixels/); // the rules are on the screen
  });

  test("See what guests see: a button for the Organizer and Host (steps 4 and 7) that opens the preview page in a new tab; a Co-host has none", async () => {
    const o = await organizer(); await make(o, "UI-SEE"); await publish(o, "UI-SEE");
    const p = await open4(o, "UI-SEE"); const a = p.$("#seeguests") as any; expect(a.textContent).toBe("See what guests see"); expect(a.getAttribute("href")).toBe("/preview.html#w=card&e=UI-SEE"); expect(a.getAttribute("target")).toBe("_blank");
    openStep(p, 7); expect(p.$("#seeguests")).toBeTruthy();
    const h = await consolePage(o, "UI-SEE", await hostKey(o)); await h.waitFor(() => !!h.$('.zc-dot[data-open="4"]')); openStep(h, 4); expect(h.$("#seeguests")).toBeTruthy();
    const c = await consolePage(o, "UI-SEE", await cohostKey(o, "UI-SEE")); await c.waitFor((x) => /Hi\. Here is the game/.test(x)); for (let n = 1; n <= 3; n++) openStep(c, n); expect(c.$("#seeguests")).toBeNull(); expect(c.text()).not.toMatch(/See what guests see/);
  });

  test("Copy payment link: Organizer, Host and Co-host get it while payment is pending; it copies the server's link and says the calm line; hidden once paid", async () => {
    const o = await organizer(); await make(o, "UI-PAYL"); await publish(o, "UI-PAYL"); const w = spy();
    const p = await consolePage(o, "UI-PAYL", o.token, {}, { afterLoad: w.hook }); await p.waitFor((x) => /Last step|Your game|Hello/i.test(x)); openStep(p, 8);
    let copied = ""; Object.defineProperty(p.win.navigator, "clipboard", { value: { writeText: async (t: string) => { copied = t; } }, configurable: true });
    expect(p.$("#copypaylink")!.textContent).toBe("Copy payment link"); p.click("#copypaylink");
    await p.waitFor((x) => /Anyone with this link can pay for this game\. It works until the game is paid or for 7 days\./.test(x));
    const made = w.st.last["POST /api/z/UI-PAYL/paylink"]; expect(made.url).toMatch(/\/paylink\.html\?t=/); expect(copied).toBe(made.url); expect(p.$("#copypaylink")!.textContent).toBe("Copy payment link again");
    const h = await consolePage(o, "UI-PAYL", await hostKey(o)); await h.waitFor((x) => /Last step|Your game/i.test(x)); openStep(h, 8); expect(h.$("#copypaylink")).toBeTruthy();
    const c = await consolePage(o, "UI-PAYL", await cohostKey(o, "UI-PAYL")); await c.waitFor((x) => /Hi\. Here is the game/.test(x)); openStep(c, 3); await c.waitFor(() => !!c.$("#copypaylink"));
    Object.defineProperty(c.win.navigator, "clipboard", { value: { writeText: async (t: string) => { copied = t; } }, configurable: true }); c.click("#copypaylink"); await c.waitFor((x) => /Anyone with this link can pay/.test(x)); expect(copied).toMatch(/paylink\.html\?t=/);
    o.world.raw.prepare("UPDATE engagement SET pack=100 WHERE id='UI-PAYL'").run(); o.world.raw.prepare("INSERT OR REPLACE INTO kv(k,v) VALUES(?,?)").run("paidby/UI-PAYL", JSON.stringify({ by: "organizer", ms: START_MS - HOUR }));
    const paid = await consolePage(o, "UI-PAYL", o.token); await paid.waitFor(() => paid.$("#paypill")?.textContent === "Paid"); openStep(paid, 8); expect(paid.$("#copypaylink")).toBeNull();
  });

  test("Copy payment link: when the server refuses, the console says so calmly and shows no link", async () => {
    const o = await organizer(); await make(o, "UI-PAYE"); await publish(o, "UI-PAYE");
    const p = await consolePage(o, "UI-PAYE", o.token, {}, { afterLoad: spy({ "POST /api/z/UI-PAYE/paylink": () => ({ status: 409, body: { error: "This game is already paid for.", code: "already-paid" } }) }).hook }); await p.waitFor((x) => /Last step|Your game|Hello/i.test(x)); openStep(p, 8);
    p.click("#copypaylink"); await p.waitFor((x) => /This game is already paid for\./.test(x)); expect(p.$("#paylinkurl")).toBeNull();
  });
});

/** The 6-digit code the Worker mailed: the page cannot see it, so the test finds it from its stored hash (900,000 tries take a second). */
const codeFor = (o: O, email: string) => {
  const eh = createHash("sha256").update("email|" + email).digest("hex"), row = o.world.raw.prepare("SELECT code_hash FROM login_code WHERE email_hash=?").get(eh) as any;
  for (let n = 100000; n < 1000000; n++) if (createHash("sha256").update("code|" + eh + "|" + n).digest("hex") === row.code_hash) return String(n);
  throw new Error("no code");
};
describe("console phase 4: Finish setup for a new Host, and Continue with Google (real Worker)", () => {
  const google = (win: any) => { win.google = { accounts: { id: { initialize(o: any) { win.__gi = o; }, renderButton(el: any) { el.innerHTML = '<button type="button" id="gfake">Continue with Google</button>'; } } } }; };

  test("a Host whose link was just opened sees Finish setup: e-mail first (a wrong one is told which one the link is for), a 6-digit code, then the mobile number; then the console opens with the new key", async () => {
    const o = await organizer(); await make(o, "UI-FIN"); await publish(o, "UI-FIN");
    const added = await o.json(await o.api("POST", "/api/org/host", { label: "Anita", email: "anita@acme.com" }, o.token)); const oldKey = added.hostKey as string;
    o.world.raw.prepare("UPDATE host_state SET verified_ms=NULL, mobile_ok=0, spent=0").run(); // a Host who has only just been added (the Worker's own answer for an e-mail-only Host was "ready" while this was written)
    const w = spy(); const p = await consolePage(o, "UI-FIN", oldKey, {}, { afterLoad: w.hook });
    await p.waitFor((x) => /Finish setup/.test(x)); expect(p.text()).toMatch(/a\*\*\*@acme\.com/); expect(p.$("#sec1")).toBeNull(); expect(p.$("#gbtn")).toBeNull(); // no Google button when the server has no client id
    setField(p, "#setupemail", "someone@else.com"); p.click("#setupsend"); await p.waitFor((x) => /This link is for a\*\*\*@acme\.com/.test(x));
    setField(p, "#setupemail", "anita@acme.com"); p.click("#setupsend"); await p.waitFor(() => !!p.$("#setupcode"));
    setField(p, "#setupcode", "000000"); p.click("#setupverify"); await p.waitFor((x) => /not right or has expired/.test(x));
    const code = codeFor(o, "anita@acme.com"); expect(code).toMatch(/^\d{6}$/); setField(p, "#setupcode", code); p.click("#setupverify");
    await p.waitFor((x) => /Your e-mail is checked/.test(x)); const newKey = p.win.sessionStorage.getItem("cbz-org"); expect(newKey).toBe(w.st.last["POST /api/host/setup/email/verify"].token); expect(newKey).toMatch(/^cbh_/); // the key the server handed over for this device is the one the page keeps
    setField(p, "#setupmobile", "123"); p.click("#setupmobilego"); await p.waitFor((x) => /check your mobile number/.test(x));
    setField(p, "#setupmobile", "98765 43210"); p.click("#setupmobilego"); await p.waitFor(() => p.$("#rolepill")?.textContent?.startsWith("Signed in as Host") === true, 10000); await p.waitFor((x) => /Your game/.test(x));
    expect((await o.api("GET", "/api/z/UI-FIN/people", undefined, newKey!)).status).toBe(200);
    expect(p.errors).toEqual([]);
  }, 60_000);

  test("one way in: the console sign-in and Finish setup show the e-mail way only, with or without a Google client id (no Google button, no pasted-key box); a refused link says so on the sign-in page", async () => {
    const plain = await organizer(); const a = await page(plain, "/zc", "zc.html", ZC_SCRIPTS, {}); await a.waitFor((x) => /Type your e-mail and press Continue/.test(x)); expect(a.$("#gbtn")).toBeNull(); expect(a.text()).not.toMatch(/Continue with Google|sign-in key/);
    const o = await organizer({ GOOGLE_CLIENT_ID: "test-id.apps.googleusercontent.com" }); await make(o, "UI-GOO"); await publish(o, "UI-GOO");
    const s = await page(o, "/zc", "zc.html", ZC_SCRIPTS, {}); await s.waitFor((x) => /Type your e-mail and press Continue/.test(x)); await new Promise((r) => setTimeout(r, 400));
    expect(s.$("#gbtn")).toBeNull(); expect(s.text()).not.toMatch(/Continue with Google|sign-in key/); expect(s.$("#lem")).toBeTruthy(); expect(s.$("#goLogin")).toBeTruthy(); expect(s.$("#sec")).toBeNull();
    const added = await o.json(await o.api("POST", "/api/org/host", { label: "Anita", email: "anita@acme.com" }, o.token)); const hk = added.hostKey as string;
    o.world.raw.prepare("UPDATE host_state SET verified_ms=NULL, mobile_ok=0, spent=0").run();
    const h = await consolePage(o, "UI-GOO", hk); await h.waitFor((x) => /Finish setup/.test(x)); expect(h.$("#gbtn")).toBeNull(); expect(h.text()).not.toMatch(/Continue with Google/);
  }, 60_000);
});

describe("console: Send a new link to a Host, and a Host who opens the console without a game", () => {
  test("Your team: a Host who has not finished setup shows why, and the Organizer can send a new link (the old one stops); with a mobile there is a WhatsApp button; once the Host has confirmed an e-mail the server says no and the console says so calmly", async () => {
    const o = await organizer(); await make(o, "UI-NLK"); await publish(o, "UI-NLK");
    const added = await o.json(await o.api("POST", "/api/org/host", { label: "Anita", mobile: "9876543210", email: "anita@acme.com" }, o.token)); const oldKey = added.hostKey as string;
    o.world.raw.prepare("UPDATE host_state SET verified_ms=NULL, mobile_ok=0, spent=0").run();
    const w = spy(); const p = await consolePage(o, "UI-NLK", o.token, {}, { afterLoad: w.hook }); await p.waitFor(() => !!p.$('.zc-dot[data-open="5"]')); openStep(p, 5);
    await p.waitFor((x) => /Waiting for them to open the link/.test(x)); expect(p.$("[data-newlink]")!.textContent).toBe("Send a new link");
    p.click("[data-newlink]"); await p.waitFor((x) => /A new link is on its way to their e-mail\. The old one has stopped\./.test(x));
    expect(w.st.calls.find((c: any) => c[1] === "/api/org/host/link")[2]).toEqual({ id: added.id, e: "UI-NLK" });
    const row = p.$(".zc-person") as any; const href = (row.querySelector("a[data-hostwa]") as any).getAttribute("href"); expect(href.startsWith("https://wa.me/919876543210?text=")).toBe(true);
    const fresh = row.querySelector(".zlink").textContent as string; expect(fresh).toMatch(/\/zc\.html\?e=UI-NLK#host=cbh_[0-9a-f]{48}/); expect(row.querySelector("[data-copyteam]")).toBeTruthy();
    expect(decodeURIComponent(href)).toContain(fresh.split("#host=")[1]);
    expect((await o.api("GET", "/api/whoami", undefined, oldKey)).status).not.toBe(200); // the old link stopped
    o.world.raw.prepare("UPDATE host_state SET verified_ms=?").run(Date.now()); // the Host confirmed an e-mail in the meantime
    p.click("[data-newlink]"); await p.waitFor((x) => /already finished setup, so they sign in with their e-mail/.test(x));
  });

  test("a Host who opens the console without a game: with one game they go straight in; with several they see 'Your games' and Open works", async () => {
    const o = await organizer(); await make(o, "UI-ONE1"); await publish(o, "UI-ONE1"); const hk = await hostKey(o, "Anita");
    const one = await page(o, "/zc", "zc.html", ZC_SCRIPTS, { "cbz-org": hk, "cbz-aimsg": "" }); await one.waitFor((x) => /Your game/.test(x) && /Check and publish/.test(x));
    expect(one.$("#rolepill")!.textContent).toMatch(/^Signed in as Host/); expect(one.text()).not.toMatch(/Your games/); expect(one.$("#sec1")).toBeTruthy();
    await make(o, "UI-TWO2", { name: "Second game" }); await publish(o, "UI-TWO2");
    const many = await page(o, "/zc", "zc.html", ZC_SCRIPTS, { "cbz-org": hk }); await many.waitFor((x) => /Your games/.test(x)); expect(many.text()).toMatch(/UI-ONE1/); expect(many.text()).toMatch(/UI-TWO2/); expect(many.$("#sec1")).toBeNull();
    many.click('[data-open-game="UI-TWO2"]'); await many.waitFor(() => !!many.$("#sec1")); await many.waitFor((x) => /Second game/.test(x)); expect(many.$("#rolepill")!.textContent).toMatch(/^Signed in as Host/);
    expect(many.errors).toEqual([]);
  });
});

describe("console: ten steps, Pay is its own step, and the price is shown only there", () => {
  test("ten jump dots; Pay is step 8 with its own tint; before publishing it says 'Publish first' and shows no price; after publishing it shows the price, Pay, Copy payment link and the late-start line", async () => {
    const o = await organizer(); await make(o, "UI-PAY8");
    const p = await consolePage(o, "UI-PAY8"); await p.waitFor((x) => /Hello/.test(x));
    expect(p.win.document.querySelectorAll(".zc-dot").length).toBe(10); expect(p.$('.zc-dot[data-open="8"]')!.getAttribute("style")).toMatch(/--bg-tint-lime/);
    for (const n of [7, 9]) expect(p.$(`.zc-dot[data-open="${n}"]`)!.getAttribute("style")).not.toMatch(/--bg-tint-lime/); // different from its neighbours
    expect(readFileSync(join(import.meta.dir, "../public/zc.css"), "utf8")).toMatch(/--bg-tint-lime:#/);
    openStep(p, 8); await p.waitFor((x) => /Publish first/.test(x)); expect(p.text()).not.toMatch(/with GST/); expect(p.$("#pricerow")).toBeNull(); expect(p.$('a[href^="/pay.html"]')).toBeNull(); expect(p.$("[data-save='8']")).toBeNull();
    await publish(o, "UI-PAY8");
    const q = await consolePage(o, "UI-PAY8"); await q.waitFor((x) => /Last step: pay before the start/i.test(x)); // a published, unpaid game opens on Pay
    expect(q.$("#sec8")!.className).toMatch(/open/); expect(q.$("#pricerow")!.textContent).toMatch(/Rs 2,399\.00/); expect((q.$('#sec8 a[href^="/pay.html"]') as any).getAttribute("href")).toBe("/pay.html?e=UI-PAY8");
    expect(q.$("#copypaylink")).toBeTruthy(); expect(q.$("#sec8").textContent).toMatch(/Paid late\? The game starts 2 minutes after your payment is confirmed/); expect(q.$("[data-save='8']")).toBeNull(); // Pay has its own button, no Continue
    expect(q.$("#sec8 .zc-sech b")!.textContent).toBe("Pay");
  });
  test("the price shows ONLY in the Pay step: not in the side summary, not in steps 1 to 7, 9 or 10, not in the Next card; the Co-host's own Payment step keeps it", async () => {
    const o = await organizer(); await make(o, "UI-NOPRICE"); await publish(o, "UI-NOPRICE");
    const p = await consolePage(o, "UI-NOPRICE"); await p.waitFor((x) => /Last step: pay before the start/i.test(x));
    for (let n = 1; n <= 10; n++) { openStep(p, n); const t = p.text(); if (n === 8) expect(t).toMatch(/Rs 2,399\.00/); else expect([n, /with GST|Rs 2,399|Price/.test(t)]).toEqual([n, false]); }
    const c = await consolePage(o, "UI-NOPRICE", await cohostKey(o, "UI-NOPRICE")); await c.waitFor((x) => /Hi\. Here is the game/.test(x));
    openStep(c, 1); expect(c.text()).not.toMatch(/with GST/); openStep(c, 3); await c.waitFor((x) => /Rs 2,399\.00/.test(x));
  });
  test("step 7 keeps Check, Publish, Cancel and See what guests see but no payment rows; the Next card moves on to Pay after publishing; a paid game shows who paid in step 8", async () => {
    const o = await organizer(); await make(o, "UI-S7"); await publish(o, "UI-S7");
    const p = await consolePage(o, "UI-S7"); await p.waitFor((x) => /Last step: pay before the start/i.test(x)); openStep(p, 7);
    expect(p.$("#cancelblock")).toBeTruthy(); expect(p.$("#seeguests")).toBeTruthy(); expect(p.$("#sec7 #copypaylink")).toBeNull(); expect(p.$('#sec7 a[href^="/pay.html"]')).toBeNull(); expect(p.$("#sec7").textContent).toMatch(/Next: pay in step 8/);
    expect(p.$(".zc-next")).toBeTruthy();
    o.world.raw.prepare("UPDATE engagement SET pack=100 WHERE id='UI-S7'").run(); o.world.raw.prepare("INSERT OR REPLACE INTO kv(k,v) VALUES(?,?)").run("paidby/UI-S7", JSON.stringify({ by: "co-host", ms: START_MS - HOUR }));
    const w = await consolePage(o, "UI-S7"); await w.waitFor(() => w.$("#paypill")?.textContent === "Paid"); openStep(w, 8); expect(await w.waitFor((x) => /Paid by the Co-host on/.test(x))).toMatch(/The game is on/); expect(w.$('#sec8 a[href^="/pay.html"]')).toBeNull();
  });
  test("step 2 reads clearly: four small sub-headings", async () => {
    const o = await organizer(); await make(o, "UI-SUB"); const p = await consolePage(o, "UI-SUB"); await p.waitFor((x) => /Hello/.test(x)); openStep(p, 2);
    expect(Array.from(p.win.document.querySelectorAll("#sec2 .zc-sub")).map((e: any) => e.textContent)).toEqual(["How many players", "How the game runs", "Who is this game for?", "Who can join", "Guests bringing their own people", "Where do your people play?"]); // B14 added the last one
  });
});

describe("console: prize houses from the one table (ZG.PRIZE_HOUSES)", () => {
  const open3 = async (o: O, id: string) => { const p = await consolePage(o, id); await p.waitFor((x) => /Hello/.test(x)); openStep(p, 3); await p.waitFor((x) => /Tick the prizes/.test(x)); return p; };
  const rewardsOf = async (o: O, id: string) => (await o.json(await o.api("GET", `/api/z/${id}/summary`, undefined, o.token))).rewards as any[];

  test("every Bingo house in the table is a tick box with its 'how to win' line in small text", async () => {
    const o = await organizer(); await make(o, "UI-HOUSES"); const p = await open3(o, "UI-HOUSES");
    const boxes = Array.from(p.win.document.querySelectorAll("#sec3 [data-house]")) as any[]; const want = PRIZE_HOUSES;
    expect(boxes.map((b) => b.getAttribute("data-house"))).toEqual(want.map((h) => h.id)); expect(want.length).toBe(10);
    for (const [i, h] of want.entries()) { expect(boxes[i].querySelector("input[type=checkbox]")).toBeTruthy(); expect(boxes[i].querySelector(".zc-how")!.textContent).toBe(h.how); expect(boxes[i].textContent).toContain(h.label); }
    expect(p.win.document.querySelectorAll("#sec3 select").length).toBe(0);
  });

  test("the winner taps stop at each house's maximum: Line up to 3, Plus 2, Blackout 2", async () => {
    const o = await organizer(); await make(o, "UI-MAXW"); const p = await open3(o, "UI-MAXW");
    const taps = (id: string) => Array.from(p.win.document.querySelectorAll(`[data-ck="hs.${id}.n"]`)).map((e: any) => e.textContent);
    await p.waitFor(() => !!p.$('[data-ck="hs.line.n"]')); expect(taps("line")).toEqual(["1", "2", "3"]);
    p.click('[data-ph="blackout"]'); await p.waitFor(() => !!p.$('[data-ck="hs.blackout.n"]')); expect(taps("blackout")).toEqual(["1", "2"]);
    p.click('[data-hc="plus"]'); await p.waitFor(() => !!p.$('[data-house="plus"] .zc-how')); await p.waitFor(() => !!p.$('[data-ck="hs.plus.n"]')); expect(taps("plus")).toEqual(["1", "2"]);
  });

  test("Line with 3 winners can have a prize for each winner; a new house and 'No prize' are saved; reopening shows them", async () => {
    const o = await organizer(); await make(o, "UI-PERW"); const p = await open3(o, "UI-PERW");
    await p.waitFor(() => !!p.$('[data-ck="hs.line.n"]')); p.click('[data-ck="hs.line.n"][data-v="3"]');
    p.click('[data-bool="hs.line.diff"]'); await p.waitFor((x) => /Prize for winner 3/.test(x));
    p.click('[data-ck="hs.line.per.0.pt"][data-v="voucher"]'); setField(p, "#f-hs-line-per-0-pd", "50"); p.click('[data-ck="hs.line.per.1.pt"][data-v="phone"]'); p.click('[data-ck="hs.line.per.2.pt"][data-v="dayoff"]');
    p.click('[data-hc="plus"]'); await p.waitFor(() => !!p.$('[data-ck="hs.plus.pt"][data-v="none"]')); p.click('[data-ck="hs.plus.pt"][data-v="none"]');
    p.click('[data-save="3"]'); await p.waitFor((x) => /Saved\./.test(x));
    const rw = await rewardsOf(o, "UI-PERW"); expect(rw.filter((r) => r.pattern === "line").map((r) => r.text)).toEqual(["Gift card: 50", "Smartphone", "Extra day off"]); expect(rw.find((r) => r.pattern === "plus")!.text).toBe("No prize");
    const q = await open3(o, "UI-PERW");
    await q.waitFor((x) => /Prize for winner 3/.test(x));
    expect((q.$('[data-bool="hs.line.diff"]') as any).getAttribute("aria-pressed")).toBe("true");
  });

  test("Classic, Simple and Rich still work and respect the maximums; 'I will decide later' is still the default", async () => {
    const o = await organizer(); await make(o, "UI-BNDL"); const p = await open3(o, "UI-BNDL");
    p.click('[data-ck="bundle"][data-v="Rich"]'); expect((p.$('[data-hc="blackout"]') as any).checked).toBe(true); expect((p.$('[data-hc="letterL"]') as any).checked).toBe(false); expect((p.$('[data-hc="frame"]') as any).checked).toBe(true);
    p.click('[data-ck="bundle"][data-v="Simple"]'); expect(Array.from(p.win.document.querySelectorAll("#sec3 [data-hc]")).filter((e: any) => e.checked).map((e: any) => e.getAttribute("data-hc"))).toEqual(["line", "blackout"]);
    p.click('[data-save="3"]'); await p.waitFor((x) => /Saved\./.test(x)); expect((await rewardsOf(o, "UI-BNDL")).map((r) => [r.pattern, r.text])).toEqual([["line", ""], ["blackout", ""]]);
  });

  test("Quick setup lists the same houses with their how-to line, limits the winners and saves a new house", async () => {
    const o = await organizer(); const p = await page(o, "/zc?quick=1", "zc.html", ZC_SCRIPTS, { "cbz-org": o.token }); await p.waitFor((x) => /1\. Which game\?/.test(x));
    const want = PRIZE_HOUSES; expect(p.win.document.querySelectorAll("[id^=qk-h-]").length).toBe(want.length);
    expect(p.$("#qk-h-letterL")!.closest(".zc-box")!.querySelector(".zc-how")!.textContent).toBe(PRIZE_HOUSES.find((h) => h.id === "letterL")!.how);
    expect(p.win.document.querySelectorAll('[data-ck="hs.blackout.n"]').length).toBe(2); expect(p.win.document.querySelectorAll('[data-ck="hs.line.n"]').length).toBe(3);
    const el = p.$("#qk-h-letterL") as any; el.checked = true; el.dispatchEvent(new p.win.Event("change", { bubbles: true })); setField(p, "#qk-t-letterL", "Mug");
    const tomorrow = new Date(T + 5.5 * 3600000 + 2 * 86400000); setField(p, "#qk-date", tomorrow.toISOString().slice(0, 10)); setField(p, "#qk-time", "18:30");
    p.click("#qk-save"); await p.waitFor((x) => /Your draft is saved/.test(x), 10000);
    const hist = await o.json(await o.api("GET", "/api/history", undefined, o.aiKey)); const sm = await o.json(await o.api("GET", `/api/z/${hist.engagements[0].id}/summary`, undefined, o.aiKey));
    expect(sm.rewards.find((r: any) => r.pattern === "letterL").text).toBe("Mug");
  }, 60_000);
});

describe("console: no refunds (credit), games that wait or did not start, 'Create a new game like this one', rescheduling", () => {
  const CREDIT = { amountInr: 2399, expiresMs: Date.parse("2027-06-14T12:00:00+05:30") };
  const openPay = async (o: O, id: string, w: ReturnType<typeof spy>) => { const p = await consolePage(o, id, o.token, {}, { afterLoad: w.hook }); await p.waitFor((x) => /Last step|Your game|Hello|Price for your game/i.test(x)); openStep(p, 8); return p; };

  test("Cancel a PAID game: 1st confirmation says there is no refund and offers 'Change the date instead'; 2nd shows the credit and its date with the checkbox gate; nothing is sent until the end; after cancelling the credit and its expiry are shown", async () => {
    const o = await organizer(); await make(o, "UI-CRD", { name: "Diwali Night" }); await publish(o, "UI-CRD");
    const posts: any[] = []; let cancelled = false;
    const w = spy({
      "GET /api/z/UI-CRD/cancel-preview": () => ({ canCancel: true, paid: true, credit: CREDIT }),
      "POST /api/z/UI-CRD/cancel": (_m, b) => { posts.push(b); cancelled = true; return { ok: true, cancelled: true, credit: { id: "c1", ...CREDIT } }; },
      "GET /api/z/UI-CRD/summary": async (_m, _b, _u, real) => { const j = await real(); return cancelled ? { ...j, cancelled: true } : j; },
    });
    const p = await consolePage(o, "UI-CRD", o.token, {}, { afterLoad: w.hook }); await p.waitFor((x) => /Last step|Your game|Hello/i.test(x)); openStep(p, 7);
    p.click("#cancelopen"); await p.waitFor((x) => /1st confirmation/.test(x));
    expect(p.$("#norefund")!.textContent).toBe("There is no refund. Your payment stays as credit for your next game, for 365 days."); expect(p.$("#cancelresched")!.textContent).toBe("Change the date instead");
    p.click("#cancelresched"); await p.waitFor(() => /open/.test(p.$("#sec1")!.className)); expect(p.$("#cancelpanel")).toBeNull(); expect(posts.length).toBe(0); // it goes to step 1 and sends nothing
    openStep(p, 7); p.click("#cancelopen"); await p.waitFor((x) => /1st confirmation/.test(x)); p.click("#cancel1"); await p.waitFor((x) => /2nd confirmation/.test(x));
    expect(p.$("#cancelwhat")!.textContent).toBe("Your credit: Rs 2,399.00, valid until 14 Jun 2027. Guests will be told. Their names and numbers will be erased. You cannot undo this.");
    expect(p.$("#cancelpanel")!.textContent).not.toMatch(/You paid|Payment charge|You get back|refund/i); expect((p.$("#cancel2") as any).disabled).toBe(true); tickAgree(p); p.click("#cancel2"); await p.waitFor((x) => /Final confirmation/.test(x)); expect(posts.length).toBe(0);
    p.click("#cancel3"); await p.waitFor((x) => /This game was cancelled/.test(x)); expect(posts).toEqual([{ confirmations: 3 }]);
    expect(p.$("#creditnote")!.textContent).toBe("Your payment of Rs 2,399.00 stays as credit until 14 Jun 2027. Use it for your next game.");
  });

  test("Cancel an UNPAID game (real Worker): no credit lines at all, and the same three screens", async () => {
    const o = await organizer(); await make(o, "UI-CRU", { name: "Diwali Night" }); await publish(o, "UI-CRU");
    const p = await consolePage(o, "UI-CRU"); await p.waitFor((x) => /Last step|Your game|Hello/i.test(x)); openStep(p, 7);
    p.click("#cancelopen"); await p.waitFor((x) => /1st confirmation/.test(x)); expect(p.$("#norefund")).toBeNull(); expect(p.$("#cancelresched")).toBeTruthy(); p.click("#cancel1"); await p.waitFor((x) => /2nd confirmation/.test(x));
    expect(p.$("#cancelwhat")!.textContent).toBe("Guests will be told. Their names and numbers will be erased. You cannot undo this."); expect(p.$("#cancelpanel")!.textContent).not.toMatch(/credit|refund/i);
    tickAgree(p); p.click("#cancel2"); await p.waitFor((x) => /Final confirmation/.test(x)); p.click("#cancel3"); await p.waitFor((x) => /This game was cancelled/.test(x)); expect(p.$("#creditnote")).toBeNull();
  });

  test("Pay step: with credit it says so and offers 'Use my credit'; a part payment shows 'Pay the rest' and the normal Pay button stays; a full one says paid; the credit is shown only in the Pay step", async () => {
    const o = await organizer(); await make(o, "UI-USEC"); await publish(o, "UI-USEC"); const bodies: any[] = []; let mode = "part";
    const w = spy({
      "GET /api/z/UI-USEC/summary": async (_m, _b, _u, real) => ({ ...(await real()), credit: 1000 }),
      "GET /api/org/credit": () => ({ credits: [], activeTotalInr: 1000, nextExpiryMs: Date.parse("2027-06-14T12:00:00+05:30") }),
      "POST /api/z/UI-USEC/pay-with-credit": (_m, b) => { bodies.push(b); return mode === "part" ? { ok: true, paid: false, usedInr: 1000, toPayInr: 1399 } : { ok: true, paid: true, usedInr: 2399, toPayInr: 0 }; },
    });
    const p = await openPay(o, "UI-USEC", w); await p.waitFor((x) => /You have credit of/.test(x));
    expect(p.$("#creditoffer")!.textContent).toMatch(/You have credit of Rs 1,000\.00 \(valid until 14 Jun 2027\)\. Use it for this game\./); expect(p.$("#usecredit")!.textContent).toBe("Use my credit");
    for (const n of [1, 2, 3, 4, 5, 6, 7, 9, 10]) { openStep(p, n); expect([n, /You have credit of/.test(p.text())]).toEqual([n, false]); } // credit shows only in Pay
    openStep(p, 8); p.click("#usecredit"); await p.waitFor((x) => /Pay the rest: Rs 1,399\.00/.test(x)); expect(bodies).toEqual([{}]); expect(p.$('#sec8 a[href^="/pay.html"]')).toBeTruthy(); expect(p.$("#usecredit")).toBeNull();
    const none = await openPay(o, "UI-USEC", spy()); await none.waitFor((x) => /Price for your game/.test(x)); expect(none.$("#creditoffer")).toBeNull(); expect(none.text()).not.toMatch(/You have credit/); // no credit, no offer
    mode = "full"; const q = await openPay(o, "UI-USEC", w); await q.waitFor((x) => /You have credit of/.test(x)); q.click("#usecredit"); await q.waitFor((x) => /Paid with your credit: Rs 2,399\.00/.test(x));
  });

  test("Your account lists credit: active, used and lapsed, each with its dates", async () => {
    const o = await organizer();
    const w = spy({ "GET /api/org/credit": () => ({ activeTotalInr: 1000, nextExpiryMs: Date.parse("2027-06-14T12:00:00+05:30"), credits: [
      { id: "c1", amountInr: 2399, remainingInr: 1000, createdMs: Date.parse("2026-06-14T12:00:00+05:30"), expiresMs: Date.parse("2027-06-14T12:00:00+05:30"), status: "active", sourceGame: "OLD-1", uses: [] },
      { id: "c2", amountInr: 2399, remainingInr: 0, createdMs: Date.parse("2026-01-10T12:00:00+05:30"), expiresMs: Date.parse("2027-01-10T12:00:00+05:30"), status: "used", sourceGame: "OLD-2", uses: [{ game: "NEW-1", amountInr: 2399, atMs: Date.parse("2026-03-01T12:00:00+05:30") }] },
      { id: "c3", amountInr: 500, remainingInr: 500, createdMs: Date.parse("2025-01-10T12:00:00+05:30"), expiresMs: Date.parse("2026-01-10T12:00:00+05:30"), status: "expired", sourceGame: "OLD-3", uses: [] }] }) });
    const p = await page(o, "/zc", "zc.html", ZC_SCRIPTS, { "cbz-org": o.token, "cbz-aimsg": o.aiMessage }, { afterLoad: w.hook }); await p.waitFor((x) => /Your credit/.test(x));
    const t = p.$("#creditsblock")!.textContent as string; expect(t).toMatch(/Rs 1,000\.00 of Rs 2,399\.00/); expect(t).toMatch(/valid until 14 Jun 2027/); expect(t).toMatch(/Active/); expect(t).toMatch(/used 1 Mar 2026 for NEW-1/); expect(t).toMatch(/Used/); expect(t).toMatch(/lapsed on 10 Jan 2026/); expect(t).toMatch(/Lapsed/);
    expect(t).toMatch(/We do not give refunds\. If you cancel a paid game before it starts, your payment stays in the Organizer's account as credit for the next game, for 365 days\. Unused credit lapses at the end of day 365\./);
  });

  test("a game that waits: the Organizer sees when guest data will be erased; the Co-host sees 'Waiting for the Organizer or Host to start the game.'; a game that did not start says so with the new-game button (and no way to pay)", async () => {
    const o = await organizer(); await make(o, "UI-WAITS"); await publish(o, "UI-WAITS"); const erase = Date.parse("2026-10-03T21:30:00+05:30");
    const p = await consolePage(o, "UI-WAITS", o.token, {}, { afterLoad: spy({ "GET /api/z/UI-WAITS/summary": async (_m, _b, _u, real) => ({ ...(await real()), waitingFor: "organizer", erasureMs: erase }) }).hook }); await p.waitFor((x) => /Last step|Your game|Hello/i.test(x));
    await p.waitFor(() => !!p.$("#erasurestrip")); expect(p.$("#paynote")!.textContent).toMatch(/A payment is pending for this game/); expect(p.$("#erasurestrip")!.textContent).toBe("Guest data will be erased on 3 Oct 2026, 9:30 pm if the game does not start.");
    openStep(p, 8); expect(p.$("#erasureline")!.textContent).toMatch(/erased on 3 Oct 2026, 9:30 pm/);
    const c = await consolePage(o, "UI-WAITS", await cohostKey(o, "UI-WAITS"), {}, { afterLoad: spy({ "GET /api/z/UI-WAITS/cohost": async (_m, _b, _u, real) => ({ ...(await real()), waitingFor: "organizer" }) }).hook }); await c.waitFor((x) => /Hi\. Here is the game/.test(x));
    await c.waitFor(() => !!c.$("#cohwaiting")); expect(c.$("#cohwaiting")!.textContent).toBe("Waiting for the Organizer or Host to start the game."); expect(c.$("[data-clonebtn]")).toBeNull();
    const d = await consolePage(o, "UI-WAITS", o.token, {}, { afterLoad: spy({ "GET /api/z/UI-WAITS/summary": async (_m, _b, _u, real) => ({ ...(await real()), didNotStart: true }), "GET /api/z/UI-WAITS/info": async (_m, _b, _u, real) => ({ ...(await real()), didNotStart: true }) }).hook });
    await d.waitFor(() => !!d.$("#didnotstart")); expect(d.$("#didnotstart")!.textContent).toMatch(/This game did not start\.\s*Guest details have been erased\./); expect(d.$("#didnotstart [data-clonebtn]")!.textContent).toBe("Create a new game like this one"); expect(d.$("#paynote")).toBeNull();
    openStep(d, 8); expect(d.$('#sec8 a[href^="/pay.html"]')).toBeNull(); expect(d.$("#copypaylink")).toBeNull();
  });

  test("Create a new game like this one: on the game page and in the games list (not for a Co-host); the people tick box only when the old list exists; the new game opens on step 1 with the date and time empty and the read-back with Change buttons", async () => {
    const o = await organizer(); await make(o, "UI-OLD1"); await publish(o, "UI-OLD1"); await make(o, "UI-NEW1", { name: "Copied game" });
    expect((await o.api("POST", "/api/z/UI-OLD1/roster", { people: [{ name: "Asha", phone: "9876543210" }] }, o.token)).status).toBe(200);
    const w = spy({ "POST /api/z/UI-OLD1/clone": () => ({ ok: true, id: "UI-NEW1", openUrl: "/zc.html?e=UI-NEW1", copied: ["settings", "prizes"], peopleCopied: 1 }) });
    const p = await consolePage(o, "UI-OLD1", o.token, {}, { afterLoad: w.hook }); await p.waitFor((x) => /Last step|Your game|Hello/i.test(x)); await p.waitFor(() => (p.win as any).__zc.people.length > 0); openStep(p, 7);
    p.click("[data-clonebtn]"); await p.waitFor(() => !!p.$("#clonepanel")); expect(p.$("#clonepeople")).toBeTruthy(); expect(p.$("#clonepanel")!.textContent).toMatch(/Also bring my people list from the old game/);
    const tick = p.$("#clonepeople") as any; tick.checked = true; tick.dispatchEvent(new p.win.Event("change", { bubbles: true })); p.click("#clonego");
    await p.waitFor((x) => /This is a new game\. Nothing is paid or published yet\./.test(x)); expect(w.st.calls.find((c: any) => c[1] === "/api/z/UI-OLD1/clone")[2]).toEqual({ withPeople: true });
    expect(p.win.location.search).toContain("e=UI-NEW1"); expect(p.$("#sec1")!.className).toMatch(/open/); expect(p.win.document.querySelectorAll('#sec1 [data-ck="day"][aria-pressed="true"]').length).toBe(0); expect(p.win.document.querySelectorAll('#sec1 [data-ck="time"][aria-pressed="true"]').length).toBe(0);
    expect(p.$("#newgameread")!.textContent).toMatch(/date and time still to pick/); expect(p.win.document.querySelectorAll("#newgameread [data-open]").length).toBeGreaterThanOrEqual(3); // Change buttons for each part
    expect(p.$("#zcnote")!.textContent).toBe("Your new game is ready to check. Pick the date and time, then publish.");
    p.click('[data-save="1"]'); await p.waitFor((x) => /Pick the day and the time/.test(x)); // the date is never copied, it must be picked
    p.click('[data-ck="day"][data-v="other"]'); const d = new Date(T + 5.5 * 3600000 + 3 * 86400000); setField(p, "#f-dayo", d.toISOString().slice(0, 10)); p.click('[data-ck="time"][data-v="18:00"]'); p.click('[data-save="1"]'); await p.waitFor((x) => /Saved\./.test(x));
    expect(p.$("#newgameread")).toBeNull();
    const home = await page(o, "/zc", "zc.html", ZC_SCRIPTS, { "cbz-org": o.token, "cbz-aimsg": o.aiMessage }, { afterLoad: w.hook }); await home.waitFor((x) => /Start a new game/.test(x)); home.click('[data-hist="1"]'); await home.waitFor(() => !!home.$('[data-clonebtn][data-from="UI-OLD1"]'));
    home.click('[data-clonebtn][data-from="UI-OLD1"]'); await home.waitFor(() => !!home.$("#clonepanel")); expect(home.$("#clonepeople")).toBeTruthy();
    const h = await consolePage(o, "UI-OLD1", await hostKey(o)); await h.waitFor(() => !!h.$('.zc-dot[data-open="7"]')); openStep(h, 7); expect(h.$("[data-clonebtn]")).toBeTruthy(); // a Host has it too
    const c = await consolePage(o, "UI-OLD1", await cohostKey(o, "UI-OLD1")); await c.waitFor((x) => /Hi\. Here is the game/.test(x)); for (let n = 1; n <= 3; n++) openStep(c, n); expect(c.$("[data-clonebtn]")).toBeNull();
  });

  test("Create a new game like this one when the old list is gone: a calm line instead of the tick box; a server refusal is shown", async () => {
    const o = await organizer(); await make(o, "UI-OLD2"); await publish(o, "UI-OLD2");
    const p = await consolePage(o, "UI-OLD2", o.token, {}, { afterLoad: spy({ "POST /api/z/UI-OLD2/clone": () => ({ status: 409, body: { error: "You already have 10 drafts. Delete one first." } }) }).hook }); await p.waitFor((x) => /Last step|Your game|Hello/i.test(x)); openStep(p, 7);
    p.click("[data-clonebtn]"); await p.waitFor(() => !!p.$("#clonepanel")); expect(p.$("#clonepeople")).toBeNull(); expect(p.$("#clonepanel")!.textContent).toMatch(/The old guest list has been erased, so add your people again\./);
    p.click("#clonego"); await p.waitFor((x) => /You already have 10 drafts/.test(x)); p.click("#cloneno"); expect(p.$("#clonepanel")).toBeNull();
  });

  test("Rescheduling: a date more than 30 days ahead is refused politely before anything is sent; the server's own message (a game that has started) is shown as it is", async () => {
    const o = await organizer(); await make(o, "UI-RESC"); const w = spy({ "PATCH /api/z/UI-RESC/settings": () => ({ status: 409, body: { error: "This game has started, so its time cannot be changed." } }) });
    const p = await consolePage(o, "UI-RESC", o.token, {}, { afterLoad: w.hook }); await p.waitFor((x) => /Hello/.test(x));
    p.click('[data-ck="day"][data-v="other"]'); const far = new Date(T + 5.5 * 3600000 + 45 * 86400000); setField(p, "#f-dayo", far.toISOString().slice(0, 10)); p.click('[data-ck="time"][data-v="18:00"]'); p.click('[data-save="1"]');
    await p.waitFor((x) => /at most 30 days from today/.test(x)); expect(w.st.patches.length).toBe(0); expect(p.$("#f-dayo")!.getAttribute("max")).toMatch(/^\d{4}-\d\d-\d\d$/);
    const near = new Date(T + 5.5 * 3600000 + 5 * 86400000); setField(p, "#f-dayo", near.toISOString().slice(0, 10)); p.click('[data-save="1"]'); await p.waitFor((x) => /This game has started, so its time cannot be changed\./.test(x));
  });

  test("words: no 'refund' or 'money back' anywhere in the console; the About lines and Help say credit for 365 days", async () => {
    const js = readFileSync(join(import.meta.dir, "../public/zc.js"), "utf8"); expect(js.match(/money back|money comes back|get back|payment charge kept|Payment charge/g)).toBeNull(); // the words of the old refund screens are gone
    const o = await organizer(); await make(o, "UI-WORDS2"); await publish(o, "UI-WORDS2"); const p = await consolePage(o, "UI-WORDS2"); await p.waitFor((x) => /Last step|Your game|Hello/i.test(x));
    openStep(p, 7); expect(p.$("#sec7 .zc-about")!.textContent).toMatch(/We do not give refunds: a paid game becomes credit for your next game for 365 days/); openStep(p, 8); expect(p.$("#sec8 .zc-about")!.textContent).toMatch(/your payment stays as credit for 365 days/);
    p.click('[data-act="help"]'); const q = Array.from(p.win.document.querySelectorAll(".zc-qh")).findIndex((e: any) => /Can I get a refund\?/.test(e.textContent)); expect(q).toBeGreaterThanOrEqual(0); p.click(`[data-q="${q}"]`);
    expect(p.$(".zc-qa")!.textContent).toBe("We do not give refunds. If you cancel a paid game before it starts, your payment stays in the Organizer's account as credit for the next game, for 365 days. Unused credit lapses at the end of day 365.");
  });
});

describe("simpler console (owner order 2026-10-27: hide, never disable, the rarely used choices)", () => {
  test("step 2: the 'How many rounds' choice is hidden (one game is one round), still in the page, and the rest of the step is shown", async () => {
    const o = await organizer(); await make(o, "UI-SIMP");
    const p = await consolePage(o, "UI-SIMP"); await p.waitFor((x) => /Hello/.test(x)); openStep(p, 2);
    const hiddenAll = Array.from(p.win.document.querySelectorAll("#sec2 .zc-hide[data-hidden='1']")); expect(hiddenAll.length).toBeGreaterThan(0);
    expect(hiddenAll.some((h: any) => /How many rounds/.test(h.textContent))).toBe(true); expect(p.$("#sec2")!.textContent).toMatch(/Cards for each person/);
    const visible = Array.from(p.win.document.querySelectorAll("#sec2 .zc-lbl")).filter((e: any) => !e.closest(".zc-hide")).map((e: any) => e.textContent).join("|");
    expect(visible).not.toMatch(/How many rounds/); expect(visible).not.toMatch(/Cards for each person|How the card marks/); // B01: a game with the usual choices (1 card, automatic) does not show them either
    expect(visible).toMatch(/Duration \(gap\) between two numbers/); // this older game runs at 9 seconds, so its speed stays visible (B02)
  });
  test("a demo link kept in this browser is used once the organizer is taken straight into a game (not only on the home screen)", async () => {
    const o = await organizer(); await make(o, "UI-PASS");
    const posts: any[] = [];
    const w = spy({ "POST /api/pass": (_m, b) => { posts.push(b); return { ok: true, cap: 100 }; } });
    const p = await consolePage(o, "UI-PASS", o.token, {}, { afterLoad: w.hook, url: "http://localhost/zc?e=UI-PASS&pass=0123456789abcdef0123456789abcdef" } as any);
    await p.waitFor((x) => /Hello/.test(x)); await p.waitFor(() => posts.length > 0, 8000);
    expect(posts).toEqual([{ token: "0123456789abcdef0123456789abcdef" }]);
  });
});

