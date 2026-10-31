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
const ids = new Set<string>();
for (const r of REACTIONS) {
  if (ids.has(r.id)) problems.push(`reaction ${r.id}: duplicate id`); ids.add(r.id);
  if (!guardOk(r.text) || /(fair|random|guarantee)/i.test(r.text)) problems.push(`reaction ${r.id}: banned or fairness wording`);
  if (r.text.length > 20 || r.ms < 600 || r.ms > 1500 || !r.games.length) problems.push(`reaction ${r.id}: text over 20 characters, time outside 0.6-1.5 s, or no game`);
}
if (REACTIONS.length < 45 || REACTIONS.length > 60) problems.push(`reaction pack has ${REACTIONS.length} entries, expected about 50`);
console.log(problems.length ? problems.join("\n") : `conformance ok (${GAME_IDS.length} manifests, ${MODULES.length} rules modules)`);
process.exit(problems.length ? 1 : 0);
