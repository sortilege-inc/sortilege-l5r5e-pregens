#!/usr/bin/env python3
"""Show, for one source, what the book has where a corpus string diverges.

Only reports a book continuation when the matched leading run occurs EXACTLY
ONCE in the book. A longest-prefix match on a common opening ("Increase the TN
of...") otherwise lands in an unrelated passage and invents a divergence that
is not there — which is how an earlier pass produced four false findings.

    python3 scripts/audit_probe.py <source-key> [n]
"""
import glob, json, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib.util
spec = importlib.util.spec_from_file_location("ac", os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "audit_corpus.py"))

SRC = os.path.expanduser("~/Working/sources/l5r5e")
CORPUS = os.path.expanduser("~/Working/Titterpig DSL/titterpig-dsl-l5r5e/0.4")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from audit_text import stream, strip_furniture

MAP = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                  "audit_sources.json"), encoding="utf-8"))
key = sys.argv[1]; want = int(sys.argv[2]) if len(sys.argv) > 2 else 6
cfg = MAP[key]
raw = strip_furniture("".join(open(f, encoding="utf-8", errors="replace").read()
              for g in cfg["text"] for f in sorted(glob.glob(os.path.join(SRC, g)))))
BOOK = stream(raw)
SYMBOL = re.compile(r"\((?:op|su|ex|st|ring|skill)\)|"
                    r"\b(?:opportunit(?:y|ies)|explosive\s+success(?:es)?|"
                    r"success(?:es)?|strife)\b", re.I)
BARE = re.compile(r'^[ \t]*"((?:[^"\\]|\\.){25,})"[ \t]*,?[ \t]*$', re.M)
PROPS = {"Description","Effect","Effects","Activation","Opportunities","Special",
         "Title Ability Effect","Magnitude","Enhancement Effect","Burst Effect","Check",
         "Requirement","Charge","Restriction","Quirk","Profile","Grips","Advances",
         "Sealed Invocation","Sealed Inversion","Replace Advantages","Replace Disadvantages"}
PROP = re.compile(r'\^"([^"]+)"\s+STRING\s+"((?:[^"\\]|\\.){25,})"')

def unique_prefix(cs):
    """Longest leading run present in the book, and whether it is unique there.

    Uniqueness is the guard: a run like "increasethetnof" occurs in dozens of
    unrelated rules, so a continuation taken from an ambiguous match describes
    some other rule entirely.
    """
    lo, hi = 0, len(cs)
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if cs[:mid] in BOOK:
            lo = mid
        else:
            hi = mid - 1
    return lo, (BOOK.count(cs[:lo]) == 1 if lo else False)


shown = 0
for g in cfg["corpus"]:
    for p in sorted(glob.glob(os.path.join(CORPUS, "l5r5e-0.4-" + g + ".ttrpg"))):
        body = open(p, encoding="utf-8").read()
        ss = [m.group(1) for m in BARE.finditer(body)]
        ss += [m.group(2) for m in PROP.finditer(body) if m.group(1) in PROPS]
        for s in ss:
            cs = stream(s)
            if cs in BOOK or SYMBOL.search(s): continue
            n, uniq = unique_prefix(cs)
            print("[%s]" % os.path.basename(p).replace("l5r5e-0.4-","").replace(".ttrpg",""))
            print("  corpus: %s" % s[:190])
            if n >= 40 and uniq:
                i = BOOK.index(cs[:n])
                print("  shared: %d chars, then" % n)
                print("    corpus -> %s" % (cs[n:n+95] or "(ends)"))
                print("    book   -> %s" % BOOK[i+n:i+n+95])
            else:
                print("  shared: %d chars, %s" % (n, "not unique — no reliable comparison"
                      if n >= 40 else "no foothold; this wording is not in the book"))
            print()
            shown += 1
            if shown >= want: sys.exit(0)
