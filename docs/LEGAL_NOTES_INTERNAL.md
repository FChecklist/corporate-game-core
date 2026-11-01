# Legal document: internal notes (private, never published)

The published document (`packages/wording/src/documents.ts`, version 2026-11-01) is final text: it says nothing about review, approval or drafts. The owner approved the disclaimers in principle (UPDATE 4). This file only records choices, sources and how the text was checked.

## Sources
- Citations (only these, all already used in Corporate Tambola `legal-position.html` / `terms.html`): Online Gaming Act 2025 s.2; Lotteries (Regulation) Act 1998 s.2(b); Public Gambling Act 1867; Gherulal Parakh AIR 1959 SC 781; Chamarbaugwala AIR 1957 SC 699; Satyanarayana AIR 1968 SC 825; Lakshmanan (1996) 2 SCC 226; Puttaswamy (2017) 10 SCC 1; Shreya Singhal (2015) 5 SCC 1; IT Act 2000 s.10A and s.79; Copyright Act 1957 s.2(ffc); Income-tax Act 2025 s.393(3) Table Sl. No. 1 (formerly s.194B of the 1961 Act); DPDP Act 2023 (ss. 2, 8, 9, 12, 14) and Rules 2025; Consumer Protection Act 2019 and E-Commerce Rules 2020; Indian Contract Act 1872; Arbitration and Conciliation Act 1996. `tools/conformance.ts` fails on any other SCC/AIR citation.
- Sub-processors: Tambola privacy page (Cloudflare, Resend, Razorpay, IT Services payment service, Google sign-in, YouTube privacy mode) plus the public random-value source used by draws.
- Retention table, report timing (3 h; 24/36/72 h retries), credit rules: `packages/core/src/retention.ts` and the phrasebooks.

## Choices worth knowing
- Answer time is 7 days everywhere (Tambola privacy page said 7 days; the old Terms said 48 h to acknowledge, 30 days to settle). Disputes not settled in 30 days go to arbitration.
- Games can be open to anyone by link (old Tambola text: closed group only). Terms say the Organizer decides.
- Dropped from the old Terms on purpose (owner rule: simple, soft, no duplication): Data Fiduciary/Processor section-number detail beyond ss. 2 and 8, the breach-notice clause as a legal term (now "told to the Organizer without delay"), the Digital Personal Data Protection Rules detail, the list of prohibited uses with Act names (the Acts that matter are cited once in section 8).
- `/partner-terms` redirects to section 1 only so the old address works; partner terms are a separate agreement.
- Consent: no boxes; the notice sits below the button; the proof is `{point, version, textHash, at}`.

## Self-review (UPDATE 4, point 6)
1. Each rule once: conformance fails if a paragraph repeats, if the credit rule appears outside Payments, or if the 24-hour deletion appears outside Privacy and the retention table.
2. True to code: 24 h deletion, 3 h report to Organizer and Hosts only, retries 24/36/72 h, 365-day winners and credit, 90 d / 3 d logs, 2-minute waiting room, start/pause rules, Co-hosts cannot start or pause: all from the repo constants and rules books.
3. No contradictions: refunds only in section 2, misuse stop in section 8 pointing to section 2, data rules in 3 and 4, disputes in section 1 pointing to 7.
4. No gaps: refunds/credit, cancellation, failed payment, data rights, children, prize disputes, outages, misuse, liability cap, jurisdiction all have one home (see conformance list).
5. Provider protected: software provider only, no money or prizes held, no stakes, Organizer indemnity, liability cap, force majeure/availability, IP, termination for misuse, governing law and courts at Ghaziabad.
6. Not covered by tests: the code paths of the sites (they must really store the proof, delete on time, and send the report as the text says).
