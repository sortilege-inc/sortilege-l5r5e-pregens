# Sortilege L5R Pregens

A showcase archive of pre-generated **Legend of the Five Rings 5th Edition** characters —
one for every school in the game, each shown at every XP tier it passes through — plus a
coverage ledger tracking how much of the game the archive has actually put into play.

Served as a buildless static site (GitHub Pages, works from `file://` too).

## Layout

```
index.html                 landing page: headline coverage + roster
characters/index.html      searchable roster (clan / role / campaign)
characters/<slug>.html     generated stub — three tabs, all rendered by assets/sheet.js:
                           Dossier · Twenty Questions · Play
play/<slug>-<xp>xp.html    GENERATED — a playable sheet per character per XP tier
admin/index.html           the coverage ledger
assets/
  l5r.css                  the whole visual language (shares Portents & Fortunes' palette)
  sheet.js                 character sheet + XP timeline + between-tier changelog
  roster.js                the card-grid renderer (not to be confused with data/roster.js)
  admin.js                 coverage ledger: tabs, filters, used/unused table
  play/                    the Portents & Fortunes character sheet, reused as-is
                           (sheet.js / sheet.css / l5rdata.js); scripts/build.py's
                           sheet_from_tier() is the only translation layer
  dice/ rings/ mon/        art the play sheet needs
data/roster.js             GENERATED — window.L5R_ROSTER: card fields only (small)
data/characters/<slug>.js  GENERATED — window.L5R_CHARACTER: one character, all tiers
data/catalog.js            GENERATED — window.L5R_CATALOG: the coverage denominator
data/coverage.js           GENERATED — window.L5R_COVERAGE: what is used, by whom
data/twenty_questions.js   GENERATED — window.L5R_20Q: the official question wording
                           and page references, from the l5r5e system's own en.json
src/characters/<slug>.json SOURCE OF TRUTH — hand-editable character definitions
src/portraits/             character art referenced by src/characters/*.json
pipeline/foundry/          raw Foundry pulls (actors + compendium catalog)
pipeline/l5r.sqlite        GENERATED — build-time store where the coverage joins happen
scripts/                   the pipeline (below)
```

`data/`, `characters/<slug>.html` and `pipeline/l5r.sqlite` are all generated. Edit
`src/characters/*.json` and re-run the build.

## The pipeline

```bash
./scripts/pipeline.sh                  # the whole chain, in dependency order
./scripts/pipeline.sh --pull           # ...also re-fetching from Foundry
./scripts/pipeline.sh --force          # ...also re-extracting sources from raw actors
```

The individual steps, if you need one on its own:

```bash
python3 scripts/foundry_pull.py        # what src/foundry_sources.json declares -> pipeline/foundry/actors
python3 scripts/foundry_catalog.py --full   # compendium + lang -> pipeline/foundry (the denominator)
python3 scripts/extract_characters.py  # actors -> src/characters/*.json  (won't overwrite; --force)
python3 scripts/derive_tiers.py <slug> # rebuild earlier XP tiers for a one-actor character
python3 scripts/build.py               # src + catalog -> sqlite -> data/*.js + pages + play sheets
python3 scripts/coverage.py            # coverage report + integrity gate
python3 scripts/foundry_push.py        # src/characters -> Foundry   (DRY RUN unless --apply)
```

Order matters in two places: `derive_tiers.py` needs the curriculum table `build.py`
writes, and re-extracting with `--force` discards derived tiers, so they have to be
rebuilt afterwards. `pipeline.sh` handles both.

The Foundry scripts need the world open and `.env` present; everything else is offline.

### What gets pulled

`src/foundry_sources.json` declares it: folder `roots` pulled whole, individual `actors`
elsewhere in the world (several may share one `character`, becoming its XP tiers),
`campaigns` tagged by slug, `portraits` by slug, `corrections` for fields the Foundry
record has wrong, and `derive_tiers` for characters Foundry holds at a single point.

Portraits: `foundry_pull.py` saves each actor's own art to `pipeline/foundry/portraits/`
(gitignored — 18 MB of originals, re-fetchable). The web-sized image in `src/portraits/`
is what the site serves, named by the `portraits` map in the manifest.

## Nothing gets dropped silently

`scripts/extract_characters.py` refuses to run on an actor carrying an item type it does
not handle, and walks nested items recursively; `scripts/coverage.py` re-walks the raw
actors and fails on any type that isn't extracted, reporting the nested count so a
regression is visible:

```
actor items: 1054 across 9 types (134 nested inside a parent item)
             every type is extracted
```

Both gates exist because both failures happened, and neither was caught by the gates that
existed at the time — they only ever checked already-extracted content. See
[CLAUDE.md](CLAUDE.md) before writing anything that reads a Foundry actor.

### `.env`

```
FOUNDRY_API=<foundryrestapi.com key>
FOUNDRY_CLIENT=<optional; defaults to the online l5r5e world>
FOUNDRY_HOST=<optional; defaults to https://foundry.sortilege.online>
```

`.env` is gitignored and must stay that way.

## Rules text is never authored here

Every non-custom content reference in a character source is just a **name**. The build
resolves it against the compendium and pulls that entry's own description verbatim; a
name that resolves to nothing is a build failure, not a silent drop. Anything genuinely
bespoke — a campaign-specific distinction, a custom item — is marked `"custom": true` in
the character file and carries its own text there, and is reported separately in the
ledger rather than counting towards coverage.

## Adding a character

1. Write `src/characters/<slug>.json`. Copy the shape from an existing one: identity
   once, then a `tiers` array — one entry per XP tier, each listing `techniques`,
   `peculiarities`, `titles`, `bonds`, `gear` and `advancements` **by name**.
2. Drop the portrait in `src/portraits/` and point `"portrait"` at it
   (path relative to the repo root, e.g. `src/portraits/<slug>.png`).
3. `python3 scripts/build.py` — fails loudly on any unresolvable reference or any
   school not on the compendium's roll.
4. `python3 scripts/coverage.py` — integrity gate; also shows what the new character
   added to coverage.
5. `python3 scripts/foundry_push.py --only <slug>` to preview, then `--apply` to send it
   to Foundry. New tiers get their `foundry_id` written back so the next push updates
   rather than duplicates.

## The coverage ledger

The denominator is the `l5r5e-compendia-sortilege` module's own compendium packs, so it
is the game as this table actually has it, not an estimate. The gate in `coverage.py`
fails on integrity problems only — an empty denominator, an off-roll school, an
unresolvable reference, a character with no page. It deliberately does **not** fail on
incompleteness: the archive is meant to be incomplete for a long while, and the honest
number is the point.

## Local preview

```bash
python3 -m http.server 8412
```

## Reconstructed tiers

Most characters exist in Foundry as several actors, one per XP tier. A few exist only as
a current actor; `scripts/derive_tiers.py` rebuilds their earlier tiers from what the
actor itself records — advancements name their own before/after and the rank they were
bought at, purchased content carries its XP cost, and the school curriculum says at which
rank a technique becomes available. Those tiers are marked `"reconstructed": true` in the
source file, and the last tier is always the Foundry record, untouched.

The arithmetic closes, and the script prints it — Doji Setsuna reconstructs to
`98 XP spent of 100 earned — 2 banked`, with each bucket matching its tab in the Foundry
character sheet. Getting there needed two things that are easy to get wrong and are
written up in [CLAUDE.md](CLAUDE.md): a title's curriculum purchases are nested inside the
title item rather than sitting in `actor.items`, and a title's own `xp_used` is a rollup
of those nested items rather than a price paid on top of them.
