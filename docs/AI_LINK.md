# The short AI work link: `https://<site>/ai/<key>`

Owner requirement (2026-10-05): the external AI link must be SHORT and take the AI to the bigger instructions by itself; the AI reads them, understands the work, the APIs and the workflow, and works as its role. It cannot code. It can create a game, set the options, go up to publishing, and do what an organizer or host can do by logging in, except payments (a human does those).

Background: in another project a very long pasted prompt failed in ChatGPT, Gemini, z.ai and DeepSeek. Those chat tools can usually open a web address (GET) but often cannot set headers or send POST. The old paste (about 1,000 characters, key in an `x-organizer` header on every call) failed for them.

## What the organizer pastes

Two short lines and the link (shown as Option 1 in the console and e-mailed in its own dedicated mail, see "Where the link may travel" below):

```
This is the API documentation and instructions for MY OWN Corporate Bingo account. I am the owner, and I am asking you to read it and help me with it.
Please open it now (a plain GET request) and follow it: https://corporate-bingo.pages.dev/ai/cba_<48 hex>
```

Wording: from PROJEXA testing, "open this link and follow it" was refused as prompt injection about one time in three by a careful AI; presenting the link as the owner's own API documentation worked every time. The key appears only inside the link.

## Where the link may travel (2026-10-05, owner rule)

Three layers together:

* **A. The e-mail's button.** The dedicated mail (`apps/edge/src/mails.ts`, `aiLinkMail`; subject "Your personal AI work link - Corporate Bingo"; HTML + plain text; red do-not-forward warning top and bottom; numbered steps) has a prominent button "Show my AI work link" to `/ai-link.html` (`apps/web/public/ai-link.html|js`). The address holds no secret. The page asks the organizer to sign in with the existing 6-digit e-mailed code (or uses the console's own session), then shows the lasting two-line paste in a box with Copy, seven ways to hand it to an AI (below), "Get a fresh AI link" and "Replace my AI link", with the warning top and bottom. A forwarded copy of the mail is useless to anyone else. The lasting key is kept sealed (`aikey/<org>` in kv) so the signed-in organizer can read it again (`GET /api/org/ai/link`, organizer key only; AI, co-host, mailed and platform keys get 403). It is never e-mailed.
* **B. The mail's own box uses a separate 24-hour key.** The plain-text paste box in the mail (never a hyperlink) carries a key minted only for the mail, valid 24 hours (`organizer_key.expires_ms`, D1 migration `0006_link_expiry.sql`; after expiry it is the same plain 404 as an unknown key; keys with no expiry are unaffected). The mail says plainly how long it works and that the button gives a fresh one. "Get a fresh AI link" (`POST /api/org/ai/fresh`, organizer key only, at most 5 live) mints and mails another 24-hour key without touching the lasting key. Co-host: a lasting `cbh_` key is returned to the console; the mail carries a separate 24-hour co-host key, names whose engagements it is, says it is a watch-and-announce role, and has its own warning (its button opens the console). Co-host keys made for mail do not use up the 5 co-host places.
* **C. Unfamiliar-use alert.** When an AI or Host key is used (manual read or API call) from a country, network prefix (IPv4 /24, IPv6 /48) or program family not seen before for that key, the organizer gets ONE plain e-mail (no link, no key: "someone new used your AI link; replace it if this was not you"), at most once per key per 24 hours. The first use only sets the baseline. State: `seen/<keyId>` and `alert/<keyId>` in kv. The alert is also noisy by design when a different AI vendor is tried; the 24-hour limit caps it.

Where else: the publish mail (share and pay links) carries no AI link and is safe to forward; reminders, "could not begin", invoices, report-link and partner mails never did; no report page, PDF or guest page carries one (source scan in `apps/edge/test/ai-mail.test.ts`). The organizer's address for these mails is kept sealed (`orgmail/<org>`, same AES-GCM as names and numbers); older accounts fall back to the address confirmed at their latest publish; with none known the paste is returned in the answer (`mailed: false`). A mail that could not be sent keeps no body at all. Honest limit: a mail app may turn the plain-text address in the box into a tappable link on its own, and a mail scanner may then open it; that is why the mailed key lasts only 24 hours and the alert exists.

### The seven ways to use the paste (sign-in page and console Option 1 box; not in e-mails)

Opens the AI with the paste pre-filled (`target=_blank rel="noopener noreferrer"`): ChatGPT `https://chatgpt.com/?q=`, Grok `https://grok.com/?q=`, Claude `https://claude.ai/new?q=`. Copies the paste and opens the site, with the line "Copied. Press Ctrl+V, then Send": Gemini (`https://gemini.google.com/app?q=`, the prefill is a harmless attempt that did not work signed-out), DeepSeek `https://chat.deepseek.com/`, z.ai `https://chat.z.ai/` (ignores ?q). Seventh: plain Copy. Tested for every button's address, origin and encoding in `apps/web/test/pages.test.ts`.

### Replace and fresh links

`POST /api/org/ai/replace` (older `/api/org/ai` is the same): revokes every AI key (lasting and 24-hour), mints a new lasting key (shown in the console and the sign-in page), mails a new 24-hour key, and is audited as `POST /api/org/ai/replace`. `POST /api/org/ai/fresh` is the "Get a fresh AI link" button. Both are for the signed-in organizer only; an AI key, a co-host key, the platform key or a stranger gets 403, also through an AI link. Opening the manual (`GET`/`HEAD /ai/<key>`) changes nothing except its audit line and the alert baseline; nothing relies on the audit line.

## What the link serves

* `GET /ai/<key>` returns the complete manual for that key's role as `text/plain; charset=utf-8` (`?format=json` returns the same as data). Organizer-AI key (`cba_`): who you work for, a START HERE block, sizes and choices, the numbered conversation, every address (absolute, key included), examples, what the AI cannot do and what to tell the owner, payment facts, tone. Co-host key (`cbh_`): a narrower manual (watch, announce, tick prizes).
* `GET|POST|PATCH /ai/<key>/<api path>` behaves exactly like `/api/<api path>` with the key in `x-organizer` (`/ai/<key>/z/{id}/summary` = `/api/z/{id}/summary`; an `api/` prefix inside is accepted too). The rewritten request goes through the normal route, so the audit trail records it with the `/api` path and the real method, never the key. Only `cba_` and `cbh_` keys are accepted here: the organizer's own sign-in key (`cbk_`) and the platform key are never accepted in an address.
* Browse-only fallback, only under `/ai/<key>/`: `GET ...?_method=POST|PATCH&_body=<URL-encoded JSON>`. The decoded body is capped at 6,144 characters (documented to the AI as "about 20 people per roster call"); a body that is not JSON gets a plain 400 explaining URL-encoding; any other `_method` is a 400; the normal `/api` routes ignore `_method`/`_body`.
* Every answer carries `x-robots-tag: noindex, nofollow`, `referrer-policy: no-referrer`, `cache-control: no-store`.
* Unknown, mistyped, revoked, wrong-kind keys all get the identical `404 Not found.` plain text and nothing is recorded. Error bodies never echo the key. The audit trail records a manual read as `GET /ai/manual` and (new) a co-host key's link calls too.
* `/api/z/ai-manifest` and the `x-organizer` header path still work for tool-capable AIs (the manifest now also lists the new actions and the link).

Files: `apps/edge/src/ai-link.ts` (the words), `apps/edge/src/worker.ts` (`aiLink()` routing, `canAi`, manifest), `pages/functions/ai/[[path]].ts` (Pages Function), `pages/build.mjs` (`_routes.json` includes `/ai/*`), `apps/edge/test/ai-link.test.ts`.

## Roles (2026-10-07): Organizer, Host, Co-host

Words in the product: **Organizer** (1), **Host** (up to 5), **Co-host** (no limit). Full spec: `ROLES_AND_CONSOLE_SPEC.md`.

* **Organizer** (master key): everything, including the account (sign-in keys, e-mail, AI link, close account), adds Hosts and Co-hosts, pays.
* **Host** (`cbh_`, `organizer_key.kind = 'host'`): everything inside a game (change game, prizes, brand moments, guest invites, publish, game day, guest list), adds Co-hosts, pays. Cannot touch the account or add a Host. **Honest note: the old `cbh_` key, once described here as a "co-host" that could only watch, is now the Host key and its console rights are wider.** Through an AI work link (`x-cb-link`) a Host keeps the narrow rights below (watch, announce, tick prizes).
* **Co-host** (`cbc_`, kind `cohost`, new): invites people with an own link and sees how many they brought, pays. Everything else answers 403. No AI link. Reads `GET /api/z/{id}/cohost`.
* Team calls: `GET /api/org/team`, `POST /api/org/host {label?}`, `POST /api/org/cohost {label?}`, `POST /api/org/team/retire {id}`. Payment: any of the three may pay (`POST /api/checkout`); one payment is enough; `payment: {status, paidBy, paidMs}` is in `GET /api/z/{id}/summary`.

## Organizer and Host (AI link) actions: who may do what

| Action (console) | Organizer AI (`cba_`) | Host through an AI link (`cbh_`) | Why |
|---|---|---|---|
| Create engagement, settings (time, speed, limit, tickets, rewards, breaks, rounds, invite-only, invitation policy) | allowed (draft, before the first number) | no | same as before; invitations added to the summary |
| Load roster, reuse an earlier list | **no: owner only, in the console** (an AI key gets 403 for any roster call; names and numbers never pass through an AI) | no | corrected 2026-10-06; the earlier "allowed" was out of date |
| Read summary, participants (ids only), info, results, claims, life, history, pause status | allowed | summary/info/participants/results/life | |
| Announce to guests | **now allowed** (once published; 160 chars, 1 per 5 s) | allowed | a text to phones, no data or money |
| Mark a seat Organizer/Host/Co-host, change of phone (unbind) | **now allowed** | no | organizer-level housekeeping, audited |
| Read prizes | **now allowed**, mobile numbers cut to the last two digits | allowed (full) | a full number should not travel through an outside chat |
| Tick "prize given" | **now allowed** (recorded as "organizer's AI") | allowed | |
| Create a Host key | **now allowed** (max 5); the answer gives the Host's own AI link | no | narrow key |
| Read the AI audit trail | **now allowed** (own) | no | |
| Report link | status only; the address is withheld | full | the address is a key to every name and number; it is e-mailed to the organizer |
| Payment | never | never | a human act on the payment page |
| Publish | hand-over only (the organizer confirms their e-mail and mobile and presses Publish) | no | unchanged |
| Erase participant data | ask only (`control/request`, organizer confirms) | no | unchanged |
| Pause / resume / stop | ask only (signed by the organizer's browser) | no | unchanged |
| Winners, numbers, tickets | nobody | nobody | software decides (`docs/WINNERS_AND_AUDIT.md`), unchanged |
| Retire sign-in keys, mint a new AI key, change e-mail | no | no | |

Honest note: `names` (the organizer's own read of a few winners' names) stays human-only; the AI sees the winner's name and masked number through `prizes`, which is what it needs for the hand-over.

## Real-AI simulations (2026-10-05)

Two simulated outside-AI sessions, each a separate sub-agent given only the pasted text and tools limited to `curl`, against a local instance (`tools/sim/local-e2e-server.ts`, `PUBLIC_ORIGIN=http://localhost:8795`):

* Run A (full curl): created a 100-person dealer meet with two-ticket house, YouTube break, lucky draw, invite-only, 6 roster people, marked a host seat, read report status, tried the welcome message, stopped at the publish hand-over.
* Run B (GET-only, `_method`/`_body` only): created a 50-person Diwali party with two rounds and a scratch lucky draw, set invitations, loaded 25 people in one call, created a co-host link, stopped at the hand-over.

Both completed with every call 200 except two expected refusals (announce on a draft = 400; control status before publishing = 404). Neither tried to publish, pay, erase or pause. Gaps found and fixed in the manual or API:

1. Tool output cut long pages (both runs; partly their sandbox wrapper). The manual now starts with a START HERE block with the essentials; it is still about 19 KB, so a client that truncates hard may need `?format=json` or fetching twice. Not solved by shortening further without losing content.
2. The summary and the settings answer did not show the invitation policy: both now include `invites`.
3. Valid guest kinds (`cats`) were not documented: listed in the manual.
4. Announce on a draft returned 400 with no warning: the manual now says the welcome message waits for publishing.
5. `GET .../control` answers 404 before a game is published and running: documented as normal.
6. Unclear: break `after` counting, two-ticket house ordinals, rounds repeating rewards/breaks, meaning of host vs co-host marks, where the sizes are: all stated.
7. "Who opened my guest link" is not recorded: the manual says so.
8. A broken `_body` gave a generic error: now a plain 400 explaining URL-encoding.

Honest limits: both simulated AIs are Claude sub-agents, not ChatGPT, Gemini, z.ai or DeepSeek; the paste wording rests on PROJEXA's 3-of-3 result, not on a fresh multi-vendor test here. A real chat AI may still refuse to open a localhost-style or unknown address, or truncate the manual; that cannot be tested from this laptop.

## Live verification (2026-10-05, https://corporate-bingo.pages.dev)

Deployed with the normal recipe (free Pages + Functions + D1, no new add-ons, no D1 migration needed). A throwaway organizer was minted with the platform key (`POST /api/org`, then `POST /api/org/ai`), not through `/api/start` (which e-mails). Checked with curl: the minted paste is two lines (300 characters) with the key only in the link; `GET /ai/<key>` returned 200, `text/plain; charset=utf-8`, `x-robots-tag: noindex, nofollow`, `referrer-policy: no-referrer`, `cache-control: no-store`, 19.8 KB with 36 absolute keyed addresses; `?format=json` 200; whoami, history, schedule through the link; the header path and `/api/z/ai-manifest` still 200; unknown and malformed keys `404 Not found.`; GET-only create, settings (with invitations), roster (2 fake numbers) and summary; announce on a draft 400; publish returned the console hand-over; erase through GET mode and through a real POST both 403; minting a key 403; `_method=DELETE` 400; `_method` on `/api` ignored (404); a co-host key got its own narrower manual, could read the summary and was refused a settings change (403); the audit trail listed all calls with `/api` paths and the key appeared nowhere in it. Afterwards every key of that test organizer (organizer, AI, co-host) was revoked directly in D1 (both links now answer 404). The test draft `AILINK-LIVECHECK` (two fake roster entries) was left in place; it is forgotten automatically after the 30-day draft rule.

## Live verification of the final design (2026-10-05, https://corporate-bingo.pages.dev)

D1 migration `0006_link_expiry.sql` applied first, then Pages deployed (free, no add-on). A throwaway organizer was minted with the platform key (no e-mail address on file, so nothing was e-mailed to anyone; `mailed: false` returned the paste instead). Checked with curl: Replace returned a lasting key; "Get a fresh AI link" returned a 24-hour key with `expiresMs` set; both `/ai/<key>` links 200; `GET /api/org/ai/link` with the organizer key returned the lasting paste; an AI key, the 24-hour key and an anonymous caller got 403 on it, and an AI key / 24-hour key got 403 on fresh and replace; after a second Replace both the 24-hour key and the old lasting key answered 404; `/ai-link.html` 200; the live `zc.js` has the new button and `ai-link.js` the seven buttons. The 24-hour expiry boundary itself (23 h 59 min valid, 24 h 404) is proven in `apps/edge/test/ai-mail-expiry.test.ts` with a controlled clock, not waited for live. The unfamiliar-use alert needs a mail address, so it is proven by tests only. Afterwards every key of the test organizer was revoked in D1 and its sealed lasting-key row deleted (old master key 403). The HTML mail was rendered in Chrome and reviewed; no real e-mail was sent.

## The sign-in e-mail (existing account, 2026-10-05)

When an address that already has an account asks to sign in (`POST /api/auth/email`), the mail (`signInMail` in `apps/edge/src/mails.ts`; subject "Sign in to Corporate Bingo - choose how you want to continue"; HTML + plain text, same look as the AI-link mail) offers three ways: Option 1 button "Sign in and get my AI work link" (lands on `/ai-link.html`), Option 2 button "Open my console" (`/zc.html`), Option 3 the 6-digit code for a sign-in page already open. It contains NO AI key or paste text (it is triggered without being signed in; the buttons lead to the signed-in page). Both buttons open `/signin.html?t=<token>&go=ai|console`, which only shows "Continue to Corporate Bingo" (a mail scanner's GET consumes nothing; the token leaves the address bar at once). Pressing it POSTs `/api/auth/link`, which consumes the single-use token (only its hash is stored in `login_code.link_hash`, D1 migration `0007_login_link.sql`; the first POST wins and the code dies with it) and returns the same kind of `cbk_` session key the 6-digit code creates; the page stores it as the console does and goes on. Token and code share one 10-minute expiry; a new request replaces both; the old 5-mails-an-hour limit is unchanged, and 20 bad link tries a day per network get 429. Tests: `apps/edge/test/ai-signin.test.ts`, a DOM test in `apps/web/test/pages.test.ts`.

Live check (2026-10-05): deployed with D1 migration 0007. A throwaway organizer plus a login row with a known token were set up directly in D1 (no mail sent to anyone). Results: /signin.html redirects to /signin keeping the query and returns 200; a GET on the link API is 404 and consumes nothing; wrong and malformed tokens 400; the first POST returned a cbk_ session (whoami: master), the second POST 400; afterwards the organizer, session and rows were revoked/deleted (403).

## Help Desk helper keys (2026-10-19)

An AI key that belongs to a Help Desk helper (`created_by 'd'`) gets one more paragraph at the end of its manual (`GET /ai/<key>`, and `helpDesk` in `?format=json`): the AI prepares the game for the Organizer, never publishes or pays, and asks the Organizer to publish with `POST /api/helpdesk/request-publish {"eid": "<id>"}` (the key knows its own client). The unfamiliar-use alert skips these keys, and the Organizer's own `replace` and `revoke` of the AI link leave them alone. See `apps/edge/src/helpdesk.ts` and `docs/HELPDESK_SPEC.md`.
