#!/usr/bin/env python3
"""Land a school built in the Creator.

    python3 scripts/apply_school.py <slug>
    python3 scripts/apply_school.py --file school.json
    python3 scripts/apply_school.py --selftest

Writes src/schools/<slug>.json and nothing else. A built school is design
material, not a character: no page reads it and the build does not publish it.

What is checked against the corpus before anything is written, all of it from
Path of Waves' "Building a School" as the corpus states it:

    role          one of Table 2-3's seven, primary first
    skills        as many as Table 2-7 makes available for the primary role
    techniques    Table 2-8's count for that role, and open access to rituals
                  plus two of the common categories
    curriculum    ranks 1-5 each hold one skill group, three skills, one
                  technique group and two techniques, and the three skills are
                  not from that rank's own skill group
    mastery       stated, because rank 6 holds nothing else
    templates     a school ability or mastery ability taken from a template
                  must name one the corpus carries, and one open to the role

Two of the book's own allowances are notes rather than faults, because the book
frames them as unusual rather than forbidden: access to ninjutsu or maho
("exceptionally rare and should only be given in unique cases"), and a school
without rituals ("some unusual, generally heretical school").
"""
import argparse, json, os, re, sys, unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTDIR = os.path.join(ROOT, "src", "schools")
DATA = os.path.join(ROOT, "data", "chargen", "schoolbuild.js")

# group -> the skills in it, as the site's own tables have them. Only used to
# check the one restriction the corpus places on a rank.
SKILL_GROUPS = {
    "artisan": ["Aesthetics", "Composition", "Design", "Smithing"],
    "martial": ["Fitness", "Martial Arts [Melee]", "Martial Arts [Ranged]",
                "Martial Arts [Unarmed]", "Meditation", "Tactics"],
    "scholar": ["Culture", "Government", "Medicine", "Sentiment", "Theology"],
    "social": ["Command", "Courtesy", "Games", "Performance"],
    "trade": ["Commerce", "Labor", "Seafaring", "Skulduggery", "Survival"],
}


def norm(s):
    s = unicodedata.normalize("NFKD", str(s or ""))
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", "", s.lower())


def corpus():
    if not os.path.exists(DATA):
        sys.exit("no data/chargen/schoolbuild.js — run "
                 "scripts/school_tables.py first")
    return json.loads(open(DATA, encoding="utf-8").read()
                      .split("=", 1)[1].strip().rstrip().rstrip(";"))


def rows(d, table):
    return (d.get("tables", {}).get(table) or {}).get("entries") or []


def for_role(d, table, role):
    """The row for a role, allowing the book's own "Courtier or Shinobi" keys."""
    if not role:
        return None
    rs = rows(d, table)
    exact = [e for e in rs if norm(e["name"]) == norm(role)]
    if exact:
        return exact[0]
    loose = [e for e in rs if role.lower() in e["name"].lower()]
    return loose[0] if loose else None


def templates_for(d, table, role):
    out = []
    for e in rows(d, table):
        r = str(e.get("Role") or "")
        if not role or r.lower() == "any" or role.lower() in r.lower():
            out.append(e["name"])
    return out


def skills_in_group(group):
    g = re.sub(r"skills?$", "", norm(group))
    return SKILL_GROUPS.get(g, [])


def check(doc, d):
    bad, notes = [], []
    roles = [e["name"] for e in d.get("roles") or []]
    got = doc.get("roles") or []
    primary = doc.get("primary_role")

    if not doc.get("school"):
        bad.append("the school has no slug")
    if not got:
        bad.append("no role; everything else follows from the primary role")
        return bad, notes
    for r in got:
        if r not in roles:
            bad.append(f"{r!r} is not one of Table 2-3's seven roles")
    if primary != got[0]:
        bad.append(f"primary_role is {primary!r} but the first role listed is "
                   f"{got[0]!r}")

    # step 5 -- as many skills as the role makes available
    t7 = for_role(d, "table27skillchoices", primary)
    if t7:
        want = int(t7.get("Skills Available") or 0)
        have = len(doc.get("skills_available") or [])
        if have != want:
            bad.append(f"{have} skills available; Table 2-7 gives a "
                       f"{t7['name']} school {want}")
        if doc.get("skill_picks") not in (None, int(t7.get("Skill Picks") or 0)):
            bad.append(f"skill_picks is {doc.get('skill_picks')}; Table 2-7 "
                       f"says {t7.get('Skill Picks')}")
        dupes = [s for s in set(doc.get("skills_available") or [])
                 if (doc["skills_available"]).count(s) > 1]
        if dupes:
            bad.append("a skill is available twice: " + ", ".join(sorted(dupes)))

    # step 4 -- two increases, each one of the five rings, named the same way
    RINGS = ("air", "earth", "fire", "water", "void")
    for which in ("first", "second"):
        v = (doc.get("rings") or {}).get(which)
        if v and str(v).lower() not in RINGS:
            bad.append(f"the {which} ring increase is {v!r}, not one of the "
                       f"five rings")
        elif v and str(v) != str(v).lower():
            bad.append(f"the {which} ring increase is {v!r}; a ring is held as "
                       f"its lowercase key everywhere else")

    # step 6 -- rituals plus two common, and the role's count of starting techniques
    acc = d.get("technique_access") or {}
    have_acc = doc.get("technique_access") or []
    unknown = [c for c in have_acc if c not in
               (acc.get("default", []) + acc.get("common", []) +
                acc.get("rare", []))]
    if unknown:
        bad.append("technique category the corpus does not name: "
                   + ", ".join(unknown))
    common = [c for c in have_acc if c in acc.get("common", [])]
    want_common = acc.get("choose_from_common", 2)
    if len(common) != want_common:
        bad.append(f"{len(common)} common technique categories beside rituals; "
                   f"the book's shape is {want_common}")
    for c in acc.get("default", []):
        if c not in have_acc:
            notes.append(f"no open access to {c} — the book allows it for an "
                         f"unusual, generally heretical school")
    for c in acc.get("rare", []):
        if c in have_acc:
            notes.append(f"open access to {c}, which the book calls "
                         f"exceptionally rare and only for unique cases")

    t8 = for_role(d, "table28startingtechniques", primary)
    if t8:
        stated = str(t8.get("Number of Starting Techniques") or "")
        have = len(doc.get("starting_techniques") or [])
        nums = [int(x) for x in re.findall(r"\d+", stated)]
        if nums and not (min(nums) <= have <= max(nums)):
            bad.append(f"{have} starting techniques; Table 2-8 gives a "
                       f"{t8['name']} school {stated}")

    # step 7 -- five ranks of seven, and the skills not from the rank's own group
    cur = doc.get("curriculum") or []
    shape = {x["kind"]: x["n"] for x in (d.get("curriculum") or {}).get("shape") or []}
    want_ranks = (d.get("curriculum") or {}).get("ranks", 5)
    if len(cur) != want_ranks:
        bad.append(f"{len(cur)} ranks of curriculum; ranks 1-{want_ranks} each "
                   f"hold their own")
    for r in cur:
        n = r.get("rank")
        if not r.get("skill_group"):
            bad.append(f"rank {n}: no skill group")
        if len(r.get("skills") or []) != shape.get("Skill", 3):
            bad.append(f"rank {n}: {len(r.get('skills') or [])} skills, not "
                       f"{shape.get('Skill', 3)}")
        if not r.get("technique_group"):
            bad.append(f"rank {n}: no technique group")
        if len(r.get("techniques") or []) != shape.get("Technique", 2):
            bad.append(f"rank {n}: {len(r.get('techniques') or [])} techniques, "
                       f"not {shape.get('Technique', 2)}")
        own = [norm(x) for x in skills_in_group(r.get("skill_group"))]
        clash = [s for s in (r.get("skills") or []) if norm(s) in own]
        if clash:
            bad.append(f"rank {n}: " + ", ".join(clash) + " in " +
                       f"{r.get('skill_group')}, the rank's own skill group — "
                       f"the three skills come from outside it")
        if r.get("skills_in_own_group") and \
                sorted(r["skills_in_own_group"]) != sorted(clash):
            bad.append(f"rank {n}: the Creator reports "
                       f"{r['skills_in_own_group']} in the rank's own group, "
                       f"the corpus's groups give {clash}")

    if not (doc.get("mastery") or {}).get("text"):
        bad.append("no mastery ability; rank 6 holds nothing else")

    # a template must be one the corpus carries, and one open to the role
    for field, table, what in (
            ("ability", "table24genericschoolabilities", "school ability"),
            ("mastery", "table210genericmasteryabilities", "mastery ability")):
        t = (doc.get(field) or {}).get("from_template")
        if not t:
            continue
        known = [e["name"] for e in rows(d, table)]
        if t not in known:
            bad.append(f"{what} template {t!r} is not in the corpus")
        elif t not in templates_for(d, table, primary):
            bad.append(f"{what} template {t!r} is not open to a {primary} "
                       f"school")
    return bad, notes


def report(doc, d):
    bad, notes = check(doc, d)
    print(f"{doc.get('name') or 'an unnamed school'}  ({doc.get('school')})")
    print(f"  {', '.join(doc.get('roles') or []) or 'no role'}"
          + (f" · {doc['affiliation']}" if doc.get("affiliation") else ""))
    print(f"  rings {doc.get('rings', {}).get('first') or '—'} / "
          f"{doc.get('rings', {}).get('second') or '—'}"
          + (f" (known for {doc['rings']['known_for']})"
             if doc.get("rings", {}).get("known_for") else ""))
    print(f"  {len(doc.get('skills_available') or [])} skills available"
          + (f" of {doc['skills_available_n']}"
             if doc.get("skills_available_n") else "")
          + f", player picks {doc.get('skill_picks')}")
    print(f"  access: {', '.join(doc.get('technique_access') or []) or 'none'}")
    print(f"  {len(doc.get('starting_techniques') or [])} starting techniques"
          + (f" (Table 2-8: {doc['starting_techniques_n']})"
             if doc.get("starting_techniques_n") else ""))
    for r in doc.get("curriculum") or []:
        print(f"      rank {r.get('rank')}  {str(r.get('skill_group') or '—')[:18]:<20}"
              f"{', '.join(r.get('skills') or [])[:38]:<40}"
              f"{str(r.get('technique_group') or '—')[:18]}")
    for n in notes:
        print(f"\n  note: {n}")
    if bad:
        print(f"\n{len(bad)} disagreement{'s' if len(bad) != 1 else ''} with "
              f"the corpus:")
        for b in bad:
            print("    " + b)
    return bad


def write(doc):
    os.makedirs(OUTDIR, exist_ok=True)
    path = os.path.join(OUTDIR, doc["school"] + ".json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, indent=1, ensure_ascii=False, sort_keys=True)
        fh.write("\n")
    return path


def from_table(slug):
    sys.path.insert(0, os.path.join(ROOT, "scripts"))
    try:
        import drafts
    except ImportError:
        sys.exit("scripts/drafts.py is needed to read the shared table; "
                 "use --file instead")
    for x in drafts.fetch() or []:
        sb = (x.get("character") or {}).get("school_build")
        if x.get("kind") == "school" and sb and \
                re.sub(r"[^a-z0-9]+", "-",
                       (sb.get("name") or "").lower()).strip("-") == slug:
            return sb
    return None


def base(**kw):
    """A school the corpus agrees with, so a test can break exactly one thing."""
    rank = lambda n: {"rank": n, "skill_group": "Martial Skills",
                      "skills": ["Courtesy", "Culture", "Design"],
                      "technique_group": f"Rank {n} Shūji",
                      "techniques": ["A", "B"], "skills_in_own_group": []}
    doc = {
        "school": "t", "name": "T", "roles": ["Artisan"],
        "primary_role": "Artisan", "affiliation": "Crane", "summary": "s",
        "ability": {"from_template": "School Ability Template 3",
                    "choice": "Design", "text": "…"},
        "rings": {"first": "fire", "second": "air", "known_for": "Air"},
        "skills_available": ["Aesthetics", "Composition", "Courtesy", "Culture",
                             "Design", "Martial Arts [Melee]", "Smithing"],
        "skills_available_n": 7, "skill_picks": 5,
        "technique_access": ["Rituals", "Shūji", "Kata"],
        "starting_techniques": ["A", "B", "C"],
        "starting_techniques_n": "3",
        "curriculum": [rank(i) for i in range(1, 6)],
        "mastery": {"from_template": None, "text": "…"},
        "outfit": {"clothing": "c", "weapons": "w", "other": "o"},
        "notes": ""}
    doc.update(kw)
    return doc


def selftest():
    d = corpus()
    def curr(**kw):
        c = [dict(r) for r in base()["curriculum"]]
        c[0].update(kw)
        return c
    cases = [
        ("a clean school", base(), 0),
        ("a role that is not one of the seven", base(roles=["Duelist"],
                                                     primary_role="Duelist"), 2),
        # three, not one: naming Bushi as the primary while listing Artisan
        # first also makes the starting-technique count wrong (a Bushi school
        # gives 2, not 3) and the ability template ineligible (Template 3 is
        # Artisan-only). Those are real consequences of the same mistake.
        ("a primary that is not the first listed",
         base(roles=["Artisan", "Bushi"], primary_role="Bushi"), 3),
        ("too few skills available",
         base(skills_available=["Aesthetics", "Design"]), 1),
        ("the same skill available twice",
         base(skills_available=["Aesthetics", "Aesthetics", "Courtesy",
                                "Culture", "Design", "Smithing", "Composition"]), 1),
        ("one common technique category instead of two",
         base(technique_access=["Rituals", "Shūji"]), 1),
        ("an invented technique category",
         base(technique_access=["Rituals", "Shūji", "Sorcery"]), 2),
        ("too many starting techniques for the role",
         base(starting_techniques=["A", "B", "C", "D", "E"]), 1),
        ("four ranks of curriculum", base(curriculum=base()["curriculum"][:4]), 1),
        ("a rank with two skills", base(curriculum=curr(skills=["Courtesy",
                                                                "Culture"])), 1),
        ("a rank whose skills are in its own group",
         base(curriculum=curr(skill_group="Social Skills")), 1),
        ("a rank with no technique group",
         base(curriculum=curr(technique_group="")), 1),
        ("no mastery ability", base(mastery={"from_template": None, "text": ""}), 1),
        ("an ability template that does not exist",
         base(ability={"from_template": "School Ability Template 99",
                       "choice": None, "text": "x"}), 1),
        ("an ability template not open to the role",
         base(ability={"from_template": "School Ability Template 4",
                       "choice": None, "text": "x"}), 1),
        ("no role at all", base(roles=[], primary_role=None), 1),
        ("a ring named as the table prints it, not as a key",
         base(rings={"first": "fire", "second": "Air", "known_for": "Air"}), 1),
        ("a ring that is not one of the five",
         base(rings={"first": "fire", "second": "wood", "known_for": ""}), 1),
    ]
    fails = 0
    for what, doc, want in cases:
        bad, _ = check(doc, d)
        ok = len(bad) == want
        if not ok:
            fails += 1
        print(f"  {'ok  ' if ok else 'FAIL'} {what}: {len(bad)} of {want} "
              f"expected" + ("" if ok else "  -> " + "; ".join(bad)))
    print(f"\n{len(cases) - fails} of {len(cases)} checks pass")
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

    d = corpus()
    doc = (json.load(open(a.file, encoding="utf-8")) if a.file
           else from_table(a.slug))
    if not doc:
        sys.exit(f"no school called {a.slug!r} on the table")
    if a.slug and a.file and doc.get("school") != a.slug:
        sys.exit(f"the file is school {doc.get('school')!r}, not {a.slug!r}")

    bad = report(doc, d)
    if bad:
        print("\nRefusing to write. Fix the school in the Creator, or say why "
              "each of these is intended.")
        return 1
    if not a.apply:
        print(f"\nDry run. Add --apply to write "
              f"{os.path.relpath(os.path.join(OUTDIR, doc['school'] + '.json'), ROOT)}.")
        return 0
    print(f"\nwrote {os.path.relpath(write(doc), ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
