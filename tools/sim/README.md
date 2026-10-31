# Simulation harness (tools/sim)

Randomized, seeded simulations that play complete games through the real rules modules in `packages/*/src` and check the invariants of the rules books in `docs/`. Test tooling only: no product file is touched.

| Script | Module | Book |
|---|---|---|
| `snakes.ts` | `snakesRules`, `ownerBoard`, `checkBoard`, `placeSpecials` | `docs/SNAKES_RULES_BOOK.md` |
| `tictactoe.ts` | `tttRules`, `pairFree`, `applyBye`, `keepAfter` | `docs/TICTACTOE_RULES_BOOK.md` |
| `luck.ts` | `luckRules` | `docs/LUCK_RULES_BOOK.md` |
| `luckydraw.ts` | `luckyDrawRules`, `winnersFor` | `docs/LUCKYDRAW_RULES_BOOK.md` |
| `bingo.ts` | `bingoRules`, `settleFromLog` | `docs/BINGO_RULES_BOOK.md` |

`common.ts` holds the shared seeded random numbers, player-count picker, argument parsing and the run loop.

## Run

```
bun install
bun tools/sim/luck.ts --games 20000 --seed 1
```

Options: `--games N` (default 100000), `--seed S` (default 1), `--from I` (first game index, default 0).
Progress goes to stderr; the last stdout line is `COMBINATIONS: <games x players> VIOLATIONS: <k>`. Exit code 1 if k > 0, else 0. The first 20 violations are printed, each with a `reproduce:` command (`--games 1 --seed S --from I` replays that one game alone), followed by a count per kind of violation.

## What a game is

Each game draws its own random inputs from `(seed, game index)`: 2 to 2000 players (edge counts 2, 3, 5, 6, 7, powers of two, odd numbers, 1999/2000, and a log-uniform spread), unique fate numbers, pauses by Organizer/Host (and refused tries by other roles), missed moves and presses, junk input, and late joiners where the module has them (Bingo `countFrom`, Lucky Draw registration up to draw time, `canJoinLate` for the elimination games). Every 1000th game (index 0, 1000, ...) is played twice and the hashes of the two outputs must match.

Checks, in short: strict total ranking (a permutation, every neighbour strictly ordered, equal to an independent sort of the book's tie chain); one holder per prize place; scores within the maximum; time totals (Luck 7:00-8:00 play, whole game <= 10:00; Snakes 7 or 8 min, game ends at the limit; Tic Tac Toe 3 x 300 s of game time, pauses excluded); cuts of 50% then 25% rounded up (Tic Tac Toe); nothing happens while paused; no NaN; no exception; Snakes: the last square is reachable from every square of every board (own reverse search), and a full re-implementation of the move rules is compared turn by turn; Lucky Draw: winners equal an independent SHA-256 oracle and the mean position of the first winner is 0.5 (needs >= 2000 draws); Bingo: winners equal a `meets`-based oracle with the SHA-256 fate string (on small games and every ~25th game) and `settleFromLog` on all games.

Notes: Snakes boards cost about 130 ms each, so 95% of games take one of 300 pooled game ids (made once per run) and 5% make a fresh one. Run time grows with player count; run several scripts or several `--from` ranges in parallel.

## Reaching 10,000,000 combinations

The average game has about 400 players, so about 25,000 games give 10,000,000 combinations (the printed COMBINATIONS shows the exact figure):

```
for g in snakes tictactoe luck luckydraw bingo; do bun tools/sim/$g.ts --games 25000 --seed 1; done
```
