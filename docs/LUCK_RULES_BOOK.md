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

## Differences from spec 410 to decide
- Spec 410 describes Luck as an Elimination game ("Organizer sets survivors per round", "Luck re-throw" on a tie). The live game keeps everyone playing and breaks ties by the chain above (no re-throw); the module follows the live game. Survivors per round is not built.
