// Phases 2 to 4, the guest's phone and the public pages (docs/PHASE2_SERVER_CONTRACT.md "The phone page must", ROLES_AND_CONSOLE_SPEC_2 items 11 to 13, spec 4 section C).
// The real page scripts run in a DOM and talk to the REAL Worker code (apps/edge) with an in-memory database. Only the public randomness and Google's script are faked.
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { createHash, createSign, generateKeyPairSync } from "node:crypto";
import { newWorld, openPage, roundAt, roundMs, T, type Page } from "./harness";
import { setGoogleKeyProvider } from "../../edge/src/google";

setDefaultTimeout(60_000);
const HOUR = 3_600_000, DAY = 24 * HOUR;
const START = roundAt(T) + 1200; // one hour after T
const rnd = (r: number) => createHash("sha256").update("fake" + r).digest("hex");
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAABgAAAAAAAAAAAAAAAAAAAAAAAAAAA="; // a 96 x 96 picture header (the server checks the size in pixels: 48 to 192 on the longest side)
let open: Page[] = [];
afterEach(async () => { for (const p of open) await p.close(); open = []; setGoogleKeyProvider(); });

async function organizer(extra: Record<string, string> = {}) {
  const w = newWorld(extra);
  const s = await w.json(await w.api("POST", "/api/start", { email: "boss@acme.com" }));
  return { ...w, token: s.token as string, aiKey: s.aiKey as string };
}
type O = Awaited<ReturnType<typeof organizer>>;
const make = (o: O, id: string, over: Record<string, unknown> = {}) => o.api("POST", "/api/z", { id, startRound: START, callSeconds: 9, cap: 100, join: "phone", ...over }, o.aiKey);
const publish = (o: O, id: string) => o.api("POST", `/api/z/${id}/publish`, { email: "boss@acme.com", phone: "98765 43210" }, o.token);
const settings = (o: O, id: string, body: unknown) => o.api("PATCH", `/api/z/${id}/settings`, body, o.token);
const published = async (o: O, id: string, set: Record<string, unknown> = {}, over: Record<string, unknown> = {}) => { await make(o, id, over); if (Object.keys(set).length) { const r = await settings(o, id, set); expect(r.status).toBe(200); } await publish(o, id); };

type Call = { m: string; u: string; b?: any };
const rtFake = (win: any, nowMs: () => number) => { // the phone's runtime with a fake public beacon (the real one is not reachable from a test)
  const Orig = win.ZG.PhoneRuntime;
  win.ZG.PhoneRuntime = class extends Orig {
    constructor(eid: string, deps: any) {
      super(eid, { ...deps, beacon: { fetcher: async (url: string) => { const last = url.split("/").pop()!; const r = last === "latest" ? roundAt(nowMs()) : Number(last); return { ok: true, status: 200, json: async () => ({ round: r, randomness: rnd(r), signature: "aa" }) }; }, mirrors: ["https://a.test", "https://b.test", "https://c.test"], timeoutMs: 500 }, verify: (x: any) => x.signature === "aa", mono: () => deps.mono() });
    }
  };
};
/** Every request the page makes is written down (method, address, body). `pre` runs before the page's own scripts (to preset storage or wrap fetch). */
const spy = (calls: Call[], pre?: (win: any) => void) => (win: any, f: string, o?: O) => {
  if (f !== "audio.js" && f !== "common.js" && f !== "preview.js" && f !== "google.js" && f !== "paylink.js" && f !== "signin.js") return;
  if (win.__spied) return; win.__spied = true;
  pre?.(win);
  const of = win.fetch;
  win.fetch = (u: any, i?: any) => { let b: any; try { b = i?.body ? JSON.parse(i.body) : undefined; } catch { /* not json */ } calls.push({ m: String(i?.method || "GET").toUpperCase(), u: String(u), b }); return of(u, i); };
};
async function phoneAt(o: O, url: string, calls: Call[] = [], pre?: (win: any) => void) {
  const hook = spy(calls, pre);
  const p = await openPage(o.world, { url: "http://localhost" + url, html: "z.html", scripts: ["audio.js", "zgame.js", "z.js"], afterLoad: (win, f) => { hook(win, f); if (f === "zgame.js") rtFake(win, () => o.world.now); } });
  open.push(p); return p;
}
const typeJoin = async (p: Page, phone: string, name = "Asha") => { await p.waitFor((x) => /Join the game/.test(x)); { const ph = p.$("#ph") as any; if (ph) ph.value = phone; } (p.$("#nm") as any).value = name; p.click("#go"); };
const setVal = (p: Page, sel: string, v: string) => { const el = p.$(sel) as any; el.value = v; el.dispatchEvent(new p.win.Event("input", { bubbles: true })); };
const SEEN = /Your card|What you can win|Starting in|Getting ready/;

describe("brand strip on the card page", () => {
  test("the company strip shows the name on the accent colour with readable text, the small logo from the settings, and a quiet 'Powered by' line; nothing is fetched from outside", async () => {
    const o = await organizer(); await published(o, "PG-BR1", { brand: { name: "Acme Foods", color: "#B3261E", logo: PNG } });
    const calls: Call[] = []; const p = await phoneAt(o, "/z?e=PG-BR1", calls);
    await p.waitFor((x) => /Join the game/.test(x));
    const strip = () => p.win.document.querySelector(".zbrand") as any;
    expect(strip().textContent).toContain("Acme Foods"); expect(p.text()).toMatch(/Powered by Corporate Bingo/); // on the join screen too
    await typeJoin(p, "9822222222"); await p.waitFor((x) => SEEN.test(x));
    const s = strip(); expect(s.textContent.trim()).toBe("Acme Foods");
    expect(s.style.background).toMatch(/#b3261e|rgb\(179, ?38, ?30\)/i); expect(s.style.color).toMatch(/#fff|rgb\(255, ?255, ?255\)/i); // dark red: white text
    expect(s.querySelector("img").getAttribute("src")).toBe(PNG);
    expect(p.win.document.querySelector(".zpow").textContent).toBe("Powered by Corporate Bingo");
    expect(calls.every((c) => c.u.startsWith("/"))).toBe(true); // every request went to our own server
    expect(p.errors).toEqual([]);
  });
  test("on a light or mid colour the text turns dark so it stays readable", async () => {
    const o = await organizer(); await published(o, "PG-BR2", { brand: { name: "Sunny Co", color: "#C26A00" } });
    const p = await phoneAt(o, "/z?e=PG-BR2"); await typeJoin(p, "9822222223"); await p.waitFor((x) => SEEN.test(x));
    const s = p.win.document.querySelector(".zbrand") as any; expect(s.style.color).toMatch(/#111111|rgb\(17, ?17, ?17\)/i); expect(!!s.querySelector("img")).toBe(false);
  });
  test("no brand set: the card carries CORPORATE BINGO in writing, no 'Powered by' line, nothing breaks", async () => {
    const o = await organizer(); await published(o, "PG-BR3");
    const p = await phoneAt(o, "/z?e=PG-BR3"); await typeJoin(p, "9822222224"); await p.waitFor((x) => SEEN.test(x));
    const d = p.win.document.querySelector(".zbrand") as any; expect(d.textContent.trim()).toBe("CORPORATE BINGO"); expect(d.querySelector("img")).toBeNull(); expect(p.text()).not.toMatch(/Powered by/); expect(p.errors).toEqual([]); // no brand set: our own name in writing, no second 'Powered by' line
  });
  test("a hostile brand is shown as plain text: no markup from the name, an outside logo address is dropped, a bad colour falls back", async () => {
    const o = await organizer(); await published(o, "PG-BR4");
    const bad = { name: "<img src=x onerror=alert(1)>", color: "red", logo: "https://evil.example/x.png" };
    const p = await phoneAt(o, "/z?e=PG-BR4", [], (win) => { const of = win.fetch; win.fetch = async (u: any, i?: any) => { const r = await of(u, i); if (!/\/info$/.test(String(u))) return r; const j = await r.json(); return new Response(JSON.stringify({ ...j, brand: bad }), { status: 200, headers: { "content-type": "application/json" } }); }; });
    await p.waitFor((x) => /Join the game/.test(x));
    const s = p.win.document.querySelector(".zbrand") as any; expect(s.textContent).toContain("<img src=x"); expect(!!s.querySelector("img")).toBe(false); expect(!!p.win.document.querySelector("img")).toBe(false);
    expect(s.style.background).toMatch(/#0B5D5B|rgb\(11, ?93, ?91\)/i);
  });
});

describe("joining: personal link, waiting, removed, cancelled", () => {
  const listOnly = async (o: O, id: string, extra: Record<string, unknown> = {}) => { await published(o, id, { whoCanJoin: "list", ...extra }); };
  const addPerson = async (o: O, id: string, name: string, phone: string) => { const r = await o.json(await o.api("POST", `/api/z/${id}/people`, { people: [{ name, phone }] }, o.token)); expect(r.added).toBe(1); return r.people[0] as { id: string; link: string }; };
  const tokenOf = (link: string) => link.split("/j/")[1]!;

  test("a personal link needs no number: the token is sent, the card opens, and the token leaves the address bar", async () => {
    const o = await organizer(); await listOnly(o, "PG-TK1"); const pr = await addPerson(o, "PG-TK1", "Meera", "9822211111");
    const calls: Call[] = []; const p = await phoneAt(o, `/z?e=PG-TK1&t=${tokenOf(pr.link)}`, calls);
    await p.waitFor((x) => /Your personal link is ready/.test(x)); expect(!!p.$("#ph")).toBe(false); expect(!!p.$("#nm")).toBe(false);
    p.click("#go"); await p.waitFor((x) => SEEN.test(x));
    const join = calls.find((c) => c.m === "POST" && /\/join$/.test(c.u))!; expect(join.b.token).toBe(tokenOf(pr.link));
    expect(p.win.location.search).not.toContain("t="); expect(p.win.location.search).toContain("e=PG-TK1");
    expect(p.errors).toEqual([]);
  });
  test("a link already opened on another phone asks for the number it was made for, and sends it with the token", async () => {
    const o = await organizer(); await listOnly(o, "PG-TK2"); const pr = await addPerson(o, "PG-TK2", "Meera", "9822211111"); const tk = tokenOf(pr.link);
    const first = await phoneAt(o, `/z?e=PG-TK2&t=${tk}`); await first.waitFor((x) => /Your personal link is ready/.test(x)); first.click("#go"); await first.waitFor((x) => SEEN.test(x));
    const calls: Call[] = []; const p = await phoneAt(o, `/z?e=PG-TK2&t=${tk}`, calls);
    await p.waitFor((x) => /Your personal link is ready/.test(x)); p.click("#go");
    await p.waitFor((x) => /already opened on another phone/.test(x)); expect(!!p.$("#ph")).toBe(true);
    { const ph = p.$("#ph") as any; if (ph) ph.value = "9822211111"; const nm = p.$("#nm") as any; if (nm) nm.value = "Asha"; } p.click("#go");
    await p.waitFor(() => calls.filter((c) => c.m === "POST" && /\/join$/.test(c.u)).length >= 2);
    const again = calls.filter((c) => c.m === "POST" && /\/join$/.test(c.u))[1]!; expect(again.b.token).toBe(tk); expect(again.b.phone).toBe("9822211111");
  });
  test("an unlisted number waits calmly, the page asks 'me' until it is let in, then the card opens", async () => {
    const o = await organizer(); await listOnly(o, "PG-WT1");
    const calls: Call[] = []; const p = await phoneAt(o, "/z?e=PG-WT1", calls); await typeJoin(p, "9822233333");
    await p.waitFor((x) => /Please wait a moment/.test(x)); expect(p.text()).toMatch(/Your request is with/); expect(p.text()).not.toMatch(/Your card/);
    const w = await o.json(await o.api("GET", "/api/z/PG-WT1/waiting", undefined, o.token)); expect(w.waiting.length).toBe(1);
    const ok = await o.json(await o.api("POST", `/api/z/PG-WT1/waiting/${w.waiting[0].id}`, { decision: "admit" }, o.token)); expect(ok.ok).toBe(true);
    await p.waitFor((x) => SEEN.test(x), 20_000);
    expect(calls.some((c) => c.m === "GET" && /\/me\?wid=/.test(c.u))).toBe(true);
    expect(p.errors).toEqual([]);
  });
  test("the waiting screen survives a reload: the page opens straight on 'please wait', keeps asking, and the card opens when let in", async () => {
    const o = await organizer(); await listOnly(o, "PG-WT3");
    const first = await phoneAt(o, "/z?e=PG-WT3"); await typeJoin(first, "9822266666"); await first.waitFor((x) => /Please wait a moment/.test(x));
    const saved = first.win.localStorage.getItem("cbz-wait-PG-WT3"); expect(saved).toBeTruthy(); await first.close(); // the old page is gone, as in a real reload
    const calls: Call[] = []; const p = await phoneAt(o, "/z?e=PG-WT3", calls, (win) => win.localStorage.setItem("cbz-wait-PG-WT3", saved!)); // the same phone after a reload
    await p.waitFor((x) => /Please wait a moment/.test(x)); expect(p.text()).not.toMatch(/Join the game/); expect(!!p.$("#go")).toBe(false);
    const w = await o.json(await o.api("GET", "/api/z/PG-WT3/waiting", undefined, o.token)); expect(w.waiting.length).toBe(1);
    await o.api("POST", `/api/z/PG-WT3/waiting/${w.waiting[0].id}`, { decision: "admit" }, o.token);
    await p.waitFor((x) => SEEN.test(x), 20_000);
    expect(calls.some((c) => c.m === "POST" && /\/join$/.test(c.u) && c.b.phone === "9822266666")).toBe(true); // it joined with what was typed before the reload
    expect(p.win.localStorage.getItem("cbz-wait-PG-WT3") || "").toBe(""); // and forgot the waiting note
    expect(p.errors).toEqual([]);
  });
  test("a request that is declined ends with a calm message and no card", async () => {
    const o = await organizer(); await listOnly(o, "PG-WT2");
    const p = await phoneAt(o, "/z?e=PG-WT2"); await typeJoin(p, "9822244444"); await p.waitFor((x) => /Please wait a moment/.test(x));
    const w = await o.json(await o.api("GET", "/api/z/PG-WT2/waiting", undefined, o.token));
    await o.api("POST", `/api/z/PG-WT2/waiting/${w.waiting[0].id}`, { decision: "decline" }, o.token);
    const t = await p.waitFor((x) => /Your request was not accepted/.test(x), 20_000); expect(t).not.toMatch(/Your card/);
  });
  test("a removed person who tries again is told so, and a removed card-holder's phone stops", async () => {
    const o = await organizer(); await listOnly(o, "PG-RM1"); const pr = await addPerson(o, "PG-RM1", "Ravi", "9822255555");
    const rm = await o.api("POST", `/api/z/PG-RM1/people/${pr.id}/remove`, {}, o.token); expect(rm.status).toBe(200);
    const p = await phoneAt(o, "/z?e=PG-RM1"); await typeJoin(p, "9822255555");
    const t = await p.waitFor((x) => /removed/i.test(x)); expect(t).not.toMatch(/Your card/); expect(!!p.$("#go")).toBe(false);
    // someone who holds a card and is removed afterwards: their phone asks 'me' and stops
    await published(o, "PG-RM2");
    const dev = "ab".repeat(16); const j = await o.json(await o.api("POST", "/api/z/PG-RM2/join", { phone: "9822266666", name: "Sam", device: dev }));
    const list = await o.json(await o.api("GET", "/api/z/PG-RM2/people", undefined, o.token)); const me = list.people.find((x: any) => x.status === "joined"); expect(me).toBeTruthy();
    const q = await phoneAt(o, "/z?e=PG-RM2", [], (win) => { win.localStorage.setItem("cbz:PG-RM2:pid", j.pid); win.localStorage.setItem("cbz:device", dev); });
    await q.waitFor((x) => SEEN.test(x));
    await o.api("POST", `/api/z/PG-RM2/people/${me.id}/remove`, {}, o.token);
    const r = await phoneAt(o, "/z?e=PG-RM2", [], (win) => { win.localStorage.setItem("cbz:PG-RM2:pid", j.pid); win.localStorage.setItem("cbz:device", dev); });
    await r.waitFor((x) => /You have been removed from this game/.test(x)); expect(r.text()).not.toMatch(/Your card|Still to win/);
  });
  test("removed during the game (the seat stays, blocked): the phone stops and says so", async () => {
    const o = await organizer(); await published(o, "PG-RM3");
    const dev = "ef".repeat(16); const j = await o.json(await o.api("POST", "/api/z/PG-RM3/join", { phone: "9822266667", name: "Sam", device: dev }));
    o.world.raw.prepare("UPDATE seat SET blocked=1 WHERE eid=? AND pid=?").run("PG-RM3", j.pid);
    const p = await phoneAt(o, "/z?e=PG-RM3", [], (win) => { win.localStorage.setItem("cbz:PG-RM3:pid", j.pid); win.localStorage.setItem("cbz:device", dev); });
    await p.waitFor((x) => /You have been removed from this game/.test(x)); expect(p.text()).not.toMatch(/Your card|Still to win/);
  });
  test("a cancelled game shows one calm screen: no join form, nothing to play", async () => {
    const o = await organizer(); await published(o, "PG-CN1", { brand: { name: "Acme Foods", color: "#0B3D91" } });
    const c = await o.api("POST", "/api/z/PG-CN1/cancel", { confirmations: 3 }, o.token); expect(c.status).toBe(200);
    const p = await phoneAt(o, "/z?e=PG-CN1");
    const t = await p.waitFor((x) => /This game was cancelled/.test(x)); expect(!!p.$("#go")).toBe(false); expect(t).not.toMatch(/Get my card|Your card/); expect(t).toContain("Acme Foods");
  });
});

describe("My invites on the guest's phone", () => {
  test("a guest who may invite sees the card: add, send on WhatsApp, remove (the share-a-link card stays beside it)", async () => {
    const o = await organizer(); await published(o, "PG-MI1", { guestInvites: { on: true, per: 2 } });
    const calls: Call[] = []; const p = await phoneAt(o, "/z?e=PG-MI1", calls); await typeJoin(p, "9822277777");
    await p.waitFor((x) => /My invites/.test(x), 20_000);
    await p.waitFor((x) => /up to 2 people/.test(x));
    setVal(p, "#mi-name", "Kiran"); setVal(p, "#mi-phone", "9822288888"); p.click("#mi-add");
    await p.waitFor((x) => /Kiran/.test(x) && /Send on WhatsApp/.test(x), 20_000);
    const wa = p.win.document.querySelector('#mine a[href^="https://wa.me/"]'); expect(!!wa).toBe(true);
    expect(p.text()).toMatch(/XXXX|\*\*\*|X{4,}|\d{4}/); expect(p.text()).not.toContain("9822288888"); // only a masked number is shown back
    const posts = calls.filter((c) => c.m === "POST" && /\/people\?me=/.test(c.u)); expect(posts.length).toBe(1);
    // it really reached the server's list for this guest
    const l = await o.json(await o.api("GET", "/api/z/PG-MI1/people", undefined, o.token)); expect(l.people.some((x: any) => x.name === "Kiran")).toBe(true);
    p.click("[data-mirm]"); await p.waitFor((x) => /Yes, remove/.test(x)); p.click("[data-miyes]");
    await p.waitFor((x) => /Removed\. Your place is free again/.test(x), 20_000);
    const l2 = await o.json(await o.api("GET", "/api/z/PG-MI1/people", undefined, o.token)); expect(l2.people.find((x: any) => x.name === "Kiran").status).toBe("removed");
    expect(p.errors).toEqual([]);
  });
  test("a guest invited by a guest sees no invites card at all", async () => {
    const o = await organizer(); await published(o, "PG-MI2", { guestInvites: { on: true, per: 2 } });
    const a = await o.json(await o.api("POST", "/api/z/PG-MI2/join", { phone: "9822299990", name: "A", device: "cd".repeat(16) }));
    const seat = Number(/^(\d+)x/.exec(a.pid)![1]);
    const calls: Call[] = []; const p = await phoneAt(o, `/z?e=PG-MI2&from=${seat}`, calls); await typeJoin(p, "9822299991", "B"); await p.waitFor((x) => SEEN.test(x));
    await p.waitFor(() => calls.some((c) => /\/me\?pid=/.test(c.u))); await new Promise((r) => setTimeout(r, 2500));
    expect(!!p.$("#mine")).toBe(false); expect(p.text()).not.toMatch(/My invites/);
  });
});

describe("See what guests see (card preview)", () => {
  const prev = async (o: O, hash: string, calls: Call[] = [], session: Record<string, string> = {}) => { const hook = spy(calls); const p = await openPage(o.world, { url: "http://localhost/preview.html" + hash, html: "preview.html", scripts: ["audio.js", "preview.js"], session, afterLoad: (w, f) => hook(w, f) }); open.push(p); return p; };
  test("from the address: a sample card marked PREVIEW with the brand strip, prizes, a break and a lucky draw; it writes nothing", async () => {
    const o = await organizer(); const calls: Call[] = [];
    const p = await prev(o, "#w=card&n=Acme%20Foods&c=%231B7F5C&p=Voucher%205000|Gift%20hamper&b=A%20word%20from%20our%20CEO&l=Smart%20watch", calls);
    const t = await p.waitFor((x) => /PREVIEW/.test(x));
    expect(t).toMatch(/PREVIEW\. This is a sample card, not a real one\. Nothing is saved/); expect(p.win.document.querySelector(".zbrand").textContent).toContain("Acme Foods"); expect(t).toMatch(/Powered by Corporate Bingo/);
    expect(t).toMatch(/Voucher 5000/); expect(t).toMatch(/Gift hamper/); expect(t).toMatch(/A word from our CEO/); expect(t).toMatch(/Lucky draw/); expect(t).toMatch(/Smart watch/);
    expect(p.win.document.querySelectorAll(".zticket .c, .zticket .free").length).toBe(25);
    expect(calls.filter((c) => c.m !== "GET")).toEqual([]); expect(calls.length).toBe(0); expect(p.errors).toEqual([]);
  });
  test("with a game id: reads the game's public settings (a GET only) and shows its own brand and prizes; without a brand it says so", async () => {
    const o = await organizer(); await published(o, "PG-PV1", { brand: { name: "Acme Foods", color: "#6A1B9A" }, rewards: [{ pattern: "blackout", ordinal: 1, text: "Voucher 5000" }] });
    const calls: Call[] = []; const p = await prev(o, "#w=card&e=PG-PV1", calls, { "cbz-org": o.token });
    await p.waitFor((x) => /Voucher 5000/.test(x)); expect(p.win.document.querySelector(".zbrand").textContent).toContain("Acme Foods"); expect(p.text()).toMatch(/Blackout/);
    expect(calls.filter((c) => c.m !== "GET")).toEqual([]); expect(calls.some((c) => /\/api\/z\/PG-PV1\/info$/.test(c.u))).toBe(true);
    await published(o, "PG-PV2"); const q = await prev(o, "#w=card&e=PG-PV2", [], { "cbz-org": o.token });
    await q.waitFor((x) => /No company name or logo is set yet/.test(x)); expect((q.win.document.querySelector(".zbrand") as any).textContent).toBe("CORPORATE BINGO"); expect(q.text()).toMatch(/PREVIEW/);
  });
  test("the older break test still works beside it", async () => {
    const o = await organizer(); const p = await prev(o, "#w=break&k=speech&t=Hello"); await p.waitFor((x) => /A short break/.test(x)); expect(p.text()).toMatch(/Test only/);
  });
});

describe("the pay link page (no sign-in)", () => {
  const linkOf = async (o: O, id: string) => { const r = await o.api("POST", `/api/z/${id}/paylink`, {}, o.token); expect(r.status).toBe(200); const j = await o.json(r); return new URL(j.url).searchParams.get("t")!; };
  const pl = async (o: O, t: string, calls: Call[] = []) => { const hook = spy(calls); const p = await openPage(o.world, { url: "http://localhost/paylink.html" + (t ? "?t=" + t : ""), html: "paylink.html", scripts: ["common.js", "paylink.js"], afterLoad: (w, f) => hook(w, f) }); open.push(p); return p; };
  test("shows only the game, date and price with GST, asks name and e-mail, and pays that one game (read back from the server)", async () => {
    const o = await organizer({ TEST_MODE: "1" }); await published(o, "PG-PL1", {}, { name: "Diwali Night" }); const t = await linkOf(o, "PG-PL1");
    const calls: Call[] = []; const p = await pl(o, t, calls);
    const txt = await p.waitFor((x) => /Diwali Night/.test(x));
    expect(txt).toMatch(/₹/); expect(txt).not.toMatch(/plus GST/); expect(txt).toMatch(/Payment to IT Services by Rajat Agarwal/); expect(txt).toMatch(/Total/); expect(txt).not.toMatch(/Please sign in/i); expect(!!p.$("#nm")).toBe(true); expect(!!p.$("#em")).toBe(true); expect(!!p.$("#ph")).toBe(true); // the Details block asks for mobile, company name and GST / Tax number (all optional)
    expect(p.win.location.search).toBe(""); // the secret left the address bar
    p.click("#paygo"); await p.waitFor((x) => /Please enter your name/.test(x)); expect(calls.filter((c) => c.m === "POST" && !c.u.endsWith("/api/proforma"))).toEqual([]); // nothing is sent until name and e-mail are good
    (p.$("#nm") as any).value = "Neha Shah"; (p.$("#em") as any).value = "neha@acme.com"; p.click("#paygo");
    await p.waitFor((x) => /Payment received/.test(x), 20_000);
    const post = calls.find((c) => c.m === "POST" && /\/checkout$/.test(c.u))!; expect(post.u).toBe(`/api/paylink/${t}/checkout`); expect(post.b).toMatchObject({ name: "Neha Shah", email: "neha@acme.com" });
    const st = await o.json(await o.api("GET", `/api/paylink/${t}`)); expect(st.status).toBe("paid");
    const sum = await o.json(await o.api("GET", "/api/z/PG-PL1/summary", undefined, o.token)); expect(sum.payment.status).toBe("paid");
  });
  test("calm screens: paid, expired after 7 days, cancelled, and a wrong or missing link", async () => {
    const o = await organizer({ TEST_MODE: "1" }); await published(o, "PG-PL2"); const t2 = await linkOf(o, "PG-PL2");
    await published(o, "PG-PL3"); const t3 = await linkOf(o, "PG-PL3");
    await o.api("POST", "/api/z/PG-PL3/cancel", { confirmations: 3 }, o.token);
    expect((await (await pl(o, t3)).waitFor((x) => /This game was cancelled/.test(x)))).toMatch(/nothing to pay/i);
    o.world.now += 8 * DAY; const ex = await pl(o, t2); expect(await ex.waitFor((x) => /This payment link has run out/.test(x))).not.toMatch(/Pay ₹/); expect(!!ex.$("#paygo")).toBe(false);
    o.world.now = T; await published(o, "PG-PL4", {}, { name: "Done Deal" }); const t4 = await linkOf(o, "PG-PL4"); o.world.raw.prepare("UPDATE engagement SET pack=100 WHERE id='PG-PL4'").run();
    expect(await (await pl(o, t4)).waitFor((x) => /already paid for/.test(x))).toBeTruthy();
    expect(await (await pl(o, "f".repeat(48))).waitFor((x) => /not working/.test(x))).toBeTruthy();
    expect(await (await pl(o, "")).waitFor((x) => /not working/.test(x))).toBeTruthy();
  });
});

describe("sign-in has one way: the e-mail (no Google button, even when the server has a Google client id)", () => {
  const GID = "test-id.apps.googleusercontent.com";
  const signin = async (o: O) => openPage(o.world, { url: "http://localhost/signin.html?t=abc", html: "signin.html", scripts: ["google.js", "signin.js"] });
  test("the one-tap page shows only its own button; no Google button, nothing is loaded from Google, with or without a client id", async () => {
    for (const env of [{}, { GOOGLE_CLIENT_ID: GID }]) {
      const o = await organizer(env); const p = await signin(o); await p.waitFor((x) => /Sign me in/.test(x)); await new Promise((r) => setTimeout(r, 300));
      expect(p.text()).not.toMatch(/Continue with Google/); expect((p.$("#gWrap") as any).hidden).toBe(true);
      expect(Array.from(p.win.document.querySelectorAll("script")).some((s: any) => /google/.test(s.src || ""))).toBe(false);
    }
  });
  test("the home page Log in sheet has the e-mail box and no Google button, with a client id", async () => {
    const o = await organizer({ GOOGLE_CLIENT_ID: GID });
    const home = await openPage(o.world, { url: "http://localhost/#login", html: "index.html", scripts: ["keep.js", "common.js", "google.js", "site.js"] }); open.push(home);
    await new Promise((r) => setTimeout(r, 600));
    const t = home.win.document.body.textContent || "";
    expect(t).not.toMatch(/Continue with Google/); expect(t).toMatch(/Type your e-mail and press Continue/); expect(home.errors).toEqual([]);
  });
});
