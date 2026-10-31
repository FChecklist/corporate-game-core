# Bingo rules book (plain words) - what the Bingo rules module implements

Source: the Bingo site's `docs/BINGO_GAME.md` (Bingo 1.3.x). Everything not listed here (roles, joining, start modes, pause, Organizer flow, prizes Auto/Manual, retention, wording) is the common engine and is tested by the core suite.

## The card
1. A card is 5 x 5. Columns are B, I, N, G, O. B holds numbers 1-15, I 16-30, N 31-45, G 46-60, O 61-75.
2. Each column has 5 different numbers from its own range, except N, which has 4 numbers and a FREE square in the centre.
3. FREE counts as marked from the start. A card that breaks any of these is not valid and cannot be used.

## The calls
4. There are 75 numbers. Each is called once. The order is fixed by the game id and the public beacon, so nobody can predict or choose it (the Bingo site makes the order; the engine takes it as given).
5. A call is shown as letter + number, for example "G 52".
6. The gap between calls is 6, 9, 12 or 15 seconds (default 9). The first call comes 2 minutes after the start.
7. While the game is paused nothing is called and no claim is settled. After Resume the gaps carry on from where they stopped.

## The prizes (houses)
8. A house is met when its squares are all marked (FREE counts):
   - Line: any one row, column or diagonal (up to 3 prize lines)
   - Two Lines: any two different lines (up to 2)
   - Four Corners: the four corners (up to 3)
   - Plus: the whole middle row and the whole middle column (up to 2)
   - X: both diagonals (up to 2)
   - Frame: the whole outer border (up to 2)
   - Postage Stamp: a 2 x 2 block in any corner (up to 3)
   - Letter L: the whole B column and the bottom row (up to 2)
   - Letter T: the whole top row and the whole N column (up to 2)
   - Blackout: every square (up to 2)
9. A new game starts with Line, Four Corners, X and Blackout, one prize line each. The Organizer may change the set and the number of lines per house, never above the maximum.

## Claim and winners
10. The golden button says "Claim". The participant presses it when they think they have a house.
11. A claim is correct only if the card meets that house with the numbers called so far. A wrong claim changes nothing and the game continues. Claiming the same house twice does nothing.
12. Each prize line (house + ordinal: 1st Line, 2nd Line...) has exactly ONE winner. There is no sharing in Bingo (owner rule 12 Oct 2026).
13. One person can win a given house once.
14. If several people complete the same house, the one who completed it on the earlier call wins the first open line, then the next. If they completed it on the same call, a fate number given by the host site decides: the lowest goes first.
15. Claims are settled just before the next number is called (or when the Organizer or Host closes the round). Winners are chosen by software only; the Organizer's final say on prizes after the game is part of the common engine.
16. The game ends when every prize line has a winner or when all 75 numbers have been called.

## Marking
17. "auto" (default) lights called squares by itself. "tap" lets the player tap squares; a missed tap never loses a prize.
