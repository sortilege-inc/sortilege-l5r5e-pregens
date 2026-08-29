#!/usr/bin/env bash
# Deploy the Creator's Anthropic shim and wire its URL into the site.
#
#   ./scripts/deploy_worker.sh
#
# The key is piped straight from .env into `wrangler secret put`, so it is never
# printed, never pasted, and never written anywhere but Cloudflare's secret
# store. Run this yourself — it publishes.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"

[ -f .env ] || { echo "no .env here"; exit 1; }
grep -q '^ANTHROPIC_API_KEY=' .env || { echo "no ANTHROPIC_API_KEY in .env"; exit 1; }

cd worker

# Piped straight out of .env: the value never lands in a variable, an argument,
# or the terminal. Wrangler reads the secret from stdin.
echo "==> setting the secret (piped from .env; never displayed)"
grep '^ANTHROPIC_API_KEY=' ../.env | cut -d= -f2- | tr -d '\r\n' \
  | npx wrangler secret put ANTHROPIC_API_KEY

echo
echo "==> deploying"
DEPLOY_OUT=$(npx wrangler deploy 2>&1 | tee /dev/stderr)

# wrangler prints the route it published to; take the first workers.dev URL
URL=$(printf '%s' "$DEPLOY_OUT" | grep -oE 'https://[a-z0-9.-]+\.workers\.dev' | head -1)
if [ -z "$URL" ]; then
  echo
  echo "Could not read the URL out of wrangler's output."
  echo "Set it by hand in src/foundry_sources.json under ai_proxy.url, then re-run"
  echo "  python3 scripts/build.py"
  exit 1
fi

cd "$ROOT"
python3 - "$URL" <<'PY'
import json, sys
url = sys.argv[1]
p = "src/foundry_sources.json"
d = json.load(open(p))
d.setdefault("ai_proxy", {})["url"] = url
json.dump(d, open(p, "w"), indent=1, ensure_ascii=False)
print(f"\nai_proxy.url = {url}")
PY

python3 scripts/build.py | grep -E "^AI proxy:"
echo
echo "Deployed. Commit and push to put it live:"
echo "  git add -A && git commit -m 'Point the Creator at the deployed AI shim' && git push"
