# Version history of the core (0.1.0 to 0.7.0) and what each site must re-vendor
Re-vendor with `bun tools/vendor.ts <repo> --expect <version>`; the copy lands in `vendor/game-core/`. A site can jump straight to the latest version; the table says who is affected by each step.

| Version | Added | Who re-vendors |
|---|---|---|
| 0.1.0 | Engine, manifests, roles/modes/pause/flow/copy/retention, UI and wording, rules modules for Bingo, Tic Tac Toe, Snakes, Luck, reference Lucky Draw, Tambola Auto planner, rules books, vendor script with relative imports, entry points | all |
| 0.2.0 | People step rows "Add a Host" (Organizer only, max 5, own key approved later by the Organizer) and "Add a Co-host"; change list shows the role only (`core/people.ts`, `flow.ts`) | all five game sites (every People step) |
| 0.3.0 | Reaction pack: 52 text-only reactions, `reactions.ts` and `reactions.css`, demo page | all games that show reactions |
| 0.4.0 | Merge: Snakes simultaneous race and owner board (one shared 100-square board, special squares, reward = 2 throws); Tic Tac Toe owner rules (random pairing with a bye, 3-game matches, clocks, tie-breakers) | site-snakes, site-tictactoe |
| 0.5.0 | Merge: Snakes 8-minute rule; Luck owner rules (module reworked, `LUCK_RULES_BOOK.md`) | site-snakes, site-luck |
| 0.6.0 | Reaction scheduler: 2.2 s, corner strip, one at a time, 15 s gap, 15 per 10 minutes, personal vs shared, Organizer off; `createReactions(...)` replaces the old `react(id)` | every game that uses reactions |
| 0.7.0 | Merge: Tic Tac Toe stages (module and `TICTACTOE_RULES_BOOK.md` reworked) | site-tictactoe |

| 0.8.0 | Reaction pack redrawn as original work: 8 own shapes, 8 colour pairs, own wording and lettering; ids `boom`, `zap`, `wow`, `oops` renamed `big_one`, `swift`, `amazing`, `uh_oh`; `docs/REACTIONS_ORIGINAL.md` | every game that uses reactions |

Also in 0.1.x to 0.2.0, outside the numbered steps: Bingo aligned to live settle (site-bingo), Lucky Draw module `packages/luckydraw` with `registerMany` (site-luckydraw), `tools/load.ts` (no site action).
