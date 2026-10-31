// Corporate Lucky Draw: the game itself. Everything else (accounts, payment, people, rehearsal, retention, helpdesk) is the shared platform.
// A Lucky Draw is an engagement whose joining IS registering (one seat per person) and whose start time IS the draw time. The rules come only from the common
// engine (vendor/game-core packages/luckydraw): entries go in with registerMany in batches, the draw happens on the beacon value, anybody holding the entries and the value gets the same winners.
// Fairness, only as far as the code proves it: same entries + same public beacon value = same winners. That the beacon value cannot be chosen or predicted comes from the public beacon, not from this code.
import { luckyDrawRules, prizePlaces, DRAW_CAP, type DrawState } from "../../../vendor/game-core/packages/luckydraw/src";
import { newClock, start as startClock, type Role } from "../../../vendor/game-core/packages/core/src";
import { fetchRound, roundAt } from "../../../packages/beacon/src/index";
import { openPii, type PiiEnv } from "./pii";
import { recordWinners, roundMs } from "./lifecycle";
import { sendMail, type PayEnv } from "./pay";
import { teamEmails } from "./cancel";
import type { D1, Env } from "./worker";

export const DRAW_SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS draw (eid TEXT PRIMARY KEY, winners INTEGER NOT NULL, prizes TEXT NOT NULL, mode TEXT NOT NULL, ref TEXT NOT NULL, set_ms INTEGER NOT NULL, closing_ms INTEGER, drawn_ms INTEGER, round INTEGER, beacon TEXT, result TEXT, by_role TEXT, entries INTEGER)`,
];
export const MAX_WINNERS = 1000;
export const NO_PERSONAL_LINE = "No personal details needed. All participant information is deleted within 24 hours of the game.";
export const DRAW_FAIRNESS = "Same entries and the same public beacon value always give the same winners. The beacon value is published by a public beacon (drand) and nobody can choose or predict it.";

export interface DrawRow { eid: string; winners: number; prizes: string; mode: "auto" | "manual"; ref: string; set_ms: number; closing_ms: number | null; drawn_ms: number | null; round: number | null; beacon: string | null; result: string | null; by_role: string | null; entries: number | null }
export const drawRow = (db: D1, eid: string) => db.prepare("SELECT * FROM draw WHERE eid=?").bind(eid).first<DrawRow>();
const cleanPrize = (s: unknown): string => (typeof s === "string" ? s.replace(/[<>`]/g, "").replace(/\s+/g, " ").trim().slice(0, 80) : "");

/** The Organizer's draw settings: how many winners, the prize for each place, automatic or manual. Returns the plain reason when something is wrong. */
export function checkDrawSettings(b: any, cap: number, rehearsal: boolean): { ok: true; winners: number; prizes: string[]; mode: "auto" | "manual"; ref: string } | { ok: false; error: string } {
  const winners = b?.winners === undefined ? 1 : b.winners;
  if (!Number.isInteger(winners) || winners < 1) return { ok: false, error: "Pick how many winners there are: a whole number, 1 or more." };
  if (winners > MAX_WINNERS) return { ok: false, error: `A draw can have up to ${MAX_WINNERS} winners.` };
  if (winners > cap) return { ok: false, error: "There cannot be more winners than the number of people you allow." };
  const mode = b?.mode === "manual" ? "manual" : b?.mode === undefined || b?.mode === "auto" ? "auto" : null;
  if (!mode) return { ok: false, error: "The draw is automatic (at the time you publish) or manual (you press Draw)." };
  const raw: unknown[] = Array.isArray(b?.prizes) ? b.prizes : typeof b?.prizes === "string" ? b.prizes.split(",") : [];
  const prizes = rehearsal ? [] : raw.map(cleanPrize).slice(0, winners);
  if (!rehearsal && raw.length > winners) return { ok: false, error: "There are more prizes than winners. Add winners or remove a prize." };
  return { ok: true, winners, prizes, mode, ref: "0" };
}
export async function saveDrawSettings(db: D1, eid: string, s: { winners: number; prizes: string[]; mode: "auto" | "manual"; ref: string }, now: number): Promise<void> {
  await db.prepare("INSERT INTO draw(eid,winners,prizes,mode,ref,set_ms) VALUES(?,?,?,?,?,?) ON CONFLICT(eid) DO UPDATE SET winners=excluded.winners, prizes=excluded.prizes, mode=excluded.mode, ref=excluded.ref, set_ms=excluded.set_ms WHERE draw.drawn_ms IS NULL AND draw.closing_ms IS NULL")
    .bind(eid, s.winners, JSON.stringify(s.prizes), s.mode, s.ref, now).run();
}

/** True when registering has closed: the draw time has come (automatic), Draw was pressed (manual) or the draw is done. A paused draw does not close. `drawMs` is the draw time on the game clock (pauses already added). */
export function registrationClosed(d: DrawRow | null, now: number, drawMs: number, paused: boolean): boolean {
  if (!d) return false;
  if (d.drawn_ms !== null || d.closing_ms !== null) return true;
  return d.mode === "auto" && !paused && now >= drawMs;
}

const mask = (name: string | null | undefined, emp: string | null | undefined, n: number): string => {
  const nm = (name ?? "").trim(), id = (emp ?? "").trim();
  if (nm) { const p = nm.split(" ").filter(Boolean); return (p.length > 1 ? `${p[0]} ${p[p.length - 1]![0]!.toUpperCase()}.` : p[0]!) + (id.length > 2 && !id.includes("@") ? ` (ID ends ${id.slice(-2)})` : ""); }
  if (id.length > 3 && !id.includes("@")) return `${id[0]}${"•".repeat(Math.min(4, id.length - 3))}${id.slice(-2)}`;
  if (id.includes("@")) { const [u, dom] = id.split("@"); return `${u![0]}•••@${dom}`; }
  return `Winner ${n}`;
};

/** What every screen shows: the settings, the state and (after the draw) the result. `pid` adds `mine` for that participant (the "You won" button). */
export async function drawFacts(env: Env & PiiEnv, e: any, now: number, t: { drawRound: number; paused: boolean }, pid?: string | null) {
  const d = await drawRow(env.DB, e.id);
  if (!d) return { draw: null };
  const drawMs = roundMs(t.drawRound);
  const prizes: string[] = JSON.parse(d.prizes || "[]");
  const closed = registrationClosed(d, now, drawMs, t.paused);
  const base = { winners: d.winners, mode: d.mode, prizes, drawMs, paused: t.paused, closed, drawn: d.drawn_ms !== null, drawnMs: d.drawn_ms, entries: d.entries, rehearsal: !!e.rehearsal_of, fairness: DRAW_FAIRNESS, privacy: NO_PERSONAL_LINE };
  if (d.drawn_ms === null) return { draw: base };
  const res: { pid: string; place: number }[] = JSON.parse(d.result || "[]");
  const places = prizePlaces(Math.max(d.winners, res.length));
  const list = [] as { place: string; prize: string; who: string }[];
  for (const r of res) {
    const row = await env.DB.prepare("SELECT pii FROM participant WHERE eid=? AND pid=?").bind(e.id, r.pid).first<{ pii: string | null }>();
    const p = await openPii(env, row?.pii ?? null);
    list.push({ place: places[r.place]!, prize: prizes[r.place] ?? "", who: mask(p?.name, p?.empId, r.place + 1) });
  }
  const mine = pid ? res.find((r) => r.pid === pid) : undefined;
  return { draw: { ...base, round: d.round, beacon: d.beacon, ref: d.ref, result: list, mine: mine ? { place: places[mine.place]!, prize: prizes[mine.place] ?? "" } : null } };
}

/** All entries of a draw, in batches (never one by one). The seat list is the entry list: one seat is one person; a removed seat is not an entry. */
async function entryPids(db: D1, eid: string): Promise<string[]> {
  const out: string[] = [];
  for (let off = 0; ; off += 5000) {
    const rows = (await db.prepare("SELECT pid FROM seat WHERE eid=? AND (blocked IS NULL OR blocked=0) AND (src IS NULL OR src<>'roster' OR dev IS NOT NULL) ORDER BY seq LIMIT 5000 OFFSET ?").bind(eid, off).all<{ pid: string }>()).results ?? [];
    for (const r of rows) out.push(r.pid);
    if (rows.length < 5000) break;
  }
  return out;
}

export type DrawOutcome = { ok: true; already?: boolean } | { ok: false; error: string; status: number };
/**
 * Draw now, if allowed. Automatic: the draw time (on the game clock) has come. Manual: `by` is the Organizer or the Host (anybody else is refused by the engine and here).
 * The beacon round: the round of the draw time (automatic) or the newest published round at the press (manual); only a signature-checked round counts.
 */
export async function runDraw(env: Env & PiiEnv & PayEnv, e: any, now: number, t: { drawRound: number; paused: boolean }, by: Role | "auto"): Promise<DrawOutcome> {
  const d = await drawRow(env.DB, e.id);
  if (!d) return { ok: false, error: "This game is not a Lucky Draw.", status: 404 };
  if (d.drawn_ms !== null) return { ok: true, already: true };
  if (t.paused) return { ok: false, error: "The draw is paused. It waits until you resume.", status: 409 };
  const drawMs = roundMs(t.drawRound);
  if (by === "auto") { if (d.mode !== "auto" || now < drawMs + 3000) return { ok: false, error: "It is not draw time yet.", status: 409 }; }
  else if (d.mode !== "manual") return { ok: false, error: "This draw is automatic. It happens at the published time.", status: 409 };
  else if (by !== "organizer" && by !== "host") return { ok: false, error: "Only the Organizer or the Host can press Draw.", status: 403 };
  // claim the draw: registering closes at once; one request does the work
  const claim = await env.DB.prepare("UPDATE draw SET closing_ms=? WHERE eid=? AND drawn_ms IS NULL AND (closing_ms IS NULL OR closing_ms < ?)").bind(now, e.id, now - 120_000).run();
  if (!(claim.meta?.changes ?? 0)) return { ok: false, error: "The draw is being made. Please wait a moment.", status: 409 };
  const release = () => env.DB.prepare("UPDATE draw SET closing_ms=NULL WHERE eid=? AND drawn_ms IS NULL").bind(e.id).run();
  try {
    const target = by === "auto" ? t.drawRound : roundAt(now);
    let got = null as Awaited<ReturnType<typeof fetchRound>>;
    for (let r = target; r > target - (by === "auto" ? 1 : 3) && !got; r--) got = await fetchRound(r);
    if (!got) { await release(); return { ok: false, error: "The public beacon did not answer. Please press Draw again in a minute.", status: 503 }; }
    const pids = await entryPids(env.DB, e.id);
    const clock = startClock(newClock());
    const closeAt = by === "auto" ? drawMs : Infinity;
    let s: DrawState = luckyDrawRules.init({ eid: e.id, winners: d.winners, prizes: JSON.parse(d.prizes || "[]").join(","), draw: d.mode, closeAt: d.mode === "auto" ? closeAt : undefined, idKind: "emp", ref: d.ref, cap: Math.min(e.cap, DRAW_CAP), rehearsal: !!e.rehearsal_of }, [], now);
    const regAt = d.mode === "auto" ? drawMs - 1 : now;
    for (let i = 0; i < pids.length; i += 5000) s = luckyDrawRules.step(s, { type: "registerMany", players: pids.slice(i, i + 5000) }, regAt, clock).state;
    const fin = d.mode === "auto" ? luckyDrawRules.step(s, { type: "tick", beacon: got.randomness }, Math.max(now, drawMs), clock) : luckyDrawRules.step(s, { type: "draw", by: by as Role, beacon: got.randomness }, now, clock);
    if (!fin.state.drawn) { await release(); return { ok: false, error: "The draw could not be made. Nothing was changed.", status: 409 }; }
    const byLower = new Map(pids.map((p) => [p.toUpperCase().replace(/[^A-Z0-9]/g, ""), p])); // the engine cleans IDs the same way for everybody; map back to the seat
    const result = fin.state.drawn.map((w, place) => ({ pid: byLower.get(w) ?? w, place }));
    const upd = await env.DB.prepare("UPDATE draw SET drawn_ms=?, round=?, beacon=?, result=?, by_role=?, entries=? WHERE eid=? AND drawn_ms IS NULL").bind(now, got.round, got.randomness, JSON.stringify(result), by, s.entries.length, e.id).run();
    if (!(upd.meta?.changes ?? 0)) return { ok: true, already: true };
    await env.DB.prepare("INSERT INTO life(eid,end_ms,end_src) VALUES(?,?,'phones') ON CONFLICT(eid) DO UPDATE SET end_ms=excluded.end_ms, end_src='phones' WHERE life.purged_ms IS NULL").bind(e.id, now).run();
    if (!e.rehearsal_of) {
      await recordWinners(env as any, e, e.id, result.map((r) => ({ pattern: "lucky", ordinal: r.place + 1, round: 1, idx: 0, pids: [r.pid] })), now, "draw");
      for (const r of result) {
        const seat = Number(r.pid.split("x")[0]);
        const row = await env.DB.prepare("SELECT pii FROM participant WHERE eid=? AND pid=?").bind(e.id, r.pid).first<{ pii: string | null }>();
        if (Number.isFinite(seat)) await env.DB.prepare("INSERT OR IGNORE INTO prize(eid,round,pattern,ordinal,seat,pii,orig) VALUES(?,?,?,?,?,?,?)").bind(e.id, 1, "lucky", r.place + 1, seat, row?.pii ?? null, row?.pii ?? null).run();
      }
      await mailResult(env, e, d, result, now);
    }
    return { ok: true };
  } catch (err) {
    await release();
    return { ok: false, error: "The draw could not be made. Nothing was changed. Please try again.", status: 500 };
  }
}

/** The result by e-mail: to every winner who gave an e-mail ID (the entry is the e-mail), and a summary to the Organizer. Never blocks the draw. */
async function mailResult(env: Env & PiiEnv & PayEnv, e: any, d: DrawRow, result: { pid: string; place: number }[], now: number): Promise<void> {
  try {
    const prizes: string[] = JSON.parse(d.prizes || "[]");
    const places = prizePlaces(Math.max(d.winners, result.length));
    const title = (() => { try { return JSON.parse(e.config || "{}").name || e.id; } catch { return e.id; } })();
    const lines: string[] = [];
    for (const r of result) {
      const row = await env.DB.prepare("SELECT pii FROM participant WHERE eid=? AND pid=?").bind(e.id, r.pid).first<{ pii: string | null }>();
      const p = await openPii(env, row?.pii ?? null);
      lines.push(`${places[r.place]}: ${mask(p?.name, p?.empId, r.place + 1)}${prizes[r.place] ? " - " + prizes[r.place] : ""}`);
      if (p?.empId && p.empId.includes("@")) await sendMail(env, env.DB, p.empId, `You won: ${title}`, `Congratulations! You won ${places[r.place]} place in ${title}${prizes[r.place] ? ` and the prize is: ${prizes[r.place]}` : ""}.\n\nOpen the game page and press "You won" to confirm where your prize should go.\n\n${NO_PERSONAL_LINE}`, now);
    }
    const org = (await teamEmails(env, e.org, e.id)).organizer;
    if (org) await sendMail(env, env.DB, org, `Lucky Draw result: ${title}`, `The draw is done.\n\n${lines.join("\n")}\n\nEntries: ${d.entries ?? "see game page"}. Beacon round ${d.round}.\n${DRAW_FAIRNESS}\n\n${NO_PERSONAL_LINE}`, now);
  } catch { /* the result stands; mail is retried by the outbox where it was queued */ }
}

/** Automatic draws whose time has come and that nobody has looked at: the scheduled job calls this. Bounded: 10 draws per call. */
export async function drawTick(env: Env & PiiEnv & PayEnv, now: number, timing: (e: any) => Promise<{ drawRound: number; paused: boolean }>): Promise<number> {
  const rows = (await env.DB.prepare("SELECT e.* FROM draw d JOIN engagement e ON e.id=d.eid WHERE d.drawn_ms IS NULL AND d.mode='auto' AND e.cancelled_ms IS NULL AND e.start_round < ? ORDER BY e.start_round LIMIT 10").bind(roundAt(now)).all<any>()).results ?? [];
  let n = 0;
  for (const e of rows) { const r = await runDraw(env, e, now, await timing(e), "auto"); if (r.ok && !r.already) n++; }
  return n;
}
