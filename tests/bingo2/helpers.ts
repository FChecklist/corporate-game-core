// Helpers for the Bingo rules-book tests. The tie fate is recomputed here with node:crypto, never with the product code.
import { createHash } from "node:crypto";
import type { Card } from "../../packages/bingo/src";
import type { Clock } from "../../packages/core/src";

/** A valid card: column c holds 5 numbers from its range, starting `shift` into the range (N holds 4, FREE in the middle). */
export function mkCard(shift: number): Card {
  const val = (c: number, i: number) => c * 15 + 1 + ((shift + i) % 15);
  return [0, 1, 2, 3, 4].map((r) => [0, 1, 2, 3, 4].map((c) => (c === 2 && r === 2 ? null : val(c, c === 2 && r > 2 ? r - 1 : r))));
}
export const flatNums = (card: Card, cells: number[]): number[] => cells.map((i) => card.flat()[i]).filter((n): n is number => n != null);
export const rowOf = (card: Card, r: number): number[] => flatNums(card, [0, 1, 2, 3, 4].map((c) => r * 5 + c));
/** A full 75-number order: `first` in the given order, then the rest ascending. */
export function orderWith(first: number[]): number[] {
  first = [...new Set(first)]; const seen = new Set(first);
  return [...first, ...Array.from({ length: 75 }, (_, i) => i + 1).filter((n) => !seen.has(n))];
}
export const sha = (s: string): string => createHash("sha256").update(s).digest("hex");
export const fate = (eid: string, seat: string | number, house: string, ordinal: number): string => sha(`CB1-TIE|${eid}|${seat}|tie|${house}|${ordinal}`);
/** Independent tie-break: seats tied on one call take the open lines in turn, lowest fate first for each line. */
export function expectedTie(eid: string, seats: { id: string; key: string | number }[], house: string, ordinals: number[]): Record<number, string> {
  const left = [...seats], out: Record<number, string> = {};
  for (const o of ordinals) {
    if (!left.length) break;
    left.sort((a, b) => { const fa = fate(eid, a.key, house, o), fb = fate(eid, b.key, house, o); return fa < fb ? -1 : fa > fb ? 1 : 0; });
    out[o] = left.shift()!.id;
  }
  return out;
}
export const RUNNING: Clock = { phase: "running", frozenAt: null, pausedMs: 0, pauses: [] };
/** Play a game to its end with ticks at each due time. Returns the wins as line -> {player, call} and the final state. */
export function play(rules: any, setup: Record<string, unknown>, players: string[], opts: { claims?: boolean; maxTicks?: number } = {}) {
  let s = rules.init(setup, players, 0);
  const wins: Record<string, { player: string; call: number }> = {}; let ends = 0, endCall = -1, t = 0;
  for (let n = 0; n < (opts.maxTicks ?? 400) && !s.over; n++) {
    t = s.nextCallAt;
    const evs: any[] = opts.claims ? [{ type: "claim", player: players[0], house: "line", fate: 0 }, { type: "tick" }] : [{ type: "tick" }];
    for (const e of evs) {
      const r = rules.step(s, e, t, RUNNING); s = r.state;
      for (const o of r.out) { if (o.kind === "win") wins[o.position] = { player: o.player, call: s.called }; if (o.kind === "end") { ends++; endCall = s.called; } }
    }
  }
  return { state: s, wins, ends, endCall };
}
/** `first`, then every number NOT on `card`, then the card's other numbers: no other pattern completes by accident. */
export const orderOffCard = (first: number[], card: Card): number[] => {
  const on = new Set(card.flat().filter((n): n is number => n != null));
  return orderWith([...first, ...Array.from({ length: 75 }, (_, i) => i + 1).filter((n) => !on.has(n))]);
};
