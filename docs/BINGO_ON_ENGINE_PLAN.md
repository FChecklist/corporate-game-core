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
