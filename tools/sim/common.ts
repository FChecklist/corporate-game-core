// Shared helpers for the simulation harness (tools/sim). Test tooling only: nothing here is product code.
import { createHash } from "node:crypto";
export type Rng = () => number;
/** mulberry32 from a 32-bit seed. */
export const mulberry = (seed: number): Rng => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), seed | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
export const sha = (s: string): string => createHash("sha256").update(s).digest("hex");
/** The seed of game `i` of run `seed`: games are independent, so one index can be replayed alone with --from. */
export const gameSeed = (seed: number, i: number): number => parseInt(sha(`sim|${seed}|${i}`).slice(0, 8), 16);
export const int = (r: Rng, lo: number, hi: number): number => lo + Math.floor(r() * (hi - lo + 1)); // inclusive
export const pick = <T,>(r: Rng, a: readonly T[]): T => a[Math.floor(r() * a.length)]!;
export const shuffle = <T,>(r: Rng, a: T[]): T[] => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!]; } return a; };
const EDGE = [2, 3, 5, 6, 7], POW2 = [2, 4, 8, 16, 32, 64, 128, 256, 512, 1024];
/** Player count 2..2000: edge counts, powers of two, odd numbers, 2000/1999, and a log-uniform spread (small games are common, big ones still happen). */
export function playerCount(r: Rng): number {
  const k = r();
  if (k < 0.2) return pick(r, EDGE);
  if (k < 0.35) return pick(r, POW2);
  if (k < 0.4) return pick(r, [1999, 2000, 1000, 1001, 1023, 1025]);
  if (k < 0.6) return int(r, 1, 999) * 2 + 1; // odd
  return Math.min(2000, Math.max(2, Math.round(Math.exp(r() * Math.log(2000)))));
}
/** Unique fate numbers: a random permutation of distinct integers. */
export function fates(r: Rng, ids: string[]): Record<string, number> {
  const nums = shuffle(r, ids.map((_, i) => i + 1)), out: Record<string, number> = {};
  ids.forEach((p, i) => { out[p] = nums[i]!; });
  return out;
}
export const players = (n: number): string[] => Array.from({ length: n }, (_, i) => `P${i}`);
/** True when any number inside v is NaN or infinite where a finite number is expected (Infinity is allowed only under keys in `allowInf`). */
export function badNumber(v: unknown, allowInf: readonly string[] = [], key = ""): string | null {
  if (typeof v === "number") return Number.isNaN(v) || (!Number.isFinite(v) && !allowInf.includes(key)) ? `${key}=${v}` : null;
  if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { const b = badNumber(x, allowInf, k); if (b) return `${key ? key + "." : ""}${b}`; }
  return null;
}
export interface Ctx { v(msg: string): void; players: number }
export interface Args { games: number; seed: number; from: number }
export function parseArgs(argv: string[]): Args {
  const a: Args = { games: 100000, seed: 1, from: 0 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], n = Number(argv[i + 1]);
    if (k === "--games" || k === "--seed" || k === "--from") { if (!Number.isFinite(n)) { console.error(`${k} needs a number`); process.exit(2); } if (k === "--games") a.games = n; else if (k === "--seed") a.seed = n; else a.from = n; i++; }
  }
  return a;
}
/**
 * Run `games` games. `play(rng, ctx)` plays one complete game, reports violations with ctx.v(), sets ctx.players, and returns a string that stands for its whole output
 * (it is hashed). Every 1000th game is played a second time from the same seed and the two hashes must match. The last line is COMBINATIONS (games x players) and VIOLATIONS.
 */
export function run(name: string, file: string, play: (r: Rng, c: Ctx) => string, after?: (v: (msg: string) => void) => void): void {
  const a = parseArgs(process.argv.slice(2)), found: string[] = [], kinds = new Map<string, { n: number; first: string }>();
  let combos = 0, k = 0;
  const t0 = performance.now();
  for (let i = a.from; i < a.from + a.games; i++) {
    const gs = gameSeed(a.seed, i), tag = `game ${i}`;
    const once = (): { out: string; players: number } => {
      const ctx: Ctx = { players: 0, v(msg) { k++; const kind = msg.replace(/[A-Za-z]*\d[\w.:,-]*/g, "#").slice(0, 90), e = kinds.get(kind); if (e) e.n++; else kinds.set(kind, { n: 1, first: `${tag}, seed ${a.seed}` }); if (found.length < 20) found.push(`${tag} (${ctx.players} players): ${msg}\n    reproduce: bun ${file} --games 1 --seed ${a.seed} --from ${i}`); } };
      let out = "";
      try { out = play(mulberry(gs), ctx); } catch (e) { ctx.v(`exception: ${(e as Error).stack?.split("\n").slice(0, 3).join(" | ")}`); }
      return { out: sha(out), players: ctx.players };
    };
    const g = once(); combos += g.players;
    if (i % 1000 === 0) { const g2 = once(); if (g2.out !== g.out) { k++; if (found.length < 20) found.push(`${tag}: not deterministic, same seed gave different output\n    reproduce: bun ${file} --games 1 --seed ${a.seed} --from ${i}`); } }
    if (a.games >= 20 && (i - a.from + 1) % Math.ceil(a.games / 10) === 0) console.error(`  ${name}: ${i - a.from + 1}/${a.games} games, ${k} violations, ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  }
  after?.((msg) => { k++; if (found.length < 20) found.push(`whole run: ${msg}\n    reproduce: bun ${file} --games ${a.games} --seed ${a.seed} --from ${a.from}`); kinds.set(msg.slice(0, 60), { n: 1, first: `whole run, seed ${a.seed}` }); });
  const secs = (performance.now() - t0) / 1000;
  console.log(`${name}: ${a.games} games in ${secs.toFixed(1)} s (${((secs / a.games) * 1000).toFixed(3)} ms per game), seed ${a.seed}`);
  if (found.length) { console.log(`First ${found.length} violation(s):`); for (const f of found) console.log("  " + f); }
  if (kinds.size) { console.log("Kinds of violation (digits and ids blanked): count, first game"); for (const [m, e] of [...kinds].sort((x, y) => y[1].n - x[1].n)) console.log(`  ${String(e.n).padStart(6)}  ${m}  [${e.first}]`); }
  console.log(`COMBINATIONS: ${combos} VIOLATIONS: ${k}`);
  process.exit(k > 0 ? 1 : 0);
}
/** Late join, checked against the book's rule (independent of canJoinLate): returns what the book says. */
export function lateJoinExpected(rule: { kind: string; windowSeconds?: number }, c: { round: number; over: boolean; msSinceRound1End: number; now: number; closeAt?: number }): boolean {
  if (c.over) return false;
  if (rule.kind === "until-end") return true;
  if (rule.kind === "until-draw") return c.closeAt !== undefined && c.now < c.closeAt;
  return c.round <= 1 || c.msSinceRound1End <= (rule.windowSeconds ?? 0) * 1000;
}
