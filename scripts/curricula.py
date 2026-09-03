#!/usr/bin/env python3
"""Every school curriculum and every title, read out of the DSL corpus.

Advancement needs three things the wizard has never had: what a school's
curriculum lists at each rank (so a purchase can be told in-curriculum from
out), and for a title, its curriculum, its award and what it costs to complete.

All of it is in the corpus. This reads the resolved corpus —
pipeline/dsl/l5r5e-resolved.ttrpg, which titterpig-synthesist composes with the
errata files last — so what lands is the corpus after errata, not before.

    python3 scripts/curricula.py

Writes data/chargen/curricula.js (window.L5R_CURRICULA) and
data/chargen/titles.js (window.L5R_TITLES), and reports what the corpus does
not state rather than filling it in from somewhere else. Nothing here reads the
Foundry compendium or the books: the corpus is the source, and a gap in it is a
thing to fix in the corpus.

Three shapes of curriculum are in use, one per converter that wrote one:

    CURRICULUM { RANK 1 { SKILL "Command" ... ^"Name" [kata] } }   schools
    CURRICULUM { "Trade Skills" "Skill Group" ... }                core titles
    ^"Advancement" LIST OF STRING [ "Commerce (Skill)", ... ]       most titles

and a title states its cost either as XP_TO_COMPLETION or as an
^"XP to Completion" property, depending on the same.
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RESOLVED = os.path.join(ROOT, "pipeline", "dsl", "l5r5e-resolved.ttrpg")
OUT_CUR = os.path.join(ROOT, "data", "chargen", "curricula.js")
OUT_TITLE = os.path.join(ROOT, "data", "chargen", "titles.js")

DEF_RE = re.compile(r'(?:#(?P<hash>\S+)\s+)?\^"(?P<name>[^"]+)"\s+DEF\s*\{')
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


def parse_pairs(body):
    """CURRICULUM { "Trade Skills" "Skill Group" } — the core-title shape."""
    out = []
    for label, kind in re.findall(r'"([^"]+)"\s+"([^"]+)"', body):
        k = kind.strip()
        gm = re.match(r"Technique\s*\(([^)]+)\)", k, re.I)
        out.append(entry("Technique" if gm else KIND.get(norm(k), k), label,
                         None, gm.group(1).strip().lower() if gm else None))
    return out


def parse_advancement(body):
    """^"Advancement" LIST OF STRING [ "Commerce (Skill)" ] — most titles."""
    m = re.search(r'\^"Advancement"\s+LIST OF STRING\s*\[', body)
    if not m:
        return []
    end = body.index("]", m.end() - 1)
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


def dedupe(entries):
    """Errata EXTEND a title and restate its curriculum, and the synthesist
    appends rather than replaces — Emerald Magistrate's seven entries arrive
    three times over. Identical entries, so this is safe; it is reported as a
    composition defect rather than passed on."""
    seen, out = set(), []
    for e in entries:
        k = (e["rank"], e["kind"], e["group"], norm(e["label"]))
        if k in seen:
            continue
        seen.add(k)
        out.append(e)
    return out


def prop(body, name):
    """^"Name" STRING "value" / INTEGER 5, however the line is wrapped."""
    m = re.search(r'\^"' + re.escape(name) + r'"\s*(?:STRING|INTEGER)?\s*'
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
        xp = prop(body, "XP to Completion")
        if xp is None:
            xp = keyword(body, "XP_TO_COMPLETION")
        # The abstract ^"Title" DEF states what a title is; it is not one, and
        # a "<Book> Titles" DEF is the container its entries sit in — both
        # match on their contents otherwise.
        is_title = name != "Title" and "ENTRIES" not in body and (
            xp is not None or
            ('LIST OF STRING' in body and '^"Title Ability"' in body))

        if is_title:
            cur = parse_advancement(body)
            if not cur and has_cur:
                cb, _ = block(body, body.index("CURRICULUM"))
                cur = parse_ranked(cb) or parse_pairs(cb)
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
                                  or keyword(body, "STATUS_AWARD")
                                  or keyword(body, "GLORY_AWARD")),
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

    for path, var, data in ((OUT_CUR, "L5R_CURRICULA", schools),
                            (OUT_TITLE, "L5R_TITLES", titles)):
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
    if dups:
        print(f"   FLAG — curriculum entries arrive more than once for "
              f"{len(dups)} (errata EXTEND and the synthesist appends; "
              f"deduped here): "
              + ", ".join(f"{n} {a}->{b}" for n, a, b in dups))


if __name__ == "__main__":
    main()
