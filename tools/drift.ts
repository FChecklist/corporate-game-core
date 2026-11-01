// Drift check: fails if a site carries its own copy of the common Privacy / Terms / storage / grievance text.
// Run from the core clone: bun tools/drift.ts <site-repo> [<site-repo> ...]. Looks in every .html .htm .ts .tsx .js .jsx .json .md .txt file, except node_modules, .git and vendor/game-core.
import { findCopies, findDocumentCopies } from "../packages/wording/src";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
const EXT = /\.(html?|tsx?|jsx?|json|md|txt)$/i, SKIP = /(^|[\\/])(node_modules|\.git|\.claude|vendor[\\/]game-core|dist|build)([\\/]|$)/;
const walk = (d: string, out: string[] = [], root = d): string[] => {
  for (const e of readdirSync(d)) { const p = join(d, e); if (SKIP.test(p.slice(root.length))) continue; const s = statSync(p); if (s.isDirectory()) walk(p, out, root); else if (EXT.test(e) && s.size < 2_000_000) out.push(p); }
  return out;
};
let bad = 0;
for (const repo of process.argv.slice(2)) {
  for (const f of walk(repo)) { const txt = readFileSync(f, "utf8"), k = [...findCopies(txt), ...findDocumentCopies(txt)]; if (k.length) { bad++; console.log(`DRIFT ${f}: own copy of the common text (${k.join(", ")}); use renderLegal() from the core`); } }
}
console.log(bad ? `${bad} file(s) carry their own copy` : "no drift");
process.exit(bad ? 1 : 0);
