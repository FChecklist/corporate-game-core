// Journey smoke test, streaming and resumable. One bun process, O(1) memory: each journey is decoded from its index, run, checked and dropped; only counts are kept.
//   bun tools/journey/run.ts --seed 1 --shard 0/8 --out out/s0.json [--budget-seconds 3600] [--heap-mb 400] [--resume]
//   bun tools/journey/run.ts --seed 1 --from 0 --to 1000000          exact index range [from,to) of the full space
//   bun tools/journey/run.ts --dry-run [--weights 3:1:3 --names partner,phone,cloud]     space size and the shard plan, runs nothing
//   bun tools/journey/run.ts --seed 1 --replay 12345                 one journey, printed with its violations
// Modes: --mode exhaustive (default; index k -> scrambled bijection of the whole space, so any range is spread over every dimension and ranges never overlap or miss)
//        --mode sample (uniform random by a seeded hash of k, repeats possible).
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { CATALOG, total } from "./catalog";
import { runJourney } from "./model";
import { mix } from "./rng";

const arg = (n: string, d = ""): string => { const i = process.argv.indexOf("--" + n); return i > 0 && !process.argv[i + 1]!.startsWith("--") ? process.argv[i + 1]! : d; };
const flag = (n: string): boolean => process.argv.includes("--" + n);
const seed = Number(arg("seed", "1")), mode = arg("mode", "exhaustive"), SPACE = Number(total().n);
const sizes = CATALOG.map((d) => d.values.length);
const gcd = (a: bigint, b: bigint): bigint => (b ? gcd(b, a % b) : a);
const MULT = 2_654_435_761n, N = BigInt(SPACE), OFFSET = BigInt(mix(seed, 7)) * 1_000_003n % N;
if (gcd(MULT, N) !== 1n) throw new Error("scramble multiplier is not coprime with the space");

/** Index k -> position in the space (a bijection), then mixed-radix decode, last dimension fastest. */
function indexOf(k: number): number {
  if (mode === "sample") return Number((BigInt(mix(seed, 2 * k)) * 4294967296n + BigInt(mix(seed, 2 * k + 1))) % N);
  return Number((BigInt(k) * MULT + OFFSET) % N);
}
function decode(pos: number): number[] { const row = new Array<number>(sizes.length); for (let i = sizes.length - 1; i >= 0; i--) { row[i] = pos % sizes[i]!; pos = Math.floor(pos / sizes[i]!); } return row; }
const journeyOf = (row: number[]): Record<string, string | number> => Object.fromEntries(CATALOG.map((d, i) => [d.name, d.values[row[i]!]!]));
const jseed = (k: number): number => mix(mix(seed, Math.floor(k / 4294967296)), k >>> 0);

// pairwise coverage bitmap: one bit per (dimension pair, value pair)
const pairBase: number[][] = []; let pairTotal = 0;
for (let a = 0; a < sizes.length; a++) { pairBase[a] = []; for (let b = a + 1; b < sizes.length; b++) { pairBase[a]![b] = pairTotal; pairTotal += sizes[a]! * sizes[b]!; } }

const weights = arg("weights", "1").split(":").map(Number), names = arg("names", "").split(",");
if (flag("dry-run")) {
  const sum = weights.reduce((a, b) => a + b, 0);
  console.log(`space: ${SPACE.toLocaleString("en-US")} journeys, ${CATALOG.length} dimensions, ${pairTotal} dimension-value pairs`);
  let from = 0;
  weights.forEach((w, i) => { const to = i === weights.length - 1 ? SPACE : from + Math.floor((SPACE * w) / sum); console.log(`${names[i] || "machine" + i}: weight ${w}  --from ${from} --to ${to}   (${(to - from).toLocaleString("en-US")} journeys)`); from = to; });
  console.log("note: speed is a few thousand journeys per second on one core, so the whole space is not finishable; ranges are for sampling the space in an exact, non-overlapping way. Use --budget-seconds.");
  process.exit(0);
}
if (flag("replay") || arg("replay")) {
  const k = Number(arg("replay")), row = decode(indexOf(k)), j = journeyOf(row), res = await runJourney(j, jseed(k));
  console.log(JSON.stringify(j)); console.log(res.violations.length ? res.violations.join("\n") : "no violation"); process.exit(res.violations.length ? 1 : 0);
}

let from = Number(arg("from", "0")), to = Number(arg("to", String(SPACE)));
const sh = arg("shard");
if (sh) { const [i, n] = sh.split("/").map(Number) as [number, number]; from = Math.floor((SPACE * i) / n); to = Math.floor((SPACE * (i + 1)) / n); }
const out = arg("out", `journey-${seed}-${from}-${to}.json`), ckpt = out + ".ckpt";
const budget = Number(arg("budget-seconds", "0")), heapMb = Number(arg("heap-mb", "0"));

interface Summary {
  seed: number; mode: string; from: number; to: number; doneTo: number; journeys: number; violations: number; seconds: number; stoppedBy: string;
  byInvariant: Record<string, { count: number; first: number[] }>; cells: number[][]; hits: Record<string, number>; pairs: string;
}
const fresh = (): Summary => ({ seed, mode, from, to, doneTo: from, journeys: 0, violations: 0, seconds: 0, stoppedBy: "", byInvariant: {}, cells: sizes.map((s) => new Array<number>(s).fill(0)), hits: {}, pairs: "" });
let S = fresh(); const pairs = new Uint8Array(pairTotal);
if (flag("resume") && existsSync(ckpt)) {
  const c = JSON.parse(readFileSync(ckpt, "utf8")) as Summary;
  if (c.seed !== seed || c.mode !== mode || c.from !== from || c.to !== to) { console.error("checkpoint is for a different run"); process.exit(2); }
  S = c; Buffer.from(c.pairs, "base64").forEach((v, i) => { pairs[i] = v; }); console.log(`resuming at ${S.doneTo}`);
}
const save = (file: string): void => {
  S.pairs = Buffer.from(pairs).toString("base64");
  mkdirSync(dirname(file) || ".", { recursive: true }); writeFileSync(file + ".tmp", JSON.stringify(S)); renameSync(file + ".tmp", file);
};
console.log(`shard [${from}, ${to}) of ${SPACE.toLocaleString("en-US")}, seed ${seed}, mode ${mode}, out ${out}`);
const t0 = Date.now(), prior = S.seconds; let lastSave = t0, stop = "";
for (let k = S.doneTo; k < to; k++) {
  const now = Date.now();
  if (now - lastSave > 30_000) { S.seconds = prior + (now - t0) / 1000; S.doneTo = k; save(ckpt); lastSave = now; console.log(`  ${k - from} done, ${S.violations} violations, ${Math.round(S.journeys / S.seconds)} journeys/s`); }
  if (budget && (now - t0) / 1000 >= budget) { stop = "budget"; S.doneTo = k; break; }
  if (heapMb && k % 1000 === 0 && process.memoryUsage().rss / 1048576 > heapMb) { stop = "memory"; S.doneTo = k; break; }
  const row = decode(indexOf(k)), res = await runJourney(journeyOf(row), jseed(k));
  S.journeys++;
  for (let a = 0; a < row.length; a++) { S.cells[a]![row[a]!]!++; for (let b = a + 1; b < row.length; b++) pairs[pairBase[a]![b]! + row[a]! * sizes[b]! + row[b]!] = 1; }
  for (const h of res.hit) S.hits[h] = (S.hits[h] ?? 0) + 1;
  if (res.violations.length) {
    S.violations++;
    for (const v of new Set(res.violations.map((x) => x.replace(/\d+(\.\d+)?/g, "#")))) {
      const e = (S.byInvariant[v] ??= { count: 0, first: [] }); e.count++; if (e.first.length < 20) e.first.push(k);
    }
  }
  S.doneTo = k + 1;
}
S.stoppedBy = stop || "finished"; S.seconds = prior + (Date.now() - t0) / 1000;
save(out); if (stop) save(ckpt); else if (existsSync(ckpt)) unlinkSync(ckpt); // a clean stop keeps the checkpoint so --resume continues
const covered = pairs.reduce((a, b) => a + b, 0);
console.log(`JOURNEYS: ${S.journeys} VIOLATIONS: ${S.violations} (range [${from}, ${S.doneTo}) of [${from}, ${to}), ${S.stoppedBy}, ${Math.round(S.journeys / Math.max(S.seconds, 0.001))} journeys/s, pairwise ${(100 * covered / pairTotal).toFixed(1)}%)`);
for (const [v, e] of Object.entries(S.byInvariant)) console.log(`  ${e.count} x ${v}   replay: ${e.first.slice(0, 3).map((k) => `bun tools/journey/run.ts --seed ${seed}${mode === "sample" ? " --mode sample" : ""} --replay ${k}`).join(" ; ")}`);
console.log(`summary: ${out}`);
process.exit(S.violations ? 1 : 0);
