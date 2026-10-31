# Bingo tests: rule number -> tests
Tests are written from docs/BINGO_RULES_BOOK.md only. Names start with the rule id (B1..B17; B0 = conformance/manifest). Files: `bingo.test.ts`, `helpers.ts`.

| Rule | Test names (prefix in `bingo.test.ts`) |
|---|---|
| 1 | `B1 columns hold ...`, `B1 card must be 5 x 5` |
| 2 | `B2 each column has 5 different...`, `B2 rejects ...` (duplicate, out of range, 0/76/non-integer, FREE misplaced, N without FREE, N duplicate) |
| 3 | `B3 FREE counts as marked...`, `B3 an invalid card cannot be used`, `B3 valid cards are accepted` |
| 4 | `B4 75 numbers...`, `B4 a full game calls exactly 75...`, `B4 calling follows the given order`, `B4 a tick long after...` |
| 5 | `B5 call label is letter + number, e.g. G 52` |
| 6 | `B6 gap choices...`, `B6 the first call comes 2 minutes...`, `B6 calls are one gap apart...` |
| 7 | `B7 while paused ...` (calls, claims), `B7 after Resume ...` (settle, gaps, pause before first call) |
| 8 | `B8 there are ten houses`, `B8 every house has the book's maximum`, `B8 Line ...` (12 lines), `B8 Two Lines ...` (66 pairs), `B8 <house>: exact squares...` for each other house, plus/X/Frame/Stamp/L/T/Blackout specifics, `B8 property ...` (300 cards) |
| 9 | `B9 a new game starts with...`, `B9 a game started without any housesCount...`, `B9 the Organizer can change...`, `B9 never above the maximum`, `B9 negative ...` |
| 10 | `B10 the golden button says Claim...` |
| 11 | `B11 ...` correct / wrong / repeated / unknown player / numbers-so-far |
| 12 | `B12 ...` one winner per prize line, no sharing |
| 13 | `B13 ...` one win per house per person |
| 14 | `B14 ...` earlier call, fate order (property), settleOrder |
| 15 | `B15 ...` settle before next call, round close, software-only, claim after call 75 |
| 16 | `B16 ...` ends on all lines won / 75 called, nothing after over, full property game |
| 17 | `B17 ...` auto/tap setting, claim judged on called numbers |
| conformance | `B0 ...` runner passes, manifest caps/rehearsal/start modes/Claim/final say/roles+family |
