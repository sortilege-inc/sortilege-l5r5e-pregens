#!/usr/bin/env python3
"""Rokugani name tables for the Creator, from the l5r5e system's own roll tables.

Question 5 asks who the character's lord is, and a lord needs a name. These are
the tables the l5r5e Foundry system ships for exactly that — the Path of Waves
name lists and the system's gendered given-name lists — plus the vassal family
names, so a lord can come from outside the great families.

Sources live in ~/Working/sources/l5r5e/names (override with L5R_NAMES):

    fvtt-RollTable-japanese-names-(male|female)   gendered given names
    fvtt-RollTable-rokugani-names                 Path of Waves p.222, ungendered
    vassal_family_names.txt                       vassal families

Great and minor clan families come from data/chargen/families.js, so a lord's
family stays consistent with the clans the wizard already knows about.

Writes data/chargen/names.js (window.L5R_NAMES).

    python3 scripts/name_tables.py
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.environ.get(
    "L5R_NAMES",
    os.path.join(os.path.dirname(os.path.dirname(ROOT)), "Working", "sources",
                 "l5r5e", "names"))
if not os.path.isdir(SRC):
    SRC = os.path.expanduser("~/Working/sources/l5r5e/names")
OUT = os.path.join(ROOT, "data", "chargen", "names.js")
FAMILIES = os.path.join(ROOT, "data", "chargen", "families.js")


def roll_table(fragment):
    """The entries of one Foundry RollTable export, by filename fragment.

    Each result carries its name in `description`; `name` is empty in these
    exports, which is why the obvious field is the wrong one.
    """
    hits = [f for f in os.listdir(SRC) if fragment in f and f.endswith(".json")]
    if not hits:
        return [], None
    doc = json.load(open(os.path.join(SRC, hits[0]), encoding="utf-8"))
    out = []
    for r in doc.get("results") or []:
        name = (r.get("description") or "").strip()
        if name:
            out.append(name)
    return sorted(set(out)), doc.get("description")


def load_js(path, ):
    text = open(path, encoding="utf-8").read()
    return json.loads(text[text.index("=") + 1:].rstrip().rstrip(";\n").rstrip(";"))


def main():
    if not os.path.isdir(SRC):
        sys.exit(f"name sources not found at {SRC} — set L5R_NAMES")

    male, male_src = roll_table("japanese-names-(male)")
    female, female_src = roll_table("japanese-names-(female)")
    rokugani, rokugani_src = roll_table("rokugani-names")

    vassal = []
    vpath = os.path.join(SRC, "vassal_family_names.txt")
    if os.path.exists(vpath):
        vassal = sorted({l.strip() for l in open(vpath, encoding="utf-8") if l.strip()})

    # Clan families come from the wizard's own data, so a lord's family is one
    # the rest of the interface recognises.
    by_clan = {}
    if os.path.exists(FAMILIES):
        for f in load_js(FAMILIES):
            if f.get("name") and f.get("clan"):
                by_clan.setdefault(f["clan"], []).append(f["name"])
    for k in by_clan:
        by_clan[k] = sorted(set(by_clan[k]))

    data = {
        "given": {
            "male": male,
            "female": female,
            # The Path of Waves list is not split by gender, so it backs the
            # "any" setting rather than being merged into either.
            "any": sorted(set(rokugani) | set(male) | set(female)),
        },
        "family": {"by_clan": by_clan, "vassal": vassal},
        "sources": {
            "male": male_src, "female": female_src, "rokugani": rokugani_src,
            "vassal": "vassal family names",
        },
    }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write("window.L5R_NAMES = ")
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")

    print(f"names: {len(male)} male, {len(female)} female, {len(data['given']['any'])} any; "
          f"{sum(len(v) for v in by_clan.values())} clan families across {len(by_clan)} clans, "
          f"{len(vassal)} vassal -> {os.path.relpath(OUT, ROOT)} "
          f"({os.path.getsize(OUT)/1024:.1f} KB)")


if __name__ == "__main__":
    main()
