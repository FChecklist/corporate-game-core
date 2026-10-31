// B08, B09, B10, B15, B28, B33 (gap plan 2026-10-29): the words and buttons a player and an organizer meet on game day.
//   B10  the check-before-publish read-back names the prizes that have no name yet, with a "Name them now" button
//   B12  the people list says how many were invited and have not joined, with a filter
//   B09  step 9 (game day) carries the big number board button and the big-screen link
//   B28  the game-day report never says "all match" when nothing is stored (Bingo has no claim button; phones report their own wins)
//   B08  the paused text says when and that the card is safe; a slow phone connection is not blamed on the organizer
//   B15  a Do Not Disturb tip, the screen stays awake, and a person who comes back is told what they missed
//   B33  three short rules under the card instead of "just watch"
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { newWorld, openPage, roundAt, T, type Page } from "./harness";
import { PRIZE_HOUSES } from "../../../packages/beacon/src/config";
import { publicKeyFromSecret } from "../../../packages/beacon/src/control";

setDefaultTimeout(60_000);
const PUB = join(import.meta.dir, "../public");
const ZC_SCRIPTS = "zgame.js control.js zc.js".split(" ");
let open: Page[] = [];
afterEach(async () => { for (const p of open) await p.close(); open = []; });

async function organizer() {
  const w = newWorld();
  const s = await w.json(await w.api("POST", "/api/start", { email: "boss@acme.com" }));
  return { ...w, token: s.token as string, aiKey: s.aiKey as string, aiMessage: s.aiMessage as string };
}
type O = Awaited<ReturnType<typeof organizer>>;
const START = roundAt(T) + 1200;
const make = (o: O, id: string, over: Record<string, unknown> = {}) => o.api("POST", "/api/z", { id, startRound: START, callSeconds: 12, cap: 100, ...over }, o.aiKey);
const publish = (o: O, id: string) => o.api("POST", `/api/z/${id}/publish`, { email: "boss@acme.com", phone: "98765 43210" }, o.token);
const regKey = (o: O, id: string) => o.api("PUT", `/api/z/${id}/control/key`, { publicKey: publicKeyFromSecret("11".repeat(32)) }, o.token);
async function page(o: O, url: string) {
  const afterLoad = (win: any, f: string) => { if (f === "zgame.js" && win.ZG && !win.ZG.PRIZE_HOUSES) win.ZG.PRIZE_HOUSES = PRIZE_HOUSES; };
  const p = await openPage(o.world, { url: "http://localhost" + url, html: "zc.html", scripts: ZC_SCRIPTS, session: { "cbz-org": o.token, "cbz-aimsg": o.aiMessage, "cbz-email": "boss@acme.com" }, afterLoad });
  open.push(p); return p;
}

describe("B10: the read-back before publishing names the unnamed prizes", () => {
  test("a draft whose prizes have no name lists them and offers 'Name them now' (the button opens step 3); named prizes show no warning", async () => {
    const o = await organizer();
    expect((await make(o, "UN-1")).status).toBe(200); // the default prizes have no prize text
    const p = await page(o, "/zc?e=UN-1"); await p.waitFor((x) => /Hello/.test(x));
    p.click('.zc-dot[data-open="7"]'); // step 7 is Publish (it also shows for a draft)
    const warn = await p.waitFor((x) => /have no name yet|has no name yet/.test(x), 8000).catch(() => p.text());
    expect(warn).toMatch(/4 prizes have no name yet: Line, Four Corners, X, Blackout/);
    const btn = p.$("#namethem") as any; expect(btn).not.toBeNull(); expect(btn.dataset.open).toBe("3");
    const o2 = await organizer();
    expect((await make(o2, "UN-2", { rewards: [{ pattern: "line", ordinal: 1, text: "Gift hamper" }, { pattern: "blackout", ordinal: 1, text: "Movie tickets" }] })).status).toBe(200);
    const q = await page(o2, "/zc?e=UN-2"); await q.waitFor((x) => /Hello/.test(x)); q.click('.zc-dot[data-open="7"]');
    await new Promise((r) => setTimeout(r, 500));
    expect(q.$("#unnamed")).toBeNull();
  });
});

describe("B09 + B28: game day (step 9)", () => {
  test("the big number board button and link are in step 9, and the phone-report line is honest when nothing is stored", async () => {
    const o = await organizer(); await make(o, "GD-1"); await regKey(o, "GD-1"); await publish(o, "GD-1");
    const p = await page(o, "/zc?e=GD-1"); await p.waitFor((x) => /Hello|Last step/.test(x)); p.click('.zc-dot[data-open="9"]');
    await p.waitFor((x) => /Message to everyone/.test(x));
    const a = p.$("#openbig9") as any; expect(a).not.toBeNull(); expect(a.getAttribute("href")).toBe("http://localhost/big.html?e=GD-1"); expect(a.getAttribute("target")).toBe("_blank");
    expect(p.$("#copybig9")).not.toBeNull();
    const t = p.text();
    expect(t).not.toMatch(/Claims received/); expect(t).not.toMatch(/All claims so far match/);
    expect(t).toMatch(/No phone has reported a win yet/);
  });
  test("a game above 500 people says the reports are not stored, instead of 'all match'", async () => {
    const o = await organizer(); await make(o, "GD-2", { cap: 600 }); await regKey(o, "GD-2"); await publish(o, "GD-2");
    const p = await page(o, "/zc?e=GD-2"); await p.waitFor((x) => /Hello|Last step/.test(x)); p.click('.zc-dot[data-open="9"]');
    await p.waitFor((x) => /Message to everyone/.test(x));
    const t = p.text(); expect(t).toMatch(/not stored for a game this large/); expect(t).not.toMatch(/All of them match|all match/i);
  });
});

describe("B08, B15, B33: the phone page", () => {
  const z = readFileSync(join(PUB, "z.js"), "utf8");
  test("B08: a pause says the time and that the card is safe; a slow connection is its own sentence, not the organizer's", () => {
    expect(z).toMatch(/Game paused by the organizer[^`]*It restarts soon\. Your card is safe\./);
    expect(z).toMatch(/Your connection looks slow\. Your card is safe\./);
    expect(z).not.toMatch(/Checking with the organizer/);
    expect(z).not.toMatch(/Cannot reach the organizer's controls/);
    expect(z).toMatch(/v\.pausedFromRound/);
  });
  test("B15: Do Not Disturb tip, wake lock, and a welcome-back line with the number of numbers missed", () => {
    expect(z).toMatch(/Do Not Disturb/);
    expect(z).toMatch(/navigator\.wakeLock/);
    expect(z).toMatch(/visibilitychange/);
    expect(z).toMatch(/Welcome back\. You missed/);
  });
  test("B33: three short rules under the card, and no 'just watch'", () => {
    expect(z).not.toMatch(/Just watch/);
    const m = /<ol class="zsmall zrules"[^>]*>((?:<li>[^<]*<\/li>)+)<\/ol>/.exec(z.replace(/\$\{[^}]*\}/g, "X"));
    expect(m).not.toBeNull();
    expect((m![1]!.match(/<li>/g) ?? []).length).toBe(3);
  });
});

describe("B12: the organizer learns before the game who has not joined", () => {
  test("'N invited, not joined yet' on the people list, a Show them filter, and the count follows the people who join", async () => {
    const o = await organizer(); await make(o, "NJ-1"); await publish(o, "NJ-1");
    const add = await o.api("POST", "/api/z/NJ-1/people", { people: [{ name: "Asha Rao", phone: "9876500001" }, { name: "Ravi Iyer", phone: "9876500002" }, { name: "Meera Das", phone: "9876500003" }] }, o.token);
    expect(add.status).toBe(200);
    const p = await page(o, "/zc?e=NJ-1"); await p.waitFor((x) => /Hello|Last step/.test(x)); p.click('.zc-dot[data-open="6"]');
    await p.waitFor((x) => /3 invited, not joined yet/.test(x), 12000);
    const rows = () => p.win.document.querySelectorAll("#mypeople .zc-person, #mypeople .zc-rowl, #mypeople [data-wa]").length;
    const all = rows(); p.click("#shownot"); await p.waitFor((x) => /Showing only them/.test(x), 5000);
    expect(rows()).toBeGreaterThan(0); expect(rows()).toBeLessThanOrEqual(all);
    o.world.raw.prepare("UPDATE person SET status='joined' WHERE rowid=(SELECT MIN(rowid) FROM person WHERE eid='NJ-1')").run();
    const q = await page(o, "/zc?e=NJ-1"); await q.waitFor((x) => /Hello|Last step/.test(x)); q.click('.zc-dot[data-open="6"]');
    await q.waitFor((x) => /2 invited, not joined yet/.test(x), 12000);
  });
});

describe("B26: the organizer can fetch the game log in the last step", () => {
  test("step 10 offers the game log with the plain promise (saved when the game ends, kept 365 days) and a download button", async () => {
    const o = await organizer(); await make(o, "GL-1"); await regKey(o, "GL-1"); await publish(o, "GL-1");
    const p = await page(o, "/zc?e=GL-1"); await p.waitFor((x) => /Hello|Last step/.test(x)); p.click('.zc-dot[data-open="10"]');
    await p.waitFor((x) => /Game log/.test(x), 8000);
    expect(p.$("#dlgamelog")).not.toBeNull();
    expect(p.text()).toMatch(/saved by us when the game ends, whether or not the report e-mail arrives, and kept for 365 days/);
  });
});
