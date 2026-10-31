# Corporate Bingo: zero-server-per-engagement design (proposal, 2026-10-01)

Goal (owner): server cost per engagement should be zero and must not grow with the number of participants. The 272 KB app is already in every phone, so the phones do the work.

## 1. The one idea that removes the server
Our engine is already deterministic (injected clock and random source). So **every phone runs the same engine and reaches the same state by itself**. Nothing has to be pushed to phones during the engagement.

| Thing | How it works with no server | Cost |
|---|---|---|
| **The calls (numbers)** | Number k is derived from (a) the engagement id and (b) a public, unpredictable randomness beacon round published at start time + k x call interval. Every phone fetches the same beacon value from public mirrors and computes the same number. Nobody, including the organizer, knows a future number, and anyone can verify any past one. | Free: the beacon is a public service, not ours |
| **Timing** | Start time is fixed at go-live. Each phone computes "what number are we on" from its own clock, corrected against the beacon's round time. First number 60 s after start, as already agreed. | Zero |
| **Tickets** | Already derived from the ticket id; the phone makes its own ticket. No download of tickets. | Zero |
| **Marking and "still to win"** | Local on each phone from the call log (public beacon values). | Zero |
| **Voice** | Plays locally from the cached clips. | Zero |
| **Claims (Early Five, houses, Full House)** | A claim is a small signed message: ticket id plus the call index it was made at. Anyone can check it against the public call log, so **claims are provable, not trusted**. Our rules already accept shared rewards and a claim-in-flight window, so the order of arrival does not decide a winner. Claims go to a tiny collector (see section 3). | Free tier |
| **Late joiner / reconnect** | The phone recomputes the whole history from the beacon, so no catch-up download is needed. | Zero |

## 2. Replicas on phones (redundancy without trust)
- Every phone keeps the verified call log and its claims in local storage.
- **Phones never hold the truth**: they hold copies anyone can re-verify. A phone that is edited or lost changes nothing for the others.
- If a collector is unreachable, a phone queues its signed claims and sends them when it reconnects. Ten phones dropping loses nothing because the log is recomputable.
- Optional later: nearby phones on the same Wi-Fi hand claims to one another over WebRTC. Not needed for correctness; skip until tested on real corporate networks.

## 3. What still needs a durable place (small, not per-game RAM)
| Item | Where | Why it cannot live on phones |
|---|---|---|
| Organizer login, roster, uploaded participant list, 365-day retention, reuse and history | Supabase (already planned) | Must outlive every phone; legal retention |
| Claim collector and final report | One tiny Cloudflare Worker + small store on the free tier, or the organizer's own console | Someone must hold claims long enough to build the report; the free tier (about 100k requests/day) covers it. This is a few requests per claim, not per call |
| Invoices, payments, webhooks | Server (required by Razorpay) | Money must be verified server-side |
| Brand-break links, company video | Plain links, not hosted by us | No cost |

Result: during play there are **no pings, no WebSocket, no polling, no server memory**. Cost is flat per organizer, not per participant.

## 4. Honest risks and what to do about them
1. **Beacon reachability.** Corporate firewalls may block the public beacon host. Mitigation: several public mirrors, plus a fallback where the organizer's console publishes the same values as a signed file. Must be tested on a real office network before relying on it.
2. **Phone clocks are wrong.** Phones drift by seconds. Mitigation: use the beacon's own round time as the clock; test with a deliberately wrong phone clock.
3. **Claim dispute.** A claim is checkable by anyone, but "who counts as first" in a single window is settled by the shared-reward rule, so it never needs an arbiter.
4. **Organizer's browser dies.** Calls continue (they do not depend on the organizer); only report building pauses and resumes on reopening.
5. **I have not verified the beacon service's current timing, availability or rules.** The choice of beacon (drand is the usual public one, 3-second rounds on its newer network) is a proposal; confirm its current endpoints and terms before building.
6. **Existing 100- and 2,020-participant sims** test the server-driven design. This design needs its own sims: the same game replayed on N simulated phones with random drops, wrong clocks and a blocked beacon, checking every phone reaches identical calls and the same winners.

## 5. Build plan (local first, nothing deployed)
1. Move the call generator to a pure function `callAt(engagementId, startTime, k, beaconValues)` in `packages/engine`; test determinism and no-repeat over 90 numbers.
2. Beacon client in the phone app with mirror fallback, plus a stand-in local beacon for tests.
3. Phone-side engine run from the call log; mark, still-to-win, claim signing.
4. Tiny collector (local stand-in first) and report builder.
5. Sims: 100 and 2,020 phones with drops, skewed clocks, blocked beacon; compare to the current server-driven results.
6. Keep the current server path as a fallback mode until the new one passes.

Owner decisions needed: accept public-beacon dependence (and its firewall risk), and accept that the organizer's own console, not our server, collects claims in the default mode.

## 6. Verified on 2026-10-01 (was "proposal" above)
- **drand quicknet is live.** Chain hash `52db9ba7...e971`, period 3 s, genesis 2023-08-23T15:09:27Z, scheme `bls-unchained-g1-rfc9380`; the public key in `packages/beacon` was compared byte for byte with the one the network publishes. Four public mirrors (api, api2, api3, drand.cloudflare.com) all answered over HTTPS with open CORS, so browsers can call them directly. Published round 32680188 matched the expected UTC time to the second.
- **Security:** transport is HTTPS, and every round is also checked against the network's BLS signature in the phone, so a lying or hacked mirror cannot feed a fake number (tested: forged and wrong-round answers are rejected). Randomness must equal sha256(signature).
- **One time reference:** all timing is the beacon's UTC round schedule; `packages/beacon` never reads the device clock (a test enforces this).
- **Call speeds must be multiples of 3 s** (6, 9, 12, 15). The current default of 10 s must change in this mode.
- **Not solved yet:** an unscheduled organizer pause (needs a tiny signed control message), and phones that cannot reach any honest mirror (fallback: the organizer console computes the same log and winners from the public rounds).
- **Tests:** `bun test packages/beacon` (20), `bun run tools/sim/phones.ts 100` (14 checks, real signed rounds, blocked/lying/flaky mirrors, late joiners, drops, +/-10 min wrong clocks, an invented claim).

## 7. Findings from the 10,000-phone run and the Worker work (2026-10-01)
- **10,000 simulated phones: 14/14 checks.** 9,619 phones with an honest reachable mirror held an identical 90-call log; 381 (3.8%) had no honest mirror and needed the fallback; 100 of 100 invented claims were rejected; all 7 patterns matched the ground truth; zero requests to our server during play.
- **BLS verify costs about 63 ms per round on a laptop.** A late joiner verifying 90 rounds needs several seconds of CPU (more on an old phone). Live play is fine (one round per call). **Open item:** backfill should accept history by agreement between two mirrors and verify the signatures in the background (or batch-verify), instead of blocking the join.
- **A free Worker has about 10 ms CPU, so it cannot verify BLS.** The Worker is a plain store (`apps/edge`). The organizer console verifies claims against the public log and posts the settled result.
- **Public-beacon load is large:** 10,000 phones made about 1.59 million requests (about 159 each, including retries). It cannot go through our own free Worker (100,000 requests/day), so it relies on the public mirrors and their CDN. Fewer retries and a shorter backfill reduce it; it must be tested before a 10,000-person engagement is promised.
- **Write budget:** one 10,000-person engagement uses about 10,000 D1 writes (10% of the free 100,000 a day); the Worker refuses politely at 80,000 so a busy day never fails ugly.
- **Still to build:** the participant-side code in the real phone app (the simulation proves the logic, the app does not use it yet), organizer-console verification and settle, unscheduled pause control, the real fallback, Wrangler/Pages deployment config, D1 retention (365 days, erase), roster upload/reuse and payments on the Worker.
- **Update 2026-10-01 (later):** the unscheduled organizer pause is now designed, built and simulated (signed control messages, free-CDN file, freshness rule), and the external AI work link is aligned with the zero-server mode: see `docs/AI_LINK_AND_PAUSE_DESIGN.md`. Players are mobile-only, so the office-firewall beacon risk is deprioritised.

## 8. Built and tested locally (2026-10-01, later)
Phone runtime, backfill by two-mirror agreement with background BLS check, organizer settlement from the public log, per-organizer keys and a scoped AI key (cannot publish results, erase, or sign a pause), invite lists, settings, reuse, erase, 365-day purge, signed pause with AI request/approve, payments on the Worker (Razorpay, entitlements, invoices), e-mailed sign-in codes, shared AI suggestion board, Cloudflare config. See `GO_LIVE_ZERO_COST.md`. Findings: 10,000 simulated phones pass every check; storing claims cost 78% of the free daily D1 writes, so claims are now stored only for engagements of 500 or fewer (winners never depend on them).
