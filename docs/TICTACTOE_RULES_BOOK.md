# Tic Tac Toe rules book (plain words) - what the Tic Tac Toe rules module implements

Source: the live Tic Tac Toe site, `docs/RULES.md` (R01-R25 game, board, clock, formats, ranking). Common-engine matters (roles, joining, start modes, pause, Organizer flow, prizes, retention, wording) are in the core suite.
The sealed seed, the bracket shuffle, who gets X and the fate numbers are made by the Tic Tac Toe site and given to the module; the module never makes them.

## A game on one board
1. The board has nine squares in three rows of three. X moves first, then O.
2. A move puts your mark on an empty square. A taken square, a square not on the board, or a move out of turn is refused. Nothing moves after the game is decided.
3. Three of your marks in a row, a column or a diagonal wins. A full board with no three in a row is a draw.

## OWNER-APPROVED RULES (31 Oct 2026). These replace the older rules below them in earlier versions of this book.
1. **Pairing.** At the start players are paired at random (the site gives the seeded shuffle). 500 players = 250 matches in round 1, then 125 in round 2, and so on. Winners are paired again at random each round. With an odd count ONE random player gets a bye (goes through without playing); nobody gets a bye twice while someone has not had one.
2. **A match is 3 games** (the Organizer may choose 1 game; default 3). X and O swap each game. A game won gives 2 points, a draw 1. After the match the player with more points goes through; the other is out.
3. **Move clock.** 10 seconds a move in games 1 to 3; 5 seconds in tie-breaker games. No 15 s and no other clock. A missed move loses that turn and the opponent moves; the opponent then gets their own clock. If both players miss, that game is a draw.
4. **Level after the match.** Up to 3 tie-breaker games at 5 s with the marks swapping. ASSUMPTION (owner to confirm): the first tie-breaker game that has a winner decides the match; if all three are drawn, the lower fate number goes through.
5. **Ranking is never tied:** round reached, total points, points in the last match played, then fate (lower wins). Places 1 to 5 are named. The champion sees "You won"; there is no Claim button. Cap 2000. Pause freezes all clocks (Organizer or Host only). The Organizer has no final say after the game.

Replaced: "a draw is replayed once, then the first mover is out", "two clock-outs in a row lose the board", the 20 s default clock and the 10/20/30/60 choices, the fixed bracket with byes only in round 1. Code: `matchWinner`, `pairRound`, `moveClockFor`, `afterMissedMove`, `pointsIn` in packages/tictactoe.

## Not in the module (site or common engine)
Team format (teams of 3 or 5), the sealed seed, move clock-outs replay, mailbox and agreed-result reports.

