// mulberry32: a seeded generator so every journey replays from "seed:index".
export interface Rng { next(): number; int(n: number): number; chance(p: number): boolean; pick<T>(a: readonly T[]): T; shuffle<T>(a: T[]): T[] }
export function rng(seed: number): Rng {
  let s = seed >>> 0;
  const next = (): number => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const int = (n: number): number => Math.floor(next() * n);
  return { next, int, chance: (p) => next() < p, pick: (a) => a[int(a.length)]!, shuffle: (a) => { for (let i = a.length - 1; i > 0; i--) { const k = int(i + 1); [a[i], a[k]] = [a[k]!, a[i]!]; } return a; } };
}
export const mix = (seed: number, k: number): number => (Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(k + 1, 0xc2b2ae35)) >>> 0;
