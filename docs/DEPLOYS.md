# Deploys

What is live, and how to know.

* Open `/version.json` on the site. It holds `commit` (the git commit the pages were built from), `dirty` (true if files differed from that commit), `builtAt` (UTC) and `game`. It holds nothing else.
* A deploy is made with `bun run pages:deploy`: it builds `pages/public` (which writes `version.json`), then uploads it to the Cloudflare Pages project `corporate-bingo`. The Worker's database changes are the numbered files in `apps/edge/migrations`.
* TEST or LIVE mode (whether real payments are taken) is separate from a deploy: `GET /api/mode`.

## Last deploys of `corporate-bingo`

Read from Cloudflare Pages on 2026-10-14 00:05 UTC. Refresh this table with `node tools/list-deploys.mjs` (needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in the environment).

| Time (UTC) | Environment | Branch | Commit | Result | Deployment |
|---|---|---|---|---|---|
| 2026-10-13 19:41 | production | main | 42e633b | ok | https://49f5ad87.corporate-bingo.pages.dev |
| 2026-10-13 11:11 | production | main | cb379f1 | ok | https://28b4b726.corporate-bingo.pages.dev |
| 2026-10-13 11:09 | production | main | 17743af | ok | https://cf70a8d6.corporate-bingo.pages.dev |
| 2026-10-13 10:26 | production | main | fa21701 | ok | https://7c5174d7.corporate-bingo.pages.dev |
| 2026-10-12 12:18 | production | main | 741602b | failure | https://fa7a4828.corporate-bingo.pages.dev |
| 2026-10-12 12:16 | production | main | 741602b | ok | https://ea769e57.corporate-bingo.pages.dev |
