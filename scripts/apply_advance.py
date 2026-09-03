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
import argparse, json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "src", "characters")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import drafts as table

RANK_THRESHOLD = {1: 20, 2: 24, 3: 32, 4: 44, 5: 60}
BOND_COST = [3, 4, 6, 8, 10]
COST = {"technique": lambda e: 3, "passion": lambda e: 3,
        "skill": lambda e: (e["to"] or 0) * 2,
        "ring": lambda e: (e["to"] or 0) * 3,
        "bond": lambda e: BOND_COST[(e["to"] or 1) - 1]}


def ceil_half(n):
    return -(-n // 2)


def recount(patch, from_rank):
    """(spent, curriculum XP, title XP, rank, problems) from the ledger alone."""
    spent = cur = title_xp = 0
    rank = from_rank
    problems = []
    for i, e in enumerate(patch.get("ledger") or []):
        kind = e.get("kind")
        if kind not in COST:
            problems.append(f"ledger[{i}]: {kind!r} is not a kind of purchase")
            continue
        cost = COST[kind](e)
        if e.get("xp") != cost:
            problems.append(f"ledger[{i}] ({kind} {e.get('target')}): the "
                            f"Creator says {e.get('xp')} XP, the table says "
                            f"{cost}")
        spent += cost
        if e.get("at_rank") != rank:
            problems.append(f"ledger[{i}] ({kind} {e.get('target')}): bought "
                            f"at rank {e.get('at_rank')}, but the ledger up to "
                            f"here reaches rank {rank}")
        alloc = e.get("allocate")
        if kind == "bond":
            if alloc not in (None, "none"):
                problems.append(f"ledger[{i}]: a bond contributes to neither "
                                f"the school rank nor a title")
            continue
        contributes = cost if e.get("listed") else ceil_half(cost)
        if e.get("contributes") != contributes:
            problems.append(f"ledger[{i}] ({kind} {e.get('target')}): the "
                            f"Creator contributes {e.get('contributes')}, the "
                            f"table says {contributes}"
                            f" ({'in' if e.get('listed') else 'out of'} curriculum)")
        if alloc == "title":
            title_xp += contributes
        else:
            cur += contributes
            need = RANK_THRESHOLD.get(rank)
            while need and cur >= need and rank < 6:
                rank += 1
                cur = 0
                need = RANK_THRESHOLD.get(rank)
    return spent, cur, title_xp, rank, problems


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

    spent, cur, title_xp, rank, problems = recount(patch, base.get("rank") or 1)
    if tier["xp"] != base["xp"] + spent:
        problems.append(f"the new tier says {tier['xp']} XP; "
                        f"{base['xp']} + {spent} spent is {base['xp'] + spent}")
    if tier.get("rank") != rank:
        problems.append(f"the new tier says school rank {tier.get('rank')}; "
                        f"the ledger reaches rank {rank}")
    if patch.get("title_xp") not in (None, title_xp):
        problems.append(f"the advance says {patch.get('title_xp')} XP toward "
                        f"the title; the ledger contributes {title_xp}")
    if patch.get("xp_available") is not None and spent > patch["xp_available"]:
        problems.append(f"the ledger spends {spent} of "
                        f"{patch['xp_available']} XP available")

    n = len(patch.get("ledger") or [])
    print(f"  ledger: {n} purchase{'' if n == 1 else 's'}, {spent} XP, "
          f"reaching rank {rank}"
          + (f", {title_xp} toward {patch['title']}" if patch.get("title") else ""))
    for e in patch.get("ledger") or []:
        where = ("neither" if e.get("kind") == "bond"
                 else "title" if e.get("allocate") == "title" else "rank")
        print(f"      {e.get('kind'):<10} {str(e.get('target'))[:34]:<34} "
              f"{e.get('xp'):>3} XP  "
              f"{'in ' if e.get('listed') else 'out'}  "
              f"{e.get('contributes') or 0:>2} -> {where}")

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
    """The arithmetic, against the worked example in the book and the cases
    that are easy to get wrong: the half rounding up, a rank reached mid-ledger
    resetting the total, and a bond counting for nothing."""
    fails = []

    def want(label, cond):
        if not cond:
            fails.append(label)

    def led(**kw):
        e = {"kind": "skill", "target": "x", "to": 1, "allocate": "school",
             "listed": False, "at_rank": 1}
        e.update(kw)
        e["xp"] = COST[e["kind"]](e)
        e["contributes"] = (0 if e["kind"] == "bond" else
                            e["xp"] if e["listed"] else ceil_half(e["xp"]))
        if e["kind"] == "bond":
            e["allocate"] = "none"
        return e

    # the book's own example: a rank 1 Hida Defender spending 2 XP on Martial
    # Arts [Unarmed], which her curriculum lists, counts the whole 2
    s, c, t, r, p = recount({"ledger": [led(target="unarmed", to=1,
                                            listed=True)]}, 1)
    want("a listed purchase contributes its whole cost", (s, c, r) == (2, 2, 1))
    want("no disagreement on a clean ledger", not p)

    # out of curriculum: 3 XP contributes 2, not 1.5
    s, c, t, r, p = recount({"ledger": [led(kind="technique", to=None)]}, 1)
    want("half rounds up", (s, c) == (3, 2))

    # a ring is never listed, so 12 XP contributes 6
    s, c, t, r, p = recount({"ledger": [led(kind="ring", target="earth", to=4)]}, 1)
    want("a ring costs three times its value", s == 12)
    want("a ring contributes half", c == 6)

    # crossing the threshold advances the rank and resets the total
    big = [led(target="a", to=5, listed=True),   # 10, listed
           led(target="b", to=5, listed=True),   # 10, listed -> 20, rank 2
           led(target="c", to=2, listed=True, at_rank=2)]
    s, c, t, r, p = recount({"ledger": big}, 1)
    want("the rank advances at the threshold", r == 2)
    want("the total resets on advancing", c == 4)
    want("a purchase after the rank-up is at the new rank", not p)

    # ...and a purchase that claims the old rank is a disagreement
    bad = [led(target="a", to=5, listed=True), led(target="b", to=5, listed=True),
           led(target="c", to=2, listed=True, at_rank=1)]
    s, c, t, r, p = recount({"ledger": bad}, 1)
    want("a purchase at the wrong rank is caught", len(p) == 1)

    # a bond counts for neither
    s, c, t, r, p = recount({"ledger": [led(kind="bond", target="Nergui", to=2)]}, 1)
    want("a bond costs its rank's price", s == 4)
    want("a bond contributes nothing", (c, t) == (0, 0) and not p)

    # title allocation keeps out of the school rank
    s, c, t, r, p = recount({"ledger": [led(kind="technique", to=None,
                                            allocate="title")]}, 1)
    want("title XP is not school XP", (c, t) == (0, 2))

    # a cost the Creator got wrong is caught
    e = led(target="unarmed", to=2, listed=True)
    e["xp"] = 2                                  # should be 4
    s, c, t, r, p = recount({"ledger": [e]}, 1)
    want("a wrong cost is caught", any("the table says 4" in x for x in p))

    for f in fails:
        print("FAIL:", f)
    print(f"{12 - len(fails)} of 12 checks passed")
    return 1 if fails else 0


if __name__ == "__main__":
    main()
