# Creator AI shim

The Creator is a static page on GitHub Pages, so it cannot hold an Anthropic
key — anything it ships is readable by anyone viewing source, and a published
key gets scraped and auto-revoked. This Worker holds the key instead.

    browser  ──POST {system, user}──>  Worker  ──x-api-key──>  Anthropic
                                        └── key lives here, as a secret

## Deploy

```bash
cd worker
npx wrangler secret put ANTHROPIC_API_KEY     # paste the key; never in a file
npx wrangler deploy
```

Then set the deployed URL in the Creator, either by editing `AI_PROXY` at the
top of `assets/creator.js` or by adding it to `src/foundry_sources.json` as
`"ai_proxy"`, which `scripts/build.py` writes into `data/ai-proxy.js`.

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
