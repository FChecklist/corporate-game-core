// The free demo game: a short, fully preloaded game that runs on the phone page with NO server game behind it.
// It is the real game (same ticket, same number-drawing, same break, same winner check); only the numbers are scripted so a prospective organizer
// sees every part in about 70 seconds: 3 numbers, a 15-second break (their sample video), 3 numbers, and Four corners completed on the 6th number.
// How the script was made: one fixed ticket (seat 1 of the engagement "DEMO"); the 6 numbers are 4 corners and 2 other ticket numbers in an order
// that finishes the corners on the 6th call; DEMO_RAND are the "public random" values that make pickNumber() return exactly those numbers.
// If the ticket generator ever changes again, regenerate the three constants with `bun tools/make-demo-script.ts` (done on 2026-10-10 when the generator was fixed to spread numbers evenly).
// A test (packages/beacon/test/demo-script.test.ts) re-derives everything with the real functions, so this cannot drift from the game.
import type { EngagementCfg } from "./config";

export const DEMO_EID = "DEMO";
export const DEMO_PID = "1xd3d3d3d3d3d3";
export const DEMO_CALL_SECONDS = 9;
export const DEMO_BREAK_AFTER = 3;
export const DEMO_BREAK_SECONDS = 15;
export const DEMO_SEQ = [7, 12, 75, 11, 24, 65] as const;
export const DEMO_CORNERS = [7, 75, 11, 65] as const;
export const DEMO_RAND: readonly string[] = [
  "dedf0d0036000000000000000000000000000000000000000000000000000000",
  "dedf1d0007000000000000000000000000000000000000000000000000000000",
  "dedf2d0002000000000000000000000000000000000000000000000000000000",
  "dedf3d0030000000000000000000000000000000000000000000000000000000",
  "dedf4d0024000000000000000000000000000000000000000000000000000000",
  "dedf5d002a000000000000000000000000000000000000000000000000000000",
];
export const DEMO_STRIDE = DEMO_CALL_SECONDS / 3; // beacon rounds between two numbers
/** The beacon round in which call `k` (0-based) happens when the first number is in round `first`: the break pushes the later calls later. */
export const demoRoundOf = (first: number, k: number): number => first + k * DEMO_STRIDE + (k >= DEMO_BREAK_AFTER ? DEMO_BREAK_SECONDS / 3 : 0);
/** The scripted "public randomness" of beacon round `r`, or null for a round that carries no scripted number. */
export const demoRandomnessFor = (first: number, r: number): string | null => { for (let k = 0; k < DEMO_RAND.length; k++) if (demoRoundOf(first, k) === r) return DEMO_RAND[k]!; return null; };
/** Seconds from the first number to the end of the demo: the last scripted number plus a few seconds for the result and the Hurray. */
export const DEMO_PLAY_SECONDS = (DEMO_RAND.length - 1) * DEMO_CALL_SECONDS + DEMO_BREAK_SECONDS;
/** The settings of the demo game. The break shows a short message from the host; if the owner sets a YouTube link in demo-config.js, that video plays instead. */
export function demoCfg(videoUrl?: string): EngagementCfg {
  const yt = /^https:\/\/((www|m|music)\.)?(youtube\.com|youtu\.be)\//i.test(videoUrl || "");
  return {
    tickets: 1, rounds: 1, opening: [], closing: [],
    rewards: [{ pattern: "corners", scope: "ticket", ordinal: 1, text: "Demo prize: Four corners" }],
    breaks: [{ after: DEMO_BREAK_AFTER, seconds: DEMO_BREAK_SECONDS, kind: yt ? "youtube" : "speech", title: yt ? "A short video from your host" : "A short message from your host appears here", ...(yt ? { mediaUrl: videoUrl } : {}) }],
  };
}
