# Winners are decided by the software (as built, 2026-10-04)

Owner rule: the organizer builds the game, sets the prizes, options and rules. The Organizer, a Host, a Co-host, the AI assistant and we **cannot choose, change or remove a winner, a "not valid" claim, a number or a ticket**. The software does all of it.

## How a winner is decided
1. Numbers come from public randomness (drand), checked by signature on every phone.
2. Every phone works out all the winners (and each lucky draw) itself from the public numbers and the public seat list.
3. Each phone reports its result to our store (`POST /api/z/{id}/vote`). A result is **accepted only when `quorumFor(people)` different phones report exactly the same winners** (tiny game: half of the people; otherwise 5%, between 3 and 25). One ticket = one phone = one vote.
4. Only a share of the phones speak first (`votersFor`: everyone up to 12 people, else 4 x quorum), so a big game stays inside the free request allowance; silent phones join in every 30 s if no result appears.
5. `POST /api/z/{id}/settle` now refuses everybody. A phone's own claim of a win (`/won`) is ignored. Console, Organizer, Host and AI have no write path to winners.

## One ticket per phone
A phone gets one ticket per engagement (hash of a random device id kept on the phone). A second number on the same phone is refused (`device-used`). The invitation feature still works: if the organizer switches it on, each participant can send their link to up to **4** other people, each of whom joins on their own phone.

## After the game: prize hand-over
* The winner's phone shows "Confirm your prize details" (name and mobile number). They can correct them. Only the phone holding the ticket can confirm (device proof).
* Any change is kept in an audit trail (what they joined with, what they changed it to, when) and shown to the Organizer and Host in the console and in the report.
* The Organizer / Host tick **Prize given** per winner; the date is kept.
* These details are kept 365 days with the engagement record (disclosed in the privacy text, the report and the e-mail).

## The report
One e-mail with a link. `/report.html` fetches `GET /api/report/{id}?k=...&part=base|people` and lays the PDF out in the organizer's browser (their RAM, not our server). Valid until the personal data is deleted.

## Audit trail of the external AI
Every call made with an AI key is written to `ai_audit` (time, key id, method and path, status, network address, program, country). The organizer reads it in the console ("What your AI assistant did"); we can read all of it (`GET /api/org/ai/audit`). Kept 365 days. The short work link (`/ai/<key>`, see `docs/AI_LINK.md`) goes through the same trail: the manual read is one row (`GET /ai/manual`), every call is recorded with its `/api` path and real method, and a co-host key's calls through a link are recorded too. The AI may read its own trail. Widening what the AI may do (announce, prize-given ticks, change of phone, seat marks, co-host keys) does not touch this document's guarantees: numbers and winners are still decided only by the software, and the AI still cannot pay, publish, erase, pause or settle.

## Honest limits
* The quorum protects against one or a few cheating phones. If more than the quorum of cheating phones with different numbers agree on a false result, it would be accepted. Joining needs a mobile number, one ticket per phone, and the organizer sees who joined.
* One phone could still be a second phone for a different person if they clear the browser's saved data (a new device id), then use a different number.
* Nothing in a browser can be made uncopyable. Copying is deterred by law (terms and copyright), not by code.

## Internal audit log (2026-10-06)
The per-AI trail above (`ai_audit`) stays as the organizer's own view of what their AI did. Beside it, `audit_log` (`apps/edge/src/audit.ts`) is the internal, sealed, hash-chained log of everything in an engagement. It is owner-only (platform key): `GET /api/owner/audit/<id>[?format=csv]`, `/verify`, `POST /analyze`, `POST /hold`, `GET /api/owner/audit/access`. Full description: `docs/PRIVACY_AND_LIFECYCLE.md`.
