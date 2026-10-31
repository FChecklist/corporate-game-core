// B14 on the screens: the console offers "Everyone is in one room" in step 2 and saves it; the big screen can say the numbers after one tap; a room game's phones start silent.
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { newWorld, openPage, roundAt, T, type Page } from "./harness";
import { PRIZE_HOUSES } from "../../../packages/beacon/src/config";

setDefaultTimeout(60_000);
const PUB = join(import.meta.dir, "../public");
let open: Page[] = [];
afterEach(async () => { for (const p of open) await p.close(); open = []; });

describe("console step 2", () => {
  test("the room choice is offered, saved with the game, and shown again when the game is opened", async () => {
    const w = newWorld(); const s = await w.json(await w.api("POST", "/api/start", { email: "boss@acme.com" }));
    expect((await w.api("POST", "/api/z", { id: "RM-1", startRound: roundAt(T) + 1200, callSeconds: 12, cap: 100 }, s.aiKey)).status).toBe(200);
    const afterLoad = (win: any, f: string) => { if (f === "zgame.js" && win.ZG && !win.ZG.PRIZE_HOUSES) win.ZG.PRIZE_HOUSES = PRIZE_HOUSES; };
    const mk = async () => { const p = await openPage(w.world, { url: "http://localhost/zc?e=RM-1", html: "zc.html", scripts: ["zgame.js", "control.js", "zc.js"], session: { "cbz-org": s.token, "cbz-aimsg": s.aiMessage, "cbz-email": "boss@acme.com" }, afterLoad }); open.push(p); return p; };
    const p = await mk(); await p.waitFor((x) => /Hello/.test(x)); p.click('.zc-dot[data-open="2"]');
    await p.waitFor((x) => /Where do your people play\?/.test(x), 8000);
    expect(p.text()).toMatch(/Every phone says the numbers out loud/);
    p.click('[data-bool="room"]'); expect(p.text()).toMatch(/Phones start with their sound off/);
    p.click('[data-save="2"]'); await p.waitFor((x) => /Saved\./.test(x), 8000);
    expect((await w.json(await w.api("GET", "/api/z/RM-1/info", undefined, s.aiKey))).roomMode).toBe(true);
    const q = await mk(); await q.waitFor((x) => /Hello/.test(x)); q.click('.zc-dot[data-open="2"]'); await q.waitFor((x) => /Phones start with their sound off/.test(x), 8000);
  });
});

describe("the big screen and the phone page", () => {
  const big = readFileSync(join(PUB, "big.js"), "utf8"), bigHtml = readFileSync(join(PUB, "big.html"), "utf8"), z = readFileSync(join(PUB, "z.js"), "utf8");
  test("the big screen loads the voice, has a button for it, asks for one tap in a room game, and speaks each new number only when switched on", () => {
    expect(bigHtml).toMatch(/<script src="\/audio\.js"><\/script><script src="\/zgame\.js">/);
    expect(big).toMatch(/id="bigvoice"/); expect(big).toMatch(/Tap once: this screen will say the numbers/);
    expect(big).toMatch(/if \(fresh && VOICE\.on && window\.TBAudio\)[^;]*;\s*TBAudio\.play\(last\)/);
    expect(big).toMatch(/info\.roomMode === true/);
  });
  test("a room game's phone starts with its sound off (unless the person chose), and says why", () => {
    expect(z).toMatch(/INFO\.quiet && store\.get\("cbz-sound"\) === null\) \{ sound = false/);
    expect(z).toMatch(/This game is played in one room\. The big screen says each number/);
  });
});
