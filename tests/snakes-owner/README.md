# Snakes owner tests
Written from docs/SNAKES_RULES_BOOK.md and the owner numbers. Run: `bun test --isolate tests/snakes-owner`.
Test names start with the rule id (R..). File: snakes-owner.test.ts.

| Rule | Tests |
|---|---|
| R6, R7 | R6 pawn starts on 1; R6/R7 move by roll |
| R8, R9 | R8 exact finish; R9 finished pawn stays finished |
| R10, R20 | R10/R20 presence miss; R10 fate mode |
| R11, R25 | R11/R25 paused; R25 game time never runs backwards |
| R12 | R12 milestone 75 |
| R13 | R13 first five finishers |
| R14 | R14 same-turn tie chain |
| R15, R24 | R15/R24 ranking; R24 never tied (300 seeds); R24 sent-out last; 2000-player tests |
| R16, R17, R26 | R16/R17/R26 survivors; R17 nobody left in |
| R18, R23 | R23 time limit, safety stop 600, no turns after game over |
| R20, R27 | R20 window 10 s; R27 windowOpen; R27 settledMs |
| R22, R42 | R22 standing; R42 playersOn |
| R30, R31, R40 | reward = 2 extra throws; penalty cuts next throw; no upgrade/downgrade on owner board |
| R34 | R34 notes |
| R36 | R36 one shared board |
| R37 | R37 squareXY |
| R38 | R38 counts, 65 different squares |
| R39 | R39 45 different lengths, 99->9, 31->80 |
| R41 | R41 plain ends, 33 plain squares |
| R43 | deterministic; reachability (independent); checkOwnerBoard rejects broken/trap boards |
| R44 | R44 squareKind |
| R45, R46 | waiting room 120 s; 7/8 choices, others read as 8; 9:00 / 10:00 totals |
| R47 | R47 reactions |

Not covered: R1-R5, R28-R29, R35 (old per-player/upgrade rules, superseded), R19/R21 are covered via move/step; R44 drawings and the Team/Table modes are site work. The book has no SHA-256 numbers for Snakes (fate and rolls come from the site), so none were recomputed.
