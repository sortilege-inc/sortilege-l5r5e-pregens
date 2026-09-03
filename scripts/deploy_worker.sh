#!/usr/bin/env bash
# Deploy the Creator's Worker — the Anthropic shim and the shared draft store —
# and wire its URL into the site.
#
#   ./scripts/deploy_worker.sh
#
# Secrets are piped straight from .env into `wrangler secret put`, so they are
# never printed, never pasted, and never written anywhere but Cloudflare's
# secret store. Run this yourself — it publishes.
#
# The one exception is the table key on the run that creates it: you cannot hand
# a key to your players without seeing it once, so a generated key is printed
# and appended to .env. Set L5R_TABLE_KEY there yourself if you would rather
# choose it.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"

[ -f .env ] || { echo "no .env here"; exit 1; }
grep -q '^ANTHROPIC_API_KEY=' .env || { echo "no ANTHROPIC_API_KEY in .env"; exit 1; }

# ---------------------------------------------------------------- table key
if ! grep -q '^L5R_TABLE_KEY=' .env; then
  # Words, not hex: this gets read down a table or typed off a phone screen.
  # Five distinct words out of a hundred is about 33 bits, which against the
  # Worker's per-IP limit is not worth anyone's time to guess. Four words from a
  # twenty-five word list would have read just as well and been weak enough to
  # brute-force in a weekend.
  GEN=$(python3 - <<'GENPY'
import secrets
words = """
crane crab lion phoenix scorpion dragon unicorn mantis heron sparrow tortoise
badger fox hare monkey ox spider swallow falcon carp mongoose centipede
iron jade amber ivory silver copper lacquer silk paper bronze pearl obsidian
winter autumn summer spring dawn dusk midnight noon frost thaw monsoon
river stone thunder lantern willow bamboo cedar plum maple pine reed lotus
mountain valley harbour bridge gate garden tower well road ford shrine
quiet steady hidden distant patient careful stubborn restless watchful
sudden narrow open honest crooked bright faded sharp
brush blade fan scroll cup mask drum bell kite chain anvil kettle needle
mirror ribbon saddle
""".split()
print("-".join(secrets.SystemRandom().sample(words, 5)))
GENPY
)
  printf 'L5R_TABLE_KEY=%s\n' "$GEN" >> .env
  echo "==> no L5R_TABLE_KEY in .env, so one was generated and added there."
  echo
  echo "    The table key is:  $GEN"
  echo
  echo "    Give it to anyone who should be able to edit drafts. It is the only"
  echo "    thing standing between a public web page and your working drafts, so"
  echo "    do not put it on the site itself."
  echo
fi

cd worker

# ------------------------------------------------------------------ D1
# The draft store. Created once; the id is written into wrangler.toml so the
# next run finds it rather than making a second database.
if grep -q '^database_id = "PLACEHOLDER' wrangler.toml; then
  echo "==> creating the D1 database"
  CREATE_OUT=$(npx wrangler d1 create sortilege-l5r-drafts 2>&1 | tee /dev/stderr)
  DBID=$(printf '%s' "$CREATE_OUT" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
  if [ -z "$DBID" ]; then
    echo "Could not read the database id out of wrangler's output."
    echo "Put it in worker/wrangler.toml under [[d1_databases]] and re-run."
    exit 1
  fi
  python3 - "$DBID" <<'PY'
import re, sys
p = "wrangler.toml"
s = open(p).read()
s = re.sub(r'^database_id = "PLACEHOLDER[^"]*"$',
           'database_id = "%s"' % sys.argv[1], s, flags=re.M)
open(p, "w").write(s)
print(f"wrangler.toml: database_id = {sys.argv[1]}")
PY
fi

echo "==> applying the schema (safe to repeat; every statement is IF NOT EXISTS)"
npx wrangler d1 execute sortilege-l5r-drafts --remote --file schema.sql --yes

# --------------------------------------------------------------- secrets
# Piped straight out of .env: the values never land in a variable, an argument,
# or the terminal. Wrangler reads each secret from stdin.
echo "==> setting the secrets (piped from .env; never displayed)"
grep '^ANTHROPIC_API_KEY=' ../.env | cut -d= -f2- | tr -d '\r\n' \
  | npx wrangler secret put ANTHROPIC_API_KEY
grep '^L5R_TABLE_KEY=' ../.env | cut -d= -f2- | tr -d '\r\n' \
  | npx wrangler secret put TABLE_KEY

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
