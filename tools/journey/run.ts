// Journey smoke test (model level). bun tools/journey/run.ts --seed 1 --journeys 2000 [--shard i/N] [--replay SEED:INDEX] [--coverage]
// Journeys 0..P-1 are a pairwise covering array over all dimensions, the next T are a 3-wise array over the core dimensions, the rest are uniform random draws.
// Journey k is fully determined by (seed, k), so shards (k % N == i) can run on different machines and any violation replays alone.
import { CATALOG, total, type Journey } from "./catalog";
import { runJourney } from "./model";
import { mix, rng, type Rng } from "./rng";

const arg = (n: string, d: string): string => { const i = process.argv.indexOf("--" + n); return i > 0 ? process.argv[i + 1]! : d; };
const seed = Number(arg("seed", "1")), count = Number(arg("journeys", "2000")), [si, sn] = arg("shard", "0/1").split("/").map(Number) as [number, number], replay = arg("replay", "");
const CORE = ["route", "game", "ident", "details", "roster", "payment", "schedule", "mail"];

const rowKey = (row: number[], dims: number[], n: number): string[] => {
  const keys: string[] = [];
  const rec = (from: number, picked: number[]): void => {
    if (picked.length === n) { keys.push(picked.map((p) => `${dims[p]}=${row[dims[p]!]}`).join("&")); return; }
    for (let a = from; a < dims.length; a++) rec(a + 1, [...picked, a]);
  };
  rec(0, []); return keys;
};
/** Greedy covering array of strength n over the given dimensions (others random). */
function cover(n: 2 | 3, dims: number[], r: Rng): number[][] {
  const need = new Set<string>();
  const addAll = (from: number, picked: number[]): void => {
    if (picked.length === n) { const rec = (i: number, acc: string[]): void => { if (i === picked.length) { need.add(acc.join("&")); return; } for (let v = 0; v < CATALOG[dims[picked[i]!]!]!.values.length; v++) rec(i + 1, [...acc, `${dims[picked[i]!]}=${v}`]); }; rec(0, []); return; }
    for (let a = from; a < dims.length; a++) addAll(a + 1, [...picked, a]);
  };
  addAll(0, []);
  const rows: number[][] = [];
  const randomRow = (): number[] => CATALOG.map((d) => r.int(d.values.length));
  while (need.size) {
    let best: number[] = [], bestScore = -1;
    for (let c = 0; c < 40; c++) {
      const row = randomRow(); if (c === 0 && need.size) { const k = [...need][r.int(need.size)]!; for (const part of k.split("&")) { const [d, v] = part.split("="); row[Number(d)] = Number(v); } }
      const score = rowKey(row, dims, n).filter((k) => need.has(k)).length;
      if (score > bestScore) { best = row; bestScore = score; }
    }
    for (const k of rowKey(best, dims, n)) need.delete(k);
    rows.push(best);
  }
  return rows;
}
const toJourney = (row: number[]): Journey => Object.fromEntries(CATALOG.map((d, i) => [d.name, d.values[row[i]!]!]));
const plan = (): number[][] => {
  const r = rng(mix(seed, 0xc0ffee));
  return [...cover(2, CATALOG.map((_, i) => i), r), ...cover(3, CORE.map((n) => CATALOG.findIndex((d) => d.name === n)), r)];
};
const fixed = plan();
const journeyAt = (k: number): Journey => { if (k < fixed.length) return toJourney(fixed[k]!); const r = rng(mix(seed, k)); return toJourney(CATALOG.map((d) => r.int(d.values.length))); };

const { n, text } = total();
console.log(`catalog: ${CATALOG.length} dimensions, ${text} = ${n.toLocaleString("en-US")} combinations; covering rows: ${fixed.length} (pairwise + 3-wise on ${CORE.join(",")})`);
if (replay) {
  const [s, k] = replay.split(":").map(Number) as [number, number];
  if (s !== seed) { console.log(`replay uses seed ${s}: run with --seed ${s} --replay ${replay}`); process.exit(2); }
  const j = journeyAt(k), res = await runJourney(j, mix(seed, k));
  console.log(JSON.stringify(j)); console.log(res.violations.length ? res.violations.join("\n") : "no violation"); process.exit(res.violations.length ? 1 : 0);
}
let run = 0, viol = 0, steps = 0;
const bad: { id: string; v: string[] }[] = [], hits = new Map<string, number>(), cells = new Map<string, Set<number>>(CATALOG.map((d) => [d.name, new Set<number>()]));
for (let k = 0; k < count; k++) {
  if (k % sn !== si) continue;
  const j = journeyAt(k), res = await runJourney(j, mix(seed, k));
  run++; steps += res.steps;
  CATALOG.forEach((d) => cells.get(d.name)!.add(d.values.indexOf(j[d.name]!)));
  for (const h of res.hit) hits.set(h, (hits.get(h) ?? 0) + 1);
  if (res.violations.length) { viol++; if (bad.length < 20) bad.push({ id: `${seed}:${k}`, v: res.violations.slice(0, 3) }); }
}
console.log(`JOURNEYS: ${run} VIOLATIONS: ${viol} (checks after ${steps} steps, shard ${si}/${sn}, seed ${seed})`);
for (const b of bad) console.log(`  replay: bun tools/journey/run.ts --seed ${seed} --replay ${b.id}   ${b.v.join(" | ")}`);
if (process.argv.includes("--coverage") || true) {
  const full = CATALOG.filter((d) => cells.get(d.name)!.size === d.values.length).length;
  console.log(`COVERAGE: ${full}/${CATALOG.length} dimensions have every value hit`);
  for (const d of CATALOG) { const miss = d.values.filter((_, i) => !cells.get(d.name)!.has(i)); if (miss.length) console.log(`  ${d.name}: not hit ${miss.join(", ")}`); }
  console.log("  outcomes: " + [...hits].sort().map(([k, v]) => `${k}=${v}`).join(" "));
}
process.exit(viol ? 1 : 0);
