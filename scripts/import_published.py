#!/usr/bin/env python3
"""The published pregens, from the corpus into src/characters/.

Three FFG products ship pregenerated PCs, and all twenty were already
transcribed verbatim into the DSL corpus as `.actor` files -- they were just
missing from the synthesist manifest, so nothing downstream could see them.
This reads them out of the resolved corpus and writes one character record per
pregen, marked `provenance: "published"`.

That mark is the whole point of the second category. A published pregen is
somebody else's character:

  * it counts towards no coverage -- that the Beginner Game has a Hida Defender
    folio is not evidence this archive has built one;
  * its purse comes off a printed folio, already spent down on the gear the
    sheet lists, so the coin audit does not hold it to what question 2 gives;
  * the roster hides it unless asked, because the archive is the work and
    these are reference.

Everything else it shares with any other character: a page, a play sheet, a
timeline. They are pregens; the point of having them is to hand one to someone.

Three sheet shapes, and each is followed rather than flattened:

  Wedding at Kyotei Castle  the full core sheet -- clan, family, school, giri
  Beginner Game             simplified: clan and family but no school and no
                            status, because the seven are students competing
                            to graduate
  The Highwayman            non-core: region and upbringing in place of clan
                            and family, and a past in place of a giri

Nothing here authors or paraphrases: every value is the corpus's, and where a
name cannot be resolved against the compendium the printed wording is kept as
a custom entry rather than bent into a near-match.

    python3 scripts/import_published.py            # write the records
    python3 scripts/import_published.py --check     # verify, write nothing
"""
import argparse
import json
import os
import re
import sys
import unicodedata

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dsl_rules_text import CACHE, ROOT, compose  # noqa: E402

SRC = os.path.join(ROOT, "src", "characters")

# Which product each file transcribes, from the file's own header comment.
# Keyed by source filename so a new cast is one line.
PRODUCTS = {
    "l5r5e-0.4-emerald-champion-pregens.actor": {
        "product": "Legend of the Five Rings Beginner Game",
        "adventure": "In the Palace of the Emerald Champion",
        "publisher": "Fantasy Flight Games", "year": 2018,
    },
    "l5r5e-0.4-highwayman-pregens.actor": {
        "product": "The Highwayman",
        "adventure": "The Highwayman",
        "publisher": "Fantasy Flight Games", "year": 2019,
    },
    "l5r5e-0.4-wedding-kyotei-pregens.actor": {
        "product": "Wedding at Kyotei Castle",
        "adventure": "Wedding at Kyotei Castle",
        "publisher": "Fantasy Flight Games", "year": 2018,
    },
}

SKILL_GROUPS = {
    "artisan": ["aesthetics", "composition", "design", "smithing"],
    "martial": ["fitness", "melee", "ranged", "unarmed", "meditation", "tactics"],
    "scholar": ["culture", "government", "medicine", "sentiment", "theology"],
    "social": ["command", "courtesy", "games", "performance"],
    "trade": ["commerce", "labor", "seafaring", "skulduggery", "survival"],
}
SKILL_KEY = {}
for _g, _ss in SKILL_GROUPS.items():
    for _s in _ss:
        SKILL_KEY[_s] = (_g, _s)
SKILL_KEY.update({
    "martial arts [melee]": ("martial", "melee"),
    "martial arts [ranged]": ("martial", "ranged"),
    "martial arts [unarmed]": ("martial", "unarmed"),
})

RINGS = ("air", "earth", "fire", "water", "void")

# "Quick Reflexes (Fire) — Distinction" / "Fear of Death (Earth) — Anxiety"
PEC_RE = re.compile(
    r"^(?P<name>.*?)\s*(?:\((?P<ring>Air|Earth|Fire|Water|Void)\))?"
    r"\s*[—–-]\s*(?P<kind>Distinction|Passion|Adversity|Anxiety)\s*$", re.I)
# "Lightning Raid (Shūji)" / "Skulk (New Opportunity)"
TECH_RE = re.compile(r"^(?P<name>.*?)\s*\((?P<kind>[^)]+)\)\s*$")
TECH_KIND = {"kata": "kata", "shūji": "shuji", "shuji": "shuji",
             "ritual": "ritual", "rituals": "ritual", "invocation": "invocation",
             "kihō": "kiho", "kiho": "kiho", "mahō": "maho", "maho": "maho",
             "ninjutsu": "ninjutsu", "shadow ritual": "ritual",
             "mantra": "mantra",
             # not a technique type: an Opportunity the character may spend,
             # which some sheets list in among the techniques
             "new opportunity": "opportunity"}
# "Invocation, Rank 1 from school ability" — the type, then where it came from
TECH_QUALIFIED_RE = re.compile(
    r"^(?P<kind>[^,]+?)\s*,\s*(?P<how>.+)$")
# "8 koku" / "2 bu, 30 zeni" / "koku 5"
COIN_RE = re.compile(r"(\d+)\s*(koku|bu|zeni)\b", re.I)
# "Wakizashi (short sword): Damage 3/5, Range 0–1, Ceremonial" -> "Wakizashi"
GEAR_NAME_RE = re.compile(r"^(?P<name>[^(:]+)")
# "Pregenerated gaijin PC for ..." / "Pregenerated rōnin PC" / "peasant"
ORIGIN_RE = re.compile(r"pregenerated\s+(?P<type>gaijin|rōnin|ronin|peasant)", re.I)


def norm(s):
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "", s.lower())


def slugify(s):
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode()
    return re.sub(r"^-|-$", "", re.sub(r"[^a-z0-9]+", "-", s.lower()))


def walk(n):
    if isinstance(n, dict):
        yield n
        for v in n.values():
            yield from walk(v)
    elif isinstance(n, list):
        for v in n:
            yield from walk(v)


def listing(value):
    """A LIST OF STRING property, which the synthesist hands back as its JSON
    array serialized into a string (see the synthesist skill's gotchas)."""
    if isinstance(value, list):
        return [str(x) for x in value]
    if not value:
        return []
    try:
        parsed = json.loads(value)
    except (ValueError, TypeError):
        return []
    return [str(x) for x in parsed] if isinstance(parsed, list) else []


def integer(value):
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


def props(entity):
    """name -> value, and the nested map for a DEF property."""
    flat, nested = {}, {}
    for p in entity.get("properties") or []:
        if p.get("type") == "DEF":
            nested[p["name"]] = {n["name"]: n.get("value")
                                 for n in (p.get("nested") or [])}
        elif p.get("value") not in (None, ""):
            flat[p["name"]] = p["value"]
    return flat, nested


def effects(entity):
    """Each nested ability DEF's verbatim Effect text, by name.

    The pregen files reproduce every school ability, technique, distinction and
    adversity in full beside the character. Where a name does not resolve
    against the compendium, this is what the record carries instead -- the
    printed wording, not a guess at which catalog entry was meant.
    """
    out = {}
    for sub in entity.get("sub_entities") or []:
        name, texts, refs = sub.get("name"), sub.get("text") or [], sub.get("refs") or []
        if not name:
            continue
        for i, ref in enumerate(refs):
            if ref == "Effect" and i < len(texts):
                out[name] = texts[i]
                break
        else:
            if texts:
                out[name] = texts[0]
    return out


def skills_of(entries, report):
    """["Aesthetics 1", "Martial Arts [Melee] 1"] -> the grouped shape."""
    out = {g: {s: 0 for s in ss} for g, ss in SKILL_GROUPS.items()}
    for raw in entries:
        m = re.match(r"^(?P<name>.*?)\s+(?P<rank>\d+)\s*$", str(raw).strip())
        if not m:
            report.append(f"skill not in 'Name N' form: {raw!r}")
            continue
        key = SKILL_KEY.get(m.group("name").strip().lower())
        if not key:
            report.append(f"skill name off the list of twenty-four: {raw!r}")
            continue
        g, s = key
        out[g][s] = int(m.group("rank"))
    return out


def content(name, kind=None, ring=None, text=None, types=None):
    """One techniques/peculiarities/gear entry, in the record's own shape.

    custom is set on everything: a published pregen's sheet is not an
    advancement ledger, and marking these as catalog references would put them
    in the coverage numbers by the back door. The name is still the
    compendium's wherever the sheet uses it, so the site's tooltips resolve.
    """
    e = {"name": name, "xp_used": 0, "xp_cost": 0, "in_curriculum": False,
         "bought_at_rank": 0, "custom": True}
    if kind:
        e["kind"] = kind
    if ring:
        e["ring"] = ring
    if types:
        e["types"] = types
    if text:
        e["description"] = text
    return e


def build(entity, source, report):
    """One pregen, as a character record."""
    P, N = props(entity)
    FX = effects(entity)
    name = P.get("Name") or entity["name"]
    desc = next((b["value"] for b in (entity.get("blocks") or [])
                 if b.get("keyword") == "DESCRIPTION"), "") or ""

    # rings come from the nested ^"Rings" DEF, keyed by the element's name
    rings = {}
    for r in RINGS:
        v = integer((N.get("Rings") or {}).get(r.capitalize()))
        if v is None:
            report.append(f"{name}: no {r} ring")
            v = 1
        rings[r] = v

    # the sheets spell it ^"Ninjo"; the inherited ^"Samurai" property is
    # ^"Ninjō", which stays empty because the two names never met
    ninjo = P.get("Ninjo") or P.get("Ninjō")
    # a core sheet has a giri, a Path of Waves one has a past in its place
    giri = P.get("Giri") or P.get("Past")

    peculiarities = []
    # The Beginner Game folios are simplified: each gives a single advantage by
    # name, with no ring and no distinction/passion/adversity/anxiety type,
    # because the box does not use them. A bare name there is the sheet being
    # followed, not a line this reader failed on.
    simplified = source == "l5r5e-0.4-emerald-champion-pregens.actor"
    for raw in listing(P.get("Advantages")) + listing(P.get("Disadvantages")):
        m = PEC_RE.match(str(raw).strip())
        if not m:
            if not simplified:
                report.append(f"{name}: peculiarity not in 'Name (Ring) — Kind' "
                              f"form: {raw!r}")
            peculiarities.append(content(str(raw).strip(),
                                         text=FX.get(str(raw).strip())))
            continue
        pname = m.group("name").strip()
        peculiarities.append(content(
            pname, kind=m.group("kind").lower(),
            ring=(m.group("ring") or "").lower() or None,
            text=FX.get(f"{pname} ({m.group('ring').capitalize()})"
                        if m.group("ring") else pname) or FX.get(pname)))

    techniques = []
    for raw in listing(P.get("Techniques")):
        m = TECH_RE.match(str(raw).strip())
        tname = (m.group("name") if m else str(raw)).strip()
        paren = (m.group("kind") if m else "").strip()
        kind = TECH_KIND.get(paren.lower())
        note = None
        if m and not kind:
            # "Invocation, Rank 1 from school ability" states the type and then
            # how it was gained; the type is the part before the comma
            qm = TECH_QUALIFIED_RE.match(paren)
            if qm:
                kind = TECH_KIND.get(qm.group("kind").strip().lower())
                note = qm.group("how").strip()
        if not kind:
            # keep the parenthetical in the name rather than dropping what the
            # sheet says about it
            report.append(f"{name}: technique {raw!r} names no type this reader "
                          f"knows — kept whole and unclassified")
            tname = str(raw).strip()
        e = content(tname, kind=kind, text=FX.get(tname))
        if note:
            # "Rank 1 from school ability": how the character has it, which the
            # sheet states and no catalog entry does
            e["granted_as"] = note
        techniques.append(e)

    # a school ability is on the sheet as a named block, not in any list
    listed = {norm(t["name"]) for t in techniques} | \
             {norm(p["name"]) for p in peculiarities}
    for fx_name, text in FX.items():
        if norm(fx_name) not in listed and \
                norm(re.sub(r"\s*\([^)]*\)\s*$", "", fx_name)) not in listed:
            techniques.append(content(fx_name, kind="school_ability", text=text))

    # the equipment list carries the purse in among the gear
    coins = {"koku": 0, "bu": 0, "zeni": 0}
    gear = []
    for raw in listing(P.get("Equipment")):
        line = str(raw).strip()
        found = COIN_RE.findall(line)
        # only a line that is nothing but coin: "8 koku" is money, a
        # "coin purse" is gear
        if found and not re.sub(COIN_RE, "", line).strip(" ,.and"):
            for count, kind in found:
                coins[kind.lower()] += int(count)
            continue
        gm = GEAR_NAME_RE.match(line)
        gname = (gm.group("name") if gm else line).strip()
        gear.append({"name": gname, "quantity": 1,
                     # the printed line in full, since it carries the damage,
                     # range and qualities the sheet states
                     "printed": line, "custom": True})

    tier = {
        "xp": 0,
        # a folio states a school rank without stating experience spent, so the
        # rank is the sheet's and the XP is left at zero rather than invented
        "label": None,
        "rank": integer(P.get("School Rank")) or 1,
        "school": P.get("School"),
        "foundry_id": None,
        "foundry_name": None,
        "rings": rings,
        "skills": skills_of(listing(P.get("Skills")), report),
        "social": {
            "honor": integer(P.get("Honor")),
            "glory": integer(P.get("Glory")),
            "status": integer(P.get("Status")),
            "ninjo": ninjo, "giri": giri,
            "bushido_tenets": {"paramount": None, "less_significant": None},
        },
        "derived": {
            "endurance": integer(P.get("Endurance")),
            "composure": integer(P.get("Composure")),
            "focus": integer(P.get("Focus")),
            "vigilance": integer(P.get("Vigilance")),
            "void_points": integer(P.get("Void Points")),
        },
        "money": coins,
        "techniques": techniques,
        "peculiarities": peculiarities,
        "titles": [], "bonds": [], "signature_scrolls": [],
        "gear": gear,
        "advancements": [],
    }

    om = ORIGIN_RE.search(desc)
    origin = None
    if om:
        origin = "ronin" if om.group("type").lower().startswith("r") \
            else om.group("type").lower()
    elif P.get("Region") or P.get("Upbringing"):
        report.append(f"{name}: a non-core sheet whose description does not say "
                      f"gaijin, rōnin or peasant — origin type left unstated")

    return {
        "slug": slugify(name),
        "name": name,
        "folder_label": name,
        "campaign": None,
        "status": None,
        "bucket": None,
        "accent": None,
        # the mark that makes this the second category
        "provenance": "published",
        "published": dict(PRODUCTS[source], source_file=source),
        "identity": {
            "clan": P.get("Clan"),
            "family": P.get("Family"),
            "region": P.get("Region"),
            "upbringing": P.get("Upbringing"),
            "origin_type": origin,
            "school": P.get("School"),
            "role": (listing(P.get("Roles")) or [None])[0],
            "age": "",
        },
        "portrait": None,
        "concept": desc or None,
        "summary": None,
        "notes": None,
        # A printed folio is not the product of the twenty questions; it states
        # the answers it wants and no more. Inventing steps to fill the shape
        # would put words in the character's mouth, so the record says plainly
        # that it was not built that way.
        "twenty_questions": None,
        "relationships": P.get("Relationships") or None,
        "demeanor": P.get("Demeanor") or None,
        "tiers": [tier],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true",
                    help="report what would be written, write nothing")
    ap.add_argument("--refresh", action="store_true",
                    help="recompose the corpus first")
    args = ap.parse_args()

    # the composed corpus, composing it first if this is a fresh checkout
    corpus = (compose(args.refresh) if args.refresh or not os.path.exists(CACHE)
              else json.load(open(CACHE, encoding="utf-8")))

    found = []
    for d in walk(corpus):
        if not (isinstance(d, dict) and d.get("kind") == "def"):
            continue
        src = next((s for s in (d.get("sources") or [])
                    if s.endswith("-pregens.actor")), None)
        if src:
            found.append((d, src))

    if not found:
        sys.exit("FAIL — no *-pregens.actor entities in the composed corpus. "
                 "The three files are on disk; if they are not in the "
                 "synthesist manifest's load_order they compile to nothing. "
                 "See the synthesist skill on manifest drift.")

    # Every pregen in the corpus becomes a record. The count per file is the
    # source's own enumerable set, so a file that silently loses one is caught
    # rather than reported as a clean run.
    expected = {"l5r5e-0.4-emerald-champion-pregens.actor": 7,
                "l5r5e-0.4-highwayman-pregens.actor": 6,
                "l5r5e-0.4-wedding-kyotei-pregens.actor": 7}
    per_file = {}
    for _, src in found:
        per_file[src] = per_file.get(src, 0) + 1
    short = [(f, n, per_file.get(f, 0)) for f, n in expected.items()
             if per_file.get(f, 0) != n]
    if short:
        for f, want, got in short:
            print(f"FAIL — {f}: the corpus has {got} pregens, the printed "
                  f"product has {want}", file=sys.stderr)
        return 1
    unknown = sorted(set(per_file) - set(expected))
    if unknown:
        print(f"FAIL — {len(unknown)} pregen file(s) this script does not know "
              f"the product for; add them to PRODUCTS:", file=sys.stderr)
        for f in unknown:
            print(f"   {f}", file=sys.stderr)
        return 1

    report, wrote, docs = [], 0, []
    for entity, src in sorted(found, key=lambda x: x[0]["name"]):
        doc = build(entity, src, report)
        docs.append(doc)
        if args.check:
            continue
        os.makedirs(SRC, exist_ok=True)
        path = os.path.join(SRC, doc["slug"] + ".json")
        # The importer owns these files: it rewrites them every run so a corpus
        # correction lands, rather than skipping what already exists. Nothing
        # hand-edits a transcription -- a fix belongs in the .actor file.
        prev = None
        if os.path.exists(path):
            prev = json.load(open(path, encoding="utf-8"))
            if prev.get("provenance") != "published":
                print(f"FAIL — {path} exists and is not a published pregen; "
                      f"refusing to overwrite a character built here",
                      file=sys.stderr)
                return 1
        if prev != doc:
            json.dump(doc, open(path, "w"), indent=1, ensure_ascii=False)
            wrote += 1

    by_product = {}
    for d in docs:
        by_product.setdefault(d["published"]["product"], []).append(d["name"])
    verb = "would write" if args.check else "wrote"
    print(f"published pregens: {len(docs)} from {len(by_product)} products, "
          f"{verb} {wrote if not args.check else len(docs)}")
    for product, names in sorted(by_product.items()):
        print(f"   {product} — {len(names)}: {', '.join(sorted(names))}")

    # counted so a shape that stops parsing is visible in the run rather than
    # discovered later as an empty field on a page
    stats = {
        "with a school": sum(1 for d in docs if d["identity"]["school"]),
        "with a purse": sum(1 for d in docs
                            if any((d["tiers"][0]["money"] or {}).values())),
        "with a giri or past": sum(1 for d in docs
                                   if d["tiers"][0]["social"]["giri"]),
        "with a ninjo": sum(1 for d in docs if d["tiers"][0]["social"]["ninjo"]),
        "technique entries": sum(len(d["tiers"][0]["techniques"]) for d in docs),
        "peculiarity entries": sum(len(d["tiers"][0]["peculiarities"]) for d in docs),
        "gear entries": sum(len(d["tiers"][0]["gear"]) for d in docs),
    }
    print("   " + ", ".join(f"{v} {k}" for k, v in stats.items()))
    if report:
        print(f"\n   {len(report)} thing(s) the reader could not classify:")
        for line in report:
            print(f"      {line}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
