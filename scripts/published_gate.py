#!/usr/bin/env python3
"""The second category holds: a published pregen counts towards nothing.

Three claims, each checked against what actually shipped rather than against
the intent of the code that was meant to enforce it:

  1. No published pregen appears anywhere in data/coverage.js -- not as a
     school's build, not as a character carrying a catalog entry. That file is
     the coverage numbers; a slug in it is a slug being counted.
  2. Every published row in data/roster.js says so, and names its product.
     The Characters tab hides them by that field, so a row missing it would be
     shown as though it were the archive's own work.
  3. Every pregen the corpus holds became a record. The count is the source's
     own enumerable set, per product, so a file that quietly loses one fails
     here instead of passing as a clean run.

They still get a page and a play sheet, and that is checked too: hiding them
from the roster is not the same as not building them, and someone handed a
pregen needs the sheet.

    python3 scripts/published_gate.py
"""
import glob
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "src", "characters")
DATA = os.path.join(ROOT, "data")

# what each product ships, from the printed products
EXPECTED = {"Legend of the Five Rings Beginner Game": 7,
            "The Highwayman": 6,
            "Wedding at Kyotei Castle": 7,
            "Children of the Five Winds": 6}


def payload(path, var):
    text = open(path, encoding="utf-8").read()
    m = re.match(r"\s*window\.%s\s*=\s*" % re.escape(var), text)
    body = text[m.end():] if m else text[text.index("=") + 1:]
    return json.loads(body.rstrip().rstrip(";"))


def main():
    fail = []

    records = {}
    for path in sorted(glob.glob(os.path.join(SRC, "*.json"))):
        doc = json.load(open(path, encoding="utf-8"))
        records[doc["slug"]] = doc
    published = {s: d for s, d in records.items()
                 if d.get("provenance") == "published"}
    if not published:
        fail.append("no published pregens on disk at all — "
                    "scripts/import_published.py has not run, or the "
                    "*-pregens.actor files are missing from the synthesist "
                    "manifest's load_order")

    # --- 1. nothing of theirs is in the coverage numbers -------------------
    cov = payload(os.path.join(DATA, "coverage.js"), "L5R_COVERAGE")
    counted = set()
    for uuid, rows in (cov.get("used") or {}).items():
        for r in rows:
            if r.get("slug") in published:
                counted.add(r["slug"])
    for sc in cov.get("schools") or []:
        if sc.get("slug") in published:
            counted.add(sc["slug"])
    for cu in cov.get("customs") or []:
        if cu.get("slug") in published:
            counted.add(cu["slug"])
    if counted:
        fail.append(f"{len(counted)} published pregen(s) are counted in "
                    f"data/coverage.js: " + ", ".join(sorted(counted)))

    # --- 2. the roster can tell them apart --------------------------------
    roster = {r["slug"]: r for r in payload(os.path.join(DATA, "roster.js"),
                                            "L5R_ROSTER")}
    unmarked = [s for s in published if s in roster
                and roster[s].get("provenance") != "published"]
    if unmarked:
        fail.append(f"{len(unmarked)} published pregen(s) are on the roster "
                    f"without saying so, so the Characters tab would show them "
                    f"as the archive's: " + ", ".join(sorted(unmarked)))
    nameless = [s for s in published if s in roster and not roster[s].get("product")]
    if nameless:
        fail.append(f"{len(nameless)} published pregen(s) name no product: "
                    + ", ".join(sorted(nameless)))
    missing_row = sorted(set(published) - set(roster))
    if missing_row:
        fail.append(f"{len(missing_row)} published pregen(s) are not on the "
                    f"roster at all, so the toggle cannot reach them: "
                    + ", ".join(missing_row))

    # --- 3. the whole set, per product -------------------------------------
    by_product = {}
    for d in published.values():
        by_product.setdefault((d.get("published") or {}).get("product"), []).append(d["slug"])
    for product, want in EXPECTED.items():
        got = len(by_product.get(product) or [])
        if got != want:
            fail.append(f"{product}: {got} pregens on disk, the product ships {want}")
    extra = sorted(k for k in by_product if k not in EXPECTED)
    if extra:
        fail.append("published pregens from a product this gate does not know "
                    "the size of: " + ", ".join(str(x) for x in extra))

    # --- and they are still built ------------------------------------------
    for slug in sorted(published):
        page = os.path.join(ROOT, "characters", slug + ".html")
        if not os.path.exists(page):
            fail.append(f"{slug}: no page in characters/ — hidden from the "
                        f"roster is not the same as not built")
        sheets = glob.glob(os.path.join(ROOT, "play", slug + "-*xp.html"))
        if not sheets:
            fail.append(f"{slug}: no play sheet — a pregen exists to be handed "
                        f"to someone")

    if fail:
        print(f"FAIL — the published-pregen category leaks, {len(fail)} way(s):",
              file=sys.stderr)
        for f in fail:
            print(f"   {f}", file=sys.stderr)
        return 1

    print(f"published pregens: {len(published)} across {len(by_product)} products, "
          f"counted in no coverage number, marked on every roster row, "
          f"each with a page and a play sheet")
    return 0


if __name__ == "__main__":
    sys.exit(main())
