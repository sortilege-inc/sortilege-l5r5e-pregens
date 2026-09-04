#!/usr/bin/env python3
"""Questions 1 and 2, from the corpus, in the shape the Creator computes with.

Core answers them with a clan and a family; Path of Waves and Writ of the Wilds
with a region and an upbringing. This generates the family and the two
non-core sets — all of them grant rings, skills, glory, status and wealth the
same way, so one reader covers them.

Path of Waves and Writ of the Wilds replace the core's first two questions:
question 1 asks a region instead of a clan, question 2 an upbringing instead of
a family (the corpus says so in as many words, at the head of
l5r5e-0.4-path-of-waves-character.ttrpg). Both grant rings, skills, glory,
status and starting wealth exactly as a clan and a family do.

    python3 scripts/origin_tables.py

Reads pipeline/dsl/l5r5e-resolved.json -- the composed corpus -- and writes
data/chargen/regions.js (window.L5R_REGIONS) and
data/chargen/upbringings.js (window.L5R_UPBRINGINGS).

WHY THIS EXISTS. Both files were previously hand-written and outside the
pipeline, and they had flattened every grant to a display string:

    "ring_increase": "+1 Earth or +1 Void"
    "skill_increases": "+1 Labor, +1 Seafaring or +1 Survival"

The Creator's computed() adds a clan's and a family's grants by reading objects
({"Earth": 1}, or a {"_choose": ...} the player resolves). It cannot read those
strings, so it silently added nothing: a Path of Waves character got no rings,
no skills, no glory, no status and no wealth from questions 1 and 2. Reported
by Jordan, 2026-09-03.

So this emits the same object shape clans.js and families.js use, and keeps the
string alongside as `*_label` for the picker to display. Two properties that
mean the same thing carry different names in the corpus -- a region states
^"Skill Increase", an upbringing ^"Skill Increases" -- and both are read.

Fallen Noble is the one that is not a flat grant: the corpus states it as
FROM_CLAN with a FALLBACK, meaning a fallen noble may take the ring and skill
increases of a clan they name, or fall back to a free choice. The fallback is
emitted as the choice it is, and the from-clan alternative is carried in
`from_clan` so the Creator can offer it rather than dropping it. The previous
hand-written file had this entry's grants as empty strings.
"""
import json, os, re, sys, unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RESOLVED = os.path.join(ROOT, "pipeline", "dsl", "l5r5e-resolved.json")
OUT_REGION = os.path.join(ROOT, "data", "chargen", "regions.js")
OUT_UPBRINGING = os.path.join(ROOT, "data", "chargen", "upbringings.js")
OUT_FAMILY = os.path.join(ROOT, "data", "chargen", "families.js")
OUT_CLAN = os.path.join(ROOT, "data", "chargen", "clans.js")
OUT_SCHOOL = os.path.join(ROOT, "data", "chargen", "schools.js")

# The books that reword questions 1 and 2, and the Creator mode each drives.
BOOKS = {"path-of-waves": "pow", "writ-of-wilds": "wow"}

CHOOSE_HEAD = re.compile(
    r"CHOOSE\s+(?P<distinct>DISTINCT\s+)?(?P<n>\d+)\s*\[")
NAME_RE = re.compile(r'\^"([^"]+)"')


def norm(s):
    """Fold a name to bare letters, so "Bu" and "bu" are one denomination."""
    s = unicodedata.normalize("NFKD", str(s or ""))
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", "", s.lower())


def close_bracket(text, at):
    """The index of the ] that closes the [ at `at`, ignoring quoted ones.

    A skill option is ^"Martial Arts [Melee]", so a naive negated-] class stops
    inside the first option name and the list is silently truncated -- Fallen
    Noble's 24 skills came out as 11 that way. Same trap as close_bracket() in
    scripts/curricula.py.
    """
    depth, i, quoted = 0, at, False
    while i < len(text):
        c = text[i]
        if c == '"':
            quoted = not quoted
        elif not quoted and c == "[":
            depth += 1
        elif not quoted and c == "]":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return len(text)


def defs(node):
    """Every DEF in the document, however deeply nested."""
    if isinstance(node, dict):
        if node.get("kind") == "def" and node.get("name"):
            yield node
        for v in node.values():
            if isinstance(v, (dict, list)):
                yield from defs(v)
    elif isinstance(node, list):
        for v in node:
            yield from defs(v)


def prop(d, *names):
    for p in d.get("properties") or []:
        if p.get("name") in names:
            return p
    return None


def props(d, *names):
    """Every property of a name, in order. ^"Item" repeats — Fallen Noble has
    two — so indexing the first would silently drop the rest."""
    return [p for p in d.get("properties") or [] if p.get("name") in names]


def nested_map(p):
    """A DEF property's nested name -> value, as strings."""
    out = {}
    for n in (p or {}).get("nested") or []:
        if n.get("name") is not None:
            out[n["name"]] = n.get("value")
    return out


def choose_from(raw):
    """A CHOOSE clause written out longhand, as the object clans.js uses."""
    raw = raw or ""
    m = CHOOSE_HEAD.search(raw)
    if not m:
        return None
    lo = raw.index("[", m.end() - 1)
    hi = close_bracket(raw, lo)
    opts = NAME_RE.findall(raw[lo:hi])
    if not opts:
        return None
    tail = re.match(r"\s*(INTEGER|STRING)?\s*(-?\d+)?", raw[hi + 1:])
    return {"_choose": {
        "_type": "choose", "n": int(m.group("n")),
        "distinct": bool(m.group("distinct")), "options": opts,
        "yield_type": (tail and tail.group(1)) or "INTEGER",
        "yield_value": int(tail.group(2)) if tail and tail.group(2) else 1}}


def grants(p):
    """A "Ring Increase" / "Skill Increases" property, as an object.

    Three shapes appear, and all three are in use:
        DEF { ^"Air" INTEGER 1 }                     a flat grant
        DEF { CHOOSE 1 [^"Earth", ^"Water"] ... }    a choice
        DEF { ^"Labor" INTEGER 1  CHOOSE 1 [...] }   both at once
        STRING "+1 Commerce"                          written out in prose
    A property carrying both is returned with the flat parts as keys and the
    choice under _choose, which is how the Creator's addRing/addSkills already
    reads a family.
    """
    if not p:
        return None, None
    if p.get("type") == "STRING":
        # "+1 Commerce", "+2 Labor, +1 Survival"; a default sits on a modifier
        out, label = {}, p.get("value") or next(
            (m.get("value") for m in (p.get("modifiers") or [])
             if m.get("kind") == "DEFAULT"), "") or ""
        for m in re.finditer(r"\+(\d+)\s+([A-Za-z][A-Za-z \[\]]*?)(?=,|$| or )",
                             label):
            out[m.group(2).strip()] = int(m.group(1))
        return (out or None), label
    if p.get("type") != "DEF":
        return None, None

    flat, choice = {}, None
    for n in p.get("nested") or []:
        if n.get("raw"):
            c = choose_from(n["raw"])
            if c:
                choice = c["_choose"]
            continue
        if n.get("name") and n.get("value") is not None:
            try:
                flat[n["name"]] = int(n["value"])
            except (TypeError, ValueError):
                flat[n["name"]] = n["value"]
    out = dict(flat)
    if choice:
        out["_choose"] = choice
    if not out:
        return None, None

    bits = ["+" + str(v) + " " + k for k, v in flat.items()]
    if choice:
        bits.append(" or ".join("+" + str(choice["yield_value"]) + " " + o
                                for o in choice["options"])
                    if choice["n"] == 1
                    else "choose " + str(choice["n"]) + " of " +
                         (", ".join(choice["options"])
                          if len(choice["options"]) <= 6
                          else "any " + str(len(choice["options"])) + " skills"))
    return out, ", ".join(bits)


def wealth(d):
    """Starting wealth and items, from the corpus's structured properties.

    ^"Wealth" is money and names its own denomination; ^"Item" is not money and
    repeats. Returns (coins, items, label, stated, unreadable).

    Coin stays in the denominations the corpus states. It used to also come
    back as a koku equivalent, which the Creator then summed -- and a koku
    total cannot hold Peasant Family's 10 zeni without calling it 0.2 of a
    coin. Consumers add one denomination at a time now and carry nothing into
    the next, so nothing wants the float.

    An item's Description may state what it is worth -- "An heirloom worth 3
    koku" -- which is an appraisal, not coin in hand, so it is never added to
    the total.
    """
    coins = {"koku": 0, "bu": 0, "zeni": 0}
    items, bits, unknown = [], [], []

    wnodes = props(d, "Wealth")
    inodes = props(d, "Item")

    for w in wnodes:
        if not (w.get("nested") or []):
            continue                      # the inherited schema declaration
        m = nested_map(w)
        try:
            count = int(m.get("Count"))
        except (TypeError, ValueError):
            unknown.append(f"Wealth with no readable Count: {m}")
            continue
        kind = str(m.get("Type") or "").strip().lower()
        if kind not in coins:
            unknown.append(f"Wealth in an unknown denomination {kind!r}")
            continue
        coins[kind] += count
        bits.append(f"{count} {kind}")

    for it in inodes:
        # A DEF with no nested at all is the metatype's own schema declaration
        # -- core-character.ttrpg:212 declares ^"Item" DEF { } on ^"Family" as
        # "zero or more", and every family EXTENDS it, so the resolved JSON
        # carries an empty Item on all forty-one of them. That is inheritance,
        # not data. A node that HAS a body but no Description is a real defect.
        if not (it.get("nested") or []):
            continue
        m = nested_map(it)
        desc = str(m.get("Description") or "").strip()
        if not desc:
            unknown.append(f"Item with a body but no Description: {m}")
            continue
        try:
            count = int(m.get("Count") or 1)
        except (TypeError, ValueError):
            count = 1
        items.append(desc if count == 1 else f"{desc} x{count}")

    label = ", ".join(bits + items)
    real = [n for n in wnodes + inodes if (n.get("nested") or [])]
    return coins, items, label, bool(real), unknown


def number(p):
    """An INTEGER property's value, wherever the resolved corpus put it.

    A declared default sits on a modifier rather than on `value`:
        ^"Glory" INTEGER DEFAULT 29
        -> {"name": "Glory", "type": "INTEGER",
            "modifiers": [{"kind": "DEFAULT", "value": "29"}]}
    Reading only `value` returns None, and every region's glory went missing
    that way -- the same trap as the ENUM DEFAULT one in the synthesist notes.
    """
    if not p:
        return None
    for src in [p.get("value")] + [m.get("value") for m in
                                   (p.get("modifiers") or [])
                                   if m.get("kind") == "DEFAULT"]:
        try:
            return int(src)
        except (TypeError, ValueError):
            continue
    return None


def from_clan(p):
    """The FROM_CLAN alternative, if the property states one."""
    for n in (p or {}).get("nested") or []:
        m = re.search(r'FROM_CLAN\s+\^"[^"]*"\."([^"]+)"', n.get("raw") or "")
        if m:
            return m.group(1)
    return None


def books_for(d):
    out = []
    for s in d.get("sources") or []:
        for book, mode in BOOKS.items():
            if book in s and mode not in out:
                out.append(mode)
    return out


def build(d, kind):
    ri = prop(d, "Ring Increase", "Ring Increases")
    si = prop(d, "Skill Increase", "Skill Increases")
    rings, rlabel = grants(ri)
    skills, slabel = grants(si)
    coins, witems, wlabel, wstated, wbad = wealth(d)
    row = {
        "name": d["name"],
        "kind": kind,
        "sources": d.get("sources") or [],
        "modes": books_for(d),
        "ring_increase": rings,
        "ring_increase_label": rlabel or "",
        "glory": number(prop(d, "Glory")),
        "status_modification": number(prop(d, "Status Modification")),
        # the denominations as the source format keeps them
        "starting_wealth_stated": wstated,
        "wealth_unreadable": wbad,
        "starting_coins": coins,
        "starting_wealth_label": wlabel,
        # a day's rations, an heirloom, a wakizashi: gear, not currency
        "starting_items": witems,
        "from_clan": from_clan(ri) and {
            "rings": from_clan(ri), "skills": from_clan(si)} or None,
    }
    # a region states one skill, an upbringing several; keep the corpus's own
    # property name so nothing downstream has to guess which it is
    if kind == "region":
        row["skill_increase"] = skills
        row["skill_increase_label"] = slabel or ""
    else:
        row["skill_increases"] = skills
        row["skill_increases_label"] = slabel or ""
    return row


# The corpus's block keyword is SHUJI, KIHO, MAHO; the catalog's technique
# `kind` matches that spelling, and the books print Shūji, Kihō, Mahō. So the
# machine value keeps the corpus's spelling and the label carries the macron —
# the hand-written file had only the macron form, which read correctly but did
# not match the catalog.
CATEGORY_LABEL = {"shuji": "Shūji", "kiho": "Kihō", "maho": "Mahō"}


def unquote(x):
    """A block list entry, which arrives with its own quoting: "\"club\"" and
    "^\"Striking as Earth\"" both mean the bare name."""
    x = str(x or "").strip()
    if x.startswith("^"):
        x = x[1:]
    return x.strip('"')


def blocks_of(d, keyword):
    return [b for b in (d.get("blocks") or []) if b.get("keyword") == keyword]


def build_school(d):
    """A school, in the shape schools.js has always had.

    Two things are worth naming because they are not obvious in the data:

      - a starting technique is either fixed or a choice, and its category is
        the KATA / SHUJI / RITUAL keyword rather than a property. A block with
        a `choose` is the choice form; one with a bare label is the fixed form.
      - SCHOOL_ABILITY labels itself with a plain quoted string and
        MASTERY_ABILITY with a ^"name"; both reduce to the bare name.
    """
    rings, _ = grants(prop(d, "Ring Increase"))
    skills, _ = grants(prop(d, "Starting Skills"))
    roles = prop(d, "Roles")
    avail = prop(d, "Techniques Available")
    clan = prop(d, "Clan")

    def listing(p_):
        if not p_:
            return []
        v = p_.get("value")
        if isinstance(v, list):
            return [unquote(x) for x in v]
        if isinstance(v, str):
            try:
                parsed = json.loads(v)
                if isinstance(parsed, list):
                    return [unquote(x) for x in parsed]
            except (ValueError, TypeError):
                pass
        return [unquote(x) for x in (p_.get("list") or [])]

    techs = []
    for outer in blocks_of(d, "STARTING_TECHNIQUES"):
        for b in outer.get("blocks") or []:
            cat = str(b.get("keyword") or "").lower()
            ch = b.get("choose")
            label = CATEGORY_LABEL.get(cat, cat.capitalize())
            if ch:
                techs.append({"category": cat, "category_label": label,
                              "kind": "choose",
                              "n": int(ch.get("n") or 1),
                              "options": [unquote(o) for o in
                                          (ch.get("options") or [])]})
            else:
                techs.append({"category": cat, "category_label": label,
                              "kind": "fixed",
                              "name": unquote(b.get("label"))})

    outfit = []
    for b in blocks_of(d, "STARTING_OUTFIT"):
        outfit += [unquote(x) for x in (b.get("list") or [])]

    def ability(keyword):
        for b in blocks_of(d, keyword):
            if b.get("label"):
                return unquote(b["label"])
        return None

    # The ^"School Name" property, not the entity name: the two differ on
    # five schools ("Kitsune Impersonator Tradition" is entity, "Kitsune
    # Impersonator" is the name), and everything downstream — rollName(), the
    # school-roll gate, the coverage ledger — keys off the property.
    sname = prop(d, "School Name")
    return {
        "name": (sname or {}).get("value") or d["name"],
        "clan": (clan or {}).get("value"),
        "roles": listing(roles),
        "ring_increase": rings,
        "starting_skills": skills,
        "starting_honor": number(prop(d, "Starting Honor")),
        "techniques_available": listing(avail),
        "starting_techniques": techs,
        "starting_outfit": outfit,
        "school_ability": ability("SCHOOL_ABILITY"),
        "mastery_ability": ability("MASTERY_ABILITY"),
    }


def build_clan(d):
    """A clan, in the shape clans.js has always had.

    ^"Clan Status" states itself as a DEFAULT modifier rather than a value, so
    number() has to look there — the same trap that made every region's glory
    read as null. Glory Modifier and Demeanor are absent on all sixteen; the
    fields are kept as null because the file has always had them.
    """
    rings, _ = grants(prop(d, "Clan Ring Bonus"))
    skills, _ = grants(prop(d, "Clan Skill Bonus"))
    short = prop(d, "Clan Name")
    return {
        "name": d["name"],
        "kind": "clan",
        "source": (d.get("sources") or [None])[0],
        "description": "",
        "ring_bonus": rings,
        "skill_bonus": skills,
        "starting_status": number(prop(d, "Clan Status")),
        "glory_modifier": number(prop(d, "Glory Modifier")),
        "demeanor": (prop(d, "Demeanor") or {}).get("value"),
        "clan_short_name": (short or {}).get("value"),
        "rules": ["#" + r["hash"] for r in (d.get("rules") or [])
                  if r.get("hash")],
    }


def build_family(d):
    """A family, in the shape families.js has always had, plus structured wealth.

    Every field the hand-written file carried is reproduced from the corpus —
    compared across all 42 before this replaced it, and ring increases, skill
    increases, glory and clan matched exactly, zero differences. The additions
    are the wealth fields, which is the only thing that was stale.
    """
    rings, rlabel = grants(prop(d, "Ring Increase", "Ring Increases"))
    skills, slabel = grants(prop(d, "Skill Increases", "Skill Increase"))
    coins, witems, wlabel, wstated, wbad = wealth(d)
    clan = prop(d, "Clan")
    return {
        "name": d["name"],
        "kind": "family",
        "source": (d.get("sources") or [None])[0],
        "clan": (clan or {}).get("value"),
        "glory": number(prop(d, "Glory")),
        "starting_coins": coins,
        "starting_wealth_label": wlabel,
        "starting_items": witems,
        "starting_wealth_stated": wstated,
        "wealth_unreadable": wbad,
        "ring_increase": rings,
        "ring_increase_label": rlabel or "",
        "skill_increases": skills,
        "skill_increases_label": slabel or "",
        # the corpus states no prose for a family; the field is kept because
        # the file has always had it
        "description": "",
        "rules": ["#" + r["hash"] for r in (d.get("rules") or [])
                  if r.get("hash")],
    }


def write(path, var, rows):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("window." + var + " = ")
        json.dump(rows, fh, ensure_ascii=False, sort_keys=True)
        fh.write(";\n")


def main():
    if not os.path.exists(RESOLVED):
        sys.exit(f"missing {RESOLVED} — run scripts/dsl_rules_text.py first")
    doc = json.load(open(RESOLVED, encoding="utf-8"))

    regions, ups, fams, clans, schools = [], [], [], [], []
    for d in defs(doc):
        n = d.get("name") or ""
        # a school is identified by its own property; the ^"School" metatype
        # that declares the shape is not one
        if prop(d, "School Name") and n != "School":
            schools.append(build_school(d))
            continue
        # a clan is identified by its own property; the ^"Clan" metatype that
        # declares the shape is not one
        if prop(d, "Clan Name") and n != "Clan":
            clans.append(build_clan(d))
            continue
        # a family is identified by its own property, not by its name, and the
        # ^"Family" metatype that declares the shape is not one
        if prop(d, "Family Name") and n != "Family":
            fams.append(build_family(d))
            continue
        if n in ("Region", "Upbringing"):
            continue                      # the metatype anchors
        # Path of Waves' own questions are DEFs named ^"Question 1: Region" and
        # ^"Question 2: Upbringing", which end in the same two words a region
        # and an upbringing do. A question is not an origin: it has a
        # ^"Question" number and a ^"Question Text", and no grants at all.
        if prop(d, "Question", "Question Text") or re.match(r"^Question \d", n):
            continue
        if n.endswith(" Region"):
            regions.append(build(d, "region"))
        elif n.endswith(" Upbringing"):
            ups.append(build(d, "upbringing"))

    # by name, because the resolved corpus can present a DEF once per composing
    # file and the richer of the two is the one to keep
    def dedupe(rows):
        best = {}
        for r in rows:
            prev = best.get(r["name"])
            if prev is None or len(json.dumps(r)) > len(json.dumps(prev)):
                best[r["name"]] = r
        return sorted(best.values(), key=lambda r: r["name"])

    regions, ups, fams, clans, schools = (dedupe(regions), dedupe(ups),
                                         dedupe(fams), dedupe(clans),
                                         dedupe(schools))
    if not regions or not ups:
        sys.exit(f"FAIL — {len(regions)} regions and {len(ups)} upbringings; "
                 f"both are needed for questions 1 and 2")

    # Every one of them must grant something, or the question it answers is
    # decorative. Fallen Noble grants via FROM_CLAN with a fallback, so it
    # counts as granting.
    for r in regions + ups:
        sk = r.get("skill_increase") or r.get("skill_increases")
        if not (r["ring_increase"] or sk or r["from_clan"]
                or r["glory"] is not None
                or r["status_modification"] is not None):
            sys.exit(f"FAIL — {r['name']} grants nothing; the corpus states "
                     f"a grant for every region and upbringing")

    # Every region in the book prints a glory. A missing one means a property
    # shape was not read -- which is exactly how they all went missing once.
    noglory = [r["name"] for r in regions if r["glory"] is None]
    if noglory:
        sys.exit(f"FAIL — no glory read for {len(noglory)} of {len(regions)} "
                 f"regions: " + ", ".join(noglory))

    # An option list cut short is the failure mode this file has already had
    # once: a bracket inside ^"Martial Arts [Melee]" truncated Fallen Noble's
    # 24 skills to 11. If a choice offers Martial Arts at all, it must offer
    # all three.
    for r in regions + ups:
        for field in ("ring_increase", "skill_increase", "skill_increases"):
            ch = ((r.get(field) or {}) or {}).get("_choose")
            if not ch:
                continue
            ma = [o for o in ch["options"] if o.startswith("Martial Arts")]
            if ma and len(ma) != 3:
                sys.exit(f"FAIL — {r['name']} {field} offers {len(ma)} of the "
                         f"3 Martial Arts skills ({', '.join(ma)}); the option "
                         f"list was truncated")

    # Every school must state what question 3 grants. The count is not
    # asserted at a fixed number because a new book adds schools; what is
    # asserted is that none arrives hollow.
    if len(schools) < 109:
        sys.exit(f"FAIL — {len(schools)} schools found; the file this replaces "
                 f"had 109 and books only add.")
    for sc in schools:
        for field in ("roles", "ring_increase", "starting_skills",
                      "techniques_available"):
            if not sc[field]:
                sys.exit(f"FAIL — {sc['name']} states no {field}")
        if sc["starting_honor"] is None:
            sys.exit(f"FAIL — {sc['name']} states no starting honor")

    # Sixteen clans, and every one must grant what question 1 grants.
    if len(clans) != 16:
        sys.exit(f"FAIL — {len(clans)} clans found; the corpus and the file it "
                 f"replaces both had 16.")
    for c in clans:
        for field in ("ring_bonus", "skill_bonus", "clan_short_name"):
            if not c[field]:
                sys.exit(f"FAIL — {c['name']} states no {field}")
        if c["starting_status"] is None:
            sys.exit(f"FAIL — {c['name']} states no starting status")

    # The corpus states 42 families and the hand-written file had 42. A count
    # that moves means the corpus changed or the discriminator broke, and
    # either way the file should not be replaced quietly.
    if len(fams) != 42:
        sys.exit(f"FAIL — {len(fams)} families found; the corpus and the file "
                 f"it replaces both had 42. Check the ^\"Family Name\" "
                 f"discriminator before writing.")
    for f in fams:
        if not f["clan"] and f["name"] not in ("Peasant Family",
                                               "Families of the Fleet"):
            sys.exit(f"FAIL — {f['name']} states no clan")
        if f["glory"] is None:
            sys.exit(f"FAIL — {f['name']} states no glory")
        if not f["ring_increase"]:
            sys.exit(f"FAIL — {f['name']} grants no ring increase")

    # A node the reader could not make sense of is a shape nobody has read yet.
    bad = [(r["name"], m) for r in regions + ups + fams
           for m in (r.get("wealth_unreadable") or [])]
    if bad:
        sys.exit(f"FAIL — {len(bad)} Wealth/Item node(s) could not be read: "
                 + "; ".join(f"{n}: {m}" for n, m in bad))

    # The gate that matters, and the one the previous version got wrong. It
    # keyed off "does the corpus state the old property", so when af1423f
    # removed ^"Starting Wealth" every upbringing silently read as no wealth
    # and the gate passed vacuously -- the exact failure mode as a moved source
    # path giving an empty inventory. So the count is asserted instead: the
    # book gives all thirteen upbringings a starting allotment, in coin or in
    # kind, and none in a region.
    silent = [r["name"] for r in ups if not r["starting_wealth_stated"]]
    if silent:
        sys.exit(f"FAIL — {len(silent)} of {len(ups)} upbringings state neither "
                 f"Wealth nor Item; the book gives every one a starting "
                 f"allotment: " + ", ".join(silent))

    write(OUT_REGION, "L5R_REGIONS", regions)
    write(OUT_UPBRINGING, "L5R_UPBRINGINGS", ups)
    write(OUT_FAMILY, "L5R_FAMILIES", fams)
    write(OUT_CLAN, "L5R_CLANS", clans)
    write(OUT_SCHOOL, "L5R_SCHOOLS", schools)
    noab = sum(1 for x in schools if not x["school_ability"])
    nomast = sum(1 for x in schools if not x["mastery_ability"])
    print(f"{len(schools)} schools -> {os.path.relpath(OUT_SCHOOL, ROOT)} "
          f"({os.path.getsize(OUT_SCHOOL)/1024:.1f} KB)  "
          f"{sum(1 for x in schools if x['clan'])} with a clan, "
          f"{sum(len(x['starting_techniques']) for x in schools)} starting "
          f"technique entries")
    if noab or nomast:
        print(f"   FLAG — {noab} state no school ability, {nomast} no mastery "
              f"ability")
    print(f"{len(clans)} clans -> {os.path.relpath(OUT_CLAN, ROOT)} "
          f"({os.path.getsize(OUT_CLAN)/1024:.1f} KB)  "
          f"status {min(c['starting_status'] for c in clans)} to "
          f"{max(c['starting_status'] for c in clans)}")
    coined = sum(1 for f in fams if any(f["starting_coins"].values()))
    withitems = [f["name"] for f in fams if f["starting_items"]]
    print(f"{len(fams)} families -> {os.path.relpath(OUT_FAMILY, ROOT)} "
          f"({os.path.getsize(OUT_FAMILY)/1024:.1f} KB)  "
          f"{coined} grant coin, {len(withitems)} grant an item")
    if withitems:
        print("   items: " + ", ".join(withitems))
    for label, rows, path in (("regions", regions, OUT_REGION),
                              ("upbringings", ups, OUT_UPBRINGING)):
        pow_n = sum(1 for r in rows if "pow" in r["modes"])
        wow_n = sum(1 for r in rows if "wow" in r["modes"])
        print(f"{len(rows)} {label} -> {os.path.relpath(path, ROOT)} "
              f"({os.path.getsize(path)/1024:.1f} KB)  "
              f"Path of Waves {pow_n}, Writ of the Wilds {wow_n}")
    ch = [r["name"] for r in regions + ups
          if (r["ring_increase"] or {}).get("_choose")
          or ((r.get("skill_increase") or r.get("skill_increases")) or {}).get("_choose")]
    print(f"   {len(ch)} carry a choice the player resolves")
    fc = [r["name"] for r in regions + ups if r["from_clan"]]
    if fc:
        print(f"   {len(fc)} take their grants from a chosen clan, with a "
              f"fallback: " + ", ".join(fc))
    nomode = [r["name"] for r in regions + ups if not r["modes"]]
    if nomode:
        print(f"   FLAG — no book claims {len(nomode)}: " + ", ".join(nomode))
    return 0


if __name__ == "__main__":
    sys.exit(main())
