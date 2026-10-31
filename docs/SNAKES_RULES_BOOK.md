# Snakes and Ladders rules book (plain words) - what the Snakes module implements (group race)

Source: the live site, `docs/RULES.md` (R1-R40). Common-engine matters are in the core suite. Boards (made from the game id, the seat and the first public random value), each turn's roll and the fate numbers are made by the Snakes site and given to the module.
Not in the module: Team race and Table mode, the board "equal hardness" test (R11), presence-window checks at the collector.

## The board
1. The classic board has 100 squares (144 and 225 optional). Every player has their own board.
2. A board has 6 to 12 snakes and 6 to 12 ladders (the default is 9 of each).
3. No snake or ladder starts on square 1 or ends on the last square, and no square is used twice.
4. A ladder climbs 8 to 30 squares. A snake drops 8 to 40 squares (scaled up on the larger boards).
5. Nobody can be trapped: from every square the last square can be reached.

## Moving
6. A pawn starts on square 1. The new square is the old square plus the roll (1 to 6).
7. Landing at the bottom of a ladder takes the pawn up; landing on a snake's head takes it down.
8. Finishing needs the exact roll to land on the last square. A roll that would pass it is not used. With the option "reach or pass", any roll that reaches or passes the last square finishes.
9. A pawn that has finished stays finished.
10. Presence mode: a player who did not throw inside the window misses that turn and stays where they are. Fate mode: every throw happens by itself.
11. While paused no turn is played.

## Prizes in the group race (golden button "You won", no Claim)
12. Milestone prize (default square 75, up to three): the first player on or past the milestone at the end of a turn.
13. End prizes: the first five to land on the last square win 1st to 5th. The game ends when the 5th prize is awarded or at the turn limit (default 60).
14. There are no ties. If several players reach a prize on the same turn: the higher square, then more ladders climbed, then fewer missed turns, then fate (lower wins).
15. The final ranking is complete, 1st to last, never tied: finishers in finishing order, then the rest by square and the same chain. At the turn limit the ranking is by square.

## Survivors per round (spec 410)
16. The Organizer may set how many players stay in after each round (a round is 10 turns by default; 0 = nobody is sent out, as the live game did). At the end of a round the front runners among those who have not finished stay in, ordered by square, then ladders climbed, then fewer missed turns, then fate; the rest are out and stop playing. Because fate ends the order there is never a tie to throw again.
17. Players who finished keep their finishing place and are not sent out. In the final order, players who were sent out come after everybody still in. The game also ends when nobody is left in.

## Changed to follow spec 410 (note for site porters)
- Old live behaviour: a race with no elimination. With survivors set to 0 the module plays exactly that.
