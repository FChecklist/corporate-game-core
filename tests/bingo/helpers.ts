import { newClock, start, pause, resume, type Clock } from "../../packages/core/src";
import { bingoRules, columnOf, type BingoState, type Card, type House } from "../../packages/bingo/src";
export { newClock, start, pause, resume };
export const ORDER = Array.from({ length: 75 }, (_, i) => i + 1);
export const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
export function shuffle<T>(a: T[], r: () => number): T[] {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [b[i], b[j]] = [b[j]!, b[i]!]; }
  return b;
}
/** A valid card built from the book's rules (rule 1-2), independent of the product. */
export function makeCard(r: () => number): Card {
  const cols = [0, 1, 2, 3, 4].map((c) => shuffle(Array.from({ length: 15 }, (_, i) => c * 15 + i + 1), r).slice(0, c === 2 ? 4 : 5));
  return [0, 1, 2, 3, 4].map((row) => [0, 1, 2, 3, 4].map((c) => (c === 2 ? (row === 2 ? null : cols[2]![row < 2 ? row : row - 1]!) : cols[c]![row]!)));
}
/** Card whose cell (row, col) holds a known number: column c row r = c*15 + r + 1 (N skips the centre). */
export const plainCard = (): Card => [0, 1, 2, 3, 4].map((r) => [0, 1, 2, 3, 4].map((c) => (c === 2 && r === 2 ? null : c * 15 + r + 1)));
export const cells = (t: Card, idx: number[]) => idx.map((i) => t.flat()[i]).filter((v): v is number => v != null);
/** An order that calls `first` numbers first, then the rest ascending. */
export const orderWith = (first: number[]) => [...first, ...ORDER.filter((n) => !first.includes(n))];
export interface G { s: BingoState; clock: Clock; t: number; out: any[] }
export function newGame(cards: Record<string, Card>, o: { order?: number[]; houses?: Record<string, number>; gap?: number } = {}): G {
  const players = Object.keys(cards);
  const setup: any = { order: o.order ?? ORDER, cards, gapSeconds: o.gap ?? 9 };
  setup.housesCount = o.houses ?? { line: 1, corners: 1, x: 1, blackout: 1 };
  const clock = start(newClock());
  return { s: bingoRules.init(setup, players, 0), clock, t: 0, out: [] };
}
export function ev(g: G, e: any) { const r = bingoRules.step(g.s, e, g.t, g.clock); g.s = r.state; g.out.push(...r.out); return r; }
/** Advance to the next call time and tick once. */
export function callNext(g: G) { g.t = Math.max(g.t, g.s.nextCallAt + (g.clock.pausedMs ?? 0)); return ev(g, { type: "tick" }); }
export function callN(g: G, n: number) { while (g.s.called < n && !g.s.over) callNext(g); }
export const claim = (g: G, player: string, house: House, fate = 0) => ev(g, { type: "claim", player, house, fate });
export const wins = (g: G) => g.out.filter((o) => o.kind === "win");
export { columnOf };
