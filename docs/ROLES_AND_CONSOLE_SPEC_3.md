# Phase 2 spec (owner-approved 2026-10-08): people, links and joining

Supersedes items 8 to 10 of `docs/ROLES_AND_CONSOLE_SPEC_2.md`. Same style rules: owner is non-technical; super simple; plain words; tap choices (no dropdowns); hints at most 2 sentences. **E-mail rule: only the Organizer and Host have an e-mail; everyone else gives name + mobile only.**

## The model: one list per inviter, two kinds of link

- Every inviter has **a list of people** (name + mobile). Inviters: Organizer, Host, Co-host, participant level 1 (L1). A participant invited by an L1 is L2: plays, no list, no invites.
- A person is on **one list only**; **first wins** (unique per game on the phone hash). A second add says "already invited" (it names the first inviter only to the Organizer and Host). Organizer and Host can move a person to another list by hand.
- Limits (counted on the **list**, not on clicks): Organizer and Host unlimited; Co-host default 100 per game (Organizer can change 10 to 1000); L1 default 4, the Organizer or Host chooses 1 to 10 per game (change `MAX_INVITES_PER_PERSON` to 10 and the settings validation). A removed or cancelled invite frees its place. Hard cap is always the size bought.
- **Personal link** (strong): made for one number, e.g. `https://<site>/j/<token>` (short; Worker route, redirect to the game with the token; page has Open Graph tags so WhatsApp shows "<name>, you are invited to <game>" plus the brand strip when it exists). The invitee types nothing. Single use: binds to the first phone; the inviter can "send again" to unlock a new phone. If a different number uses it, that person goes to the waiting room (admitted by the link owner/chain or Organizer/Host).
- **Common link** (convenient): one per inviter, `z.html?e=ID&from=<id>`. The guest types their mobile number. If the number is on **any** list of this game they are recognised and placed under their real inviter (first wins), even through another inviter's link. If not on any list: the game setting **"Who can join"** decides: **"Only people on a list"** (default): they wait in the waiting room; **"Anyone with the link"**: they join at once under the link owner up to that owner's limit, beyond it they go to the Organizer/Host waiting room. The Organizer and Host choose this in step 2 (How it plays) and can change it until the game starts.
- Everyone, including the Organizer and Host, **plays through a personal link**: the console has "Play now" (opens their ticket) and "Send my play link to my WhatsApp" (wa.me to their own number). Their seat is flagged Organizer/Host automatically (no manual flag; they stay out of lucky draws). So a Host needs name + mobile + e-mail (Phase 1 collects name + e-mail: add the mobile).
- **Typed number is matched to a list, not proven.** Say so honestly in the code docs and the help text; personal links are the strong proof.

## Adding people (one screen, same for all four roles; Organizer/Host/Co-host also get bulk)

1. **From my contacts** (Android Chrome Contact Picker; feature-detect and hide elsewhere), **Add a name and number**, **Paste from Excel** (a box: one person per line or copied cells), **Upload a CSV** (Organizer, Host, Co-host only). Excel (.xlsx) upload only if a small reader is trivially bundled; otherwise say "save as CSV".
2. **Cleaning**: remove spaces, dashes, +91, leading 0/00; accept 10-digit Indian mobiles starting 6 to 9 and numbers with another country code; remove duplicates; show a summary "212 good, 5 duplicates removed, 3 look wrong" with the wrong ones listed to fix.
3. Each row: name, masked number, status (Invited / Joined / Waiting / Removed), **Send on WhatsApp** (wa.me link with the person's number and a short personal message containing their personal link; marked "sent" locally), **Send again**, **Remove**. Plus **Copy common link** for groups. Organizer and Host also get **Download my list** (CSV: name, mobile, personal link, WhatsApp link, status). Never e-mail anyone but the Organizer and Hosts.
4. Privacy: store only the people picked/added, sealed (same sealing as participants); anyone who never joined is erased with the 23 h rule; the invitation screen says who invited them and shows the privacy line; the add screen says "Invite only people who would like to play."
5. Writes cost D1 writes: batch inserts; mention in docs that a 5,000-row upload uses about 6% of the daily write budget.

## Chain

Game -> Organizer -> Host -> Co-host -> L1 -> L2. Record who created each Co-host (`created_by`: the Organizer or which Host) and store the inviter on every invite/seat. Organizer and each Host have their own list and links. The report's "Who invited whom" tree starts at the Organizer and shows roles and, for admitted people, who admitted them.

## Remove people

Before the game: Organizer and Host any person; a Co-host and an L1 only their own people (option "only this person" or "this person and everyone they invited"). It frees the place, stops their links, and blocks the same phone from re-joining unless re-admitted. During the game: Organizer and Host only; the phone stops and shows "removed"; the **seat stays in the public seat list** so winners stay identical on every phone; a removed person who already won keeps the win and the prize is marked "not given: removed". Log every removal (who removed whom, when). A Host's remove or cancel e-mails the Organizer.

## Waiting room

Requests wait; they do not use up places. Approvers: Organizer and Host for everyone; the owner of the link (and the people above them in the chain) for people who came through their link. Approvers see first name + last 4 digits. Record **who approved** and when. Waiting guests see a calm message ("Your request is with <inviter>"). Requests lapse when the game ends.

## Console and phone page

- Console "Your guest list" becomes **My people** (Organizer, Host, Co-host's My page): add, rows, send, remove, admit waiting people with who approved, game switch "Who can join".
- Guest ticket page (z.js): L1 sees a small **My invites** card (add up to their limit, send on WhatsApp, remove before the game); L2 sees nothing; a person waiting for approval sees the waiting message.
- Keep everything else working; update tests that assert the old guest-list and invite-card wording.
