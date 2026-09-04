#!/usr/bin/env python3
"""What Create School needs from the DSL corpus.

Path of Waves chapter 2 (pages 76-84) gives a nine-step system for building a
school, and the corpus states all of it: the framework's nine steps in
l5r5e-0.4-path-of-waves-character-creation.lore ("## Building a School"), and
Tables 2-3 through 2-11 as a DEF tree under ^"School Building System" in
l5r5e-0.4-path-of-waves-systems.ttrpg.

    python3 scripts/school_tables.py

Reads pipeline/dsl/l5r5e-resolved.ttrpg and the Path of Waves lore, and writes
data/chargen/schoolbuild.js (window.L5R_SCHOOLBUILD).

Almost every table is keyed by the school's ROLE, and the seven roles are
Table 2-3's own list -- so the tool asks for a role first and everything after
follows from it. Three tables key on something else: 2-6 on the trait a school
is known for, 2-9 is a worked example rather than a table to pick from, and
2-4 and 2-10 offer templates whose Role may be "Any".

WHAT THE STEPS REQUIRE, as the corpus states it, so the tool can hold it:

    step 6   open access to rituals plus two other common categories, from
             kata / kihō / invocations / shūji. ninjutsu and mahō are
             "exceptionally rare and should only be given in unique cases",
             and a heretical school "might lack rituals".
    step 7   ranks 1-5 each hold exactly seven advances: one skill group,
             three skills, one technique group, two techniques. The three
             skills "should not be from the skill group selected for that
             rank". Rank 6 holds the mastery ability and nothing else.

Those two are emitted as `rules` rather than left in prose, because they are
what a tool can check.
"""
import json, os, re, sys, unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RESOLVED = os.path.join(ROOT, "pipeline", "dsl", "l5r5e-resolved.ttrpg")
LORE = os.path.expanduser(
    "~/Working/Titterpig DSL/titterpig-dsl-l5r5e/0.4/"
    "l5r5e-0.4-path-of-waves-character-creation.lore")
OUT = os.path.join(ROOT, "data", "chargen", "schoolbuild.js")

DEF_RE = re.compile(r'(?:#(?P<hash>\S+)\s+)?\^"(?P<name>[^"]+)"\s+DEF\s*\{')
PROP_RE = re.compile(r'\^"([^"]+)"\s+(?:STRING|INTEGER)\s*(?:DEFAULT\s+)?'
                     r'(?:"((?:[^"\\]|\\.)*)"|(-?\d+))')

# The tables the system states, and what each is keyed by. Named so a table
# that stops converting fails the run instead of leaving a screen empty.
TABLES = {
    "table23rolebreakdown": "role",
    "table24genericschoolabilities": "template",
    "table25suggestedfirstringbonuses": "role",
    "table26suggestedsecondringbonus": "ring",
    "table27skillchoices": "role",
    "table28startingtechniques": "role",
    "table29morgansrank1samplecurriculum": "example",
    "table210genericmasteryabilities": "template",
    "table211suggestedstartingoutfits": "role",
}

# Step 6's categories, as the corpus names them. Rituals is the one a school
# has by default; the two chosen alongside it come from the common set.
TECHNIQUE_ACCESS = {
    "default": ["Rituals"],
    "common": ["Kata", "Kihō", "Invocations", "Shūji"],
    "choose_from_common": 2,
    "rare": ["Ninjutsu", "Mahō"],
}

# Step 7's shape for ranks 1-5.
CURRICULUM_SHAPE = [
    {"kind": "Skill Group", "n": 1},
    {"kind": "Skill", "n": 3},
    {"kind": "Technique Group", "n": 1},
    {"kind": "Technique", "n": 2},
]


def norm(s):
    s = unicodedata.normalize("NFKD", str(s or ""))
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", "", s.lower())


def unescape(s):
    return s.replace('\\"', '"') if isinstance(s, str) else s


def close_brace(text, i):
    d = 0
    while i < len(text):
        if text[i] == "{":
            d += 1
        elif text[i] == "}":
            d -= 1
            if d == 0:
                return i + 1
        i += 1
    return len(text)


def parse_def(text, m):
    """One DEF with its own properties and its child DEFs, children masked out
    of the parent's property scan so a parent does not inherit them."""
    open_i = text.index("{", m.end() - 1)
    end = close_brace(text, open_i)
    body = text[open_i + 1:end - 1]

    children, spans = [], []
    i = 0
    while True:
        cm = DEF_RE.search(body, i)
        if not cm:
            break
        c_open = body.index("{", cm.end() - 1)
        c_end = close_brace(body, c_open)
        children.append(parse_def(body, cm))
        spans.append((cm.start(), c_end))
        i = c_end
    own = body
    for a, b in reversed(spans):
        own = own[:a] + own[b:]

    props = {}
    for pm in PROP_RE.finditer(own):
        v = pm.group(2) if pm.group(2) is not None else int(pm.group(3))
        props[pm.group(1)] = unescape(v)

    notes = [ln.strip().lstrip("#").strip() for ln in own.split("\n")
             if ln.strip().startswith("#") and not re.match(r"^#\S{16,}",
                                                            ln.strip())]
    notes = [n for n in notes if n and not re.match(r"^L5R\w*\d*:", n)]

    return {"name": m.group("name"), "hash": m.group("hash"),
            "note": " ".join(notes) or None, "properties": props,
            "entries": children}


def system(text):
    m = DEF_RE.search(text, text.index('^"School Building System" DEF') - 40)
    if not m:
        sys.exit('FAIL — ^"School Building System" is not in the corpus')
    return parse_def(text, m)


def steps():
    """The nine steps, from the lore's own headings."""
    if not os.path.exists(LORE):
        sys.exit(f"missing {LORE}")
    text = open(LORE, encoding="utf-8").read()
    m = re.search(r"^##\s+Building a School\s*$", text, re.M)
    if not m:
        sys.exit('FAIL — "## Building a School" is not in the lore')
    tail = text[m.end():]
    nxt = re.search(r"^##\s+\S", tail, re.M)
    if nxt:
        tail = tail[:nxt.start()]
    out = []
    for sm in re.finditer(r"^###\s+Step\s+(\d+):\s*(.+?)\s*$", tail,
                          re.M | re.I):
        out.append({"n": int(sm.group(1)), "title": sm.group(2).strip()})
    return out


def main():
    if not os.path.exists(RESOLVED):
        sys.exit(f"missing {RESOLVED} — run scripts/dsl_rules_text.py first")
    text = open(RESOLVED, encoding="utf-8").read()

    sys_def = system(text)
    tables = {}
    for e in sys_def["entries"]:
        k = norm(e["name"])
        if k in TABLES:
            tables[k] = {"name": e["name"], "keyed_by": TABLES[k],
                         "note": e["note"],
                         "entries": [{"name": c["name"], "note": c["note"],
                                      **c["properties"]}
                                     for c in e["entries"]]}

    missing = [k for k in TABLES if k not in tables]
    if missing:
        sys.exit(f"FAIL — {len(missing)} of the {len(TABLES)} school-building "
                 f"tables are not in the corpus: " + ", ".join(missing))
    for k, t in tables.items():
        if not t["entries"]:
            sys.exit(f"FAIL — {t['name']} has no entries")

    st = steps()
    if len(st) != 9:
        sys.exit(f"FAIL — the lore states {len(st)} of the 9 steps of "
                 f"'Building a School': "
                 + ", ".join(f"{x['n']}:{x['title']}" for x in st))
    if [x["n"] for x in st] != list(range(1, 10)):
        sys.exit("FAIL — the nine steps are not numbered 1-9: "
                 + ", ".join(str(x["n"]) for x in st))

    roles = [e["name"] for e in tables["table23rolebreakdown"]["entries"]]
    if len(roles) != 7:
        sys.exit(f"FAIL — Table 2-3 states {len(roles)} roles; the book prints 7")

    # Every role-keyed table must cover every role, or a school in that role
    # reaches a screen with nothing on it. Two tables key by a role *pair*
    # ("Courtier or Shinobi"), which is the book's own wording, so a role is
    # covered when it appears in any key.
    for k, t in tables.items():
        if t["keyed_by"] != "role":
            continue
        keys = " | ".join(e["name"] for e in t["entries"])
        gap = [r for r in roles if r.lower() not in keys.lower()]
        if gap:
            sys.exit(f"FAIL — {t['name']} says nothing for "
                     f"{len(gap)} role(s): " + ", ".join(gap))

    doc = {
        "steps": st,
        "roles": tables["table23rolebreakdown"]["entries"],
        "tables": tables,
        "technique_access": TECHNIQUE_ACCESS,
        "curriculum": {"ranks": 5, "shape": CURRICULUM_SHAPE,
                       "advances_per_rank": sum(x["n"]
                                                for x in CURRICULUM_SHAPE),
                       "mastery_rank": 6},
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write("window.L5R_SCHOOLBUILD = ")
        json.dump(doc, fh, ensure_ascii=False, sort_keys=True)
        fh.write(";\n")

    print(f"{len(st)} steps, {len(roles)} roles, {len(tables)} tables "
          f"-> {os.path.relpath(OUT, ROOT)} "
          f"({os.path.getsize(OUT)/1024:.1f} KB)")
    print(f"   curriculum: ranks 1-5 x "
          f"{doc['curriculum']['advances_per_rank']} advances "
          + ", ".join(f"{x['n']} {x['kind'].lower()}"
                      + ("s" if x["n"] > 1 else "")
                      for x in CURRICULUM_SHAPE)
          + f"; mastery at rank {doc['curriculum']['mastery_rank']}")
    for k in ("table24genericschoolabilities", "table210genericmasteryabilities",
              "table27skillchoices"):
        t = tables[k]
        print(f"   {t['name']}: {len(t['entries'])} entries")
    return 0


if __name__ == "__main__":
    sys.exit(main())
