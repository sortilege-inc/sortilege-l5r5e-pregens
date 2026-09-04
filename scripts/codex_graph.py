#!/usr/bin/env python3
"""The Lore section's graph, from the corpus's .codex files.

Spec §25 gives L5R5e a stand-off lore graph: 67 .codex files asserting typed
entities and relationships over the .lore prose, sharing one ontology
(l5r5e-0.4-codex-schema.codex) that declares the category taxonomy and the
predicate vocabulary. This reads all of it and writes what a browsable,
searchable, cross-linked section needs.

    python3 scripts/codex_graph.py

Writes data/lore.js (window.L5R_LORE).

THREE THINGS THIS DOES THAT READING ONE FILE WOULD NOT:

1. Folds by name. An entity is asserted once and then *amended* by later books
   -- Kakita Ryoku is defined in Emerald Empire's history and picked up again in
   Courts of Stone's opening fiction, each time with its own SOURCE. Same rule
   as §19 identity: one name is one entity. So 1474 ENTITY blocks fold to the
   distinct people and places they describe, each carrying every book that
   mentions it.

2. Derives the other direction. The schema declares INVERSE, SYMMETRIC and
   TRANSITIVE on its predicates, and says in as many words that "a consumer
   reads both directions from one asserted fact". So "Ide Qutlugh member-of
   Unicorn Clan" also gives the Unicorn Clan a member, and a page for either
   shows the tie. Derived edges are marked `derived` so a reader can tell an
   assertion from an inference.

3. Resolves the taxonomy. Categories EXTEND one another (Palace -> Castle ->
   Place), so filtering by Place finds castles, temples and rivers too. The
   chain is emitted per type rather than flattened, so the section can offer
   both the narrow type and the broad one.

Every edge keeps the FROM quote that justifies it, verbatim, and the file it
was asserted in -- an entity page is a claim with its evidence attached, not a
summary.
"""
import glob, json, os, re, sys, unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CODEXDIR = os.path.expanduser("~/Working/Titterpig DSL/titterpig-dsl-l5r5e/0.4")
OUT = os.path.join(ROOT, "data", "lore.js")

ENTITY_RE = re.compile(r'ENTITY\s+(?:#(?P<hash>\S+)\s+)?\^"(?P<name>[^"]+)"\s*\{')
IS_RE = re.compile(r'\bIS\s+\^"([^"]+)"')
SOURCE_RE = re.compile(r'\bSOURCE\s+"([^"]+)"(?:\s+AT\s+"([^"]+)")?')
EDGE_RE = re.compile(r'\^"(?P<pred>[^"]+)"\s*->\s*\^"(?P<obj>[^"]+)"'
                     r'(?:\s+FROM\s+"(?P<quote>(?:[^"\\]|\\.)*)")?')
CAT_RE = re.compile(r'\^"([^"]+)"\s+DEF\s*\{\s*(?:EXTENDS\s+\^"([^"]+)"\s*)?\}')
REL_RE = re.compile(r'\^"(?P<pred>[^"]+)"\s*\{(?P<body>[^}]*)\}')


def norm(s):
    s = unicodedata.normalize("NFKD", str(s or ""))
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", "", s.lower())


def unescape(s):
    return (s or "").replace('\\"', '"')


def block(text, start):
    i = text.index("{", start)
    d, j = 0, i
    while j < len(text):
        if text[j] == "{":
            d += 1
        elif text[j] == "}":
            d -= 1
            if d == 0:
                return text[i + 1:j], j
        j += 1
    return text[i + 1:], len(text)


AUDIT = os.path.join(ROOT, "data", "audit.js")
SMALL = ("of", "the", "and", "a", "or", "in")

_BOOKS = None


def book_prefixes():
    """file-prefix -> book title, from the audit's own mapping.

    data/audit.js already says which corpus files belong to which book, so the
    titles come from there rather than being guessed. It maps .ttrpg files
    only, but a book's files share a prefix -- writ-of-wilds-mechanics.ttrpg
    and writ-of-wilds-character-options.lore both begin "writ-of-wilds" -- so
    the prefix is what carries across to the .lore and .codex names.
    """
    global _BOOKS
    if _BOOKS is not None:
        return _BOOKS
    _BOOKS = {}
    if os.path.exists(AUDIT):
        d = json.loads(open(AUDIT, encoding="utf-8").read()
                       .split("=", 1)[1].strip().rstrip().rstrip(";"))
        for src in d.get("sources") or []:
            names = [re.sub(r"\.\w+$", "", f) for f in src.get("corpus_files") or []]
            if not names:
                continue
            parts = [n.split("-") for n in names]
            common = []
            for i in range(min(len(x) for x in parts)):
                seg = parts[0][i]
                if all(x[i] == seg for x in parts):
                    common.append(seg)
                else:
                    break
            if common:
                _BOOKS["-".join(common)] = src.get("title") or "-".join(common)
    return _BOOKS


INITIALISMS = {"gm": "GM", "npc": "NPC", "faq": "FAQ"}


def title_case(stem):
    """A filename stem as a label, for an adventure the audit does not list.

    A trailing "-lore" is dropped: the file kind already says it, and
    "legacies-of-war-lore.lore" is the Legacies of War lore chapter, not a
    product called "Legacies of War Lore".
    """
    stem = re.sub(r"-lore$", "", stem)
    return " ".join(INITIALISMS.get(w, w if w in SMALL else w.capitalize())
                    for w in stem.split("-"))


def book_of(fname):
    """The book a corpus filename belongs to, as a label.

    The longest known prefix wins, so "children-of-five-winds-sand-road.lore"
    resolves to the book rather than to "Children" — which is what a
    non-greedy first-segment match gave, and it truncated every book on the
    page to one word. An adventure with no entry in the audit keeps its whole
    stem, title-cased, rather than its first word.
    """
    stem = re.sub(r"^l5r5e-0\.4-|\.\w+$", "", fname)
    books = book_prefixes()
    best = ""
    for pre in books:
        if (stem == pre or stem.startswith(pre + "-")) and len(pre) > len(best):
            best = pre
    return books[best] if best else title_case(stem)


def schema():
    """The taxonomy and the predicate vocabulary."""
    path = os.path.join(CODEXDIR, "l5r5e-0.4-codex-schema.codex")
    if not os.path.exists(path):
        sys.exit(f"missing {path} — the shared ontology every codex imports")
    text = open(path, encoding="utf-8").read()

    cats = {}
    m = re.search(r"\bCATEGORIES\s*\{", text)
    if m:
        body, _ = block(text, m.end() - 1)
        for cm in CAT_RE.finditer(body):
            cats[cm.group(1)] = cm.group(2)     # child -> parent, or None

    rels = {}
    m = re.search(r"\bRELATIONS\s*\{", text)
    if m:
        body, _ = block(text, m.end() - 1)
        for rm in REL_RE.finditer(body):
            b = rm.group("body")
            inv = re.search(r'INVERSE\s+\^"([^"]+)"', b)
            rels[rm.group("pred")] = {
                "inverse": inv.group(1) if inv else None,
                "symmetric": "SYMMETRIC" in b,
                "transitive": "TRANSITIVE" in b,
                "domain": (re.search(r'DOMAIN\s+\^"([^"]+)"', b) or
                           [None, None])[1] if re.search(
                               r'DOMAIN\s+\^"([^"]+)"', b) else None,
                "range": re.search(r'RANGE\s+\^"([^"]+)"', b).group(1)
                         if re.search(r'RANGE\s+\^"([^"]+)"', b) else None,
            }
    return cats, rels


def chain(cats, t):
    """A type and everything it extends, narrowest first."""
    out, seen = [], set()
    while t and t not in seen:
        out.append(t)
        seen.add(t)
        t = cats.get(t)
    return out


def read_codices(cats):
    """Every ENTITY block, folded by name."""
    ents = {}
    files = 0
    blocks = 0
    for path in sorted(glob.glob(os.path.join(CODEXDIR, "*.codex"))):
        fname = os.path.basename(path)
        if "codex-schema" in fname:
            continue
        files += 1
        text = open(path, encoding="utf-8").read()
        for m in ENTITY_RE.finditer(text):
            blocks += 1
            body, _ = block(text, m.end() - 1)
            name = m.group("name")
            key = norm(name)
            e = ents.setdefault(key, {
                "name": name, "hashes": [], "types": [], "sources": [],
                "edges": [],
            })
            if m.group("hash") and m.group("hash") not in e["hashes"]:
                e["hashes"].append(m.group("hash"))

            # a nested RELATIONSHIPS block, masked out before reading IS/SOURCE
            rel_body = ""
            rm = re.search(r"\bRELATIONSHIPS\s*\{", body)
            if rm:
                rel_body, end = block(body, rm.end() - 1)
                head = body[:rm.start()] + body[end + 1:]
            else:
                head = body

            for im in IS_RE.finditer(head):
                if im.group(1) not in e["types"]:
                    e["types"].append(im.group(1))
            for sm in SOURCE_RE.finditer(head):
                src = {"file": sm.group(1), "at": sm.group(2),
                       "book": book_of(sm.group(1)), "asserted_in": fname}
                if src not in e["sources"]:
                    e["sources"].append(src)
            for em in EDGE_RE.finditer(rel_body):
                e["edges"].append({
                    "pred": em.group("pred"), "obj": em.group("obj"),
                    "quote": unescape(em.group("quote")), "in": fname,
                })
    return ents, files, blocks


def derive(ents, rels):
    """The other direction of every asserted edge, marked as derived."""
    added = 0
    for key, e in list(ents.items()):
        for edge in list(e["edges"]):
            spec = rels.get(edge["pred"]) or {}
            back = edge["pred"] if spec.get("symmetric") else spec.get("inverse")
            if not back:
                continue
            ok = norm(edge["obj"])
            other = ents.get(ok)
            if other is None:
                # the object of an edge need not be a lore entity: clans,
                # families and schools are DEFs in the .ttrpg corpus, and §25
                # says IS and edge objects resolve to those directly. Keep it
                # as a stub so the tie is still followable.
                other = ents.setdefault(ok, {
                    "name": edge["obj"], "hashes": [], "types": [],
                    "sources": [], "edges": [], "stub": True})
            dup = any(x["pred"] == back and norm(x["obj"]) == key and
                      x.get("derived") for x in other["edges"])
            if dup:
                continue
            other["edges"].append({
                "pred": back, "obj": e["name"], "quote": edge["quote"],
                "in": edge["in"], "derived": True})
            added += 1
    return added


def main():
    if not os.path.isdir(CODEXDIR):
        sys.exit(f"missing {CODEXDIR}")
    cats, rels = schema()
    if not cats or not rels:
        sys.exit(f"FAIL — the schema gave {len(cats)} categories and "
                 f"{len(rels)} predicates; both are needed")

    ents, files, blocks = read_codices(cats)
    if not ents:
        sys.exit("FAIL — no entities found in the codices")

    # A predicate is declared either as a RELATIONS key or as the INVERSE of
    # one: the schema names both halves of a pair, and a data codex may assert
    # whichever direction the prose actually states. Nine are used that way --
    # has-member, contains, led-by, parent-of, haunts, founded-by, authored-by,
    # held-by-person, overseen-by -- so checking only the keys reported nine
    # coherence errors that were not errors.
    inverses = {}
    for pred, spec in rels.items():
        if spec.get("inverse"):
            inverses[spec["inverse"]] = pred
    for name, forward in inverses.items():
        if name in rels:
            continue
        fwd = rels[forward]
        # the mirror of the forward declaration, so an asserted inverse derives
        # back the same way an asserted forward one does
        rels[name] = {"inverse": forward,
                      "symmetric": fwd.get("symmetric"),
                      "transitive": fwd.get("transitive"),
                      "domain": fwd.get("range"),
                      "range": fwd.get("domain"),
                      "declared_as_inverse_of": forward}

    # Every predicate a data codex uses must be declared in the schema, which
    # calls an undeclared one a coherence error. Reported rather than dropped,
    # because dropping edges is how a graph quietly shrinks.
    used = set()
    for e in ents.values():
        for edge in e["edges"]:
            used.add(edge["pred"])
    undeclared = sorted(used - set(rels))
    derived = derive(ents, rels)

    # Every type asserted must be in the taxonomy, or be a mechanical DEF the
    # taxonomy deliberately does not restate (clans, families, schools).
    types_used = set()
    for e in ents.values():
        types_used.update(e["types"])
    off_taxonomy = sorted(t for t in types_used if t not in cats)

    rows = []
    for key in sorted(ents, key=lambda k: norm(ents[k]["name"])):
        e = ents[key]
        broad = []
        for t in e["types"]:
            for x in chain(cats, t):
                if x not in broad:
                    broad.append(x)
        rows.append({
            "id": key, "name": e["name"],
            "types": e["types"], "type_chain": broad,
            "sources": e["sources"], "edges": e["edges"],
            "stub": bool(e.get("stub")),
        })

    doc = {
        "categories": cats,
        "relations": rels,
        "entities": rows,
        "counts": {"files": files, "blocks": blocks, "entities": len(rows),
                   "stubs": sum(1 for r in rows if r["stub"]),
                   "asserted_edges": sum(
                       1 for r in rows for x in r["edges"]
                       if not x.get("derived")),
                   "derived_edges": derived},
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write("window.L5R_LORE = ")
        json.dump(doc, fh, ensure_ascii=False, sort_keys=True)
        fh.write(";\n")

    c = doc["counts"]
    print(f"{c['files']} codices, {c['blocks']} entity blocks -> "
          f"{c['entities']} entities ({c['stubs']} of them referenced only as "
          f"an edge's object)")
    print(f"   {c['asserted_edges']} asserted relationships, "
          f"{c['derived_edges']} read back the other way; "
          f"{len(cats)} categories, {len(rels)} predicates")
    print(f"-> {os.path.relpath(OUT, ROOT)} "
          f"({os.path.getsize(OUT)/1024:.1f} KB)")
    if undeclared:
        sys.exit(f"FAIL — {len(undeclared)} predicate(s) used but not declared "
                 f"in the schema, which the schema itself calls a coherence "
                 f"error: " + ", ".join(undeclared))
    if off_taxonomy:
        print(f"   {len(off_taxonomy)} types resolve to a mechanical DEF rather "
              f"than the lore taxonomy (clans, families, schools — §25 unifies "
              f"the two): " + ", ".join(off_taxonomy[:8])
              + ("…" if len(off_taxonomy) > 8 else ""))
    noedge = [r["name"] for r in rows if not r["edges"] and not r["stub"]]
    if noedge:
        print(f"   {len(noedge)} entities carry no relationship in either "
              f"direction")
    return 0


if __name__ == "__main__":
    sys.exit(main())
