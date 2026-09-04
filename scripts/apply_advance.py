#!/usr/bin/env python3
"""Land an advance: append a new XP tier to a character's record.

A character in play spends experience between sessions. The Creator keeps a
ledger of what was bought (Promoted characters → +XP in the drafts panel), and
this lands it as a new tier beside the ones already on the record. The tier it
started from is never touched: the archive keeps every version of a character
it has ever held, which is what the play pages at several XP totals are.

    python3 scripts/apply_advance.py "Kuni"                    # off the table
    python3 scripts/apply_advance.py --file kuni-ryosei-advance.json
    python3 scripts/apply_advance.py "Kuni" --apply

It does not take the wizard's tier on trust. The ledger says what was bought,
what each purchase cost and what it contributed, and this recomputes the totals
from it — the costs, the curriculum contributions, the school rank reached, the
XP the tier lands at — and refuses to write if its own arithmetic disagrees
with what the Creator sent. Two implementations of the same table is the point:
a number they both arrive at independently is worth more than one either
asserts.

The rules it checks are the corpus's:

    skill        2 XP x the rank bought
    ring         3 XP x the value bought
    technique    3 XP
    passion      3 XP
    bond         3, 4, 6, 8, 10 for its five ranks, contributing to neither
                 the school rank nor a title
    curriculum   a listed purchase contributes its whole cost, anything else
                 half rounded up
    rank         20, 24, 32, 44, 60 curriculum XP, reset on each advance

Nothing is written without --apply.
"""
import argparse, collections, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "src", "characters")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import drafts as table

RANK_THRESHOLD = {1: 20, 2: 24, 3: 32, 4: 44, 5: 60}
BOND_COST = [3, 4, 6, 8, 10]
# An item pattern's price is stated per pattern in the corpus, so unlike the
# others it cannot be computed — the ledger carries it and this checks it
# against data/chargen/patterns.js instead.
PATTERNS = {}


def pattern_cost(e):
    if not PATTERNS:
        path = os.path.join(ROOT, "data", "chargen", "patterns.js")
        if os.path.exists(path):
            t = open(path, encoding="utf-8").read()
            t = t[t.index("=") + 1:].rstrip().rstrip(";\n").rstrip(";")
            for v in json.loads(t).values():
                PATTERNS[re.sub(r"[^a-z0-9]+", "", v["name"].lower())] = v
    p = PATTERNS.get(re.sub(r"[^a-z0-9]+", "", str(e.get("target") or "").lower()))
    return p["xp_cost"] if p else None


COST = {"technique": lambda e: 3, "passion": lambda e: 3,
        "skill": lambda e: (e["to"] or 0) * 2,
        "ring": lambda e: (e["to"] or 0) * 3,
        "pattern": pattern_cost,
        "bond": lambda e: BOND_COST[(e["to"] or 1) - 1]}


def ceil_half(n):
    return -(-n // 2)


def recount(patch, from_rank, title_progress=None):
    """Re-derive the totals from the ledger alone.

    Every purchase names the ledger it is filed against — the school, one
    title, or one bond — and that is what decides where its contribution goes.
    The corpus keeps the three separate: XP allocated to a title does not count
    toward the school rank and vice versa, and XP spent on a bond counts toward
    neither.

    -> (spent, school XP at the current rank, {title: XP}, {bond: XP}, rank,
        problems)
    """
    spent = cur = 0
    titles = collections.Counter()
    bonds = collections.Counter()
    rank = from_rank
    problems = []
    for i, e in enumerate(patch.get("ledger") or []):
        kind = e.get("kind")
        if kind not in COST:
            problems.append(f"ledger[{i}]: {kind!r} is not a kind of purchase")
            continue
        cost = COST[kind](e)
        if cost is None:
            problems.append(f"ledger[{i}] ({kind} {e.get('target')}): no cost "
                            f"stated, and none can be derived")
            continue
        if e.get("xp") != cost:
            problems.append(f"ledger[{i}] ({kind} {e.get('target')}): the "
                            f"Creator says {e.get('xp')} XP, the table says "
                            f"{cost}")
        spent += cost
        if e.get("at_rank") != rank:
            problems.append(f"ledger[{i}] ({kind} {e.get('target')}): bought "
                            f"at rank {e.get('at_rank')}, but the ledger up to "
                            f"here reaches rank {rank}")

        belongs = e.get("belongs")
        if kind == "bond" or (belongs or "").startswith("bond:"):
            if e.get("contributes"):
                problems.append(f"ledger[{i}]: a bond contributes to neither "
                                f"the school rank nor a title, but "
                                f"{e.get('contributes')} is recorded")
            bonds[belongs or ("bond:" + str(e.get("target")))] += cost
            continue

        contributes = cost if e.get("listed") else ceil_half(cost)
        if e.get("contributes") != contributes:
            problems.append(f"ledger[{i}] ({kind} {e.get('target')}): the "
                            f"Creator contributes {e.get('contributes')}, the "
                            f"table says {contributes}"
                            f" ({'in' if e.get('listed') else 'out of'} curriculum)")
        if (belongs or "").startswith("title:"):
            titles[belongs] += contributes
        elif belongs in (None, "school"):
            cur += contributes
            need = RANK_THRESHOLD.get(rank)
            while need and cur >= need and rank < 6:
                rank += 1
                cur = 0
                need = RANK_THRESHOLD.get(rank)
        else:
            problems.append(f"ledger[{i}]: filed against {belongs!r}, which is "
                            f"neither the school, a title nor a bond")
    return spent, cur, dict(titles), dict(bonds), rank, problems


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("who", nargs="?", help="the character being advanced")
    ap.add_argument("--file", help="an advance downloaded from the Creator")
    ap.add_argument("--apply", action="store_true", help="write it")
    ap.add_argument("--selftest", action="store_true",
                    help="check the arithmetic and exit")
    a = ap.parse_args()

    if a.selftest:
        sys.exit(selftest())

    if a.file:
        patch = json.load(open(a.file))
    else:
        if not a.who:
            ap.error("give an advance with --file, or a name to look up")
        patch = from_table(a.who)

    slug = patch.get("advance") or a.who
    path = os.path.join(SRC, str(slug) + ".json")
    if not os.path.exists(path):
        sys.exit(f"no such character: {os.path.relpath(path, ROOT)}")
    doc = json.load(open(path))
    tier = patch.get("tier")
    if not tier:
        sys.exit("the advance carries no tier")

    # The tier it starts from is whatever is highest on the record now, which
    # is not necessarily what the Creator was looking at.
    base = max(doc["tiers"], key=lambda t: t["xp"])
    print(f"{doc['name']}  ({slug}) — {len(doc['tiers'])} tier"
          f"{'' if len(doc['tiers']) == 1 else 's'}, highest {base['xp']} XP "
          f"at school rank {base.get('rank')}")
    if base["xp"] != patch.get("from_xp"):
        sys.exit(f"the advance starts from {patch.get('from_xp')} XP, and the "
                 f"record's highest tier is {base['xp']} XP. Re-open the "
                 f"character in the Creator so the ledger starts from where "
                 f"they actually are.")

    spent, cur, title_xp, bond_xp, rank, problems = \
        recount(patch, base.get("rank") or 1)
    if tier["xp"] != base["xp"] + spent:
        problems.append(f"the new tier says {tier['xp']} XP; "
                        f"{base['xp']} + {spent} spent is {base['xp'] + spent}")
    if tier.get("rank") != rank:
        problems.append(f"the new tier says school rank {tier.get('rank')}; "
                        f"the ledger reaches rank {rank}")
    for which, mine, theirs in (("title", title_xp, patch.get("title_xp")),
                                ("bond", bond_xp, patch.get("bond_xp"))):
        if theirs is not None and dict(theirs) != mine:
            problems.append(f"the advance says {theirs} toward each {which}; "
                            f"the ledger contributes {mine}")
    if patch.get("xp_available") is not None and spent > patch["xp_available"]:
        problems.append(f"the ledger spends {spent} of "
                        f"{patch['xp_available']} XP available")

    n = len(patch.get("ledger") or [])
    print(f"  ledger: {n} purchase{'' if n == 1 else 's'}, {spent} XP, "
          f"reaching rank {rank}")
    for e in patch.get("ledger") or []:
        # the in/out column says nothing about a bond: no curriculum lists one
        where = str(e.get("belongs") or "")
        col = "   " if (e.get("kind") == "bond" or where.startswith("bond:")) \
            else ("in " if e.get("listed") else "out")
        print(f"      {e.get('kind'):<10} {str(e.get('target'))[:30]:<30} "
              f"{e.get('xp'):>3} XP  {col}  "
              f"{e.get('contributes') or 0:>2} -> "
              f"{str(e.get('belongs_label') or 'neither')[:26]}")
    if title_xp:
        for k, v in sorted(title_xp.items()):
            print(f"  toward {k[6:]}: {v} XP this advance")
    if bond_xp:
        for k, v in sorted(bond_xp.items()):
            print(f"  on the bond with {k[5:]}: {v} XP, counting toward "
                  f"neither ledger")
    if patch.get("titles_assigned"):
        print("  takes on: " + ", ".join(patch["titles_assigned"]))
    if patch.get("titles_completed"):
        print("  completes: " + ", ".join(patch["titles_completed"]))

    if problems:
        print(f"\n{len(problems)} disagreement"
              f"{'' if len(problems) == 1 else 's'} with the ledger:")
        for p in problems:
            print("   ", p)
        sys.exit(1)

    print(f"\n  the new tier: {tier['xp']} XP, rank {tier.get('rank')}"
          + (f", labelled {tier['label']!r}" if tier.get("label") else ""))
    for k in ("techniques", "peculiarities", "titles", "bonds",
              "signature_scrolls", "gear"):
        was = {e["name"] for e in base.get(k) or []}
        now = {e["name"] for e in tier.get(k) or []}
        if now - was:
            print(f"      +{k}: " + ", ".join(sorted(now - was)))
        if was - now:
            print(f"      -{k}: " + ", ".join(sorted(was - now)))
    for t in tier.get("titles") or []:
        was = next((x.get("xp_used") for x in base.get("titles") or []
                    if x.get("name") == t.get("name")), 0) or 0
        if (t.get("xp_used") or 0) != was:
            print(f"      title {t['name']}: {was} -> {t.get('xp_used')}"
                  + (f" of {t['xp_cost']}" if t.get("xp_cost") else ""))
    ringline = ", ".join(
        f"{r} {base['rings'].get(r)}->{tier['rings'].get(r)}"
        for r in ("air", "earth", "fire", "water", "void")
        if base["rings"].get(r) != tier["rings"].get(r))
    if ringline:
        print("      rings: " + ringline)

    if not a.apply:
        print("\nDry run. Add --apply to write it.")
        return
    doc["tiers"].append(tier)
    doc["tiers"].sort(key=lambda t: t["xp"])
    json.dump(doc, open(path, "w"), indent=1, ensure_ascii=False)
    print(f"\nWrote {os.path.relpath(path, ROOT)} — now "
          f"{len(doc['tiers'])} tiers. Run ./scripts/pipeline.sh to build the "
          f"new sheet.")


def from_table(who):
    """The advance as the table has it."""
    row, full, body = table.load_body(who)
    if (body.get("kind") or "draft") != "advance":
        sys.exit(f"“{full['name']}” is not an advance on the table")
    if not body.get("advancePatch"):
        sys.exit(f"“{full['name']}” carries no computed advance yet. The "
                 f"browser writes one on its next save — open the draft, or "
                 f"use the Save step's Copy with --file.")
    print(f"read off the table: rev {full['rev']}, last touched "
          f"{table.ago(full['updated'])}"
          + (f" by {full['editor']}" if full.get("editor") else ""))
    return body["advancePatch"]


def selftest():
    """The arithmetic, against the case it exists for: three separate ledgers.

    Every purchase names the one it is filed against, and the corpus keeps them
    apart — title XP is not school XP, and bond XP is neither. The half
    rounding up, a rank reached mid-ledger resetting the total, and a cost the
    Creator got wrong are the rest.
    """
    fails = []

    def want(label, cond):
        if not cond:
            fails.append(label)

    def led(**kw):
        e = {"kind": "skill", "target": "x", "to": 1, "belongs": "school",
             "listed": False, "at_rank": 1}
        e.update(kw)
        e["xp"] = COST[e["kind"]](e)
        if e["kind"] == "bond" or str(e["belongs"]).startswith("bond:"):
            e["contributes"] = 0
        else:
            e["contributes"] = e["xp"] if e["listed"] else ceil_half(e["xp"])
        return e

    # the book's own worked example: a rank 1 Hida Defender spending 2 XP on
    # Martial Arts [Unarmed], which her curriculum lists, counts the whole 2
    s, c, t, b, r, p = recount({"ledger": [led(target="unarmed", to=1,
                                               listed=True)]}, 1)
    want("a listed purchase contributes its whole cost", (s, c, r) == (2, 2, 1))
    want("no disagreement on a clean ledger", not p)

    s, c, t, b, r, p = recount({"ledger": [led(kind="technique", to=None)]}, 1)
    want("half rounds up", (s, c) == (3, 2))

    s, c, t, b, r, p = recount({"ledger": [led(kind="ring", target="earth",
                                               to=4)]}, 1)
    want("a ring costs three times its value", s == 12)
    want("a ring contributes half", c == 6)

    big = [led(target="a", to=5, listed=True),
           led(target="b", to=5, listed=True),        # 20 -> rank 2
           led(target="c", to=2, listed=True, at_rank=2)]
    s, c, t, b, r, p = recount({"ledger": big}, 1)
    want("the rank advances at the threshold", r == 2)
    want("the total resets on advancing", c == 4)
    want("a purchase after the rank-up is at the new rank", not p)

    bad = [led(target="a", to=5, listed=True), led(target="b", to=5, listed=True),
           led(target="c", to=2, listed=True, at_rank=1)]
    s, c, t, b, r, p = recount({"ledger": bad}, 1)
    want("a purchase at the wrong rank is caught", len(p) == 1)

    # filed against a title: not one point of it reaches the school rank
    s, c, t, b, r, p = recount({"ledger": [
        led(target="a", to=5, listed=True, belongs="title:Master Artisan")]}, 1)
    want("title XP is not school XP",
         (c, r) == (0, 1) and t == {"title:Master Artisan": 10})

    # two titles keep separate totals
    s, c, t, b, r, p = recount({"ledger": [
        led(target="a", to=2, listed=True, belongs="title:One"),
        led(target="b", to=2, listed=True, belongs="title:Two")]}, 1)
    want("each title has its own total",
         t == {"title:One": 4, "title:Two": 4} and c == 0)

    # a bond counts toward neither, and claiming otherwise is caught
    s, c, t, b, r, p = recount({"ledger": [
        led(kind="bond", target="Nergui", to=2, belongs="bond:Nergui")]}, 1)
    want("a bond costs its rank's price", s == 4)
    want("a bond contributes to neither ledger",
         (c, t) == (0, {}) and b == {"bond:Nergui": 4} and not p)
    e = led(kind="bond", target="Nergui", to=2, belongs="bond:Nergui")
    e["contributes"] = 2
    s, c, t, b, r, p = recount({"ledger": [e]}, 1)
    want("a bond claiming a contribution is caught",
         any("neither" in x for x in p))

    # a bucket that is not one of the three
    s, c, t, b, r, p = recount({"ledger": [led(belongs="wishes")]}, 1)
    want("an unknown ledger is caught",
         any("neither the school" in x for x in p))

    # a cost the Creator got wrong
    e = led(target="unarmed", to=2, listed=True)
    e["xp"] = 2                                  # should be 4
    s, c, t, b, r, p = recount({"ledger": [e]}, 1)
    want("a wrong cost is caught", any("the table says 4" in x for x in p))

    # an item pattern's price comes from the corpus, not from arithmetic
    if pattern_cost({"target": "Watered Steel Pattern"}) is not None:
        e = led(kind="pattern", target="Watered Steel Pattern", to=None)
        s, c, t, b, r, p = recount({"ledger": [e]}, 1)
        want("a pattern costs what the corpus says",
             s == pattern_cost({"target": "Watered Steel Pattern"}) and not p)
        e2 = dict(e, xp=1)
        s, c, t, b, r, p = recount({"ledger": [e2]}, 1)
        want("a pattern at the wrong price is caught", bool(p))
    else:
        want("patterns.js is present so a pattern price can be checked", False)

    for f in fails:
        print("FAIL:", f)
    print(f"{18 - len(fails)} of 18 checks passed")
    return 1 if fails else 0


if __name__ == "__main__":
    main()
