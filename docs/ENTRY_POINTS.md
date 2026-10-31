# Entry points for site porters (core 0.1.x)

Vendor with `bun tools/vendor.ts <game-repo> --expect 0.1.0`. The copy lands in `vendor/game-core/packages/<pkg>/src` (same layout as this repo; all imports between packages are plain relative paths, so it compiles with no path aliases). Import from e.g. `vendor/game-core/packages/core/src`.

| You need | Call | File |
|---|---|---|
| Auto prizes from a budget | `planPrizes(tickets, count, budget)`; `shareOut(amount, winners)`; Manual list check `validateManual(rows)`; hint `planHint(plan)` | `core/src/planner.ts` (copy of Tambola frozen-1.9.0 `prize-planner.js`) |
| Organizer flow steps | `FLOW` (Game, People, Time, Prizes, Brand and Breaks, Check and publish), `stepsFor(manifest)`, `timeOk(t, now)`, button words `SAVE_CONTINUE`, `SKIP_STEP`, `PUBLISH`, `MORE_OPTIONS` | `core/src/flow.ts` |
| Copy from an earlier game | `copyFrom(oldGame, newType)`; labels `copyLabel(name)`; never copies people/time/results | `core/src/copy.ts` |
| Retention | `ERASE_AFTER_MS` (20 h), `eraseDue(endedAt, now)`, `PRIZE_SHEET_REMINDER_MS`, `PDF_SEND_WITHIN_MS`, `PDF_RETRY_HOURS`, `WINNERS_KEEP_DAYS` | `core/src/retention.ts` |
| Start, pause, resume | `newClock()`, `shouldStart(mode, publishedAt, now, pressedBy)`, `start`, `pause(clock, role, now)`, `resume(...)`, `end`; use `gameNow(clock, now)` for EVERY deadline | `core/src/modes.ts` |
| Who may do what | `canControlClock(role)`, `canEditSetup`, `getsEndPdf`, `admit(...)`, `logChange(...)` | `core/src/roles.ts` |
| Size caps, rehearsal | `capFor(manifest, manualPlay)`, `rehearsalLimit(manifest)` | `core/src/modes.ts` |
| Late join | `canJoinLate(rule, ctx)`, `withLateWindow(rule, seconds)` | `core/src/modes.ts` |
| IDs | `normEmp`, `normEmail`, `normId(kind, raw)`, `empBadMessage` | `core/src/ids.ts` |
| Golden button label | `MANIFESTS[game].goldenButton` ("Claim" / "You won"); markup `goldenButton(label)` | `manifest/src`, `ui/src` |
| Wording | `say(code, vars)`, `sayFor("Card"|"Entry"|"Ticket", code, vars)`, `bingoSay`, `spokenCall(n)`, `NO_PERSONAL_DETAILS`, `RETENTION_LINE`, `guardOk(text)` | `wording/src` |
| Look | `ui/src/tokens.css`, `ui/src/components.css`, `setLook(document, "retro"|"modern")` | `ui/src` |
| The game's rules | `bingoRules`, `tttRules`, `snakesRules`, `luckRules` (`RulesModule`), plus pure helpers (`meets`, `completedAt`, `boardWinner`, `move`, `rankOrder`...) | `<game>/src` |
| Check a manifest | `bun tools/conformance.ts`; `checkManifest(m)` | `tools/`, `manifest/src` |

## People step: Add a Host / Add a Co-host (0.2.0)
`FLOW` "people" lists the rows `addHost` and `addCohost` (`PEOPLE_ROWS` has their words). `addHost(team, role, "email"|"emp", id, now)`: Organizer only, up to `MAX_HOSTS` (5). `addCohost(...)`: Organizer or Host, unlimited (list limit 10 to 1000, default 100: `cohostLimitOk`). `approveHostKey(team, role, hostId, now)`: Organizer approval registers the Host's own key later; `hostMayControl` is false until then. The change list holds the role only, never the name.

## Reaction pack (0.3.0)
`packages/ui/src/reactions.ts` + `reactions.css` (about 8 KB together, no dependency). Copy `reactions.css` into the page, then `react("snake_bite")`. `REACTIONS` is the manifest (id, text, event, games); `reactionsFor(game)` and `reactionsForEvent(event)` list them. The Organizer setting is `setReactionMode("full" | "reduced" | "off")`; `prefers-reduced-motion` shows the word still. Text only, top strip, pointer-events none, at most two at once. Demo: `bun tools/demo-reactions.ts` writes `docs/reactions-demo.html` (Play button for each). Hooks: Snakes: snake_bite, snake_bite_again, ladder, upgrade, downgrade, extra_throw, missed_turn, finish, six. Luck: dice_roll, six, extra_throw, jackpot, close_call. Tic Tac Toe: your_turn, tie, win, out, comeback. Bingo: bingo, claim, full_house. Tambola: housie, claim (hook only when its owner agrees; Tambola is not changed). Lucky Draw: draw, winners_drawn, jackpot. All games: win, pause, resume, countdown, time_up, round_start, round_end, ready, go.
