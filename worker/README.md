# Creator Worker

Two things the static site cannot do for itself, on one Worker.

**The Anthropic shim.** The Creator is a page on GitHub Pages, so it cannot hold
an API key — anything it ships is readable by anyone viewing source, and a
published key gets scraped and auto-revoked. This Worker holds the key instead.

    browser  ──POST {system, user}──>  Worker  ──x-api-key──>  Anthropic
                                        └── key lives here, as a secret

**The shared draft store.** Drafts used to live in one browser's localStorage,
so a character in progress belonged to whoever started it, on the machine they
started it on. With a table key set, drafts live in D1 and everyone at the table
sees and edits the same ones.

    browser  ──GET/PUT/DELETE /drafts──>  Worker  ──>  D1 (drafts table)
                x-table-key                             id, rev, name, body

localStorage is still the working copy: editing never waits on the network, and
a dropped connection costs nothing. Syncing is a layer on top — push what
changed, poll every 20s for what other people changed.

## Deploy

```bash
./scripts/deploy_worker.sh
```

It creates the D1 database on first run and writes its id into `wrangler.toml`,
applies `schema.sql`, pipes `ANTHROPIC_API_KEY` and `L5R_TABLE_KEY` from `.env`
straight into `wrangler secret put` (so neither value is printed or pasted),
deploys, reads the URL out of wrangler's output, writes it to
`src/foundry_sources.json` as `ai_proxy.url`, and rebuilds. Commit and push
afterwards to put it live.

If there is no `L5R_TABLE_KEY` in `.env`, the script generates one (five words,
about 33 bits — guessing it against the per-IP limit would take a century),
appends it there, and prints it once: you cannot give players a key you have
never seen. Set it yourself in `.env` if you would rather choose it.

**The URL is predictable**: `name` in `wrangler.toml` plus your workers.dev
subdomain, which is `sortilege` — so
`https://sortilege-l5r-creator-ai.sortilege.workers.dev`, alongside the existing
`sortilege-onboarding.sortilege.workers.dev`.

## Routes

| Route | Needs | Does |
|---|---|---|
| `POST /` | allowed Origin | one AI suggestion |
| `GET /drafts` | Origin + `x-table-key` | every draft, revisions only (`?full=1` for bodies) |
| `GET /drafts/:id` | Origin + `x-table-key` | one draft in full |
| `PUT /drafts/:id` | Origin + `x-table-key` | save, if `rev` still matches |
| `DELETE /drafts/:id` | Origin + `x-table-key` | remove it for everyone |

## What it will and will not do

- **Origins.** Only those in `ALLOWED_ORIGIN` (wrangler.toml) get a response;
  anything else gets 403 with no CORS headers.
- **The table key gates every draft route**, read included. The site is public,
  so without it the drafts would be editable by anyone who could load the page.
  The key is compared in constant time and is never served to the browser — it
  is typed in and kept in that browser's localStorage.
- **Model and ceiling are fixed** in config, not taken from the caller, so this
  cannot be repurposed as a general LLM endpoint.
- **Rate limits** per IP per minute, counted separately per route
  (`RATE_PER_MIN`, `SYNC_PER_MIN`) — suggestions are human-paced, syncing is an
  autosave and is legitimately chattier.
- **The account spend cap is the backstop**, not the only control.

Prompt and context still come from the browser — that is the point, since they
are built from the character in progress. The Worker caps their length, and caps
a stored draft at 256 KB.

## Concurrent edits

`PUT` carries the revision it was based on and the write only lands if that is
still current:

```sql
UPDATE drafts SET rev = rev + 1, ... WHERE id = ? AND rev = ?
```

No rows changed means somebody else saved first, and the Worker answers `409`
with the row as it now stands. Nothing is overwritten and nothing is merged
behind anyone's back — the Creator shows both versions and asks which to keep.

## Local development

```bash
cd worker
printf 'TABLE_KEY=test-table-key\n' > .dev.vars      # gitignored
npx wrangler d1 execute sortilege-l5r-drafts --local --file schema.sql
npx wrangler dev --local --port 8788
```

Point the page at it by temporarily setting `data/ai-proxy.js` to
`window.L5R_AI_PROXY = "http://127.0.0.1:8788";` and serving the site on
`http://localhost:8412` (an allowed origin). Run `python3 scripts/build.py`
afterwards to put the real URL back.

For the AI side, `assets/creator.js` prefers, in order: a key you paste into AI
Settings, then `data/ai-key.local.js` (written from `.env` by
`scripts/build.py`, gitignored, requested only when served from localhost), then
this Worker. So local work uses your own key directly.
