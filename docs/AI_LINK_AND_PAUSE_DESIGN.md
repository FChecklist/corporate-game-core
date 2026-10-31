# External AI work link, and unscheduled pause without a server per player (design + what was built, 2026-10-01)

Owner requirements (2026-10-01): players use **mobile phones only**; server cost zero; AI cost zero (the organizer's own AI, on the organizer's own machine); no server RAM during a game; hundreds to thousands of simultaneous players. Corporate-firewall cases for phones are out of scope (mirror fallback stays, no effort spent on office networks).

Design note for the AI link and the pause control. It is built and live (see `/version.json` on the site and `docs/DEPLOYS.md`).

## 0. Summary

| Part | State |
|---|---|
| A. AI work link | **Already existed** (CR-07, `apps/server/src/ai-link.ts`, 30 tools, manual, MCP/OpenAPI/REST, draft+confirm, 69/69 persona checks). I checked it against the DPDP link pattern, found the gaps listed in A.4, and built the minimum that was missing: a **jobs list and a "what a chat that can only GET cannot do" section in the manual**, and the **zero-server pause tools** (`get_control_status`, `request_control`). |
| B. Signed pause/resume/extend/stop | **Built**: protocol + pure schedule function + phone-side tracker + publisher (`packages/beacon/src/control.ts`), local server routes, a Cloudflare Worker (write path only, not deployed), organizer browser helper, and a phone simulation (`tools/sim/pause.ts`). |
| Not built | Phone UI (play.js is being edited by another session), the console's Pause button wiring, key backup, real CDN deployment, brand breaks / rounds expressed as beacon-round pauses (see B.9). |

## A. External AI work link

### A.1 Where Bingo needs AI today

No model runs on our servers. I searched `apps/`, `packages/` and `tools/` for any AI vendor call: none. "Calling mode: ai" in the engagement settings means the **automatic caller** (a random number generator on a timer), not an LLM; consider renaming it to "Automatic" so organizers do not think we pay for AI.

| Job | Who does it today | With the external AI link |
|---|---|---|
| Set up engagement (name, date, time zone, ticket mode, family rules, calling mode) | Organizer in console | AI: `update_settings` (direct, editable until Start) |
| Write reward texts | Organizer types them | AI drafts the words, `set_rewards` applies (direct, editable until Start) |
| Brand breaks (title, link, speech/slide text, position) | Organizer | AI drafts words, `set_brand_breaks` (max 3, positions spread by the system) |
| People: paste, clean, de-duplicate, reuse past lists, Hosts / Team Leads | Organizer | `check_people` (dry run), `add_people`, `reuse_people` (after `preview_reuse`), `set_roles` |
| Invitation message, Host and Team Lead messages | Organizer | `get_share_info` gives ready text; the AI rewrites it in the organizer's voice; the organizer sends it (the AI cannot send) |
| Day of the event: admit people, phone alerts | Organizer / Host | `admit_waiting`, `decline_waiting`, `resolve_phone_alert` |
| Emergency pause / resume / stop | Organizer | **Draft only** (`request_control`); the organizer's own browser signs (Part B) |
| Start, End, remove people, erase saved details, raise limit | Organizer | **Draft only**; organizer opens the confirm link and taps Confirm |
| After: report in plain words, thank-you note, summary for leadership | Organizer reads the report | `get_report` (read) then the AI writes the words; nothing is applied |
| Surprise moments (lucky draw, scratch card) | System draws at random | `update_settings.surprise` (before Start), `start_moment` (only when set to manual; the system picks winners, the AI cannot) |
| `tools/sim/ai-persona.ts` | Test harness playing "the organizer's AI" | Not a product feature |

### A.2 The link (what exists, mapped to the DPDP pattern)

DPDP's `dpdp-ai-link` was the model (read `README.md`, `manual.ts`, `router.ts` in `cb-aibridge/supabase/functions/dpdp-ai-link/`; the file is not in the main `C:\ct\ct` checkout, only in the `cb-*` worktrees).

| DPDP link | Bingo link |
|---|---|
| One secret capability URL per person, token in the path, token only hashed at rest | Same: `/ai/tbl_<64 hex>`, SHA-256 stored, one live link per organizer, a new link kills the old |
| Manual at the same address, `?format=md/json`, personalised briefing | Same address serves Markdown (or JSON with `Accept`), with the organizer's state fenced as data |
| Short copy-paste prompt | `promptFor(link)` (also in the order e-mail) |
| Levels 0 read / 1 small edits direct / 2 legal weight = drafts only | `read` link or `standard` link; changes that cannot be undone are `confirm` kind = drafts |
| Confirm link opened by the signed-in person; confirm token in the URL fragment so it never reaches logs | Same: `/confirm/<draft>#<code>`, code only travels in the JSON body of two calls |
| Expiring and revocable | 1 / 7 / 30 days (default 30), revoke from the dashboard, call log written before answering, 120 calls a minute |
| Undo window for direct edits (24 h) | **Not built** (see A.4) |
| MCP / OpenAPI | Same: one tool list feeds manual, REST, OpenAPI and MCP |

**Draft vs confirm** (enforced by `kind` on each tool and tested):

| The AI may do directly | The AI may only DRAFT (organizer confirms on a page while signed in) | The AI can never do (no tool exists) |
|---|---|---|
| settings, rewards, brand breaks (before Start), add/reuse people, roles, passes, admit/decline, phone alerts, manual draw, start a manual moment | Start, End, remove people, erase saved details, raise limit (money), **request_control** (pause/resume/extend/stop; needs the organizer's signature as well) | claims, winners, numbers, rules after Start, payment, sign-in, code changes, signing anything |

### A.3 What was added in this branch

1. **Manual**: new "Jobs you may be asked to do" section (read-only jobs, drafting-words jobs, applying jobs, phone-only pause) and "If you can only open web addresses" section; a "cannot sign a pause" line in "What you can never do".
2. **`get_control_status`** (read) and **`request_control`** (confirm kind). The confirm page signs with the key in the organizer's browser (`apps/web/public/confirm.js` + `control.js`); the server refuses a missing, wrong-key, or wrong-action signature **without burning the draft**, and strips any `__signed` the AI tries to smuggle in through draft parameters.
3. The older `pause_engagement` is refused with a plain message for phone-only engagements (it would not reach phones).
4. Tests: `apps/server/test/ai-link.test.ts` (confirm list updated), `ai-coverage.test.ts` (control routes covered or exempt with reasons), `tools/sim/ai-control.ts` (16 end-to-end checks incl. forged/wrong-action/smuggled signatures), `tools/sim/ai-persona.ts` still 69/69.

### A.4 What a chat AI that can only GET cannot do, and other honest limits

- It can read the manual and every read tool (GET with query values). It **cannot POST**, so it cannot apply changes itself. The existing `/plan?b64=` GET route records a small plan and returns a confirm link, which gets it as far as a draft; the organizer applies it. It cannot confirm, sign, pay, send messages, or open our console. It must say so rather than pretend.
- Which chat products can POST is vendor-dependent and **I did not test any real chat product**: live acceptance with ChatGPT / Gemini / Claude is the owner's run.
- No undo for direct edits (DPDP has a 24 h undo). Cheap to add later because every direct change already goes through console routes.
- Privacy (DPDP): mobile numbers are masked in everything the AI reads; **names and departments are visible to the organizer's AI vendor** (the organizer's own processor; disclosed in the e-mail and dashboard). Recommended optional setting: "initials only" for the AI (not built). The control log and control file contain **no personal data at all**.
- The link server itself still has to exist (organizer console, Supabase later). It is per organizer, tiny, and not per player; it costs no AI.

## B. Unscheduled pause / resume / extend / stop

### B.1 Message

`{ engagementId, seq, action: pause|resume|extend|stop, atBeaconRound, signedAtRound, untilRound?, sig }`, signed with **Ed25519** (WebCrypto `Ed25519`, `@noble/curves` as verify fallback). The public key is registered **once** when the engagement is created/set up (before Start) and can never be swapped. The private key is generated in the organizer's browser as a **non-extractable** `CryptoKey` in IndexedDB, so nothing can read it out; the server and the CDN never see it. Signed bytes: `CBCTL1|id|seq|action|at|signedAt|until`.

### B.2 Rules (pure function `resolveControl`, same result on every phone)

- `seq` is 1, 2, 3... A phone accepts the longest gap-free prefix it can verify. Order, duplicates, stale answers and replays cannot change the result. A second different message under a used `seq` is not believed.
- A message that is validly signed but breaks a rule (too little lead, not paused, already stopped...) **takes no effect but still uses its seq** (deterministic). The publisher refuses such a message up front so the console tells the organizer immediately.
- `pause`, `extend`, `stop` must take effect at least `leadRounds` after `signedAtRound` (B.4). `resume` needs only to be after signing.
- A pause has an optional `untilRound` (a timed break; `extend` moves it later; `resume` ends it early). An **open-ended pause ends by itself after `maxPauseRounds`** (default 600 = 30 min, fixed at registration) so a lost organizer cannot freeze the room forever.
- `stop` is final: no call at or after its round; later messages are ignored.

### B.3 The schedule shift (why every phone converges)

Today call `k` uses beacon round `start + k*stride` (stride = call seconds / 3, so **call speeds stay multiples of 3 s**: 6, 9, 12, 15). With pauses `[P, E)`: start with `a = start + k*stride` and for each pause in order, `if a >= P then a += E - P`. A pause shifts all later calls by exactly its length, so the gap between calls is still `stride` rounds; no call can land inside a pause. Example (6 s calls, start round 1000): pause rounds 1011..1040 (90 s). Calls 0..5 use 1000..1010; call 6 (nominally 1012) becomes 1042; every later call is 30 rounds later. A pause spanning many calls, two pauses (a call pushed out of the first can land in the second and is pushed again), and a call exactly on the first paused round are covered by unit tests. A **late joiner** fetches the whole log (a few hundred bytes), verifies it, and computes the identical schedule (tested).

The call's number is `pickNumber(engagementId, k, randomness(round a_k), already called)` as before: nobody can know a number before its round is published, and pausing does not reveal anything.

### B.4 The safe default when the control file is missing, stale or lying

The danger is not an outage; it is a phone that **shows a number a pause (it has not heard of) would have forbidden**. The rule that removes it:

- A phone reveals new calls only while its last good control fetch is at most `holdAfter` old (**live**). Beyond that it keeps tracking the beacon but shows "Checking with the organizer..." and does not reveal (**hold**). It never guesses.
- A pause signed right after a phone's snapshot takes effect `leadRounds` later, and `leadRounds*3 s > holdAfter + cache TTL + margin` (`deriveSafety`, proved as an inequality over a grid of parameters in the tests). So any call a live phone reveals is earlier than any pause it could not yet have seen.
- Standard profile (poll 9 s +/-3, edge cache 3 s): hold after 30 s, **pause takes effect 39 s after the organizer presses it**, give up after 180 s. Fast profile (poll 6 s +/-1): hold after 21 s, pause lead 30 s.
- **Blind** (give-up): only after an unbroken run of *failed* attempts for `giveUp` (180 s). A phone that was merely offline made no attempts and cannot go blind (this was a real bug the 2,000-phone sim found and I fixed). Blind phones carry on as if no message exists, with a visible flag; if a pause was in fact issued they may show numbers that are later contradicted, but they re-derive the true log on their first good fetch (simulated: all converge). Recommendation to owner: accept this, because a CDN dead for 3+ minutes is the one case where "freeze everyone" is worse than "carry on".
- A lying mirror (forged or other-engagement messages) makes the **whole answer** count as failed; the phone tries the second mirror.
- **Pause is not instant**: 30-39 s, i.e. up to ~6 numbers at 6 s calls may still be called after the organizer presses Pause. That is the price of no push channel; say it in the UI ("Pausing in 39 s").
- Phones in the background: timers stop; on returning to the foreground the phone polls immediately and holds until it has a good answer.

### B.5 Where the file lives (free tier)

Phones need exactly one thing: `GET https://<control-domain>/control/<id>.json` (about 160 bytes plus ~150 per message, no personal data, CORS open). Options (limits are **my recollection of Cloudflare's free tier, not verified today; confirm before relying**):

| Option | Phone reads | Free limit | Verdict |
|---|---|---|---|
| Worker (+KV) answering every poll | Worker invocation per poll | 100,000 requests/day | **No**: 2,000 phones at 9 s = 800,000 an hour |
| R2 bucket straight, no cache | R2 Class B read per poll | 10 million/month | Works for small events (about 12 hours of 2,000 phones a month); not for scale |
| **R2 behind a Cloudflare custom domain with a 3 s edge cache (recommended)** | Served from the CDN cache; R2 is read about once per 3 s **per edge location**, not per phone | CDN cache hits are not metered on free; R2 reads ~1,200 per location-hour | **Yes**: cost independent of phone count |
| Cloudflare Pages static file, deploy per message | Static asset (unlimited) | 500 deploys/month, deploy latency 10-30 s adds to the lead | Fallback if the cache rule cannot be made to honour a 3 s TTL |

Write path: `tools/control-worker/worker.ts` (Worker, not deployed): `POST /control/<id>` verifies the signature (no login needed, the signature **is** the authorisation) and writes the file to R2; `PUT /control/<id>/key` registers the public key (needs a shared secret held by our backend). It runs a handful of times per engagement. Same `publishControl`/`registerKey` code as the local server, tested against a fake bucket. R2 has no compare-and-swap, which is fine with one organizer publishing one message at a time.

**Top open technical risk:** whether the free plan honours a **3 second** `s-maxage` from the origin (I recall a multi-hour minimum for some cache *override* settings). This must be tested on a real free zone before any promise is made. If it cannot, use the Pages fallback or a longer TTL with a longer lead.

### B.6 Request-count math (2,000 phones)

Per phone per hour = 3600 / poll seconds. Phones poll only while an engagement is live and stop at Stop / end.

| Poll | Per phone-hour | 2,000 phones, 1 h | 2,000 phones, a typical 25-minute event |
|---|---|---|---|
| 6 s | 600 | 1,200,000 | 500,000 |
| **9 s (recommended, +/-3 s jitter)** | 400 | 800,000 | 333,000 |
| 12 s | 300 | 600,000 | 250,000 |
| 15 s | 240 | 480,000 | 200,000 |
| 30 s | 120 | 240,000 | 100,000 |

Against the options: a Worker at 100,000/day is exhausted in under 8 minutes at 9 s (about 250 phone-hours a day in total). R2 uncached against 10M/month is 12.5 hours of 2,000 phones a month. R2 behind the cache: about 1,200 R2 reads per edge location per hour (say 10 Indian locations: 12,000 an hour, 0.12% of the monthly allowance per event-hour), independent of phone count. Egress: 2,000 phones x 400 x ~0.5 KB = ~400 MB an hour, free from R2/CDN. **Recommendation: 9 s +/-3 s jitter, 39 s pause notice, R2 behind a cached custom domain; offer the 6 s profile (30 s notice) as an organizer option.** The simulation measures the same order (e.g. 599,294 control requests for 9 scenarios of 300 phones, about 13.3k per minute per 2,000 phones, matching 3600/9).

Optional second mirror (a second free store) lets a phone read both mirrors on every poll (2x requests, still cached/free); see B.8 scenario J.

### B.7 Simulation (`bun run tools/sim/pause.ts [phones] [fast]`)

Real control code (signatures, log acceptance, schedule, freshness rule) against a stand-in CDN. Phones: 30% late joiners, random drops, wrong poll timers (phone clocks are never read, only the beacon round is), per-phone flaky fetches, 8 edge locations 1 tick (3 s) stale. Scenarios:

| | Scenario | Expectation | Result |
|---|---|---|---|
| A | no control messages | layer invisible | pass |
| B | pause ~2 min then resume | identical calls, nobody contradicted | pass |
| C | timed break, extend, second pause, Stop near call 70 | same + Stop honoured | pass |
| D | organizer pauses and vanishes | auto-resume after maxPause | pass |
| E | CDN outage 2 min with a pause inside | phones hold, never guess, 0 contradicted | pass |
| F | CDN outage 4 min (> give-up) with a pause | blind phones may show contradicted numbers; **all re-converge** | reported (about 87% of phones went blind: everyone lost the CDN) |
| G | 10% of phones behind a forging edge | none accepts a forged message, fail over | pass |
| H | edges 2 ticks stale (worse than designed) | still 0 contradicted | pass |
| I | **limit**: a censoring edge keeps serving an old genuine answer to 5% of phones | cannot be seen by the freshness rule | reported: those phones show contradicted numbers (5%), then converge |
| J | same censor, every poll reads both mirrors | 0 contradicted | pass |

Final result in every scenario: every phone computes the identical call log after one good fetch, including late joiners and dropped phones. Numbers for 300, 2,000 (standard) and 1,000 (fast) phones are in the branch report; the 300-phone run is 61/61 checks.

### B.8 Risks and open questions for the owner

1. **Free-tier TTL (B.5)** must be tested for real. Everything else about cost is arithmetic.
2. **Pause is not instant** (30-39 s). Accept? Shorter is possible only by polling faster (more cached requests) or by phones reading both mirrors.
3. **Censoring or compromised CDN** can delay a pause on some phones (scenario I). Mitigation J costs 2x cached requests. A compromised CDN cannot forge anything.
4. **Organizer trust**: the organizer picks when a pause ends, which shifts which beacon round each later call uses, so a *malicious organizer* could in principle choose among a few outcomes. They already own the game and give the rewards. Not mitigated; the log is public and signed, so it is auditable.
5. **Key loss**: a cleared browser or a different laptop means the organizer cannot pause (the engagement continues). Options: extractable key with an exported backup file, or a second authorised key. Not built. Owner decision.
6. **Browser support**: WebCrypto `Ed25519` is present in current Chrome, Safari and Firefox as far as I recall; I did not test any real browser. `control.js` and the confirm-page hook are **not browser-tested** (the signing and publishing code they call is).
7. **Brand breaks, 20 s round breaks, claim-check pauses** are wall-clock concepts in the server-driven engine. In phone-only mode they should be pre-agreed pauses in the same interval list (a brand break = a pause of known length at a known call index). Not built.
8. **Console wiring**: the Pause/Resume buttons still call the server-driven route (now refused for phone-only engagements). They need `TBControl.publish(code, {token}, 'pause')`; `console.js` was left untouched to avoid conflicts. Also call `TBControl.ensureKey(code, {token})` when an engagement is first opened.
9. **Phone UI** (play.js): poll the control file with jitter, hold banner, "pausing in N s" countdown. The phone-side logic is `ControlTracker` in `packages/beacon/src/control.ts`.
