#!/usr/bin/env python3
"""Do the corpus's RULES labels assert mechanics the entity actually states?

A rule entry is `#hash: some_label_in_snake_case`. The label is the only
description the rule has — the spec puts the detail in comments or documentation
— so a label is an assertion about how the game works, and nothing has ever
checked one.

Both substantive errors found so far lived here. `q14_sets_demeanor` claimed
question 14 sets a Demeanor, which it does not. `shattering_parry_reduction`
claimed Shattering Parry reduces critical-strike severity by school rank, which
is the Crab school ability. Two for two.

The test: a label's distinctive words should appear somewhere in its own
entity's text. A label asserting something its entity never says is either
redundant filing or an invention, and both are worth a human look.

This reports suspects. It does not decide.

    python3 scripts/audit_rules.py [--all]
"""
import glob, os, re, sys

CORPUS = os.path.expanduser("~/Working/Titterpig DSL/titterpig-dsl-l5r5e/0.4")
RULE = re.compile(r'^\s*#[A-Za-z0-9]{16,}:\s*([a-z0-9_]+)\s*$', re.M)
DEF_RE = re.compile(r'\^"([^"]+)"\s+DEF\s*\{')

# Words that carry no assertion: DSL furniture, and connectives that appear in
# nearly every label. Removing them keeps the test on the mechanical claim.
STOP = set("""a an and are as at be by can cannot do does for from has have if in is
it its may must no not of on once or per that the their them then there these this to
up use used uses when where which with you your rules rule effect effects value values
apply applies applied gain gains gained set sets setting check checks type types
option options entry entries table tables list lists group groups""".split())


def words(label):
    return [w for w in label.split("_") if w and w not in STOP and len(w) > 2]


def defs_with_rules(path):
    """Every DEF that declares rules, with its own text and its rule labels."""
    s = open(path, encoding="utf-8").read()
    out = []
    for m in DEF_RE.finditer(s):
        depth, i = 1, m.end()
        while depth and i < len(s):
            depth += s[i] == "{"
            depth -= s[i] == "}"
            i += 1
        body = s[m.end():i]
        labels = RULE.findall(body)
        if not labels:
            continue
        # the entity's own words: quoted text and comments alike, because a
        # label restating a comment is filing, not invention
        own = " ".join(re.findall(r'"((?:[^"\\]|\\.)*)"', body))
        own += " " + " ".join(re.findall(r"(?m)^\s*#\s(?![A-Za-z0-9]{16,}:)(.*)$", body))
        out.append((m.group(1), labels, own.lower()))
    return out


def main():
    show_all = "--all" in sys.argv
    suspects, total = [], 0
    for path in sorted(glob.glob(CORPUS + "/l5r5e-0.4-*.ttrpg")):
        base = os.path.basename(path).replace("l5r5e-0.4-", "").replace(".ttrpg", "")
        for name, labels, own in defs_with_rules(path):
            haystack = (own + " " + name).lower()
            for lab in labels:
                total += 1
                ws = words(lab)
                if not ws:
                    continue
                missing = [w for w in ws if w[:5] not in haystack]
                # every distinctive word absent = the entity never mentions this
                if len(missing) == len(ws):
                    suspects.append((base, name, lab, missing))

    print("%d rule labels; %d assert wording their entity never uses\n" % (total, len(suspects)))
    shown = suspects if show_all else [s for s in suspects if s[0].startswith("core")]
    print("%d in the core files:\n" % len(shown))
    for base, name, lab, missing in shown:
        print("  [%s] %s\n      %s" % (base, name[:52], lab))
    return 0


sys.exit(main())
