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
// the four common documents and the one consent check (owner order, 1 Nov 2026)
import { renderDocument } from "../packages/ui/src";
{
  const alone = (t: string): boolean => !/(we|our|ours|us)/i.test(t) && W.guardOk(t);
  if (W.DOC_KINDS.join() !== "terms,privacy,disclaimer,policy") problems.push("documents are not exactly terms, privacy, disclaimer, policy");
  if (W.DOC_GAMES.map((g) => g.id).sort().join() !== [...GAME_IDS].sort().join()) problems.push("Part B must have one heading per game of the manifests");
  for (const k of W.DOC_KINDS) {
    const d = W.DOCUMENTS[k];
    if (W.DOC_URLS[k] !== `https://home.corporatetambola.com/${k}`) problems.push(`${k}: url is not the one home address`);
    for (const g of W.DOC_GAMES) if (!d.partB[g.id]?.length) problems.push(`${k}: Part B missing for ${g.id}`);
    const html = renderDocument(k);
    if (html.indexOf("part-a") > html.indexOf("part-b")) problems.push(`${k}: Part A must come first`);
    if (!html.includes(`data-version="${W.TERMS_VERSION}"`)) problems.push(`${k}: version missing`);
  }
  for (const p of W.allDocParagraphs()) {
    if (!alone(p.text)) problems.push(`${p.kind}: first person or banned word in: ${p.text.slice(0, 50)}`);
    if ((p.kind === "privacy" || p.kind === "policy") && !W.dataTextOk(p.text)) problems.push(`${p.kind}: data-text rule in: ${p.text.slice(0, 50)}`);
  }
  const priv = W.allDocParagraphs().filter((p) => p.kind === "privacy").map((p) => p.text).join(" ");
  for (const need of [W.NAVIGATION_LINE, W.AUTO_DELETE_LINE, W.ID_ONLY_LINE]) if (!priv.includes(need)) problems.push("Privacy and Data lacks: " + need.slice(0, 40));
  if (!/within 3 hours/.test(priv) || !/Co-hosts do not/.test(priv) || /all data is e-mailed/i.test(priv)) problems.push("report wording is not true to the code (3 h, Organizer and Hosts only)");
  if (!W.findDocumentCopies(renderDocument("terms")).includes("terms") || W.findDocumentCopies("a page about bingo rules").length) problems.push("document drift check is wrong");
  if (W.DOC_TITLES.privacy !== "Privacy and Data") problems.push("heading must be Privacy and Data");
  // consent: one block, same order for every game, only an optional extra line, one version
  for (const k of W.CONSENT_KINDS) {
    const common = W.consentBoxes(k).map((b) => b.id).join();
    for (const g of W.DOC_GAMES) { const ids = W.consentBoxes(k, g.id).map((b) => b.id).join(); if (ids !== common && ids !== common + ",X") problems.push(`consent ${k}: ${g.id} changes the common boxes`); }
    for (const b of W.consentBoxes(k)) if (!alone(b.text) || /(names?|mobiles?|phones?|numbers?)/i.test(b.text)) problems.push(`consent ${k}${b.id}: wording rule`);
    if (W.consentComplete(k, { v: W.CONSENT_VERSION, boxes: W.consentBoxes(k).map((b) => b.id) }) !== true || W.consentComplete(k, { v: "2020-01-01", boxes: W.consentBoxes(k).map((b) => b.id) }) || W.consentComplete(k, null)) problems.push(`consent ${k}: server check is wrong`);
  }
  if (W.CONSENT_VERSION !== W.TERMS_VERSION || !W.needsRetick("2026-10-30") || W.needsRetick(W.CONSENT_VERSION) || !W.needsRetick(null)) problems.push("consent version or re-tick rule is wrong");
  if (!W.consentWording("K3").includes("365 days") || !W.consentWording("K4").includes("auto-deleted within 24 hours")) problems.push("consent text is not true to the policy");
}
console.log(problems.length ? problems.join("\n") : `conformance ok (${GAME_IDS.length} manifests, ${MODULES.length} rules modules)`);
process.exit(problems.length ? 1 : 0);
