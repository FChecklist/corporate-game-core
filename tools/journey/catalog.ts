// The variable catalog of a journey: home page -> master console -> game site -> report PDF -> all participant data deleted.
// Each dimension is a list of values; the number of journeys is the product of the list lengths (see docs/JOURNEY_MODEL.md).
export interface Dim { name: string; values: (string | number)[] }
const bool = (name: string): Dim => ({ name, values: ["off", "on"] });
export const CATALOG: Dim[] = [
  { name: "route", values: ["home", "games-bar", "console", "direct-game", "invite", "personal", "qr"] },
  { name: "game", values: ["tambola", "bingo", "tictactoe", "snakes", "luck", "luckydraw"] },
  { name: "ident", values: ["emp", "email", "open"] },
  { name: "details", values: ["none", "name", "mobile", "both"] },
  { name: "roster", values: [0, 1, 2, 3, 5, 50, 500, 2000, 100000] },
  { name: "hosts", values: [0, 1, 2, 3, 4, 5] },
  { name: "cohosts", values: [0, 1, 5, 100] },
  { name: "payment", values: ["free", "paid", "failed-then-paid", "abandoned", "link-copied", "link-opened-by-payer"] },
  { name: "publish", values: ["draft", "published", "published-then-edited"] },
  { name: "schedule", values: ["now", "later", "rescheduled", "cancelled-before-publish"] },
  { name: "start", values: ["auto", "manual"] },
  { name: "late", values: ["none", "late-in-waiting-room"] },
  { name: "pause", values: ["none", "once", "many"] },
  bool("f.closeGroup"), bool("f.family"), bool("f.reactions"), bool("f.manualPrizes"), bool("f.brand"), bool("f.rehearsal"),
  { name: "width", values: [320, 375, 768, 1280, 1920] },
  { name: "network", values: ["ok", "drop-rejoin", "drop-long"] },
  { name: "mail", values: ["delivered", "bounce-ok-24h", "bounce-ok-36h", "bounce-ok-72h", "bounce-all"] },
  { name: "earlyDelete", values: ["no", "organizer-deletes"] },
  { name: "gpc", values: ["off", "on"] },
  { name: "funnelProps", values: ["clean", "email-in-game", "digits-in-game", "extra-fields"] },
];
export type Journey = Record<string, string | number>;
/** Exact count as a BigInt, and the arithmetic as text. */
export function total(): { n: bigint; text: string } {
  const sizes = CATALOG.map((d) => d.values.length);
  return { n: sizes.reduce((a, b) => a * BigInt(b), 1n), text: sizes.join(" x ") };
}
