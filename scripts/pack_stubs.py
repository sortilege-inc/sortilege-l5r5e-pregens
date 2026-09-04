#!/usr/bin/env python3
"""Every pencilled school as an importable stub for the Creator.

A pack is a plan until somebody starts building it, and the gap between "Ide
Messenger is pencilled in for Winter's Embrace" and a draft with that school
and that campaign already set is pure retyping. This writes one stub per
pencilled school so the Creator can offer them: pick one and it opens a fresh
draft with the school chosen, the campaign tagged, and the right question set
for the book the school is from.

A stub is not a character. It has no record in src/characters/, so it counts
towards no coverage and appears in no roster -- which is the point. Coverage
credits a school when a character exists for it, draft or promoted, so
generating eighty draft characters here would have taken the Schools count
from 24 to 104 overnight and said nothing true.

    python3 scripts/pack_stubs.py
"""
import json
import os
import re
import sqlite3
import sys
import unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.path.join(ROOT, "pipeline", "l5r.sqlite")
OUT = os.path.join(ROOT, "data", "stubs.js")
SUF = ("school", "tradition", "order", "path", "conspiracy", "training")

# Which question set a school's book uses. Path of Waves and Writ of the Wilds
# answer questions 1 and 2 with a region and an upbringing where the core
# books use a clan and a family, and the Creator switches on this.
MODE_BY_BOOK = {"path of waves": "pow",
                "writ of the wild": "wow", "writ of the wilds": "wow"}


def norm(s):
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "", s.lower())


def payload(path, var):
    text = open(path, encoding="utf-8").read()
    return json.loads(text[text.index("=") + 1:].rstrip().rstrip(";"))


def main():
    if not os.path.exists(DB):
        sys.exit("no pipeline/l5r.sqlite — run scripts/build.py first")
    cx = sqlite3.connect(DB)
    cx.row_factory = sqlite3.Row
    catalog = {r["norm"]: r for r in cx.execute(
        "SELECT name, norm, clan, source_book, source_page FROM catalog"
        " WHERE pack LIKE '%school-curriculum%'")}

    schools = {}
    for s in payload(os.path.join(ROOT, "data", "chargen", "schools.js"),
                     "L5R_SCHOOLS"):
        schools[norm(s["name"])] = s
        for suf in SUF:
            schools.setdefault(norm(s["name"] + " " + suf), s)

    campaigns = payload(os.path.join(ROOT, "data", "campaigns.js"), "L5R_CAMPAIGNS")

    # Whether a character already exists for the school, and of which kind.
    # The Creator cannot work this out for itself: its archive feed carries all
    # 46 characters with no provenance on them, so a first attempt at this in
    # the browser marked three stubs "already built" when what it had found
    # was three published pregens -- Artisan of the Roads, Treasure Hunter and
    # Voice of the Wilds, all folios from The Highwayman. Those are somebody
    # else's characters and are the reason the school is still worth building.
    have = {}
    for prov, snorm in cx.execute(
            "SELECT provenance, school_norm FROM character"
            " WHERE school_norm IS NOT NULL"):
        # an archive build is the stronger claim, so it is not overwritten
        if have.get(snorm) != "archive":
            have[snorm] = prov

    stubs, missing = [], []
    for c in campaigns:
        # a borrowed shortlist is the same pack, so its stubs belong to the
        # campaign that owns it -- offering them twice would invite two drafts
        # for one character
        if c["pack_from"] or not c["pencilled"]:
            continue
        for pen in c["pencilled"]:
            n = norm(pen["school"])
            roll = catalog.get(n)
            s = schools.get(n)
            if roll is None or s is None:
                missing.append((c["name"], pen["school"]))
                continue
            book = (roll["source_book"] or "").strip().lower()
            stubs.append({
                # what the Creator seeds a draft with
                "school": roll["name"],
                "campaign": c["name"],
                "mode": MODE_BY_BOOK.get(book, "core"),
                # and what the chip shows
                "clan": s.get("clan"),
                "roles": s.get("roles") or [],
                "book": roll["source_book"],
                "page": roll["source_page"],
                # the campaigns this pack also serves, so a stub says so
                "also": c["pack_shared_with"] or [],
                # "archive" if the archive already built this school (the
                # shortlist has gone stale), "published" if only a publisher's
                # folio has it, absent if nobody
                "built_by": have.get(n),
                # the premise, straight into the draft's concept field
                "concept": pen.get("concept"),
            })
    if missing:
        print(f"FAIL — {len(missing)} pencilled school(s) do not resolve to both "
              f"the compendium roll and the corpus:", file=sys.stderr)
        for camp, school in missing:
            print(f"   {camp}: {school!r}", file=sys.stderr)
        return 1

    # every pencilled school on an owning campaign, exactly once
    want = sum(len(c["pencilled"]) for c in campaigns if not c["pack_from"])
    if len(stubs) != want:
        print(f"FAIL — {want} schools pencilled but {len(stubs)} stubs written",
              file=sys.stderr)
        return 1
    seen = {}
    for st in stubs:
        seen.setdefault(st["school"], []).append(st["campaign"])
    twice = {k: v for k, v in seen.items() if len(v) > 1}
    if twice:
        print(f"FAIL — {len(twice)} school(s) would offer a stub for more than "
              f"one campaign:", file=sys.stderr)
        for k, v in sorted(twice.items()):
            print(f"   {k}: {', '.join(v)}", file=sys.stderr)
        return 1

    stubs.sort(key=lambda s: (s["campaign"], s["school"]))
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("window.L5R_PACK_STUBS = "
                + json.dumps(stubs, ensure_ascii=False, sort_keys=True) + ";\n")
    stale = [s for s in stubs if s["built_by"] == "archive"]
    if stale:
        print(f"   ! {len(stale)} stub(s) whose school the archive has already "
              f"built: " + ", ".join(f"{s['school']} ({s['campaign']})"
                                     for s in stale))
    packs = len({s["campaign"] for s in stubs})
    modes = {}
    for s in stubs:
        modes[s["mode"]] = modes.get(s["mode"], 0) + 1
    nconcept = sum(1 for s in stubs if s["concept"])
    npub = sum(1 for s in stubs if s["built_by"] == "published")
    print(f"pack stubs: {len(stubs)} across {packs} packs -> "
          f"data/stubs.js ({os.path.getsize(OUT)/1024:.1f} KB), "
          + ", ".join(f"{v} {k}" for k, v in sorted(modes.items()))
          + (f"; {nconcept} with a concept" if nconcept else "")
          + (f"; {npub} on a school a published pregen already has"
             if npub else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
