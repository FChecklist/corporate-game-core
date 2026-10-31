# Breach runbook (internal)

For Corporate Bingo. A breach is any loss, leak or unauthorised use of personal data (names and mobile numbers of players, winners' prize details, organizer or partner details), or of a key that opens them. Keep it short. Act first, write after. DRAFT FOR LAWYER REVIEW.

## 1. Spot it (who, what)
* Signs: an unfamiliar-use alert mail to an organizer; a spike in `ai_audit` rows; 403 or 503 bursts; a vendor notice (Cloudflare, Resend, Razorpay); a report from a player or organizer; a leaked key.
* Owner of this runbook: the owner (Rajat Agarwal). The Grievance Officer contact is `rajatsiroffice@gmail.com`.

## 2. Contain (first hour)
1. Write down the time and what you saw. Do not delete evidence.
2. Leaked platform key or secrets: rotate as in `docs/compliance/KEY_RUNBOOK.md` (`wrangler pages secret bulk`, redeploy). Do NOT rotate `DATA_KEY` while engagements hold participants (sealed rows would become unreadable); treat a `DATA_KEY` leak as the highest case below.
3. One organizer's key leaked: in the console press "Replace my AI link"; retire other keys in the Keys card. An organizer's lasting key is stored sealed, so a database copy alone does not reveal it.
4. Stop the bleeding: set `STRICT_KEYS=1` and remove one required secret to make the Worker answer 503 to everything, if needed. Restore after the fix.
5. A vendor breach: follow the vendor's steps, then continue at 3.

## 3. Assess (same day)
* What data, how many people, which engagements (`SELECT eid ...`), over what period.
* Names and numbers are sealed (AES-256-GCM) in the database: a copy of the database without `DATA_KEY` is not readable. Winners' prize details are sealed the same way. Participant data is deleted 23 hours after a game ends (the promise to players is 24 hours), so a leak of an old copy covers only games that were live or recent.
* Was `DATA_KEY` exposed? If yes, assume all sealed rows of live games are exposed.
* Decide: is there a likely risk to people? Write the decision and the reason.

## 4. Tell people (do not wait for a perfect picture)
* Organizers affected: by e-mail from the Grievance Officer address, without undue delay. Say what happened, what data, what you did, what they should do. Our data processing terms promise this.
* Players: through their organizer (we hold no way to reach players directly, by design).
* Regulators (a lawyer decides, same day): India Data Protection Board (DPDP Act s8(6) and Rule 7: tell the Board and each affected person; the Board's detailed report follows within a short window); EU/UK supervisory authority within 72 hours if GDPR applies; US state rules vary. Keep the lawyer's contact here: ________.

## 5. Fix and learn (within a week)
* Fix the cause. Add a test that would have caught it. Update `docs/RETENTION.md` and this file if something changed.
* Write a short record: date, cause, data, people told, regulator notices, fix. Keep it 3 years.

## What we cannot do alone
* Decide whether a regulator must be told, and the exact wording of notices: lawyer.
* Vendor-side logs and investigation: vendor dashboard and support.
