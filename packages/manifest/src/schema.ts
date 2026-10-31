// The per-game manifest (spec 410 sections 2-5). The master console reads it; labels choose which shared pieces load. Labels are internal and never shown to customers.
export type GameId = "tambola" | "bingo" | "tictactoe" | "snakes" | "luck" | "luckydraw";
export type Label = "Claim" | "Elimination" | "Lucky Draw" | "Team";
export type StartMode = "auto" | "manual";
/** Tambola and Bingo have 4 play modes (who calls x when it starts); the other games have "start only". */
export type PlayMode = "auto-called" | "host-called" | "start-only";
export type PrizeMode = "auto" | "manual";
export type GoldenLabel = "Claim" | "You won";
export type LateJoin = { kind: "until-end" } | { kind: "none-after-round-1"; windowSeconds?: number } | { kind: "until-draw" };
export interface Caps { auto: number; manual?: number }
export interface Manifest {
  id: GameId;
  title: string;
  labels: Label[];
  caps: Caps;
  startModes: StartMode[];
  playModes: PlayMode[];
  goldenButton: GoldenLabel;
  prizeModes: PrizeMode[];
  rehearsalMax: number;
  lateJoin: LateJoin;
  /** Organizer keeps the final say on prizes after the game (Tambola + Bingo only). */
  organizerFinalSay: boolean;
}
/** Problems with a manifest, in plain words; [] when it is sound. */
export function checkManifest(m: Manifest): string[] {
  const bad: string[] = [];
  if (!m.labels.length) bad.push("labels[] is empty");
  if (!m.startModes.length || !m.playModes.length || !m.prizeModes.length) bad.push("start, play and prize modes need at least one entry");
  if (m.caps.auto < 1) bad.push("auto cap must be positive");
  if (m.caps.manual && m.caps.manual > m.caps.auto) bad.push("manual cap is above the auto cap");
  const claim = m.labels.includes("Claim");
  if (claim !== (m.goldenButton === "Claim")) bad.push("golden button 'Claim' goes with the Claim label only");
  if (claim !== m.organizerFinalSay) bad.push("organizer final say goes with the Claim label only");
  if (![10, 20].includes(m.rehearsalMax)) bad.push("rehearsal max is 20 (Tambola, Bingo) or 10");
  return bad;
}
