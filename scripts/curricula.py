#!/usr/bin/env python3
"""What the advancement ledger needs from the DSL corpus.

Advancement needs three things the wizard has never had: what a school's
curriculum lists at each rank (so a purchase can be told in-curriculum from
out), and for a title, its curriculum, its award and what it costs to complete.

All of it is in the corpus. This reads the resolved corpus —
pipeline/dsl/l5r5e-resolved.ttrpg, which titterpig-synthesist composes with the
errata files last — so what lands is the corpus after errata, not before.

    python3 scripts/curricula.py

Item patterns are here too: they are bought with experience like anything
else, and the corpus states each one's XP Cost, Effect and Rarity Modifier.

Writes data/chargen/curricula.js (window.L5R_CURRICULA),
data/chargen/titles.js (window.L5R_TITLES) and
data/chargen/patterns.js (window.L5R_PATTERNS), and reports what the corpus does
not state rather than filling it in from somewhere else. Nothing here reads the
Foundry compendium or the books: the corpus is the source, and a gap in it is a
thing to fix in the corpus.

Four shapes of curriculum are in use, one per converter that wrote one:

    CURRICULUM { RANK 1 { SKILL "Command" ... ^"Name" [kata] } }   schools
    CURRICULUM { "Trade Skills" "Skill Group" ... }                core titles
    ^"Advancement" LIST OF STRING [ "Commerce (Skill)", ... ]       most titles
    ^"Advances" STRING "Government (skill), = Rank 1 Rituals (...)"  Spirit Hunter

and a title states its completion cost as XP_TO_COMPLETION, as an
^"XP to Completion" property, or as ^"XP Cost", depending on the same. The
leading `=` on an advance is the books' mark for one buyable without meeting
its prerequisites, which is what appearing on a curriculum already means, so it
is read as the marker it is and not as part of the label.
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RESOLVED = os.path.join(ROOT, "pipeline", "dsl", "l5r5e-resolved.ttrpg")
OUT_CUR = os.path.join(ROOT, "data", "chargen", "curricula.js")
OUT_TITLE = os.path.join(ROOT, "data", "chargen", "titles.js")
OUT_PAT = os.path.join(ROOT, "data", "chargen", "patterns.js")

DEF_RE = re.compile(r'(?:#(?P<hash>\S+)\s+)?\^"(?P<name>[^"]+)"\s+DEF\s*\{')
NESTED_DEF = re.compile(r'\^"[^"]+"\s+DEF\s*\{')
# the kinds a curriculum entry can be, however the corpus writes them
KIND = {"skillgroup": "Skill Group", "skill": "Skill",
        "techniquegroup": "Tech. Grp.", "techgroup": "Tech. Grp.",
        "technique": "Technique"}
GROUPS = ["kata", "shuji", "shūji", "ritual", "rituals", "invocation",
          "invocations", "kiho", "kihō", "maho", "mahō", "ninjutsu",
          "ninjitsu", "mantra", "inversion"]


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
    return re.sub(r"[^a-z0-9]+", "", str(s or "").lower())


def group_of(label):
    """The technique category a label names, if it names one."""
    low = str(label or "").lower()
    for g in GROUPS:
        if re.search(r"\b" + re.escape(g) + r"\b", low):
            return {"shūji": "shuji", "rituals": "ritual",
                    "invocations": "invocation", "kihō": "kiho",
                    "mahō": "maho", "ninjitsu": "ninjutsu"}.get(g, g)
    return None


def entry(kind, label, rank=None, group=None):
    return {"rank": rank, "kind": kind, "group": group or group_of(label),
            "label": re.sub(r"\s+", " ", str(label)).strip()}


def parse_ranked(body):
    """CURRICULUM { RANK 1 { ... } } — the school shape."""
    out = []
    for m in re.finditer(r"\b(?:RANK|Rank)\s+(?P<n>\d+)\s*\{", body):
        inner, _ = block(body, m.end() - 1)
        rank = int(m.group("n"))
        for line in inner.splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            km = re.match(r'(?P<kw>[A-Z_]+)\s+"(?P<label>[^"]*)"', line)
            if km and norm(km.group("kw")) in KIND:
                out.append(entry(KIND[norm(km.group("kw"))],
                                 km.group("label"), rank))
                continue
            rm = re.match(r'\^"(?P<label>[^"]+)"\s*(?:\[(?P<grp>[^\]]+)\])?',
                          line)
            if rm:
                out.append(entry("Technique", rm.group("label"), rank,
                                 (rm.group("grp") or "").strip().lower() or None))
    return out


def parse_value_first(body):
    """CURRICULUM { ^"Title Curriculum" DEF { "Social" SKILL_GROUP … } }

    Writ of the Wilds and Celestial Realms put the value first and the keyword
    second — the reverse of every other shape — and wrap the lot in a nested
    DEF. A technique names its category inside the label:
    "Eternal Mind's Gate (kiho)" TECHNIQUE.

    Read by token order rather than by line, because the source and the
    composed corpus lay the pairs out differently: the source writes
    `"Social" SKILL_GROUP` on one line, and the synthesist re-emits the same
    row as `"Social"` then `SKILL_GROUP "Scholar"` on the next. Matching a line
    found one entry of the eight and reported the rest as a corpus gap.
    """
    out, pending = [], None
    for tok in re.finditer(r'\^?"(?:[^"\\]|\\.)*"|[A-Z_]{3,}', body):
        t = tok.group(0)
        if t.startswith('^'):
            pending = None                  # a name or a reference, not a value
        elif t.startswith('"'):
            pending = t[1:-1]
        elif pending is not None:
            k = KIND.get(norm(t))
            if k:
                gm = re.match(r"(?P<label>.*?)\s*\((?P<grp>[^)]+)\)\s*$", pending)
                out.append(entry(k, gm.group("label") if gm else pending, None,
                                 gm.group("grp").strip().lower() if gm else None))
            pending = None
    return out


def parse_pairs(body):
    """CURRICULUM { "Trade Skills" "Skill Group" } — the core-title shape."""
    out = []
    for label, kind in re.findall(r'"([^"]+)"\s+"([^"]+)"', body):
        k = kind.strip()
        gm = re.match(r"Technique\s*\(([^)]+)\)", k, re.I)
        out.append(entry("Technique" if gm else KIND.get(norm(k), k), label,
                         None, gm.group(1).strip().lower() if gm else None))
    return out


def close_bracket(text, at):
    """The index of the `]` that closes the `[` at `at`, ignoring brackets that
    sit inside a quoted string.

    A plain text.index("]") ends the list at the first bracket it sees, and the
    first entry of several title curricula is "Martial Arts [Melee] (Skill)" —
    so Sword-Saint's seven advancements read as none, and any list with a
    bracketed skill part-way down was truncated there. Nothing said so.
    """
    i, n, in_str = at + 1, len(text), False
    while i < n:
        c = text[i]
        if in_str:
            if c == "\\":
                i += 1
            elif c == '"':
                in_str = False
        elif c == '"':
            in_str = True
        elif c == "]":
            return i
        i += 1
    return n


def parse_advancement(body):
    """^"Advancement" LIST OF STRING [ "Commerce (Skill)" ] — most titles."""
    m = re.search(r'\^"Advancement"\s+LIST OF STRING\s*\[', body)
    if not m:
        return []
    end = close_bracket(body, m.end() - 1)
    out = []
    for s in re.findall(r'"((?:[^"\\]|\\.)*)"', body[m.end():end]):
        pm = re.match(r"(?P<label>.*?)\s*\((?P<kind>[^)]+)\)\s*$", s)
        if not pm:
            out.append(entry("Skill", s))
            continue
        k = pm.group("kind").strip()
        out.append(entry(KIND.get(norm(k), "Technique"), pm.group("label"),
                         None, None if norm(k) in KIND else k.lower()))
    return out


def parse_advances(body):
    """^"Advances" STRING "Government (skill), = Rank 1 Rituals (ritual, tech group)"

    One comma-separated string rather than a list, and its kinds are written
    lowercase and sometimes compound: "(ritual, tech group)" names the category
    and the kind at once.
    """
    m = re.search(r'\^"Advances"\s+STRING\s+"((?:[^"\\]|\\.)*)"', body)
    if not m:
        return []
    out = []
    # split on commas that are not inside a parenthetical
    for part in re.split(r",(?![^(]*\))", m.group(1)):
        part = part.strip()
        if not part:
            continue
        prereq_waived = part.startswith("=")
        part = part.lstrip("=").strip()
        pm = re.match(r"(?P<label>.*?)\s*\((?P<kind>[^)]+)\)\s*$", part)
        if not pm:
            out.append(entry("Skill", part))
            continue
        label, kind = pm.group("label"), pm.group("kind").strip()
        bits = [b.strip() for b in kind.split(",")]
        group = None
        k = KIND.get(norm(bits[-1]))
        if len(bits) > 1 and k:
            group = bits[0].lower()          # "(ritual, tech group)"
        elif not k:
            k, group = "Technique", kind.lower()
        e = entry(k, label, None, group)
        e["prereq_waived"] = prereq_waived
        out.append(e)
    return out


def dedupe(entries):
    """A guard, no longer a workaround.

    Emerald Magistrate's seven curriculum entries used to arrive twenty-one
    entries long: the 2019 and 2020 errata each restate the curriculum, and a
    MODIFY carrying a block of rows appended them to the rows already there
    instead of replacing them. That was two faults at once — the errata
    restated DEF-level clauses inside a MODIFY body, and the synthesist could
    not key a row child — and both are fixed. Kept because a duplicate is
    cheap to drop and expensive to ship, and because it reports when it fires."""
    seen, out = set(), []
    for e in entries:
        k = (e["rank"], e["kind"], e["group"], norm(e["label"]))
        if k in seen:
            continue
        seen.add(k)
        out.append(e)
    return out


def modifier_award(body):
    """Status/Glory stated as integer modifiers rather than a printed sentence.

    Spirit Hunter carries ^"Status Modifier" INTEGER 5 and ^"Glory Modifier"
    INTEGER 0 where the other titles carry ^"Status Award" STRING
    "+15 (to a minimum of 40)". A zero modifier is stated, not absent — the
    corpus's own comment says the title grants no glory award because secrecy
    matters to Lady Mazoku's work — so it is reported rather than dropped.
    """
    bits = []
    for which in ("Status", "Glory", "Honor"):
        v = prop(body, which + " Modifier")
        if v is not None:
            bits.append("%s %+d" % (which, v))
    return ", ".join(bits) or None


def prop(body, name):
    """^"Name" STRING "value" / INTEGER 5, however the line is wrapped.

    `INTEGER DEFAULT 24` is a declared default and is still the value the book
    prints; without allowing DEFAULT here, Forester and Awakened Soul read as
    having no completion cost, which is how an extractor's blind spot gets
    reported as a hole in the corpus.
    """
    m = re.search(r'\^"' + re.escape(name) + r'"\s*(?:STRING|INTEGER)?\s*'
                  r'(?:DEFAULT\s+)?'
                  r'(?:"((?:[^"\\]|\\.)*)"|(\d+))', body)
    if not m:
        return None
    return m.group(1) if m.group(1) is not None else int(m.group(2))


def keyword(body, name):
    m = re.search(r"\b" + name + r'\s+(?:"((?:[^"\\]|\\.)*)"|(\d+))', body)
    if not m:
        return None
    return m.group(1) if m.group(1) is not None else int(m.group(2))


def unescape(s):
    return None if s is None else s.replace('\\"', '"') if isinstance(s, str) else s


def patterns(text):
    """Item patterns and their XP cost, from wherever the corpus states them.

    Identified by carrying an ^"XP Cost" beside a ^"Rarity Modifier" — that
    pairing is what an item pattern is and nothing else in the corpus has it,
    which matters because ^"XP Cost" on its own is worn by bonds, titles and
    techniques as well.
    """
    out = {}
    for m in DEF_RE.finditer(text):
        body, _ = block(text, m.end() - 1)
        # This DEF's own properties, stopping at the first nested DEF — matched
        # as a DEF header, not as the substring "DEF", which also occurs inside
        # DEFAULT. Splitting on the bare word cut Agasha Pattern's head off
        # immediately before its own `^"XP Cost" INTEGER DEFAULT 6`, so the
        # pattern read as having no cost and was dropped.
        nested = NESTED_DEF.search(body)
        head = body[:nested.start()] if nested else body
        xp = prop(head, "XP Cost")
        rar = prop(head, "Rarity Modifier")
        if xp is None or rar is None:
            continue
        name = m.group("name")
        out.setdefault(norm(name), {
            "name": name, "hash": m.group("hash"), "xp_cost": xp,
            "rarity_modifier": rar, "effect": prop(head, "Effect"),
        })
    return out


def main():
    if not os.path.exists(RESOLVED):
        sys.exit(f"no resolved corpus at {RESOLVED} — run "
                 f"scripts/dsl_rules_text.py --refresh to compose it")
    text = open(RESOLVED, encoding="utf-8").read()

    schools, titles, dups = {}, {}, []
    for m in DEF_RE.finditer(text):
        name = m.group("name")
        body, _ = block(text, m.end() - 1)
        has_cur = "CURRICULUM" in body
        # Identified as a title by something only a title says. ^"XP Cost" is
        # NOT that: bonds, item patterns and techniques all carry one, and
        # reading it as the marker pulled in forty of them.
        titleish = ('^"Type" STRING "Title"' in body or
                    re.search(r'EXTENDS\s+(?:#\S+\s+)?\^"Title"', body) or
                    '^"XP to Completion"' in body or
                    "XP_TO_COMPLETION" in body or
                    '^"Title Ability"' in body)
        xp = prop(body, "XP to Completion")
        if xp is None:
            xp = keyword(body, "XP_TO_COMPLETION")
        if xp is None and titleish:
            xp = prop(body, "XP Cost")
        # The abstract ^"Title" DEF states what a title is; it is not one, and
        # a "<Book> Titles" DEF is the container its entries sit in — both
        # match on their contents otherwise.
        is_title = (name != "Title" and "ENTRIES" not in body and titleish
                    and (xp is not None or '^"Title Ability"' in body))

        if is_title:
            cur = parse_advancement(body) or parse_advances(body)
            if not cur and has_cur:
                cb, _ = block(body, body.index("CURRICULUM"))
                cur = (parse_ranked(cb) or parse_pairs(cb)
                       or parse_value_first(cb))
            n = len(cur)
            cur = dedupe(cur)
            if n != len(cur):
                dups.append((name, n, len(cur)))
            ability = prop(body, "Title Ability")
            effect = prop(body, "Title Ability Effect")
            if not ability:
                tm = re.search(r'TITLE_ABILITY\s*\{\s*\^"([^"]+)"\s*'
                               r'"((?:[^"\\]|\\.)*)"', body)
                if tm:
                    ability, effect = tm.group(1), tm.group(2)
            if not ability:
                rm = re.search(r'_title_ability\s+"([^"(]+)\s*\(Title Ability\):'
                               r'\s*((?:[^"\\]|\\.)*)"', body)
                if rm:
                    ability, effect = rm.group(1).strip(), rm.group(2)
            titles[norm(name)] = {
                "name": name,
                "assigned_by": unescape(prop(body, "Assigned By")
                                        or keyword(body, "ASSIGNED_BY")),
                "award": unescape(prop(body, "Status Award")
                                  or prop(body, "Glory Award")
                                  or prop(body, "Honor Award")
                                  or keyword(body, "STATUS_AWARD")
                                  or keyword(body, "GLORY_AWARD")
                                  or keyword(body, "HONOR_AWARD")
                                  or modifier_award(body)),
                "xp_to_completion": xp,
                "ability": unescape(ability),
                "ability_effect": unescape(effect),
                "curriculum": cur,
            }
        elif has_cur and re.search(r'EXTENDS\s+(?:#\S+\s+)?\^"School"', body):
            cb, _ = block(body, body.index("CURRICULUM"))
            cur = parse_ranked(cb)
            n = len(cur)
            cur = dedupe(cur)
            if n != len(cur):
                dups.append((name, n, len(cur)))
            ranks = {}
            for e in cur:
                ranks.setdefault(str(e["rank"]), []).append(
                    {k: v for k, v in e.items() if k != "rank"})
            schools[norm(name)] = {"school": name, "ranks": ranks}

    pats = patterns(text)
    for path, var, data in ((OUT_CUR, "L5R_CURRICULA", schools),
                            (OUT_TITLE, "L5R_TITLES", titles),
                            (OUT_PAT, "L5R_PATTERNS", pats)):
        with open(path, "w") as f:
            f.write(f"window.{var} = ")
            json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
            f.write(";\n")

    print(f"{len(schools)} school curricula -> "
          f"{os.path.relpath(OUT_CUR, ROOT)} "
          f"({os.path.getsize(OUT_CUR)/1024:.1f} KB)")
    ranks = sorted({len(s["ranks"]) for s in schools.values()})
    short = [s["school"] for s in schools.values() if len(s["ranks"]) < 5]
    print(f"   ranks per school: {ranks}"
          + (f"; fewer than five for {len(short)}: {', '.join(short)}"
             if short else ""))
    print(f"{len(titles)} titles -> {os.path.relpath(OUT_TITLE, ROOT)} "
          f"({os.path.getsize(OUT_TITLE)/1024:.1f} KB)")
    for field, label in (("curriculum", "no curriculum"),
                         ("xp_to_completion", "no XP to completion"),
                         ("ability", "no title ability"),
                         ("award", "no status or glory award")):
        gap = sorted(t["name"] for t in titles.values() if not t[field])
        if gap:
            print(f"   FLAG — {label} in the corpus for {len(gap)}: "
                  + ", ".join(gap))
    costs = sorted({p["xp_cost"] for p in pats.values()})
    print(f"{len(pats)} item patterns -> {os.path.relpath(OUT_PAT, ROOT)} "
          f"({os.path.getsize(OUT_PAT)/1024:.1f} KB), "
          f"{costs[0]} to {costs[-1]} XP" if pats else "no item patterns found")
    noeffect = sorted(p["name"] for p in pats.values() if not p["effect"])
    if noeffect:
        print(f"   FLAG — no effect stated for {len(noeffect)}: "
              + ", ".join(noeffect))
    # A pattern the corpus states but the compendium does not stock cannot be
    # resolved by build.py, so a character who bought it would fail the build.
    # Named on every run rather than dropped from the list: the corpus is the
    # source of truth for what exists, and a compendium gap is Jordan's call.
    cat = os.path.join(ROOT, "data", "catalog.js")
    if os.path.exists(cat) and pats:
        import unicodedata

        def cnorm(x):
            x = unicodedata.normalize("NFKD", x or "")
            x = "".join(c for c in x if not unicodedata.combining(c))
            return re.sub(r"[^a-z0-9]+", "", x.lower())

        known = {cnorm(c["name"]) for c in
                 json.loads(open(cat, encoding="utf-8").read()
                            .split("=", 1)[1].rstrip().rstrip(";"))
                 if c.get("sub_type") == "item_pattern"}
        astray = sorted(p["name"] for p in pats.values()
                        if cnorm(p["name"]) not in known)
        if astray:
            print(f"   FLAG — in the corpus but not in the compendium, so a "
                  f"purchase would not resolve ({len(astray)}): "
                  + ", ".join(astray))
    if dups:
        print(f"   FLAG — curriculum entries arrive more than once for "
              f"{len(dups)} (errata EXTEND and the synthesist appends; "
              f"deduped here): "
              + ", ".join(f"{n} {a}->{b}" for n, a, b in dups))


if __name__ == "__main__":
    main()
