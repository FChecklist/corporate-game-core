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

## Winners (settled from the public calls, like the live Bingo site)
10. The golden button says "Claim". Pressing it is the player's own check; the prize does NOT wait for it. The game works out the winners from the public call list and the seat list alone, so a phone that is offline or never pressed still gets its prize. A press changes nothing (it is only a cross-check).
11. A seat completes a house at the call where its card first meets it (FREE counts; Two Lines needs two different lines). A seat may hold one or two cards; the best card counts.
12. Each prize line (house + number: 1st Line, 2nd Line...) has exactly ONE winner. There is no sharing in Bingo (owner rule 12 Oct 2026). One seat wins a house once.
13. Order of winning: the earlier call wins the first open line, the next call the next line, and so on.
14. Several seats complete the same house on the same call: each is given a fate number for each prize line, and the lowest goes first. The fate number is the SHA-256 (hex) of `CB1-TIE|game id|seat|tie|house|line number`, where the seat is the seat number the site issued (the player id if there is none) and the game id is `<id>~r<n>` for round 2 and later. The same on every phone, from public data only. The seats in that tie take the next lines in turn, before any later call.
15. Late joiners (countFrom): a seat that joined late counts only the numbers called from its `countFrom` beacon round on. Earlier calls are treated as not called for that seat, but call numbers stay the same for everybody.
16. Rounds: each round has its own call list and its own settlement, with its own game id (rule 14). A player's win in one round never affects another.
17. Settlement happens at each call, as soon as the call is made. The game ends when every prize line has a winner or when the 75th number is out. While paused nothing is called and nothing settles.

## For the host site (aligned to live)
- `init(setup, players, now)`: `setup.order` (75 numbers), `setup.cards` (per player: one card or an array of two), `setup.eid`, `setup.round` (default 1), `setup.seats` (player to seat number, for fate), `setup.countFrom` (player to beacon round, late joiners), `setup.callRounds` (the beacon round of each call, 75 numbers), `setup.housesCount`, `setup.gapSeconds`.
- `settleFromLog(eid, seats, log, houses, round, callRounds)` is the same settlement without a game in progress (the live `settleAll`); `settleRounds` does all rounds. Both return `{house, ordinal, idx, player, round, tied?}`; `idx` is the 0-based call.
- Checked against the live Bingo code (`completionIndex`, `fateOf`, `assignOrdinals`): same completions, same fate strings, same winners.

## Changed from the first version of this module
- Winners were first settled from claims (a claim with a host-made fate number). Now no claim is needed (rules 10 to 14). A `claim` event is accepted and ignored.
- The game used to stay open after call 75 for late claims; it now ends when call 75 is settled.

## Marking
17. "auto" (default) lights called squares by itself. "tap" lets the player tap squares; a missed tap never loses a prize.
