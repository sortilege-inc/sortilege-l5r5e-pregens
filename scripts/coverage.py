#!/usr/bin/env python3
"""Coverage report + integrity gate.

Reports how much of the compendium the archive has put into play, and fails
(exit 1) on integrity problems — never on incompleteness. The archive is
*meant* to be incomplete for a long while; what must never happen is a number
that silently lies about it.

Fails on:
  * an empty denominator (a moved/renamed catalog would otherwise "pass" at 0/0)
  * a character school that is not on the compendium's School Curriculum roll
  * a content reference that resolves to nothing and is not marked custom
  * a character with no generated page, or a page with no character

    python3 scripts/coverage.py
"""
import collections, glob, json, os, sqlite3, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.path.join(ROOT, "pipeline", "l5r.sqlite")

SECTIONS = [
    ("Schools", "pack LIKE '%school-curriculum%'"),
    ("Techniques", "sub_type='technique' AND pack NOT LIKE '%-abilities-%'"),
    ("School & title abilities", "sub_type='technique' AND pack LIKE '%-abilities-%'"),
    ("Advantages & disadvantages", "sub_type='peculiarity'"),
    ("Titles", "sub_type='title'"),
    ("Equipment", "sub_type IN ('weapon','armor','item')"),
    ("Bonds", "sub_type='bond'"),
    ("Properties & patterns", "sub_type IN ('property','item_pattern','signature_scroll')"),
]


def main():
    if not os.path.exists(DB):
        sys.exit("no pipeline/l5r.sqlite — run scripts/build.py first")
    cx = sqlite3.connect(DB)
    cx.row_factory = sqlite3.Row
    fail = []

    # A published pregen counts towards nothing here. It is somebody else's
    # character, transcribed from a printed folio: that a school has one is not
    # evidence the archive has covered it, and a technique carried only by one
    # is not a technique the archive has used. It is listed so the number is
    # not a mystery, and then set aside.
    ARCHIVE = "provenance = 'archive'"
    total = cx.execute("SELECT COUNT(*) FROM catalog").fetchone()[0]
    nchar = cx.execute(f"SELECT COUNT(*) FROM character WHERE {ARCHIVE}").fetchone()[0]
    npub = cx.execute("SELECT COUNT(*) FROM character"
                      " WHERE provenance = 'published'").fetchone()[0]
    ntier = cx.execute(
        f"SELECT COUNT(*) FROM tier WHERE slug IN"
        f" (SELECT slug FROM character WHERE {ARCHIVE})").fetchone()[0]
    print(f"inventory units: {total} catalog entries, {nchar} characters, "
          f"{ntier} tiers"
          + (f"   (plus {npub} published pregens, which count towards none of "
             f"the below)" if npub else ""))
    if total == 0:
        fail.append("catalog is EMPTY — the denominator did not load")

    print()
    print(f"{'':34}{'used':>7}{'total':>8}")
    for label, where in SECTIONS:
        if label == "Schools":
            # A school is "used" when a character is built to it — schools are
            # never referenced as content the way a technique or item is.
            t = cx.execute("SELECT COUNT(*) FROM catalog WHERE " + where).fetchone()[0]
            u = cx.execute(
                "SELECT COUNT(*) FROM catalog c WHERE " + where +
                " AND EXISTS (SELECT 1 FROM character ch WHERE ch.school_norm = c.norm"
                f"            AND ch.{ARCHIVE})"
            ).fetchone()[0]
        else:
            row = cx.execute(
                "SELECT COUNT(*) t, SUM(CASE WHEN uuid IN"
                " (SELECT catalog_uuid FROM tier_content tc"
                "  WHERE tc.catalog_uuid IS NOT NULL"
                "  AND EXISTS (SELECT 1 FROM character ch WHERE ch.slug = tc.slug"
                f"             AND ch.{ARCHIVE}))"
                " THEN 1 ELSE 0 END) u FROM catalog WHERE " + where).fetchone()
            t, u = row["t"], row["u"] or 0
        pct = f"{round(100 * u / t)}%" if t else "—"
        print(f"  {label:32}{u:>7}{t:>8}   {pct:>4}")

    # --- integrity ---------------------------------------------------------
    schools = {r["norm"] for r in cx.execute(
        "SELECT norm FROM catalog WHERE pack LIKE '%school-curriculum%'")}
    # character.school_norm is already alias-resolved by scripts/build.py
    for r in cx.execute("SELECT slug, school, school_norm FROM character"):
        if r["school"] and r["school_norm"] not in schools:
            fail.append(f"{r['slug']}: school {r['school']!r} is not on the compendium roll")

    orphan = cx.execute(
        "SELECT COUNT(*) FROM tier_content WHERE custom=0 AND catalog_uuid IS NULL"
    ).fetchone()[0]
    if orphan:
        for r in cx.execute("SELECT DISTINCT slug, category, name FROM tier_content"
                            " WHERE custom=0 AND catalog_uuid IS NULL LIMIT 20"):
            fail.append(f"{r['slug']}: {r['category']} {r['name']!r} resolves to nothing")

    # Every item type present on a pulled actor must be one the extractor
    # handles. This is the check that would have caught signature_scroll being
    # dropped: the other gates only ever look at what was already extracted.
    handled = {"technique", "peculiarity", "title", "bond", "signature_scroll",
               "weapon", "armor", "item", "advancement"}
    def walk(items):
        for i in items or []:
            if not isinstance(i, dict):
                continue
            yield i
            nested = (i.get("system") or {}).get("items")
            if isinstance(nested, dict):
                nested = list(nested.values())
            if isinstance(nested, list):
                yield from walk(nested)

    on_actors = collections.Counter()
    nested_count = 0
    for path in glob.glob(os.path.join(ROOT, "pipeline", "foundry", "actors", "*.json")):
        doc = json.load(open(path))
        top = len(doc.get("items", []))
        every = list(walk(doc.get("items", [])))
        nested_count += len(every) - top
        for i in every:
            on_actors[i["type"]] += 1
    for t, n in sorted(on_actors.items()):
        if t not in handled:
            fail.append(f"actor item type {t!r} ({n} items) is not extracted — "
                        "silent content drop")
    # Nested items (a title's curriculum purchases live inside the title item)
    # must be counted, or the gate passes while content is being dropped.
    total_items = sum(on_actors.values())
    extracted = cx.execute("SELECT COUNT(*) FROM tier_content").fetchone()[0]
    print(f"actor items: {total_items} across {len(on_actors)} types "
          f"({nested_count} nested inside a parent item)")
    if all(t in handled for t in on_actors):
        print("             every type is extracted")

    # The hand-written pages in characters/ are not character stubs, so they are
    # not expected to have a source behind them. Kept in step with build.py's
    # own KEEP set: both gates treated the relationship map as a stray stub.
    HANDWRITTEN = {"index", "map"}
    pages = {os.path.basename(p)[:-5] for p in
             glob.glob(os.path.join(ROOT, "characters", "*.html"))} - HANDWRITTEN
    slugs = {r["slug"] for r in cx.execute("SELECT slug FROM character")}
    for s in sorted(slugs - pages):
        fail.append(f"{s}: no generated page in characters/")
    for s in sorted(pages - slugs):
        fail.append(f"{s}.html: page with no character source")

    # Every line on a published pregen's folio is recorded custom -- the sheet
    # is a transcription, not an advancement ledger -- so counting them here
    # would swamp the number this is for: how much of what the archive's own
    # characters carry is off the compendium.
    customs = cx.execute(
        f"SELECT COUNT(DISTINCT name) FROM tier_content tc WHERE custom=1"
        f" AND EXISTS (SELECT 1 FROM character ch WHERE ch.slug = tc.slug"
        f"             AND ch.{ARCHIVE})").fetchone()[0]
    pubcustoms = cx.execute(
        "SELECT COUNT(DISTINCT name) FROM tier_content tc WHERE custom=1"
        " AND EXISTS (SELECT 1 FROM character ch WHERE ch.slug = tc.slug"
        "             AND ch.provenance = 'published')").fetchone()[0]
    print(f"\noff-catalog (custom) entries carried by characters: {customs}"
          + (f"   (a further {pubcustoms} on the published pregens' folios, "
             f"which are transcriptions rather than ledgers)"
             if pubcustoms else ""))

    if fail:
        print(f"\nFAIL ({len(fail)}):")
        for f in fail:
            print("   " + f)
        sys.exit(1)
    print("\nPASS — integrity clean.")


if __name__ == "__main__":
    main()
