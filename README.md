# Sortilege L5R Pregens

A showcase archive of pre-generated **Legend of the Five Rings 5th Edition** characters —
one for every school in the game, each shown at every XP tier it passes through — plus a
coverage ledger tracking how much of the game the archive has actually put into play.

Served as a buildless static site (GitHub Pages, works from `file://` too).

## Layout

```
index.html                 landing page: headline coverage + roster
characters/index.html      searchable roster
characters/<slug>.html     generated stub; all rendering is in assets/sheet.js
admin/index.html           the coverage ledger
assets/
  l5r.css                  the whole visual language (shares Portents & Fortunes' palette)
  sheet.js                 character sheet + XP timeline + between-tier changelog
  roster.js                the card-grid renderer (not to be confused with data/roster.js)
  admin.js                 coverage ledger: tabs, filters, used/unused table
data/roster.js             GENERATED — window.L5R_ROSTER: card fields only (small)
data/characters/<slug>.js  GENERATED — window.L5R_CHARACTER: one character, all tiers
data/catalog.js            GENERATED — window.L5R_CATALOG: the coverage denominator
data/coverage.js           GENERATED — window.L5R_COVERAGE: what is used, by whom
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
python3 scripts/foundry_pull.py        # Foundry "General" folder -> pipeline/foundry/actors
python3 scripts/foundry_catalog.py --full   # compendium -> pipeline/foundry/catalog (the denominator)
python3 scripts/extract_characters.py  # actors -> src/characters/*.json  (won't overwrite; --force)
python3 scripts/build.py               # src + catalog -> sqlite -> data/*.js + character pages
python3 scripts/coverage.py            # coverage report + integrity gate
python3 scripts/foundry_push.py        # src/characters -> Foundry   (DRY RUN unless --apply)
```

Only `build.py` and `coverage.py` are needed for day-to-day work; the Foundry scripts
need the world open and `.env` present.

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
