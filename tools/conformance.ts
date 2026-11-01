// Conformance runner (spec 410 section 7): checks every game's manifest against the core rules. Run: bun tools/conformance.ts
// A game adds its rules module to MODULES to get the label/claimType agreement check too. Exit code 1 when anything fails.
import { GAME_IDS, MANIFESTS, checkManifest } from "../packages/manifest/src";
import { labelsAgree, type RulesModule } from "../packages/core/src";
import { bingoRules } from "../packages/bingo/src";
import { tttRules } from "../packages/tictactoe/src";
import { snakesRules } from "../packages/snakes/src";
import { luckRules } from "../packages/luck/src";
import { luckyDrawRules } from "../packages/luckydraw/src";
import { REACTIONS } from "../packages/ui/src";
import { guardOk } from "../packages/wording/src";
const MODULES: RulesModule<any, any>[] = [bingoRules, tttRules, snakesRules, luckRules, luckyDrawRules];
const problems: string[] = [];
for (const id of GAME_IDS) for (const p of checkManifest(MANIFESTS[id])) problems.push(`${id}: ${p}`);
for (const m of MODULES) for (const p of labelsAgree(m)) problems.push(`${m.manifest.id}: ${p}`);
// wording guard: no "erase" (any form) in customer text, rules books, docs or sources; the wording package must reject it
import * as W from "../packages/wording/src";
if (guardOk("Your data is erased")) problems.push("wording guard does not reject 'erase'");
// data and privacy sentences: third person, calm; the guard must reject first person and harsh words
for (const t of W.DATA_SENTENCES) if (!W.dataTextOk(t)) problems.push(`data sentence breaks the wording rule: ${t.slice(0, 60)}`);
for (const bad of ["We keep your data.", "Our team can see it.", "Your data is used by us.", "Your name and mobile number are optional.", "A breach is a risk."]) if (W.dataTextOk(bad)) problems.push(`data wording guard accepts: ${bad}`);
if (!/employee ID/.test(W.ID_ONLY_LINE) || !/e-mail/.test(W.ID_ONLY_LINE) || !/^A game can be played with only an employee ID or an e-mail\.$/.test(W.ID_ONLY_LINE)) problems.push("ID_ONLY_LINE must say a game needs only an employee ID or an e-mail");
if (!/optional/.test(W.DETAILS_LINE) || !/24 hours/.test(W.AUTO_DELETE_LINE) || !/auto-deleted/.test(W.AUTO_DELETE_LINE)) problems.push("name/mobile optional or 24 hour auto-delete sentence is missing");
const strings = (v: unknown): string[] => (typeof v === "string" ? [v] : v && typeof v === "object" && !(v instanceof RegExp) ? Object.values(v).flatMap(strings) : []);
for (const t of strings(W)) if (!guardOk(t)) problems.push(`wording text breaks the guard: ${t.slice(0, 60)}`);
for (const f of new Bun.Glob("{docs/*.md,packages/*/src/*.{ts,css}}").scanSync(".")) {
  const lines = (await Bun.file(f).text()).split("\n");
  lines.forEach((l, i) => { if (/\bera(se|sed|ses|sing|sure)\b/i.test(l) && !l.includes("BANNED_PLAYER_WORDS") && !l.includes('never appear in customer text')) problems.push(`${f}:${i + 1}: 'erase' wording (use auto-deleted or deleted)`); });
}
// common legal text: one text for home and every game; calm third person; the drift check must see a copy and must not flag clean text
import { renderLegal, renderRules } from "../packages/ui/src";
import { makeReporter, FUNNEL_EVENTS, cleanProps, firstPartyEndpoint } from "../packages/core/src";
if (W.NAVIGATION_LINE !== "Navigation data is collected to improve the games.") problems.push("navigation line changed");
for (const sec of W.LEGAL) for (const para of sec.paragraphs) if (!W.dataTextOk(para)) problems.push(`legal text breaks the wording rule (${sec.id}): ${para.slice(0, 50)}`);
if (W.LEGAL.map((x) => x.id).join() !== "privacy,terms,cookies,grievance") problems.push("legal sections must be privacy, terms, cookies, grievance");
if (W.findCopies("<p>" + W.LEGAL[0]!.paragraphs[4] + "</p>").length !== 1 || W.findCopies(renderLegal("terms")).join() !== "terms" || W.findCopies("just a page about bingo rules").length) problems.push("drift check does not tell a copy from clean text");
if (!renderLegal().includes('id="grievance"') || !renderRules(["# Rules", "1. First rule"].join(String.fromCharCode(10))).includes("<li>First rule</li>")) problems.push("legal or rules renderer output is wrong");
// funnel events: first party, no personal details, GPC respected
{
  const sent: string[] = [], mk = (nav: { globalPrivacyControl?: boolean }, endpoint = "/stats/e") => makeReporter({ endpoint, game: "bingo", nav, send: (_u, b) => { sent.push(b); } });
  if (FUNNEL_EVENTS.length !== 13) problems.push("funnel needs the 13 named events");
  if (!mk({}).report("viewed") || sent.length !== 1) problems.push("funnel reporter did not send");
  if (mk({ globalPrivacyControl: true }).report("viewed") || sent.length !== 1) problems.push("funnel reporter ignores Global Privacy Control");
  if (mk({}, "https://other.example/e").report("viewed") || mk({}, "//other.example/e").report("viewed") || sent.length !== 1) problems.push("funnel reporter sent to a host that is not first-party");
  const c = cleanProps({ game: "a@b.com", size: 250, mode: "auto", email: "x@y.z", name: "Asha", reason: "declined" });
  if (c.game !== undefined || c.size !== 250 || (c as Record<string, unknown>).email || (c as Record<string, unknown>).name) problems.push("funnel props let personal details through");
  if (!firstPartyEndpoint("/stats/e") || firstPartyEndpoint("http://x/y")) problems.push("firstPartyEndpoint is wrong");
}
const ids = new Set<string>();
for (const r of REACTIONS) {
  if (ids.has(r.id)) problems.push(`reaction ${r.id}: duplicate id`); ids.add(r.id);
  if (!guardOk(r.text) || /\b(fair|random|guarantee)/i.test(r.text)) problems.push(`reaction ${r.id}: banned or fairness wording`);
  if (r.text.length > 20 || r.ms < 2000 || r.ms > 3000 || !r.games.length) problems.push(`reaction ${r.id}: text over 20 characters, time outside 2-3 s, or no game`);
}
// corporate product: nothing rude; the words are ordinary English (only the design must be original); exactly 50 reactions of at most 4 words
for (const r of REACTIONS) if (/\b(wtf|damn|hell|crap|shit|fuck)\b/i.test(r.text + " " + r.id) || r.text.trim().split(/\s+/).length > 4) problems.push(`reaction ${r.id}: rude wording or more than 4 words`);
// the palette: ink on fill at least 4.5:1
const lum = (h: string): number => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!; };
const css = await Bun.file("packages/ui/src/reactions.css").text();
const pairs = [...css.matchAll(/\.rx\.p(\d)\{--rxb:(#[0-9A-Fa-f]{6});--rxi:(#[0-9A-Fa-f]{6})/g)];
if (pairs.length !== 8) problems.push(`palette has ${pairs.length} colour pairs, expected 8`);
for (const [, n, f, i] of pairs) { const [a, b] = [lum(f!), lum(i!)].sort((x, y) => y - x); if ((a! + 0.05) / (b! + 0.05) < 4.5) problems.push(`palette p${n}: ink on fill is below 4.5:1`); }
const shapes = new Set(REACTIONS.map((r) => r.shape)); if (shapes.size !== 8 || (css.match(/\.rx\.sh-/g) ?? []).length !== 8) problems.push("expected 8 shapes, each drawn in the CSS");
if (REACTIONS.length !== 50) problems.push(`reaction pack has ${REACTIONS.length} entries, expected exactly 50`);
// the one legal document and the no-checkbox notice (owner order, 1 Nov 2026)
import { renderDocument, renderNotice } from "../packages/ui/src";
import { sha256Hex as sha256 } from "../packages/core/src";
{
  const alone = (t: string): boolean => !/\b(we|our|ours|us)\b/i.test(t) && W.guardOk(t);
  if (W.DOC_SECTION_IDS.join() !== "terms,payments,privacy,retention,cookies,processors,grievance,acceptable-use,game-rules" || W.DOCUMENT.map((s) => s.id).join() !== W.DOC_SECTION_IDS.join()) problems.push("the document must have the nine sections in the owner order");
  if (W.DOC_GAMES.map((g) => g.id).sort().join() !== [...GAME_IDS].sort().join()) problems.push("Game rules must have one subsection per game of the manifests");
  const rules = W.DOCUMENT[8]!.subs;
  if (rules[0]!.id !== "common" || rules.slice(1).map((u) => u.id).join() !== W.DOC_GAMES.map((g) => g.id).join()) problems.push("Game rules: common first, then one subsection per game");
  if (W.DOC_URL !== "https://home.corporatetambola.com/terms") problems.push("the document has one address");
  for (const k of W.DOC_SECTION_IDS) if (W.DOC_URLS[k] !== `${W.DOC_URL}#${k}`) problems.push(`${k}: link must be the one address with the section anchor`);
  const html = renderDocument();
  for (const k of W.DOC_SECTION_IDS) if (!html.includes(`id="${k}"`) || !html.includes(`href="#${k}"`)) problems.push(`${k}: section or contents anchor missing`);
  if (!html.includes(`data-version="${W.TERMS_VERSION}"`) || !html.includes(W.TERMS_DATE) || html.indexOf('class="toc"') > html.indexOf('id="terms"')) problems.push("version, date and contents must come first");
  if (!/<h3>1\.1 /.test(html) || !/<h2>9\. /.test(html)) problems.push("headings must be numbered");
  for (const p of W.allDocParagraphs()) {
    if (!alone(p.text)) problems.push(`${p.section}: first person or banned word in: ${p.text.slice(0, 50)}`);
    if (["privacy", "retention", "cookies", "processors", "payments"].includes(p.section) && !W.NOTHING_KEPT_LINES.includes(p.text) && !W.dataTextOk(p.text)) problems.push(`${p.section}: data-text rule in: ${p.text.slice(0, 50)}`);
  }
  const priv = W.allDocParagraphs().filter((p) => ["privacy", "cookies"].includes(p.section)).map((p) => p.text).join(" ");
  for (const need of [W.NAVIGATION_LINE, W.AUTO_DELETE_LINE, W.ID_ONLY_LINE]) if (!priv.includes(need)) problems.push("Privacy and Data / Cookies lacks: " + need.slice(0, 40));
  if (!/within 3 hours/.test(priv) || !/Co-hosts do not/.test(priv) || /all data is e-mailed/i.test(priv)) problems.push("report wording is not true to the code (3 h, Organizer and Hosts only)");
  if (W.DOC_TITLES.privacy !== "Privacy and Data") problems.push("heading must be Privacy and Data");
  if (!W.findDocumentCopies(html).includes("terms") || W.findDocumentCopies("a page about bingo rules").length) problems.push("document drift check is wrong");
  for (const [path, k] of Object.entries(W.LEGACY_REDIRECTS)) if (!W.DOC_SECTION_IDS.includes(k as W.DocSectionId) || W.legacyTarget(path) !== `${W.DOC_URL}#${k}`) problems.push(`redirect ${path} does not reach a section of the document`);
  for (const need of ["/legal", "/privacy", "/refund-policy", "/cookies", "/retention", "/dpa", "/trust"]) if (!W.legacyTarget(need)) problems.push(`no redirect for ${need}`);
  // content rules (UPDATE 4): final text, each rule once, SaaS per game, only the citations already used by Corporate Tambola
  {
    const all = W.allDocParagraphs().map((q) => q.text);
    if (all.some((t) => /\b(draft|placeholder|to be confirmed|awaiting|pending approval|lawyer|chartered|owner will|TBD)\b/i.test(t))) problems.push("the published text must not mention drafts, approval or a lawyer");
    if (new Set(all).size !== all.length) problems.push("a paragraph is repeated in the document");
    const credit = W.allDocParagraphs().filter((q) => /as credit/.test(q.text)).map((q) => q.section);
    if (credit.some((c) => c !== "payments")) problems.push("the credit rule must be stated only in Payments and Credit");
    const del24 = W.allDocParagraphs().filter((q) => /within 24 hours/.test(q.text)).map((q) => q.section);
    if (del24.some((c) => c !== "privacy" && c !== "retention")) problems.push("the 24-hour deletion must be stated only in Privacy and Data and the retention table");
    const hay = all.join(" ") + " " + JSON.stringify(W.DOCUMENT.flatMap((u) => u.subs.map((v) => v.table ?? [])));
    for (const need of ["perpetual licence", "no subscription", "separate, one-time service", "limited to the fee paid", "keeps IT Services and Rajat Agarwal free", "courts in India have exclusive jurisdiction", "Arbitration and Conciliation Act, 1996", "Shreya Singhal v. Union of India, (2015) 5 SCC 1", "(2017) 10 SCC 1", "Income-tax Act, 2025", "Copyright Act, 1957", "software provider only", "fails or is cancelled", "beyond its control", "stopped"]) if (!hay.includes(need)) problems.push("the document lacks: " + need);
    const allowed = ["AIR 1957 SC 699", "AIR 1968 SC 825", "(1996) 2 SCC 226", "AIR 1959 SC 781", "(2017) 10 SCC 1", "(2015) 5 SCC 1"];
    for (const m of hay.match(/AIR \d{4} SC \d+|\(\d{4}\) \d+ SCC \d+/g) ?? []) if (!allowed.includes(m)) problems.push("a citation that Corporate Tambola does not use: " + m);
  }
  // no city, state or street address anywhere (owner order, 1 Nov 2026): only "India"
  {
    const place = /\b(ghaziabad|uttar pradesh|indirapuram|shipra|krishna vista|noida|delhi|mumbai|bengaluru|bangalore|chennai|kolkata|hyderabad|pune|gurugram|gurgaon|lucknow)\b|\b\d{6}\b|\bB-\d+/i;
    const shown = JSON.stringify([W.DOCUMENT, W.LEGAL, W.NOTICE_TEXT, W.SELLER, W.CONTACT_EMAIL, W.GRIEVANCE_EMAIL]);
    const m = place.exec(shown);
    if (m) problems.push("an address, city or state is in the shipped text: " + m[0]);
    if (!/The courts in India have exclusive jurisdiction/.test(shown)) problems.push("jurisdiction must read: the courts in India");
  }
  // owner position (1 Nov 2026): the provider takes no consent, does not decide who plays and says nothing on age or gambling status
  {
    const shown = JSON.stringify([W.DOCUMENT, W.LEGAL, W.NOTICE_TEXT]);
    const m = /18 or older|under 18|adult|minor|gambl|lotter|money game|gaming-house|withdraws? consent|taking consent|take consent/i.exec(shown);
    if (m) problems.push("the shipped text must not speak of age, gambling status or taking consent: " + m[0]);
    if (!/chooses and invites the people who play/.test(shown)) problems.push("the Organizer must be the one who chooses and invites the people who play");
  }
  { const t = W.allDocParagraphs().map((q) => q.text); for (const l of W.NOTHING_KEPT_LINES) if (!t.includes(l)) problems.push("the document lacks: " + l); }
  // no checkbox anywhere; one gentle notice below the button; proof stored (version + sha256 + time)
  const notice = renderNotice();
  if (/<input|checkbox|type="check/i.test(notice + html)) problems.push("no checkbox may be rendered");
  if (W.NOTICE_TEXT !== "By continuing, you agree to the Terms and Conditions, Privacy and Data, and Game rules.") problems.push("notice line is not the owner's line");
  if (notice.replace(/<[^>]+>/g, "") !== W.NOTICE_TEXT) problems.push("notice must read exactly the notice line");
  if (W.NOTICE_LINKS.map((l) => l.href).join() !== ["terms", "privacy", "game-rules"].map((k) => W.DOC_URLS[k as W.DocSectionId]).join() || (notice.match(/<a /g) ?? []).length !== 3) problems.push("notice needs three links to the document sections");
  if (!/<table/.test(html) || (html.match(/<tr>/g) ?? []).length < 10) problems.push("the retention table is missing");
  if (!/within 7 days/.test(html) || !/hello@corporatetambola\.com/.test(html)) problems.push("grievance needs the contact and the 7-day answer");
  if (!/Cloudflare/.test(html) || !/Razorpay/.test(html)) problems.push("the companies that help must be listed");
  if (!alone(W.NOTICE_TEXT) || /\b(must|fail|illegal|warning|risk|penalt\w*|breach|liable)\b/i.test(W.NOTICE_TEXT)) problems.push("notice must be gentle");
  if ((W as Record<string, unknown>)["CONSENT"] || (W as Record<string, unknown>)["consentBoxes"]) problems.push("consent boxes K1-K6 must not exist");
  const h = sha256(W.NOTICE_TEXT), rec = W.recordAgreement("publish", h, 1_800_000_000_000);
  if (rec.version !== W.TERMS_VERSION || rec.textHash !== h || rec.at !== 1_800_000_000_000 || Object.keys(rec).sort().join() !== "at,point,textHash,version") problems.push("agreement proof must be exactly point, version, sha256 of the shown text and time");
  if (W.AGREEMENT_POINTS.join() !== "signin,publish,join" || !W.needsNewRecord("2026-10-30") || W.needsNewRecord(W.AGREEMENT_VERSION) || !W.needsNewRecord(null)) problems.push("agreement points or new-version rule is wrong");
}
console.log(problems.length ? problems.join("\n") : `conformance ok (${GAME_IDS.length} manifests, ${MODULES.length} rules modules)`);
process.exit(problems.length ? 1 : 0);
