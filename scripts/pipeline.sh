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
# the manifest's tags win over Foundry's, as in extract_characters.py
campaigns.update({k: v for k, v in (src.get('campaigns') or {}).items()
                  if not k.startswith('_')})
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

# The published pregens: FFG's own folios for the Beginner Game and the two
# Gen Con adventures, transcribed verbatim in the corpus and written out as
# records here. They are the second category of character — reference rather
# than the archive's work — so they count towards no coverage and the roster
# hides them unless asked. Runs after the corpus is composed and before the
# build that reads src/characters/.
python3 scripts/import_published.py

python3 scripts/build.py

# Chargen tables the Creator reads straight from the corpus, rather than through
# the catalog. heritage_tables.py in particular was outside the chain, so a
# corpus edit to a heritage table reached the site only if someone remembered to
# run it by hand -- which is how a corrected Spirit Companion entry sat stale.
# name_tables.py keys off the clan, family and school data the build just wrote.
python3 scripts/heritage_tables.py | tail -1
# Regions and upbringings: Path of Waves and Writ of the Wilds answer questions
# 1 and 2 with these instead of a clan and a family, and they grant rings,
# skills, glory, status and wealth the same way. Both files used to be
# hand-written and outside this chain, with every grant flattened to a display
# string the Creator could not add up.
python3 scripts/origin_tables.py
# The purse gate. Runs the Creator's own coin helpers over the families and
# upbringings just written and fails if any starting purse renders as a
# fraction of a coin -- the defect that had Peasant Family's 10 zeni showing
# as "Koku 0.2". Hard-fails rather than skipping if node is missing: a gate
# that quietly does not run is the one that lets this back in.
if ! command -v node >/dev/null; then
  echo "FAIL — node is not on PATH, so the purse gate cannot run" >&2
  exit 1
fi
node scripts/coin_selftest.js
# And the other half of the same question: does every character actually carry
# the coin question 2 gives them? Thirteen records did not, and the first audit
# of it missed two -- it matched families by exact name, so the vassal houses
# resolved to nothing and were skipped in silence. This one fails on a record
# it cannot resolve as loudly as on one that disagrees.
python3 scripts/coin_audit.py
# And that the published pregens really are the second category: counted in no
# coverage number, marked on every roster row so the tab can hide them, the
# whole printed set present, and still built with a page and a play sheet each.
python3 scripts/published_gate.py
# Every pencilled school as a stub the Creator can open as a draft, with its
# school, campaign and question set already set. Needs the catalog and the
# campaign list the build above wrote.
python3 scripts/pack_stubs.py
# School and title curricula, for the advancement ledger. Reads the resolved
# corpus that dsl_rules_text.py composed above, so errata are already applied.
python3 scripts/curricula.py
# Legacy templates: Legacies of War's alternative to the heritage table, and
# what a predecessor has to be to qualify for each.
python3 scripts/legacy_tables.py
# Create Court: the seven-step framework's step list, the NPC templates step 7
# overlays, and the need tiers a ninjo is written from.
python3 scripts/court_tables.py
# Create Army: Fields of Victory's marshaling system -- the status bands, the
# discipline formulae, mercenaries, allies, doctrines, upgrades, maintenance.
python3 scripts/army_tables.py
# Create School: Path of Waves' nine-step school-building system -- the roles,
# the ability and mastery templates, skill and technique counts per role, the
# curriculum's shape, and the suggested outfits.
python3 scripts/school_tables.py
python3 scripts/name_tables.py | tail -1
python3 scripts/relationship_map.py
# The Lore section: the corpus's own .codex files -- spec §25's stand-off graph
# of typed entities and relationships over the .lore prose, with the FROM quote
# that justifies each tie.
python3 scripts/codex_graph.py

# The source audit reads the catalog and the resolved corpus text the two steps
# above produce, and writes data/audit.js for the Audit section. It only reads
# the corpus — it never edits it.
echo
python3 scripts/audit_corpus.py

echo
python3 scripts/coverage.py
