# Tic Tac Toe rules book (plain words) - OWNER-APPROVED STAGE RULES, 31 Oct 2026

These replace every earlier Tic Tac Toe rule (bracket, 3-game matches, draw replay once, two clock-outs lose, 20 s clock). The sealed seed, who gets X first and the fate numbers are made by the Tic Tac Toe site and given to the module.

## A game on one board
1. Nine squares in three rows. X moves first, then O. A move puts your mark on an empty square; a taken square or a move out of turn is refused. Three in a row, column or diagonal wins. A full board with no line is a draw.

## The clock: 2:00 + 3 x 5:00
2. Waiting room: 120 seconds (2:00).
3. Then THREE stages of 300 seconds (5:00) each: 3 x 5:00 = 15:00 of play at most, whatever the number of players. On the clock: 2:00 + 3 x 5:00 = 17:00 from the opening of the room.
4. Pause (Organizer or Host only) freezes the stage clock and every move clock.

## Inside a stage: quick 1-game matches, back to back
5. With 4 or more free players nobody meets the same opponent as in their previous game (partners are swapped between pairs to remove a repeat; with 2 or 3 free players a rematch is allowed). Everybody plays 1-game matches one after another. Each free player is paired with a free player of nearby points (Swiss style), never the same opponent twice in a row, with a short pause between games. Nobody waits for a whole round.
6. Odd count: ONE free player sits out the pairing. The sit-out is chosen first among the free players who have NOT had a sit-out in this stage (the lowest-ranked of those). If every free player has already had one (small fields), the lowest-ranked free player sits out again but gets NO point for it. The sit-out point (1 point) is given at most once per player per stage.
7. X and O alternate between a player's games: if a player has X in game 1 they have O in game 2 and X in game 3, and their opponent always has the other mark. The coin (made by the host site) only decides who has X in game 1. In code: `markFor("a" | "b", gameIndex, bHasX?)` gives the mark of a side in a game (game index from 0). A game won gives 2 points, a draw 1.
8. Move clock: 10 seconds a move; 5 seconds in a tie-breaker (sudden-death) game. No other clock. A missed move loses that turn and the opponent moves, then gets their own clock. If both players miss, that game is a draw.
9. A game still running when the stage clock ends is a draw.

## The cuts and the final
10. End of stage 1: the bottom half goes out (50% stay). End of stage 2: half of the survivors go out (25% of the start stay). Rounded up; at least one stays. End of stage 3: the final ranking is made and the top five win 1st to 5th ("You won"; no Claim button).
11. Cuts and ranking by: points, then wins, then points in the last stage, then fate (lower wins). Never tied.
12. Points and wins carry over; "points in the last stage" start again each stage.

## Slots: how every phone gets the same pairing (rules 3a to 3e)
3a. Each 5-minute stage has THREE slots of 100 seconds: 3 x 100 s = 300 s. A game is at most 90 s (9 moves x 10 s) plus a 10 s pause.
3b. At the start of a slot every phone pairs the free players by points (nearby points meet). Ties are broken by sha256(game id | stage | slot | player), so everyone computes the same pairs. Never the same opponent as in the last slot. The odd one out sits out and gets 1 point, once per stage per player.
3c. A game still running at the end of its slot is a draw. A pair with no agreed result (for example a phone that was offline and made no move) is a draw too.
3d. Results enter the public log as the usual two-sided agreed-result reports; the server only relays them. Nobody can change a pairing with a result: a result for a pair the pairing did not make is ignored. If two agreed results disagree for the same pair and slot, the game counts as a draw whatever order they arrived in.
3e. Cuts after stage 1 and 2 and the final top five are computed from the log with the tie chain of rule 11 (points, wins, last-stage points, fate). Code: `clockAt`, `pairSlot`, `settleStages`, `viewFor` in `packages/tictactoe/src/stages.ts`. They are pure; the server never runs them.

## What players see
13. Live: "your place, N places to the cut line", a stage countdown, and the Reaction pack on win, draw, out and when the cut line moves. Players who are out see the live standing and the final result.
14. Reactions: each shows 2 to 3 seconds (2.5 s), never over the board, only at a fitting event, about one per 22 seconds per player, at most 15 in a 10-minute game (`reactionGate`).

## Limits and roles
15. Cap 2000 players. No Organizer final say. Settings are only the prize text and the start mode. No prizes in money.

## Code
`packages/tictactoe`: constants (WAIT_SECONDS, STAGE_SECONDS, STAGES, MOVE_SECONDS, SUDDEN_SECONDS), `pairFree`, `applyBye`, `order`, `keepAfter`, `standing`, `reactionGate`, `afterMissedMove`, `moveClockFor`, and `tttRules` (events `game` and `stageEnd`).

## Not in the module (site or common engine)
The sealed seed, the move-by-move game on the phones, the short pause between games, mailbox and result reports.
