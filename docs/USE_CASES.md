# Corporate Bingo: use cases, exceptions and what can go wrong

Every row has an ID. The tests carry the same ID in their names (`UC-12 ...`), so `grep "UC-12"` finds the test.
Automated tests live in `apps/edge/test/usecases.test.ts` (server and money), `apps/edge/test/free-launch.test.ts` (the organizer journey),
`packages/beacon/test/phone-runtime.test.ts` (phones, timing, pauses) and `tools/sim/*` (crowds and real-time runs against the real public beacon).
"Live" rows were run against https://corporate-bingo.pages.dev.

## The business rule
Building and publishing are free. The organizer pays before the start time. If it is not paid by the start, the engagement does not begin.

- **Case 1.** Published, organizer did not pay, engagement did not start: no loss to us, nothing was delivered, the organizer can create a new engagement next time. (UC-10, UC-11)
- **Case 2.** Published, organizer paid: we are paid, the engagement runs, the organizer can create a new engagement next time. (UC-9, UC-14)

## A. Organizer: getting in
| ID | Scenario | Expected |
|---|---|---|
| UC-1 | New email, "Create Engagement" | Console opens at once, no email sent, AI work link ready |
| UC-2 | Email that already has an account | NOT let in by typing it; must use the e-mailed 6-digit code |
| UC-3 | Wrong code, expired code, 6th attempt, code reuse | Refused with a human message; code dies after 5 wrong tries or 10 minutes |
| UC-4 | Many accounts from one network in a day | 6th is refused (free-plan guard) |
| UC-5 | Invalid email text | Refused |
| UC-6 | Organizer key revoked or made up | Every call refused |

## B. Organizer: building
| ID | Scenario | Expected |
|---|---|---|
| UC-7 | Build by hand, or with the AI link | Saved as a draft; participants cannot see or join it |
| UC-8 | More than 10 drafts | Refused with a clear message |
| UC-8b | Bad input: bad id, cap 0 or 100001, speed not a multiple of 3, rewards/breaks invalid | 400 with a message, nothing saved |

## C. Publish and pay (the money flow)
| ID | Scenario | Expected |
|---|---|---|
| UC-9 | Publish (free) with confirmed email and mobile, then pay before the start | Entitlement created, engagement paid, begins on time, organizer e-mailed the link and what is due |
| UC-10 | Published, never paid, start time reached | Phones hold and show nothing; control says locked; organizer e-mailed once ("could not begin") |
| UC-11 | After UC-10 the organizer comes back later | Can create a new engagement; the unpaid one is forgotten after 30 days |
| UC-12 | Pay AFTER the start time passed | The first number comes 2 minutes after the payment is confirmed, for everyone already waiting; phones unlock and read the new start |
| UC-13 | Publish twice, or publish two tabs at once | One publish, no error, no double e-mail |
| UC-14 | Payment confirmed by the gateway webhook only (browser closed) | Same result as paying in the browser |
| UC-15 | Two payments for the same engagement | Second one is not wasted: kept as a credit for the next engagement |
| UC-16 | Pay for someone else's engagement, or with a made-up key | Refused (404 / 403), nothing charged |
| UC-17 | Pay for an engagement that is already paid | Refused (409) |
| UC-18 | Tampered amount, wrong signature, payment not captured | Refused; nothing fulfilled |
| UC-19 | Draft was forgotten (30 days) before the payment arrived | No crash; the money becomes a credit |
| UC-20 | Engagement bigger than any pack (over 10,000) | "Custom arrangement" message, no checkout |
| UC-21 | Cap raised after payment above the pack | Refused until a bigger pack is bought; lowering below people already joined refused |
| UC-22 | India: GSTIN missing or wrong shape | Refused by the server, not only the page |
| UC-23 | Payments not switched on | Clear "opens soon" message; engagement stays published and holds at the start |
| UC-24 | Publish after the start time has passed, or start time in the past | Refused: "choose a new start time" |
| UC-25 | Unpaid engagement moved to a new start time, including after the old one passed | Allowed; paid one cannot be moved after it started |
| UC-26 | Daily reminder | One e-mail, only for unpaid published engagements starting within 36 hours; none for paid, far-future or already started |
| UC-27 | A pack was already bought (credit) | Publishing is paid at once |

## D. Participants (phones)
| ID | Scenario | Expected |
|---|---|---|
| UC-28 | Join a draft | Refused ("not open yet"); its info is hidden too |
| UC-29 | Join a published engagement before payment | Allowed; they get a ticket and wait |
| UC-30 | Same number twice, different formats of the same number | One participant, same ticket |
| UC-31 | Invalid or too short number | Refused with a human message |
| UC-32 | Engagement full, even with many joins at the same instant | Never more than the limit |
| UC-33 | Invite-only engagement, number not on the list | Refused |
| UC-34 | Name with markup or too long | Cleaned and cut |
| UC-35 | Phones never learn who else joined, or why it is held | Only counts and ids; the hold message never mentions payment |

## E. Timing and the game itself
| ID | Scenario | Expected |
|---|---|---|
| UC-36 | Numbers appear exactly at their round, never early | Phone test |
| UC-37 | Every phone shows the same numbers as the public reference | Phone test and crowd simulation |
| UC-38 | Locked, then unlocked | Nothing shown while locked; carries on after |
| UC-39 | Start boundary: one second before and exactly at the start | Not locked before; locked from the start |
| UC-40 | Signed pause, resume, stop | Nobody sees a number during a pause |
| UC-41 | Lock and a pause together | Still held, nothing revealed |
| UC-42 | Beacon unreachable, a lying mirror, a phone offline | Nothing invented; exact catch-up |
| UC-43 | Phones that open late | Same log as everyone |
| UC-44 | Real clock, real public beacon, a signed pause (live) | All phones agree |

## F. Exceptions: what can go wrong
| ID | Scenario | Expected |
|---|---|---|
| UC-45 | Mail service down | The request still succeeds; the mail is kept and retried; never blocks a sign-in or publish |
| UC-46 | Daily write budget reached | A polite "busy" answer, no half-saved state |
| UC-47 | Housekeeping fails | Never breaks a user request |
| UC-48 | Oversized body, malformed JSON | Refused cleanly |
| UC-49 | Organizer A reads or changes organizer B's engagement | Refused |
| UC-50 | The AI key tries to publish, pay, erase, settle, manage keys | Refused (it can only hand over the link) |
| UC-51 | Erase all participant data | Done on request; 365-day purge also removes flags and contact details |
| UC-52 | Claim for something not completed | Not accepted |

## G. Pages (browser)
| ID | Scenario | Expected |
|---|---|---|
| UC-53 | Landing page, all five steps, Create Engagement buttons | Live check |
| UC-54 | Console: two options at the top, draft card, payment-due card, locked card, big-screen link | Live check |
| UC-55 | Payment page: order summary, billing form, validation, test/off/razorpay modes | Live check |
| UC-56 | Big screen: countdown, big number, board, paused | Live check |
| UC-57 | Phone page shows "waiting for the organizer" when locked | Live check |
| UC-58 | Mobile width and tablet | Live check |

## H. Free plan, announcements, co-hosts, scratch cards, pages (added 2026-10-02)
| ID | Scenario | Expected | Test |
|---|---|---|---|
| UC-70 | Pause key registered for engagements of different sizes | Up to 250 standard, up to 1,000 slower, up to 2,000 slower still, above that refused with a clear message and no file (phones will not keep asking) | usecases.test.ts |
| UC-71 | A slower profile | Longer lead before a pause takes effect, so nobody sees a number a pause should have prevented | usecases.test.ts |
| UC-72 | Size raised to another profile before any pause was sent | The unused key is forgotten and the console registers the right one; after a pause was sent it stays | usecases.test.ts |
| UC-73 | Request budget | A phone of an unpausable engagement asks at most about 3 times in 20 minutes; a 800-person profile about every 30 s | phone-runtime.test.ts |
| UC-80 | Announcement | Reaches phones inside the pause check they already make; new message has a new id; clear removes it; cleaned and cut; rate limited; not for drafts, the AI or strangers; shown, spoken and dismissible on the phone; big banner on the big screen | usecases, phone-runtime, pages tests |
| UC-81 | Co-host | Can watch and message only; cannot change, publish, pay, erase, make keys or create engagements; at most five; retiring stops it at once; its link keeps the key out of the address bar | usecases, pages tests |
| UC-82 | Scratch card | A lucky draw can be a scratch card; only lucky draws have the style; winner scratches to reveal; opens by itself after 45 s; non-winner sees "Not this time" | usecases, pages tests |
| UC-83 | Waiting room | Before the first number: countdown, what can be won, how it works, sound check, add to calendar; never mentions money | pages tests |
| UC-90 | Console pages in a DOM | Home options first; draft to publish with confirmation; invalid details; held state; wrong sign-in never freezes; announcements; co-host screen; break editor | pages.test.ts |
| UC-91 | Payment page in a DOM | Not signed in; payments off; paid end to end in test mode (validation first); paying while held says when it begins; already paid | pages.test.ts |
| UC-92 | Big screen in a DOM | Countdown, announcement, held, draft | pages.test.ts |
| UC-93 | Phone page in a DOM | Draft refused; join before payment and waiting room; held; announcement; scratch card | pages.test.ts |

---

# Test results (2026-10-02)

Run: `bun test packages apps tools/control-worker` gives **479 passing, 0 failing** (type check clean). Real-time runs are listed below.

## Where each use case is tested
| IDs | Where | How |
|---|---|---|
| UC-1, UC-2, UC-4, UC-7, UC-9, UC-10, UC-12, UC-13, UC-27, UC-28 | `apps/edge/test/free-launch.test.ts` | The organizer journey, step by step |
| UC-3, UC-5, UC-6, UC-8b, UC-14 to UC-26, UC-28 to UC-35, UC-39, UC-41, UC-45 to UC-52, UC-60 to UC-63 | `apps/edge/test/usecases.test.ts` | One named test per case, with a stand-in payment gateway and a stand-in mail service |
| UC-36, UC-37, UC-38, UC-40, UC-42, UC-43 | `packages/beacon/test/phone-runtime.test.ts` | Simulated phones, a fake clock, a fake beacon; includes the held-for-payment test |
| Money: price, GST, packs, invoice, partners | `apps/edge/test/pay.test.ts`, `partners.test.ts` | Payment flow including paying for a draft |
| UC-44, 10,000 phones, free-plan write budget | `tools/sim/crowd.ts`, `live-local.ts` | Real public beacon, real clock, a signed pause |
| UC-10 (live) | `tools/sim/live-unpaid.ts` against the live site | New organizer, build, publish, 3 phones, nobody pays: held, no number shown, 12/12 checks |
| UC-9 and UC-12 (real time) | `tools/sim/live-paid.ts` against a local server in test-payment mode | Pays in time: starts on time and matches the public reference. Pays late: begins about 3 minutes later with the same numbers on every phone; 9/9 checks |
| The organizer's external AI | A separate Claude acted as ChatGPT-style assistant with only the pasted AI work link, and a persona organizer answered | Two full conversations against the live site (create, settings, roster, summary, publish hand-over) |
| UC-53 to UC-58 | In-app browser on the live site | Landing (mobile width too), console in draft, payment-due, and held states, payment page, big screen (countdown, running, held), phone page held |

## What testing found and what was done
| Found | Where | Fix |
|---|---|---|
| A crowd joining at the same instant could pass the limit | UC-32 | The last places are now claimed by one atomic insert |
| A phone could show the first number at the very start before it learned the engagement was held | Live run | The hold now starts 45 seconds before the start time |
| Guests could learn the engagement was unpaid from the public info | UC-35 | Only the organizer sees "unpaid"; phones only see "held" |
| GSTIN was checked only on the page | UC-22 | The server checks it too (an empty one is still allowed) |
| The simulated external AI did not know about the lucky draw, one reward line per winner, the two-ticket house, how to read back what was saved, or the payment rules | AI run 1 | Manifest now has the full schema and a worked example, a `summary` read-back, a payment FAQ, and a helpful 404 |
| Console froze on "Loading..." when an engagement was held for non-payment (a held answer was mistaken for a pause file) | Live browser | Fixed in the console and the big screen; the console now shows an error message instead of freezing |
| The console showed numbers called while guests saw nothing (held) | Live browser | The console shows 0 called while held |
| Link buttons were misaligned | Live browser | Styled as buttons |
| Browsers kept an old script for an hour after a release | Live browser | Scripts and styles are re-checked on every load |
| 5 new organizer accounts per network per day was tight for an office | Live | Now 10 |

## Known limits and decisions
- The page scripts are tested in a DOM (`apps/web/test`, happy-dom, free), not in a real browser engine: layout and real touch behaviour were checked by hand on the live site.
- Online payment itself is not testable end to end until Razorpay keys exist. Everything around it (order, signature check, webhook, late payment, tampering, duplicates) is tested with a stand-in gateway.
- Phones check for the held state about every 6 to 9 seconds, so a late hold or a late release can take up to about 12 seconds to reach a phone.
- Mail is a nudge only: nothing depends on a mail arriving.

## K. Winners by the software, one ticket per phone, prize hand-over, report link, AI audit (2026-10-04)
| ID | Scenario | Expected |
|---|---|---|
| UC-94 | Organizer, Host, Co-host, AI or a stranger posts a result (`/settle`) | Refused (403); nothing stored |
| UC-95 | One phone reports a winner | Not accepted; accepted only when `quorumFor(people)` different phones report exactly the same winners |
| UC-96 | Phones disagree, or a minority reports a made-up result | The agreed result stands; a made-up one is ignored; an accepted result is final |
| UC-97 | Lucky draw | Every phone works it out from the public randomness and the seat list; accepted by the same quorum |
| UC-98 | A second mobile number on the same phone | Refused (`device-used`); other phones still join; invitations (max 4 per person) still give each invitee their own ticket on their own phone |
| UC-99 | A winner confirms name and mobile after the game | Only the phone holding the ticket can; a change keeps the original and an audit trail; organizer and co-host see both |
| UC-100 | Organizer / Host ticks "prize given" | Date kept; the report shows it |
| UC-101 | Report | One e-mailed link; the PDF is laid out in the organizer's browser; link dead after the 22-hour deletion; reminder 6 hours before if never opened |
| UC-102 | External AI works | Every call is written to the audit trail (time, key, request, status, network address, program, country); only the organizer (and we) can read it |

## L. The short AI work link `/ai/<key>` (2026-10-05)
| ID | Scenario | Expected |
|---|---|---|
| UC-103 | Organizer pastes the two-line message into a chat AI | The link opens the full manual as plain text (or `?format=json`); every address in it is absolute and carries the key; the key is nowhere else in the message |
| UC-104 | AI that cannot set headers or POST | Calls `/ai/<key>/<api path>`; same answers as `/api/<path>` with the key in `x-organizer`; the audit trail records the `/api` path and the real method, never the key |
| UC-105 | Browse-only AI performs an action | `GET .../path?_method=POST\|PATCH&_body=<URL-encoded JSON>` (body at most 6 KB, rosters about 20 people at a time); rejected on the normal `/api` routes, for other methods and when too long |
| UC-106 | Unknown, mistyped, revoked, sign-in (`cbk_`) or platform key in an address | Identical plain `404 Not found.`; nothing recorded; the key is never echoed |
| UC-107 | Organizer's AI does what an organizer does in the console | Announce to guests, invitation policy, mark seats, change of phone, prize-given ticks, prizes (mobile numbers cut to the last two digits), results/life/claims, create co-host key, read its own audit trail |
| UC-108 | Organizer's AI tries payment, publish, erase, pause/stop, key management, winners | Refused or hand-over only (publish returns the console link; erase/pause are requests the organizer approves); the report address is never given to the AI |
| UC-109 | Co-host key (`cbh_`) through the link | A narrower manual; may watch, announce and tick prizes; everything else 403; its calls are audited too |
| UC-110 | Organizer signs up | One dedicated mail: HTML + plain text, red do-not-forward warning top and bottom, steps, a "Show my AI work link" button (sign-in page, no secret in the address), and the paste as plain text in a box using a separate key that works 24 hours; says how long it works and how to get a fresh one |
| UC-111 | Organizer publishes | The publish mail (share link, pay link) carries no AI link or key and is safe to forward; reminders, "could not begin", invoices, report-link, partner mails and report PDFs never carry one |
| UC-112 | "Replace my AI link" | Every AI key (lasting and 24-hour) stops at once (old `/ai/<key>` is 404), a new lasting key is shown, a new 24-hour key is mailed, audited; AI/co-host/platform keys and strangers get 403 |
| UC-113 | "Get a fresh AI link" | A new 24-hour key is mailed; the lasting key and other links keep working; organizer only; at most 5 live |
| UC-114 | The mailed link at 23 h 59 min and 24 h | Works, then the same plain 404 as an unknown key; the lasting key never expires |
| UC-115 | Signed-in "Show my AI work link" page | Asks for the organizer sign-in; shows the two-line paste with Copy, seven AI buttons (ChatGPT, Grok, Claude pre-filled; Gemini, DeepSeek, z.ai copy-and-open; plain copy), Fresh and Replace, warnings top and bottom |
| UC-116 | Host key made | A lasting Host key for the console; the mail to the Organizer carries a separate 24-hour Host key for an AI link, says whose engagements and that through the link it is watch/announce only. A Co-host (`cbc_`) is made with `POST /api/org/cohost`: invites and pays only (tests: `apps/edge/test/roles.test.ts`) |
| UC-117 | A link is used from a new country, network or program | One plain alert e-mail without any link or key, at most one per key per 24 h; the first use never alerts |
| UC-118 | A mail scanner or chat tool opens `/ai/<key>` | Nothing changes except the audit line and the alert baseline |
| UC-119 | Existing account asks to sign in | One mail with three ways: AI-link button, console button, 6-digit code; no AI key or paste in it; the buttons are single-use 10-minute links that go through a confirm page, so a mail scanner opening them signs nobody in |
