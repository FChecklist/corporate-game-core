// The words of a rehearsal that travel in e-mails, share texts and pages (owner wording, 2026-10-28). No imports of the game code: mail code may use this file freely.
import type { D1 } from "./worker";

/** The block that opens every rehearsal page, share text and e-mail. */
export const rehearsalBlock = (gameId: string, n: number) =>
  `Game ID: ${gameId}\nREHEARSAL GAME ${n}\nThis link and this game are for rehearsal only. The real game has a different link and a different game.`;
export const rehearsalSubject = (n: number, subject: string) => `REHEARSAL GAME ${n} (practice only): ${subject}`;

const ID_RE = /([A-Za-z0-9_-]{4,34}-R([123]))(?![A-Za-z0-9_-])/;
/**
 * Every e-mail that mentions a rehearsal's game code (its links, reminders, report, log) gets the subject 'REHEARSAL GAME n (practice only): ...' and the block as its first lines. The code is looked up,
 * so a real game whose name merely ends in -R1 is never changed.
 */
export async function rehearsalMailWrap(db: D1, subject: string, text: string, html?: string): Promise<{ subject: string; text: string; html?: string }> {
  try {
    const m = ID_RE.exec(subject + "\n" + text + "\n" + (html ?? "")); if (!m) return { subject, text, html };
    const row = await db.prepare("SELECT run_no FROM engagement WHERE id=? AND rehearsal_of IS NOT NULL").bind(m[1]!).first<{ run_no: number }>();
    if (!row) return { subject, text, html };
    const n = Number(row.run_no) || Number(m[2]);
    const block = rehearsalBlock(m[1]!, n);
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    return { subject: rehearsalSubject(n, subject), text: block + "\n\n" + text, ...(html ? { html: `<div style="border:2px solid #b3261e;padding:10px;margin-bottom:12px;font-weight:700">${esc(block).replace(/\n/g, "<br>")}</div>` + html } : {}) };
  } catch { return { subject, text, html }; }
}
