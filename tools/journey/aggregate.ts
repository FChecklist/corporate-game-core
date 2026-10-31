// Merge shard summaries into one report: bun tools/journey/aggregate.ts out/*.json
import { readFileSync } from "node:fs";
import { CATALOG, total } from "./catalog";
const files = process.argv.slice(2).filter((f) => !f.startsWith("--") && !f.endsWith(".ckpt"));
if (!files.length) { console.log("usage: bun tools/journey/aggregate.ts <summary.json...>"); process.exit(2); }
const sizes = CATALOG.map((d) => d.values.length);
let pairTotal = 0; for (let a = 0; a < sizes.length; a++) for (let b = a + 1; b < sizes.length; b++) pairTotal += sizes[a]! * sizes[b]!;
const pairs = new Uint8Array(pairTotal), cells = sizes.map((s) => new Array<number>(s).fill(0)), by: Record<string, { count: number; first: number[] }> = {}, hits: Record<string, number> = {};
let journeys = 0, violations = 0, seconds = 0; const ranges: [number, number][] = []; const seeds = new Set<string>();
for (const f of files) {
  const s = JSON.parse(readFileSync(f, "utf8")) as { seed: number; mode: string; from: number; doneTo: number; journeys: number; violations: number; seconds: number; cells: number[][]; hits: Record<string, number>; pairs: string; byInvariant: typeof by };
  journeys += s.journeys; violations += s.violations; seconds += s.seconds; ranges.push([s.from, s.doneTo]); seeds.add(`${s.seed}/${s.mode}`);
  s.cells.forEach((row, a) => row.forEach((n, v) => { cells[a]![v]! += n; }));
  for (const [h, n] of Object.entries(s.hits)) hits[h] = (hits[h] ?? 0) + n;
  Buffer.from(s.pairs, "base64").forEach((v, i) => { if (v) pairs[i] = 1; });
  for (const [k, e] of Object.entries(s.byInvariant)) { const t = (by[k] ??= { count: 0, first: [] }); t.count += e.count; for (const x of e.first) if (t.first.length < 20) t.first.push(x); }
}
ranges.sort((a, b) => a[0] - b[0]);
const overlaps = ranges.filter((r, i) => i && r[0] < ranges[i - 1]![1]).length;
const space = Number(total().n), done = ranges.reduce((a, r) => a + (r[1] - r[0]), 0);
console.log(`files: ${files.length}  seed/mode: ${[...seeds].join(", ")}${seeds.size > 1 ? "  (WARNING: mixed seeds, ranges are not comparable)" : ""}`);
console.log(`JOURNEYS: ${journeys} VIOLATIONS: ${violations}   of the space ${space.toLocaleString("en-US")} (${(100 * done / space).toExponential(2)} %), ${(seconds / 3600).toFixed(2)} machine-hours`);
if (overlaps) console.log(`WARNING: ${overlaps} overlapping range(s): journeys counted twice`);
console.log(`pairwise coverage: ${(100 * pairs.reduce((a, b) => a + b, 0) / pairTotal).toFixed(2)} % of ${pairTotal} dimension-value pairs`);
const empty = CATALOG.flatMap((d, a) => d.values.map((v, i) => (cells[a]![i] ? null : `${d.name}=${v}`))).filter(Boolean);
console.log(`catalog cells hit: ${cells.flat().filter((n) => n).length}/${cells.flat().length}${empty.length ? "  missing: " + empty.join(", ") : ""}`);
console.log("violations by invariant:" + (Object.keys(by).length ? "" : " none"));
for (const [k, e] of Object.entries(by)) console.log(`  ${e.count} x ${k}  first indexes: ${e.first.slice(0, 20).join(",")}`);
console.log("outcomes: " + Object.entries(hits).sort().map(([k, v]) => `${k}=${v}`).join(" "));
process.exit(violations ? 1 : 0);
