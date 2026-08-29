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
import json, os, re, sys

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

    with open(OUT, "w") as f:
        f.write("window.L5R_HERITAGES = ")
        json.dump(tables, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")

    print(f"{len(tables)} heritage tables -> {os.path.relpath(OUT, ROOT)} "
          f"({os.path.getsize(OUT)/1024:.1f} KB)")
    for k, t in tables.items():
        subs = sum(1 for e in t["entries"] if e.get("sub_table"))
        note = ("  <- NOT ENCODED in the DSL corpus: rule ids only"
                if t["form"] == "unencoded" else "")
        print(f"   {len(t['entries']):3} entries  {subs:2} with sub-tables  "
              f"[{t['form']:9}]  {t['name']}{note}")


if __name__ == "__main__":
    main()
