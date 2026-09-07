# Working in this repo

Read this before touching anything that reads a Foundry actor. Two content-loss bugs
have already shipped from this file's subject matter, both caught by Jordan rather than
by a gate, and both of the same shape: **the extractor handled what it knew about and
silently ignored the rest.**

## Reading a Foundry actor correctly

### 1. Items nest. `actor.items` is not the whole actor.

An item can carry its own children in `item.system.items`. This is how the l5r5e system
stores a **title's curriculum purchases** — the techniques and advancements you bought
toward the title live *inside the title item*, not in the actor's top-level array.

```
actor.items[]                      <- top level: 920 items across this corpus
  └─ title "Emerald Magistrate"
       system.items[]              <- +134 more, invisible unless you recurse
          ├─ technique "Crescent Moon Style"
          ├─ advancement "Martial Arts [Unarmed] +1 (2 -> 3)"
          └─ ...
```

`system.items` is sometimes a **list** and sometimes an **empty dict** (`{}`) — handle both.
Nesting is one level deep in this corpus, but walk recursively anyway.

Use `walk_items()` in `scripts/extract_characters.py`. Never iterate `actor["items"]`
directly. Sixteen of the thirty-one pulled actors carry nested content; reading only the
top level silently dropped 56 techniques and 78 advancements.

### 2. Every item type must be handled, and the gate must check the source.

`signature_scroll` is a real actor item type — it is where the system files a **title's
granted ability** ("Voice of Authority"). An earlier extractor collected eight types and
ignored the ninth, and *every gate passed*, because each gate only inspected content that
had already been extracted.

So: `extract_characters.py` raises on an item type not in `HANDLED_ITEM_TYPES`, and
`coverage.py` walks the raw actors and fails on any type that isn't extracted. **A
completeness check that reads your own output is not a completeness check.** Measure
against the source's enumerable set — here, the items on the actors.

### 3. XP: a title's `xp_used` is a rollup, not a price.

This is what made the arithmetic look broken.

- A title item's `xp_used` / `xp_cost` are **progress through its curriculum** — the sum
  of the items nested inside it, against the total that curriculum requires.
  `Emerald Magistrate: xp_used 30 / xp_cost 30` means "30 XP of nested purchases, and 30
  completes it". It is *not* 30 XP paid on top of those purchases.
- Adding both double-counts the title. Count the nested items, or count the rollup —
  never both.
- `xp_cost` on an *unfinished* title is the requirement, not a debt: Personal Advisor
  shows `5 / 36` while its single nested advancement cost 9 XP, because ring increases
  only partly count toward a curriculum.

Doji Setsuna, worked through as the reference case:

| bucket | XP |
|---|---|
| school rank 1 | 20 |
| school rank 2 | 30 |
| school rank 3 (in progress) | 9 |
| Emerald Magistrate curriculum | 30 |
| Personal Advisor curriculum (in progress) | 9 |
| **spent** | **98** |
| earned (`system.xp_total`) | 100 |
| banked | 2 |

Each bucket matches its tab in the Foundry character sheet exactly. **There was never a
discrepancy** — the first attempt missed the nested items and double-counted the titles.

`system.xp_spent` on the actor is unreliable (it read 84 here); compute spend from the
items. `xp_total` is XP *earned*, and a character is normally not fully spent.

### 4. Curricula come from two different places

- **School curricula** are JournalEntry documents in the School Curriculum pack: a
  `<blockquote>Book p.N</blockquote>` followed by a table whose `<th>` rows open a rank.
  This is the only source of a school's source book.
- **Title curricula** are a table inside the *title item's own description HTML*, under an
  `<h2>Curriculum</h2>` heading — single-tier, so no rank rows. The description also
  carries `Title Ability:` and `Status Award:`, but the label and its value sit in
  separate spans, so match them on the stripped plain text, not the markup.

Both parse to 100% of their sets (110 schools, 55 titles). A campaign title that is not in
the compendium has no curriculum; show what was bought toward it via `via` instead.

### 5. Other traps in the actor record

- **No `compendiumSource`.** Items are copied without provenance, so catalog resolution is
  by normalized *name*. Three fallbacks, in `scripts/build.py`: exact; open-ended stem
  (`"Scorn of [One Group]"` → `"Scorn of"`); and title-qualified (`"Voice of Authority"` →
  `"Voice of Authority (Emerald Magistrate)"`, accepted **only** when the character holds
  that title, so a `(Daimyo)` variant can't stand in).
- **Twenty-questions picks are compendium ids**, not the actor's embedded item ids. Try
  the catalog first, then the actor's own items for bespoke content.
- **Two school titles in the compendium are upstream typos**: `Isawai Tensai School`
  (the book prints "Isawa Tensai", 3×; "Isawai" appears nowhere in it or in the corpus)
  and `Yogo Preserver Schoo` (truncated). The Foundry l5r5e system's
  core-journal-school-curriculum pack has them and l5r5e-compendia-sortilege mirrors it.
  Fixed at catalog load via `school_name_corrections` in the manifest, so the compendium
  spelling never reaches a page. Verified against `~/Working/sources/l5r5e`. **Foundry is
  not a source of truth for mechanics** — when its data and the book disagree, the book
  and the DSL corpus win, and the correction goes in the manifest with its evidence.
- **School names come in dirty.** Some carry the curriculum journal's `[Clan]` suffix;
  some are missing the word "School". The `[Clan]` strip is automatic; anything else goes
  in `corrections` in `src/foundry_sources.json` so it survives a re-extract.
- **`system.identity.clan` is the character's clan, not the school's.** Cross-clan
  training is legitimate and is not to be "fixed" (Jordan, 2026-08-29).

## Before you say an actor is fully read

Run `./scripts/pipeline.sh` and check `coverage.py`'s line:

```
actor items: 1054 across 9 types (134 nested inside a parent item)
             every type is extracted
```

If the nested count is 0, you are not recursing. If a type is unhandled, the gate fails.

## Reconstructed tiers

`scripts/derive_tiers.py` rebuilds earlier XP tiers for a character Foundry holds at one
point only. It buckets every purchase by school rank (from the advancement's own
`at_rank`) or by title (from the `via` field the nested walk records), and emits a tier at
each rank boundary and each completed title. Reconstructed tiers are marked
`"reconstructed": true`; the last tier is always the untouched Foundry record.

A title's granted ability is *granted*, not bought — it appears from the tier where the
title is held, never before.

## Pipeline order matters

`derive_tiers.py` needs the curriculum table `build.py` writes, and a `--force`
re-extract discards derived tiers. `./scripts/pipeline.sh` runs the chain correctly; use
it rather than calling the steps by hand.

## The Creator

`creator/index.html` + `assets/creator.js` port the twenty-questions flow from
titterpig-dashboard-web (`src/systems/l5r5e/chargen.js`, `src/lib/ai.js`). Keep the step
order and the AI prompts in step with that repo — they are meant to ask the same questions
in the same register.

Two divergences from that repo are deliberate (Jordan, 2026-08-30) and must not be
"corrected" back:

- **The AI prompts write in the third person**, about the character, and carry an
  explicit list of the habits that make machine prose read as machine prose
  (`VOICE`/`SHAPE`/`REGISTER`/`AVOID` in `assets/creator.js`). Naming the tics works
  better than asking for good writing. The dashboard still says second person; if it
  is ever brought into line, move the block across whole.
- **Concept material** is authoring context, not a character field. It lives in
  `concepts` in `src/foundry_sources.json`, rides to the browser on the archive
  draft, feeds every AI call, and is dropped on export. Do not put it in
  `src/characters/<slug>.json` — the source format's `concept` field already means
  something else (a one-line blurb), and a `--force` re-extract would lose it.

Two things to hold onto when editing it:

- **It exports this repo's source format.** The final step must keep emitting a valid
  `src/characters/<slug>.json`; if the schema changes in `scripts/extract_characters.py`,
  change `toSourceJson()` with it. The proof is a round trip: export, drop into
  `src/characters/`, run `./scripts/pipeline.sh`, and the gates must pass.
- **School names differ between the two data sets.** The chargen data says "Asahina
  Artificer"; the compendium roll says "Asahina Artificer School". `rollName()` resolves to
  the compendium spelling, because that is what the build's school-roll gate and the
  coverage ledger key off. Two need explicit aliases: "Isawa Tensai" (the compendium's
  typo) and "Wandering Blade".

### Two AI prompts are known not to have taken — pending a follow-up pass

The suggestion prompts were rewritten on 2026-09-05 after auditing every
free-text answer across 29 characters: the answers varied the nouns and repeated
the sentence, one architecture per question. Six tics are now banned by name in
the shared `STYLE` block, and five questions were rewritten.

Three of the five are landing. **Questions 4 and 20 are not**, and both are
flagged in place in `assets/creator.js` with the evidence:

| | the shape that keeps coming back | seen in |
|---|---|---|
| Q4 | a strength with its cost bolted on — "…, **but she cannot** look at what the Shadowlands did" | Kaiu Anzu |
| Q20 | the ironic death of the character's own flaw, narrated from outside them | Asako Yukitsuna, Kaiu Anzu |

Deferred by the owner (2026-09-06) until a few more characters exist, so the fix
is not tuned on one or two samples. **The fix to try is a quoted rejected
example rather than another prohibition** — a named ban has now failed twice on
each, and quoting the bad shape is what worked for the trailing participial
flourish. Do not simply add more words to the ban.

### Advantages and disadvantages have no prerequisites — do not invent any

`peculiarityPicker()` colours its list, and it is worth knowing what the colours can
honestly mean. **L5R5e peculiarities carry no requirement field**: not in the Foundry
compendium, not in the DSL corpus (`^"Ring"`, `^"Types"`, `EFFECT`, and nothing else),
because the game does not gate them on rings, clan, school, or anything else. Checked
against all 253 entries.

So the colouring is driven only by conditions that actually exist, all of them stated
in words on the row itself:

| | why |
|---|---|
| red | wrong kind for the question being asked |
| red | already on this character |
| red | `Shadowlands Taint …` — instilled by the Afflicted condition, an oni, or a cursed mask; never chosen (Shadowlands, and the DSL's own wording) |
| red | `Disdain for <paramount tenet>` / `Paragon of <least significant tenet>` — contradicts question 8 |
| green | granted outright by the heritage rolled at question 18 |
| green | `Disdain for <least significant tenet>` / `Paragon of <paramount tenet>` |
| amber | open-ended (`Ally [Name]`) — takeable, but needs a subject named |

Red is advisory: the picker asks for confirmation and then lets you through, because
the GM outranks the tool. If a real prerequisite is ever encoded upstream, extend
`pecStatus()` — do not hard-code a house rule there.

No API key is ever committed. The creator reads one from `localStorage` only.

## Rules text comes from the DSL, not from Foundry

Standing rule (Jordan, 2026-08-30). **The compendium is the catalog; the corpus is the
rules.** Foundry says what exists, what it costs, which pack it is in, and it is what an
actor's items resolve against. `~/Working/Titterpig DSL/titterpig-dsl-l5r5e/0.4` is what
the text comes from.

`scripts/dsl_rules_text.py` composes that corpus with **titterpig-synthesist** (errata
files load last, so the output is corrected text), caches it in `pipeline/dsl/`
(gitignored), and writes `data/chargen/peculiarities.js` — keyed by compendium **uuid**,
because five Shadowlands Taint entries share a name. `./scripts/pipeline.sh` runs it;
`--refresh-dsl` recomposes. It always rebuilds the synthesist first: a stale binary drops
content silently and still exits 0.

Why it matters, on one entry:

| | |
|---|---|
| DSL | "You have proven yourself to someone, who is willing to help you (within reason)…" |
| Foundry | a paragraph of flavour fiction, then "The following apply to a character with the Ally [Name] distinction: - You have proven yourself to **a someone**…" |

The DSL states the effects alone, as a list, in consistent `[Ring]` notation. Foundry
stores one HTML blob, and carries typos the corpus does not. Foundry also has
`Disdain for Courtesy` with an **empty** description while its six siblings are fine; the
DSL supplies it.

**GATE:** all 253 compendium peculiarities must resolve to a DSL entity or the script
exits 1 and names the strays. Three compendium entries are pre-expanded parametrics
(`Paragon of <Tenet>` ×7, `Disdain for <Tenet>` ×7, `Overconfidence in <X>` ×5) that map
to a single DSL rule; the UI names the parent it came from. Never fall back to Foundry's
text to make the gate pass — fix the corpus or extend `PARAMETRIC`.

Character pages follow from the same place: `scripts/build.py` has exactly one
description choke point, and it reads `pipeline/dsl/rules_text.json` there, so every
dossier and play sheet gets corpus text. Each rendered entry carries `text_source`
(`dsl` or `foundry`) so the origin is inspectable. **728 of 908 rendered entries are DSL
text; techniques, peculiarities, titles, bonds and abilities are 100%.** The remaining
180 are gear occurrences of the 25 entries in `dsl_text_exceptions`.

The output goes to a *file*, not a table in `l5r.sqlite`: `build.py` deletes and
recreates that database on every run, so anything written there is gone before the build
reads it. `pipeline.sh` therefore runs build → `dsl_rules_text.py` → build.

### Finding the text: four shapes, and one heuristic that must not come back

The corpus stores rules text four ways, and reading only the first misses 355 names:

1. **DEF nodes** — techniques, peculiarities, titles, schools
2. **labelled ability blocks** — a school's `SCHOOL_ABILITY` / `MASTERY_ABILITY`, whose
   name is the block's *label*, not a DEF name
3. **named value-pairs in a table** — `^"Ashigaru Armor" "Physical 3, Wargear, …"`
4. **Title Ability pairs** — `^"Title Ability" "Behold the Legend"` beside
   `^"Title Ability Effect" "…"`; some books instead inline it as `"Name: effect"`, and
   two state it only in a RULES label

Also: **DEFs nest**, inside blocks and inside other DEFs. Walking only the resolved
JSON's top-level `entities` list finds 237 peculiarities; walking the whole document
finds 256. Same shape of bug as the nested-actor-items one above.

`PROSE_PROPS` and `PROSE_BLOCKS` are **allowlists on purpose.** The first version took
any property whose value was over 40 characters, and put *"Errata Note: Title ability
Voice of Authority; Status Award +15 (floor 40). See 2019 errata for full text."* on the
Emerald Magistrate title where its rule belonged. Do not reintroduce a length heuristic —
the corpus's own bookkeeping (`Errata Note`, `Carryover From`, `Source Book`) is long
prose too. `^"Glory"` is authoring syntax for a cross-reference and renders as the plain
name.

### What the corpus does not carry, and why

25 referenced entries stay on Foundry text, each with a stated reason in
`dsl_text_exceptions` in `src/foundry_sources.json`. The gate fails on anything not
listed. Two different situations, and they must not be blurred:

- **14 weapons + 1 item — settled.** The corpus states a weapon's rules as its stat line,
  which the sheet already renders in its own columns. Foundry's description is flavour
  ("As much a work of art as it is a weapon, the katana…"), not rules. Nothing is missing.
- **4 entries — empty in Foundry too**, or authored in the module with no printed source.
- **6 items — a real gap, deferred by decision (Jordan, 2026-08-30).** Calligraphy Set,
  Finger of Jade, Personal Seal or Chop, Poison (One Vial), Quiver of Arrow, Traveling
  pack carry real mechanics ("Blanket, bowl, chopsticks, four days of travel rations… and
  any three other items of rarity 4 or lower"). Core Rulebook personal effects the corpus
  does not have. **Jordan has decided not to add them to the corpus for now**, so they keep
  Foundry's text. Their reason begins `DEFERRED` and the script names them on every run —
  not to nag, but because a gap that stops being printed is a gap that gets forgotten.
  Do not fold them in with the settled exclusions above.

## Never author rules text

Content references are names; the build resolves them to the compendium's own verbatim
description. A name that resolves to nothing fails the build. Genuinely bespoke content
is `"custom": true` and carries its own text in the character source.

## Foundry is read-only unless Jordan says otherwise

`scripts/foundry_push.py` dry-runs by default. **Do not run `--apply` without explicit
per-occasion approval** (standing position as of 2026-08-29: no pushes to Foundry).

## Five passes owed once the characters are built (Jordan, 2026-09-06)

Deliberately deferred to the end: each one wants the whole cast in front of it,
because they are all judgements about the set rather than about one character.
Counts below are as of 2026-09-06, 49 archive characters — re-run them, don't
trust them.

**1. Resolve the TBDs.** Open-ended peculiarities whose subject was never
filled in. 14 entries across 7 distinct names, and one is literally
`Pursued by TBD` (Moshi Sumitomo). The rest are unfilled brackets:
`Scorn of [One Group]` ×5, `Hana [Doll]` ×3, `Summoning Mantra : [One
Implement]` ×2, `Paragon of Bushidō Tenet [Righteousness]`, `Stalked by
[Creature]`, `Hero of [Village]`. The Creator has the field for it —
`pec_subjects`, question 18's picker — so this is filling in names, not
building anything. Find them with a scan of `src/characters/*.json` for
`TBD` and for `[…]` inside a peculiarity's `name`.

**2. Audit the names.** Every personal name against the game's own lists in
`data/chargen/names.js` (2158 entries) and against canon. Fold diacritics
first: 14 look absent, 13 after folding, and most of those are legitimately
outside the tables — Aarav is from the Ivory Kingdoms, Nergüi and Temur are
Unicorn steppe names, Jinrai, Sanpei and the Beshkara Constrictor are not
samurai at all. What is left is the real question: Sayaka, Setsuna, Nagiko,
Genzō, Hisano, Renshō, Asahi. **Not a bug list** — the tables are the game's
short lists, not the language.

Also worth knowing before it looks alarming: eight archive characters share a
full name with a compendium *actor*, and all eight are in the **Pregenerated
Player Characters** pack — they are our own characters as Foundry holds them,
not collisions.

**3. Duplicate personal names.** Two pairs today: **Kaiu Anzu / Shinjō Anzu**
and **Hiruma Kaede / Kitsu Kaede**. Different families, so both are legal in
Rokugan and neither is wrong — the question is whether the archive wants two
Anzu and two Kaede on one roster, and it is the owner's call, not the tool's.
Watch the slugs when renaming: `kitsu-kaede` and `hiruma-kaede` are distinct
files and distinct portraits.

**4. NPC merges and collisions.** 161 NPCs on the relationship map, each
written by whichever character's answers named them, so nobody has been
reconciled against anybody. No two NPCs share a full name, but four personal
names are shared across distinct NPCs — **Moshi Etsuko / Shiba Etsuko**,
**Akodo Hanae / Moshi Hanae**, **Bayushi Konoye / Hida Konoye**, and
**Kaiu Michio / Michio**, that last one likely the same person named twice.
Two questions per pair: is this one person who should merge into one node, or
two people who should be told apart. `scripts/relationship_map.py` is where a
merge would be expressed.

**5. Settle the outfit bundles.** 36 gear entries are exported `held: false`,
and 66 custom entries are the school outfit's own either-or wording rather
than a thing the character owns: `daishō (katana and wakizashi)` ×10,
`Blunted or wooden sword` ×5, `one weapon of rarity 6 or lower` ×7 across two
spellings, `an attendant or Rokugani pony` ×2, `Utaku steed` ×2, `Unicorn
warhorse` ×2, `Horse` ×2, `any two items of rarity 4 or lower` ×2. Each wants
one of three things: split into the items it names (the daishō is a katana and
a wakizashi, both in the catalog), chosen (the rarity slots, the either-ors),
or kept as an NPC-ish possession the sheet renders as prose (the mounts and
the attendant — note the compendium stocks Utaku Steed and Horse as **NPC
actors**, which is why gear resolution refuses them; see catalogHas()).

## Vassal families (Jordan, 2026-09-06)

Three rules, and every reader of the data follows them:

1. **The family name, everywhere, is the vassal family's own name** — Suio, Nasu,
   Tsume, never the patron's. On the record, on the roster, on the page.
2. **A vassal takes the patron family's mechanical benefits, coin included.** Tsume
   Kunimichi is paid on Doji's figures, Nasu Kōgo on Shiba's, Suio Kurva on Ide's.
3. **The site names the patron on hover** over the vassal name — the chip on the
   character page, the family in the relationship map's detail panel.

The list lives in `vassal_families` in `src/foundry_sources.json`: 97 houses, each
with its patron and that patron's clan, supplied by the owner and canonical for
this archive. The corpus names 98 vassal houses in its own name tables and
attributes **none** of them to a patron, which is why this is a manifest
declaration rather than corpus-derived. Cross-checked against those 98: 96 agree,
**Tsi** is on the owner's list and not in the corpus's names, and the corpus names
**Hanegansi** and **Shimizu** with no patron on the list. Izaku serves two patrons
(Agasha of the Phoenix, Tamori of the Dragon) and carries the second in `also`;
Kochako and Gyushi carry a `_note` for what the list itself qualifies about them.

Readers: `patron_of()` in `scripts/build.py` (the page and play-sheet payloads, and
the second-build gate's set of placeable houses) and in
`scripts/relationship_map.py`; `scripts/coin_audit.py` resolves a bare "Suio" or
"Tsume" through its patron's `^"Wealth"`. Before the list existed, only a record
that spelled the patron out in a parenthetical — `"Nasu (Shiba Vassal)"`, which is
what one Foundry actor happened to write — could be resolved at all, and the
placeable set was sixteen names hand-curated from the corpus and the wiki.

### One check written and left switched off

`build.py`'s second-build gate could also check that a planned vassal serves the
clan the plan names — the registry knows. It is written and commented out, because
switching it on fails four existing plans and each is the owner's call:

| plan | the registry says |
|---|---|
| Agasha Alchemist, Agasha Ascetic → Izaku | Izaku serves the Agasha of the **Phoenix**; both plans say Dragon. Izaku's second patron is the Tamori of the Dragon, so this may just want the `also` consulted. |
| Daidoji Iron Warrior → Hanako | Hanako serves the Seppun of the **Imperial Families**, not the Crane. |
| Ikoma Shadow → Naoko | Naoko serves the Utaku of the **Unicorn**, not the Lion. |
| Miya Cartographer, Miya Herald → Reju | Reju serves the Otomo of the Imperial Families. The plan's clan string is `"Imperial"` against the list's `"Imperial Families"` — a label mismatch, not a real one. |
