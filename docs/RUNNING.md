# Running Corporate Bingo on this laptop

Bun is not on PATH on the build machine: use the full path of `bun.exe` (or `bun` if installed). Everything is local.

```
bun install
bun run zlocal                 # website + API on http://localhost:8788 (SQLite in memory unless DB_FILE is set)
bun run build:zgame            # rebuild apps/web/public/zgame.js after changing packages/beacon or packages/shared
bun run build:control ; bun run build:report
bun test packages apps tools/control-worker
node tools/sim2/smoke.mjs                          # stack + real Chrome smoke
node tools/sim2/scenarios/life/run.mjs --seed 7    # life-cycle scenarios
bun tools/sim2/scenarios/matrix/run.ts --seed 7    # configuration matrix
node tools/sim2/scenarios/ui/run.mjs               # UI scenarios (run `bun run pages/build.mjs` first; real Chrome)
```

Test mode: set `TEST_MODE=1` for test payments and echoed sign-in codes. Never set payment keys locally.
RAM rule on the shared laptop: one heavy job at a time (take `C:/ct/heavy.lock`).
