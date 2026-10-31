/** Two forms of an e-mail address (owner rule 2026-10-30). Never use the employee ID cleaner (A-Z 0-9 only) for an e-mail address.
 *  INVISIBLE = every space, zero-width and line-break character: U+0085, U+200B-U+200D, U+2028, U+2029, U+2060, U+FEFF.
 *  accountEmail: the address of an ACCOUNT, sign-in, Host or Co-host, payment or form: NFKC (full-width "@" becomes "@"), every invisible character INSIDE the address becomes a plain space,
 *  then trim and lower case. So "a b@c.com" and "a(zero-width)b@c.com" both keep a space and the shape checks REFUSE them (nothing is quietly mended).
 *  emailKey: the Email ID of a PARTICIPANT (the Email ID criterion): the same, and every space and invisible character removed, so the same visible Email ID typed with or without them is one person. */
export const INVISIBLE_RE = /[\s\u0085\u200B-\u200D\u2028\u2029\u2060\uFEFF]/g;
export const accountEmail = (raw: unknown): string => String(raw ?? "").normalize("NFKC").replace(INVISIBLE_RE, " ").trim().toLowerCase();
export const emailKey = (raw: unknown): string => accountEmail(raw).replace(/\s+/g, "");
/** An account, payment or form address that is REFUSED (null) if it holds an inner space or invisible character or is not shaped like an address; otherwise the address as typed (outer spaces and invisibles trimmed, case kept). Nothing is repaired. */
export const refusedMail = (raw: unknown): string | null => { const a = accountEmail(raw); return !a || /\s/.test(a) || !/^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/.test(a) ? null : String(raw).trim().replace(new RegExp("^(?:" + INVISIBLE_RE.source + ")+|(?:" + INVISIBLE_RE.source + ")+$", "g"), ""); };
