#!/usr/bin/env python3
"""What Create Court needs from the DSL corpus.

Courts of Stone gives a GM a seven-step framework for assembling a court: sketch
the movers, seed the conflicts among them, create secondaries, then bring the
players in to assign traits, bonds and personal details, and finally retouch and
finalise. The framework itself is in
l5r5e-0.4-courts-of-stone-courts.lore ("Assembling a Court in Seven Steps").

Two things in the corpus are enumerable sets the tool can offer, and this reads
them:

    NPC templates       an overlay on a base NPC profile -- what step 7 uses to
                        bring a profile up to the party's rank
    the need tiers       the five levels of NPC motivation the book adapts from
                        Maslow, for writing a ninjo that is not just "wants power"

Everything else the tool needs is already on the site: advantages and
disadvantages in data/chargen/peculiarities.js, and bonds and the NPC library in
data/catalog.js, which the Creator already loads.

    python3 scripts/court_tables.py

Reads pipeline/dsl/l5r5e-resolved.ttrpg -- the corpus after errata, composed by
titterpig-synthesist -- and nothing else. Writes data/chargen/court.js
(window.L5R_COURT).

Two properties of the same template mean the same thing under different labels,
because two converters wrote them:

    ^"Replace Advantages"              STRING "0-2: Fights Dirty (Fire) ..."
    ^"Advantages (Add or Replace 0-2)" STRING "Eye for Detail (Air) ..."

so the labels are kept as the corpus states them and normalised only into a
role (advantages / disadvantages / techniques / demeanor / rings / skills /
rank), never rewritten. A template whose properties fit no role is reported
rather than dropped.

The Court Sheet's twelve fields are read from the corpus too, and gated: every
field the book's sheet names must map to something the tool actually keeps.
That gate is what caught the tool having no "Prior Offenses by the PCs" -- a
field with real mechanics (four slots; fill all four and the NPC's current
opposition becomes the last PC to offend them) that stayed invisible while the
corpus stated only two of the twelve.

WHAT THIS STILL DOES NOT HAVE: the book's own example movers (7 bullets) and its
example giri, absent from the corpus because the conversion drops the source's
"$"-marked bullet lists -- a defect Jordan has deliberately parked. Nothing is
offered in their place; the need tiers stand in as the prompt for a ninjo.
"""
import json, os, re, sys, unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RESOLVED = os.path.join(ROOT, "pipeline", "dsl", "l5r5e-resolved.ttrpg")
LORE = os.path.expanduser(
    "~/Working/Titterpig DSL/titterpig-dsl-l5r5e/0.4/"
    "l5r5e-0.4-courts-of-stone-courts.lore")
OUT = os.path.join(ROOT, "data", "chargen", "court.js")

DEF_RE = re.compile(r'(?:#(?P<hash>\S+)\s+)?\^"(?P<name>[^"]+)"\s+DEF\s*\{')

# Which role a template property plays, whatever the corpus calls it. Matched on
# the normalised label, longest key first, so "Replace Advantages" and
# "Advantages (Add or Replace 0-2)" land on the same role without either being
# rewritten.
ROLES = [
    ("baseprofile", "base_profile"),
    ("description", "description"),
    ("combatconflictrankmodifier", "rank"),
    ("intrigueconflictrankmodifier", "rank"),
    ("conflictrankmodifier", "rank"),
    ("combatrankmodifier", "rank"),
    ("intriguerankmodifier", "rank"),
    ("rankmodifier", "rank"),
    ("ringmodifier", "rings"),
    ("skillmodifier", "skills"),
    # "disadvantage" BEFORE "advantage": the normalised label of
    # "Replace Disadvantages" contains "advantages", so checking advantages
    # first filed every disadvantage as an advantage. Singular, because one
    # template states ^"Disadvantage (required)".
    ("disadvantage", "disadvantages"),
    ("advantage", "advantages"),
    ("technique", "techniques"),
    ("demeanor", "demeanor"),
    ("composure", "composure"),
    ("equipment", "equipment"),
]

# The five tiers of need the book adapts, in the order it presents them, each
# named by the corpus's own wording in "Developing NPC Motivations through
# Needs". These are the tier names and what the corpus says each turns on --
# the prompt a GM answers to write a ninjo, not a substitute for the section.
NEED_TIERS = [
    ("Physiological", "food and water, shelter, warmth, a place to sleep"),
    ("Safety", "health, finances, immediate surroundings -- and in Rokugan, "
                "curses, vengeful spirits, offended gods and ancestors"),
    ("Social belonging", "familiar and intimate relationships, and membership "
                          "in larger social organisations"),
    ("Glory", "fame and reputation -- as much about changing perception as "
               "changing reality"),
    ("Destiny or Enlightenment", "a place in the Celestial Order, or release "
                                  "from it"),
]


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


def norm(s):
    """Fold to bare letters and digits, decomposing accents first.

    Without the decomposition "Ninjō" folds to "ninj" -- the macron is not
    [a-z0-9], so it is dropped along with the o it sits on. Same normaliser as
    build.py's.
    """
    s = unicodedata.normalize("NFKD", str(s or ""))
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", "", s.lower())


def unescape(s):
    return s.replace('\\"', '"') if isinstance(s, str) else s


def role_of(label):
    n = norm(label)
    for key, role in ROLES:
        if key in n:
            return role
    return None


def templates(text):
    """Every DEF that APPLIES TO ^"NPC Template", with its properties.

    The discriminator is the APPLIES TO, not the name: "Artist Template" and
    "Desperate NPC Template" are both templates and only one says so in its
    name.
    """
    out, unplaced = {}, []
    for m in DEF_RE.finditer(text):
        name = m.group("name")
        if name == "NPC Template":
            continue                      # the type itself, not a template
        try:
            body, _ = block(text, m.end() - 1)
        except ValueError:
            continue
        if not re.search(r'APPLIES TO\s*\[\s*\^"NPC Template"\s*\]', body):
            continue
        props = {}
        for pm in re.finditer(
                r'\^"([^"]+)"\s*(?:STRING|INTEGER)?\s*(?:DEFAULT\s+)?'
                r'(?:"((?:[^"\\]|\\.)*)"|(\d+))', body):
            label = pm.group(1)
            val = pm.group(2) if pm.group(2) is not None else pm.group(3)
            props[label] = unescape(val)
        if not props:
            continue
        placed = {}
        for label, val in props.items():
            role = role_of(label)
            if role is None:
                unplaced.append((name, label))
                continue
            # two properties can share a role (Combat and Intrigue rank both
            # modify rank); keep both, labelled
            placed.setdefault(role, []).append({"label": label, "value": val})
        out[norm(name)] = {
            "name": name,
            "hash": m.group("hash"),
            "properties": [{"label": k, "value": v} for k, v in props.items()],
            "roles": placed,
        }
    return out, unplaced


# Which field on a court NPC holds each of the Court Sheet's twelve. Named here
# so a field the corpus states and the tool does not keep fails the run rather
# than going unnoticed -- which is how "Prior Offenses by the PCs" was missed.
SHEET_FIELDS = {
    "name": "name",
    "role": "role",
    "moversecondarybox": "tier",
    "ninjo": "ninjo",
    "giri": "giri",
    "advantages": "advantage",
    "disadvantages": "disadvantage",
    "bonds": "bonds",
    "currentheirifany": "heir",
    "currentgoal": "goal",
    "currentopposition": "opposition",
    "prioroffensesbythepcs": "offenses",
}


def court_sheet():
    """The Court Sheet's fields, as the corpus states them.

    A "- Label: what it is" list under the "### The Court Sheet" heading. The
    book prints twelve; the corpus carried two until 2026-09-04, and both of
    those sat above the heading rather than under it, so the count is checked.
    """
    if not os.path.exists(LORE):
        sys.exit("missing " + LORE)
    text = open(LORE, encoding="utf-8").read()
    m = re.search(r"^###\s+The Court Sheet\s*$", text, re.M)
    if not m:
        return []
    tail = text[m.end():]
    nxt = re.search(r"^#{1,4}\s+\S", tail, re.M)
    if nxt:
        tail = tail[:nxt.start()]
    out = []
    for line in tail.split("\n"):
        fm = re.match(r"^-\s+([^:]+):\s*(.*)$", line.strip())
        if fm:
            out.append({"label": fm.group(1).strip(),
                        "about": fm.group(2).strip(),
                        "holds": SHEET_FIELDS.get(norm(fm.group(1)))})
    return out


def sentence_case(s):
    s = " ".join(str(s or "").split()).lower()
    return s[:1].upper() + s[1:]


def framework():
    """The seven steps, as headings and who does each one.

    Only the step's name and whether it is a GM step or a GM-and-players step --
    both stated in the heading the corpus carries. The instructions themselves
    stay in the book; the tool states what each step has to produce, which is
    what a tool is for.
    """
    if not os.path.exists(LORE):
        sys.exit(f"missing {LORE}")
    text = open(LORE, encoding="utf-8").read()
    steps = []
    for m in re.finditer(
            r"^###\s+STEP\s+(\d+):\s+(.+?)\s*\((GM|PLAYERS AND GM|GM AND PLAYERS)\)\s*$",
            text, re.M | re.I):
        steps.append({
            "n": int(m.group(1)),
            # the corpus carries the heading shouted ("SKETCH OUT THE
            # MOVERS"); .title() gives "Sketch Out The Movers", so sentence
            # case, first word capitalised
            "title": sentence_case(m.group(2)),
            "who": "gm" if m.group(3).strip().upper() == "GM" else "table",
        })
    return steps


def main():
    if not os.path.exists(RESOLVED):
        sys.exit(f"missing {RESOLVED} — run scripts/dsl_rules_text.py first")
    text = open(RESOLVED, encoding="utf-8").read()

    tpl, unplaced = templates(text)
    steps = framework()
    sheet = court_sheet()

    # "advantages" is a substring of "disadvantages", so the order of ROLES is
    # load-bearing and a reordering would silently mis-file every disadvantage.
    # Checked here rather than trusted.
    for t in tpl.values():
        for role, entries in t["roles"].items():
            for e in entries:
                n = norm(e["label"])
                if role == "advantages" and "disadvantage" in n:
                    sys.exit(f"FAIL — {t['name']}: {e['label']!r} filed as an "
                             f"advantage")
                if role == "disadvantages" and "disadvantage" not in n:
                    sys.exit(f"FAIL — {t['name']}: {e['label']!r} filed as a "
                             f"disadvantage")

    # The framework is seven steps. Fewer means the headings changed shape or
    # the section did not convert, and the tool would silently offer a subset.
    if len(steps) != 7:
        sys.exit(f"FAIL — the corpus states {len(steps)} of the 7 steps of "
                 f"'Assembling a Court in Seven Steps'; refusing to write a "
                 f"partial framework. Found: "
                 + ", ".join(f"{s['n']}:{s['title']}" for s in steps))
    if [s["n"] for s in steps] != list(range(1, 8)):
        sys.exit("FAIL — the seven steps are not numbered 1-7: "
                 + ", ".join(str(s["n"]) for s in steps))
    if not tpl:
        sys.exit("FAIL — no NPC templates found in the resolved corpus")

    # The book's sheet is twelve fields. Fewer means the section did not fully
    # convert (it held two until 2026-09-04); a field with no `holds` means the
    # tool keeps nothing for something the sheet asks for.
    if len(sheet) != 12:
        sys.exit("FAIL — the corpus states %d of the Court Sheet's 12 fields: %s"
                 % (len(sheet), ", ".join(f["label"] for f in sheet)))
    orphan = [f["label"] for f in sheet if not f["holds"]]
    if orphan:
        sys.exit("FAIL — %d Court Sheet field(s) the tool keeps nothing for: %s"
                 ". Add them to the court NPC and to SHEET_FIELDS."
                 % (len(orphan), ", ".join(orphan)))

    doc = {
        "steps": steps,
        "needs": [{"tier": t, "turns_on": w} for t, w in NEED_TIERS],
        "templates": tpl,
        "sheet": sheet,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write("window.L5R_COURT = ")
        json.dump(doc, fh, ensure_ascii=False, sort_keys=True)
        fh.write(";\n")

    gm = sum(1 for s in steps if s["who"] == "gm")
    print(f"{len(steps)} steps ({gm} GM, {len(steps)-gm} with the players), "
          f"{len(tpl)} NPC templates, {len(NEED_TIERS)} need tiers, "
          f"{len(sheet)} sheet fields "
          f"-> {os.path.relpath(OUT, ROOT)} "
          f"({os.path.getsize(OUT)/1024:.1f} KB)")
    noroles = sorted(t["name"] for t in tpl.values()
                     if not set(t["roles"]) - {"base_profile", "description"})
    if noroles:
        print(f"   FLAG — no modifiers stated for {len(noroles)}: "
              + ", ".join(noroles))
    if unplaced:
        seen = sorted({lbl for _, lbl in unplaced})
        print(f"   FLAG — {len(unplaced)} template properties fit no known "
              f"role and are carried unplaced ({len(seen)} distinct): "
              + ", ".join(seen[:8]) + ("…" if len(seen) > 8 else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
