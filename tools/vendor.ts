// Vendored-copy script: a game pins an EXACT core version by copying packages/*/src into its own repo (games are separate Cloudflare repos).
// Run from the core clone:  bun tools/vendor.ts <path-to-game-repo> [--expect 0.1.0]
// It copies to <game>/vendor/game-core/packages/<pkg>/src (the same layout as this repo, so the plain relative imports between packages keep working), writes <game>/vendor/game-core/CORE_VERSION (version + commit) and refuses when --expect differs from VERSION.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, resolve } from "node:path";
const root = resolve(import.meta.dir, "..");
const [target, flag, expect] = process.argv.slice(2);
if (!target) { console.error("usage: bun tools/vendor.ts <game-repo> [--expect X.Y.Z]"); process.exit(1); }
const version = readFileSync(join(root, "VERSION"), "utf8").trim();
if (flag === "--expect" && expect !== version) { console.error(`core is ${version}, game expects ${expect}`); process.exit(1); }
const commit = execSync("git rev-parse HEAD", { cwd: root }).toString().trim();
const dest = join(resolve(target), "vendor", "game-core");
if (existsSync(dest)) rmSync(dest, { recursive: true });
mkdirSync(dest, { recursive: true });
for (const p of ["core", "ui", "wording", "manifest", "bingo", "tictactoe", "snakes", "luck", "luckydraw"]) cpSync(join(root, "packages", p, "src"), join(dest, "packages", p, "src"), { recursive: true });
cpSync(join(root, "tsconfig.json"), join(dest, "tsconfig.json"));
writeFileSync(join(dest, "CORE_VERSION"), `${version}\n${commit}\n`);
console.log(`vendored game-core ${version} (${commit.slice(0, 7)}) into ${dest}`);
