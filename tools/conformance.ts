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
const strings = (v: unknown): string[] => (typeof v === "string" ? [v] : v && typeof v === "object" && !(v instanceof RegExp) ? Object.values(v).flatMap(strings) : []);
for (const t of strings(W)) if (!guardOk(t)) problems.push(`wording text breaks the guard: ${t.slice(0, 60)}`);
for (const f of new Bun.Glob("{docs/*.md,packages/*/src/*.{ts,css}}").scanSync(".")) {
  const lines = (await Bun.file(f).text()).split("\n");
  lines.forEach((l, i) => { if (/\bera(se|sed|ses|sing|sure)\b/i.test(l) && !l.includes("BANNED_PLAYER_WORDS") && !l.includes('never appear in customer text')) problems.push(`${f}:${i + 1}: 'erase' wording (use auto-deleted or deleted)`); });
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
console.log(problems.length ? problems.join("\n") : `conformance ok (${GAME_IDS.length} manifests, ${MODULES.length} rules modules)`);
process.exit(problems.length ? 1 : 0);
