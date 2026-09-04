#!/usr/bin/env python3
"""Every Legacy template in the line, and what a predecessor must be to qualify.

A Legacy is *Legacies of War*'s alternative to the heritage table: when a player
makes a new character mid-campaign they may take on the Legacy of their last PC,
and if they do they apply no result from Question 18. Each template states a
Ring, one or more Categories, a Requirement the predecessor must satisfy, a
Charge (what removes or gains strife), and Effects (a narrative boon and a
reroll).

Read from the resolved corpus, so errata are already applied.

The Requirement is prose, and about half of them are arithmetic on the
predecessor's own record — "75 or more glory", "5 ranks in Sentiment". Those are
emitted as a `test` a tool can actually run against a character, so the Creator
can say who qualifies instead of asking someone to check ten paragraphs by
hand. The other half turn on what happened in play — whether a ninjō went
unfulfilled, whether a death earned honor — and are emitted as `judgement`,
which is a question for the table and not a thing to guess at.

    python3 scripts/legacy_tables.py

Writes data/chargen/legacies.js (window.L5R_LEGACIES): the templates, and the
custom-template framework's steps as the corpus states them.
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RESOLVED = os.path.join(ROOT, "pipeline", "dsl", "l5r5e-resolved.ttrpg")
OUT = os.path.join(ROOT, "data", "chargen", "legacies.js")

# What a Requirement means in terms a tool can evaluate, keyed by template.
# Deliberately explicit and per template: the prose is not a grammar, and a
# requirement guessed wrong either offers a Legacy the predecessor never earned
# or withholds one they did.
#
#   social  <attr> <op> <n>     the predecessor's honor / glory / status
#   skill   <skill> >= <n>      a skill rank on their highest tier
#   count   <kind> >= <n>       how many peculiarities of a kind they hold
#   judgement                   a question for the table; no test to run
TESTS = {
    "Dreams Unfulfilled": {"judgement":
        "Was their ninjō left unfulfilled, and are they not still pursuing it?"},
    "Duty Bound": {"judgement":
        "Was their giri left unfulfilled, and are they not still pursuing it?"},
    "Heart-Reader": {"test": {"kind": "skill", "skill": "sentiment",
                              "op": ">=", "value": 5}},
    "Hero's Death": {"judgement":
        "Did their death earn them 10 or more honor, or 10 or more glory?"},
    "Heroic Life": {"test": {"kind": "social", "attr": "glory",
                             "op": ">=", "value": 75}},
    "Idealism": {"test": {"kind": "social", "attr": "honor",
                          "op": ">=", "value": 75}},
    "Inherited Connections": {
        "test": {"kind": "count", "of": "connection", "op": ">=", "value": 5},
        "judgement":
            "Count Ally, Support and comparable connection advantages — the "
            "book allows any combination.",
        # The one template in the line that obliges the SUCCESSOR to do
        # something at their own character creation, rather than only asking
        # what the predecessor was. Structured so the wizard can require it
        # instead of printing a sentence and hoping.
        "successor": {"kind": "advantage", "n": 1,
                      "any_of": ["Ally", "Support of"]}},
    "Notorious Scoundrel": {"test": {"kind": "social", "attr": "glory",
                                     "op": "<=", "value": 20}},
    "Pragmatist": {"test": {"kind": "social", "attr": "honor",
                            "op": "<=", "value": 20}},
    "Secret Teachings": {"judgement":
        "Did they prove themselves an accomplished warrior, courtier or "
        "mystic — the book asks for an approach the GM accepts as proof?"},
}


def block(text, start):
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


def strings(body):
    """^"Name" STRING "…" pairs, however the line is wrapped."""
    return {k: clean(v) for k, v in re.findall(
        r'\^"([^"]+)"\s+STRING\s+"((?:[^"\\]|\\.)*)"', body)}


def string_list(body, name):
    m = re.search(r'\^"' + re.escape(name) + r'"\s+LIST OF STRING\s*\[([^\]]*)\]',
                  body)
    return [clean(x) for x in re.findall(r'"([^"]+)"', m.group(1))] if m else []


def steps(text):
    """The custom-template framework, as the corpus comments state it.

    Kept verbatim: it is the book's own four steps, and a paraphrase of a
    design framework is worth nothing to whoever is following it.
    """
    m = re.search(r'\^"Custom Legacy Template Guidelines"\s+DEF\s*\{', text)
    if not m:
        return []
    body, _ = block(text, m.end() - 1)
    out, cur = [], []
    for line in body.splitlines():
        s = line.strip()
        if not s.startswith("#"):
            if cur:
                out.append(clean(" ".join(cur)))
                cur = []
            continue
        s = re.sub(r"^#\s?", "", s)
        if re.match(r"Step \d", s) and cur:
            out.append(clean(" ".join(cur)))
            cur = []
        cur.append(s)
    if cur:
        out.append(clean(" ".join(cur)))
    return [s for s in out if re.match(r"Step \d", s)]


def successor_sentence(props):
    """The sentence a template addresses to the successor, if it has one.

    Quoted rather than summarised: it is the rule the successor has to follow,
    and it belongs on their sheet in the book's words.
    """
    blob = " ".join(str(props.get(f) or "") for f in
                    ("Requirement", "Charge", "Effects", "Recovery Note"))
    m = re.search(r"[^.]*\bsuccessor\b[^.]*\.", blob)
    return clean(m.group(0)) if m else None


def main():
    if not os.path.exists(RESOLVED):
        sys.exit(f"no resolved corpus at {RESOLVED} — run "
                 f"scripts/dsl_rules_text.py --refresh")
    text = open(RESOLVED, encoding="utf-8").read()

    m = re.search(r'\^"Legacies of War Legacy Templates"\s+DEF\s*\{', text)
    if not m:
        sys.exit("the corpus has no Legacy template table")
    body, _ = block(text, m.end() - 1)

    out = {}
    for em in re.finditer(r'(?:#(?P<hash>\S+)\s+)?\^"(?P<name>[^"]+)"\s+DEF\s*\{',
                          body):
        eb, _ = block(body, em.end() - 1)
        p = strings(eb)
        if p.get("Type") != "Legacy":
            continue
        name = clean(em.group("name"))
        spec = TESTS.get(name, {})
        out[re.sub(r"[^a-z0-9]+", "", name.lower())] = {
            "name": name,
            "hash": em.group("hash"),
            "ring": p.get("Ring"),
            "categories": string_list(eb, "Category"),
            "requirement": p.get("Requirement"),
            "charge": p.get("Charge"),
            "effects": p.get("Effects"),
            "recovery_note": p.get("Recovery Note"),
            "test": spec.get("test"),
            "judgement": spec.get("judgement"),
            "successor": spec.get("successor"),
            "successor_text": successor_sentence(p),
        }

    framework = steps(text)
    with open(OUT, "w") as f:
        f.write("window.L5R_LEGACIES = ")
        json.dump({"templates": out, "framework": framework}, f,
                  ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")

    print(f"{len(out)} Legacy templates -> {os.path.relpath(OUT, ROOT)} "
          f"({os.path.getsize(OUT)/1024:.1f} KB)")
    tested = sum(1 for t in out.values() if t["test"])
    obliged = sum(1 for t in out.values() if t["successor"])
    print(f"   {tested} with a requirement a tool can check, "
          f"{len(out) - tested} that turn on what happened in play")
    print(f"   {obliged} that oblige the successor to do something at their "
          f"own character creation")
    print(f"   custom-template framework: {len(framework)} steps")

    # Every template must be accounted for either way, and every entry in
    # TESTS must name a template that exists — a renamed template would
    # otherwise silently lose its test.
    problems = [n["name"] for n in out.values()
                if not n["test"] and not n["judgement"]]
    # A template that puts an obligation on the successor in prose but carries
    # no structured form of it would be printed and not enforced, which is the
    # same as not having it.
    unenforced = [t for t in out.values()
                  if t["successor_text"] and not t["successor"]]
    for t in unenforced:
        print(f"   UNENFORCED successor obligation: {t['name']} — "
              f"{t['successor_text']}")
    problems += [t["name"] for t in unenforced]
    stray = [k for k in TESTS
             if re.sub(r"[^a-z0-9]+", "", k.lower()) not in out]
    for n in problems:
        print(f"   UNCLASSIFIED requirement: {n}")
    for k in stray:
        print(f"   TESTS names a template the corpus does not have: {k}")
    for t in out.values():
        for field in ("ring", "requirement", "charge", "effects"):
            if not t[field]:
                print(f"   {t['name']}: no {field} in the corpus")
    if problems or stray:
        sys.exit(1)


if __name__ == "__main__":
    main()
