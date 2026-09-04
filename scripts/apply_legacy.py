#!/usr/bin/env python3
"""Land a Legacy: a record of what a character left for their successor.

A Legacy is *Legacies of War*'s alternative to the heritage table. A player
making a new character mid-campaign may take on the Legacy of their last PC,
and if they do they apply no result from Question 18. The Creator builds one
from a finished character (Promoted characters -> Legacy, or
?legacy=<slug>); this writes it down.

    python3 scripts/apply_legacy.py --file heroic-life-legacy.json
    python3 scripts/apply_legacy.py --file … --apply

It writes two things, which is what "record plus a pointer" means:

  * src/legacies/<slug>.json — the Legacy itself, naming its predecessor by
    slug. A record of its own so it survives the predecessor being edited or
    re-extracted, and so one character can leave more than one.
  * a `legacies` list on the predecessor's own source, so their page can say
    what they left behind.

The template's text is copied in rather than referenced. A successor's sheet
has to state the charge and the effects, and the record should not depend on
the template table still reading the same way years from now.

Nothing is written without --apply.
"""
import argparse, glob, json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "src", "characters")
OUT = os.path.join(ROOT, "src", "legacies")

# Everything a Legacy record carries. Stated here so a patch cannot smuggle in
# a field nothing reads, and so a missing one is caught rather than shipped.
FIELDS = ["legacy", "name", "predecessor", "predecessor_name", "from_template",
          "ring", "categories", "requirement", "charge", "effects",
          "recovery_note", "successor_must", "qualifies", "qualifies_why",
          "notes"]
REQUIRED = ["legacy", "name", "predecessor", "ring", "requirement", "charge",
            "effects"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", required=True, help="a Legacy from the Creator")
    ap.add_argument("--apply", action="store_true", help="write it")
    a = ap.parse_args()

    patch = json.load(open(a.file))
    missing = [f for f in REQUIRED if not patch.get(f)]
    if missing:
        sys.exit("the Legacy is missing " + ", ".join(missing))
    doc = {f: patch.get(f) for f in FIELDS}
    slug = doc["legacy"]

    pred = os.path.join(SRC, str(doc["predecessor"]) + ".json")
    if not os.path.exists(pred):
        sys.exit(f"no such predecessor: {os.path.relpath(pred, ROOT)}")
    character = json.load(open(pred))
    path = os.path.join(OUT, slug + ".json")

    print(f"{doc['name']} — the Legacy of {doc['predecessor_name']}")
    print(f"  {doc['ring']}"
          + (f", from the {doc['from_template']} template"
             if doc["from_template"] else ", written for this predecessor"))
    print(f"  requirement: {doc['requirement']}")
    if doc["qualifies"] == "met":
        print(f"  the predecessor qualifies: {doc['qualifies_why']}")
    elif doc["qualifies"] == "unmet":
        print(f"  the predecessor does NOT qualify: {doc['qualifies_why']}")
        print("  landing it anyway is the GM's call; it is recorded as unmet.")
    else:
        print("  qualifying is a call for the table, not something checked here")
    if doc["successor_must"]:
        print(f"  the successor must: {doc['successor_must']}")
    if os.path.exists(path):
        print(f"  NOTE {os.path.relpath(path, ROOT)} exists and would be replaced")
    held = [x for x in (character.get("legacies") or []) if x != slug]
    print(f"  {os.path.relpath(pred, ROOT)} would list "
          f"{len(held) + 1} legac{'y' if len(held) == 0 else 'ies'}")

    if not a.apply:
        print("\nDry run. Add --apply to write it.")
        return
    os.makedirs(OUT, exist_ok=True)
    json.dump(doc, open(path, "w"), indent=1, ensure_ascii=False)
    character["legacies"] = sorted(held + [slug])
    json.dump(character, open(pred, "w"), indent=1, ensure_ascii=False)
    print(f"\nWrote {os.path.relpath(path, ROOT)} and pointed "
          f"{os.path.relpath(pred, ROOT)} at it. "
          f"Run ./scripts/pipeline.sh to rebuild.")


if __name__ == "__main__":
    main()
