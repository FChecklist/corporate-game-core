# Elimination, planner and wording tests
Independent tests written from docs/TICTACTOE_RULES_BOOK.md, docs/SNAKES_RULES_BOOK.md, docs/LUCK_RULES_BOOK.md and the spec 410 text. Run: `bun test --isolate tests`.
Names start with the rule id. Where the books and the code disagree the test follows the book and fails.

| rule id | meaning | file |
|---|---|---|
| TTT1-TTT3 | one game: moves, win, draw | tictactoe.test.ts |
| TTT4-TTT7 | one board: first winner, replay up to 3, fate, forfeit | tictactoe.test.ts |
| TTT8-TTT10 | knockout: byes, champion, later matches, decided matches | tictactoe.test.ts |
| TTT11-TTT12 | points and ranking | tictactoe.test.ts |
| TTT13-TTT14 | move clock, pause, no Organizer final say | tictactoe.test.ts |
| ELIM1-ELIM5 | spec Elimination: not in time = out, loss = out, last standing, TTT tie replay once then first mover out, Luck re-throw, survivors | tictactoe.test.ts |
| ELIM6-ELIM10 | start modes, caps 2000, rehearsal 10, late join, "You won", roles (each Elimination game) | tictactoe.test.ts |
| SNK1-SNK5 | board | snakes.test.ts |
| SNK6-SNK11 | moving, finishing, presence, pause | snakes.test.ts |
| SNK12-SNK15 | milestone, end prizes, tie chain, final ranking | snakes.test.ts |
| LUCK1-LUCK5 | rounds, windows, scoring, order, pause | luck.test.ts |
| LUCK6-LUCK8 | ranking chain, strict order, top five | luck.test.ts |
| PLAN1-PLAN9 | Auto prize planner (copy of Tambola 1.9.0): sums, shares, no negatives, rounding, ties, determinism, manual list, hint | planner.test.ts |
| WORD1-WORD6 | Card/Entry nouns, Bingo codes, approved customer line, plain English, "close group" | wording.test.ts |
