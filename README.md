# Corporate Bingo

75-ball Bingo for company events and teams. A separate product, built as a one-time copy of another game's source and then renamed and rebuilt. Nothing here imports from, links to or shares anything with that other product.

**The site is live** on Cloudflare Pages (project `corporate-bingo`, database `corporate-bingo`). What is live right now is in `/version.json` on the site (the commit and the build time); the last deploys are listed in `docs/DEPLOYS.md`. Whether payments are real follows the site's TEST / LIVE mode (`/api/mode`).

- Game rules and code map: `docs/BINGO_GAME.md`
- Running it on this laptop: `docs/RUNNING.md`
- The specification this was built from (history note, mentions the origin product): `docs/history/BINGO_SPEC_origin.md`
- Cloudflare config for a NEW project `corporate-bingo` and D1 database `corporate-bingo`: `pages/wrangler.toml`, `apps/edge/wrangler.toml` (the database id is in `pages/wrangler.toml`; `apps/edge/wrangler.toml` keeps a placeholder)

Layout: `packages/shared` (card, patterns, pricing), `packages/beacon` (calls, engine, phone runtime), `packages/billing`, `apps/edge` (Worker API), `apps/web/public` (all pages), `apps/cron`, `pages/` (Pages build and functions), `tools/sim2` (simulation harness).
