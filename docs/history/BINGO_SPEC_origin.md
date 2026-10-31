# Corporate Bingo: product and build specification (version 1, 2026-10-12)

Owner brief: a second game like Corporate Tambola (close-group housie), but 75-ball Bingo, for the US market and for India. Online, played by hundreds and thousands, simple, a game people already know.

Status: SPEC ONLY. Nothing is built.

**Owner rule (2026-10-12): Corporate Bingo and Corporate Tambola are completely separate products. No file, package, database, project or secret is shared.** Wherever this spec says "reuse", it means *copy the idea or the code once into the Bingo repository, then it belongs to Bingo only*; Bingo never imports from the Tambola repository. Everything marked "new" or "decision" is not built or not decided.

---------------------------------------------------------------------------------------------------

## 1. What it is, in one paragraph
An organizer (a company, a team lead, an HR or events person) creates a Bingo game, picks a time and a size, shares one link, and pays before it starts. At the start time every guest's phone shows a Bingo card and the same numbers are called to everyone at the same moment. Each phone works out for itself when the guest has a line, four corners, an X, a full card and so on, and the winners are decided by the software, not by shouting "Bingo!". When the game ends the organizer gets a report, and the guests' personal details are deleted within 24 hours.

## 2. Principles (the same ones that make Corporate Tambola work)
1. **Known game.** Nobody needs to learn rules. The rules screen is five lines.
2. **Phones do the work.** Every phone runs the same engine and reaches the same state; the server is not involved while the game runs. Cost per game stays flat as players grow (free Cloudflare plan, see section 12).
3. **Winners decided by software only.** A phone reports a win as a vote; a win counts when enough different phones agree. No human can announce, change or dispute a winner. (reuse: `packages/beacon/src/prize-engine.ts`, `docs/WINNERS_AND_AUDIT.md`)
4. **One card per phone, unique cards.** Cards come from a collision-free keyed generator; a card is bound to one device. (copied from Tambola once: `unique-ticket.ts`, device binding)
5. **Pay before start; publishing is free.** Same commercial rule as Tambola. No refunds, only credit for 365 days. (reuse)
6. **Guests are never e-mailed.** Only the organizer and Hosts get mail. (reuse)
7. **Honest limits are stated, not hidden.** See section 16.

## 3. Product and brand (DECIDED by the owner 2026-10-12: a separate website, "Corporate Bingo", similar to Corporate Tambola)
| Question | Recommendation | Why |
|---|---|---|
| Name | **Corporate Bingo** (US marketing line: "Team Bingo for remote and hybrid teams") | Same family as Corporate Tambola; "Bingo" is the word Americans search for. |
| Same website as Tambola or a new one? | **A new, separate product: `corporate-bingo.pages.dev`**, in its **own git repository** (`FChecklist/corporate-bingo`, private), own Cloudflare Pages project, own D1 database, own secrets and keys, own legal pages. No shared files. | Your ledger template is `razorpay / IT Services / <website> / <stream> / <plan>`. A separate website gives Bingo its own clean income lines for tax. US wording, dollars-first pricing and terms are different from the India housie site. |
| Seller | IT Services by Rajat Agarwal (same legal entity, same Razorpay account). | Registered website and one ledger. |
| Currency | US$ first on the US site; INR also supported. | US customers. Needs Razorpay international approval first (section 13). |

### 3.1 Separation rules (binding)
1. **Own repository.** Created by copying the Tambola code once (a snapshot), then renamed and trimmed to Bingo. After that nothing is imported from, linked to or synced with `C:\ct\tambola`. No git submodule, no shared package, no symlink, no copied-by-script build step.
2. **Own everything else:** Cloudflare Pages project `corporate-bingo`, D1 database `corporate-bingo`, Resend sender and templates, secrets (`DATA_KEY`, `CRON_KEY`, `INBOUND_SECRET`, `PAY_SERVICE_KEY` and so on, all newly generated), cron worker `corporate-bingo-cron`, brand, logo, fonts, copy, legal pages, sitemap, analytics.
3. **Only meeting point: IT Services by Rajat Agarwal**, as the common payment service and ledger, exactly as for every other website. Bingo calls it with its own site key; nothing else is shared with Tambola.
4. **Fixes do not travel by themselves.** A bug fixed in Tambola is not fixed in Bingo, and the other way round. Each product has its own backlog. The cost of this choice is double maintenance; the benefit is that a change to one can never break the other. A fix that matters to both is made twice, on purpose, with its own test.
5. **Names:** every identifier, storage key, cache name, cookie and table prefix that says `ct`/`tambola`/`housie` is renamed in Bingo (for example `cb` / `bingo`), so the two products cannot collide even on the same browser.

## 4. The game rules (75-ball Bingo)

### 4.1 The card
- A 5 x 5 grid. Columns are headed **B, I, N, G, O**.
- Number ranges per column: **B 1-15, I 16-30, N 31-45, G 46-60, O 61-75**.
- Each column holds 5 different numbers from its own range (the N column holds 4 numbers).
- The **centre square is FREE**: it counts as already marked from the first call.
- Unique cards: 15P5 x 15P5 x 15P4 x 15P5 x 15P5 = about 5.5 x 10^26 possible cards; the keyed generator never issues the same card twice in a game (reuse the idea of `unique-ticket.ts`: seat number + keyed permutation; new generator, same pattern).
- **FREE square options (organizer):** default text "FREE"; Organizer or Host may put the company logo there (reuse the logo rules in `config.ts`: PNG/JPEG/WebP, <= 5 MB, stored <= 30 KB). The square always counts as marked.
- One card per guest by default. Organizer may allow **2 cards per guest** (Tambola has "tickets 1/2"). Four cards is a possible later option.

### 4.2 The calls
- 75 numbers, each called once, in an order that is the same for everybody and cannot be predicted or chosen by anyone: derived from the game id and the public randomness beacon, exactly like Tambola. (reuse: beacon call log, `game.ts`)
- A call is shown and spoken as letter plus number: "B 7", "G 52".
- Speed: gap between calls is one of 6 / 9 / 12 / 15 seconds (reuse the existing rule). Default 9 s. A full 75-number game at 9 s is about 11 minutes; most games finish earlier because the last prize is won before all numbers are called.
- The first number is called a fixed time after the start (reuse the 2-minute set-up window for late joiners and payment, `GRACE_ROUNDS`).
- Guests see the last number big, the last 5 called, and the full call board (75 numbers in the B-I-N-G-O layout, called numbers lit). The call board is the one thing the US game adds on screen.

### 4.3 Marking
- **Automatic marking is always computed**, because winners are decided by the software.
- Display mode, chosen by the organizer: **Auto-mark** (squares light up as numbers are called; the default) or **Tap to daub** (the guest taps a square to put a stamp on it; this is only a visual game feeling, a late or missed tap never loses a prize because the software already knows the truth). Tap to daub shows a gentle "you missed B 7" nudge.
- A guest who joins late counts only numbers called after their join plus the late-join delay (reuse: `LATE_LAG_ROUNDS` = 90 s rule and the masked call log).

### 4.4 Prizes ("houses")
Each prize is one **reward line**: pattern + scope (everyone, or per group) + ordinal (1st, 2nd, ...) + prize text. The reward-line model (`RewardLine`, `PRIZE_HOUSES`, `maxWinnersFor`) is copied from Tambola into the Bingo repository and then belongs to Bingo.

| Pattern id | What the guest must complete | Squares | Max winners |
|---|---|---|---|
| `line` | Any one row, column or diagonal (FREE counts) | 5 | 3 |
| `twolines` | Any two different lines | 9-10 | 2 |
| `corners` | The four corner squares | 4 | 3 |
| `plus` | Middle row and middle column (a cross) | 9 | 2 |
| `x` | Both diagonals | 9 | 2 |
| `frame` | The whole outer border | 16 | 2 |
| `stamp` | A 2 x 2 block in any corner ("postage stamp") | 4 | 3 |
| `letterL`, `letterT` | Shape of the letter (optional extras) | 9 | 2 |
| `blackout` | Every square (full card) | 24 + FREE | 1-2 |

- **Default prize set** the organizer starts from: Line, Four corners, X, Blackout. (4 prizes.)
- Organizer may set any number of reward lines; the app warns when the prizes are too many for 75 numbers to finish.
- **Ties (same call completes a prize for several guests):** shared reward, exactly as Tambola today: every guest who completes it on that call wins that ordinal; winners are listed together. (reuse the shared-reward rule)
- **A game ends** when every reward line has been awarded, or when all 75 numbers are called, whichever is first (reuse the "game ends when every reward line is awarded" rule, including the closing thank-you and share card).

### 4.5 Fairness rules a customer may ask about
- Nobody can see the next number before it is called.
- Nobody can choose their card.
- The software, not a person, says who won, and anyone can re-check a win from the public call log.
- Honest limit: a hacked browser cannot be made impossible; a win is accepted only when enough different phones agree (the quorum rule), so one phone cannot invent a win.

## 5. Everything around the game (copied once from Tambola into the Bingo repository, then independent)
| Feature | Copied from (Tambola, once) | Bingo change |
|---|---|---|
| Roles: Organizer, Host (<= 5), Co-host (watch and announce), AI key | `ROLES_AND_CONSOLE_SPEC_*.md` | none |
| 9-step console, big screen `/big.html` | worker, `apps/web` | big screen shows the call board and last numbers |
| Waiting room, announcements, brand breaks, lucky draw, scratch card | beacon/web | none; breaks and lucky draw are unchanged |
| Invites (per guest 1-10), people lists, personal and common links | `people.ts`, `partners.ts` | common link is the main US route (Slack, Teams, Zoom chat); personal links optional |
| Clone game, reschedule, cancel, credit | `cancel.ts`, `credit.ts` | none |
| Report PDF by link (22 h), reminder, deletion at end + 23 h, 365-day rule | `lifecycle.ts` | report adds the Bingo prize wording; nothing else |
| AI work link (free AI builds, reads, never pays or erases) | `ai-link.ts` | manifest teaches the Bingo patterns |
| E-mails (organizer, Host, payee) | see the e-mail count given 2026-10-12 | same set; wording says "Bingo" |
| Refer and earn | `partners.ts` | see section 14 |

## 6. Guest journey
1. Opens the link (common link, or personal link). Page shows game name, organizer brand and start time with a countdown.
2. Enters name and, if the organizer required it, a mobile number or an invited e-mail (decision, section 15).
3. Gets a card and an installable app shell that works offline (reuse PWA: `zsw.js`).
4. Waits in the waiting room (announcements, brand breaks).
5. Plays: calls arrive on the shared clock; the card, call board and "still to win" list update.
6. Wins: a hurray screen with confetti and a "Your prizes" list kept on the phone (reuse). Winners confirm name and mobile on their own phone for prize hand-over (reuse the prize record, kept 365 days).
7. Game ends: thank-you, share card, "extended family" invitation (reuse).

## 7. Organizer journey (the console steps)
Create engagement -> settings (name, date and time, size, speed, card count, auto-mark or daub, prizes, brand, FREE-square logo, breaks, lucky draw, invites) -> people -> publish (free) -> pay (pay before start) -> run (watch only; pause, resume, stop are signed controls) -> report -> data deleted. Identical to Tambola, with the settings page showing Bingo patterns.

## 8. Sizes and limits
Same pack ladder as Corporate Tambola: up to 100, 250, 500, 750, 1,000, 2,500, 5,000, 10,000 players. Same free-plan guards: the daily write guard (80,000), pause-check scaling by size, claims stored only up to a size limit, join costs 2 database writes. (reuse `pricing.ts`, `PACKS`, mode guards). A Bingo game has fewer numbers (75 vs 90) so it is never heavier than a Tambola game of the same size.

## 9. Pricing (DECIDED 2026-10-12: keep the Corporate Tambola price ladder)
The same ladder, shown in US$ and INR; no GST while the seller is not GST registered. The numbers are written into Bingo's own pricing file (`packages/shared/src/pricing.ts` of the Bingo repository). It is a copy: if the owner later changes Tambola prices, Bingo prices do not change unless changed there too.

| Players | US$ | INR |
|---|---|---|
| 100 | 34 | 2,399 |
| 250 | 51 | 3,499 |
| 500 | 67 | 4,699 |
| 750 | 84 | 5,899 |
| 1,000 | 101 | 7,099 |
| 2,500 | 169 | 11,799 |
| 5,000 | 253 | 17,699 |
| 10,000 | 421 | 29,499 |
Plan ids on the central ledger: `bingo_pack_100` ... `bingo_pack_10000` and `payment_test`.

## 10. Data and rules for the build ("new" work)
1. Game type: add `game: "tambola" | "bingo"` to the engagement config; every Bingo-specific rule keys on it. Existing games are `tambola`.
2. Card generator: `packages/shared/src/bingo-card.ts` (new): 5 x 5 card, FREE centre, column ranges, keyed unique generation from seat, 2-card option.
3. Number order: same beacon derivation, but a 75-number permutation (new function next to the 90-number one).
4. Patterns: `packages/beacon/src/config.ts` gets the Bingo pattern ids and labels (new `BINGO_HOUSES`); `prize-engine.ts` and `settleAll` learn "completion index" for each Bingo pattern (new code, same incremental design and the same parity test against `settleAll`).
5. Voice: 5 new clips (B, I, N, G, O) plus numbers 1-75 in English (US) from the existing number clips; a Hindi set optional. (new audio assets; check the existing clips' language first)
6. Phone UI: card, call board, last numbers, daub mode (new screens in `apps/web/public`, same style).
7. Settings page and AI manifest list the Bingo patterns.
8. Report: patterns and prize names in Bingo wording.
9. Payments: orders go through the central payment service (section 13); the plan id is `bingo_pack_<N>`.
10. No new database table is expected; the `engagement.config` JSON carries the game type and Bingo settings.
11. The service worker cache name is bumped when game files change shape (reuse the rule).

## 11. Tests required before launch (all new tests, same style as today)
- Unit: card generator (ranges, 24 unique numbers, FREE centre, no duplicate cards in 10,000), call order (permutation of 1-75, same on every phone), every pattern (positive and negative cases including FREE), ties.
- Parity: incremental prize engine equals `settleAll` for every Bingo pattern (same parity test as Tambola).
- Simulation: the existing sim2 harness run with `game: bingo`: life-cycle scenarios (cancel, clone, credit, erase, late pay, reschedule, report), the 30-phone virtual-time game, the 2-phone real-Chrome game, the matrix (config, houses, roles, people, brand), UI scenarios.
- Payment: central order and verify for the Bingo site, a real Rs 1 / US$ 1 test payment, webhook rejection fixed first (section 13).
- Load: 2,000 and 5,000 simulated phones; write counts inside the free-plan guard.

## 12. Cost
Zero new server cost: its own free Cloudflare Pages project, Functions and D1 database (separate from Tambola's). Mail through the same Resend account. No new paid service. (Owner rule: never add paid add-ons without a yes.)

## 13. Money (in and out) through IT Services by Rajat Agarwal
- Every Bingo sale is an order opened through the central payment service: ledger line `razorpay / IT Services / Corporate Bingo / sales / bingo_pack_<N>`. New site key for `corporate-bingo.pages.dev` (one `site` row, `plan_catalog` rows for each pack). No new code path in the central service.
- Refer and earn, sales-team commission and sales-team salary use the same template with their own streams (`refer_and_earn`, `sales_team_commission`, `sales_team_salary`).
- **Prerequisites that block a US launch:** (1) the Razorpay webhook secret mismatch must be fixed (today every real event is rejected); (2) Razorpay must approve **international cards** on the account so US$ payments work; (3) a lawyer and a CA must read the US terms and the tax position of selling to US customers.

## 14. Refer and earn for Bingo (concept, not decided)
The tier idea discussed on 2026-10-12 (cumulative billing; 10% at 5,000, 20% at 10,000, 50% at 50,000; the new rate applies to the whole cumulative amount) can apply unchanged to Bingo. Open decisions are listed in that discussion (reset period, the 50,000 cliff, payout timing, below 5,000, disputes, TDS). For US partners, payouts and tax forms (a US person receiving money from an Indian seller) need separate advice.

## 15. US-specific points (decisions and risks)
1. **Who is a guest?** Tambola identifies guests by mobile number and uses WhatsApp-style personal links. US teams share a link in Slack, Teams or Zoom chat. Decision: the **common link** is the main route; a guest enters a name only (optionally an e-mail the organizer chose to require). Guest e-mails are still never mailed.
2. **Prizes and law.** In the US, a game where players pay and win prizes can be treated as gambling or a lottery. Corporate Bingo is sold to the organizer as software; guests must never pay to play and the product must never hold or pay out prize money. Terms must say so. Needs a US lawyer.
3. **Privacy.** US state privacy laws (California and others) and US employees; the existing 24-hour deletion and 365-day winner record are a good base; the privacy page needs a US version.
4. **Accessibility.** WCAG contrast and screen-reader labels on the card; the existing automated accessibility checks run on public pages and must include the Bingo pages. (Note: the repo's e2e accessibility sweep already shows contrast failures on some pages; fix those first.)
5. **Time zones and language.** US time zones with daylight saving, 12-hour clock, US English wording ("daub", "blackout").
6. **Holidays and use cases.** Marketing set: virtual holiday party, all-hands opener, new-hire welcome, customer event, Friday team break. A "Holiday Bingo" theme pack (colours, FREE-square logo) is a later add-on.
7. **Support hours.** Selling to US teams means support questions in US hours; the AI work link and written guides must carry more of the load.

## 16. Honest limits (state them to customers)
- Winners are accurate only if enough phones agree; a determined cheater with a modified browser is limited, not impossible (same limit as Tambola).
- Clearing browser data gives a guest a new device id.
- Results depend on the public randomness beacon being reachable from the guest's network; offices that block it need the fallback (section 4 of `ZERO_SERVER_DESIGN.md`, already handled by mirrors).
- The organizer's console only watches; if it is closed the game continues.
- Games above about 2,000 players stop registering the pause check (existing free-plan rule).

## 17. Build plan (phases, each with an exit test)
| Phase | Work | Exit test |
|---|---|---|
| B0 | Decisions (section 18) and the Razorpay prerequisites | Owner answers; webhook fixed; international approved |
| B1 | Create the private repository `corporate-bingo` by a one-time copy of the Tambola code; rename everything (section 3.1 rule 5); then write the card generator, call order, patterns and parity | Repository builds alone with no path to `C:\ct\tambola`; unit and parity tests green |
| B2 | Phone UI: card, call board, daub mode, voice | 2-phone real-Chrome game finishes with identical winners |
| B3 | Console, settings page, AI manifest, report wording | UI scenarios green |
| B4 | Own Pages project, own D1 database, own secrets and cron, central payment site key and plans, legal pages, accessibility | Rs 1 / US$ 1 real payment appears in the central ledger as `Corporate Bingo / sales / payment_test` |
| B5 | Full simulation: life-cycle, matrix, 30-phone, 2,000- and 5,000-phone loads | All green, writes inside the guard |
| B6 | Soft launch with 2-3 friendly organizers, then public | First paid game end to end, report received, data deleted on time |

## 18. Decisions the owner must make
1. ~~Name and site (section 3)~~ DECIDED 2026-10-12: Corporate Bingo, a separate website similar to Corporate Tambola.
2. ~~Pricing~~ DECIDED 2026-10-12: Tambola's price ladder.
3. Guest identity for the US (section 15.1): name only, or e-mail required by the organizer.
4. Refer and earn tiers (section 14).
5. Default prize set (section 4.4): Line, Four corners, X, Blackout.
6. Cards per guest: 1 only at launch, or 1 or 2.
7. Voice: English (US) only at launch.
8. Legal: engage a US lawyer for the terms; a CA for the tax position.

## 19. Acceptance criteria (testable)
- BG-01 Every card has 24 distinct numbers in the right column ranges and a FREE centre; 10,000 issued cards in one game are all different.
- BG-02 All 75 numbers are called exactly once, in the same order on every phone.
- BG-03 Each prize pattern completes on the exact call where its last square is marked, never earlier; FREE counts.
- BG-04 Two or more guests completing the same prize on the same call are all recorded as winners of it.
- BG-05 Winners come from the software only; the console cannot add or change one.
- BG-06 A late joiner sees only numbers called after their join plus the delay; prizes already awarded stay awarded.
- BG-07 A game ends when every prize is awarded or 75 numbers are called.
- BG-08 One card per device per game (two if the organizer allows two).
- BG-09 Unpaid games do not begin; a late payment starts the first call two minutes after confirmation.
- BG-10 Orders for the Bingo site appear in the central ledger as `Corporate Bingo / sales / bingo_pack_<N>` and a paid test payment is recorded there.
- BG-11 The report arrives about 3 minutes after the end, the link works for 22 hours, guest data is deleted at end + 23 hours, winners are kept 365 days.
- BG-12 No guest e-mail address or number is ever mailed; only the organizer and Hosts receive mail.
- BG-13 A 5,000-phone simulated game finishes inside the free-plan write guard.
- BG-14 The card and call board pass the accessibility check and fit a 390 px phone without sideways scrolling.
- BG-15 Separation: the Bingo repository contains no import, path, submodule or link to the Tambola repository; a search for `tambola`, `housie` and `ct4f` finds nothing except history notes; it builds, tests and deploys with Tambola's folder deleted.
- BG-16 Separation: Bingo has its own Cloudflare Pages project, D1 database, secrets, cron worker, sender identity and storage and cache names; changing or deleting any of these in Tambola changes nothing in Bingo.
- BG-17 The price ladder equals Tambola's at the time of building, held in Bingo's own pricing file.
