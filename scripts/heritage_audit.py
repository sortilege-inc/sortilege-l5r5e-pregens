#!/usr/bin/env python3
"""What question 18 owes each character, and whether the record reflects it.

A heritage result is not only family history. Every entry in the line carries a
social modifier, and two thirds of them grant something as well — a skill rank,
a technique from outside the school, an heirloom, a distinction. The Creator
used to record the entry's name and drop all of it, so six characters in the
archive carry a heritage whose effect never landed:

    Ichiro Tsutomu   Elevated for Service      "+1 Commerce", and has Commerce 0
    Shosuro Hisano   Dynasty Builder           "+1 Command", and has Command 0
                                               Glory -3, and has her family's 40
    Kitsuki Nagiko   Touched by the Fortunes    no Sixth Sense distinction

The Creator now folds all of it in (heritageGrants() in assets/creator.js),
which covers every character made from here on. This is the other side: it
reads the same requirements out of data/chargen/heritages.js, reports what each
existing character is still owed, and — with --apply — lands the part the dice
already settled.

What it applies:
    the entry's MODIFIERS, which are never a choice
    a skill rank the sub-roll named outright
    an advantage or disadvantage the entry confers by name

What it will not: anything that needs the player. Those are reported as owed,
for whoever is making the character to settle in the Creator.

Applying is recorded as `heritage_applied` in step 18, so a second run is a
no-op rather than a second helping of Glory -3.

    python3 scripts/heritage_audit.py            # report
    python3 scripts/heritage_audit.py --apply    # land the settled part
"""
import argparse, glob, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "src", "characters")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from generate_pregen import SKILL_GROUPS, SKILL_KEY


def js(path):
    t = open(path, encoding="utf-8").read()
    return json.loads(t[t.index("=") + 1:].rstrip().rstrip(";\n").rstrip(";"))


def norm(s):
    return re.sub(r"[^a-z0-9]+", "", str(s or "").lower())


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", str(s).lower()).strip("-")


def entry_for(tables, ans):
    """(entry, sub_range) for a character's recorded question 18."""
    # The exported record keys the entry `heritage_name`; the draft in the
    # Creator keys it `heritage`. Read either, because a wrong guess here shows
    # up as a clean "0 characters rolled on a heritage table", which reads as
    # nothing to do rather than as a bug.
    name = ans.get("heritage_name") or ans.get("heritage")
    key = ans.get("heritage_table")
    table = tables.get(key) or next(
        (t for t in tables.values() if norm(t["name"]) == norm(key)), None)
    if not table or not name:
        return None, None
    entry = next((e for e in table["entries"] if e["name"] == name), None)
    if not entry:
        return None, None
    sub = None
    if entry.get("sub_table") and ans.get("heritage_sub"):
        sub = next((r for r in entry["sub_table"]["ranges"]
                    if r["range"] + " — " + r["text"] == ans["heritage_sub"]), None)
    return entry, sub


def settled_and_owed(entry, sub, picks):
    """(what the dice settled, what still needs the player).

    A requirement with an answer already in step 18's picks counts as settled
    by the player rather than owed — which is how a character made in the fixed
    Creator reads here.
    """
    reqs = list(entry.get("requires") or []) + list((sub or {}).get("requires") or [])
    settled = {"skills": {}, "peculiarities": []}
    owed = []
    if entry.get("sub_table") and not sub:
        owed.append("the second roll, which is where this entry states its grant")
    for i, r in enumerate(reqs):
        key = "heritage." + slug(entry["name"]) + "." + str(i)
        answered = [k for k in picks if k.startswith(key)]
        kind = r.get("kind")
        if kind == "skill" and r.get("skill"):
            sk = SKILL_KEY.get(r["skill"].lower(), r["skill"].lower())
            settled["skills"][sk] = settled["skills"].get(sk, 0) + 1
        elif kind == "peculiarity" and r.get("name") and not r.get("options") \
                and not r.get("subject_options") and not r.get("subject_free"):
            settled["peculiarities"].append(r["name"])
        elif kind == "ring_swap" and r.get("optional") and not answered:
            continue                       # "you may": declining is an answer
        elif answered:
            continue                       # the player already answered it
        else:
            owed.append(f"{r.get('prompt') or kind} ({kind})")
    return settled, owed


def group_of(skill):
    for g, ss in SKILL_GROUPS.items():
        if skill in ss:
            return g
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true",
                    help="write the settled part into src/characters")
    a = ap.parse_args()

    tables = js(os.path.join(ROOT, "data", "chargen", "heritages.js"))
    nheritage = nowed = napplied = 0
    for path in sorted(glob.glob(os.path.join(SRC, "*.json"))):
        doc = json.load(open(path))
        step = ((doc.get("twenty_questions") or {}).get("steps") or {}).get("step18") or {}
        ans = step.get("answers") or {}
        entry, sub = entry_for(tables, ans)
        if not entry:
            continue                       # a prose answer, or no heritage table
        nheritage += 1
        settled, owed = settled_and_owed(entry, sub, step.get("picks") or {})
        mods = {k.lower(): int(re.sub(r"[^\-0-9]", "", v))
                for k, v in (entry.get("modifiers") or {}).items()
                if k.lower() in ("honor", "glory", "status")}
        done = bool(ans.get("heritage_applied"))
        tier = doc["tiers"][0]

        bits = [f"{k} {v:+d}" for k, v in sorted(mods.items())]
        bits += [f"{sk} +{n}" for sk, n in sorted(settled["skills"].items())]
        bits += settled["peculiarities"]
        print(f"{doc['slug']:<26} {entry['name']}")
        print(f"    settled by the dice: {', '.join(bits) or 'nothing'}"
              f"   [{'applied' if done else 'NOT APPLIED'}]")
        if owed:
            nowed += 1
            for o in owed:
                print(f"    still owed: {o}")

        if not a.apply or done:
            continue
        for k, v in mods.items():
            tier["social"][k] = (tier["social"].get(k) or 0) + v
        for sk, n in settled["skills"].items():
            g = group_of(sk)
            if not g:
                sys.exit(f"{doc['slug']}: {sk!r} is not a skill in any group")
            tier["skills"][g][sk] = (tier["skills"][g].get(sk) or 0) + n
        held = {norm(p["name"]) for p in tier["peculiarities"]}
        for p in settled["peculiarities"]:
            if norm(p) not in held:
                tier["peculiarities"].append({"name": p})
        ans["heritage_applied"] = True
        json.dump(doc, open(path, "w"), indent=1, ensure_ascii=False)
        napplied += 1
        print(f"    -> applied to {os.path.relpath(path, ROOT)}")

    print(f"\n{nheritage} characters rolled on a heritage table; "
          f"{nowed} still owe the player a choice"
          + (f"; {napplied} updated" if a.apply else ""))


if __name__ == "__main__":
    main()
