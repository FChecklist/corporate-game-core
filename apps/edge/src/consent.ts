// Terms boxes. A person ticks a box that is never ticked in advance; the page keeps its button disabled until every box of that point is ticked,
// and THIS file makes the server refuse the request without the tick, so a script cannot skip it.
//   - the request carries   consent: { v: "<Terms version>", boxes: ["A", "B"] }
//   - without the current version and every box of the point the answer is HTTP 400 { error, code: "consent-required", kind, version }
//   - every acceptance is one row in consent_log: who (an opaque id), which point, which game or payment, the Terms version, the boxes, a hash of the exact wording shown, the time.
//     No IP address, no browser details and no phone number are ever stored here.
//   - the rows of a participant (K4) are erased with the game's other participant data (lifecycle.ts); an organizer's rows are kept as the record of what they accepted.
import { TERMS_VERSION } from "./brand";
import TEXT from "./consent-text.json";
import type { D1 } from "./worker";

export type ConsentKind = "K1" | "K2" | "K3" | "K4" | "K5" | "K6" | "K9";
/** The current Terms version (one constant: brand.ts). */
export const CONSENT_VERSION = TERMS_VERSION;
export const CONSENT_TEXT = TEXT as Record<string, any>;

/** The box ids of a point in order, e.g. K1 -> ["A", "B"]. */
export const boxesOf = (kind: ConsentKind): string[] => Object.keys(CONSENT_TEXT[kind] ?? {});
/** The exact wording of a point's boxes, in order. */
export const wordingOf = (kind: ConsentKind): string[] => boxesOf(kind).map((id) => CONSENT_TEXT[kind][id] as string);

export const CONSENT_SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS consent_log (id TEXT PRIMARY KEY, subject TEXT NOT NULL, kind TEXT NOT NULL, ref TEXT, version TEXT NOT NULL, boxes TEXT NOT NULL, text_hash TEXT NOT NULL, at_ms INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS consent_log_ref ON consent_log (kind, ref)`,
  `CREATE INDEX IF NOT EXISTS consent_log_subject ON consent_log (subject, kind, version)`,
];

const encoder = new TextEncoder();
const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");
export const wordingHash = async (kind: ConsentKind): Promise<string> => hex(await crypto.subtle.digest("SHA-256", encoder.encode(wordingOf(kind).join("\n"))));

const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

/** null when the request carries the current Terms version and every box of this point; otherwise the answer to send (HTTP 400, code consent-required). */
export function consentMissing(b: any, kind: ConsentKind): Response | null {
  const c = b?.consent, need = boxesOf(kind);
  const given: unknown[] = Array.isArray(c?.boxes) ? c.boxes : [];
  if (c && typeof c === "object" && c.v === CONSENT_VERSION && need.length > 0 && need.every((id) => given.includes(id))) return null;
  return json({ error: "Please tick the box to continue.", code: "consent-required", kind, version: CONSENT_VERSION }, 400);
}

const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (x) => x.toString(16).padStart(2, "0")).join("");
/** Stores one acceptance. `subject` is an opaque id (the organizer, or the participant's seat), `ref` the game or payment it is about. */
export async function recordConsent(db: D1, o: { subject: string; kind: ConsentKind; ref: string | null; now: number }): Promise<void> {
  await db.prepare("INSERT INTO consent_log(id,subject,kind,ref,version,boxes,text_hash,at_ms) VALUES(?,?,?,?,?,?,?,?)")
    .bind(newId(), o.subject, o.kind, o.ref, CONSENT_VERSION, boxesOf(o.kind).join(","), await wordingHash(o.kind), o.now).run();
}

/** Has this subject ticked this point under the CURRENT Terms version? (Pass `anyVersion` to ask only whether they ever did.) */
export async function hasConsent(db: D1, subject: string, kind: ConsentKind, anyVersion = false): Promise<boolean> {
  const r = anyVersion
    ? await db.prepare("SELECT 1 AS x FROM consent_log WHERE subject=? AND kind=? LIMIT 1").bind(subject, kind).first()
    : await db.prepare("SELECT 1 AS x FROM consent_log WHERE subject=? AND kind=? AND version=? LIMIT 1").bind(subject, kind, CONSENT_VERSION).first();
  return !!r;
}
