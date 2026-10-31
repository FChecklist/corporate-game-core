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

## Owner decision, 31 Oct 2026: the simultaneous race (replaces the "turn limit as the main end")
Everyone plays at once, each on their own board. No groups of 6.
18. The game starts for all players together (auto or manual start, as for every game).
19. Every player throws their OWN dice on their own board.
20. Each player has a 10-second window per throw, clocked per player (`WINDOW_MS` = 10000). A player who does not throw inside the window loses that throw (they stay where they are and it counts as a missed turn); their next window opens 10 seconds after the last one opened (`nextWindowAt`). This is presence mode; fate mode throws for the player.
21. The pawn moves by itself by the roll; snakes, ladders, rewards and punishments apply as in rules 6-9.
22. Each board shows "N ahead of you, M behind you" (`standing(state, player)`). Ahead = players on a higher square, behind = players on a lower square; players on the same square are neither, and finishers count as ahead of everyone who has not finished. "K players within 5 squares" is also given (`within`) and may be left out of a screen.
23. The game ends at a time limit, default 10 minutes (`timeLimitMs` = 600000), set by the Organizer. It replaces the 60-turn limit as the main end; the turn limit stays only as a safety stop (default 600). The game also ends when the 5th prize is awarded or nobody is left in. The time is game time: it does not run while paused.
24. At the end the winner and the full ranking are declared: finishers first in finishing order, then everybody else by square with the tie chain of rule 14 (square, ladders climbed, fewer missed turns, fate). `winnerOf(state)` is the first of the ranking. Nobody is ever tied.
25. Pause freezes all clocks: player windows, the time limit and the round clock. The site passes game time (`gameMs`, from the core clock) on every turn event, never wall time.
26. Survivors per round (rules 16-17) stays optional; the default is 0 (nobody is sent out).
27. The 10 seconds between two throws of the same player is also the settle time. In that gap the system applies the move, the snake or ladder effect and recounts "ahead / behind" for everybody. The next window opens (`windowOpen`) only when the 10 seconds have passed in game time and the turn that opened the previous window has settled (`settledMs`). The clock is per player and a pause freezes it (rule 25).

## Optional special squares (owner addendum, 31 Oct 2026)
The coin moves by itself and the square it lands on acts on it. Besides snakes (down) and ladders (up) there are four optional special squares. The Organizer switches them on under More options; the count of each kind defaults to 0, so a game with no change plays exactly as before.
28. Upgrade: jump forward N squares (N is 1 to 6, default 3; scaled on larger boards). The pawn never lands past the square before the last, so an upgrade never finishes the game. Message: "Upgrade! Forward 3 to 41".
29. Downgrade: step back N squares (same N), never below square 2. Message: "Downgrade! Back 3 to 38".
30. Reward: one extra throw; the player may throw again at once, without waiting for the gap (`hasExtra`). Message: "Reward! One extra throw".
31. Punishment: the player loses the next throw; that window passes with no move and no missed-turn mark. Message: "Punishment! You lose your next throw".
32. Placement (`placeSpecials`): special squares never sit on square 1 or the last square, never share a square with a snake, a ladder end or each other, and never trap anyone (the last square is still reachable from every square; the board check includes them). A board that would break these keeps its plain squares.
33. A special acts only when the pawn lands on it by a throw. Where an upgrade or downgrade sends the pawn does not act again (no chains).
34. Every effect shows a short plain message on the board (`noteFor`): "Ladder! Up to 38", "Snake! Down to 12", and the four above. The message stays on the pawn until the next throw.
35. Fairness: the site gives every player's board the same number of each kind. Ties and the ranking are unchanged.

## Owner board (31 Oct 2026) - supersedes rules 1-5, 28-29 and the reward of rule 30 for the live-style board
36. ONE board for everyone: every player gets the same board and all pawns are shown on it (`setup.board`; per-player boards from rules 1-5 stay only for old games).
37. 100 equal squares. Square 1 is bottom-left; 1 to 10 run left to right; the next row up runs right to left (11 at the right edge, 20 at the left); the next row runs left to right (21 to 30); and so on up to 100 at the top (`squareXY`).
38. Fixed counts: 30 snakes, 15 ladders, 10 penalty squares, 10 reward squares. These 65 squares are all different and none is on square 1 or 100. (The earlier 6 to 12 snakes and ladders no longer applies to this board.)
39. Every snake and ladder has a different length (all 45 lengths differ, at least 3). The longest snake has its head on 99 and takes the pawn to 9 (length 90). The longest ladder starts on 31 and goes to 80 (length 49).
40. Reward: 2 extra throws (`REWARD_THROWS`). Penalty: the player's next throw is cut. (Upgrade and downgrade squares of rules 28-29 are not used on this board.)
41. A snake or ladder ends on a plain square (not on any of the 65). There are only 33 plain squares, so several snakes or ladders end on the same plain square; the "no square used twice" rule applies to the 65 squares that DO something, not to landing squares.
42. Each square shows how many players are on it (`playersOn`), and each player still sees "N ahead of you, M behind you" (rule 22).
43. The board comes only from the game id (`ownerBoard(gameId)`): same on every phone and the server. It is checked by `checkOwnerBoard`, which proves the last square is reachable from every square (exact finish, rolls 1 to 6, snakes and ladders applied) and checks every count and length above. If a game id's first try is not sound the next fixed try is used, still from the id alone.
44. Look (site work, not the module): every square, snake, ladder, reward and penalty has its own clear drawing in the Retro and Modern looks, no human faces, readable at 44 px touch size and 360 px width (`squareKind` says which drawing a square needs).

## Owner timing rule (31 Oct 2026) - changes rule 23
45. Waiting room 2 minutes (120 seconds, fixed; `WAITING_ROOM_MS`). Then about 7 to 8 minutes of play, then game over: about 10 minutes in all.
46. The game length is 8 minutes by default. The Organizer may choose 7 or 8 only (`TIME_LIMIT_CHOICES_MIN`); any other value is read as 8. This replaces the 10-minute default of rule 23. The time is game time and does not run while paused.
47. Reactions (core Reaction pack): a throw shows its reaction word through `reactionOf`: snake_bite, ladder, upgrade, downgrade, extra_throw (reward), missed_turn (penalty or a lost throw), finish, six.
