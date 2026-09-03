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


def fold(s):
    s = unicodedata.normalize("NFKD", str(s or ""))
    return "".join(c for c in s if not unicodedata.combining(c)).lower().strip()


def answer(doc, step, key):
    steps = (doc.get("twenty_questions") or {}).get("steps") or {}
    return ((steps.get(step) or {}).get("answers") or {}).get(key) or ""


def contacts(doc):
    """The people this character named, with where each came from.

    Question 16 is written one per line as `Name (Affiliation) — what it is`,
    which is exactly how the Creator serialises its structured people, so it
    parses back rather than being guessed at.
    """
    out = []
    for line in answer(doc, "step16", "relations").split("\n"):
        line = line.strip()
        if not line:
            continue
        parts = DASH.split(line, 1)
        m = PAREN.match(parts[0].strip())
        name = (m.group(1) if m else parts[0]).strip()
        if name:
            out.append({"name": name, "affiliation": (m.group(2) if m else "").strip(),
                        "text": (parts[1] if len(parts) > 1 else "").strip(),
                        "via": "knows"})
    mentor = answer(doc, "step13", "most_learn").strip()
    if mentor:
        parts = DASH.split(mentor, 1)
        if parts[0].strip():
            out.append({"name": parts[0].strip(), "affiliation": "",
                        "text": (parts[1] if len(parts) > 1 else "").strip(),
                        "via": "taught by"})
    lord = answer(doc, "step5", "lord_name").strip()
    if lord:
        out.append({"name": lord, "affiliation": "", "via": "serves",
                    "text": answer(doc, "step5", "social_giri").strip()})
    return out


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

    campaigns, unmatched = {}, set()
    by_campaign = {}
    for d in docs:
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
        npcs = {}
        for d in members:
            for c in contacts(d):
                key = "npc:" + fold(c["name"]).replace(" ", "-")
                n = npcs.setdefault(key, {"id": key, "kind": "npc", "name": c["name"],
                                          "affiliation": c["affiliation"], "named_by": []})
                if not n["affiliation"] and c["affiliation"]:
                    n["affiliation"] = c["affiliation"]
                n["named_by"].append(d["name"])
                edges.append({"a": "pc:" + d["slug"], "b": key, "kind": c["via"],
                              "text": c["text"], "defined": True})
        nodes.extend(npcs[k] for k in sorted(npcs))

        # Every pair of PCs, written up or not.
        for i, p in enumerate(pcs):
            for q in pcs[i + 1:]:
                text = ""
                for key, body in notes.items():
                    m1, m2 = (match_pc(key[0], pcs), match_pc(key[1], pcs))
                    if m1 and m2 and {m1["id"], m2["id"]} == {p["id"], q["id"]}:
                        text = body
                        break
                edges.append({"a": p["id"], "b": q["id"], "kind": "party",
                              "text": text, "defined": bool(text)})
        campaigns[camp] = {"nodes": nodes, "edges": edges,
                           "pcs": len(pcs), "npcs": len(npcs)}

    # any cross-character pair that resolved to nobody, so a renamed character
    # or a broken convention is visible instead of silently dropping an edge
    allpcs = [{"id": "pc:" + d["slug"], "name": d["name"]} for d in docs]
    for key in notes:
        for tok in key:
            if not match_pc(tok, allpcs):
                unmatched.add(tok)

    data = {"campaigns": campaigns,
            "order": sorted(campaigns, key=lambda c: (-campaigns[c]["pcs"], c)),
            "unmatched_cross_refs": sorted(unmatched)}
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
    if unmatched:
        print("            cross-character names matching no character: "
              + ", ".join(sorted(unmatched)))


if __name__ == "__main__":
    main()
