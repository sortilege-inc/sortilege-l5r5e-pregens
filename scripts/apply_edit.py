#!/usr/bin/env python3
"""Land an edit of a promoted character against its record.

A character does not stop needing changes when it is promoted: a question
answered thinly, a name settled later, a heritage grant nobody had picked. The
Creator can open a promoted character (Promoted characters, in the drafts
panel), which hydrates it into a working draft the same way an archive draft is
hydrated — but the result is not a new file. The record already exists, and it
holds things the wizard knows nothing about: the bio, the portrait, the tier
Foundry keeps, the titles and bonds, the folder it lives in. So the Creator
emits an edit patch and this merges it, field by field, with the diff shown
first.

    python3 scripts/apply_edit.py "Kuni"                  # off the shared table
    python3 scripts/apply_edit.py --file kuni-ryosei-edit.json
    python3 scripts/apply_edit.py "Kuni" --apply           # write it

What an edit may change is stated once, here, rather than in the Creator as
well — two statements of the same policy drift, and the one that matters is the
one next to the write. WIZARD is everything the wizard derives; PROSE is the
subset that is only words.

It writes differences, not values. Hydrating a record written before the wizard
carried its own state is a reconstruction: the answers come back but not the
choices behind the numbers, so re-exporting Shosuro Hisano gave Water 1 for her
Water 2 and three techniques for her four. Writing that back would have quietly
undone her. So the patch carries a `baseline` — the record as it came out of
the wizard the moment it was opened — and a field is written only where the
wizard now differs from that. A field nobody touched has no difference,
whatever the wizard managed to reconstruct of it.

Numbers move by their difference and lists by what was added and removed, so
the record keeps everything the wizard never knew about: a gear entry's custom
text, a peculiarity's filled-in subject. `derived` is recomputed from the rings
that result rather than carried across.

A character Foundry holds at more than one XP tier is prose only. Its tier 0 is
what tiers 1..N were built from, and this wizard cannot re-derive those, so a
mechanical change would leave the higher tiers no longer following from the
base. The patch says `prose_only`, and this does not take its word for it — the
tier count on disk decides.

Nothing is written without --apply, and a mechanical difference on a prose-only
character is reported and refused rather than quietly dropped.

There is no --force and nothing to override: because it writes differences, an
edit made against a record that has since moved on merges into it rather than
overwriting it. Two people editing the same field is the one case that does not
merge, and the last one to land wins — the same as it has always been for a
file two people are editing.
"""
import argparse, difflib, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "src", "characters")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import drafts as table                     # the shared-draft store and its key

# Everything the wizard owns, as paths into the character source. `tiers.0` is
# addressed as a path because the wizard only ever knows the 0 XP tier.
WIZARD = [
    "name", "campaign", "notes", "concept", "mode",
    "identity.clan", "identity.family", "identity.school", "identity.role",
    "identity.region", "identity.upbringing",
    "twenty_questions",
    "tiers.0.rings", "tiers.0.skills", "tiers.0.derived", "tiers.0.money",
    "tiers.0.school",
    "tiers.0.social.honor", "tiers.0.social.glory", "tiers.0.social.status",
    "tiers.0.social.giri", "tiers.0.social.ninjo",
    "tiers.0.social.bushido_tenets",
    "tiers.0.techniques", "tiers.0.peculiarities", "tiers.0.gear",
]

# The words. A character held at several tiers can have these changed and
# nothing downstream stops following from anything.
PROSE = [
    "name", "campaign", "notes", "concept",
    "twenty_questions",
    "tiers.0.social.giri", "tiers.0.social.ninjo",
]

# `twenty_questions` is mostly narrative, but not all of it: a few of its
# leaves name a mechanical choice rather than describe anything. Writing
# question 4's ring on a prose-only character would record a standout ring the
# character's rings do not reflect, which is worse than not recording it.
PROSE_EXCLUDE = [
    r"^twenty_questions\.steps\.step4\.answers\.ring$",
    r"^twenty_questions\.steps\.step8\.answers\.tenet_",
    r"^twenty_questions\.steps\.step18\.answers\.",
    r"^twenty_questions\.steps\.[^.]+\.picks",
    r"^twenty_questions\.choices",
]


def prose_allows(path):
    return not any(re.search(p, path) for p in PROSE_EXCLUDE)


# Never written by an edit, whatever the patch says. `slug` is the file's
# identity, `status` belongs to promote.py, and the rest is either the record's
# own (bio, portrait) or nothing the wizard derives.
NEVER = {"slug", "status", "bio", "portrait", "summary", "folder_label",
         "bucket", "accent", "tiers"}


def dig(obj, path):
    for part in path.split("."):
        if obj is None:
            return None
        obj = obj[int(part)] if part.isdigit() else obj.get(part)
    return obj


def poke(obj, path, value):
    parts = path.split(".")
    for part in parts[:-1]:
        obj = obj[int(part)] if part.isdigit() else obj.setdefault(part, {})
    last = parts[-1]
    if last.isdigit():
        obj[int(last)] = value
    else:
        obj[last] = value


def canon(v):
    return json.dumps(v, sort_keys=True, ensure_ascii=False, indent=1)


# Fields that are counted rather than written: what lands is the record's own
# value plus however much the wizard moved it.
NUMERIC = {"tiers.0.rings", "tiers.0.skills", "tiers.0.money",
           "tiers.0.social.honor", "tiers.0.social.glory",
           "tiers.0.social.status"}
# Fields that are sets of named things. The record's entry is kept as the
# record wrote it — with its custom flag, its note, its filled-in subject —
# and only what the wizard added or dropped is applied.
LISTED = {"tiers.0.techniques", "tiers.0.peculiarities", "tiers.0.gear"}
# Recomputed, never carried: these follow from the rings.
DERIVED = "tiers.0.derived"


def numeric_delta(base, now):
    """{air: 1} vs {air: 2} -> {air: +1}, at any depth."""
    out = {}
    if isinstance(now, dict):
        for k in set(list((base or {}).keys()) + list(now.keys())):
            d = numeric_delta((base or {}).get(k), now.get(k))
            if d:
                out[k] = d
        return out or None
    if isinstance(now, (int, float)) or isinstance(base, (int, float)):
        d = (now or 0) - (base or 0)
        return d or None
    return None


def add_delta(value, delta):
    """Apply a numeric_delta to a copy of `value`."""
    if isinstance(delta, dict):
        out = dict(value or {})
        for k, d in delta.items():
            out[k] = add_delta(out.get(k), d)
        return out
    return (value or 0) + delta


def leaf_changes(base, now, prefix=""):
    """Every leaf where the wizard now differs from the baseline.

    Per leaf, not per field, because a field like `twenty_questions` is a whole
    tree: one edited answer inside it must not carry the rest of the tree with
    it. Writing the object wholesale wiped question 13's answer on the first
    real run of this — hydrate had not read it, so the wizard's copy was empty,
    and it was empty in the baseline too. Compared leaf by leaf, an empty
    answer that was already empty in the baseline is not a change.

    A key the baseline has and the wizard does not is left alone: the record
    carries things the wizard never modelled, and absence is not deletion.
    """
    if isinstance(now, dict) and isinstance(base, dict):
        out = []
        for k in now:
            out += leaf_changes(base.get(k), now[k], prefix + "." + k)
        return out
    if canon(base) == canon(now):
        return []
    return [(prefix.lstrip("."), now)]


def named(entries):
    return [e.get("name") for e in (entries or [])]


def list_delta(base, now):
    """(added, removed) by name, as the wizard sees them."""
    b, n = named(base), named(now)
    return ([e for e in (now or []) if e.get("name") not in b],
            [x for x in b if x not in n])


def recompute_derived(rings, was):
    """Endurance, composure, focus, vigilance and void points, from the rings.

    The same five formulas the Creator and the pregen generator use. Anything
    else the record's `derived` carries is left as it is.
    """
    r = {k: (rings or {}).get(k) or 0 for k in
         ("air", "earth", "fire", "water", "void")}
    out = dict(was or {})
    out.update({"endurance": (r["earth"] + r["fire"]) * 2,
                "composure": (r["earth"] + r["water"]) * 2,
                "focus": r["air"] + r["fire"],
                "vigilance": -(-(r["air"] + r["water"]) // 2),
                "void_points": r["void"]})
    return out


def show(path, old, new):
    if isinstance(old, (dict, list)) or isinstance(new, (dict, list)):
        a, b = canon(old).splitlines(), canon(new).splitlines()
        lines = [l for l in difflib.unified_diff(a, b, lineterm="", n=1)
                 if not l.startswith(("---", "+++", "@@"))]
        print(f"  {path}")
        for l in lines[:24]:
            print("      " + l)
        if len(lines) > 24:
            print(f"      … {len(lines) - 24} more lines")
    else:
        print(f"  {path}\n      was: {old!r}\n      now: {new!r}")


def plan_edit(doc, was, new, fields):
    """(plan, refused) — what to write, and what this character will not allow.

    Every write is a difference from the baseline, so a field the editor never
    touched is not written at all, whatever hydrating the record made of it.
    """
    plan, refused = [], []
    for f in sorted(set(WIZARD)):
        if f == DERIVED:
            continue                       # recomputed below, never carried
        base, want, have = dig(was, f), dig(new, f), dig(doc, f)
        if canon(base) == canon(want):
            continue                       # nobody changed this
        if f not in fields:
            refused.append(f)
            continue
        if f in NUMERIC:
            d = numeric_delta(base, want)
            if not d:
                continue
            plan.append((f, have, add_delta(have, d), "moved by " + canon(d)))
        elif f in LISTED:
            added, removed = list_delta(base, want)
            keep = [e for e in (have or []) if e.get("name") not in removed]
            note = ", ".join([f"+{e['name']}" for e in added] +
                             [f"-{x}" for x in removed])
            plan.append((f, have, keep + added, note))
        else:
            for sub, value in leaf_changes(base, want):
                at = f + ("." + sub if sub else "")
                if fields is PROSE and not prose_allows(at):
                    refused.append(at)
                    continue
                plan.append((at, dig(doc, at), value, None))

    rings = next((v for f, _, v, _ in plan if f == "tiers.0.rings"), None)
    if rings is not None:
        plan.append((DERIVED, dig(doc, DERIVED),
                     recompute_derived(rings, dig(doc, DERIVED)),
                     "recomputed from the rings"))
    return plan, refused


def selftest():
    """Check the difference rules against the case they exist for.

    The case: hydrating a record loses something, so the baseline disagrees
    with the record on a field nobody edited. That field must not be written.
    Anything else here is a regression guard on the arithmetic.
    """
    record = {
        "name": "Test Character", "notes": "as the record has it",
        "tiers": [{"rings": {"air": 2, "earth": 3, "fire": 2, "water": 2,
                             "void": 2},
                   "derived": {"endurance": 10, "composure": 10, "focus": 4,
                               "vigilance": 2, "void_points": 2},
                   "skills": {"martial": {"melee": 2, "fitness": 1}},
                   "money": {"zeni": 0, "koku": 5, "bu": 0},
                   "social": {"honor": 45, "glory": 40, "status": 30},
                   "techniques": [{"name": "Deadly Sting"},
                                  {"name": "Sensational Distraction"}],
                   "peculiarities": [{"name": "Support of the Yogo",
                                      "custom": True}],
                   "gear": [{"name": "Katana"}]}]}
    # what hydrating it produced: Water lost a rank, a technique went missing,
    # and the notes came back empty
    base = json.loads(json.dumps(record))
    base["tiers"][0]["rings"]["water"] = 1
    base["tiers"][0]["techniques"] = [{"name": "Deadly Sting"}]
    base["notes"] = ""
    # ...and what the editor then changed: one ring up, one technique taken,
    # one peculiarity added
    now = json.loads(json.dumps(base))
    now["tiers"][0]["rings"]["air"] = 3
    now["tiers"][0]["techniques"] = [{"name": "Deadly Sting"},
                                     {"name": "Shallow Waters"}]
    now["tiers"][0]["peculiarities"] = [{"name": "Support of the Yogo"},
                                        {"name": "Sixth Sense"}]

    plan, refused = plan_edit(record, base, now, WIZARD)
    got = {f: v for f, _, v, _ in plan}
    fails = []

    def want(label, cond):
        if not cond:
            fails.append(label)

    want("a ring nobody edited is not written",
         got["tiers.0.rings"]["water"] == 2)
    want("an edited ring moves by its difference",
         got["tiers.0.rings"]["air"] == 3)
    want("derived is recomputed from the resulting rings",
         got["tiers.0.derived"] == {"endurance": 10, "composure": 10,
                                    "focus": 5, "vigilance": 3,
                                    "void_points": 2})
    want("a technique hydrate lost is kept",
         "Sensational Distraction" in named(got["tiers.0.techniques"]))
    want("a technique the editor took is added",
         "Shallow Waters" in named(got["tiers.0.techniques"]))
    want("the record's own entry keeps its flags",
         [e for e in got["tiers.0.peculiarities"]
          if e["name"] == "Support of the Yogo"][0].get("custom") is True)
    want("a peculiarity the editor added is added",
         "Sixth Sense" in named(got["tiers.0.peculiarities"]))
    want("prose the editor did not touch is not written",
         "notes" not in got)
    want("an untouched field is not in the plan at all",
         "tiers.0.money" not in got and "tiers.0.social.honor" not in got)
    want("nothing is refused when every field is allowed", not refused)

    # ...and the same edit on a character that is prose only
    plan2, refused2 = plan_edit(record, base, now, PROSE)
    want("prose only refuses the mechanical fields",
         sorted(refused2) == ["tiers.0.peculiarities", "tiers.0.rings",
                              "tiers.0.techniques"])
    want("prose only writes nothing mechanical", not plan2)

    now2 = json.loads(json.dumps(base))
    now2["notes"] = "edited"
    plan3, _ = plan_edit(record, base, now2, PROSE)
    want("an edited prose field is written outright",
         [v for f, _, v, _ in plan3 if f == "notes"] == ["edited"])

    # A tree the wizard only partly reconstructs. One edited answer must not
    # carry the rest of the tree with it — this is the case that wiped question
    # 13 on the first real run.
    record["twenty_questions"] = {"steps": {
        "step4": {"answers": {"ring": "fire", "stand_out": "as recorded"}},
        "step13": {"answers": {"most_learn": "Kaiu Michio"}},
        "step18": {"answers": {"heritage_name": "Dynasty Builder",
                               "heritage_applied": True}}}}
    tb = {"steps": {
        "step4": {"answers": {"ring": "fire", "stand_out": "as recorded"}},
        "step13": {"answers": {"most_learn": ""}},        # hydrate lost it
        "step18": {"answers": {"heritage_name": "Dynasty Builder"}}}}
    tn = json.loads(json.dumps(tb))
    tn["steps"]["step4"]["answers"]["ring"] = "earth"     # the actual edit
    plan4, _ = plan_edit(record, {"twenty_questions": tb},
                         {"twenty_questions": tn}, WIZARD)
    got4 = {f: v for f, _, v, _ in plan4}
    want("only the edited leaf of a tree is written",
         list(got4) == ["twenty_questions.steps.step4.answers.ring"])
    want("the edited leaf gets the new value",
         got4.get("twenty_questions.steps.step4.answers.ring") == "earth")

    plan5, refused5 = plan_edit(record, {"twenty_questions": tb},
                                {"twenty_questions": tn}, PROSE)
    want("a mechanical answer is refused on a prose-only character",
         not plan5 and refused5 == ["twenty_questions.steps.step4.answers.ring"])
    tn2 = json.loads(json.dumps(tb))
    tn2["steps"]["step13"]["answers"]["most_learn"] = "Hida Nao"
    plan6, refused6 = plan_edit(record, {"twenty_questions": tb},
                                {"twenty_questions": tn2}, PROSE)
    want("a narrative answer is allowed on a prose-only character",
         [f for f, _, _, _ in plan6] ==
         ["twenty_questions.steps.step13.answers.most_learn"] and not refused6)

    # The table path's refusals, with the network stubbed out. What matters
    # here is that a plain draft, an edit naming no record, and an edit whose
    # browser has not pushed a document yet are each turned away with a reason
    # rather than half-applied.
    real = table.load_body
    for label, body, expect in [
            ("a plain draft is not an edit", {"kind": "draft"}, "not an edit"),
            ("an edit must name a record", {"kind": "edit"}, "names no record"),
            ("an edit needs its exported document",
             {"kind": "edit", "fromArchive": "x"}, "no exported document")]:
        table.load_body = lambda who, b=body: (
            {"id": "t"}, {"name": "T", "rev": 1, "updated": 0, "editor": ""}, b)
        try:
            patch_from_table("T")
            want(label, False)
        except SystemExit as e:
            want(label, expect in str(e))
    table.load_body = real

    for f in fails:
        print("FAIL:", f)
    print(f"{18 - len(fails)} of 18 checks passed")
    return 1 if fails else 0


def patch_from_table(who):
    """The edit as the table has it.

    An edit draft carries the document it exports to (see draftPayload in
    assets/creator.js), because working that out means running computed() and
    only the wizard can do that. Without it, landing a one-word change would
    always need somebody at a browser.
    """
    row, full, body = table.load_body(who)
    kind = body.get("kind") or "draft"
    if kind != "edit":
        sys.exit(f"“{full['name']}” is a draft on the table, not an edit of a "
                 f"promoted character — promote it with scripts/promote.py.")
    if not body.get("fromArchive"):
        sys.exit(f"“{full['name']}” is marked as an edit but names no record")
    if not body.get("source"):
        sys.exit(f"“{full['name']}” carries no exported document yet. The "
                 f"browser writes one on its next save — open the draft, or "
                 f"use the Save step's Copy patch with --file.")
    print(f"read off the table: rev {full['rev']}, last touched "
          f"{table.ago(full['updated'])}"
          + (f" by {full['editor']}" if full.get("editor") else ""))
    return {"edit": body["fromArchive"], "prose_only": body.get("proseOnly"),
            "base_tiers": body.get("baseTiers") or 1, "source": body["source"]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("who", nargs="?", help="slug of the character being edited")
    ap.add_argument("--file", help="an edit patch downloaded from the Creator")
    ap.add_argument("--apply", action="store_true", help="write it")
    ap.add_argument("--selftest", action="store_true",
                    help="check the difference rules and exit")
    a = ap.parse_args()

    if a.selftest:
        sys.exit(selftest())

    if a.file:
        patch = json.load(open(a.file))
    else:
        if not a.who:
            ap.error("give a patch with --file, or a name to look up")
        patch = patch_from_table(a.who)
    slug = patch.get("edit") or a.who
    if not slug:
        sys.exit("the patch does not say which character it edits")
    path = os.path.join(SRC, slug + ".json")
    if not os.path.exists(path):
        sys.exit(f"no such character: {os.path.relpath(path, ROOT)}")
    doc = json.load(open(path))
    new = patch.get("source") or {}
    if not new:
        sys.exit("the patch carries no document")

    # The tier count on disk decides, not the patch — a stale patch could claim
    # a character has one tier when Foundry has since given it four.
    tiers = len(doc.get("tiers") or [])
    # And the numbers are only in reach if the wizard proved it can reproduce
    # them: `mechanics_ok` is the Creator's own round-trip check, hydrate the
    # record and see whether re-exporting it gives the record back. A record
    # written before the wizard carried its state does not, so its choices are
    # a reconstruction and its numbers are left alone.
    prose_only = tiers > 1
    fields = PROSE if prose_only else WIZARD
    print(f"{doc['name']}  ({slug}, status "
          f"{doc.get('status') or 'promoted'}, {tiers} tier"
          f"{'' if tiers == 1 else 's'})")
    if prose_only:
        print(f"  prose only — Foundry holds it at {tiers} XP tiers, whose "
              f"numbers were built from tier 0")
    if doc.get("status") == "draft":
        print("  note: still a draft on disk, so promote.py is the usual way in")

    was = patch.get("baseline")
    if not was:
        sys.exit("the patch carries no baseline, so there is no way to tell "
                 "what the edit changed from what hydrating the record could "
                 "not reconstruct. Re-open the character in the Creator.")
    plan, refused = plan_edit(doc, was, new, fields)

    if plan:
        print(f"\n{len(plan)} field{'' if len(plan) == 1 else 's'} would change:")
        for f, have, want, note in plan:
            if note:
                print(f"  {f}  ({note})")
                print(f"      was: {canon(have)[:200]}")
                print(f"      now: {canon(want)[:200]}")
            else:
                show(f, have, want)
    if refused:
        print(f"\n{len(refused)} refused, prose only for this character "
              f"(the edit changed these and they will not be written):")
        for f in refused:
            print(f"  {f}")
    if not plan:
        print("\nNothing to change." + ("" if not refused else
              " Everything the edit changed is a field this character does "
              "not allow an edit to touch."))
        return

    if not a.apply:
        print("\nDry run. Add --apply to write it.")
        return
    for f, have, want, note in plan:
        poke(doc, f, want)
    json.dump(doc, open(path, "w"), indent=1, ensure_ascii=False)
    print(f"\nWrote {os.path.relpath(path, ROOT)}. "
          f"Run ./scripts/pipeline.sh to rebuild the pages.")


if __name__ == "__main__":
    main()
