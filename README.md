# corporate-game-core

One common engine for the six Corporate Games (Tambola, Bingo, Tic Tac Toe, Snakes and Ladders, Luck by Chance, Lucky Draw). Extracted by copy from Corporate Tambola 1.9.0 (commit `ead5520`, frozen; Tambola itself is never refactored). Spec: `410_COMMON_GAME_ENGINE_SPEC.md` (owner-approved 31 Oct 2026).

## Spec summary
- **Common to all games:** roles (Organizer, Host, Co-host, participant, family pass); participation (open link or close group, one person one seat, ID and account-email rules from Tambola); six-step organizer flow (Game, People, Time, Prizes, Brand and Breaks optional, Check and publish); start modes; Pause/Resume by Organizer or Host with clocks frozen; Rehearsal ("Try it first", max 20 for Tambola/Bingo, 10 others); Auto or Manual prizes; Tambola look (retro + modern), 44 px taps, EN button, guided errors; plain English ("close group", never "private").
- **Per game (rules module):** setup fields, play loop, win/elimination logic, claim type, golden-button label, prize positions, late-join rule.
- **Golden button:** "Claim" in Tambola and Bingo; "You won" elsewhere (auto-claimed).
- **Limits:** 100,000 (Tambola, Bingo, Lucky Draw auto play); manual play 1,000; Tic Tac Toe, Snakes, Luck 2,000.
- **Retention:** all participant data deleted within 24 h of game end (code: 20 h). "Create new game" copies settings, start mode, prize plan, roles, look - never people, time or results.
- **Labels (internal only):** Claim, Elimination, Lucky Draw, Team.

## Packages
| package | contents |
|---|---|
| `packages/manifest` | manifest schema, the 6 game manifests |
| `packages/core` | roles, participation, ID rules, start modes, pause clock, organizer flow, copy-from-game, retention, plug-in interface, reference rules modules |
| `packages/ui` | Tambola CSS tokens (retro + modern), 44 px rules, EN button, guided error, golden button |
| `packages/wording` | plain-words messages, retention line, wording guard word lists |

## Pinning an exact version in a game
Games are separate Cloudflare repos. A game vendors this core:
```
bun tools/vendor.ts ../my-game --expect 0.1.0
```
This copies the sources to `my-game/vendor/game-core/` and writes `CORE_VERSION` (version + commit). The game commits that folder; upgrading is a deliberate re-run with a new `--expect`. `VERSION` is the single version source; a release is a git tag `core-X.Y.Z`.

Coders do not test here; independent test authors own the conformance suite.
