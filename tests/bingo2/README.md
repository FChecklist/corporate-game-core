# tests/bingo2 - Bingo tests written from docs/BINGO_RULES_BOOK.md only

Run: `bun test --isolate tests`. Files: `bingo2.test.ts`, `helpers.ts` (card maker, independent SHA-256 tie-break with node:crypto, game player).
Every test name starts with its rule id.

| Rule | Tests (name prefix) |
|---|---|
| R1-R3 card | `R1 ...`, `R2 ...`, `R3 ...` (valid card, N column + FREE, invalid cards refused) |
| R4 | `R4 order must be the 75 numbers each once` |
| R5 | `R5 a call is letter + number` |
| R6 | `R6 first call comes 2 minutes...`, `R6 gaps of 6, 9, 12, 15 ...` |
| R7 | `R7 while paused ...`, `R7 after Resume ...`, `R7 a pause in the middle ...` |
| R8 | `R8 <house> is met exactly when ...` (10 houses), `R8 stamp ...`, `R8 line counts any ...`, `R8 maximum prize lines ...` |
| R9 | `R9 a new game starts with ...`, `R9 the Organizer may change ...` |
| R10 | `R10 ...` (Claim label, no claim needed / offline, claim accepted and ignored, claims change nothing) |
| R11 | `R11 ...` (first completion call, Two Lines, FREE, one or two cards, best card) |
| R12 | `R12 ...` (one winner per line, no sharing, a seat wins a house once) |
| R13 | `R13 earlier call wins the first open line ...` |
| R14 | `R14 ...` (fate string recomputed independently, seat vs id, per-line fate, tied seats take next lines, house name) |
| R15 | `R15 ...` (countFrom, callRounds, global call numbers, running game) |
| R16 | `R16 ...` (`<id>~r<n>`, settleRounds, rounds independent) |
| R17 | `R17 ...` (running game = settleFromLog / settleRounds, settle at the call, end when all lines won, end at call 75, paused, conformance) |

Note: the book has two rules numbered 17 (settlement/end, and Marking). Marking (auto/tap) has no test: it is a setup choice with no behaviour in the module.
