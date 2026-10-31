import { newClock, start, pause, type Clock } from "../../packages/core/src";
import type { Board as SnakeBoard } from "../../packages/snakes/src";
export const running = (): Clock => start(newClock());
export const paused = (): Clock => pause(running(), "host", 1);
/** A sound 100-square board built from the Snakes book (rules 1-5): 6 snakes, 6 ladders. */
export const goodBoard = (): SnakeBoard => ({
  size: 100,
  ladders: { 3: 15, 9: 30, 22: 45, 35: 60, 50: 75, 62: 85 },
  snakes: { 97: 65, 90: 70, 80: 52, 68: 40, 55: 38, 44: 25 },
});
/** A board with no snakes and no ladders (for moving rules). */
export const emptyBoard = (size = 100): SnakeBoard => ({ size, snakes: {}, ladders: {} });
export const players = (n: number) => Array.from({ length: n }, (_, i) => "p" + (i + 1));
