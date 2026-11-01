// ONE legal document for the home page and every game (owner order, 1 Nov 2026), published once at one address:
//   1 Terms and Conditions, 2 Payments and Credit, 3 Privacy and Data, 4 Data retention, 5 Cookies and navigation data, 6 Companies that help run the service (and data processing terms), 7 Grievance and contact, 8 Acceptable use and Legal Disclaimer, 9 Game Rules (common first, then one subsection per game).
// Third person only (never we, our, us), never "erase", payments only through IT Services by Rajat Agarwal and Razorpay. Sites link to DOC_URLS and render with renderDocument() (packages/ui); they keep no copy.
// The strong legal clauses keep their meaning; any softening is listed in docs/LEGAL_REPHRASE_PROPOSALS.md for the owner, never done silently.
import { AUTO_DELETE_LINE, DETAILS_LINE, ID_ONLY_LINE } from "./lines";
import { NAVIGATION_LINE, REPORT_LINE } from "./legal";

export type DocSectionId = "terms" | "payments" | "privacy" | "retention" | "cookies" | "processors" | "grievance" | "acceptable-use" | "game-rules";
export type DocGameId = "tambola" | "bingo" | "tictactoe" | "snakes" | "luck" | "luckydraw";
export const DOC_SECTION_IDS: DocSectionId[] = ["terms", "payments", "privacy", "retention", "cookies", "processors", "grievance", "acceptable-use", "game-rules"];
export const DOC_GAMES: { id: DocGameId; name: string }[] = [
  { id: "tambola", name: "Tambola" }, { id: "bingo", name: "Bingo" }, { id: "tictactoe", name: "Tic Tac Toe" },
  { id: "snakes", name: "Snakes and Ladders" }, { id: "luck", name: "Luck by Chance" }, { id: "luckydraw", name: "Lucky Draw" },
];
/** Section titles. The notice line and the small links use only terms, privacy and game-rules. */
export const DOC_TITLES: Record<DocSectionId, string> = {
  terms: "Terms and Conditions", payments: "Payments and Credit", privacy: "Privacy and Data", retention: "Data retention", cookies: "Cookies and navigation data",
  processors: "Companies that help run the service", grievance: "Grievance and contact", "acceptable-use": "Acceptable use and Legal Disclaimer", "game-rules": "Game rules",
};
export const DOC_HOST = "https://home.corporatetambola.com";
/** The ONE address of the document, and the three section anchors that the small links open. Every game, e-mail, PDF and the console link to these. */
export const DOC_URL = `${DOC_HOST}/terms`;
export const DOC_URLS = Object.fromEntries(DOC_SECTION_IDS.map((k) => [k, `${DOC_URL}#${k}`])) as Record<DocSectionId, string>;
/** Old separate pages, each answered with a 301 to its anchor in the one document (nothing is deleted without a redirect). Paths are on each site's own host and on home. */
export const LEGACY_REDIRECTS: Record<string, string> = {
  "/legal": "terms", "/legal-position": "acceptable-use", "/disclaimer": "acceptable-use", "/privacy": "privacy", "/privacy-policy": "privacy",
  "/refund-policy": "payments", "/refund": "payments", "/policy": "payments", "/cookies": "cookies", "/retention": "retention",
  "/dpa": "processors", "/data-processing": "processors", "/sub-processors": "processors", "/trust": "terms", "/partner-terms": "terms",
};
export const legacyTarget = (path: string): string | null => { const k = LEGACY_REDIRECTS[path.toLowerCase().replace(/\/+$/, "")]; return k ? `${DOC_URL}#${k}` : null; };
/** ONE version and date of the whole document. A change of any text changes both. */
export const TERMS_VERSION = "2026-11-01";
export const TERMS_DATE = "1 November 2026";
export const SELLER = "IT Services by Rajat Agarwal";
export const CONTACT_EMAIL = "hello@corporatetambola.com";

export interface DocSub { id: string; heading: string; paragraphs: string[]; table?: string[][] }
export interface DocSection { id: DocSectionId; title: string; subs: DocSub[] }
const sub = (id: string, heading: string, ...paragraphs: string[]): DocSub => ({ id, heading, paragraphs });
const SUBPROC = "Cloudflare hosts the website and keeps the database in its Asia-Pacific region. Resend sends e-mail to Organizers and Hosts. Razorpay takes the Organizer's payment, and the IT Services payment service records each payment for the invoice. Google is used only if an Organizer chooses to sign in with Google. A public source of random values is used for draws, and YouTube in privacy mode only if an Organizer adds a video.";

export const DOCUMENT: DocSection[] = [
  { id: "terms", title: DOC_TITLES.terms, subs: [
    sub("who", "Who provides the service",
      `The service is provided by ${SELLER}, the trade name of Rajat Agarwal, a sole proprietorship in Ghaziabad, Uttar Pradesh, India.`,
      "The service is software for games. The Organizer runs each game. IT Services does not organize, conduct or take part in any game."),
    sub("who-plays", "Who plays and how",
      "The Organizer decides who may join: people listed by employee ID, people listed by e-mail, or anyone with the game link.",
      "A person must be 18 or older to take part. The games are for adults."),
    sub("free-play", "Players pay nothing",
      "No participant pays anything to play. The only charge is the Organizer's fee for the software, shown before payment. The fee is for the software and is not a stake, entry fee or price of a chance.",
      "IT Services does not hold, take or give any money or prize. Any prize is provided and handed over by the Organizer. The software only records the result it computes."),
    sub("agree", "How these terms are agreed",
      "Continuing to use the service means agreeing to these terms, the Privacy and Data section and the Game rules. Publishing a game is the Organizer's clear act of going ahead.",
      `At sign-in and when a game is published, the version of this document, a fingerprint of the notice shown and the time are stored. No other personal data is stored for this. This is version ${TERMS_VERSION}.`),
    sub("law", "Law",
      "Indian law applies. A dispute is first raised with the Grievance Officer (section 7). If it is not settled within 30 days, it goes to a sole arbitrator at Ghaziabad, in English, and the courts at Ghaziabad have exclusive jurisdiction.",
      "These terms may change. The latest version is always on this page, with its version and date at the top."),
  ] },
  { id: "payments", title: DOC_TITLES.payments, subs: [
    sub("what", "What is paid for",
      "One payment is for one game, for the group size chosen, at the price shown on the payment page. No commitment, no repeat charges.",
      "Building and publishing a game is free. A game that is not paid for simply does not begin, and nothing is charged."),
    sub("who", "Who is paid",
      `Payments go only to ${SELLER}, through Razorpay. Card, UPI and bank details stay with Razorpay. An invoice is issued for each payment, and billing records are kept for audit and tax.`),
    sub("credit", "Credit instead of a refund",
      "Once the payment is made, it stays with the game as credit for 365 days rather than being refunded. A paid game can be moved to any date within 365 days of payment, free of charge.",
      "A paid game can be cancelled until its start time. A paid game that is cancelled before it starts stays with the Organizer as credit for a new game of the same kind within the same 365 days from the date of payment. Unused credit lapses at the end of day 365, and an e-mail is sent before it lapses.",
      "Once the start time has passed, the game has started and keeps its time."),
    sub("wrong", "A wrong or double charge",
      `A wrong or double charge is always refunded in full. Write to ${CONTACT_EMAIL} with the subject Billing, the payment reference, the amount and the date. An approved refund is started within 7 working days to the original payment method. Nothing is lost, and the payment is taken only once.`,
      "If a paid game cannot run because of a fault in the software, it is moved free of charge. If it cannot be provided at all within the 365 days, the amount paid is refunded. A test payment is only for trying the payment and its invoice; it is not returned."),
  ] },
  { id: "privacy", title: DOC_TITLES.privacy, subs: [
    sub("short", "In short", ID_ONLY_LINE, DETAILS_LINE, AUTO_DELETE_LINE),
    sub("use", "How a game uses data",
      "The Organizer sets up the game and decides how participants join: with an employee ID, with an e-mail, or open to anyone.",
      "In a game open to anyone, the participant's details are used to identify the participant, and the Organizer sees who joined.",
      "Participant data is used for that game only. Participants never see each other's data.",
      "The Organizer decides the purpose of the participant data of a game. IT Services processes it only on the Organizer's behalf, as described in section 6."),
    sub("after", "After the game",
      REPORT_LINE,
      "The report has the statistics, the game log, how the game was played and the winners in full. It has no row for any individual participant.",
      "The Organizer and the Hosts receive it. Co-hosts do not.",
      "If the e-mail bounces, the report is held in encrypted form and sent again after 24, 36 and 72 hours, and is deleted on delivery or after the last try.",
      "The Organizer can delete all participant data at any time from the console, once the game is over or if it was never published."),
    sub("rights", "Participant rights",
      "A participant can leave a game at any time, ask what data is held, ask for a correction or deletion, withdraw consent, or ask another person to use these rights. Leaving the game withdraws consent at once.",
      `Write to ${CONTACT_EMAIL} with the subject Grievance, or use the game page. A request is answered within 7 days.`,
      "A person under 18 is not accepted, and if one is found, the person is removed from the game and the data is deleted.",
      "The service is designed to follow India's Digital Personal Data Protection Act, 2023, the EU General Data Protection Regulation and the California Consumer Privacy Act of the United States. A participant may also complain to the Data Protection Board of India."),
  ] },
  { id: "retention", title: DOC_TITLES.retention, subs: [
    { id: "table", heading: "What is kept, and for how long", paragraphs: [
      "Everything below is auto-deleted by timer, except what says Deleted, which a person deletes, and billing records.",
    ], table: [
      ["What", "How long", "Then"],
      ["Participant data, codes, invitation records and requests", "Within 24 hours after the game ends", "Auto-deleted"],
      ["A game that never starts: its participant data", "Within 24 hours after it was meant to end", "Auto-deleted"],
      ["The winners' record: who won which prize place", "365 days", "Auto-deleted"],
      ["Details a winner confirms to receive a prize (Tambola, Bingo, Snakes and Ladders)", "365 days", "Auto-deleted"],
      ["Game settings, prizes, time and the result summary, without personal details; Tic Tac Toe and Luck by Chance results in numeric form only", "365 days after the game", "Auto-deleted"],
      ["Audit log of the game, without personal details", "365 days", "Auto-deleted"],
      ["Speed and error reports", "90 days", "Auto-deleted"],
      ["Mail log", "3 days", "Auto-deleted"],
      ["A game report held after a bounce", "Until delivered, or after the last try at 72 hours", "Deleted"],
      ["Organizer account details", "Until the Organizer closes the account", "Deleted"],
      ["Billing records", "Kept", "For audit and tax"],
    ] },
  ] },
  { id: "cookies", title: DOC_TITLES.cookies, subs: [
    sub("storage", "Cookies and storage",
      "The games use only first-party storage on the device, for settings such as the look and the language. No advertising cookies and no third-party trackers are used."),
    sub("navigation", "Navigation data",
      NAVIGATION_LINE,
      "A Global Privacy Control signal from the browser is respected: no navigation data is collected."),
  ] },
  { id: "processors", title: DOC_TITLES.processors, subs: [
    sub("companies", "Companies that help run the service", SUBPROC),
    sub("terms", "Data processing terms",
      "For participant data, the Organizer decides the purpose and the means, and IT Services processes the data only on the Organizer's behalf under these terms. For the Organizer's own account, sign-in and billing data, IT Services decides how it is used.",
      "The companies that help work under contracts that keep the data confidential and secure. All data is encrypted in transit and at rest.",
      "Participant data is auto-deleted within 24 hours after the game. Any personal-data incident that touches participant data is told to the Organizer without delay."),
  ] },
  { id: "grievance", title: DOC_TITLES.grievance, subs: [
    sub("officer", "Grievance Officer",
      `Grievance Officer: Rajat Agarwal, ${SELLER}, B-1105, Shipra Krishna Vista, Indirapuram, Ghaziabad, Uttar Pradesh, 201014, India.`,
      `Questions, requests and complaints can be sent to ${CONTACT_EMAIL} with the subject Grievance. Each message gets a reply within 7 days.`),
  ] },
  { id: "acceptable-use", title: DOC_TITLES["acceptable-use"], subs: [
    sub("organizer", "What the Organizer takes care of",
      "The Organizer follows the law of every State where a game is played, and does not charge any participant, link a game to betting or pooling of money, or invite a person under 18.",
      "The Organizer is responsible for any prize, its cost, its handover and the tax on it.",
      "A game that is not allowed may be stopped, and the fee for that game is then not returned."),
    sub("disclaimer", "Legal disclaimer",
      `The software is provided as is, for entertainment. ${SELLER} makes software. It does not run the games and is not a party to any arrangement between an Organizer and a participant.`,
      "The service is not an online money game or an online money gaming service. No participant pays a stake, and no game is played in expectation of money from a stake. A ticket, card, board or entry is issued free of charge as part of the game screen and is not a lottery ticket.",
      "Prizes, if any, are provided and handed over by the Organizer, who is responsible for their cost, delivery, tax and any dispute about them. IT Services is not the payer, deductor or collector for any prize. Gifts that are not cash are recommended; cash prizes are at the Organizer's own responsibility.",
      "Gaming laws differ from State to State. The Organizer is responsible for making sure a game is allowed in every State where it is played.",
      "The software decides the result from the published rules of the game. The result is final, apart from the correction of a demonstrable technical error. Games run on the participants' own devices; interruptions of the internet or of a device are not the responsibility of IT Services.",
      "To the extent the law permits, the total liability of IT Services to an Organizer for a claim about a game is limited to the fee paid for that game. Nothing limits a liability that the law does not allow to be limited. The Organizer is responsible for loss that arises from the Organizer's own prize, tax, invitation list or dispute with a participant.",
      "The software, rules, designs, text and names belong to Rajat Agarwal, trading as IT Services by Rajat Agarwal. Nobody may feed the pages, code, text, rules or designs to an AI system or another tool to copy, re-create or derive a similar product."),
  ] },
  { id: "game-rules", title: DOC_TITLES["game-rules"], subs: [
    sub("common", "Rules common to all games",
      "Each participant has one seat or entry in a game. An ID that already has a seat is not given a second one, and a full game does not take more people.",
      "A game starts by itself at its published time, or when the Organizer or a Host presses Start, as the Organizer chose. The Organizer or a Host can pause and resume the game. While a game is paused nothing counts down, and play continues from the same point. Co-hosts help but do not start or pause the game.",
      "The game software decides every win from the rules of the game. Neither the Organizer nor IT Services can add, remove or change a winner in the software. Prizes are provided and handed over by the Organizer."),
    sub("tambola", "Tambola", "Tambola is played with tickets. A participant presses Claim when a pattern is complete, and the software checks the claim against the numbers called. A correct claim wins the prize, and the first correct claim for a prize is the winner. A wrong claim does not stop the game."),
    sub("bingo", "Bingo", "Bingo is played with cards. Winners are worked out by the software from the public list of numbers called and the seats of the game, so no claim is needed. Where two cards complete a pattern on the same call, the software breaks the tie by a fixed public rule that nobody can change."),
    sub("tictactoe", "Tic Tac Toe", "Tic Tac Toe is played in rounds and stages after a waiting room of 2 minutes. The software pairs participants, and the result of each pair decides who goes on. A tie is played once more; after that the rules of the game decide. Prize places go to the last participants standing."),
    sub("snakes", "Snakes and Ladders", "Snakes and Ladders is played in rounds after a waiting room of 2 minutes, with the dice rolled by the software. A participant who is not playing in time is out of the next round. Prize places go to the last participants standing."),
    sub("luck", "Luck by Chance", "Luck by Chance is played in rounds after a waiting room of 2 minutes, decided by the software's throws. A tie is thrown again. Prize places go to the last participants standing."),
    sub("luckydraw", "Lucky Draw", "Lucky Draw has one entry per participant. Entry closes at the draw time. The winners are drawn by the software from the entries using a public value, so anyone with the entries and the value gets the same winners. Winners are shown to all and e-mailed once, with the words You won."),
  ] },
];

/** Every paragraph of the document (and every table row, joined), with where it is. */
export const allDocParagraphs = (): { section: DocSectionId; sub: string; text: string }[] =>
  DOCUMENT.flatMap((s) => s.subs.flatMap((u) => [...u.paragraphs, ...(u.table ?? []).slice(1).map((r) => r.join(", "))].map((text) => ({ section: s.id, sub: u.id, text }))));
const norm = (s: string): string => s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
const FINGERPRINTS = allDocParagraphs().filter((p) => p.text.length >= 40).map((p) => ({ section: p.section, text: norm(p.text) }));
/** Drift check: the sections of the document that `text` carries a copy of. A site links to DOC_URLS or renders renderDocument(), and keeps no copy. */
export const findDocumentCopies = (text: string): DocSectionId[] => {
  const n = norm(text.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'"));
  return [...new Set(FINGERPRINTS.filter((f) => n.includes(f.text)).map((f) => f.section))];
};
