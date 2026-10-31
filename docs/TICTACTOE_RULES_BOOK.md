# Tic Tac Toe rules book (plain words) - what the Tic Tac Toe rules module implements

Source: the live Tic Tac Toe site, `docs/RULES.md` (R01-R25 game, board, clock, formats, ranking). Common-engine matters (roles, joining, start modes, pause, Organizer flow, prizes, retention, wording) are in the core suite.
The sealed seed, the bracket shuffle, who gets X and the fate numbers are made by the Tic Tac Toe site and given to the module; the module never makes them.

## A game on one board
1. The board has nine squares in three rows of three. X moves first, then O.
2. A move puts your mark on an empty square. A taken square, a square not on the board, or a move out of turn is refused. Nothing moves after the game is decided.
3. Three of your marks in a row, a column or a diagonal wins. A full board with no three in a row is a draw.

## One board between two players (always one winner)
4. The first game that has a winner ends the board.
5. A drawn game is replayed at once with the marks swapped, up to three games in all.
6. If all three games are drawn, fate decides: each player has a fate number, and the lower number wins.
7. Two clock-outs in a row in one game lose the board (forfeit); the other player wins it at once.

## The knockout
8. Every player is an entrant. The bracket has the next power of two of places; empty places are byes. A bye wins without playing. Byes exist only in round 1 and two byes never meet in one pair.
9. Winners move up; the winner of the last match is the champion ("You won"; there is no Claim button).
10. A match in a later round opens as soon as both earlier matches are finished. The loser of a match is out. A match result for a match that is already decided, or naming someone who is not in it, changes nothing.

## Points and ranking (never tied)
11. A game won gives 2 points, a draw 1 point; a forfeit counts as a win for the other player.
12. The ranking order is: the round reached (champion, runner-up, semi-finalists...), total points, points in the last match played, then fate (lower wins). Every rank is unique. Places 1 to 5 are named.

## Settings and clock
13. Move clock: 10, 20 (default), 30 or 60 seconds. While the game is paused no clock runs.
14. No prizes in money. The Organizer has no final say after the game in this game (the result is final).

## Not in the module (site or common engine)
Team format (teams of 3 or 5), the sealed seed, move clock-outs replay, mailbox and agreed-result reports.

## Differences from spec 410 to decide
- Spec 410 says a tie is "replay once, then first mover out". The live site replays up to three games with swapped marks, then fate. The module follows the live site for the board (`boardWinner`). The core Elimination reference still has the "replay once, first mover out" rule.
