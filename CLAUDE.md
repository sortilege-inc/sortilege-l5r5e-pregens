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

### 4. Other traps in the actor record

- **No `compendiumSource`.** Items are copied without provenance, so catalog resolution is
  by normalized *name*. Three fallbacks, in `scripts/build.py`: exact; open-ended stem
  (`"Scorn of [One Group]"` → `"Scorn of"`); and title-qualified (`"Voice of Authority"` →
  `"Voice of Authority (Emerald Magistrate)"`, accepted **only** when the character holds
  that title, so a `(Daimyo)` variant can't stand in).
- **Twenty-questions picks are compendium ids**, not the actor's embedded item ids. Try
  the catalog first, then the actor's own items for bespoke content.
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

## Never author rules text

Content references are names; the build resolves them to the compendium's own verbatim
description. A name that resolves to nothing fails the build. Genuinely bespoke content
is `"custom": true` and carries its own text in the character source.

## Foundry is read-only unless Jordan says otherwise

`scripts/foundry_push.py` dry-runs by default. **Do not run `--apply` without explicit
per-occasion approval** (standing position as of 2026-08-29: no pushes to Foundry).
