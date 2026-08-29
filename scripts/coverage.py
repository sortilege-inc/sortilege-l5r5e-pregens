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

    total = cx.execute("SELECT COUNT(*) FROM catalog").fetchone()[0]
    nchar = cx.execute("SELECT COUNT(*) FROM character").fetchone()[0]
    print(f"inventory units: {total} catalog entries, {nchar} characters, "
          f"{cx.execute('SELECT COUNT(*) FROM tier').fetchone()[0]} tiers")
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
                " AND EXISTS (SELECT 1 FROM character ch WHERE ch.school_norm = c.norm)"
            ).fetchone()[0]
        else:
            row = cx.execute(
                "SELECT COUNT(*) t, SUM(CASE WHEN uuid IN"
                " (SELECT catalog_uuid FROM tier_content WHERE catalog_uuid IS NOT NULL)"
                " THEN 1 ELSE 0 END) u FROM catalog WHERE " + where).fetchone()
            t, u = row["t"], row["u"] or 0
        pct = f"{round(100 * u / t)}%" if t else "—"
        print(f"  {label:32}{u:>7}{t:>8}   {pct:>4}")

    # --- integrity ---------------------------------------------------------
    schools = {r["norm"] for r in cx.execute(
        "SELECT norm FROM catalog WHERE pack LIKE '%school-curriculum%'")}
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

    pages = {os.path.basename(p)[:-5] for p in
             glob.glob(os.path.join(ROOT, "characters", "*.html"))} - {"index"}
    slugs = {r["slug"] for r in cx.execute("SELECT slug FROM character")}
    for s in sorted(slugs - pages):
        fail.append(f"{s}: no generated page in characters/")
    for s in sorted(pages - slugs):
        fail.append(f"{s}.html: page with no character source")

    customs = cx.execute("SELECT COUNT(DISTINCT name) FROM tier_content WHERE custom=1").fetchone()[0]
    print(f"\noff-catalog (custom) entries carried by characters: {customs}")

    if fail:
        print(f"\nFAIL ({len(fail)}):")
        for f in fail:
            print("   " + f)
        sys.exit(1)
    print("\nPASS — integrity clean.")


if __name__ == "__main__":
    main()
