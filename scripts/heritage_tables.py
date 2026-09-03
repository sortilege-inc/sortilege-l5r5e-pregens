#!/usr/bin/env python3
"""Extract every L5R5e heritage table from the Titterpig DSL corpus.

Question 18 offers a heritage table, and the game has eight of them across the
line — the core Samurai table plus a replacement table in most supplements.
The dashboard's ingested data carries only the core one, with its sub-tables
dropped, so this reads the DSL sources directly.

Every table is now stated in the spec's canonical form:

    HERITAGE_TABLE {
        <roll|roll-range> [#anchor] ^"Name" DEF {
            MODIFIERS { ^"Glory" "+3" }
            EFFECT { "..." }
            SUB_TABLE "1d10" { "1-2" "..." }
        }
    }

The `entries` and `comments` readers below are kept only as a safety net: if a
table ever regresses to prose, the parser still reads it and the form is
reported as something other than "core", which is the signal to fix the corpus
rather than to widen the parser.

Writes data/chargen/heritages.js (window.L5R_HERITAGES).

    python3 scripts/heritage_tables.py
"""
import glob, json, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from generate_pregen import SKILL_LABEL

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DSL = os.environ.get(
    "L5R_DSL",
    os.path.join(os.path.dirname(ROOT), "Titterpig DSL", "titterpig-dsl-l5r5e", "0.4"))
OUT = os.path.join(ROOT, "data", "chargen", "heritages.js")

TABLE_RE = re.compile(r'\^"(?P<name>[^"]*Heritage[^"]*)"\s+DEF\s*\{', re.I)
ROLL_IN_NAME = re.compile(r"\s*\((?:roll\s*)?(?P<roll>[\d\s,–—-]+)\)\s*$", re.I)
LEADING_ROLL = re.compile(r"^(?P<roll>[\d–—-]+)\s*[-–]\s*(?P<rest>.+)$")


def block(text, start):
    """The braced block beginning at the first { at or after `start`."""
    i = text.index("{", start)
    depth, j = 0, i
    while j < len(text):
        if text[j] == "{":
            depth += 1
        elif text[j] == "}":
            depth -= 1
            if depth == 0:
                return text[i + 1:j], j
        j += 1
    return text[i + 1:], len(text)


def clean(s):
    return re.sub(r"\s+", " ", (s or "").replace('\\"', '"')).strip()


def parse_sub_table(body):
    m = re.search(r'SUB_TABLE\s+"(?P<die>[^"]+)"\s*\{', body)
    if not m:
        return None
    inner, _ = block(body, m.end() - 1)
    ranges = [{"range": r, "text": clean(t)}
              for r, t in re.findall(r'"([^"]+)"\s+"((?:[^"\\]|\\.)*)"', inner)]
    return {"die": m.group("die"), "ranges": ranges} if ranges else None


def parse_effect(body):
    """EFFECT { "…" } — used where an entry grants something instead of a sub-roll."""
    m = re.search(r"EFFECT\s*\{", body)
    if not m:
        return None
    inner, _ = block(body, m.end() - 1)
    parts = [clean(x) for x in re.findall(r'"((?:[^"\\]|\\.)*)"', inner)]
    return " ".join(parts) or None


def parse_modifiers(body):
    m = re.search(r"MODIFIERS\s*\{", body)
    if not m:
        return {}
    inner, _ = block(body, m.end() - 1)
    return {k: v for k, v in re.findall(r'\^"([^"]+)"\s+"([^"]+)"', inner)}


def parse_strings(body):
    """^"Description" STRING "…" pairs."""
    return {k: clean(v) for k, v in
            re.findall(r'\^"([^"]+)"\s+STRING\s+"((?:[^"\\]|\\.)*)"', body)}


def comment_text(body):
    lines = [re.sub(r"^\s*#\s?", "", l) for l in body.splitlines()
             if l.strip().startswith("#")]
    return clean(" ".join(lines))


def split_roll(name):
    """Pull a roll range out of an entry name, however it is written."""
    m = ROLL_IN_NAME.search(name)
    if m:
        return clean(ROLL_IN_NAME.sub("", name)), clean(m.group("roll"))
    m = LEADING_ROLL.match(name)
    if m:
        return clean(m.group("rest")), clean(m.group("roll"))
    return clean(name), None


def parse_table(name, body, source):
    entries = []

    # --- form 1: HERITAGE_TABLE with numbered DEFs ------------------------
    m = re.search(r"HERITAGE_TABLE\s*\{", body)
    if m:
        inner, _ = block(body, m.end() - 1)
        pos = 0
        for em in re.finditer(
                r'(?P<roll>\d+)\s+(?:#\S+\s+)?\^"(?P<name>[^"]+)"\s+DEF\s*\{', inner):
            ebody, end = block(inner, em.end() - 1)
            props = parse_strings(ebody)
            entries.append({
                # a multi-roll entry states its span in PROPERTIES
                "roll": props.get("Roll Range") or em.group("roll"),
                "name": clean(em.group("name")),
                "description": comment_text(
                    re.split(r"PROPERTIES|MODIFIERS", ebody)[0]),
                "modifiers": parse_modifiers(ebody),
                "effect": parse_effect(ebody),
                "sub_table": parse_sub_table(ebody),
            })
            pos = end
        if entries:
            return {"name": name, "source": source, "form": "core", "entries": entries}

    # --- form 2: ENTRIES with Description / Modifier / Effect strings ------
    m = re.search(r"ENTRIES\s*\{", body)
    if m:
        inner, _ = block(body, m.end() - 1)
        for em in re.finditer(r'\^"(?P<name>[^"]+)"\s+DEF\s*\{', inner):
            ebody, _ = block(inner, em.end() - 1)
            fields = parse_strings(ebody)
            ename, roll = split_roll(em.group("name"))
            entries.append({
                "roll": roll, "name": ename,
                "description": fields.get("Description") or comment_text(ebody),
                "modifiers": ({"note": fields["Modifier"]} if fields.get("Modifier") else {}),
                "effect": fields.get("Effect"),
                "sub_table": parse_sub_table(ebody),
            })
        if entries:
            return {"name": name, "source": source, "form": "entries", "entries": entries}

    # --- form 3: bare DEFs whose content is comments -----------------------
    for em in re.finditer(r'\^"(?P<name>[^"]+)"\s+DEF\s*\{', body):
        ebody, _ = block(body, em.end() - 1)
        ename, roll = split_roll(em.group("name"))
        text = comment_text(ebody)
        if not text and not roll:
            continue
        mod = re.search(r"Modifier:\s*(?P<m>[^.]*\.)", text)
        eff = re.search(r"(?:Other|Effect):\s*(?P<e>.*)$", text)
        entries.append({
            "roll": roll, "name": ename,
            "description": re.split(r"Modifier:|Other:|Effect:", text)[0].strip(),
            "modifiers": ({"note": clean(mod.group("m"))} if mod else {}),
            "effect": clean(eff.group("e")) if eff else None,
            "sub_table": None,
        })
    if entries:
        return {"name": name, "source": source, "form": "comments", "entries": entries}

    # --- not encoded: the corpus names the table but records only rule ids ---
    m = re.search(r"RULES\s*\{", body)
    if m:
        inner, _ = block(body, m.end() - 1)
        rules = re.findall(r"#\S+:\s*(\S+)", inner)
        if any("heritage" in r for r in rules):
            return {"name": name, "source": source, "form": "unencoded",
                    "entries": [], "rule_ids": rules}
    return None


# ---------------------------------------------------------------- requirements
#
# Half of these results oblige the player to settle something: a skill, a
# technique of the rolled category, a weapon, which distinction. The wizard
# showed the entry's text and recorded none of it, so six characters in the
# archive carry a heritage whose grant never landed — Ichiro Tsutomu rolled
# "+1 Commerce" at question 18 and has Commerce 0.
#
# So each entry also carries `requires`: what the sheet still needs before the
# result is actually on the character. Two things produce them.
#
# The corpus's own structure, where it has any. A sub-table range reading
# `Gain +1 ^"Composition"` names a skill and is read as one — that is most of
# the ranges in the line, and none of it is guessed.
#
# REQUIRES, below, for every entry whose obligation is stated in prose. It is
# deliberately explicit and per entry: a pattern loose enough to catch "select
# one invocation of that ring type" also catches "choose two of your rings",
# and a confidently wrong requirement is worse than none. `sub` says how to
# read that entry's own sub-table, because the ranges are not all skills —
# some name the heirloom, some the technique category, some the spirit's ring.
#
# check_requirements() fails the run on an entry that neither parses nor
# appears here, so a supplement added to the corpus later cannot arrive
# unhandled and unnoticed.
#
# What a requirement means to the wizard:
#   skill        +1 rank in `skill`, or in one of `options`, or in one of the
#                school's starting skills the character has no ranks in
#   technique    learn one, of `rank`, in `category` (or the rolled category,
#                or an invocation of the rolled ring)
#   peculiarity  gain `name`, or one of `options`; `subject` fills an
#                open-ended entry ("Support of [One Group]")
#   item         add `name`, or one of `category`; `held: False` for an
#                heirloom that exists but is lost
#   ring_swap    reduce one ring by 1 to raise another; never above `cap`
#   pick_one     exactly one of `options`, each a requirement in its own right
#   money        the entry pays instead of granting

SKILLS = set(SKILL_LABEL.values())
MARTIAL_ARTS = ["Martial Arts [Melee]", "Martial Arts [Ranged]",
                "Martial Arts [Unarmed]"]
# how the books print a martial art the player picks
CHOOSE_ONE = "Martial Arts [Choose One]"
RINGS = ["Air", "Earth", "Fire", "Water", "Void"]

GAIN_SKILL = re.compile(r'^Gain\s*\+\s*1\s*\^?"?(?P<name>[^"]+?)"?$', re.I)
# a sentence the conversion appended to one range that belongs to all of them
TRAILING = re.compile(
    r"\.\s*(?:Gain \+1 rank|This item is a battlefield heirloom)\.?\s*$", re.I)


def as_skill(text):
    """The requirement in a sub-table range that names a skill, or None."""
    t = clean(TRAILING.sub("", text or "")).rstrip(".")
    m = GAIN_SKILL.match(t)
    if m:
        t = clean(m.group("name")).strip('"')
    else:
        t = ref(t)
    if t == CHOOSE_ONE:
        return {"kind": "skill", "prompt": "Martial art", "options": MARTIAL_ARTS}
    if t in SKILLS:
        return {"kind": "skill", "prompt": "Skill", "skill": t}
    return None


def pec(name, prompt="Advantage", **kw):
    return dict({"kind": "peculiarity", "prompt": prompt, "name": name}, **kw)


REQUIRES = {
    # --- core rulebook: Samurai Heritage Table (p. 96) --------------------
    ("samurai-heritage-table", "Famous Deed"): {
        "sub": "item_category",
        "requires": [{"kind": "item", "prompt": "Family heirloom",
                      "category_from_sub": True,
                      "qualities": {"player": 1, "gm": 1}}]},
    ("samurai-heritage-table", "Glorious Sacrifice"): {
        "sub": "item_category",
        "requires": [{"kind": "item", "prompt": "Lost heirloom", "held": False,
                      "category_from_sub": True,
                      "qualities": {"player": 1, "gm": 1}}]},
    ("samurai-heritage-table", "Stolen Knowledge"): {
        "sub": "technique_category",
        "requires": [{"kind": "technique", "prompt": "Additional technique",
                      "rank": 1, "category_from_sub": True}]},
    ("samurai-heritage-table", "Imperial Heritage"): {
        "requires": [pec("Blessed Lineage")]},
    ("samurai-heritage-table", "Unusual Name Origin"): {
        "requires": [{"kind": "pick_one", "prompt": "One of the two", "options": [
            {"kind": "ring_swap", "prompt": "Reduce one ring, raise another",
             "to": "any", "cap": 3},
            {"kind": "item", "prompt": "Item of rarity 6 or lower",
             "rarity_max": 6}]}]},

    # --- Celestial Realms (p. 141) ----------------------------------------
    ("new-samurai-heritages-celestial-realms",
     "Associated with a Natural Disaster"): {
        "requires": [pec("Whispers of Failure", prompt="Adversity"),
                     {"kind": "ring_swap", "optional": True, "cap": 3,
                      "to": "any", "prompt": "Ring of the disaster"}]},
    ("new-samurai-heritages-celestial-realms", "Mark of the Elements"): {
        "requires": [{"kind": "ring_swap", "optional": True, "cap": 3,
                      "to": "any", "prompt": "Ring of the element"}]},
    ("new-samurai-heritages-celestial-realms", "Sacrifice"): {
        "sub": "item_category",
        "requires": [{"kind": "item", "prompt": "The sacrifice",
                      "category_from_sub": True,
                      "qualities": {"player": 1, "gm": 1}}]},
    ("new-samurai-heritages-celestial-realms", "Spirit of the Phoenix"): {
        "sub": "peculiarity"},
    ("new-samurai-heritages-celestial-realms", "Touched by the Fortunes"): {
        "requires": [pec("Sixth Sense", prompt="Distinction")]},

    # --- Children of the Five Winds (p. 97) -------------------------------
    ("new-samurai-heritages-table", "Ancestral Horse Line"): {
        "sub": "item_name",
        "requires": [{"kind": "item", "prompt": "Warhorse",
                      "name_from_sub": True, "name_suffix": " horse",
                      "custom": True}]},
    ("new-samurai-heritages-table", "Heart of the Horse"): {
        "requires": [{"kind": "item", "prompt": "Horse", "name": "Horse",
                      "custom": True},
                     pec("Karmic Tie", prompt="Distinction")]},
    ("new-samurai-heritages-table", "Knowledge Exchange"): {
        "sub": "technique_category",
        "requires": [{"kind": "technique", "prompt": "Additional technique",
                      "rank": 1, "category_from_sub": True}]},
    ("new-samurai-heritages-table", "Lost Banner"): {
        "requires": [pec("Indomitable Will", prompt="Distinction")]},
    ("new-samurai-heritages-table", "Sacred Wilderness"): {
        "requires": [{"kind": "item", "prompt": "Estate", "name": "Estate",
                      "custom": True,
                      "define": "free food, shelter, and medical care"}]},
    ("new-samurai-heritages-table", "Spirit Companion"): {
        "sub": "ring",
        "requires": [{"kind": "item", "prompt": "Talisman", "custom": True,
                      "name": "Meishōdō talisman",
                      "define": "which talisman, agreed with the GM"},
                     {"kind": "technique", "prompt": "Invocation of that ring",
                      "rank": 1, "category": "invocation",
                      "ring_from_sub": True}]},
    ("new-samurai-heritages-table", "Spiritual Debt"): {
        "sub": "ring",
        "requires": [{"kind": "ring_swap", "optional": True, "cap": 3,
                      "to": "from_sub", "prompt": "The spirit's ring"}]},

    # --- Courts of Stone (p. 104) -----------------------------------------
    ("courts-of-stone-heritages", "Triumph over the Lion"): {
        "sub": "item_category",
        "requires": [{"kind": "item", "prompt": "Family heirloom",
                      "category_from_sub": True,
                      "qualities": {"player": 1, "gm": 1}}]},
    ("courts-of-stone-heritages", "Unforgivable Performance"): {
        "sub": "skill",
        "requires": [pec("Benten's Curse", prompt="Disadvantage")]},
    ("courts-of-stone-heritages", "Triumph During Gempuku"): {
        "requires": [pec("Support of [One Group]", prompt="Distinction",
                         subject="the Kakita Dueling Academy")]},
    ("courts-of-stone-heritages", "Elegant Craftsman"): {
        "requires": [pec("Isolation", prompt="Anxiety"),
                     {"kind": "ring_swap", "optional": True, "cap": 3,
                      "to": ["Fire", "Air"], "prompt": "Raise Fire or Air"}]},

    # --- Fields of Victory (p. 84) ----------------------------------------
    ("fields-of-victory-heritages", "Born on the Battlefield"): {
        "requires": [pec("Guiding Ancestor", prompt="Distinction")]},
    ("fields-of-victory-heritages", "Victory against the Crane"): {
        "sub": "item_category",
        "requires": [{"kind": "item", "prompt": "Family heirloom",
                      "category_from_sub": True,
                      "heirloom": "battlefield"}]},
    ("fields-of-victory-heritages", "Shamed by Defeat"): {
        "requires": [{"kind": "skill", "prompt": "Starting skill at 0 ranks",
                      "from": "school_starting_at_zero"}]},
    ("fields-of-victory-heritages", "Blade of 10,000 Battles"): {
        "requires": [{"kind": "item", "prompt": "Storied weapon",
                      "category": "weapon", "heirloom": "battlefield"}]},
    ("fields-of-victory-heritages", "Lost Heirloom"): {
        "requires": [{"kind": "item", "prompt": "The lost weapon",
                      "category": "weapon", "held": False,
                      "heirloom": "battlefield"}]},
    ("fields-of-victory-heritages", "Selfless Sentinel"): {
        "requires": [pec("Traditional Adherent", prompt="Distinction")]},
    ("fields-of-victory-heritages", "Mighty Conqueror"): {
        "requires": [{"kind": "pick_one", "prompt": "One of the three",
                      "options": [
                          {"kind": "money", "prompt": "Double starting koku",
                           "koku": "double"},
                          {"kind": "item", "prompt": "Item of rarity 6 or lower",
                           "rarity_max": 6, "heirloom": "battlefield"},
                          pec("Glorious Deeds", prompt="Passion")]}]},
    ("fields-of-victory-heritages", "Right Hand of the Emperor"): {
        "requires": [pec("Support of [One Group]", prompt="Distinction",
                         subject_options=["the Seppun family",
                                          "the Otomo family",
                                          "the Miya family",
                                          "the Imperial Legions"])]},

    # --- Shadowlands (p. 96) ----------------------------------------------
    ("shadowlands-heritages", "Blood and Mortar"): {
        "requires": [pec("Blessed Lineage")]},
    # the effect is narrative: the ancestor may still be alive down there
    ("shadowlands-heritages", "Lost in the Darkness"): {"sub": "skill"},
    ("shadowlands-heritages", "Vengeance for the Fallen"): {
        "sub": "skill",
        "requires": [pec("Haunting", prompt="Adversity")]},
    ("shadowlands-heritages", "Tainted Blood"): {
        "requires": [pec("Fallen Ancestor", prompt="Anxiety"),
                     {"kind": "ring_swap", "optional": True, "cap": 3,
                      "to": ["Void"], "prompt": "Raise Void"}]},

    # --- Writ of the Wilds (p. 101) ---------------------------------------
    ("new-samurai-heritages-dragon", "At One with Nature"): {
        "sub": "item"},
    ("new-samurai-heritages-dragon", "Medical Innovator"): {
        "requires": [pec("Knowledgeable Wilderness Guide",
                         prompt="Distinction")]},
    ("new-samurai-heritages-dragon", "Gaijin Consort"): {
        "requires": [pec("Ally [Gaijin Group]", prompt="Distinction",
                         subject_free="the gaijin group")]},
    ("new-samurai-heritages-dragon", "Revered Parent"): {
        "requires": [{"kind": "peculiarity", "prompt": "One distinction",
                      "options": ["Kisshoten’s Blessing", "Famously Lucky"]}]},
    ("new-samurai-heritages-dragon", "Path to Enlightenment"): {
        "requires": [pec("Enlightenment", prompt="Passion")]},
}

# The compendium has three Omamori boons and not this one, though the book puts
# the item on core p. 243. Carried as the book names it, and marked custom so
# the build reports it rather than failing on a name it cannot resolve.
CUSTOM_ITEMS = {"Omamori Boon of Fukurokujin"}

# How a sub-table's ranges are read into requirements. "skill" is the default
# and is proved rather than assumed: every range has to parse as one.
def ref(text):
    """The name inside a corpus reference: `^"Finger of Jade"` -> Finger of Jade."""
    t = clean(text)
    m = re.match(r'^\^?"(?P<name>.*)"$', t)
    return clean(m.group("name")) if m else t.strip('"')


SUB_READERS = {
    "skill": as_skill,
    "peculiarity": lambda t: pec(ref(t), prompt="Advantage"),
    "item": lambda t: {"kind": "item", "prompt": "Item", "name": ref(t),
                       "custom": ref(t) in CUSTOM_ITEMS},
    # these are read by an entry-level requirement, not on their own
    "item_category": lambda t: None,
    "item_name": lambda t: None,
    "technique_category": lambda t: None,
    "ring": lambda t: None,
}


def attach_requirements(key, table):
    """Give every entry its `requires`, and each sub-range its own. -> problems"""
    problems = []
    for e in table["entries"]:
        spec = REQUIRES.get((key, e["name"]), {})
        e["requires"] = [dict(r) for r in spec.get("requires", [])]
        sub = e.get("sub_table")
        how = spec.get("sub", "skill")
        if sub:
            reader = SUB_READERS[how]
            for r in sub["ranges"]:
                req = reader(r["text"])
                r["requires"] = [req] if req else []
            if how == "skill" and not all(r["requires"] for r in sub["ranges"]):
                unread = [r["text"] for r in sub["ranges"] if not r["requires"]]
                problems.append(
                    f"{table['name']} / {e['name']}: sub-table range(s) neither "
                    f"a skill nor declared in REQUIRES — {unread!r}")
            e["sub_kind"] = how
        elif how != "skill":
            problems.append(f"{table['name']} / {e['name']}: REQUIRES declares "
                            f"sub={how!r} but the entry has no sub-table")
        # An effect that grants something but produces no requirement is the
        # exact failure this is here to catch, so say so rather than ship it.
        if e.get("effect") and not e["requires"] and how in ("skill",):
            if (key, e["name"]) not in REQUIRES:
                problems.append(
                    f"{table['name']} / {e['name']}: has an EFFECT and no "
                    f"requirement — {e['effect'][:90]!r}")
    return problems


def errata_touching_heritages(names):
    """Errata that correct a heritage table or one of its entries.

    This reads the corpus files as written, not the composed corpus, which is
    only safe while no errata corrects a heritage — and today none does. Rather
    than leave that as luck, it is checked: the day an errata does correct one,
    this says so instead of quietly reading the pre-errata text.
    """
    hits = []
    for path in sorted(glob.glob(os.path.join(DSL, "*errata*.ttrpg"))):
        text = open(path, encoding="utf-8").read()
        for m in re.finditer(r'(?:MODIFY|OVERRIDE)\s+\^"([^"]+)"', text):
            if m.group(1) in names:
                hits.append((os.path.basename(path), m.group(1)))
    return hits


def main():
    if not os.path.isdir(DSL):
        sys.exit(f"DSL corpus not found at {DSL} — set L5R_DSL")
    tables = {}
    for path in sorted(os.listdir(DSL)):
        if not path.endswith(".ttrpg"):
            continue
        text = open(os.path.join(DSL, path), encoding="utf-8").read()
        for m in TABLE_RE.finditer(text):
            name = m.group("name")
            body, _ = block(text, m.end() - 1)
            table = parse_table(name, body, path)
            if not table:
                continue
            if table["form"] != "unencoded" and len(table["entries"]) < 2:
                continue
            key = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
            tables[key] = table

    problems, nreq = [], 0
    for key, table in tables.items():
        problems += attach_requirements(key, table)
        for e in table["entries"]:
            nreq += len(e["requires"]) + sum(
                len(r["requires"]) for r in
                (e.get("sub_table") or {"ranges": []})["ranges"])

    with open(OUT, "w") as f:
        f.write("window.L5R_HERITAGES = ")
        json.dump(tables, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")

    print(f"{len(tables)} heritage tables -> {os.path.relpath(OUT, ROOT)} "
          f"({os.path.getsize(OUT)/1024:.1f} KB)")
    nentries = 0
    for k, t in tables.items():
        subs = sum(1 for e in t["entries"] if e.get("sub_table"))
        reqs = sum(1 for e in t["entries"] if e["requires"] or
                   any(r["requires"] for r in
                       (e.get("sub_table") or {"ranges": []})["ranges"]))
        nentries += len(t["entries"])
        note = ("  <- NOT ENCODED in the DSL corpus: rule ids only"
                if t["form"] == "unencoded" else "")
        print(f"   {len(t['entries']):3} entries  {subs:2} with sub-tables  "
              f"{reqs:2} that grant something  [{t['form']:9}]  {t['name']}{note}")

    # A sub-table with one range where its siblings have four or five is a
    # damaged conversion, not a short table. Said out loud because the wizard
    # can only offer what the corpus states.
    for k, t in tables.items():
        for e in t["entries"]:
            sub = e.get("sub_table")
            if sub and len(sub["ranges"]) < 2:
                print(f"   DAMAGED sub-table: {t['name']} / {e['name']} has "
                      f"{len(sub['ranges'])} range — {sub['ranges'][0]['text']!r}")

    print(f"requirements: {nreq} across {nentries} entries")

    names = {t["name"] for t in tables.values()} | {
        e["name"] for t in tables.values() for e in t["entries"]}
    touched = errata_touching_heritages(names)
    if touched:
        problems.append(
            "an errata corrects a heritage, and this reads the corpus files as "
            "written rather than the composed corpus: " +
            ", ".join(f"{f} -> {n}" for f, n in touched) +
            ". Read pipeline/dsl/l5r5e-resolved.ttrpg instead.")

    if problems:
        print(f"UNHANDLED heritage entries ({len(problems)}):")
        for p_ in problems:
            print("   ", p_)
        sys.exit(1)


if __name__ == "__main__":
    main()
