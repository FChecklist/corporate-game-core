// The Corporate Games bar: every PUBLIC page loads gamesbar.js (not the play, console, pay or report pages); the bar lists every game, Bingo is marked as the current one.
// The files themselves are pinned to the canonical copy in brand-site.test.ts.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";

const pub = (f: string) => readFileSync(new URL("../public/" + f, import.meta.url), "utf8");
const PUBLIC = ["index", "how-it-works", "guide", "brochure", "about", "contact", "legal", "terms", "refund-policy", "dpa", "subprocessors", "partner", "partner-terms", "helpdesk", "pricing", "privacy", "legal-position", "404"];
const WORK_PAGES = ["z", "zc", "big", "preview", "pay", "paylink", "paytest", "report", "signin", "demo", "owner-visits", "ai-link"];
const GAMES: [string, string][] = [["tambola", "https://housie.corporatetambola.com/"], ["bingo", "https://bingo.corporatetambola.com/"], ["tictactoe", "https://tictactoe.corporatetambola.com/"], ["snakes", "https://snakes.corporatetambola.com/"], ["luck", "https://luck.corporatetambola.com/"], ["draw", "https://home.corporatetambola.com/contact"]];

const load = (w: any) => new Function("window", "document", "location", "String", "Array", "Object", "Math", "Date", "JSON", "RegExp", "Number", "Error", "URL", "setTimeout", "clearTimeout", pub("gamesbar.js"))
  .call(w, w, w.document, w.location, String, Array, Object, Math, Date, JSON, RegExp, Number, Error, URL, setTimeout, clearTimeout); // the page's script, run inside the fake window (it needs the usual built-ins)
describe("the Corporate Games bar", () => {
  test("every public page loads it, no play / console / pay page does, and the build ships it", () => {
    for (const p of PUBLIC) expect([p, /<script src="\/gamesbar\.js\?v=\d+" defer><\/script>/.test(pub(p + ".html"))]).toEqual([p, true]);
    for (const p of WORK_PAGES) expect([p, pub(p + ".html").includes("gamesbar")]).toEqual([p, false]);
    const b = readFileSync(new URL("../../../pages/build.mjs", import.meta.url), "utf8"); expect(b).toContain('"gamesbar.js"'); expect(b).toContain('"gamesbar.css"');
  });
  test("the bar sits right after the skip link, lists the six games and the home mark, and marks Bingo as the current game", () => {
    const w = new Window({ url: "https://bingo.corporatetambola.com/" }); const d = w.document;
    d.head.innerHTML = ""; d.body.innerHTML = '<a class="ck-skip" href="#main">Skip to the content</a><main id="main">page</main>';
    load(w);
    const bar = d.querySelector(".cgb")!; expect(bar).toBeTruthy();
    expect((d.body.firstElementChild as any).className).toBe("ck-skip"); const prev = bar.previousElementSibling as any; expect(prev === d.body.firstElementChild || prev?.previousElementSibling === d.body.firstElementChild).toBe(true); /* only the hidden icon sheet may sit between the skip link and the bar */
    const links = [...bar.querySelectorAll("a[data-game]")] as any[];
    expect([...new Map(links.map((a) => [a.getAttribute("data-game"), a.href])).entries()]).toEqual(GAMES);
    const cur = [...bar.querySelectorAll("[aria-current]")] as any[]; expect(cur.length).toBeGreaterThan(0);
    for (const a of cur) expect(a.getAttribute("data-game")).toBe("bingo");
    expect(cur.some((a) => a.getAttribute("aria-current") === "page")).toBe(true);
    expect(bar.textContent).toContain("Corporate"); expect([...bar.querySelectorAll("a")].some((a: any) => a.href === "https://home.corporatetambola.com/")).toBe(true);
    load(w); expect(d.querySelectorAll(".cgb").length).toBe(1); // loading it twice adds nothing
    expect(d.head.querySelector('link[href^="/gamesbar.css"]')).toBeTruthy();
    const css = pub("gamesbar.css"); expect(css).toContain(":focus-visible");
  });
  test("it never says the banned word and never links the old hub", () => {
    const banned = new RegExp(["pri", "vate"].join(""), "i");
    for (const f of ["gamesbar.js", "gamesbar.css"]) { expect(banned.test(pub(f))).toBe(false); expect(pub(f)).not.toContain("games.corporatetambola.com"); }
  });
});
