// B01, B02, B31 (gap plan 2026-10-29), as the organizer sees them in the console:
//   B01  a new game never shows Cards for each person / How the card marks / the gap between numbers / what a guest types (they are hidden, not disabled); an older game that uses another value keeps seeing it
//   B02  a new game runs one number every 12 seconds (the only speed offered); an older game keeps its own
//   B31  the real start-time rule is "any time in the future"; "at least 2 hours ahead" is advice, and a "Start in 20 minutes" button exists
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { newWorld, openPage, roundAt, T, type Page } from "./harness";
import { PRIZE_HOUSES } from "../../../packages/beacon/src/config";
import { PAUSE_MAX_PARTICIPANTS } from "../../../packages/beacon/src/control";
import { readFileSync } from "node:fs";
import { join } from "node:path";

setDefaultTimeout(60_000);
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
async function page(o: O, url: string) {
  const afterLoad = (win: any, f: string) => { if (f === "zgame.js" && win.ZG && !win.ZG.PRIZE_HOUSES) win.ZG.PRIZE_HOUSES = PRIZE_HOUSES; };
  const p = await openPage(o.world, { url: "http://localhost" + url, html: "zc.html", scripts: ZC_SCRIPTS, session: { "cbz-org": o.token, "cbz-aimsg": o.aiMessage, "cbz-email": "boss@acme.com" }, afterLoad });
  open.push(p); return p;
}
const hiddenIn = (p: Page, sel: string) => { const el = p.$(sel) as any; return !!el && !!el.closest(".zc-hide"); };
const until = async (cond: () => boolean, ms = 20000) => { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) throw new Error("timed out"); await new Promise((r) => setTimeout(r, 50)); } };

describe("Quick setup (a new game)", () => {
  test("the four rarely needed choices are hidden, 12 seconds is the one speed on offer, and the start time has an honest rule plus a 20-minute button", async () => {
    const o = await organizer(); const p = await page(o, "/zc?quick=1");
    await p.waitFor((x) => /1\. Which game\?/.test(x) && /Up to 250 people/.test(x));
    for (const k of ["tix", "mk", "spd"]) expect([k, hiddenIn(p, `[data-ck="${k}"]`)]).toEqual([k, true]);
    expect(p.$('[data-ck="spd"][data-v="9"]')).toBeNull(); expect(p.$('[data-ck="spd"][data-v="6"]')).toBeNull(); expect(p.$('[data-ck="spd"][data-v="15"]')).toBeNull();
    expect((p.$('[data-ck="spd"][data-v="12"]') as any).getAttribute("aria-pressed")).toBe("true");
    expect(p.text()).not.toMatch(/Choose a time at least 2 hours ahead/);
    expect(p.text()).toMatch(/any time in the future/i);
    expect(p.$("#qk-soon")).not.toBeNull();
    (p.$("#qk-soon") as any).click();
    const got = new Date(`${(p.$("#qk-date") as any).value}T${(p.$("#qk-time") as any).value}:00Z`).getTime(); // organizer's own clock written as if it were UTC
    const tz = -new Date(T).getTimezoneOffset() * 60_000; // the test runs in India time (harness sets TZ), so the page and this line agree
    const minutes = (got - (T + tz)) / 60_000;
    expect(minutes).toBeGreaterThanOrEqual(20); expect(minutes).toBeLessThan(26); // 20 minutes, rounded up to the next 5
    expect((p.$("#qk-time") as any).value).toMatch(/[0-5][05]$/);
  });
});

describe("Step 2 of a game in the console (B01, B02)", () => {
  test("a new game (12 s, 1 card, automatic, name only) hides the four choices; an older game with 9 s, 2 cards and tap keeps seeing them", async () => {
    const o = await organizer();
    expect((await make(o, "NEW-ONE")).status).toBe(200);
    expect((await make(o, "OLD-NINE", { callSeconds: 9, tickets: 2, mark: "tap" })).status).toBe(200);
    const fresh = await page(o, "/zc?e=NEW-ONE"); await fresh.waitFor((x) => /Hello/.test(x)); fresh.click('.zc-dot[data-open="2"]');
    await until(() => !!fresh.$('[data-ck="spd"]'));
    for (const k of ["tix", "mk", "spd"]) expect([k, hiddenIn(fresh, `[data-ck="${k}"]`)]).toEqual([k, true]);
    expect(fresh.$('[data-ck="spd"][data-v="9"]')).toBeNull();
    const old = await page(o, "/zc?e=OLD-NINE"); await old.waitFor((x) => /Hello/.test(x)); old.click('.zc-dot[data-open="2"]');
    await until(() => !!old.$('[data-ck="spd"]'));
    for (const k of ["tix", "mk", "spd"]) expect([k, hiddenIn(old, `[data-ck="${k}"]`)]).toEqual([k, false]);
    expect((old.$('[data-ck="spd"][data-v="9"]') as any).getAttribute("aria-pressed")).toBe("true"); // its own value is still there and still chosen
  });
});

describe("B07: a big game says before it is bought that it cannot be paused", () => {
  test("the size chips above the Pause limit say 'no Pause'; the price list says it; the limit in the page is the one in control.ts", async () => {
    const o = await organizer(); const p = await page(o, "/zc?quick=1");
    await p.waitFor((x) => /1\. Which game\?/.test(x) && /Up to 250 people/.test(x));
    const chip = (n: number) => String((p.$(`[data-ck="cap"][data-v="${n}"]`) as any)?.textContent ?? "");
    expect(chip(1000)).not.toMatch(/no Pause/); expect(chip(2500)).toMatch(/no Pause/); expect(chip(5000)).toMatch(/no Pause/); expect(chip(10000)).toMatch(/no Pause/);
    const PUB = join(import.meta.dir, "../public");
    expect(readFileSync(join(PUB, "pricing.html"), "utf8")).toMatch(/more than 2,000 players cannot be paused/);
    expect(Number(/const PAUSE_MAX = (\d+);/.exec(readFileSync(join(PUB, "zc.js"), "utf8"))![1])).toBe(PAUSE_MAX_PARTICIPANTS);
  });
});
