# Privacy and the life of a game's data (the data map, as built, 2026-10-14)

This is the data map for gates D1, D2 and D11. It is written from the code, not from memory: `apps/edge/src/worker.ts` (join, schema), `apps/edge/src/people.ts` (lists), `apps/edge/src/winners.ts` (prize hand-over), `apps/edge/src/rights.ts` (a player's own requests), `apps/edge/src/lifecycle.ts` (deletion), `apps/edge/src/pii.ts` (sealing), `apps/edge/src/audit.ts` (security log), `apps/web/public/z.js` (the player page). If you change one of those, change this page in the same step. `apps/edge/test/data-map.test.ts` reads this page.

Short version: a player gives a name. A mobile number is asked only if the organizer switches that on, or if the organizer's own list holds it. The organizer is the controller of those details; we are the processor. All players' details are deleted 23 hours after the game ends (the promise is "within 24 hours"). The winners record (card numbers only) and the organizer's details stay until 00:00 IST at the end of day 365, then everything goes. Invoices and the payment ledger are kept for the legal period, apart from the game data.

## 1. The player notice (the two boxes shown before the name is asked)

The wording is in `apps/edge/src/consent-text.json` (point K4) and is copied into `apps/web/public/consent.js`, which the join page renders (a test keeps the two identical); the join page does not fetch it from the server. Terms version 2026-10-15. Two boxes, never ticked in advance, both before any name field works:

- A: the name (and the mobile number, only if this game asks for it) is used for this game only and deleted within 24 hours after it ends; who invited the player is recorded until then. A winner's name (and mobile number, if given) and prize record are kept for 365 days so the prize can be handed over; "We keep billing data for audit and tax reasons."; and the notice is available in Hindi on request. The same wording is in the Terms table, the stand-alone Privacy page (`/privacy.html`) and the organizer's report.
- B: the player is 18 or older. Adults only: there is no parent's-device alternative (DPDP Act section 9); the box is never ticked in advance, the server refuses a join without it, and a join under an older Terms version is refused.

The Join button stays disabled until both are ticked, and the server refuses a join without them. The server stores one row per acceptance in `consent_log`: the card id, the point (K4), the game id, the Terms version, the boxes, a hash of the exact wording, and the time. It holds no name, number, address or device. When the Terms version changes, the next join asks again.

<!-- notice:start -->
asked_from_player: name
asked_if_organizer_switches_on: mobile number
<!-- notice:end -->

The block above is read by `apps/edge/test/data-map.test.ts`: it fails when the join notice mentions a field this list does not have, when this list has a field the notice leaves out, or when the player page asks for a field that is not listed.

## 2. The data map

"Who" means who holds or processes the data. **CF** = Cloudflare (Workers, D1 database, Pages: hosting and storage). The database is one D1 database kept in Cloudflare's Asia-Pacific region; the website is served from Cloudflare's global network. We do not run a backup process of our own.

### 2a. Players

| Field | Why | Where stored | Who | How long |
|---|---|---|---|---|
| Name, typed by the player (2 to 60 characters, markup removed) | To show the organizer who a card belongs to (winners, prize hand-over) | **Sealed** (AES-256-GCM) in `participant.pii` at join | CF | Deleted 23 h after the game ends |
| Mobile number: **only** if the organizer switched "ask for a mobile number" on, or if the organizer's own list holds it (then the player's personal link carries it and the player types nothing) | To find the person who comes back; to send a personal link | **Sealed** in `participant.pii` and `person.pii`; a salted one-way hash in `participant.phone_hash`, `seat.ph`, `person.ph`. A player who gave a name only has no number: the hash is made from the game id and the phone's random id | CF | 23 h after the end |
| Card number and player id (`pid`: the card number and a hash) | To tell players apart without a name; the winners record uses the card number | `seat`, `participant.pid`, `claim`, the seat list `kv seats-base/<id>` | CF | Deleted 23 h after the end (the winners record keeps the card number only) |
| A hash of the phone's random device id (first 32 characters of `sha256("dev" + game id + device id)`) | One card per phone; the claims of a card come only from the phone that joined | `seat.dev` | CF | 23 h after the end |
| Join time; a round number if the player joined after the game began | Report; late-join marker | `participant.joined_ms`, `seat.jr` | CF | 23 h after the end |
| How the player joined (direct, or through an invite link), who invited them, invite category, role flag (organizer, host, co-host), "removed" flag | Invite counts; the organizer can remove a person | `seat.src`, `seat.inv`, `seat.cat`, `seat.role`, `seat.blocked`, and a row in `person` (sealed, hashed key, inviter, status) | CF | 23 h after the end |
| Consent record: card id, point, game id, Terms version, boxes, hash of the wording, time | To show the boxes were ticked | `consent_log` | CF | K4 rows: 23 h after the end. Organizer rows stay with the account |
| Claims: which pattern, which round, at what time, by which card | The organizer can check a winner when claims are stored (small games) | `claim` (card id only, no name) | CF | 23 h after the end |
| "The game is over" votes from phones | End of the game is read from phones as well as the schedule | `overvote` (card number and time) | CF | 23 h after the end |
| A request the player made to see, correct or delete their data: card id, kind, a short note, three times | To answer within the promised time (7 days) | `data_request` (no name, no number) | CF; the organizer and the owner are told by e-mail (Resend) | 23 h after the end |
| Winners record: the card number, prize, round, time | Proof of who won, with no name | `winner` | CF | Until the end of day 365 |
| Game log: one line per call (time and public round), pause, prize (card number) and the end, each chained to the one before | Lets the organizer and the IT team see what happened and when, even if the report e-mail never arrives; no name, no mobile number | `game_log` | CF | Until the end of day 365 |
| Prize hand-over record: the name and mobile number the winner confirmed on their own phone, what they joined with if they changed it, the change trail, the date the organizer ticked "prize given" | So the organizer can hand over the prize and confirm it was handed over | `prize` (sealed) | CF | 365 days |

### 2b. What a player's phone keeps (on the phone, not on our servers)

The full list is `apps/web/storage-registry.json`, and the same sentences are on the Privacy page (`legal.html`). `apps/web/test/storage-notice.test.ts` fails when a script uses a key that is not listed. For a player: a random device id, the card and the game state, the marks, the prizes won, the last game opened, the organizer's name and logo, and whether the sound is on. There is no cookie on a game page.

### 2c. Lists the organizer types or pastes (people lists, waiting room)

| Field | Why | Where stored | Who | How long |
|---|---|---|---|---|
| Name and mobile number of each invited person | To send a personal invite link | `person.pii` (sealed), `person.ph` (hash of the number), `person.tok_hash`/`tok_sealed` (the personal link), inviter, status, who approved | CF | 23 h after the end |
| Name and mobile number of a person waiting to be let in | The waiting room | `waiting.pii` (sealed), `waiting.ph` | CF | 23 h after the end |

### 2d. Security log (kept for security, disputes and the law; read only by the owner)

Every action that writes something (join, consent, claim, start, pause, console edits) adds one row to `audit_log` (`apps/edge/src/audit.ts`). Plain reads add nothing.

| Field | Why | Where stored | Who | How long |
|---|---|---|---|---|
| For a **player's** action, the personal part: full network address, browser string, browser and system name, network number, the raw device id and its hash, the time and zone the phone says it has, the fields sent (for a join: the name; passwords, codes, keys and card words are replaced by "[redacted]") | Security, disputes, fair play | `audit_pii.sealed`, sealed under a **per-game key** whose salt is in `eng_key` | CF | **Destroyed 23 h after the end** (crypto-shredding: the salt and the blobs are deleted, so the key can never be made again) |
| For a player's action, the non-personal core: event type, server time, country, status, request reference, a hash of the personal part | Counts, hash chain | `audit_log` | CF | Until the end of day 365 |
| For the **organizer, host, co-host or an AI key**: the same fields, whole, sealed with the platform key | Security, disputes | `audit_log.sealed` | CF | Until the end of day 365 |
| Owner access log: when the owner read or downloaded a log | Accountability | `audit_access` (no personal data) | CF | Kept |
| Deletion certificate and anonymous statistics (counts by event, country, AI vendor) | Proof that deletion happened | `audit_cert`, `audit_stats` (no personal data) | CF | Kept |

### 2e. Network-address hashes for limits, and public-page records

| Field | Why | Where stored | Who | How long |
|---|---|---|---|---|
| A short hash of the network address (16 characters) used as a counter key for "too many joins per minute and per day from one address" | Free-plan protection | `kv jbm/...`, `kv jlim/...` | CF | 2 days |
| Monitoring from `rum.js` on the pages: page path (no query string), referrer site name, device class, speed figures, script errors, and for a failed or slow API call the API path and the time it took. No cookie, no network address, no name. Country comes from Cloudflare | To see crashes and slowness | D1 table `telemetry` (`pages/functions/api/telemetry.ts`) | CF | 90 days |
| Visits to the **public website pages only** (home, legal, pricing, sign-in, payment entry; never a game page): visitor id, shortened network address and a keyed hash of it, source, landing page, device, country, city, sections seen, choices made. With Global Privacy Control or Do Not Track, only anonymous daily counters | To see how companies find the site | `visit_session`, `visit_event` (`apps/edge/src/visits.ts`, `v.js`) | CF | 365 days, then rolled into anonymous daily totals (`visit_agg`) |

### 2f. Organizers, hosts, co-hosts, partners

| Field | Why | Where stored | Who | How long |
|---|---|---|---|---|
| Organizer e-mail (sealed, plus a hash for sign-in), sign-in keys, terms version accepted, the lasting AI key (sealed) | Sign-in, invoices, mail | `organizer_key`, `organizer_email`, `kv orgmail/ aikey/`, `organizer_terms` | CF; Resend sends the mail; optionally Google if "Continue with Google" is switched on | While the account exists (the organizer can close it) |
| Organizer's e-mail and mobile number, confirmed at Publish | Contact for the game and the report e-mail | `kv contact/<id>` | CF | End of day 365 |
| Game settings the organizer chose: occasion name, start time, size limit, invite-only, invitation policy, time zone, brand name, accent colour and small logo (not personal) | To run the game | `engagement` (`config` column) | CF | End of day 365 (a draft nobody published: 30 days) |
| Host name, e-mail or mobile (sealed), label | A Host runs the game | `organizer_key` (`email_sealed`, `pii`, `label`) | CF, Resend | Host: while the key lives. A Co-host's name and mobile are deleted with the players' data (23 h after the end) |
| Sign-in codes and links (hash only) | Sign-in | `login_code` | CF | 10 minutes; row deleted 1 day after expiry |
| Mail outbox | A mail that failed is retried | `outbox` | CF | A sent mail keeps no body; an unsent one 3 days |
| Mail delivery events from the mail service (bounced, complained, delivered): a one-way hash of the address, the address with its middle hidden (j***@example.com), the subject line, the kind, the time | So the owner can see which mails did not arrive and tell the organizer | `mail_bounce` (no name, no full address) | CF; the mail service (Resend) sends the event | 90 days |
| AI work link: log of each call (time, key id, call, status, network address, program, country) | The organizer can see what their AI did | `ai_audit` | CF | 365 days |
| Partner (refer and earn): name, random code, hashes of phone and e-mail | Commission | `partner`, `commission` | CF | While active; commissions kept as accounting records without a link to a person |

### 2g. Money

| Field | Why | Where stored | Who | How long |
|---|---|---|---|---|
| Payer name, organisation, e-mail, mobile, country, GSTIN; amount, tax, pack, Razorpay order and payment ids | Invoice, tax, accounting | `payment`, `invoice`, `entitlement`; a copy of the organizer's invoice details and who paid in `legal_party`, written at payment and again just before the game is deleted | CF; **Razorpay** takes the payment, only through the central service "IT Services by Rajat Agarwal" (site `corporate-bingo.pages.dev`, product `corporate_bingo`, plan `bingo_pack_<N>`) | For the legal period, separate from game data; never deleted by code |
| Payment ledger and webhook log (one ledger for every product) | Reconciliation | `payment_ledger` view, webhook log | CF, Razorpay | Same |
| A note to the owner on each paid order: game, plan, amount, transaction id, organizer name and e-mail | The owner sees every order | An e-mail (Resend) to the owner; the claim that it was sent is `kv ownerpaid/<payment id>` | CF, Resend | The claim row stays with the payment records |

No card or bank details are ever stored or logged. Players never pay.

## 3. Who processes data for us

| Processor | For what | Which data | Where |
|---|---|---|---|
| Cloudflare | Hosting (Pages), the Worker, the D1 database | Everything stored above | The website: Cloudflare's global network. The database: Cloudflare's Asia-Pacific region |
| Resend | Sending e-mail | Organizer and host e-mail addresses and the mail text. Never players: players give no e-mail | United States, as published by Resend |
| Razorpay (through IT Services by Rajat Agarwal) | Taking payment from the organizer | Payer details and amount | India, as published by Razorpay |
| Google (optional) | "Continue with Google" for organizers and hosts | The e-mail address the person signs in with | United States, as published by Google |

**Supabase is not used by this product.** There are no third-party trackers: the only monitoring is our own (`rum.js`, `v.js`). A player's phone contacts drand (a public random beacon) and, only if the organizer adds a video break, YouTube in privacy mode.

## 3a. Where the data is, and what we do not claim

* The database is a Cloudflare D1 database in the **Asia-Pacific region** (read with `wrangler d1 info`, 2026-10-14: `running_in_region: APAC`, no jurisdiction pinned, no read replicas). That names a region, not a country.
* The website and the Worker run on Cloudflare's global network, so a request is handled in the data centre closest to the person. Data is stored only in the database above.
* We run **no backup of our own** and do not promise any backup period. Deletion is from our live database within 24 hours after the game ends. (A later step may add a backup process; this page and the legal pages will say so when it exists.)
* Resend, Razorpay and Google process what is listed in section 3 in their own countries.

## 4. The clock and ways to delete

The rest of this page (the clock, ways to delete earlier, the security log and crypto-shredding, visits) is unchanged below. The player's own routes are `POST /api/z/<id>/leave` ("Leave this game") and `POST /api/z/<id>/datareq` ("What do you hold about me / delete me"): the player proves who they are with the card id and the phone's own device id, the request is stored, the organizer and the owner are told by e-mail, the player is shown the promised answer time (`PROMISE_DAYS = 7` in `rights.ts`), and an erasure is carried out at once.

---

## The clock

* The game's end is read from the public schedule (organizer's pauses and stop included), or sooner when at least `min(3, half the people)` different phones say the game is over, and never before 20 numbers.
* **Report:** starts 3 minutes after the end. The server prepares the people in chunks of 250 (a free Worker has ~10 ms CPU per call) and e-mails ONE link. The organizer's own browser (`/report.html`) fetches the pieces and lays the PDF out on their device, in parts of up to 1,500 people. The link works until 22 hours after the end (an hour before the deletion); a reminder goes 6 hours before it closes if it was never opened. The organizer and co-host can also open it from the console.
* **Report link closes:** 22 hours after the end (`REPORT_LINK_MS`); the 6-hour reminder goes at 16 hours if the link was never opened (`reportLinkUntil`).
* **Deletion:** 23 hours after the end (`PURGE_AFTER_MS`), whether or not the report could be sent (the promise of 24 hours does not wait for an e-mail). The same tick shreds the participants' audit part. An owner-set legal hold suspends both this and the 365-day deletion.
* **365 days:** `fullDeleteAt(end)` = 00:00 IST at the end of the 365th day.
* The caller is the scheduled job (`apps/cron`, every minute, key `CRON_KEY`) hitting `POST /api/lifecycle/tick`. While it is not deployed, organizer requests and phones' end-of-game reports nudge the same function (at most once a minute per Worker instance): a safety net, not a clock.

## Ways to delete earlier

1. Console: "Delete all participant data now" (`POST /api/z/{id}/erase`, organizer only).
2. AI assistant: it can only **ask** (`POST /api/z/{id}/control/request {action:"erase"}`); nothing is deleted until the organizer confirms in the console, and the organizer is e-mailed.
3. E-mail to us from the organizer's registered address with "delete" and the engagement id (`POST /api/inbound-email`, authenticated by `INBOUND_SECRET`; needs the mail domain's inbound route, see below).

## Owner-only steps still open

* Deploy the scheduled job: a Cloudflare API token with *Workers Scripts: Edit* is needed (the current tokens cannot): `cd apps/cron && bun x wrangler@3 deploy`, then `wrangler secret put CRON_KEY` with the value in `config/live-secrets.txt`.
* Inbound e-mail: an MX route for the address organizers write to, and the mail service's inbound webhook pointed at `/api/inbound-email` with header `x-inbound-secret`.
* Lawyer review of the wording in the PDF and the e-mail.

## Limits we state honestly

* Names in non-Latin scripts print as `?` in the PDF (the PDF uses the standard fonts to stay small and fast).
* The winners recorded by phones (not checked by the organizer's console) are marked "by phone" in the report.
* Deletion is from our live systems within 24 hours.

## The internal audit log (added 2026-10-06)

Corporate Bingo is a one-time game. We keep an internal log of what happened in each engagement, for **security, dispute and legal purposes only** (DPDP Rules 6 and 8(3): reasonable security safeguards, and logs kept for a year).

* **Who can read it.** Nobody who plays or runs the game: not participants, hosts, co-hosts, organizers or their AI assistants. There is no download for them. Only the owner of the platform (the platform key holder) can read or download it, and only the owner can have it analysed. Every such use is itself written to an access log. An AI vendor never receives network addresses or device ids: analysis runs on counts only.
* **What is recorded** for each action (create, edit, delete, publish, pay, start, pause, resume, stop, announce, join, claim, vote, prize, erase request, change of phone, invite, sign-in, failed attempts, and refused attempts by an AI key to publish, pay or erase): who did it (organizer, host, co-host, participant, AI key, system, owner), what, the server's time (UTC; this is the authority) next to the time and zone the device reports, the full network address, country and network number, the full browser string, browser and system, the device id (the phone's own random id; a hash of it is also kept), a short summary of the fields changed, and a request reference. For an AI key: the program that fetched the page, the key id and what the AI declared about itself (model, version, session, machine), marked as declared, observed or inferred, and flagged when they disagree.
* **Never recorded:** passwords, one-time codes, card or bank details, keys.
* **How it is protected.** Every identifying value is sealed (AES-256-GCM, same `DATA_KEY` as names and numbers). Rows can only be added; each row carries the hash of the one before, so a removed or edited row is detected (`GET /api/owner/audit/<id>/verify`).
* **Deletion.** The log is deleted with its engagement at 365 days (sign-in and refused-attempt rows that belong to no engagement, 365 days after they were written). Before that we write an anonymous count by kind of event, country and AI vendor, and a deletion certificate (engagement id, date, number of rows, final hash). Those two hold no personal data and are kept. A legal hold set by the owner stops the deletion (and the 23-hour shredding below) until it is lifted.

### Text for the privacy page (`tools/make-legal-pages.mjs`, not edited here)

> **Security log.** To keep the game fair and to protect you and us, we keep a security and audit log of what is done in each engagement: the action, who did it (organizer, co-host, participant or an AI assistant's key), the time, your network address, country, browser and device identifier. For an AI assistant's key we also keep which program fetched the page and what the assistant says it is. We never log passwords, one-time codes or card or bank details. The log is encrypted, can be read only by us, and is used only for security, disputes and legal duties (DPDP Rules 6 and 8(3)). It is deleted automatically with the engagement, 365 days after the game ends; before that we keep only anonymous totals and a deletion record that contain no personal data.


## Participant crypto-shredding (added 2026-10-06, migration 0011)

Owner rule: 23 hours after the game ends, every participant's personal data is erased, including their part of the audit log; what is kept for participants is non-personal only.

* **Design.** Each audit row of a *participant* is split. The row in `audit_log` keeps only the non-personal core (engagement id, event, actor kind, server time, country, AI vendor, status, request reference) plus `pdig`, the SHA-256 of the sealed personal blob. The personal part (full IP, user agent, raw device id, device hash, client clock, the fields they changed, network number) lives in `audit_pii`, sealed (AES-256-GCM) under a **per-engagement participant key** = HKDF(`DATA_KEY`, salt = a random 32-byte value stored in `eng_key`, info = `participant/<id>`). A key derived from `DATA_KEY` and the id alone could not be destroyed (the secret lives as long as the platform), so the random salt is what makes shredding real: delete the salt and the blobs, and the key can never be derived again, even by someone holding `DATA_KEY` and a copy of the blobs. A `shred` row (engagement id, time, number of rows) records that it happened.
* **Chain.** The row hash covers the core, `sealed` (empty for participant rows) and `pdig`, never the blob. Shredding therefore does not change any hash: `verifyChain` passes after it, with the same head hash. While a blob exists it must match its `pdig` (tampering is caught); a missing blob with no `shred` marker is reported as tampering.
* **Who is shredded.** Rows whose actor is `participant`, except `prize*` events (the winners' prize confirmations, kept 365 days with the winners record). Rows of the organizer, host, co-host, AI key and owner keep everything for 365 days.
* **When.** `lifecycleTick` calls `erasePersonal` at `end + 23 h`, which deletes the participant tables and then `shredParticipantAudit`. The organizer's early "Erase" does the same at once. A second pass of the tick shreds any engagement whose participant rows were already gone but whose audit part was not (for example after a legal hold is lifted). A participant row written after the shredding keeps its core only; no new key is ever made for a shredded engagement.
* **Legal hold** (owner-set only) suspends the automatic 23-hour erasure and shredding as well as the 365-day deletion. If the organizer erases by hand during a hold, the participant tables go but the audit part waits until the hold is lifted.
* **At 365 days** `closeAuditFor` deletes the log, `audit_pii`, `eng_key` and the `shred` marker; the anonymous statistics and the deletion certificate stay as before.
* **Not covered.** Participant rows written before migration 0011 was applied (migration 0010 was introduced a day earlier) hold their personal part inside `audit_log.sealed`, which the append-only trigger and the chain do not allow to be rewritten; they are deleted with the engagement at 365 days like every other row. If 0010 was applied to a live database, run those rows through a one-off cleanup or accept 365-day retention for them.

## Visits to the public pages (added 2026-10-06)

Purpose: to see how companies find the site, which parts they read, what they choose, where they leave, and how many become a sale. Code: `apps/edge/src/visits.ts` (server), `apps/web/public/v.js` (browser), migration `0012_visits.sql`.

* **Where it runs.** Only on the home page, legal pages, partner page, sign-in and the payment entry page. Never in the game (`play`, `z`, `zc`, `big`, `screen`, `report`) and never about participants. The server drops any event whose page is not on its allow-list (`PUBLIC_PATHS`).
* **What is kept.** Source (referrer site, search engine, UTM names, partner code), landing page, device class, browser, language, country and city (from Cloudflare), the sections seen and for how long, the choices made (number of participants and the price shown, currency, create, sign-in), the page and section the visitor left from, time on the last page and scroll depth. Never names, mobile numbers, e-mail addresses or page query strings.
* **Recognising a return.** A random first-party visitor id (browser storage and one cookie, 1 year) and the network address, kept only as a shortened address (IPv4 last part zeroed, IPv6 first 48 bits) and as a keyed hash of the full address (`VISIT_KEY`, else derived from `DATA_KEY`). The raw address is never stored. When an organizer account is made or signed in, the earlier visits of that browser are tied to the organizer's random id (and a keyed hash of the e-mail), so a later publish and payment count against the first source.
* **Privacy signals.** With Global Privacy Control or Do Not Track the page makes and stores no visitor id and the server keeps no session, no address and no hash: it only adds to anonymous per-day counters (`visit_agg`, dimensions `gpc_*`).
* **Crawlers** are recognised by user agent, stored apart with `is_bot = 1`, and never counted as visitors.
* **Retention.** 365 days after a visit began, its sessions and events are added to anonymous per-day totals (`visit_agg`, kept) and deleted, by the lifecycle tick (once a day, a few days of catch-up at a time).
* **Free-plan cost.** One D1 batch per message (sent about every 15 s and when the page is hidden, 20 events at most, 150 per page view). Every message is counted against the shared daily write allowance (refused at 80,000) and against a smaller tracking allowance (`VISIT_DAILY_WRITES`, default 20,000), so marketing numbers can never use up the games' allowance.
* **Who reads it.** Only the owner, with the platform key (`GET /api/owner/visits/summary`, `GET /api/owner/visits/journey/<visitor id | ip_<hash>>`, and the unlinked, noindex page `/owner-visits.html`). Anyone else gets the same 404 as an unknown address; every attempt and every read is written to `audit_access`.
* **Public wording.** One line in the Privacy & Data Policy (`legal.html`): "Public pages: a first-party visitor id and shortened network address, never names or mobile numbers, kept 365 days. With Global Privacy Control or Do Not Track, we only count visits."
