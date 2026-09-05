#!/usr/bin/env python3
"""The relationship map's data: who is in a campaign and who they know.

    python3 scripts/relationship_map.py     -> data/relmap.js

Three things go on the map, per campaign:

  * every PC in it, from src/characters/*.json;
  * every NPC those PCs named while being made — the question 16 contacts, the
    question 13 mentor, the question 5 lord;
  * an edge between every pair of PCs, because a party has a relationship
    whether or not anyone has written it down yet. The ones that have been
    written carry their text; the rest are marked undefined, which is the point
    — the map should show what still needs deciding.

The published pregens are the second half of the map, kept apart from the
archive's campaigns rather than mixed into them. They arrive with no campaign
on them, so before this they all landed in one "Unassigned" group -- 26 folios
from four different products drawn as a single party of 28 with 378 lines
between people who have never met. Now each product is its own party, which is
what it shipped as, and the group says so.

Their edges come from the folios themselves. The Highwayman's six sheets carry
a full matrix of who thinks what of whom ("Haruko: Friendly, she seems like a
kindred spirit who has seen struggle"), which is exactly this map's material,
and both directions of a pair are shown because they often disagree. A pair the
folios say nothing about is drawn faintly and is NOT counted as work to do:
nobody here has to write it. That distinction is why these are `folio` edges
and not `party` ones.

PC-to-PC text comes from the `Cross-character` section of a concept in
src/foundry_sources.json, written as `**A ↔ B** — what it is`. Those are prep
notes rather than published prose, and they are on the map deliberately
(Jordan, 2026-09-03): this surface is for the people running the game.

A clan is NOT a relationship. Two people being Tortoise says nothing about
whether they have ever met, so an NPC's affiliation rides along as a label on
the NPC and never as an edge.
"""
import glob, json, os, re, unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "src", "characters")
SOURCES = os.path.join(ROOT, "src", "foundry_sources.json")
OUT = os.path.join(ROOT, "data", "relmap.js")

DASH = re.compile(r"\s+[—–]\s+")
PAREN = re.compile(r"^(.*?)\s*\(([^)]*)\)\s*$")
CROSS = re.compile(r"^\s*\*\*(.+?)\s*↔\s*(.+?)\*\*\s*[—–]?\s*(.*)$", re.M)

# A person's name, then what the relationship is. Characters made in the
# Creator serialise as `Name (Affiliation) — text`, but the ones written by
# hand or imported from Foundry use a colon, a hyphen, a markdown heading, or
# no separator at all, and some lines are prose that names nobody. Splitting on
# the separator alone produced an "NPC" whose name was a whole paragraph, and
# the map dutifully drew it as a label.
SEP = re.compile(r"\s*(?:[—–]|:|\s-\s)\s*")
NAME_MAX_WORDS = 5
NAME_MAX_CHARS = 44


def looks_like_a_name(s):
    """Is this a person's name, or the start of a sentence?

    Deliberately strict. A line that does not clearly begin with a name is
    skipped and counted, which is visible on every build, rather than turned
    into a node, which is not.
    """
    s = (s or "").strip()
    if not s or len(s) > NAME_MAX_CHARS or len(s.split()) > NAME_MAX_WORDS:
        return False
    if not s[0].isalpha() or not s[0].isupper():
        return False
    # A heading is not always a person: `### **The Exchange of Gifts – A Pact of
    # Brotherhood**` put "The Exchange of Gifts" on the map as someone Harunobu
    # knows. An article or a connective marks a phrase, not a Rokugani name —
    # and "Ikoma no Hosokawa Ota" survives, because `no` is a name particle and
    # is not in this list.
    if re.match(r"^(the|a|an)\b", s, re.I):
        return False
    if re.search(r"\s(?:of|and|for|to|with|in|from)\s", s, re.I):
        return False
    # "met at court, at Ayame's salon" and "her younger brother" are sentences
    return not re.search(r"[.!?,;]", s)


def split_person(line):
    """(name, affiliation, text) for a line that names someone, else None."""
    line = line.strip()
    if not line or line[0] in "-*>•":
        return None
    # `### **Akodo Masanari – A Kindred Spirit**` — a heading naming a person
    head = re.match(r"^#{1,6}\s*(.+?)\s*$", line)
    if head:
        line = head.group(1)
    line = line.replace("**", "").strip()
    parts = SEP.split(line, 1)
    who = parts[0].strip()
    text = parts[1].strip() if len(parts) > 1 else ""
    aff = ""
    m = PAREN.match(who)
    if m:
        who, aff = m.group(1).strip(), m.group(2).strip()
    return (who, aff, text) if looks_like_a_name(who) else None


def fold(s):
    s = unicodedata.normalize("NFKD", str(s or ""))
    return "".join(c for c in s if not unicodedata.combining(c)).lower().strip()


def answer(doc, step, key):
    steps = (doc.get("twenty_questions") or {}).get("steps") or {}
    return ((steps.get(step) or {}).get("answers") or {}).get(key) or ""


def contacts(doc):
    """The people this character named, and the lines that name nobody.

    Question 16 is one person per line, but only for characters made in the
    Creator, which serialises `Name (Affiliation) — what it is`. Hand-written
    and imported sheets use a colon, a dash, a markdown heading, sub-bullets,
    or plain prose about someone already mentioned. Assuming the Creator's
    shape held everywhere is what put a paragraph on the map as a person's
    name, so a line only becomes a person if split_person can see one; the
    rest come back as `skipped` and get counted on the build.
    """
    out, skipped = [], []
    for line in answer(doc, "step16", "relations").split("\n"):
        if not line.strip():
            continue
        got = split_person(line)
        if got:
            out.append({"name": got[0], "affiliation": got[1], "text": got[2],
                        "via": "knows"})
        elif len(line.strip()) > 20:
            skipped.append(line.strip())
    mentor = answer(doc, "step13", "most_learn").strip()
    if mentor:
        got = split_person(mentor)
        if got:
            out.append({"name": got[0], "affiliation": got[1], "text": got[2],
                        "via": "taught by"})
        elif len(mentor) > 20:
            skipped.append(mentor)
    lord = answer(doc, "step5", "lord_name").strip()
    if lord:
        out.append({"name": lord, "affiliation": "", "via": "serves",
                    "text": answer(doc, "step5", "social_giri").strip()})
    return out, skipped


def cross_notes(concepts):
    """`**A ↔ B** — text` out of every concept's Cross-character section.

    Reciprocal by nature — both characters' concepts usually carry the same
    pair — so they are keyed on the unordered pair and the longer text wins.
    """
    notes = {}
    for text in concepts.values():
        m = re.search(r"^#{1,6}\s*Cross-character\s*$(.*?)(?=^#{1,6}\s|\Z)",
                      text or "", re.M | re.S)
        if not m:
            continue
        for a, b, body in CROSS.findall(m.group(1)):
            key = tuple(sorted((fold(a), fold(b))))
            body = body.strip()
            if len(body) > len(notes.get(key, "")):
                notes[key] = body
    return notes


def match_pc(token, pcs):
    """A Cross-character note says "Nagiko" or "Ichirō", not the full name, and
    either the personal or the family name may be the one used. Resolve against
    the campaign's own cast, and refuse a token that fits two of them rather
    than picking one."""
    t = fold(token)
    hits = [p for p in pcs if t == fold(p["name"])
            or t in [fold(w) for w in p["name"].split()]]
    return hits[0] if len(hits) == 1 else None


def main():
    # Every character in the archive, not only the ones with a filled-in
    # twenty questions. Kuni Ryōsei and Sanpei have empty records and are still
    # in the party, and skipping them lost both their party edges and the
    # Cross-character notes that name them.
    docs = [json.load(open(path, encoding="utf-8"))
            for path in sorted(glob.glob(os.path.join(SRC, "*.json")))]
    concepts = {k: v for k, v in
                ((json.load(open(SOURCES, encoding="utf-8")).get("concepts") or {}).items())
                if not k.startswith("_")}
    notes = cross_notes(concepts)

    campaigns, unmatched, unreadable = {}, set(), {}
    by_campaign = {}
    published_docs = []
    for d in docs:
        # A published pregen is somebody else's finished character and belongs
        # to its product, not to one of this archive's campaigns. Keeping the
        # two dicts separate also avoids a collision: "Wedding at Kyotei
        # Castle" is both a product here and a declared campaign of our own.
        if d.get("provenance") == "published":
            published_docs.append(d)
            continue
        by_campaign.setdefault(d.get("campaign") or "Unassigned", []).append(d)

    for camp, members in sorted(by_campaign.items()):
        pcs, nodes, edges = [], [], []
        for d in members:
            ident = d.get("identity") or {}
            pc = {"id": "pc:" + d["slug"], "kind": "pc", "name": d["name"],
                  "slug": d["slug"], "clan": ident.get("clan"),
                  "family": ident.get("family"), "school": ident.get("school"),
                  "role": ident.get("role"),
                  "portrait": d.get("portrait")}
            pcs.append(pc)
            nodes.append(pc)

        # NPCs, keyed by folded name so the same person named by two PCs is one
        # node. None currently is, but the map should join them if it happens.
        by_pc_name = {fold(p["name"]): p for p in pcs}
        written = {}          # pair -> what each of them wrote about the other
        npcs = {}
        for d in members:
            got, skip = contacts(d)
            if skip:
                unreadable.setdefault(d["name"], []).extend(skip)
            for c in got:
                # Someone a PC names may BE another PC — Asahina Jûjirô's
                # question 16 names Doji Setsuna, who is in the same party.
                # That is a written relationship between two characters, so it
                # points at the existing node instead of standing up a second
                # one with the same name beside it.
                mine = "pc:" + d["slug"]
                pc = by_pc_name.get(fold(c["name"]))
                if pc:
                    # Held for the party pass rather than drawn now, so a pair
                    # gets one line and not two: this text and a Cross-character
                    # note are two accounts of the same relationship.
                    if pc["id"] != mine:
                        written.setdefault(
                            tuple(sorted((mine, pc["id"]))), []).append(
                                d["name"] + ": " + c["text"] if c["text"] else "")
                    continue
                key = "npc:" + fold(c["name"]).replace(" ", "-")
                n = npcs.setdefault(key, {"id": key, "kind": "npc", "name": c["name"],
                                          "affiliation": c["affiliation"], "named_by": []})
                if not n["affiliation"] and c["affiliation"]:
                    n["affiliation"] = c["affiliation"]
                n["named_by"].append(d["name"])
                edges.append({"a": mine, "b": key, "kind": c["via"],
                              "text": c["text"], "defined": True})
        nodes.extend(npcs[k] for k in sorted(npcs))

        # Every pair of PCs, written up or not. Two sources can describe a pair
        # — a Cross-character note, and one of them naming the other at
        # question 16 — and either counts as written.
        for i, p in enumerate(pcs):
            for q in pcs[i + 1:]:
                parts = []
                for key, body in notes.items():
                    m1, m2 = (match_pc(key[0], pcs), match_pc(key[1], pcs))
                    if m1 and m2 and {m1["id"], m2["id"]} == {p["id"], q["id"]}:
                        parts.append(body)
                        break
                parts.extend(t for t in
                             written.get(tuple(sorted((p["id"], q["id"]))), []) if t)
                text = "\n\n".join(parts)
                edges.append({"a": p["id"], "b": q["id"], "kind": "party",
                              "text": text, "defined": bool(text)})
        campaigns[camp] = {"nodes": nodes, "edges": edges,
                           "pcs": len(pcs), "npcs": len(npcs)}

    # ---------------------------------------------------------- the folios
    published, by_product = {}, {}
    for d in published_docs:
        by_product.setdefault((d.get("published") or {}).get("product")
                              or "Unattributed", []).append(d)
    for product, members in sorted(by_product.items()):
        pcs, nodes, edges = [], [], []
        for d in sorted(members, key=lambda x: x["name"]):
            ident = d.get("identity") or {}
            pc = {"id": "pc:" + d["slug"], "kind": "pc", "name": d["name"],
                  "slug": d["slug"],
                  # a folio's own clan, or its region for a non-core sheet, so
                  # the node is coloured by something rather than by nothing
                  "clan": ident.get("clan") or ident.get("region"),
                  "family": ident.get("family") or ident.get("upbringing"),
                  "school": ident.get("school"), "role": ident.get("role"),
                  "pronouns": ident.get("pronouns"),
                  "portrait": d.get("portrait"), "published": True}
            pcs.append(pc)
            nodes.append(pc)

        # What each folio says about the others. A line reads "Haruko:
        # Friendly, ..." -- a given name, not the full one -- so it is matched
        # against every token of every other pregen's name in this product.
        said = {}
        for d in members:
            mine = "pc:" + d["slug"]
            for line in (d.get("relationships") or []):
                who, _, text = str(line).partition(":")
                if not text.strip():
                    continue
                target = None
                for p2 in pcs:
                    if p2["id"] == mine:
                        continue
                    tokens = {fold(t) for t in p2["name"].split()}
                    tokens.add(fold(p2["name"]))
                    if fold(who) in tokens:
                        target = p2
                        break
                if target is None:
                    unmatched.add(f"{d['name']} → {who.strip()}")
                    continue
                said.setdefault(tuple(sorted((mine, target["id"]))), []).append(
                    d["name"].split()[-1] + " on " + who.strip() + ": "
                    + text.strip())
        for i, p in enumerate(pcs):
            for q in pcs[i + 1:]:
                text = "\n\n".join(said.get(tuple(sorted((p["id"], q["id"]))), []))
                # `folio`, not `party`: an undefined pair here is the folios
                # being silent, not a decision anyone owes.
                edges.append({"a": p["id"], "b": q["id"], "kind": "folio",
                              "text": text, "defined": bool(text)})
        first = members[0].get("published") or {}
        published[product] = {
            "nodes": nodes, "edges": edges, "pcs": len(pcs), "npcs": 0,
            "published": True,
            "adventure": first.get("adventure"),
            "publisher": first.get("publisher"), "year": first.get("year")}

    # any cross-character pair that resolved to nobody, so a renamed character
    # or a broken convention is visible instead of silently dropping an edge
    allpcs = [{"id": "pc:" + d["slug"], "name": d["name"]} for d in docs]
    for key in notes:
        for tok in key:
            if not match_pc(tok, allpcs):
                unmatched.add(tok)

    data = {"campaigns": campaigns,
            "order": sorted(campaigns, key=lambda c: (-campaigns[c]["pcs"], c)),
            "published": published,
            "published_order": sorted(published,
                                      key=lambda c: (-published[c]["pcs"], c)),
            "unmatched_cross_refs": sorted(unmatched),
            "unreadable": {k: len(v) for k, v in sorted(unreadable.items())}}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write("window.L5R_RELMAP = ")
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")

    tot_e = sum(len(v["edges"]) for v in campaigns.values())
    undef = sum(1 for v in campaigns.values() for e in v["edges"]
                if e["kind"] == "party" and not e["defined"])
    print(f"relmap:     {len(campaigns)} campaigns, "
          f"{sum(v['pcs'] for v in campaigns.values())} PCs, "
          f"{sum(v['npcs'] for v in campaigns.values())} NPCs, {tot_e} edges "
          f"({undef} party pairs still undefined) -> "
          f"{os.path.relpath(OUT, ROOT)} ({os.path.getsize(OUT)/1024:.1f} KB)")
    pub_e = sum(len(v["edges"]) for v in published.values())
    pub_def = sum(1 for v in published.values() for e in v["edges"] if e["defined"])
    if published:
        print(f"            + {len(published)} published product(s), "
              f"{sum(v['pcs'] for v in published.values())} pregens, {pub_e} "
              f"pairs ({pub_def} the folios describe themselves)")
    if unmatched:
        print("            cross-character names matching no character: "
              + ", ".join(sorted(unmatched)))
    if unreadable:
        # Not a failure — a hand-written sheet is allowed to be prose. But a
        # line the parser cannot see a name in is a person missing from the
        # map, so say how many and for whom rather than dropping them quietly.
        total = sum(len(v) for v in unreadable.values())
        print(f"            {total} relationship lines name nobody the parser "
              "can read, so they are not on the map:")
        for name, lines in sorted(unreadable.items()):
            print(f"              {name}: {len(lines)}")


if __name__ == "__main__":
    main()
