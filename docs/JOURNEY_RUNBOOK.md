# Journey runbook (partner laptop, phone, cloud)

Read `docs/JOURNEY_MODEL.md` first. Tool version: core 0.9.10 or later. All three machines use the SAME `--seed` (below: 1) and DISJOINT index ranges, so nothing overlaps and nothing is missed.

## 1. Sizes

| Scope | Combinations |
|---|---|
| Whole funnel journey (home, console, game create, publish, pay, play, PDF, deletion) | 7,223,692,492,800 |
| Each game (Tambola, Bingo, Tic Tac Toe, Snakes, Luck, Lucky Draw): the whole space divided by 6 | 1,203,948,748,800 |

The whole journey, stage by stage (each line adds its dimensions to the line above):

| Stage | Dimensions added | Cumulative count |
|---|---|---|
| Entry | route (7) | 7 |
| Choose game, who plays, how many | game, identification, details, roster | 4,536 |
| Team and options | hosts, co-hosts, six flags | 6,967,296 |
| Pay, publish, schedule | payment, publish state, schedule | 501,645,312 |
| Play | start mode, late join, pause, device width, network | 90,296,156,160 |
| Report and deletion | report mail, early delete, GPC, funnel properties | 7,223,692,492,800 |

The index-to-journey map spreads every range over all six games, so a range of any size covers each game about equally. There is no per-game flag.

## 2. The plan (no execution)

    bun tools/journey/run.ts --dry-run --weights 3:1:3 --names partner,phone,cloud

| Machine | Weight | Zone (`--from` to `--to`) | Journeys in the zone |
|---|---|---|---|
| partner | 3 | 0 to 3,095,868,211,200 | 3,095,868,211,200 |
| phone | 1 | 3,095,868,211,200 to 4,127,824,281,600 | 1,031,956,070,400 |
| cloud | 3 | 4,127,824,281,600 to 7,223,692,492,800 | 3,095,868,211,200 |

No machine can finish its zone (first measured speed: 500 to 1200 journeys per second per core on the laptop here). The zones only keep the machines apart. Each machine takes shards from the START of its zone, one after another.

## 3. Shard sizes

Shard number n on a machine runs `--from = zone start + n * size` to `--to = from + size`. Name the output file by machine and n, and never reuse an index range.

| Machine | Size | About how long | Why |
|---|---|---|---|
| Partner laptop (8 GB, one job at a time) | 10,000,000 | 3 to 5 h | the process uses well under 400 MB; `--heap-mb 600` stops it cleanly if memory grows |
| Phone (proot, about 100 ms per game) | 100,000 | 3 to 5 h at about 5 to 10 journeys per second | small, so a kill costs little |
| Cloud runner | 50,000,000 | 12 to 16 h on one core; use `--budget-seconds` | one job per core, same zone, different shard numbers |

Measure first: run a 20-second job on each machine (`--budget-seconds 20`), read "journeys/s", and set the size to about 4 hours times that speed.

## 4. Commands

Set up (every machine): clone `FChecklist/corporate-game-core` on `main`. No `bun install` is needed (no dependencies).

### Partner laptop (Windows, PowerShell)

    cd C:\dev\game-core
    git pull
    $bun = "C:\dev\tools\bun\bun.exe"
    & $bun tools/journey/run.ts --seed 1 --from 0 --to 10000000 --out out\partner-0.json --budget-seconds 18000 --heap-mb 600
    # next shard
    & $bun tools/journey/run.ts --seed 1 --from 10000000 --to 20000000 --out out\partner-1.json --budget-seconds 18000 --heap-mb 600

### Phone (proot Ubuntu)

    cd ~/game-core && git pull
    bun tools/journey/run.ts --seed 1 --from 3095868211200 --to 3095868311200 --out out/phone-0.json --budget-seconds 14400
    # next shard: --from 3095868311200 --to 3095868411200 --out out/phone-1.json

### Cloud runner (one process per core; core c of the machine takes shard numbers c, c+cores, ...)

    git pull
    bun tools/journey/run.ts --seed 1 --from 4127824281600 --to 4127874281600 --out out/cloud-0.json --budget-seconds 50000
    # shard 1: --from 4127874281600 --to 4127924281600 --out out/cloud-1.json

## 5. Stop, resume, collect

- A stop by `--budget-seconds` or `--heap-mb` is clean: the summary says how far it got (`doneTo`) and a checkpoint is kept. A kill (battery, memory) leaves the last checkpoint, written every 30 seconds.
- Continue the SAME command with `--resume` added. It refuses a checkpoint of a different seed, mode or range. To finish the rest of a stopped range without `--resume`, start a new run `--from <doneTo>` to the old `--to`.
- Check progress without running: look at `out/<name>.json.ckpt` (fields `doneTo`, `journeys`, `violations`).
- Collect: copy all `out/*.json` (not `.ckpt`, not `.tmp`) into one folder and run `bun tools/journey/aggregate.ts all/*.json`. It prints total journeys, violations by invariant with replay indexes, catalog cells hit, pairwise coverage % and warns on overlapping ranges or mixed seeds. Stopped shards count only up to their `doneTo`.
- Replay a violation anywhere: `bun tools/journey/run.ts --seed 1 --replay <index>`.
- Exit code 1 means at least one violation.

## 6. What a pass means (every stage mapped)

REAL = the actual function from this repo is called. MODELLED = the model has its own stand-in logic, so a pass says nothing about the real thing.

| Stage | Code path | Status |
|---|---|---|
| Entry (home, games bar, console, direct link, invite, personal link, QR) | a path list in `model.ts`; the console rule is asserted on that list | MODELLED (no real routing or console code) |
| Funnel events (13 events) | `makeReporter`, `cleanProps`, GPC and first-party rules from `packages/core/src/funnel.ts` | REAL |
| Game manifest, caps, new-flow cap | `MANIFESTS`, `capFor` | REAL |
| Identification (employee ID, e-mail, open) | `normId` | REAL |
| Join, waiting, full | `admit`, `WAIT_LAPSE_MS` (the 120 s waiting room is a constant in the model) | REAL for `admit`; MODELLED for the 2 minute constant |
| Team (hosts, co-hosts, change list) | `addHost`, `addCohost`, `newTeam`, `MAX_HOSTS`, `getsEndPdf` | REAL |
| Schedule (past, 30-day limit, future) | `timeOk` | REAL; "rescheduled" and "cancelled before publish" only change what the model asks for |
| Payment (free, paid, failed then paid, abandoned, link copied, link opened) | boolean state machine in `model.ts` | MODELLED (no payment code in the core) |
| Publish gate (unpaid cannot publish) | rule in `model.ts` | MODELLED |
| Start, pause, resume, clock freeze | `shouldStart`, `start`, `pause`, `resume`, `gameNow` | REAL |
| Winners: Lucky Draw | `drawInit`, `register`, `drawReady`, `draw` | REAL |
| Winners: Tic Tac Toe, Snakes, Luck | `elimInit`, `submit`, `closeRound` with random results; not the game move rules (those are in `tools/sim`) | REAL for the rounds; move play NOT covered |
| Winners: Bingo | `settleFromLog` | REAL |
| Winners: Tambola | none (frozen product in another repository) | NOT COVERED |
| Report PDF input | stand-in object; recipients use `getsEndPdf` | MODELLED (the real PDF builder is not in this repo) |
| Report mail: 3 h, retries at 24/36/72 h | constants `PDF_SEND_WITHIN_MS`, `PDF_RETRY_HOURS`; no mail is sent | constants REAL, delivery MODELLED |
| Deletion: never published, early delete by Organizer | stand-in store wiped by the model | MODELLED (the real deletion batch builder is not in this repo) |
| Deletion: 24 h with a late scheduler | `autoDeleteDue`, `AUTO_DELETE_AFTER_MS`, a 4 h tick gap in the model | REAL constants and function; the scheduler is MODELLED |
| Other players see nothing of yours | a view object built in the model | MODELLED |
| Wording: banned words, data-text rule, legal text | `say`, `MSG`, `LEGAL`, `guardOk`, `dataTextOk` | REAL |
| Device width, network drop, flags (family, reactions, manual prizes, brand, rehearsal), publish-then-edited | drawn into the journey, not checked | PASS-THROUGH (no check) |

So a pass means: the real rule functions and constants hold under every combination reached. It does not mean the deployed console, payment, mail, Cloudflare jobs or the real deletion and PDF code work. That needs the live smoke, or wiring the real deletion batch builder and PDF builder in (each only needs to expose a pure function).
