// ONE consent check for every game: the same boxes, in the same order, with the same text (owner order, 1 Nov 2026). Gentle wording from the phrasebooks; third person for the product.
// A box is never ticked in advance; the button stays off until every box of the point is ticked; the server refuses the action without the current CONSENT_VERSION and every box.
// A game may add ONE extra line to a point (GAME_EXTRA). The engine of each site stores the acceptance (who, point, game, version, boxes, hash of the wording shown, time) and asks again when the version changes.
import { DOC_TITLES, TERMS_VERSION, type DocGameId } from "./documents";

export type ConsentKind = "K1" | "K2" | "K3" | "K4" | "K5" | "K6" | "K9";
export const CONSENT_KINDS: ConsentKind[] = ["K1", "K2", "K3", "K4", "K5", "K6", "K9"];
/** The one version. Changing any document or any box changes TERMS_VERSION in documents.ts, and with it this. */
export const CONSENT_VERSION = TERMS_VERSION;
const T = DOC_TITLES;
/** Where each point is shown, and by whom (for the engine and the docs). */
export const CONSENT_POINTS: Record<ConsentKind, string> = {
  K1: "Publishing a game (Organizer or Host)", K2: "First sign-in or account creation (Organizer)", K3: "Before payment (Organizer or the person holding the pay link)",
  K4: "Joining a game, before any detail is asked (participant)", K5: "Accepting a Host or Co-host role", K6: "Entering or uploading a guest list (Organizer)", K9: "Contact, grievance and data-request forms",
};
export const CONSENT: Record<ConsentKind, Record<string, string>> = {
  K1: {
    A: `I have read and agree to the ${T.terms}, the ${T.privacy} page and the ${T.policy}.`,
    B: "I confirm that players play free of charge, that I provide and hand over any prize, that this game is allowed in my State, and that I may invite these guests.",
  },
  K2: { A: `I have read and agree to the ${T.terms} and the ${T.privacy} page.` },
  K3: { A: `I agree to the ${T.terms} and the ${T.policy}. I understand that my payment stays as credit for my next game, valid for 365 days.` },
  K4: {
    A: "I agree that my participant details are used for this game only and are auto-deleted within 24 hours after it ends. I know who invited me is recorded until then. If I win, my prize record and the details I confirm for the prize are kept for 365 days so the prize can be handed over. Billing data is kept for audit and tax. This notice is available in Hindi on request.",
    B: "I am 18 or older.",
  },
  K5: { A: `I promise that players play free of charge, that I will hand over prizes as the organizer decides, and that I follow the ${T.terms}.` },
  K6: { A: "I may use these participant details for this game, and the people have been told." },
  K9: { A: "I agree that my details may be used to reply to this request." },
};
/** Optional: ONE extra line for a game on a point, shown as box "X" after the common boxes. Only where a rule truly differs. */
export const GAME_EXTRA: Partial<Record<DocGameId, Partial<Record<ConsentKind, string>>>> = {
  luckydraw: { K4: "I understand that the winners are drawn by the software from the entries using a public value." },
};
/** The boxes of a point in order: the common ones, then the game's extra line if it has one. */
export function consentBoxes(kind: ConsentKind, game?: DocGameId): { id: string; text: string }[] {
  const common = Object.entries(CONSENT[kind]).map(([id, text]) => ({ id, text }));
  const extra = game ? GAME_EXTRA[game]?.[kind] : undefined;
  return extra ? [...common, { id: "X", text: extra }] : common;
}
/** The exact text shown at a point, joined, for the fingerprint the engine stores with an acceptance. */
export const consentWording = (kind: ConsentKind, game?: DocGameId): string => consentBoxes(kind, game).map((b) => b.text).join("\n");
/** Existing users are asked to tick the new text once at their next action: true when what they accepted is not the current version. */
export const needsRetick = (accepted: string | null | undefined): boolean => accepted !== CONSENT_VERSION;
/** The server check: is the request's consent complete? `given` is the version and the box ids sent. */
export const consentComplete = (kind: ConsentKind, given: { v?: unknown; boxes?: unknown } | null | undefined, game?: DocGameId): boolean => {
  const boxes = Array.isArray(given?.boxes) ? (given!.boxes as unknown[]) : [];
  return given?.v === CONSENT_VERSION && consentBoxes(kind, game).every((b) => boxes.includes(b.id));
};
