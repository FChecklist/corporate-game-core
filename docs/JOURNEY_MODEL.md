# Journey model (test tooling, no product change)

A mathematical smoke test of the whole path: home page -> master console (the single entry point) -> game site -> report PDF to the Organizer and Hosts -> all participant data deleted.
Code: `tools/journey/` (`catalog.ts` the variables, `model.ts` the journey and the invariants, `run.ts` the generator, `rng.ts` seeded random).

## 1. Variable catalog

| # | Dimension | Values | Count |
|---|---|---|---|
| 1 | route | home, games-bar, console, direct-game, invite, personal, qr | 7 |
| 2 | game | tambola, bingo, tictactoe, snakes, luck, luckydraw | 6 |
| 3 | identification | employee ID, e-mail, open to anyone | 3 |
| 4 | participant details | none, name, mobile, both | 4 |
| 5 | roster size | 0, 1, 2, 3, 5, 50, 500, 2000, 100000 | 9 |
| 6 | hosts | 0 to 5 | 6 |
| 7 | co-hosts | 0, 1, 5, 100 | 4 |
| 8 | payment | free, paid, failed then paid, abandoned, link copied, link opened by a payer | 6 |
| 9 | publish state | draft, published, published then edited | 3 |
| 10 | schedule | now, later, rescheduled, cancelled before publish | 4 |
| 11 | start mode | auto, manual | 2 |
| 12 | late join | none, late join in the waiting room | 2 |
| 13 | pause/resume | none, once, many | 3 |
| 14-19 | flags (close group, family, reactions, manual prizes, brand, rehearsal), each on/off | 2 each | 2^6 = 64 |
| 20 | device width | 320, 375, 768, 1280, 1920 | 5 |
| 21 | network | ok, drop and rejoin, long drop | 3 |
| 22 | report mail | delivered, bounce then ok at 24 h / 36 h / 72 h, bounce all | 5 |
| 23 | early delete | no, Organizer deletes | 2 |
| 24 | GPC | off, on | 2 |
| 25 | funnel properties | clean, e-mail in game field, digits in game field, extra fields (name, mobile, e-mail) | 4 |

The 13 funnel events are not a dimension: the model emits them as it walks the journey and the coverage report lists which were hit.

Arithmetic (the run prints it too):

    7 x 6 x 3 x 4 x 9 x 6 x 4 x 6 x 3 x 4 x 2 x 2 x 3 x 64 x 5 x 3 x 5 x 2 x 2 x 4
    = 7,223,692,492,800  (about 7.2 trillion)

Step by step: 7x6=42; x3=126; x4=504; x9=4,536; x6=27,216; x4=108,864; x6=653,184; x3=1,959,552; x4=7,838,208; x2x2=31,352,832; x3=94,058,496; x64=6,019,743,744; x5=30,098,718,720; x3=90,296,156,160; x5=451,480,780,800; x2x2=1,805,923,123,200; x4=7,223,692,492,800.

## 2. Invariants (the oracle), checked after every step

1. Console: creation is reachable only through the console; an organizer route never skips it.
2. Cap: admitted never over `capFor`; a full game refuses; elimination games (Tic Tac Toe, Snakes, Luck) stay at 2000 or less.
3. Identification: an e-mail is never taken as an employee ID; two participants never share an ID; open games need no ID.
4. Team: at most 5 Hosts; the change list holds roles only, never addresses; Co-hosts cannot start, pause or resume and never get the report.
5. Payment: published only if free or paid; abandoned or only-copied links never publish; started before succeeded; failed carries a reason from the fixed list.
6. Schedule: past and over-30-days times refused, future times accepted.
7. Clock: nothing moves while paused; resume continues from the frozen time; auto start never before the time.
8. Waiting room: 120 s; a waiting request lapses later than the waiting room closes; unlisted late joiner waits in a close group, enters in an open game.
9. Winners: Lucky Draw is repeatable, unique, a subset of the entries, at most the winner count; elimination ends with at most one survivor who is a participant and nobody is both in and out; Bingo settlement is repeatable and gives each prize place once.
10. Report: recipients are exactly Organizer + Hosts; no participant datum (ID, name, mobile) in the report input; first send within 3 h; retries at 24, 36, 72 h.
11. Deletion: never-published or Organizer-deleted data is gone at once; otherwise gone within 24 h of the end even with a scheduler up to 4 h late (the 20 h timer plus the gap stays under 24 h).
12. Nothing shown to other players: a player's view holds only that player's data.
13. Funnel: only the fields game, size, mode, reason (plus event, at, visit); no `@` or long digit run in any value; nothing sent under GPC; known event names; sane order (created before published before started before completed; started before succeeded).
14. Wording: no banned player word anywhere in the shown messages or the common legal text; the legal text passes the data-text rule.

## 3. How to run (streaming, resumable, shardable)

One bun process per machine, no workers, O(1) memory: every journey is decoded from its index, run, checked and dropped. Kept: counts, the first 20 indexes per invariant, a cell counter per catalog value and a 4018-bit pair bitmap.

    bun tools/journey/run.ts --dry-run --weights 3:1:3 --names partner,phone,cloud     # space size and the plan, runs nothing
    bun tools/journey/run.ts --seed 1 --from F --to T --out out/partner.json --budget-seconds 3600 --heap-mb 400
    bun tools/journey/run.ts --seed 1 --shard 0/8 --out out/s0.json                  # or an equal share
    bun tools/journey/run.ts --seed 1 --from F --to T --out out/partner.json --resume   # after a kill
    bun tools/journey/run.ts --seed 1 --replay K                                     # one journey with its violations
    bun tools/journey/aggregate.ts out/*.json                                        # one merged report

- **Index to journey:** journey k of the space is `(k * 2654435761 + offset(seed)) mod 7,223,692,492,800`, decoded by mixed-radix arithmetic over the 25 dimensions. The multiplier is coprime with the space, so this is a bijection: a range `[a,b)` never overlaps another and misses nothing, and every range is spread over all dimensions. `--mode sample` draws uniformly by a seeded hash of k instead (repeats possible).
- **Stops:** `--budget-seconds` and `--heap-mb` (process memory) stop cleanly after the current journey and report how far it got (`doneTo`). A checkpoint is written every 30 s (and on a clean stop) to `<out>.ckpt`; `--resume` continues from it and refuses a checkpoint of a different seed, mode or range.
- **Summary per shard (JSON):** range and `doneTo`, journeys, violations, violations by invariant with the first 20 indexes (replay with `--replay K`), counts per catalog cell, outcome counters, pair bitmap, seconds, journeys per second.
- **Aggregate:** total journeys and violations, share of the space, machine-hours, violations by invariant, catalog cells hit, pairwise coverage %, warning on overlapping ranges or mixed seeds.
- **Speed:** about 500 to 1200 journeys per second per core in the first runs, so a billion journeys is days of machine time; ranges give an exact, non-overlapping sample of the space. Pairwise coverage is about 99% after 5000 journeys, 100% soon after.
- **Exit code:** 1 if any violation.

Sample: seed 1, journeys 0 to 5000 (two ranges, aggregated): 0 violations, 92 of 92 catalog cells hit, pairwise 99.65%. A planted fault (scheduler gap of 5 h) was caught at once, so the checks are live.

## 4. What the model does NOT cover

- Real network, real browsers, real widths: width, network drop and device are drawn but only the pure logic runs; layout and reconnect need the live smoke.
- Real Cloudflare (Workers, Durable Objects, cron triggers, D1/KV): the deletion timer and the scheduler are modelled with the real constants (20 h, 4 h tick gap) and `autoDeleteDue`, not the deployed job.
- Real mail (delivery, bounce, the encrypted hold): the 3 h and 24/36/72 h schedule is checked, the mail itself is not sent.
- Real payment provider: the state machine and its funnel events are checked, not the provider.
- The deletion batch builder and the PDF builder live in the console and the Tambola repositories, not in the core: the model uses a stand-in store and a stand-in report input and checks the rules against them. Wiring the real ones in is the next step (they only need to expose a pure function).
- Tambola claims (a frozen product in its own repository) and per-move Tic Tac Toe / Snakes play (covered by `tools/sim`): only manifest rules and the elimination rounds are driven here.
- Reactions (shown to the right player only) and the 2 minute timers of each game are covered by their own sims and conformance, not here.
- Late joiners at game level beyond the admit rule, rehearsal mode, brand, family passes and manual prizes are catalog cells that the model passes through but does not yet check in depth.
