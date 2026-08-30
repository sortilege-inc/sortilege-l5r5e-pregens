#!/usr/bin/env python3
"""Per-source fidelity audit of the l5r5e corpus, for the site's Audit section.

Two independent references, because the corpus cannot be its own witness:

  the compendium  enumerates what each book contains (name, source book, page).
                  Used for COMPLETENESS: does the corpus carry a rule for each?
  the book text   is what the book actually says.
                  Used for CORRECTNESS: is the corpus's wording the book's?

What this deliberately does NOT do: infer that a mechanic is missing because a
string is not verbatim. The corpus legitimately restructures — a removal rule
lives in REMOVED_WHEN, adjacency in its own block — so a string-level diff
reports reordering as loss. Drift is reported as drift and nothing more.

The book prints success, opportunity and strife as glyphs that pdftotext drops.
Strings carrying that notation are UNJUDGEABLE from text and are never counted
as passing. That number is the honest ceiling on confidence for each source.

    python3 scripts/audit_corpus.py            -> data/audit.js
"""
import collections, glob, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CORPUS = os.path.expanduser("~/Working/Titterpig DSL/titterpig-dsl-l5r5e/0.4")
SRC = os.path.expanduser("~/Working/sources/l5r5e")

# source key -> printed title, corpus file globs, text globs, compendium keys
SOURCES = [
  ("core", "Core Rulebook", ["core-*"], ["core-md/*.md"], ["core_rulebook"]),
  ("path-of-waves", "Path of Waves", ["path-of-waves-*"], ["path-of-waves-md/*.md"],
   ["path_of_waves"]),
  ("writ-of-the-wilds", "Writ of the Wilds", ["writ-of-wilds-*"],
   ["writ-of-the-wilds-md/*.md"], ["writ_of_the_wild"]),
  ("emerald-empire", "Emerald Empire", ["emerald-empire-*"], ["emerald-empire-md/*.md"],
   ["emerald_empire"]),
  ("courts-of-stone", "Courts of Stone", ["courts-of-stone-*"], ["courts-of-stone-md/*.md"],
   ["court_of_stones", "courts_of_stone"]),
  ("shadowlands", "Shadowlands", ["shadowlands-*"], ["shadowlands-md/*.md"], ["shadowlands"]),
  ("celestial-realms", "Celestial Realms", ["celestial-realms-*"],
   ["celestial-realms-md/*.md"], ["celestial_realms"]),
  ("five-winds", "Children of the Five Winds", ["children-of-five-winds-*"],
   ["five-winds-md/*.md"], ["children_of_the_five_winds"]),
  ("fields-of-victory", "Fields of Victory", ["fields-of-victory-*"],
   ["fields-of-victory-md/*.md"], ["fields_of_victory"]),
  ("legacies-of-war", "Legacies of War", ["legacies-of-war-*"], ["legacies-of-war-md/*.md"], []),
  ("mantis-clan", "The Mantis Clan", ["mantis-clan"], ["Mantis Clan.md"], ["the_mantis_clan"]),
  ("gm-kit", "GM Kit", ["gm-kit-*"],
   ["ESL5R05EN-DT_GM-Kit_Reference.md", "ESL5R05EN-DT_GM-Kit_Booklet-Adventure.md"], ["gm_kit"]),
  ("gm-screen", "GM Screen", ["gm-screen-*"],
   ["GM Screen.md", "ESL5R05EN-DT_GM-Kit_Screen_Reference.md"], []),
  ("daidoji-shin", "Daidoji Shin and Kasami (letter)", ["daidoji-shin-*"],
   ["L5R-Daidoji-Shin-and-Kasami-letter.md"], []),
  ("errata-2019", "Errata and FAQ (2019)", ["errata-faq-2019"],
   ["Errata FAQ v20 2019-09-25.md", "core-md/*.md"], []),
  ("errata-2020", "Errata and FAQ (2020)", ["errata-faq-2020"],
   ["Errata FAQ v20 2020-08-12.md", "core-md/*.md"], []),
]

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from audit_text import stream, strip_furniture

SYMBOL = re.compile(
    r"\((?:op|su|ex|st|ring|skill)\)"
    r"|\b(?:opportunit(?:y|ies)|explosive\s+success(?:es)?|success(?:es)?|strife)\b", re.I)

DEF_RE = re.compile(r'\^"([^"]+)"\s+DEF\s*\{')
BARE = re.compile(r'^[ \t]*"((?:[^"\\]|\\.){25,})"[ \t]*,?[ \t]*$', re.M)

# Rules-bearing properties. An ALLOWLIST on purpose: the corpus's own
# bookkeeping (Errata Note, Carryover From, Source Book) is long prose too, and
# a length heuristic sweeps it in. Most of the corpus's text lives here rather
# than in bare strings — NPC and technique files put it in Description, Effect
# and Activation — so sampling only bare strings measures an unrepresentative
# tenth of the corpus.
PROSE_PROPS = {
    "Description", "Effect", "Effects", "Activation", "Opportunities", "Special",
    "Title Ability Effect", "Magnitude", "Enhancement Effect", "Burst Effect",
    "Check", "Requirement", "Charge", "Restriction", "Quirk", "Profile", "Grips",
    "Advances", "Sealed Invocation", "Sealed Inversion",
    "Replace Advantages", "Replace Disadvantages",
}
PROP = re.compile(r'\^"([^"]+)"\s+STRING\s+"((?:[^"\\]|\\.){25,})"')
# names the corpus files things under, which the book has no duty to print
SCAFFOLD = re.compile(r"^(Question \d+:|Part [IVX]+:|FAQ:|Status \d)|"
                      r"^[A-Za-z ]+ \d+([-\u2013]\d+)?$|"
                      r"(Bonus|Modifiers?|Progression|Thresholds?|Interaction|Pattern|"
                      r"Contribution|Rules|Definitions?|Table|Scale|Recovery|Removal|Max|"
                      r"Reference)$")

def foothold(cs, book):
    """Longest leading run of a corpus string that the book actually prints.

    This separates the two very different things a non-verbatim string can be.
    A long foothold means the corpus is tracking the book's own sentence and
    diverged partway — compression, a dropped "such as", a dropped page
    cross-reference. A short one means the wording appears nowhere in the book:
    corpus-authored connective text, or a rule rewritten from scratch.
    """
    lo, hi = 0, len(cs)
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if cs[:mid] in book:
            lo = mid
        else:
            hi = mid - 1
    return lo


def load_text(globs):
    out = []
    for g in globs:
        out.extend(sorted(glob.glob(os.path.join(SRC, g))))
    raw = "".join(open(f, encoding="utf-8", errors="replace").read() for f in out)
    return strip_furniture(raw), len(out)

def corpus_paths(globs):
    out = []
    for g in globs:
        out.extend(sorted(glob.glob(os.path.join(CORPUS, "l5r5e-0.4-" + g + ".ttrpg"))))
    return out

def load_catalog():
    s = open(os.path.join(ROOT, "data", "catalog.js"), encoding="utf-8").read()
    return json.loads(s[s.index("=") + 1:].rstrip().rstrip(";\n").rstrip(";"))

def audit(key, title, cglobs, tglobs, packs, catalog, dsl):
    paths = corpus_paths(cglobs)
    text, nfiles = load_text(tglobs)
    book = stream(text)

    names, absent = 0, []
    verbatim = drift = unjudge = 0
    tracks = partial = novel = 0
    examples = []
    for p in paths:
        base = os.path.basename(p).replace("l5r5e-0.4-", "").replace(".ttrpg", "")
        body = open(p, encoding="utf-8").read()
        for n in DEF_RE.findall(body):
            if SCAFFOLD.search(n):
                continue
            names += 1
            if book and stream(n) not in book:
                absent.append({"file": base, "name": n})
        strings = [m.group(1) for m in BARE.finditer(body)]
        strings += [m.group(2) for m in PROP.finditer(body) if m.group(1) in PROSE_PROPS]
        for s in strings:
            if book and stream(s) in book:
                verbatim += 1
            elif SYMBOL.search(s):
                unjudge += 1
            else:
                drift += 1
                fh = foothold(stream(s), book) if book else 0
                if fh >= 60: tracks += 1
                elif fh >= 25: partial += 1
                else: novel += 1
                if len(examples) < 12:
                    examples.append({"file": base, "text": s, "foothold": fh})

    ents = [e for e in catalog if e.get("source_book") and
            e["source_book"].lower().replace(" ", "_") in packs]
    resolved = sum(1 for e in ents if e["uuid"] in dsl)

    judged = verbatim + drift
    return {
        "key": key, "title": title,
        "corpus_files": [os.path.basename(p).replace("l5r5e-0.4-", "") for p in paths],
        "text_files": nfiles, "has_text": bool(book),
        "entities": names, "names_absent": absent[:40], "names_absent_n": len(absent),
        "verbatim": verbatim, "drift": drift, "unjudgeable": unjudge,
        "drift_tracks": tracks, "drift_partial": partial, "drift_novel": novel,
        "judged": judged,
        "catalog_entries": len(ents), "catalog_resolved": resolved,
        "drift_examples": examples,
    }

def main():
    catalog = load_catalog()
    notes = json.load(open(os.path.join(ROOT, "src", "audit_notes.json"), encoding="utf-8"))
    dsl = json.load(open(os.path.join(ROOT, "pipeline", "dsl", "rules_text.json")))
    out = []
    for key, title, cg, tg, packs, in [(a, b, c, d, e) for a, b, c, d, e in SOURCES]:
        r = audit(key, title, cg, tg, packs, catalog, dsl)
        if key not in notes:
            sys.exit("no assessment written for source '%s' — see src/audit_notes.json" % key)
        r["notes"] = notes[key]
        out.append(r)
        print("%-34s %2d files, %4d entities, %4d strings (%3d verbatim, %3d drift, "
              "%3d unjudgeable), catalog %d/%d"
              % (title, len(r["corpus_files"]), r["entities"],
                 r["verbatim"] + r["drift"] + r["unjudgeable"], r["verbatim"], r["drift"],
                 r["unjudgeable"], r["catalog_resolved"], r["catalog_entries"]))
        if r["drift"]:
            print("%34s drift: %d track the book's sentence, %d partial, %d wording absent"
                  % ("", r["drift_tracks"], r["drift_partial"], r["drift_novel"]))

    # compendium source books with no corpus file at all
    known = {p for _, _, _, _, packs in SOURCES for p in packs}
    orphan = collections.Counter()
    for e in catalog:
        b = (e.get("source_book") or "").lower().replace(" ", "_")
        if b and b not in known:
            orphan[b] += 1

    path = os.path.join(ROOT, "data", "audit.js")
    with open(path, "w") as f:
        f.write("window.L5R_AUDIT = ")
        json.dump({"sources": out, "orphan_books": orphan.most_common()}, f,
                  ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    print("\nbooks in the compendium with no corpus file: %s" % (orphan.most_common() or "none"))
    print("-> %s (%.1f KB)" % (os.path.relpath(path, ROOT), os.path.getsize(path) / 1024))

main()
