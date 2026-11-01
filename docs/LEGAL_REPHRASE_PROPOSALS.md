# Legal rephrase proposals (for Boss and owner to decide; nothing here was softened silently)

Source: Tambola Terms 2026-10-30 (`tambola/apps/web/public/terms.html`, `refund-policy.html`) and `consent-text.json`. The one common document (Terms and Conditions with disclaimer and payments and credit policy, Privacy and Data, Game Rules) is in `packages/wording/src/documents.ts` (version 2026-11-01). Each line shows what the old text said, what the new common text says now, and a gentler option if the owner wants one.

## A. Changed only to third person (same meaning; no decision needed unless the owner objects)
| Old | New |
|---|---|
| "We make software. We do not run the games." | "IT Services does not organize, conduct or take part in any game." |
| "We do not hold, take or give any money or prize." | "IT Services does not hold, take or give any money or prize." |
| "We erase Participant Personal Data within 24 hours" | "All participant data is auto-deleted within 24 hours after the game ends." |
| Privacy Policy / Refund Policy (names of pages) | Privacy and Data; the refund text became "Payments and credit" inside Terms and Conditions |

## B. Kept as strong legal text in Terms and Disclaimer; owner may want a gentler form
| # | Now (new common text) | Gentler option |
|---|---|---|
| 1 | "A game that is not allowed may be stopped, and the fee for that game is then not returned." (old: suspend without refund on reasonable suspicion of breach) | "A game that is not allowed may be stopped. The fee for that game then stays as credit only if the stop was not caused by the Organizer." (changes the money rule: owner decides) |
| 2 | "The software is provided as is, for entertainment." (old: "as is for entertainment and engagement"; the word engagement is banned in player text, so it is dropped) | "The software is offered for entertainment, in the form it is available." |
| 3 | "...liability of IT Services to an Organizer ... is limited to the fee paid for that game." | keep (a legal position) |
| 4 | "The Organizer is responsible for loss that arises from the Organizer's own prize, tax, invitation list or dispute with a participant." (old: indemnity against loss, claim, penalty or cost) | "The Organizer takes care of anything that comes from the Organizer's own prize, tax, invitation list or dispute with a participant." |
| 5 | "Nobody may feed the pages, code, text, rules or designs to an AI system ... to copy, re-create or derive a similar product." | "Please do not use the pages, code, text, rules or designs with an AI system or another tool to build a similar product." |
| 6 | The list of Acts (Online Gaming Act 2025, Public Gambling Act 1867, Lotteries Act 1998, BNS 2023) is NOT in the new text; the old clauses 2.2, 6.1 and 7(c) named them. The new text says only that the service is not an online money game and that tickets are not lottery tickets. | Owner decides whether the named laws return as one short line. |
| 7 | The old clause 11.1 to 11.3 data-roles text (Data Fiduciary, Data Processor, DPDP Act sections) and 11.8 breach notice are NOT in Privacy and Data (the owner rule is calm, short, no legal words). | Owner decides whether a short "Roles" paragraph returns on the Terms page only. |
| 8 | Tambola old clause 12.2 "the Organizer shall not invite a person under 18; a participant found under 18 is removed and the data deleted" is in Privacy and Data in a gentler form. | none |

## C. Consent: no boxes (owner decision, 1 Nov 2026)
All tick-boxes K1 to K9 are gone. One notice below the action button: "By continuing, you agree to the Terms and Conditions, Privacy and Data, and Game rules." The server keeps the proof (document version, sha256 of the shown text, time). The old box texts (including the old K4 with name and mobile) no longer exist. The 18+ statement is plain text in clause 1.2 ("Who plays and how") and in Privacy and Data; no age answer is required by the code.

## D. Other facts the owner should confirm (true to the code, but they are decisions)
- Contact: `hello@corporatetambola.com` (subject Grievance or Billing), as Tambola already publishes. Phone and postal address of the Grievance Officer kept in Terms.
- "Winners' record 365 days": the code keeps the winner record and the prize-confirmation details 365 days; Privacy and Data says so.
- Games can be open to anyone (by link) as well as listed by employee ID or e-mail; the old Tambola text said every game is a closed group. Terms now says the Organizer decides.
- Lucky Draw Part B says winners are e-mailed once with the words "You won"; confirm that is the product behaviour.
- Optional purposes (marketing) would need their own optional tick; none exist today, so none is shown.
