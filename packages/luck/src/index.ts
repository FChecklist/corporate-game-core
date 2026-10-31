// Luck by Chance rules module (rules taken from the live site, docs/RULES.md R01-R33). See docs/LUCK_RULES_BOOK.md.
// Targets, dice and fate numbers are made by the host site from the game id and the public beacon values; they come in as inputs, the core never makes them.
import { MANIFESTS } from "@cgc/manifest";
import type { Outcome, RulesModule, SetupField } from "../../core/src";
export const DICE_PER_ROUND = 10, WINDOWS = [6, 10, 15], REVEAL_S = 3, BREAK_S = 20;
export interface Score { points: number; best: number; hits: number; lastHitAt: number; fate: number }
/** R05: a dice that shows the target scores that many points; anything else scores nothing. */
export const hit = (target: number, dice: number): number => (dice === target ? target : 0);
/** R15-R19: points, then the highest single hit, then the most hits, then who reached that score first (earlier dice round), then fate (lower wins). Always strict. */
export const rankOrder = (a: Score, b: Score): number => b.points - a.points || b.best - a.best || b.hits - a.hits || a.lastHitAt - b.lastHitAt || a.fate - b.fate;
export interface LuckState {
  rounds: number; diceIndex: number; scores: Record<string, Score>; roundScores: Record<string, Score>[]; over: boolean;
}
export type LuckEvent = { type: "dice"; target: number; dice: Record<string, number> } | { type: "tick" };
export const setupFields: SetupField[] = [
  { key: "rounds", label: "Rounds", kind: "number", default: 10, help: "1 to 20. Each round has 10 dice rounds." },
  { key: "window", label: "Seconds to press the dice", kind: "choice", choices: WINDOWS.map(String), default: 10 },
];
const fresh = (fate: number): Score => ({ points: 0, best: 0, hits: 0, lastHitAt: 0, fate });
export const luckRules: RulesModule<LuckState, LuckEvent> = {
  manifest: MANIFESTS.luck,
  setupFields,
  claimType: "auto",
  goldenButton: "You won",
  prizePositions: () => ["1st", "2nd", "3rd", "4th", "5th"],
  lateJoin: MANIFESTS.luck.lateJoin,
  init(setup, players) {
    const rounds = Math.floor(Number(setup.rounds ?? 10));
    if (!(rounds >= 1 && rounds <= 20)) throw new Error("a game has 1 to 20 rounds"); // R01
    if (players.length < 2) throw new Error("at least 2 players are needed"); // R34
    const fate = (setup.fate ?? {}) as Record<string, number>, scores: Record<string, Score> = {};
    for (const p of players) scores[p] = fresh(fate[p] ?? 0);
    return { rounds, diceIndex: 0, scores, roundScores: [clone(scores, true)], over: false };
  },
  step(s, e, _now, clock) {
    if (s.over || e.type !== "dice" || clock.phase === "paused") return { state: s, out: [] }; // R14: in order, none skipped
    if (!Number.isInteger(e.target) || e.target < 1 || e.target > 6) return { state: s, out: [] };
    const diceIndex = s.diceIndex + 1, scores = clone(s.scores), cur = clone(s.roundScores[s.roundScores.length - 1]!);
    for (const p of Object.keys(scores)) {
      const pts = hit(e.target, e.dice[p] ?? 0);
      if (!pts) continue;
      for (const sc of [scores[p]!, cur[p]!]) { sc.points += pts; sc.best = Math.max(sc.best, pts); sc.hits++; sc.lastHitAt = diceIndex; }
    }
    const roundScores = [...s.roundScores.slice(0, -1), cur], out: Outcome[] = [];
    const roundDone = diceIndex % DICE_PER_ROUND === 0, over = diceIndex >= s.rounds * DICE_PER_ROUND;
    if (roundDone && !over) { roundScores.push(clone(scores, true)); out.push({ kind: "round", n: diceIndex / DICE_PER_ROUND + 1, alive: Object.keys(scores).length }); }
    if (over) out.push(...overall(scores).slice(0, 5).map((p, i): Outcome => ({ kind: "win", player: p, position: ["1st", "2nd", "3rd", "4th", "5th"][i]! })), { kind: "end" });
    return { state: { ...s, diceIndex, scores, roundScores, over }, out };
  },
};
/** R20-R21: the strict overall order. */
export const overall = (scores: Record<string, Score>): string[] => Object.keys(scores).sort((a, b) => rankOrder(scores[a]!, scores[b]!));
function clone(m: Record<string, Score>, zero = false): Record<string, Score> {
  const o: Record<string, Score> = {};
  for (const [k, v] of Object.entries(m)) o[k] = zero ? fresh(v.fate) : { ...v };
  return o;
}
