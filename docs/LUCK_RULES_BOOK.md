# Luck by Chance rules book (plain words) - what the Luck module implements

Source: the live site, `docs/RULES.md` (R01-R33). Common-engine matters are in the core suite. Each dice round's target, each player's dice and the fate numbers are made by the Luck site from the game id and the public beacon, and given to the module.

## The game
1. A game has 1 to 20 rounds (default 10). Every round has 10 dice rounds.
2. Each dice round shows a target number from 1 to 6. Players have a press window to press the dice: 6, 10 (default) or 15 seconds. A dice round takes the window plus 3 seconds of reveal; after every full round there is a 20-second break.
3. A dice that shows the target scores that many points; any other number scores nothing. Points add up inside a round and across rounds.
4. Dice rounds are played in order; none can be skipped. At least 2 players are needed. The player list closes when the game starts.
5. While paused nothing is played.

## Ranking (never tied)
6. Most points first. If equal: the highest single hit (a 6 beats a 5). Then the most hits. Then the player who reached that score first (earlier dice round). Then fate (lower number wins).
7. So the order is always strict: a prize is never shared. Every round has its own ranking by the same chain; the overall ranking uses the running total.
8. The overall top five win 1st to 5th ("You won"; no Claim button). A prize text for places 1 to 5 of each round and of the overall ranking is the Organizer's.

## Survivors and re-throw (spec 410)
9. The Organizer may set how many players stay in after each round (0 = everybody plays on, as the live game did). At the end of a round the best players of that round, by points in that round, stay in; the others are out and no longer score. One player left standing wins at once.
10. If players are tied on points across the cut (for the last place to stay in), only those tied throw again. A re-throw is an extra dice round that does not count as one of the 10; it repeats until the tie is gone. Players with more points than the tied ones stay in without throwing.
11. The final order: players still in first (by the chain in rule 6), then players who went out, the later out the better.

## Changed to follow spec 410 (note for site porters)
- Old live behaviour: everybody played every round and ties were settled by the chain (rule 6) with no re-throw and no survivors. With survivors set to 0 the module still plays that way; the re-throw only applies when survivors is above 0.
