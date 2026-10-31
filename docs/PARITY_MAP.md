# Corporate Bingo PARITY MAP with Corporate Tambola (started 2026-10-30)
Status words: ADOPTED (same as Tambola) / ADAPTED (say how) / NOT APPLICABLE (reason from a Bingo rule) / TODO. One row per Tambola feature or combination. Sources: notes 300, 200, 210, compare report data\ui\compare-2026-10-30, Tambola tests. Tambola code: branches wip/join-redesign (live 1.8.3), feat/tambola-1.8.5-empid.
Bingo differences that drive the ADAPTED / NOT APPLICABLE rows: card patterns (Line, Four Corners, X, Frame, Blackout) instead of houses; one card per player; a called-number sheet instead of the housie board; Bingo's own prizes.

| # | Tambola feature | Status | Bingo note / evidence |
|---|---|---|---|
| 1 | Brand kit header, footer, six-item menu, games bar | ADOPTED | pages rebuilt on the kit (commit c4ea72e, merge fffcb33); brand-site.test.ts |
| 2 | Footer: Version + release date (time IST) | ADOPTED | time is added at deploy (commit 68e8f42) |
| 3 | Employee ID cleaner (NFKC, A-Z 0-9, 30 cap, old games unchanged) | ADOPTED | emp-clean.test.ts; a12c6a1 |
| 4 | Email cleaner (case-insensitive) | ADOPTED | email-key tests; f2b452f, 68712b6 |
| 5 | Email ID list criterion (Employee ID or Email ID, list decides) | ADOPTED | idKind in config, join + list upload, z.js/zc.js; email-id.test.ts (4 pass, planted break 2 fail); organizer add-box placeholder still says Employee ID |
| 6 | Same person after cleaning flagged in list check | ADOPTED | sameAfterCleaning (171392c); reply test TODO |
| 7 | Game log kept 365 days, personal data erased within 24 h | ADOPTED | gamelog.ts (B26) kept on purpose |
| 8 | 5 organizer steps + Game dashboard | ADAPTED (opt-in, untested) | shared pack vendored from the console repo; Bingo descriptor zc-flow-game.js; ?flow=new |
| 9 | Game ID always shown; status pills with plain banners | TODO | |
| 10 | Host and Co-host sign-in, roles, limits | ADAPTED (partial) | Host/Co-host keys exist; zc-flow-roles.js rules ported; approvals.ts port TODO | Bingo has Host/Co-host keys today (hostsetup.ts); screens TODO |
| 11 | Family Passes | TODO | check Bingo rules (one card per player) |
| 12 | Open join (Name, Mobile, Email) | TODO | |
| 13 | Approvals by role | ADOPTED (untested) | approvals.ts + people.ts, 30-minute lapse, 15-minute family cutoff, new games only (APPROVAL_RULES_FROM_MS placeholder) |
| 14 | Check-in "I am here" | TODO | |
| 15 | Links: common / personal / family / Co-host / Host | ADAPTED | common + personal links exist; family and Host links TODO |
| 16 | Payment lifecycle (Pay now / copy link, pending, paid) | ADOPTED | Bingo has paid games; screens to compare TODO |
| 17 | Rehearsals | ADOPTED (untested) | rehearsal.ts + mail, 3 free after payment, game ids R1-R3; new console only; big screen banner TODO |
| 18 | Claims, claim pause, heartbeat/claim signal | TODO | |
| 19 | Prizes: tags, 1-5 wins, gift, worth | ADAPTED | Bingo prizes are patterns; mapping TODO |
| 20 | Full House 1st-5th, Super Bumper, A/B ticket | NOT APPLICABLE | Bingo has one card and no housie houses |
| 21 | 24 h erase | ADOPTED | lifecycle.ts |
| 22 | Thank-you and Game completed pages (Share + WhatsApp) | TODO | |
| 23 | Rules row only inside the game | TODO | |
| 24 | Retro / Modern minimal player look | TODO | |
| 25 | Previous-screens link (?flow=old) | ADOPTED (opt-in form) | link swaps flow=new and flow=old; remembered choice TODO |
| 26 | Consent version safe | TODO | |
