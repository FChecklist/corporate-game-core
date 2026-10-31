// REHEARSALS (release 1.6.0, owner decision 2026-10-28): every PAID game has exactly THREE free rehearsals, one after the other, each a real run of the system with its own game code, its own links, tickets,
// seats, check-in and claims. A rehearsal is a game record of its own (made from the real game's data), marked `rehearsal_of` = the real game and `run_no` 1..3. Because every thing a phone or a link
// remembers is keyed by the game code, a new code per run keeps the runs apart and the real game untouched. The number of people allowed in a rehearsal is enforced here (the game's own limit, 20) and
// is never shown in any text.
//   GET  /api/z/{real}/rehearsals        -> the three cards (state: locked | ready | running | done), who can start the next one
//   POST /api/z/{real}/rehearsal {people?: "published" | "previous" | "none"}   -> starts the next rehearsal (a new game); {ok, id, n, openUrl, guestUrl}
//   POST /api/z/{rehearsal}/rehearsal/close                                      -> the organizer closes it (counts as finished, unlocks the next)
import { copyPeople } from "./clone";
import { randHex } from "./people";
const sha = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))), (b) => b.toString(16).padStart(2, "0")).join("");
import { endBoundMs } from "./lifecycle";
import { rehearsalBlock } from "./rehearsal-mail";
import type { D1, Env } from "./worker";

export const REHEARSAL_MAX = 3;
/** The server-only limit. Never put this number in a message, a card, an e-mail or a page. */
export const REHEARSAL_PEOPLE = 20;
export const REHEARSAL_SCHEMA = [
  `ALTER TABLE engagement ADD COLUMN rehearsal_of TEXT`,
  `ALTER TABLE engagement ADD COLUMN run_no INTEGER`,
  `ALTER TABLE engagement ADD COLUMN rehearsal_closed_ms INTEGER`,
  `CREATE INDEX IF NOT EXISTS engagement_rehearsal ON engagement(rehearsal_of)`,
];
let colsOk = false;
export const resetRehearsalColumnsFlag = () => { colsOk = false; };
/** The three columns normally come from migration 0030_rehearsal.sql (apply it BEFORE deploying this code). If the database does not have them yet, the first rehearsal request adds ONLY the ones that are missing,
    after asking the table itself (pragma_table_info), so this and the migration never add the same column twice. Safe to repeat. */
export async function ensureRehearsalColumns(db: D1): Promise<void> {
  if (colsOk) return;
  const have = new Set(((await db.prepare("SELECT name FROM pragma_table_info('engagement')").all<{ name: string }>()).results ?? []).map((r) => r.name));
  for (const s of REHEARSAL_SCHEMA) {
    const col = /ADD COLUMN (\w+)/.exec(s)?.[1];
    if (col && have.has(col)) continue;
    try { await db.prepare(s).run(); } catch { /* added by someone else a moment ago */ }
  }
  colsOk = true;
}
const GENESIS = 1692803367;
const roundMs = (r: number) => (GENESIS + (r - 1) * 3) * 1000;
const roundAt = (ms: number) => Math.floor((ms / 1000 - GENESIS) / 3) + 1;

export const NOT_PAID_MSG = "First publish your game and pay. This unlocks your 3 rehearsals.";
export const AFTER_START_MSG = "Rehearsals end when the real game starts.";
export const ONE_AT_A_TIME_MSG = "Finish the rehearsal that is on first.";
export const ALL_USED_MSG = "All 3 rehearsals are done.";
export const REAL_ONLY_MSG = "Rehearsals belong to a real game.";
export const FULL_MSG = "This rehearsal is full. Please ask your organizer.";
export const OVER_MSG = "This rehearsal is over. Thank you for practising.";
export { rehearsalBlock, rehearsalSubject } from "./rehearsal-mail";

type Row = { id: string; rehearsal_of: string | null; run_no: number | null; rehearsal_closed_ms: number | null; start_round: number; pack: number; config: string | null; created_ms: number };
const isDemoRow = (e: { config?: string | null }) => { try { return !!(e.config && JSON.parse(e.config).demo); } catch { return false; } };

/** Has this rehearsal been closed by the organizer, or run to its end? */
export async function rehearsalFinished(env: Env, r: Row, now: number): Promise<boolean> {
  if (r.rehearsal_closed_ms) return true;
  const hasStarted = now >= roundMs(r.start_round);
  if (!hasStarted) return false;
  return now >= (await endBoundMs(env, r));
}

export async function listRehearsals(env: Env, real: any, now: number) {
  await ensureRehearsalColumns(env.DB);
  const rows = (await env.DB.prepare("SELECT * FROM engagement WHERE rehearsal_of=? ORDER BY run_no").bind(real.id).all<Row>()).results ?? [];
  const paid = real.pack > 0 && !isDemoRow(real); // (a paid game is always published: pack stays 0 until the payment)
  const beforeStart = now < roundMs(real.start_round);
  const cards: { n: number; state: "locked" | "ready" | "running" | "done"; id?: string; dateMs?: number; reason?: string }[] = [];
  let prevDone = true;
  for (let n = 1; n <= REHEARSAL_MAX; n++) {
    const r = rows.find((x) => x.run_no === n);
    if (r) {
      const done = await rehearsalFinished(env, r, now);
      cards.push({ n, state: done ? "done" : "running", id: r.id, dateMs: roundMs(r.start_round) });
      prevDone = done; continue;
    }
    if (!paid) { cards.push({ n, state: "locked", reason: NOT_PAID_MSG }); prevDone = false; continue; }
    if (!prevDone) { cards.push({ n, state: "locked", reason: n === 1 ? NOT_PAID_MSG : `Finish rehearsal ${n - 1} first.` }); continue; }
    if (!beforeStart) { cards.push({ n, state: "locked", reason: AFTER_START_MSG }); prevDone = false; continue; }
    cards.push({ n, state: "ready" }); prevDone = false; // the next one is ready; the ones after it wait for it
  }
  return { paid, beforeStart, cards };
}

/** Starts the next rehearsal of `real`. The caller has checked that the asker may act for this game. */
export async function startRehearsal(env: Env, real: any, b: any, now: number, origin: string, spend: (n: number) => Promise<boolean>, json: (o: unknown, s?: number) => Response): Promise<Response> {
  const db = env.DB; await ensureRehearsalColumns(db);
  if (real.rehearsal_of) return json({ error: REAL_ONLY_MSG, code: "real-only" }, 409);
  const list = await listRehearsals(env, real, now);
  if (!list.paid) return json({ error: NOT_PAID_MSG, code: "not-paid" }, 402);
  if (!list.beforeStart) return json({ error: AFTER_START_MSG, code: "after-start" }, 409);
  if (list.cards.every((c) => c.state === "done" || c.state === "running") && list.cards.length >= REHEARSAL_MAX && list.cards.every((c) => c.id)) return json({ error: ALL_USED_MSG, code: "all-used" }, 409);
  if (list.cards.some((c) => c.state === "running")) return json({ error: ONE_AT_A_TIME_MSG, code: "one-at-a-time" }, 409);
  const next = list.cards.find((c) => c.state === "ready");
  if (!next) return json({ error: ALL_USED_MSG, code: "all-used" }, 409);
  const n = next.n;
  if (!(await spend(10))) return json({ error: "It is very busy right now. Please try again in a few minutes." }, 503);
  const id = `${String(real.id).slice(0, 34)}-R${n}`;
  // created_ms is copied from the real game on purpose: the people copied below carry the real game's identity hashes, so the rehearsal must follow the same ID rules as the real game (an older game stays on the old rules)
  const sr = roundAt(now + 30_000);
  let cfg: any = {}; try { cfg = real.config ? JSON.parse(real.config) : {}; } catch { cfg = {}; }
  delete cfg.demo; // a rehearsal never uses the demo allowance
  const r = await db.prepare("INSERT OR IGNORE INTO engagement(id,start_round,call_seconds,cap,created_ms,org,closed,pack,tickets,config,is_test,cohost_limit,rehearsal_of,run_no) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(id, sr, real.call_seconds, REHEARSAL_PEOPLE, real.created_ms ?? now, real.org, real.closed ? 1 : 0, REHEARSAL_PEOPLE, real.tickets, JSON.stringify(cfg), real.is_test ?? 0, real.cohost_limit ?? null, real.id, n).run();
  if ((r.meta?.changes ?? 0) < 1) return json({ error: ONE_AT_A_TIME_MSG, code: "one-at-a-time" }, 409);
  await db.prepare("INSERT OR IGNORE INTO kv(k,v) VALUES(?,?)").bind(`pub/${id}`, String(now)).run(); // published at once: nothing to pay, nothing to wait for
  let people = 0;
  const pick = Array.isArray(b?.pick) ? b.pick.filter((x: unknown) => typeof x === "string").slice(0, REHEARSAL_PEOPLE) as string[] : null;
  const which = b?.people === "none" ? "none" : b?.people === "previous" ? "previous" : pick ? "pick" : "published";
  if (which !== "none") {
    const from = which === "previous" && n > 1 ? `${String(real.id).slice(0, 34)}-R${n - 1}` : real.id;
    const c = await copyPeople(env, from, id, REHEARSAL_PEOPLE, now, spend, which === "pick" ? pick! : undefined);
    people = c.copied;
  }
  // Co-hosts belong to ONE game (their key is hashed, so it cannot be moved): each gets a new key for this rehearsal. Hosts are keys of the whole organization and already work here.
  const team = await copyCohosts(env, real, id, origin, now);
  return json({ ok: true, id, n, people, team, openUrl: `${origin}/zc.html?e=${id}`, guestUrl: `${origin}/z.html?e=${id}`, realId: real.id, message: `Rehearsal ${n} is ready. It is practice only: it does not change your real game.` });
}

/** The organizer closes a running rehearsal early: it counts as finished and unlocks the next. */
export async function closeRehearsal(env: Env, e: any, now: number, json: (o: unknown, s?: number) => Response): Promise<Response> {
  if (!e.rehearsal_of) return json({ error: REAL_ONLY_MSG, code: "real-only" }, 409);
  await ensureRehearsalColumns(env.DB);
  await env.DB.prepare("UPDATE engagement SET rehearsal_closed_ms=COALESCE(rehearsal_closed_ms, ?) WHERE id=?").bind(now, e.id).run();
  return json({ ok: true, closed: true });
}

/** What a page of a rehearsal needs to know (empty for a real game). `over`: the rehearsal is finished or closed, so the page shows the calm "over" page and offers the real game's link. */
export async function rehearsalFacts(env: Env, e: any, now: number): Promise<Record<string, unknown>> {
  if (!e.rehearsal_of) return {};
  const over = await rehearsalFinished(env, e, now);
  // The size shown in the console is the real game's, never the rehearsal's own limit (which is only enforced here)
  const real = await env.DB.prepare("SELECT cap FROM engagement WHERE id=?").bind(e.rehearsal_of).first<{ cap: number }>();
  return { rehearsal: { n: e.run_no, realId: e.rehearsal_of, gameId: e.id, over, block: rehearsalBlock(e.id, e.run_no), shownCap: real?.cap ?? 100 } };
}

/** A new Co-host key (for the rehearsal only) for every active Co-host of the real game; the links come back to the console so they can be shared. */
async function copyCohosts(env: Env, real: any, toEid: string, origin: string, now: number): Promise<{ label: string; link: string }[]> {
  const out: { label: string; link: string }[] = [];
  let rows: any[] = [];
  try { rows = (await env.DB.prepare("SELECT label, pii, is_test, created_by FROM organizer_key WHERE org=? AND kind='cohost' AND eid=? AND revoked=0").bind(real.org, real.id).all<any>()).results ?? []; } catch { return out; } // no Co-host column yet = no Co-host was ever added
  for (const r of rows.slice(0, 20)) {
    const key = "ctc_" + randHex(24), kh = await sha("key|" + key);
    await env.DB.prepare("INSERT INTO organizer_key(hash,org,kind,revoked,created_ms,is_test,label,eid,pii,created_by) VALUES(?,?,?,0,?,?,?,?,?,?)").bind(kh, real.org, "cohost", now, r.is_test ?? 0, r.label, toEid, r.pii, r.created_by ?? "o").run();
    out.push({ label: String(r.label ?? ""), link: `${origin}/zc.html?e=${encodeURIComponent(toEid)}#cohost=${key}` });
  }
  return out;
}
