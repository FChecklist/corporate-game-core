// The game log (B26, gap plan 2026-10-29; the same idea as Corporate Tic Tac Toe's gamelog.ts): one plain line for each thing that happened in a game (the start, every number's call
// time, every pause and restart, every prize, the end), with the time, the CARD NUMBER of a winner (never a name or a mobile number) and a proof code that chains each line to the one
// before it, so a line cannot be removed or changed afterwards without the codes after it no longer fitting.
// It is written ONCE, by the scheduled job, as soon as the game is over and before the report is built, so it exists whether or not an e-mail could be sent. It holds no personal data,
// so it is kept as long as the game's winners record (until 00:00 IST at the end of the 365th day after the game) and goes with the rest of the game then. Organizer, Host and Co-host can read it.
// The numbers themselves are not copied here: each call line names the PUBLIC round it was worked out from, and anyone can recompute the number from that public round.
import { callRoundR } from "../../../packages/beacon/src/game";
import { GRACE_ROUNDS, PRIZE_HOUSES } from "../../../packages/beacon/src/config";
import type { ControlState } from "../../../packages/beacon/src/control";
import { DEFAULT_TZ, zoneFull } from "./tz";
import type { D1, Env } from "./worker";

export const GAME_LOG_SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS game_log (eid TEXT NOT NULL, seq INTEGER NOT NULL, at_ms INTEGER NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, proof TEXT NOT NULL, PRIMARY KEY (eid, seq))`,
];
const ready = new WeakSet<object>(); // one check per database connection
export async function ensureGameLog(db: D1): Promise<void> {
  if (ready.has(db as object)) return;
  for (const s of GAME_LOG_SCHEMA) await db.prepare(s).run();
  ready.add(db as object);
}

const GENESIS = 1692803367;
const roundMs = (r: number) => (GENESIS + (r - 1) * 3) * 1000;
const NAMES: Record<string, string> = Object.fromEntries(PRIZE_HOUSES.map((h) => [h.id, h.label]));
const ord = (n: number) => ["", "1st", "2nd", "3rd"][n] ?? `${n}th`;
const sha12 = async (s: string): Promise<string> => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 12);

export interface LogEvent { at: number; kind: string; text: string }
export interface LogInput {
  id: string; tz?: string; startRound: number; callSeconds: number; rounds: number;
  st: Pick<ControlState, "intervals" | "stopRound"> | null; breaks: unknown[];
  endMs: number; endSrc: string; winners: { round: number; pattern: string; ordinal: number; seat: number; idx: number | null }[];
  lines: Record<string, number>; // prize lines per house (to say "2nd Line" only when there are several)
}
const ORDER = ["start", "restart", "call", "win", "pause", "stop", "end"];

/** The events of a finished game, in time order. Pure: no database, no clock. */
export function gameLogEvents(g: LogInput): LogEvent[] {
  const tz = g.tz ?? DEFAULT_TZ, T = (ms: number) => zoneFull(ms, tz);
  const start = g.startRound + GRACE_ROUNDS, stride = g.callSeconds / 3;
  const ev: LogEvent[] = [];
  ev.push({ at: roundMs(g.startRound), kind: "start", text: `Game ${g.id}: first number due at ${T(roundMs(start))}. A number every ${g.callSeconds} seconds${g.rounds > 1 ? `, ${g.rounds} rounds` : ""}.` });
  const lastCallAt = new Map<number, number>(), counts = new Map<number, number>();
  for (let r = 1; r <= g.rounds; r++) {
    for (let k = 0; k < 75; k++) {
      const br = callRoundR(g.st as any, start, stride, g.breaks as any, r, k);
      if (br === null || roundMs(br) > g.endMs) continue;
      ev.push({ at: roundMs(br), kind: "call", text: `Call ${k + 1}${g.rounds > 1 ? ` of round ${r}` : ""} at ${T(roundMs(br))}: the number is worked out from public round ${br}.` });
      counts.set(r, k + 1); lastCallAt.set(r, roundMs(br));
    }
  }
  for (const i of g.st?.intervals ?? []) {
    if (roundMs(i.start) > g.endMs) continue;
    ev.push({ at: roundMs(i.start), kind: "pause", text: `Paused by the organizer at ${T(roundMs(i.start))}. No number is called while the game is paused.` });
    if (roundMs(i.end) <= g.endMs) ev.push({ at: roundMs(i.end), kind: "restart", text: `Play restarted at ${T(roundMs(i.end))}.` });
  }
  const stopped = g.st?.stopRound !== null && g.st?.stopRound !== undefined && roundMs(g.st.stopRound) <= g.endMs + 60_000;
  if (stopped) ev.push({ at: roundMs(g.st!.stopRound!), kind: "stop", text: `The organizer ended the game at ${T(roundMs(g.st!.stopRound!))}.` });
  for (const w of g.winners) {
    const br = w.idx === null ? null : callRoundR(g.st as any, start, stride, g.breaks as any, w.round, w.idx);
    const at = br === null ? g.endMs : roundMs(br);
    const name = ((g.lines[w.pattern] ?? 1) > 1 ? ord(w.ordinal) + " " : "") + (NAMES[w.pattern] ?? w.pattern);
    ev.push({ at, kind: "win", text: `${name} was won by card ${w.seat}${w.idx === null ? "" : ` on call ${w.idx + 1}${g.rounds > 1 ? ` of round ${w.round}` : ""}`}${br === null ? "" : ` (${T(at)})`}.` });
  }
  const lastRound = Math.max(1, ...[...counts.keys()]), made = counts.get(lastRound) ?? 0;
  const allCalled = g.rounds === [...counts.values()].filter((n) => n >= 75).length;
  const why = stopped ? `The game was ended by the organizer after ${made} numbers.` : allCalled ? "All 75 numbers were called." : `All prizes were awarded after ${made} numbers.`;
  ev.push({ at: g.endMs, kind: "end", text: `${why} The game ended at ${T(g.endMs)}.` });
  return ev.map((e, i) => ({ e, i })).sort((a, b) => a.e.at - b.e.at || ORDER.indexOf(a.e.kind) - ORDER.indexOf(b.e.kind) || a.i - b.i).map((x) => x.e);
}

/** Writes the log of one finished game, once (a second call does nothing). Never throws into the caller: a log is a help, never a reason to stop the lifecycle. Returns the number of lines written. */
export async function writeGameLog(env: Env, input: LogInput, now: number): Promise<number> {
  try {
    await ensureGameLog(env.DB);
    if (await env.DB.prepare("SELECT 1 AS x FROM game_log WHERE eid=? LIMIT 1").bind(input.id).first()) return 0;
    const events = gameLogEvents(input);
    let prev = "start", seq = 0;
    const stmts = [];
    for (const e of events) {
      seq++; const proof = await sha12(`${prev}|${input.id}|${seq}|${e.at}|${e.kind}|${e.text}`); prev = proof;
      stmts.push(env.DB.prepare("INSERT OR IGNORE INTO game_log(eid,seq,at_ms,kind,text,proof) VALUES(?,?,?,?,?,?)").bind(input.id, seq, e.at, e.kind, e.text, proof));
    }
    for (let i = 0; i < stmts.length; i += 90) await env.DB.batch(stmts.slice(i, i + 90));
    return stmts.length;
  } catch { return 0; }
}

export interface LogLine { seq: number; at: number; time: string; kind: string; text: string; proof: string }
export async function readGameLog(env: Env, eid: string, tz: string = DEFAULT_TZ): Promise<LogLine[]> {
  await ensureGameLog(env.DB);
  const rows = (await env.DB.prepare("SELECT seq, at_ms, kind, text, proof FROM game_log WHERE eid=? ORDER BY seq LIMIT 2000").bind(eid).all<{ seq: number; at_ms: number; kind: string; text: string; proof: string }>()).results ?? [];
  return rows.map((r) => ({ seq: r.seq, at: r.at_ms, time: zoneFull(r.at_ms, tz), kind: r.kind, text: r.text, proof: r.proof }));
}
const csvCell = (v: unknown): string => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export function gameLogCsv(lines: LogLine[]): string {
  return "﻿" + ["Line,Time,What,Proof", ...lines.map((l) => [l.seq, l.time, l.text, l.proof].map(csvCell).join(","))].join("\r\n") + "\r\n";
}
/** Checks the chain of a log read from the start: true when no line was removed or changed. */
export async function gameLogChainHolds(eid: string, lines: LogLine[]): Promise<boolean> {
  let prev = "start";
  for (const l of lines) { const p = await sha12(`${prev}|${eid}|${l.seq}|${l.at}|${l.kind}|${l.text}`); if (p !== l.proof) return false; prev = l.proof; }
  return true;
}
