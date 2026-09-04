#!/usr/bin/env python3
"""Land an army marshalled in the Creator.

    python3 scripts/apply_army.py <slug>
    python3 scripts/apply_army.py --file army.json
    python3 scripts/apply_army.py --selftest

Writes src/armies/<slug>.json and nothing else.

Marshaling an army is arithmetic, so this re-does the arithmetic from the
corpus rather than trusting the browser, and refuses to write when the two
disagree:

    maximum strength   the band in Table 3-1 that contains the effective
                       status, which is the marshaller's status plus their
                       stated temporary modifiers
    strength           between 5 and that maximum
    discipline         Table 3-2's formula for the bonus successes, with the
                       marshaller's Government ranks and glory rank filled in
                       (rank is the tens digit, which the corpus states)
    monthly cost       Table 3-4's rate for each mercenary force, times however
                       many of them
    outlay             the Equipment Upgrades cost of each upgrade
    allied support     the band in Table 3-5 for each ally's status

Every doctrine, upgrade, mercenary force and harsh condition must be one the
corpus names.

TWO SOURCE ANOMALIES, reproduced rather than corrected:

  - the prose says discipline is set by bonus successes and honor; Table 3-2
    says Government and glory rank and never mentions honor. The table is
    applied, because the table is the one with numbers in it.
  - Table 3-1's bands 20-24 and 24-29 both contain status 24, with different
    strengths (15 and 20). At exactly 24 the higher is accepted and either
    band is allowed in strength_band.
"""
import argparse, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTDIR = os.path.join(ROOT, "src", "armies")
ARMYDATA = os.path.join(ROOT, "data", "chargen", "army.js")


def load_js(path):
    if not os.path.exists(path):
        return None
    return json.loads(open(path, encoding="utf-8").read()
                      .split("=", 1)[1].strip().rstrip().rstrip(";"))


def corpus():
    d = load_js(ARMYDATA)
    if not d:
        sys.exit("no data/chargen/army.js — run scripts/army_tables.py first")
    return d


def entries(d, table):
    return (d.get("tables", {}).get(table) or {}).get("entries") or []


def system(d, key):
    return d.get("systems", {}).get(key) or {}


def band_range(name):
    m = re.search(r"(\d+)\s*[-–—]\s*(\d+)", str(name))
    if m:
        return int(m.group(1)), int(m.group(2))
    one = re.search(r"(\d+)", str(name))
    return (int(one.group(1)), int(one.group(1))) if one else None


def bands_for(rows, status, prop):
    out = []
    for e in rows:
        r = band_range(e["name"])
        if r and r[0] <= status <= r[1] and e["properties"].get(prop) is not None:
            out.append(e)
    return out


def rank(n):
    """The corpus states it: a rank is the tens digit (honor 35 = rank 3)."""
    return int(n or 0) // 10


def koku(s):
    m = re.search(r"([\d,]+)\s*koku", str(s or ""))
    return int(m.group(1).replace(",", "")) if m else 0


def flat_doctrines(d):
    """The doctrines that can actually be taken.

    A parent with children is a group, not a doctrine: "Clan Doctrines" states
    the terms its seven clan doctrines share, so the clans are takeable and the
    parent is not. Matches doctrineList() in assets/creator.js -- if these two
    disagree, the Creator offers something the applier rejects.
    """
    out = []
    for e in system(d, "doctrines").get("entries") or []:
        if e.get("entries"):
            out += [c["name"] for c in e["entries"]]
        else:
            out.append(e["name"])
    return out


def harsh(d):
    for e in system(d, "armymaintenance").get("entries") or []:
        if re.search(r"Harsh Conditions", e["name"], re.I):
            return [c["name"] for c in e.get("entries") or []]
    return []


def recount(doc, d):
    """The army as the corpus computes it, independent of the patch."""
    m = doc.get("marshaller") or {}
    eff = int(m.get("status") or 0) + sum(
        int(x.get("by") or 0) for x in (doc.get("status_modifiers") or []))

    sb = bands_for(entries(d, "table31determiningarmystrength"), eff,
                   "Maximum Strength")
    mx = max((int(b["properties"]["Maximum Strength"]) for b in sb),
             default=None)

    disc, formula = None, None
    bonus = int(doc.get("bonus_successes") or 0)
    for e in entries(d, "table32determiningarmydiscipline"):
        mm = re.match(r"(\d+)\s*(\+)?", e["name"])
        if not mm:
            continue
        n = int(mm.group(1))
        plus = bool(mm.group(2)) or re.search(r"\bor more\b", e["name"], re.I)
        if (bonus >= n) if plus else (bonus == n):
            formula = str(e["properties"].get("Discipline") or "")
            lead = re.match(r"^(\d+)", formula)
            disc = ((int(lead.group(1)) if lead else 0)
                    + (int(m.get("government") or 0)
                       if re.search(r"Government", formula, re.I) else 0)
                    + (rank(m.get("glory"))
                       if re.search(r"glory rank", formula, re.I) else 0))
            break

    monthly = 0
    for merc in doc.get("mercenaries") or []:
        e = next((x for x in entries(d, "table34mercenaryforces")
                  if x["name"] == merc.get("name")), None)
        if e:
            monthly += koku(e["properties"].get("Cost")) * int(merc.get("n") or 1)

    outlay = 0
    for u in doc.get("upgrades") or []:
        e = next((x for x in system(d, "equipmentupgrades").get("entries") or []
                  if x["name"] == u), None)
        if e:
            outlay += koku(e["properties"].get("Cost"))

    allied = []
    for al in doc.get("allies") or []:
        st = int(al.get("status") or 0)
        b = (bands_for(entries(d, "table35alliedforces"), st, "Modifiers")
             or bands_for(entries(d, "table35alliedforces"), st,
                          "Base Army Stats"))
        allied.append(b[0]["name"] if b else None)

    return {"eff": eff, "bands": [b["name"] for b in sb], "max": mx,
            "discipline": disc, "formula": formula, "monthly": monthly,
            "outlay": outlay, "allied": allied}


def check(doc, d):
    bad, notes = [], []
    r = recount(doc, d)
    m = doc.get("marshaller")

    if not doc.get("army"):
        bad.append("the army has no slug")
    if not m:
        bad.append("no marshaller; their status is what sets the strength")
        return bad, notes, r

    if doc.get("effective_status") != r["eff"]:
        bad.append(f"effective status: the Creator says "
                   f"{doc.get('effective_status')}, the marshaller's status "
                   f"plus their modifiers is {r['eff']}")
    if doc.get("maximum_strength") != r["max"]:
        bad.append(f"maximum strength: the Creator says "
                   f"{doc.get('maximum_strength')}, Table 3-1 at status "
                   f"{r['eff']} says {r['max']}")
    for b in doc.get("strength_band") or []:
        if b not in r["bands"]:
            bad.append(f"strength band {b!r} does not contain status {r['eff']}")

    s = doc.get("strength")
    if s is None:
        notes.append("no strength chosen yet")
    else:
        if s < 5:
            bad.append(f"strength {s}; the minimum army is 5")
        if r["max"] is not None and s > r["max"]:
            bad.append(f"strength {s} exceeds the {r['max']} that status "
                       f"{r['eff']} allows")

    if doc.get("discipline") != r["discipline"]:
        bad.append(f"discipline: the Creator says {doc.get('discipline')}, "
                   f"Table 3-2 at {doc.get('bonus_successes')} bonus "
                   f"successes gives {r['discipline']} "
                   f"({r['formula']}, Government "
                   f"{m.get('government')}, glory rank {rank(m.get('glory'))})")
    if doc.get("monthly_koku") != r["monthly"]:
        bad.append(f"monthly cost: the Creator says {doc.get('monthly_koku')}, "
                   f"Table 3-4 gives {r['monthly']}")
    if doc.get("upgrade_koku") != r["outlay"]:
        bad.append(f"outlay: the Creator says {doc.get('upgrade_koku')}, the "
                   f"upgrades cost {r['outlay']}")

    known_d, known_u = flat_doctrines(d), [
        e["name"] for e in system(d, "equipmentupgrades").get("entries") or []]
    known_m = [e["name"] for e in entries(d, "table34mercenaryforces")]
    known_h = harsh(d)
    for name, pool, what in (
            (doc.get("doctrines"), known_d, "doctrine"),
            (doc.get("upgrades"), known_u, "equipment upgrade"),
            ([x.get("name") for x in doc.get("mercenaries") or []], known_m,
             "mercenary force"),
            (doc.get("harsh_conditions"), known_h, "harsh condition")):
        for x in name or []:
            if x not in pool:
                bad.append(f"{x!r} is not a {what} the corpus names")

    for i, al in enumerate(doc.get("allies") or []):
        if al.get("band") != r["allied"][i]:
            bad.append(f"allies[{i}] ({al.get('lord')}): the Creator says band "
                       f"{al.get('band')!r}, Table 3-5 at status "
                       f"{al.get('status')} says {r['allied'][i]!r}")
    return bad, notes, r


def report(doc, d):
    bad, notes, r = check(doc, d)
    m = doc.get("marshaller") or {}
    print(f"{doc.get('name') or 'an unnamed army'}  ({doc.get('army')})")
    print(f"  marshalled by {m.get('name') or '—'} — status "
          f"{m.get('status')}" +
          (f" (+{r['eff'] - int(m.get('status') or 0)} temporary → {r['eff']})"
           if r["eff"] != int(m.get("status") or 0) else "") +
          f", Government {m.get('government')}, glory {m.get('glory')} "
          f"(rank {rank(m.get('glory'))})")
    print(f"  strength {doc.get('strength')} of {r['max']}  "
          f"[{', '.join(r['bands']) or 'no band'}]")
    print(f"  discipline {r['discipline']}   {r['formula']}")
    for al, band in zip(doc.get("allies") or [], r["allied"]):
        print(f"      ally      {str(al.get('lord'))[:24]:<26}status "
              f"{al.get('status'):<5}{band or 'no band'}")
    for merc in doc.get("mercenaries") or []:
        print(f"      mercenary {str(merc.get('name'))[:24]:<26}×{merc.get('n')}")
    for x in doc.get("doctrines") or []:
        print(f"      doctrine  {x}")
    for x in doc.get("upgrades") or []:
        print(f"      upgrade   {x}")
    for x in doc.get("harsh_conditions") or []:
        print(f"      condition {x}")
    print(f"  {r['monthly']:,} koku a month, {r['outlay']:,} koku outlay")
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
    path = os.path.join(OUTDIR, doc["army"] + ".json")
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
        a = ((x.get("character") or {}).get("army"))
        if x.get("kind") == "army" and a and \
                re.sub(r"[^a-z0-9]+", "-", (a.get("name") or "").lower()).strip("-") == slug:
            return a
    return None


def base(**kw):
    """A patch the corpus agrees with, so a test can break exactly one thing."""
    doc = {
        "army": "t", "name": "T",
        "marshaller": {"slug": None, "name": "M", "status": 50, "honor": 40,
                       "glory": 33, "glory_rank": 3, "command": 3,
                       "government": 2},
        "status_modifiers": [], "effective_status": 50, "bonus_successes": 2,
        "maximum_strength": 60, "strength_band": ["Status 50-59"],
        "strength": 40, "discipline": 27,
        "discipline_formula": "25 + ranks in Government",
        "allies": [], "mercenaries": [], "monthly_koku": 0,
        "doctrines": [], "upgrades": [], "upgrade_koku": 0,
        "harsh_conditions": [], "notes": ""}
    doc.update(kw)
    return doc


def selftest():
    d = corpus()
    cases = [
        ("a clean army", base(), 0),
        ("strength above what status allows", base(strength=200), 1),
        ("strength below the minimum of 5", base(strength=2), 1),
        ("a discipline the table does not give", base(discipline=99), 1),
        ("an effective status that ignores its modifiers",
         base(status_modifiers=[{"what": "a ship", "by": 30}]), 3),
        ("a maximum strength off its band", base(maximum_strength=150), 1),
        ("a band that does not contain the status",
         base(strength_band=["Status 100"]), 1),
        ("an invented doctrine", base(doctrines=["Hold the Line"]), 1),
        ("an invented upgrade", base(upgrades=["Siege Towers"]), 1),
        ("an invented mercenary force",
         base(mercenaries=[{"name": "Ronin Company", "n": 1}]), 1),
        ("an unpaid mercenary",
         base(mercenaries=[{"name": "Bandits", "n": 1}], monthly_koku=0), 1),
        ("an uncosted upgrade",
         base(upgrades=["Tetsubishi"], upgrade_koku=0), 1),
        ("an ally on the wrong band",
         base(allies=[{"lord": "L", "status": 50, "band": "Allied Status 100"}]), 1),
        ("no marshaller at all", base(marshaller=None), 1),
    ]
    fails = 0
    for what, doc, want in cases:
        bad, _, _ = check(doc, d)
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
        sys.exit(f"no army called {a.slug!r} on the table")
    if a.slug and a.file and doc.get("army") != a.slug:
        sys.exit(f"the file is army {doc.get('army')!r}, not {a.slug!r}")

    bad = report(doc, d)
    if bad:
        print("\nRefusing to write. The corpus is the arithmetic; fix the army "
              "in the Creator.")
        return 1
    if not a.apply:
        print(f"\nDry run. Add --apply to write "
              f"{os.path.relpath(os.path.join(OUTDIR, doc['army'] + '.json'), ROOT)}.")
        return 0
    print(f"\nwrote {os.path.relpath(write(doc), ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
