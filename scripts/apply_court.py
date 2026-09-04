#!/usr/bin/env python3
"""Land a court assembled in the Creator.

    python3 scripts/apply_court.py <slug>            # from the shared table
    python3 scripts/apply_court.py --file court.json
    python3 scripts/apply_court.py --selftest

Writes src/courts/<slug>.json and nothing else. A court is GM material -- it
holds every NPC's ninjo and the one trait from step 7 that the PCs are not
supposed to know -- so it does not go into data/, no character page reads it,
and the build does not publish it. That is the same line concept material sits
on (see CLAUDE.md).

What is checked before anything is written, all of it from Courts of Stone's
"Assembling a Court in Seven Steps" as the corpus states it:

    step 4  at most one advantage and one disadvantage per NPC
    step 5  every bond is rank 1, runs between two different people, and every
            person it names is at this court or in the party
    step 7  the hidden trait is not one of the two the players already assigned,
            and a mover's profile is an Adversary

Advantage, disadvantage and bond names must resolve in the compendium catalog,
because a name that resolves to nothing is a name nobody can look up. Profiles
and templates are checked against the catalog and the corpus respectively, and
a profile written from whole cloth is allowed -- the book says so -- but is
reported.
"""
import argparse, glob, json, os, re, sys, unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTDIR = os.path.join(ROOT, "src", "courts")
CATALOG = os.path.join(ROOT, "data", "catalog.js")
COURTDATA = os.path.join(ROOT, "data", "chargen", "court.js")


def norm(s):
    s = unicodedata.normalize("NFKD", str(s or ""))
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", "", s.lower())


def load_js(path):
    if not os.path.exists(path):
        return None
    body = open(path, encoding="utf-8").read().split("=", 1)[1].strip()
    return json.loads(body.rstrip().rstrip(";"))


# L5R5e does not file a peculiarity as "advantage" or "disadvantage" -- it
# files it as one of four kinds, two of which are advantages and two of which
# are not. The steps talk about advantages and disadvantages, so the two
# vocabularies meet here.
ADVANTAGE_KINDS = ("distinction", "passion")
DISADVANTAGE_KINDS = ("adversity", "anxiety")


def catalog():
    cat = load_js(CATALOG) or []
    out = {"advantage": {}, "disadvantage": {}, "bond": {}, "npc": {}}
    for e in cat:
        if e.get("sub_type") == "peculiarity":
            if e.get("kind") in ADVANTAGE_KINDS:
                out["advantage"][norm(e["name"])] = e["name"]
            elif e.get("kind") in DISADVANTAGE_KINDS:
                out["disadvantage"][norm(e["name"])] = e["name"]
        elif e.get("sub_type") == "bond":
            out["bond"][norm(e["name"])] = e["name"]
        elif e.get("sub_type") == "npc":
            out["npc"][norm(e["name"])] = e["name"]
    return out


def templates():
    d = load_js(COURTDATA) or {}
    return {norm(t["name"]): t["name"]
            for t in (d.get("templates") or {}).values()}


def check(doc, cat, tpl):
    """Every disagreement with the seven steps, as a list of sentences."""
    bad, notes = [], []
    npcs = doc.get("npcs") or []
    if not npcs:
        bad.append("the court has nobody at it")

    names = {}
    for i, n in enumerate(npcs):
        who = n.get("name") or n.get("role") or f"npcs[{i}]"
        tier = n.get("tier")
        if tier not in ("mover", "secondary"):
            bad.append(f"{who}: tier is {tier!r}, not mover or secondary")

        # step 4 -- one of each, and both must be real
        for kind in ("advantage", "disadvantage"):
            v = n.get(kind)
            if isinstance(v, list):
                bad.append(f"{who}: {len(v)} {kind}s; step 4 allows one")
                continue
            if v and norm(v) not in cat[kind]:
                bad.append(f"{who}: {kind} {v!r} is not in the compendium")

        # step 7 -- a hidden trait the players did not assign
        h = n.get("hidden")
        if h:
            if h.get("kind") not in ("advantage", "disadvantage"):
                bad.append(f"{who}: hidden trait kind is {h.get('kind')!r}")
            elif norm(h.get("name")) not in cat[h["kind"]]:
                bad.append(f"{who}: hidden {h['kind']} {h.get('name')!r} is "
                           f"not in the compendium")
            if norm(h.get("name")) in (norm(n.get("advantage")),
                                       norm(n.get("disadvantage"))):
                bad.append(f"{who}: the hidden trait {h.get('name')!r} is one "
                           f"the players already assigned; step 7 asks for one "
                           f"they do not know about")

        # the Court Sheet's four offence slots, and the rule they carry
        off = n.get("offenses") or []
        if len(off) > 4:
            bad.append(f"{who}: {len(off)} prior offenses; the sheet has four "
                       f"slots")
        filled = [x for x in off if x]
        if len(filled) == 4 and n.get("opposition") not in (None, "") \
                and n.get("opposition") != off[3]:
            notes.append(f"{who}: all four offenses are filled, so the rule "
                         f"makes the last to offend them ({off[3]!r}) their "
                         f"opposition, but the record says "
                         f"{n.get('opposition')!r} — the GM is the final "
                         f"arbiter, so this is a note, not a fault")

        # step 7 -- movers are Adversaries
        pt = n.get("profile_type")
        if pt and pt not in ("Adversary", "Minion"):
            bad.append(f"{who}: profile type {pt!r} is neither Adversary nor Minion")
        if tier == "mover" and pt == "Minion":
            bad.append(f"{who}: a mover with a Minion profile; the step says "
                       f"movers are Adversaries")

        prof = n.get("profile")
        if prof and norm(prof) not in cat["npc"]:
            notes.append(f"{who}: profile {prof!r} is not a published one — "
                         f"built from whole cloth, which the book allows")
        for t in n.get("templates") or []:
            if norm(t) not in tpl:
                bad.append(f"{who}: {t!r} is not an NPC template in the corpus")

        if n.get("id"):
            names.setdefault(n["id"], who)

    # step 5 -- rank 1, two different people, both of them present
    here = {norm(x) for x in list(names.values())}
    here |= {norm(n.get("name")) for n in npcs if n.get("name")}
    here |= {norm(n.get("role")) for n in npcs if n.get("role")}
    here |= {norm(p) for p in (doc.get("party") or [])}
    for i, b in enumerate(doc.get("bonds") or []):
        tag = f"bonds[{i}]"
        if norm(b.get("type")) not in cat["bond"]:
            bad.append(f"{tag}: {b.get('type')!r} is not a bond in the compendium")
        if b.get("rank") != 1:
            bad.append(f"{tag}: rank {b.get('rank')!r}; step 5 records a bond "
                       f"at rank 1")
        pair = b.get("between") or []
        if len(pair) != 2:
            bad.append(f"{tag}: a bond runs between two people, got {len(pair)}")
            continue
        if norm(pair[0]) == norm(pair[1]):
            bad.append(f"{tag}: {pair[0]!r} bonded to themself")
        for p in pair:
            if norm(p) not in here:
                bad.append(f"{tag}: {p!r} is neither at this court nor in the party")

    bondless = [n.get("name") or n.get("role") or "?" for n in npcs
                if not any(norm(n.get("name")) in {norm(x) for x in (b.get("between") or [])}
                           or norm(n.get("role")) in {norm(x) for x in (b.get("between") or [])}
                           for b in (doc.get("bonds") or []))]
    if bondless:
        notes.append(f"{len(bondless)} with no bond yet: " + ", ".join(bondless)
                     + " — step 5 asks for at least one each")
    return bad, notes


def report(doc, cat, tpl):
    npcs = doc.get("npcs") or []
    mv = [n for n in npcs if n.get("tier") == "mover"]
    sec = [n for n in npcs if n.get("tier") == "secondary"]
    print(f"{doc.get('name') or 'an unnamed court'}  ({doc.get('court')})")
    print(f"  {len(mv)} movers, {len(sec)} secondaries, "
          f"{len(doc.get('bonds') or [])} bonds, "
          f"{len(doc.get('party') or [])} in the party")
    for n in npcs:
        who = n.get("name") or n.get("role") or "?"
        print(f"      {n.get('tier','?'):<10} {who[:26]:<26} "
              f"{(n.get('profile_type') or '—'):<10}"
              f"{(n.get('advantage') or '—')[:22]:<24}"
              f"{(n.get('disadvantage') or '—')[:22]}")
        if n.get("hidden"):
            print(f"                 hidden {n['hidden'].get('kind')}: "
                  f"{n['hidden'].get('name')}")
    for b in doc.get("bonds") or []:
        pair = b.get("between") or ["?", "?"]
        print(f"      bond       {b.get('type','?'):<12} "
              f"{pair[0]} ↔ {pair[1]}  rank {b.get('rank')}")

    bad, notes = check(doc, cat, tpl)
    for n in notes:
        print(f"\n  note: {n}")
    if bad:
        print(f"\n{len(bad)} disagreement{'s' if len(bad) != 1 else ''} with "
              f"the seven steps:")
        for b in bad:
            print("    " + b)
    return bad


def write(doc):
    os.makedirs(OUTDIR, exist_ok=True)
    path = os.path.join(OUTDIR, doc["court"] + ".json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, indent=1, ensure_ascii=False, sort_keys=True)
        fh.write("\n")
    return path


def from_table(slug):
    """The court off the shared-draft table, the way apply_edit.py reads one."""
    sys.path.insert(0, os.path.join(ROOT, "scripts"))
    try:
        import drafts
    except ImportError:
        sys.exit("scripts/drafts.py is needed to read the shared table; "
                 "use --file instead")
    for d in drafts.fetch() or []:
        c = (d.get("character") or {})
        ct = c.get("court")
        if d.get("kind") == "court" and ct and norm(ct.get("name")) == norm(slug):
            return ct
    return None


SELFTEST = [
    # (what it is, the doc, how many disagreements are expected)
    ("a clean two-person court", {
        "court": "t", "name": "T", "party": ["Doji Setsuna"],
        "npcs": [
            {"id": "a", "tier": "mover", "role": "Daimyo", "name": "A",
             "ninjo": "x", "giri": "y", "advantage": "Ally",
             "disadvantage": "Allergy",
             "hidden": {"kind": "advantage", "name": "Ambidexterity"},
             "profile_type": "Adversary"},
            {"id": "b", "tier": "secondary", "role": "Servant", "name": "B",
             "ninjo": "x", "giri": "y", "advantage": "Ambidexterity",
             "disadvantage": "Battle Trauma",
             "hidden": {"kind": "disadvantage", "name": "Allergy"},
             "profile_type": "Minion"}],
        "bonds": [{"type": "Rival", "rank": 1, "between": ["A", "B"]}]}, 0),
    ("a mover with a Minion profile", {
        "court": "t", "npcs": [
            {"id": "a", "tier": "mover", "name": "A", "profile_type": "Minion"}],
        "bonds": []}, 1),
    ("a hidden trait the players assigned", {
        "court": "t", "npcs": [
            {"id": "a", "tier": "mover", "name": "A", "advantage": "Ally",
             "hidden": {"kind": "advantage", "name": "Ally"},
             "profile_type": "Adversary"}],
        "bonds": []}, 1),
    ("a bond at rank 2", {
        "court": "t", "npcs": [
            {"id": "a", "tier": "mover", "name": "A", "profile_type": "Adversary"},
            {"id": "b", "tier": "secondary", "name": "B", "profile_type": "Minion"}],
        "bonds": [{"type": "Rival", "rank": 2, "between": ["A", "B"]}]}, 1),
    ("a bond to somebody who is not there", {
        "court": "t", "npcs": [
            {"id": "a", "tier": "mover", "name": "A", "profile_type": "Adversary"}],
        "bonds": [{"type": "Rival", "rank": 1, "between": ["A", "Nobody"]}]}, 1),
    ("a bond to oneself", {
        "court": "t", "npcs": [
            {"id": "a", "tier": "mover", "name": "A", "profile_type": "Adversary"}],
        "bonds": [{"type": "Rival", "rank": 1, "between": ["A", "A"]}]}, 1),
    ("an invented bond type", {
        "court": "t", "npcs": [
            {"id": "a", "tier": "mover", "name": "A", "profile_type": "Adversary"},
            {"id": "b", "tier": "secondary", "name": "B", "profile_type": "Minion"}],
        "bonds": [{"type": "Frenemy", "rank": 1, "between": ["A", "B"]}]}, 1),
    ("two advantages on one NPC", {
        "court": "t", "npcs": [
            {"id": "a", "tier": "mover", "name": "A",
             "advantage": ["Ally", "Ambidexterity"], "profile_type": "Adversary"}],
        "bonds": []}, 1),
    ("an advantage that is not in the compendium", {
        "court": "t", "npcs": [
            {"id": "a", "tier": "mover", "name": "A",
             "advantage": "Unreasonably Handsome", "profile_type": "Adversary"}],
        "bonds": []}, 1),
    ("a template the corpus does not have", {
        "court": "t", "npcs": [
            {"id": "a", "tier": "mover", "name": "A", "profile_type": "Adversary",
             "templates": ["Sommelier Template"]}],
        "bonds": []}, 1),
    ("nobody at court", {"court": "t", "npcs": [], "bonds": []}, 1),
    ("five prior offenses in four slots", {
        "court": "t", "npcs": [
            {"id": "a", "tier": "mover", "name": "A", "profile_type": "Adversary",
             "offenses": ["a", "b", "c", "d", "e"]}],
        "bonds": []}, 1),
    ("four offenses filled, opposition agreeing", {
        "court": "t", "npcs": [
            {"id": "a", "tier": "mover", "name": "A", "profile_type": "Adversary",
             "offenses": ["w", "x", "y", "Doji Setsuna"],
             "opposition": "Doji Setsuna"}],
        "bonds": []}, 0),
    ("a tier that is neither", {
        "court": "t", "npcs": [
            {"id": "a", "tier": "bystander", "name": "A",
             "profile_type": "Adversary"}],
        "bonds": []}, 1),
]


def selftest():
    cat, tpl = catalog(), templates()
    if not cat["advantage"]:
        sys.exit("no catalog — run ./scripts/pipeline.sh first")
    if not tpl:
        sys.exit("no NPC templates — run scripts/court_tables.py first")
    fails = 0
    for what, doc, want in SELFTEST:
        bad, _ = check(doc, cat, tpl)
        ok = len(bad) == want
        # a clean court that is bondless would still report a note, not a fault
        if not ok:
            fails += 1
        print(f"  {'ok  ' if ok else 'FAIL'} {what}: {len(bad)} of {want} "
              f"expected" + ("" if ok else "  -> " + "; ".join(bad)))
    print(f"\n{len(SELFTEST) - fails} of {len(SELFTEST)} checks pass")
    return 1 if fails else 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("slug", nargs="?")
    ap.add_argument("--file")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()

    if a.selftest:
        return selftest()
    if not a.slug and not a.file:
        ap.error("a slug or --file")

    doc = (json.load(open(a.file, encoding="utf-8")) if a.file
           else from_table(a.slug))
    if not doc:
        sys.exit(f"no court called {a.slug!r} on the table")
    if a.slug and a.file and doc.get("court") != a.slug:
        sys.exit(f"the file is court {doc.get('court')!r}, not {a.slug!r}")
    if not doc.get("court"):
        sys.exit("the court has no slug")

    cat, tpl = catalog(), templates()
    if not cat["advantage"]:
        sys.exit("no catalog — run ./scripts/pipeline.sh first")

    bad = report(doc, cat, tpl)
    if bad:
        print("\nRefusing to write. Fix the court in the Creator, or say why "
              "each of these is intended.")
        return 1
    if not a.apply:
        print(f"\nDry run. Add --apply to write "
              f"{os.path.relpath(os.path.join(OUTDIR, doc['court'] + '.json'), ROOT)}.")
        return 0
    path = write(doc)
    print(f"\nwrote {os.path.relpath(path, ROOT)}")
    print("GM material: no page reads it and the build does not publish it.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
