// The four common documents of every game and of the home page: Terms and Conditions, Privacy and Data, Legal Disclaimer, Policy.
// Written ONCE here (owner order, 1 Nov 2026). Part A is common to all games and comes FIRST; Part B is game-specific, comes LAST, one short heading per game, and holds only what truly differs.
// Third person only (never we, our, us), never "erase", payments only through IT Services by Rajat Agarwal and Razorpay. Sites link to DOC_URLS and render with renderDocument() (packages/ui); they keep no copy.
// Disclaimer and Terms keep the legal meaning of the Tambola text; any softening is listed in docs/LEGAL_REPHRASE_PROPOSALS.md for the owner, never done silently.
import { AUTO_DELETE_LINE, DETAILS_LINE, ID_ONLY_LINE } from "./lines";
import { NAVIGATION_LINE, REPORT_LINE } from "./legal";

export type DocKind = "terms" | "privacy" | "disclaimer" | "policy";
export type DocGameId = "tambola" | "bingo" | "tictactoe" | "snakes" | "luck" | "luckydraw";
export const DOC_KINDS: DocKind[] = ["terms", "privacy", "disclaimer", "policy"];
export const DOC_GAMES: { id: DocGameId; name: string }[] = [
  { id: "tambola", name: "Tambola" }, { id: "bingo", name: "Bingo" }, { id: "tictactoe", name: "Tic Tac Toe" },
  { id: "snakes", name: "Snakes and Ladders" }, { id: "luck", name: "Luck by Chance" }, { id: "luckydraw", name: "Lucky Draw" },
];
export const DOC_TITLES: Record<DocKind, string> = { terms: "Terms and Conditions", privacy: "Privacy and Data", disclaimer: "Legal Disclaimer", policy: "Policy" };
/** The one address of each document. Every game, e-mail, PDF and the console link to these. */
export const DOC_HOST = "https://home.corporatetambola.com";
export const DOC_URLS: Record<DocKind, string> = { terms: `${DOC_HOST}/terms`, privacy: `${DOC_HOST}/privacy`, disclaimer: `${DOC_HOST}/disclaimer`, policy: `${DOC_HOST}/policy` };
/** ONE version and date of the whole set. A change of any document changes both; people tick the new text once at their next action (consent.ts). */
export const TERMS_VERSION = "2026-11-01";
export const TERMS_DATE = "1 November 2026";
export const SELLER = "IT Services by Rajat Agarwal";
export const CONTACT_EMAIL = "hello@corporatetambola.com";

export interface DocSection { heading: string; paragraphs: string[] }
export interface LegalDocument { kind: DocKind; title: string; partA: DocSection[]; partB: Record<DocGameId, string[]> }

const TERMS: LegalDocument = {
  kind: "terms", title: DOC_TITLES.terms,
  partA: [
    { heading: "Who provides the service", paragraphs: [
      `The service is provided by ${SELLER}, the trade name of Rajat Agarwal, a sole proprietorship in Ghaziabad, Uttar Pradesh, India.`,
      "The service is software for games. The Organizer runs each game. IT Services does not organize, conduct or take part in any game.",
    ] },
    { heading: "Who plays and how", paragraphs: [
      "The Organizer decides who may join: people listed by employee ID, people listed by e-mail, or anyone with the game link.",
      "A person must be 18 or older to take part. Every acceptance is by a box that is never ticked in advance.",
    ] },
    { heading: "Players pay nothing", paragraphs: [
      "No participant pays anything to play. The only charge is the Organizer's fee for the software, shown before payment. The fee is for the software and is not a stake, entry fee or price of a chance.",
      `IT Services does not hold, take or give any money or prize. Any prize is provided and handed over by the Organizer. The software only records the result it computes. Payments go only to ${SELLER} through Razorpay.`,
    ] },
    { heading: "Winners are decided by the software", paragraphs: [
      "The game software decides every win from the rules of the game. Neither the Organizer nor IT Services can add, remove or change a winner in the software.",
      "A ticket, card, board or entry is issued free of charge as part of the game screen. It is not a lottery ticket.",
    ] },
    { heading: "What the Organizer takes care of", paragraphs: [
      "The Organizer follows the law of every State where a game is played, and does not charge any participant, link a game to betting or pooling of money, or invite a person under 18.",
      "The Organizer is responsible for any prize, its cost, its handover and the tax on it.",
      "A game that is not allowed may be stopped, and the fee for that game is then not returned.",
    ] },
    { heading: "Payment and credit", paragraphs: ["Payment, credit and changes of date are described in the Policy page, which is part of these terms."] },
    { heading: "Personal data", paragraphs: [`How participant data is used and deleted is described in the Privacy and Data page. ${AUTO_DELETE_LINE}`] },
    { heading: "How these terms are accepted", paragraphs: [
      "The terms are accepted by ticking the box shown on screen. Each acceptance is recorded with the date, the version of the terms and the wording of the box. The record holds no IP address and no device details.",
      `When a new version is published, each person ticks it once at their next action. This is version ${TERMS_VERSION}.`,
    ] },
    { heading: "Law and questions", paragraphs: [
      "Indian law applies. A dispute is first raised with the Grievance Officer. If it is not settled within 30 days, it goes to a sole arbitrator at Ghaziabad, in English, and the courts at Ghaziabad have exclusive jurisdiction.",
      `Grievance Officer: Rajat Agarwal, ${SELLER}, B-1105, Shipra Krishna Vista, Indirapuram, Ghaziabad, Uttar Pradesh, 201014, India. E-mail ${CONTACT_EMAIL} with the subject Grievance. A grievance is acknowledged within 48 hours and settled within 30 days.`,
    ] },
  ],
  partB: {
    tambola: ["Tambola is played with tickets. A participant presses Claim when a pattern is complete, and the software checks the claim against the numbers called. A correct claim wins the prize; the first correct claim for a prize is the winner."],
    bingo: ["Bingo is played with cards. Winners are worked out by the software from the public list of numbers called and the seats of the game, so no claim is needed. Where two cards complete a pattern on the same call, the software breaks the tie by a fixed public rule."],
    tictactoe: ["Tic Tac Toe is played in rounds and stages. The software pairs participants, and the result of each pair decides who goes on. A tie is played once more; after that the rules of the game decide. Prize places are the last participants standing."],
    snakes: ["Snakes and Ladders is played in rounds with the dice rolled by the software. A participant who is not playing in time is out of the next round. The last participants standing take the prize places."],
    luck: ["Luck by Chance is played in rounds decided by the software's throws. A tie is thrown again. The last participants standing take the prize places."],
    luckydraw: ["Lucky Draw has one entry per participant. Entry closes at the draw time. The winners are drawn by the software from the entries using a public value, so the same entries always give the same winners. Winners are shown to all and e-mailed."],
  },
};

const PRIVACY: LegalDocument = {
  kind: "privacy", title: DOC_TITLES.privacy,
  partA: [
    { heading: "In short", paragraphs: [ID_ONLY_LINE, DETAILS_LINE, AUTO_DELETE_LINE] },
    { heading: "How a game uses data", paragraphs: [
      "The Organizer sets up the game and decides how participants join: with an employee ID, with an e-mail, or open to anyone.",
      "In a game open to anyone, the participant's details are used to identify the participant, and the Organizer sees who joined.",
      "Participant data is used for that game only.",
    ] },
    { heading: "After the game", paragraphs: [
      REPORT_LINE,
      "The report has the statistics, the game log, how the game was played and the winners in full. It has no row for any individual participant.",
      "The Organizer and the Hosts receive it. Co-hosts do not.",
      "If the e-mail bounces, the report is held in encrypted form and sent again after 24, 36 and 72 hours, and is deleted on delivery or after the last try.",
    ] },
    { heading: "What is kept, and for how long", paragraphs: [
      "Participant data, codes, invitation records and requests are auto-deleted within 24 hours after the game ends. A game that never starts is treated the same way.",
      "The winners' record, which shows who won which prize place, is auto-deleted after 365 days.",
      "Game settings, prizes, time and the result summary, without personal details, are auto-deleted after 365 days.",
      "An audit log of what happened in each game, without personal details, is kept for 365 days to keep play fair.",
      "Speed and error reports are kept for 90 days. The mail log is kept for 3 days.",
      "Organizer account details are kept until the Organizer closes the account, then deleted. Billing records are kept for audit and tax.",
      "The Organizer can delete all participant data at any time from the console, once the game is over or if it was never published.",
    ] },
    { heading: "Cookies and storage", paragraphs: [
      "The games use only first-party storage on the device, for settings such as the look and the language. No advertising cookies and no third-party trackers are used.",
      NAVIGATION_LINE,
      "A Global Privacy Control signal from the browser is respected: no navigation data is collected.",
    ] },
    { heading: "Rights and questions", paragraphs: [
      `A participant can ask the Organizer or the Grievance Officer what data is held, ask for a correction or deletion, withdraw consent, or ask another person to use these rights. Write to ${CONTACT_EMAIL} with the subject Grievance. A request is answered within 30 days.`,
      "The games are for adults. A person under 18 is not accepted, and if one is found, the person is removed from the game and the data is deleted.",
      "Service providers for hosting, database, e-mail delivery and payment processing work under contracts that keep the data confidential and secure.",
    ] },
  ],
  partB: {
    tambola: ["Details a winner confirms to receive a prize are kept for 365 days so the prize can be handed over, and are then auto-deleted."],
    bingo: ["Details a winner confirms to receive a prize are kept for 365 days so the prize can be handed over, and are then auto-deleted."],
    tictactoe: ["Final results are kept in numeric form only."],
    snakes: ["Details a winner confirms to receive a prize are kept for 365 days so the prize can be handed over, and are then auto-deleted."],
    luck: ["Final results are kept in numeric form only."],
    luckydraw: ["The entries and the winners are auto-deleted within 24 hours after the draw. Winners are e-mailed once, with the words You won."],
  },
};

const DISCLAIMER: LegalDocument = {
  kind: "disclaimer", title: DOC_TITLES.disclaimer,
  partA: [
    { heading: "Software only", paragraphs: [
      `The software is provided as is, for entertainment. ${SELLER} makes software. It does not run the games, does not hold, take or give any money or prize, and is not a party to any arrangement between an Organizer and a participant.`,
      "The service is not an online money game or an online money gaming service. No participant pays a stake, and no game is played in expectation of money from a stake.",
    ] },
    { heading: "Prizes and tax", paragraphs: [
      "Prizes, if any, are provided and handed over by the Organizer, who is responsible for their cost, delivery, tax and any dispute about them. IT Services is not the payer, deductor or collector for any prize.",
      "Gifts that are not cash are recommended. Cash prizes are at the Organizer's own responsibility.",
    ] },
    { heading: "Law of the place of play", paragraphs: [
      "Gaming laws differ from State to State. The Organizer is responsible for making sure a game is allowed in every State where it is played.",
    ] },
    { heading: "Results and availability", paragraphs: [
      "The software decides the result from the published rules of the game. The result is final, apart from the correction of a demonstrable technical error.",
      "Games run on the participants' own devices. Interruptions of the internet or of a device are not the responsibility of IT Services.",
    ] },
    { heading: "Limit", paragraphs: [
      "To the extent the law permits, the total liability of IT Services to an Organizer for a claim about a game is limited to the fee paid for that game. Nothing limits a liability that the law does not allow to be limited.",
      "The Organizer is responsible for loss that arises from the Organizer's own prize, tax, invitation list or dispute with a participant.",
    ] },
    { heading: "Protection of the product", paragraphs: [
      "The software, rules, designs, text and names belong to Rajat Agarwal, trading as IT Services by Rajat Agarwal. Nobody may feed the pages, code, text, rules or designs to an AI system or another tool to copy, re-create or derive a similar product.",
    ] },
  ],
  partB: {
    tambola: ["A claim is checked by the software against the numbers called. A wrong claim does not stop the game."],
    bingo: ["The software settles Bingo from the public list of numbers called. A tie on the same call is broken by a fixed public rule that nobody can change."],
    tictactoe: ["Pairing, rounds and results are decided by the software. A pair that is not playing in time is handled by the rules of the game."],
    snakes: ["The dice are rolled by the software. A participant who is not playing in time is out of the next round."],
    luck: ["The throws are made by the software. A tie is thrown again."],
    luckydraw: ["The draw uses a public value and the list of entries, so anyone with both gets the same winners. The Organizer and IT Services cannot change the winners."],
  },
};

const POLICY: LegalDocument = {
  kind: "policy", title: DOC_TITLES.policy,
  partA: [
    { heading: "What is paid for", paragraphs: [
      "One payment is for one game, for the group size chosen, at the price shown on the payment page. No commitment, no repeat charges.",
      "Building and publishing a game is free. A game that is not paid for simply does not begin, and nothing is charged.",
    ] },
    { heading: "Who is paid", paragraphs: [
      `Payments go only to ${SELLER}, through Razorpay. Card, UPI and bank details stay with Razorpay.`,
    ] },
    { heading: "Credit instead of a refund", paragraphs: [
      "Once the payment is made, it stays with the game as credit for 365 days rather than being refunded. A paid game can be moved to any date within 365 days of payment, free of charge.",
      "A paid game can be cancelled until its start time. A paid game that is cancelled before it starts stays with the Organizer as credit for the next game, valid for 365 days. Unused credit lapses at the end of day 365. An e-mail is sent before it lapses.",
      "Once the start time has passed, the game has started and keeps its time.",
      "A test payment is only for trying the payment and its invoice; it is not returned.",
    ] },
    { heading: "A wrong or double charge", paragraphs: [
      `A wrong or double charge is always refunded in full. Write to ${CONTACT_EMAIL} with the subject Billing, the payment reference, the amount and the date. An approved refund is started within 7 working days to the original payment method.`,
      "Nothing is lost, and the payment is taken only once.",
      "If a paid game cannot run because of a fault in the software, it is moved free of charge. If it cannot be provided at all within the 365 days, the amount paid is refunded.",
    ] },
    { heading: "Prizes and invoices", paragraphs: [
      "Prizes, if any, are provided and handed over by the Organizer and are not part of this policy.",
      "An invoice is issued for each payment. Billing records are kept for audit and tax.",
    ] },
  ],
  partB: {
    tambola: ["Credit stays for a new game of Tambola within the same 365 days from the date of payment."],
    bingo: ["Credit stays for a new game of Bingo within the same 365 days from the date of payment."],
    tictactoe: ["Credit stays for a new game of Tic Tac Toe within the same 365 days from the date of payment."],
    snakes: ["Credit stays for a new game of Snakes and Ladders within the same 365 days from the date of payment."],
    luck: ["Credit stays for a new game of Luck by Chance within the same 365 days from the date of payment."],
    luckydraw: ["Credit stays for a new game of Lucky Draw within the same 365 days from the date of payment."],
  },
};

export const DOCUMENTS: Record<DocKind, LegalDocument> = { terms: TERMS, privacy: PRIVACY, disclaimer: DISCLAIMER, policy: POLICY };
/** Every paragraph of all four documents, with where it is. */
export const allDocParagraphs = (): { kind: DocKind; game?: DocGameId; text: string }[] =>
  DOC_KINDS.flatMap((k) => [
    ...DOCUMENTS[k].partA.flatMap((s) => s.paragraphs.map((text) => ({ kind: k, text }))),
    ...DOC_GAMES.flatMap((g) => DOCUMENTS[k].partB[g.id].map((text) => ({ kind: k, game: g.id, text }))),
  ]);
const norm = (s: string): string => s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
const FINGERPRINTS = allDocParagraphs().filter((p) => p.text.length >= 40).map((p) => ({ kind: p.kind, text: norm(p.text) }));
/** Drift check: the documents that `text` carries a copy of. A site shows them through renderDocument() or links to DOC_URLS, and keeps no copy. */
export const findDocumentCopies = (text: string): DocKind[] => {
  const n = norm(text.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'"));
  return [...new Set(FINGERPRINTS.filter((f) => n.includes(f.text)).map((f) => f.kind))];
};
