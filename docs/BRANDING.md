# Branding: Corporate Bingo, the same everywhere

The name is spelled exactly **Corporate Bingo** (never in capitals, never "Bingo" alone as the product name). The palette is the site's: brand blue `#0B3D91`, gold `#E0B872`, light blue-white background. The logo mark is the ticket icon (`/icon-192.png`, blue square with the gold ticket); the wordmark is "Corporate Bingo." in the serif face. One support address (the one the legal page publishes): `rajatsiroffice@gmail.com`. One legal link: `/legal.html`.

Single source for e-mail: `apps/edge/src/brand.ts` (`BRAND`, `headerHtml`, `footerHtml`, `footerText`, `pageHtml`, `plainToHtml`, `withFooter`). Every e-mail goes through `sendMail` / `sendReportMail` (`apps/edge/src/pay.ts`), which add the footer to the text part and wrap any plain mail in the branded HTML, so a mail without the brand cannot go out. The six builders in `apps/edge/src/mails.ts` use the same header and footer rows.

Guard: `apps/edge/test/branding.test.ts` fails if an exported `*Mail` builder lacks the header or footer (in HTML and text), if a new builder has no sample in the test, if any mail of a full lifecycle lacks the footer, if the mail service is called from anywhere but `pay.ts`, or if a page loses its title pattern, icons, manifest or theme colour. (Checked by removing the footer row: 5 tests failed; restored.)

## Inventory

| Touch point | Before | After |
|---|---|---|
| Sign-in pop-up (home) and confirm page | "Enter the 6-digit code", developer text "In production the code arrives...", no brand | Eyebrow "Check your inbox", title "Check your email", new body, label "6-digit passcode", buttons "Sign in" / "Send me a new code", help line; brand (logo mark + wordmark) top right beside the close button; 48-50 px tap targets, numeric keypad, `autocomplete="one-time-code"`, focus rings, `aria-labelledby`, live help line |
| Sign-in e-mail | Plain text code, no brand | Three options, branded header/footer (see `docs/AI_LINK.md`) |
| AI-link e-mail, co-host e-mail, new-use alert | Own dark header, no footer, navy/gold | Shared blue header with logo + wordmark, shared footer (name, support address, legal link) in HTML and text |
| Publish, reminder, could-not-begin, delete request, deletion confirmation, payment/invoice, report and report reminder e-mails | Plain text, some with a typed "Corporate Bingo" sign-off, invoice subject "CORPORATE BINGO: ..." | Same text, now also as branded HTML with the shared header; the shared footer replaces the sign-off; invoice brand name "Corporate Bingo" |
| Report PDF | Header "Corporate Bingo", footer with name | Unchanged header and footer, plus a closing line with name, support address and legal link |
| Home, legal, partner, pay, big screen, console (zc), play (z), report, AI-link, sign-in pages: titles | Mixed separators ("·", ":", "–", "-"), some just "Corporate Bingo" | `<Page> | Corporate Bingo` (home keeps its marketing title) |
| Same pages: icons | Only some had touch icon/manifest/theme colour; none had a favicon link | All shipped pages: favicon, touch icon, manifest, theme colour `#0B3D91` |
| Page headers inside the app (zc, pay, AI-link, sign-in, play, partner, report) | Text only, some without the name ("Engagement X", "Co-host") | Logo mark before "Corporate Bingo · ..." on every header; every header names the product; report page now has a header |
| Big screen | Text brand | Logo mark before the brand |
| PWA manifest | `short_name` "Bingo" | `short_name` "Corporate Bingo" (icons unchanged) |
| Error pages | Pages' default (single-page fallback to the home page) | Branded `404.html` with a way home |
| AI manual and paste text | Manual heading in capitals | "Corporate Bingo: instructions for ..." (paste text already said "Corporate Bingo account") |
| Share and calendar texts (invite share, calendar, "thank you" share) | Already used "Corporate Bingo" | Unchanged |
| Razorpay checkout / invoice brand name | "CORPORATE BINGO" | "Corporate Bingo" |
| Partner e-mails | None are sent (no partner mail exists) | n/a |

## Not changed, on purpose

* The in-game phone screens and the tickets keep their own look (they are the product, not a touch point of the company).
* Internal tool pages (`console.html`, `play.html`, `screen.html`, `confirm.html`) are not shipped to the live site; `confirm.html` got the new pop-up copy anyway so it matches.
* A failed e-mail is retried as plain text (the HTML part is not kept), so a retried mail carries the footer but not the header.

## Live check (2026-10-05)

Deployed to the free Pages site. Pretty paths /z /zc /pay /big /report /legal /partner /ai-link /signin answer 200; an unknown path now answers the branded 404 page; the live manifest says "Corporate Bingo"; live titles follow the pattern; the sign-in pop-up (opened with an address that has no account, so no e-mail is sent) renders the new copy with the brand top right at 390 and 900 px, numeric keypad and one-time-code autocomplete. No e-mail was sent to anyone.

## "Create your engagement" pop-up (2026-10-05)

Redesigned in `site.js` (`openFree`) and `app.css`: role pill "For the organizer or host", brand (logo mark + wordmark) top right beside the close button (same as the sign-in pop-up), eyebrow "Build it and publish it free.", title "Create your engagement", eight icon bullets (two columns from 700 px, one column on a phone), field "Your email" (placeholder you@example.com, `inputmode="email"`, `autocomplete="email"`), button "Create my engagement", trust line, and the note "Your console opens straight away: no password needed. We use your email for your invoice and to sign you back in later." The sheet is 780 px wide on desktop; Esc closes it; on a phone the top stays in view when it opens (focus goes to the dialog, the keypad opens when the field is tapped). The service-worker cache is bumped to `cb-game-v6` because `app.css` changed.

Claims checked against the code before keeping them: unique tickets (`packages/beacon/src/unique-ticket.ts`, a keyed permutation, so no two tickets in an engagement can be equal); mobile number only, no app, no SMS, no password (join flow; the page is an installable web page, nothing to download); video or audio between numbers (brand breaks: file, YouTube, slides, speech, in `config.ts`); several prizes (reward lines) and a lucky draw (a break kind); participants never pay (payment is the organizer's only); invite-only or open with a link (`closed` flag); free AI assistant (the AI work link is included with every engagement). Corrected from the draft: deletion is stated as names and mobile numbers deleted within 24 hours after the game ends (they go 22 hours after the end; the winners record without names or numbers and the organizer's own details are kept up to 365 days, which the privacy text states), and "private" is described as invite-only or by link rather than "closed group" alone. The word "work" was dropped from the e-mail field. Payment is not in the eyebrow (owner request); it stays in the trust line ("Pay only before the start") and on the pricing and pay pages and in e-mails.

## Brevity rule (2026-10-05, owner)

Short sentences, one idea each; nothing that explains instead of helping the next click. Legal text lives on the legal pages (and in the report notice the law-facing tests require). The pop-up lists nine one-line bullets in this order: video/audio between numbers; several prizes and a lucky draw; closed-group corporate bingo; unique tickets; own ticket for each participant; free AI assistant; participants never pay; participant data deleted within 24 hours of the game ending; "Built for DPDP Act, GDPR and US privacy laws" (the softer wording: no lawyer review is recorded in `docs/`, so "compliant" is not claimed). The do-not-forward warning is one sentence ("DO NOT FORWARD: this email holds your personal AI work link").

| Text | Words before | Words after |
|---|---|---|
| AI-link e-mail (incl. the 40-word paste box) | 436 | 194 |
| Co-host e-mail (incl. paste box) | 361 | 213 |
| Sign-in e-mail | 143 | 88 |
| New-use alert e-mail | 79 | 28 |
| Publish e-mail | 86 | 32 |
| Payment reminder e-mail | 43 | 26 |
| "Could not begin" e-mail | 32 | 19 |
| Create-engagement pop-up (all visible text, now 9 bullets) | 142 | 116 |
| Sign-in pop-up body and help line | 54 | 33 |

Also shortened: delete-request and deletion-confirmation e-mails, the payment e-mail's first lines, the sign-in confirm page, the AI-link page, and the console's Option 1 card. Not shortened on purpose: the end-of-game report e-mail and PDF (they carry the data-handling notice the privacy tests check) and the legal pages.

SW cache bumped to cb-game-v7 for this change (app.css changed again).

## Privacy Policy link (2026-10-05)

No consent tick box anywhere. A small quiet "Privacy Policy" link (11 px, muted, regular weight, centred, `target="_blank" rel="noopener"`) to `/legal.html#privacy` sits under the join page (participant mobile number and name), the create-engagement pop-up and the sign-in e-mail pop-up. Class `.spriv` in `app.css` and `z.css`; DOM tests in `apps/web/test/pages.test.ts`. SW cache `cb-game-v8`.
