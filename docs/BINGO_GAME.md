# The Bingo game: rules and where they live in the code

Corporate Bingo is 75-ball Bingo. This page is the short, current description. If an older page in this folder still says "ticket", "90 numbers" or names a Tambola-style house, the code and this page are right.

## The card
- 5 x 5. Columns B I N G O hold 1-15, 16-30, 31-45, 46-60, 61-75; each column 5 different numbers (N has 4).
- The centre is FREE: it counts as marked from the first call. The organizer's logo may sit there.
- Code: `packages/shared/src/bingo-card.ts` (card, letters, the pattern table), re-exported by `ticket.ts`.
- Unique cards: `packages/beacon/src/unique-ticket.ts`. A seat number (and a second position for a second card) is mapped by a keyed Feistel permutation of all 5.5e26 valid cards, so no two cards of one game match. Tests: `unique-ticket.test.ts` (30,000 cards, 10,000 players with two cards each: no repeats).

## The calls
- 75 numbers, each once, in an order derived from the engagement id and the public drand beacon: `pickNumber` in `packages/beacon/src/index.ts` (domain string `CB1`). Nobody can predict or choose it.
- A call is shown and spoken as letter + number ("G 52"). Voice: the phone's own speech voice, Indian English (en-IN, rate 0.82, pitch 1.05) as in Corporate Tambola; wording "Next number is Gee, five two, fifty-two. Gee, fifty-two."; `apps/web/public/audio.js`. No audio files ship.
- Gap between calls: 6, 9, 12 or 15 seconds (default 9). The first call is 2 minutes after the start time.

## The prizes (houses)
One table: `PRIZE_HOUSES` in `packages/beacon/src/config.ts`, built on `PATTERN_RULES` in `bingo-card.ts`.

| id | wins when | max winners |
|---|---|---|
| line | any one row, column or diagonal | 3 |
| twolines | any two different lines | 2 |
| corners | the four corners | 3 |
| plus | middle row + middle column | 2 |
| x | both diagonals | 2 |
| frame | the whole outer border | 2 |
| stamp | a 2 x 2 block in any corner | 3 |
| letterL / letterT | the letter shape | 2 each |
| blackout | every square | 2 |

Default set for a new game: Line, Four Corners, X, Blackout. Ties share the prize; the 2nd winner of a house is whoever completes it at the next distinct call. The game ends when every prize line is awarded or 75 numbers are called.

## Who decides a winner
Software only. Each phone runs the same engine (`prize-engine.ts`, proven equal to the whole-log `settleAll` in `game.ts` by `houses.test.ts` for every pattern) and reports what it worked out; the store accepts a result when enough different phones agree (`quorumFor`). No person can add, change or remove a winner.

## Marking
`mark: "auto"` (default) lights called squares. `mark: "tap"` is tap-to-daub: only a feeling; a missed tap never loses a prize.

## Joining
The common link asks for a name only (`join: "name"`, the default). `join: "phone"` also asks for a mobile number (to match an invite list). Personal links from a list need nothing typed. One card per phone: the phone's own random id is kept as a hash.

## Money
Price ladder (up to N players, no tax added): 100 Rs 2,399 / US$ 34; 250 3,499 / 51; 500 4,699 / 67; 750 5,899 / 84; 1,000 7,099 / 101; 2,500 11,799 / 169; 5,000 17,699 / 253; 10,000 29,499 / 421 (`packages/shared/src/pricing.ts`). Orders go through the central payment service of IT Services by Rajat Agarwal when `PAY_SERVICE_KEY` is set (`apps/edge/src/pay.ts`: site `corporate-bingo.pages.dev`, product `corporate_bingo`, plans `bingo_pack_<N>` and `payment_test`); otherwise directly to Razorpay. The product never holds or pays prize money.

## No ties: one winner per prize line (owner rule 2026-10-12; acceptance BG-18 and BG-19)
- Every prize line (house + ordinal: 1st Line, 2nd Line ...) has exactly ONE winner. There is no shared prize.
- THE ONE TIE RULE, in plain words (B04, 2026-10-29): when two or more cards finish the same prize pattern on the same number, a fixed public rule puts them in order and they take the next open prize lines one by one; an earlier number always beats a later one. Nobody can choose or change the order. The screens say "same number as another card"; no screen says "fate" or "lottery", and no screen or page says that a tie shares a prize.
- If several guests complete the same house on the same call, fate orders them: each gets `sha256("CB1-TIE|<game id>|<seat>|tie|<house>|<ordinal>")`; the lowest number takes the first open ordinal, the next the next, and so on. An earlier call always beats a later one. Every phone computes it from public data only. Code: `assignOrdinals` / `fateOf` in `packages/beacon/src/game.ts`, used by both `settleAll` and `PrizeEngine.results()`.
- Ranking shown on the phone ("Winners"), the big screen, the report ("Ranking: top winners") and at prize hand-over: 1st, 2nd, 3rd ... and a top-10 list, ordered by prize value (the organizer's own prize list, first = most valuable), then call number, then fate; every row has a unique rank; a tie carries the note "N cards completed it on the same number; a fixed public rule put them in order". Code: `rankWinners` in `game.ts`.
- Tests: `packages/beacon/test/houses.test.ts` ("BG-04 / BG-18", "BG-19": ties of 2, 3 and 10 guests, stable on every phone, unique ranks 1-10, engine equals settleAll).
- Public results now name winning seats (opaque seat ids, never names) so every screen can show the ranking.
