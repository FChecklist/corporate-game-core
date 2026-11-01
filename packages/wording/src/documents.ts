// ONE legal document for the home page and every game (owner order, 1 Nov 2026), published once at one address:
//   1 Terms and Conditions (with the legal disclaimer and the payments and credit policy), 2 Privacy and Data, 3 Game Rules (common first, then one short subsection per game).
// Third person only (never we, our, us), never "erase", payments only through IT Services by Rajat Agarwal and Razorpay. Sites link to DOC_URLS and render with renderDocument() (packages/ui); they keep no copy.
// The strong legal clauses keep their meaning; any softening is listed in docs/LEGAL_REPHRASE_PROPOSALS.md for the owner, never done silently.
import { AUTO_DELETE_LINE, DETAILS_LINE, ID_ONLY_LINE } from "./lines";
import { NAVIGATION_LINE, REPORT_LINE } from "./legal";

export type DocSectionId = "terms" | "privacy" | "game-rules";
export type DocGameId = "tambola" | "bingo" | "tictactoe" | "snakes" | "luck" | "luckydraw";
export const DOC_SECTION_IDS: DocSectionId[] = ["terms", "privacy", "game-rules"];
export const DOC_GAMES: { id: DocGameId; name: string }[] = [
  { id: "tambola", name: "Tambola" }, { id: "bingo", name: "Bingo" }, { id: "tictactoe", name: "Tic Tac Toe" },
  { id: "snakes", name: "Snakes and Ladders" }, { id: "luck", name: "Luck by Chance" }, { id: "luckydraw", name: "Lucky Draw" },
];
/** The three names used in the notice line and the small links, in order. */
export const DOC_TITLES: Record<DocSectionId, string> = { terms: "Terms and Conditions", privacy: "Privacy and Data", "game-rules": "Game rules" };
export const DOC_HOST = "https://home.corporatetambola.com";
/** The ONE address of the document, and the three section anchors that the small links open. Every game, e-mail, PDF and the console link to these. */
export const DOC_URL = `${DOC_HOST}/terms`;
export const DOC_URLS: Record<DocSectionId, string> = { terms: `${DOC_URL}#terms`, privacy: `${DOC_URL}#privacy`, "game-rules": `${DOC_URL}#game-rules` };
/** ONE version and date of the whole document. A change of any text changes both. */
export const TERMS_VERSION = "2026-11-01";
export const TERMS_DATE = "1 November 2026";
export const SELLER = "IT Services by Rajat Agarwal";
export const CONTACT_EMAIL = "hello@corporatetambola.com";

export interface DocSub { id: string; heading: string; paragraphs: string[] }
export interface DocSection { id: DocSectionId; title: string; subs: DocSub[] }
const sub = (id: string, heading: string, ...paragraphs: string[]): DocSub => ({ id, heading, paragraphs });

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
      `IT Services does not hold, take or give any money or prize. Any prize is provided and handed over by the Organizer. The software only records the result it computes. Payments go only to ${SELLER} through Razorpay.`),
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
    sub("payments", "Payments and credit",
      "One payment is for one game, for the group size chosen, at the price shown on the payment page. No commitment, no repeat charges. Building and publishing a game is free. A game that is not paid for simply does not begin, and nothing is charged.",
      `Payments go only to ${SELLER}, through Razorpay. Card, UPI and bank details stay with Razorpay. An invoice is issued for each payment, and billing records are kept for audit and tax.`,
      "Once the payment is made, it stays with the game as credit for 365 days rather than being refunded. A paid game can be moved to any date within 365 days of payment, free of charge.",
      "A paid game can be cancelled until its start time. A paid game that is cancelled before it starts stays with the Organizer as credit for a new game of the same kind within the same 365 days from the date of payment. Unused credit lapses at the end of day 365, and an e-mail is sent before it lapses. Once the start time has passed, the game has started and keeps its time.",
      `A wrong or double charge is always refunded in full. Write to ${CONTACT_EMAIL} with the subject Billing, the payment reference, the amount and the date. An approved refund is started within 7 working days to the original payment method. Nothing is lost, and the payment is taken only once.`,
      "If a paid game cannot run because of a fault in the software, it is moved free of charge. If it cannot be provided at all within the 365 days, the amount paid is refunded. A test payment is only for trying the payment and its invoice; it is not returned."),
    sub("agree", "How these terms are agreed",
      "Continuing to use the service means agreeing to these terms, the Privacy and Data section and the Game rules. Publishing a game is the Organizer's clear act of going ahead.",
      `At sign-in and when a game is published, the version of this document, a fingerprint of the notice shown and the time are stored. No other personal data is stored for this. This is version ${TERMS_VERSION}.`),
    sub("law", "Law and questions",
      "Indian law applies. A dispute is first raised with the Grievance Officer. If it is not settled within 30 days, it goes to a sole arbitrator at Ghaziabad, in English, and the courts at Ghaziabad have exclusive jurisdiction.",
      `Grievance Officer: Rajat Agarwal, ${SELLER}, B-1105, Shipra Krishna Vista, Indirapuram, Ghaziabad, Uttar Pradesh, 201014, India. E-mail ${CONTACT_EMAIL} with the subject Grievance. A grievance is acknowledged within 48 hours and settled within 30 days.`),
  ] },
  { id: "privacy", title: DOC_TITLES.privacy, subs: [
    sub("short", "In short", ID_ONLY_LINE, DETAILS_LINE, AUTO_DELETE_LINE),
    sub("use", "How a game uses data",
      "The Organizer sets up the game and decides how participants join: with an employee ID, with an e-mail, or open to anyone.",
      "In a game open to anyone, the participant's details are used to identify the participant, and the Organizer sees who joined.",
      "Participant data is used for that game only."),
    sub("after", "After the game",
      REPORT_LINE,
      "The report has the statistics, the game log, how the game was played and the winners in full. It has no row for any individual participant.",
      "The Organizer and the Hosts receive it. Co-hosts do not.",
      "If the e-mail bounces, the report is held in encrypted form and sent again after 24, 36 and 72 hours, and is deleted on delivery or after the last try."),
    sub("kept", "What is kept, and for how long",
      "Participant data, codes, invitation records and requests are auto-deleted within 24 hours after the game ends. A game that never starts is treated the same way.",
      "The winners' record, which shows who won which prize place, is auto-deleted after 365 days. In Tambola, Bingo and Snakes and Ladders, the details a winner confirms to receive a prize are kept for the same 365 days so the prize can be handed over, and are then auto-deleted. Tic Tac Toe and Luck by Chance keep final results in numeric form only.",
      "Game settings, prizes, time and the result summary, without personal details, are auto-deleted after 365 days.",
      "An audit log of what happened in each game, without personal details, is kept for 365 days to keep play fair.",
      "Speed and error reports are kept for 90 days. The mail log is kept for 3 days.",
      "Organizer account details are kept until the Organizer closes the account, then deleted. Billing records are kept for audit and tax.",
      "The Organizer can delete all participant data at any time from the console, once the game is over or if it was never published."),
    sub("cookies", "Cookies and storage",
      "The games use only first-party storage on the device, for settings such as the look and the language. No advertising cookies and no third-party trackers are used.",
      NAVIGATION_LINE,
      "A Global Privacy Control signal from the browser is respected: no navigation data is collected."),
    sub("rights", "Rights and questions",
      `A participant can ask the Organizer or the Grievance Officer what data is held, ask for a correction or deletion, withdraw consent, or ask another person to use these rights. Write to ${CONTACT_EMAIL} with the subject Grievance. A request is answered within 30 days.`,
      "A person under 18 is not accepted, and if one is found, the person is removed from the game and the data is deleted.",
      "Service providers for hosting, database, e-mail delivery and payment processing work under contracts that keep the data confidential and secure."),
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

/** Every paragraph of the document, with where it is. */
export const allDocParagraphs = (): { section: DocSectionId; sub: string; text: string }[] =>
  DOCUMENT.flatMap((s) => s.subs.flatMap((u) => u.paragraphs.map((text) => ({ section: s.id, sub: u.id, text }))));
const norm = (s: string): string => s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
const FINGERPRINTS = allDocParagraphs().filter((p) => p.text.length >= 40).map((p) => ({ section: p.section, text: norm(p.text) }));
/** Drift check: the sections of the document that `text` carries a copy of. A site links to DOC_URLS or renders renderDocument(), and keeps no copy. */
export const findDocumentCopies = (text: string): DocSectionId[] => {
  const n = norm(text.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'"));
  return [...new Set(FINGERPRINTS.filter((f) => n.includes(f.text)).map((f) => f.section))];
};
