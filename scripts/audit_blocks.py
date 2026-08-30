#!/usr/bin/env python3
"""Rank the corpus's bespoke blocks by how much of each is unverified.

A block that appears once is a hand-shaped transcription of a single printed
table or sidebar. Nothing cross-checks it, which is why all four confirmed
inventions so far live in one: DIFFICULTY_SCALE, USES, TENETS, and the
twenty-questions structure. The repeated blocks — 110 schools all shaped alike —
have each other, and verify clean.

This turns that population into a worklist: per block, how many of its strings
are printed in the book, how many drift, and how many carry symbol notation and
so cannot be settled without the page image.

    python3 scripts/audit_blocks.py [core|all]
"""
import collections, glob, json, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from audit_text import stream, strip_furniture

SRC = os.path.expanduser("~/Working/sources/l5r5e")
CORPUS = os.path.expanduser("~/Working/Titterpig DSL/titterpig-dsl-l5r5e/0.4")
BOOK = stream(strip_furniture("".join(
    open(f, encoding="utf-8", errors="replace").read()
    for f in sorted(glob.glob(SRC + "/core-md/*.md")))))

SYMBOL = re.compile(r"\((?:op|su|ex|st|ring|skill)\)|"
                    r"\b(?:opportunit(?:y|ies)|explosive\s+success(?:es)?|"
                    r"success(?:es)?|strife)\b", re.I)
BLOCK = re.compile(r'^([ \t]*)([A-Z][A-Z_]{3,})\s*\{', re.M)
STR = re.compile(r'"((?:[^"\\]|\\.){25,})"')

counts = collections.Counter()
stats = collections.defaultdict(lambda: [0, 0, 0])   # verbatim, drift, symbol
where = collections.defaultdict(set)

for path in sorted(glob.glob(CORPUS + "/l5r5e-0.4-core-*.ttrpg")):
    base = os.path.basename(path).replace("l5r5e-0.4-", "").replace(".ttrpg", "")
    s = open(path, encoding="utf-8").read()
    for m in BLOCK.finditer(s):
        kw = m.group(2)
        depth, i = 1, m.end()
        while depth and i < len(s):
            depth += s[i] == "{"
            depth -= s[i] == "}"
            i += 1
        counts[kw] += 1
        where[kw].add(base)
        for sm in STR.finditer(s[m.end():i]):
            t = sm.group(1)
            if stream(t) in BOOK:
                stats[kw][0] += 1
            elif SYMBOL.search(t):
                stats[kw][2] += 1
            else:
                stats[kw][1] += 1

# Blocks already compared against the page images. Their drift counts stay
# non-zero on purpose — the corpus states a stat table as structured properties
# while the book prints a table, so the strings differ even when every value
# matches — and re-listing them would keep sending the sweep over finished work.
done = {k: v for k, v in json.load(open(
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                 "src", "audit_verified.json"), encoding="utf-8")).items()
        if not k.startswith("_")}

rare = [k for k in counts if counts[k] <= 2]
rows = []
for k in rare:
    v, d, y = stats[k]
    if v + d + y == 0:
        continue
    if k in done:
        continue
    rows.append((d + y, k, v, d, y))
rows.sort(reverse=True)

print("Bespoke blocks in the core files, ranked by unverified content.")
print("'drift' is wording not printed in the book; 'symbols' cannot be judged")
print("from text at all and needs the page image.\n")
print("  %-26s %5s %7s %7s %8s  %s" % ("block", "ok", "drift", "symbols", "unver.", "file"))
tot_d = tot_y = 0
for unver, k, v, d, y in rows:
    tot_d += d; tot_y += y
    print("  %-26s %5d %7d %7d %8d  %s" % (k, v, d, y, unver, ",".join(sorted(where[k]))))
print("\n%d blocks still unverified; %d drifting and %d symbol-bearing strings in them."
      % (len(rows), tot_d, tot_y))
print("%d blocks already checked against the page images (src/audit_verified.json):"
      % len(done))
for k in sorted(done):
    print("  %-26s p. %-22s %s" % (k, done[k]["pages"], done[k]["result"]))
