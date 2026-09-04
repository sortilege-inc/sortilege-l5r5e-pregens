#!/usr/bin/env python3
"""Regions and upbringings, from the corpus, in the shape the Creator computes with.

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
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RESOLVED = os.path.join(ROOT, "pipeline", "dsl", "l5r5e-resolved.json")
OUT_REGION = os.path.join(ROOT, "data", "chargen", "regions.js")
OUT_UPBRINGING = os.path.join(ROOT, "data", "chargen", "upbringings.js")

# The books that reword questions 1 and 2, and the Creator mode each drives.
BOOKS = {"path-of-waves": "pow", "writ-of-wilds": "wow"}

CHOOSE_HEAD = re.compile(
    r"CHOOSE\s+(?P<distinct>DISTINCT\s+)?(?P<n>\d+)\s*\[")
NAME_RE = re.compile(r'\^"([^"]+)"')


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


def wealth(p):
    """Starting wealth as a koku figure, the way a family states it.

    A family's starting_wealth is a plain number of koku; an upbringing states
    DEF { ^"Koku" INTEGER 1 } or DEF { ^"Bu" INTEGER 4 }. A bu is a tenth of a
    koku (core rulebook), so 4 bu is 0.4 koku -- kept as a number so the two
    are one currency, with the label preserved for display.
    """
    if not p:
        return 0, ""
    if p.get("type") == "STRING":
        v = str(p.get("value") or "")
        m = re.match(r"(\d+)\s*(koku|bu)", v, re.I)
        if not m:
            return 0, v
        n = int(m.group(1))
        return (n if m.group(2).lower() == "koku" else n / 10.0), v
    total, bits = 0, []
    for n in p.get("nested") or []:
        if not n.get("name") or n.get("value") is None:
            continue
        try:
            v = int(n["value"])
        except (TypeError, ValueError):
            continue
        bits.append(f"{v} {n['name'].lower()}")
        total += v if n["name"].lower() == "koku" else v / 10.0
    return total, ", ".join(bits)


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
    koku, wlabel = wealth(prop(d, "Starting Wealth"))
    row = {
        "name": d["name"],
        "kind": kind,
        "sources": d.get("sources") or [],
        "modes": books_for(d),
        "ring_increase": rings,
        "ring_increase_label": rlabel or "",
        "glory": number(prop(d, "Glory")),
        "status_modification": number(prop(d, "Status Modification")),
        "starting_wealth": koku,
        "starting_wealth_label": wlabel,
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

    regions, ups = [], []
    for d in defs(doc):
        n = d.get("name") or ""
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

    regions, ups = dedupe(regions), dedupe(ups)
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

    write(OUT_REGION, "L5R_REGIONS", regions)
    write(OUT_UPBRINGING, "L5R_UPBRINGINGS", ups)
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
