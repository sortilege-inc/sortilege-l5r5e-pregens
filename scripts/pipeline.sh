#!/usr/bin/env bash
# The full chain, in the order the steps depend on each other.
#   --pull   also re-fetch from Foundry (needs the world open and .env present)
#   --force  re-extract character sources from the raw actors, discarding local edits
#   --refresh-dsl  recompose the DSL corpus (rebuilds the synthesist) before
#                  regenerating rules text
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ " $* " == *" --pull "* ]]; then
  python3 scripts/foundry_pull.py
  python3 scripts/foundry_catalog.py --full
fi

FORCE=""
[[ " $* " == *" --force "* ]] && FORCE="--force"
python3 scripts/extract_characters.py $FORCE

# manifest-declared campaign tags and portraits, applied whether or not the
# sources were just re-extracted
python3 - <<'PY'
import json, glob
idx = json.load(open('pipeline/foundry/index.json'))
src = json.load(open('src/foundry_sources.json'))
campaigns = {k: v for k, v in idx.get('campaigns', {}).items() if not k.startswith('_')}
portraits = {k: v for k, v in src.get('portraits', {}).items() if not k.startswith('_')}
for p in sorted(glob.glob('src/characters/*.json')):
    d = json.load(open(p))
    dirty = False
    want = campaigns.get(d['slug'], d.get('campaign'))
    if d.get('campaign') != want:
        d['campaign'] = want; dirty = True
        print(f"   campaign {d['slug']} -> {want}")
    art = portraits.get(d['slug'])
    if art and d.get('portrait') != art:
        d['portrait'] = art; dirty = True
        print(f"   portrait {d['slug']} -> {art}")
    if dirty:
        json.dump(d, open(p, 'w'), indent=1, ensure_ascii=False)
PY

# promotions are recorded in the manifest, so they survive a --force re-extract
python3 scripts/promote.py --apply

# build once so derive_tiers has the curriculum table, then reconstruct tiers
# for characters Foundry only holds at a single point, then build for real
python3 scripts/build.py > /dev/null
for slug in $(python3 -c "
import json
print(' '.join(json.load(open('src/foundry_sources.json')).get('derive_tiers', [])))
"); do
  python3 scripts/derive_tiers.py "$slug" --write | tail -3
done

# Rules text comes from the DSL corpus, not from Foundry: the compendium is the
# catalog, the corpus is the rules. This needs the catalog and tier_content that
# the build above just wrote, and the build below consumes what it writes — so it
# sits between the two. --refresh-dsl recomposes the corpus via the synthesist.
REFRESH=""
[[ " $* " == *" --refresh-dsl "* ]] && REFRESH="--refresh"
python3 scripts/dsl_rules_text.py $REFRESH

python3 scripts/build.py
echo
python3 scripts/coverage.py
