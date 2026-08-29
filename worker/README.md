# Creator AI shim

The Creator is a static page on GitHub Pages, so it cannot hold an Anthropic
key — anything it ships is readable by anyone viewing source, and a published
key gets scraped and auto-revoked. This Worker holds the key instead.

    browser  ──POST {system, user}──>  Worker  ──x-api-key──>  Anthropic
                                        └── key lives here, as a secret

## Deploy

```bash
./scripts/deploy_worker.sh
```

That pipes `ANTHROPIC_API_KEY` straight from `.env` into `wrangler secret put`
(so the value is never printed or pasted), deploys, reads the URL out of
wrangler's output, writes it to `src/foundry_sources.json` as `ai_proxy.url`,
and rebuilds. Commit and push afterwards to put it live.

By hand, if you would rather:

```bash
cd worker
npx wrangler secret put ANTHROPIC_API_KEY     # reads stdin; paste, then Ctrl-D
npx wrangler deploy                            # prints the URL
```

then set that URL in `src/foundry_sources.json` under `ai_proxy.url` and run
`python3 scripts/build.py`.

**The URL is predictable**: `name` in `wrangler.toml` plus your workers.dev
subdomain, which is `sortilege` — so
`https://sortilege-l5r-creator-ai.sortilege.workers.dev`, alongside the existing
`sortilege-onboarding.sortilege.workers.dev`.

## What it will and will not do

- **Origins.** Only those in `ALLOWED_ORIGIN` (wrangler.toml) get a response;
  anything else gets 403 with no CORS headers.
- **Model and ceiling are fixed** in config, not taken from the caller, so this
  cannot be repurposed as a general LLM endpoint.
- **Rate limit** per IP per minute (`RATE_PER_MIN`), enough to blunt a script.
  Suggestions are human-paced by nature.
- **The account spend cap is the backstop**, not the only control.

Prompt and context still come from the browser — that is the point, since they
are built from the character in progress. The Worker caps their length.

## Local development

`assets/creator.js` prefers, in order: a key you paste into AI Settings, then
`data/ai-key.local.js` (written from `.env` by `scripts/build.py`, gitignored,
requested only when served from localhost), then this Worker. So local work uses
your own key directly and never touches the Worker.
