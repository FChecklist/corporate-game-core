# Lucky Draw tests (from docs/LUCKYDRAW_RULES_BOOK.md)
All in `luckydraw.test.ts`; every test name starts with its rule id. Run: `bun test --isolate tests`.
- R1 one entry per person: R1 (3 tests)
- R2 closes at draw time: R2 (3)
- R3 cap 100000, rehearsal 10, "The draw is full.": R3 (6)
- R4 pause freezes registration/draw, resume continues: R4 (4)
- R5 no Organizer final say: R5 manifest/override tests, plus "R5 bun tools/conformance.ts passes"
- R6 winners count and prize list: R6 (5)
- R7 auto at time / manual by Organizer or Host only: R7 (7)
- R8 SHA-256 rank recomputed with node:crypto: R8 (4)
- R9 determinism, order independence, no double win, fewer entries than winners: R9 (6)
- R10 draw once: R10 (2)
- R11 "You won", win events then end: R11 (2)
- R12 (book rule 12 is retention; not tested, see report) — R12 tests here cover registerMany batch equals one-by-one (3)
