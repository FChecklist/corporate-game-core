# Bingo on the engine: what is still missing before release

Done (core 0.1.x): Bingo manifest (Claim, 4 start/play modes, caps 100,000 / 1,000, rehearsal 20), `packages/bingo` (card, 10 houses, rules module, claim settlement), conformance runner covers it.

## Missing
1. **Call order and card issue (Bingo site):** `pickNumber` (beacon, domain `CB1`) and the unique-card permutation (`unique-ticket.ts`) stay in the Bingo repo; they feed `setup.order`, `setup.cards` and the claim `fate` (`fateOf`). Needs from site-bingo: confirmation these stay site-side and the exact `fateOf` input.
2. **Phone-side engine:** Bingo runs the same engine on every phone with a quorum of phones agreeing (`quorumFor`). The core module is a single-state reducer; the quorum/report layer is not ported.
3. **Storage/server (Cloudflare):** game record, people, claims, pause log, 20 h erase, end-of-game PDF, winners record. The core has only constants for these. Bingo's existing edge code can be reused behind the core's retention rules.
4. **UI pieces:** organizer flow screens built from `FLOW` (Bingo's own steps vs core steps), card screen, big screen, golden Claim button page, Paused banner, EN button, using `packages/ui`.
5. **Prize planner:** Tambola's Auto planner (budget splits) not extracted; Bingo needs it for Auto prizes. Manual mode works through `applyManualPrizes`.
6. **Wording:** Bingo-specific message codes (house names, "G 52" voice lines) to add to `packages/wording`; the shared set says "Ticket {t}" and needs a "Card" form.
7. **Pinning:** Bingo repo vendors the core with `bun tools/vendor.ts` (the script now includes `bingo`).
8. **Deploy:** separate Cloudflare repo, owner's yes, rollback id first, no deploy within 3 h of a live game.

## Spec conflict to decide
- 410 section 2 says ties share the prize "as Tambola"; Bingo 1.3.x (owner rule 12 Oct) gives every prize line ONE winner, decided by call then fate. The module follows Bingo's rule.
- Quorum of phones vs single authority is not in spec 410.

## Decisions (boss, 31 Oct)
- **Fate for Bingo:** Bingo has no fate number today. `fate` on a claim (`{type:"claim", player, house, fate}`) is the claimant's unique-card position (the `ticketAt` index of the seat, 0 = first card issued). LOWER goes first. It only matters when two players completed the same house on the same call (`completedAt` equal); `settleOrder` sorts by completedAt, then fate.
- **Phone quorum** (`phone-runtime.ts`, `quorumFor`) stays site-side. The core is used only for rule checks: `meets`, `completedAt`, `isValidCard`, and `settle` through the module's `step`.
- Call order, unique card issue stay site-side and are passed as `setup.order` (a permutation of 1-75) and `setup.cards`.

## Update: aligned to live settle (31 Oct)
The module now settles like the live site: from the public call log and the seat list, with no claims; fate is `sha256("CB1-TIE|eid|seat|tie|house|ordinal")` per prize line; late joiners (`countFrom`), rounds (`<id>~r<n>`) and one or two cards per seat are supported; one winner per prize line stays. The earlier fate decision (claimant's `ticketAt` index, claim fate numbers) is replaced by this; the site passes `setup.seats` (the seat number) instead. See `BINGO_RULES_BOOK.md` rules 10 to 17 and `packages/bingo/src/settle.ts`.
