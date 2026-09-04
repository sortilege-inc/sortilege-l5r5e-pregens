#!/usr/bin/env python3
"""What Create Army needs from the DSL corpus.

Fields of Victory's "Marshaling an Army" is a mechanical system, not a
worksheet: a TN 3 Command check as a down-time activity sets an army's maximum
strength from the marshaller's status (Table 3-1) and its discipline from their
bonus successes (Table 3-2), and then allied lords, mercenaries, doctrines,
equipment upgrades and monthly maintenance all attach to that. All of it is in
the corpus, modelled as DEF trees with ENTRIES rather than as TABLE
constructs -- which is why grepping for `TABLE "` in those files finds one.

    python3 scripts/army_tables.py

Reads pipeline/dsl/l5r5e-resolved.ttrpg and nothing else. Writes
data/chargen/army.js (window.L5R_ARMY).

The extractor is deliberately generic: it mirrors the DEF tree it finds, keeps
every property under the corpus's own label, and carries the corpus's comments
as notes. Nothing here knows what "Maximum Strength" means -- the Creator does.
That way a corpus edit that adds a doctrine or a mercenary type arrives without
a change here, and a shape this does not expect is reported rather than
silently flattened.

The eight systems it looks for are the corpus's own top-level DEFs in
l5r5e-0.4-fields-of-victory-mass-battle.ttrpg. Tables 3-9 and 3-10 live in
l5r5e-0.4-fields-of-victory-mechanics.ttrpg instead, so both are searched.

ONE SOURCE ANOMALY, reproduced rather than corrected: the prose says an army's
discipline is set by "bonus successes and their honor", while Table 3-2 states
"+ ranks in Government + glory rank" and never mentions honor. Both are as
printed (Fields of Victory p.109-110, verified against the source). Table 3-1
likewise has 20-24 and 24-29 as adjacent bands, so status 24 appears in both.
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RESOLVED = os.path.join(ROOT, "pipeline", "dsl", "l5r5e-resolved.ttrpg")
OUT = os.path.join(ROOT, "data", "chargen", "army.js")

# The corpus's own top-level DEFs for the mass-battle system. Named here so a
# rename upstream fails loudly instead of producing a tool with a missing screen.
SYSTEMS = ["Marshaling an Army", "Supplemental Forces", "Doctrines",
           "Equipment Upgrades", "Army Maintenance", "Hostages",
           "Battle Zones", "New Terrain Types"]

DEF_RE = re.compile(r'(?:#(?P<hash>\S+)\s+)?\^"(?P<name>[^"]+)"\s+DEF\s*\{')
PROP_RE = re.compile(r'\^"([^"]+)"\s+(?:STRING|INTEGER)\s*(?:DEFAULT\s+)?'
                     r'(?:"((?:[^"\\]|\\.)*)"|(-?\d+))')
LIST_RE = re.compile(r'\^"([^"]+)"\s+LIST OF STRING\s*\[([^\]]*)\]')


def close_brace(text, i):
    """The index just past the } that closes the { at `i`."""
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


def norm(s):
    return re.sub(r"[^a-z0-9]+", "", str(s or "").lower())


def unescape(s):
    return s.replace('\\"', '"') if isinstance(s, str) else s


def parse_def(text, m):
    """One DEF, with its own properties, its comments, and its child DEFs.

    A child's braces are skipped when reading the parent's properties, so a
    parent does not inherit its children's -- the bug that would make every
    status band look like a property of Marshaling an Army.
    """
    open_i = text.index("{", m.end() - 1)
    end = close_brace(text, open_i)
    body = text[open_i + 1:end - 1]

    # find children first, then blank them out of the body
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
    for lm in LIST_RE.finditer(own):
        props[lm.group(1)] = [unescape(x.group(1)) for x in
                              re.finditer(r'"((?:[^"\\]|\\.)*)"', lm.group(2))]

    # the corpus's comments are the book's own framing and are worth keeping,
    # but its bookkeeping (rule ids, hashes) is not
    notes = []
    for line in own.split("\n"):
        line = line.strip()
        if line.startswith("#") and not re.match(r"^#\S{16,}", line):
            t = line.lstrip("#").strip()
            if t and not re.match(r"^L5R\w*\d:", t):
                notes.append(t)
    note = " ".join(notes).strip()

    return {"name": m.group("name"), "hash": m.group("hash"),
            "note": note or None, "properties": props,
            "entries": children}


def collect(text):
    """Every top-level DEF named in SYSTEMS, wherever in the corpus it sits."""
    out, seen = {}, []
    i = 0
    while True:
        m = DEF_RE.search(text, i)
        if not m:
            break
        i = close_brace(text, text.index("{", m.end() - 1))
        if m.group("name") in SYSTEMS:
            d = parse_def(text, m)
            # the resolved corpus can carry a DEF once per composing file; the
            # richer one wins rather than the last one seen
            prev = out.get(norm(d["name"]))
            if prev is None or len(json.dumps(d)) > len(json.dumps(prev)):
                out[norm(d["name"])] = d
            seen.append(m.group("name"))
    return out, seen


def tables(systems):
    """Every "Table N-N: ..." DEF anywhere in the systems, flattened by name."""
    found = {}

    def walk(d):
        if re.match(r"^Table \d+[-–—]\d+:", d["name"]):
            found[norm(d["name"])] = d
        for c in d["entries"]:
            walk(c)

    for d in systems.values():
        walk(d)
    return found


def main():
    if not os.path.exists(RESOLVED):
        sys.exit(f"missing {RESOLVED} — run scripts/dsl_rules_text.py first")
    text = open(RESOLVED, encoding="utf-8").read()

    systems, _ = collect(text)
    missing = [s for s in SYSTEMS if norm(s) not in systems]
    if missing:
        sys.exit("FAIL — the corpus does not state " +
                 f"{len(missing)} of the {len(SYSTEMS)} mass-battle systems: "
                 + ", ".join(missing) +
                 ". Refusing to write a tool with a missing screen.")

    tbl = tables(systems)
    # Marshaling is the one screen that cannot be improvised: without strength
    # and discipline there is no army to create.
    for need in ("table31determiningarmystrength",
                 "table32determiningarmydiscipline"):
        if need not in tbl:
            sys.exit(f"FAIL — {need} is not in the corpus")
    strength = tbl["table31determiningarmystrength"]["entries"]
    if len(strength) < 11:
        sys.exit(f"FAIL — Table 3-1 has {len(strength)} status bands; the book "
                 f"prints 11")
    if not all("Maximum Strength" in e["properties"] for e in strength):
        sys.exit("FAIL — a status band with no Maximum Strength")

    doc = {"systems": systems, "tables": tbl}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write("window.L5R_ARMY = ")
        json.dump(doc, fh, ensure_ascii=False, sort_keys=True)
        fh.write(";\n")

    def count(d):
        return 1 + sum(count(c) for c in d["entries"])
    total = sum(count(d) for d in systems.values())
    print(f"{len(systems)} systems, {len(tbl)} tables, {total} DEFs "
          f"-> {os.path.relpath(OUT, ROOT)} "
          f"({os.path.getsize(OUT)/1024:.1f} KB)")
    for k in ("table31determiningarmystrength", "table34mercenaryforces",
              "table35alliedforces", "table36armymaintenancecheckresults",
              "table37ransomamounts"):
        if k in tbl:
            print(f"   {tbl[k]['name']}: {len(tbl[k]['entries'])} entries")
    bare = sorted(d["name"] for d in systems.values()
                  if not d["entries"] and not d["properties"])
    if bare:
        print(f"   FLAG — nothing stated for {len(bare)}: " + ", ".join(bare))
    return 0


if __name__ == "__main__":
    sys.exit(main())
