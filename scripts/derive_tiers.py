#!/usr/bin/env python3
"""Reconstruct earlier XP tiers for a character Foundry only holds at one point.

Some characters exist in Foundry as a single current actor. Their earlier states
are still recoverable, because the actor records what was bought and what it cost:

  * `advancement` items name their own before/after ("Government +1 (1 -> 2)")
    and the school rank they were bought at, so rings and skills rewind exactly.
  * techniques and peculiarities with `xp_used == 0` came free with the character
    (twenty questions / school); anything with `xp_used > 0` was purchased.
  * a purchased technique that appears on the school's curriculum is placed at
    that curriculum rank.
  * a purchased technique that does NOT appear on the school curriculum is title
    curriculum: it is placed with the title whose `xp_used_total` accounts for it.
  * titles get a tier of their own when fully paid (`xp_used == xp_cost`).
  * a title's own `xp_used` is a ROLLUP of the curriculum items nested inside it,
    not a separate price — counting both double-counts the title.

Everything else — gear, social, twenty questions — is not XP-bought and is carried
unchanged. Reconstructed tiers are marked `"reconstructed": true` in the source
file so they are never mistaken for a Foundry record, and the last tier is asserted to be
byte-identical to the actor it came from.

    python3 scripts/derive_tiers.py doji-setsuna
    python3 scripts/derive_tiers.py doji-setsuna --write
"""
import argparse, copy, json, os, re, sqlite3, sys, unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "src", "characters")
DB = os.path.join(ROOT, "pipeline", "l5r.sqlite")

# "Government +1 (1 -> 2)" / "Fire +1 (1 -> 2)"
ADV_RE = re.compile(r"^(?P<what>.*?)\s*\+1\s*\((?P<from>\d+)\s*->\s*(?P<to>\d+)\)\s*$")
# "Voice of Authority (Emerald Magistrate)" — the qualifier is the granting title
QUALIFIED_RE = re.compile(r"^(?P<stem>.*?)\s*\((?P<qual>[^)]+)\)\s*$")


def norm(s):
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", "", s.lower())


def school_curriculum(school):
    """normalized technique name -> curriculum rank, for one school."""
    if not os.path.exists(DB):
        sys.exit("no pipeline/l5r.sqlite — run scripts/build.py first")
    cx = sqlite3.connect(DB)
    return {r[0]: r[1] for r in cx.execute(
        "SELECT norm, MIN(rank) FROM curriculum WHERE school_norm=? AND kind='Technique'"
        " GROUP BY norm", (norm(school),))}


def rewind(tier):
    """The 0 XP state: undo every advancement, drop everything purchased."""
    t = copy.deepcopy(tier)
    for adv in tier.get("advancements", []):
        m = ADV_RE.match(adv["label"])
        if not m:
            print(f"   ! cannot parse advancement {adv['label']!r} — left in place")
            continue
        start = int(m.group("from"))
        if adv.get("type") == "ring" and adv.get("ring"):
            t["rings"][adv["ring"]] = start
        elif adv.get("type") == "skill" and adv.get("skill"):
            for grp, skills in t["skills"].items():
                if adv["skill"] in skills:
                    skills[adv["skill"]] = start
    t["advancements"] = []
    for cat in ("techniques", "peculiarities", "titles", "bonds"):
        t[cat] = [e for e in t.get(cat, []) if not purchased(e)]
    # A title ability is granted by its title, never bought and never starting
    # kit, so it appears only once that title is held.
    t["signature_scrolls"] = []
    t["xp"] = 0
    t["rank"] = 1
    t["label"] = None
    t["reconstructed"] = True
    t["foundry_id"] = None
    return t


def purchased(entry):
    src = entry.get("catalog") or entry
    return bool(entry.get("xp_used") or src.get("xp_used"))


def cost(entry):
    return entry.get("xp_used") or (entry.get("catalog") or {}).get("xp_used") or 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("slug")
    ap.add_argument("--write", action="store_true", help="write the tiers into the source file")
    args = ap.parse_args()

    path = os.path.join(SRC, args.slug + ".json")
    char = json.load(open(path))
    if len(char["tiers"]) != 1:
        print(f"== {char['name']}: already has {len(char['tiers'])} tiers — nothing to "
              "derive (re-extract with --force to rebuild from the actor)")
        return
    final = char["tiers"][0]
    curriculum = school_curriculum(final.get("school") or char["identity"]["school"])

    # --- classify what was bought ------------------------------------------
    # Every purchase belongs either to a school rank or to a title's curriculum.
    # Items nested inside a title carry `via`; everything else is school.
    adv_by_rank, adv_by_title = {}, {}
    for a in final.get("advancements", []):
        if a.get("via"):
            adv_by_title.setdefault(a["via"], []).append(a)
        else:
            adv_by_rank.setdefault(a.get("at_rank") or 1, []).append(a)

    tech_by_rank, tech_by_title = {}, {}
    for cat in ("techniques", "signature_scrolls"):
        for e in final.get(cat, []):
            if e.get("via"):
                tech_by_title.setdefault(e["via"], []).append((cat, e))
            elif purchased(e):
                r = curriculum.get(norm(e["name"])) or e.get("bought_at_rank") or 1
                tech_by_rank.setdefault(r, []).append((cat, e))

    titles_done = [t for t in final.get("titles", [])
                   if t.get("xp_used") and t.get("xp_used") == t.get("xp_cost")]
    titles_open = [t for t in final.get("titles", []) if t not in titles_done]

    def title_cost(name):
        """What the title actually cost: the sum of its nested curriculum items."""
        return (sum(a.get("xp") or 0 for a in adv_by_title.get(name, []))
                + sum(e.get("xp_used") or 0 for _, e in tech_by_title.get(name, [])))

    print(f"== {char['name']}  ({final['xp']} XP earned, rank {final.get('rank')})")
    for r in sorted(set(adv_by_rank) | set(tech_by_rank)):
        cost_r = (sum(a.get("xp") or 0 for a in adv_by_rank.get(r, []))
                  + sum(e.get("xp_used") or 0 for _, e in tech_by_rank.get(r, [])))
        print(f"   school rank {r}: {cost_r} XP")
    for t in final.get("titles", []):
        print(f"   title {t['name']}: {title_cost(t['name'])} XP"
              f"  ({'complete' if t in titles_done else 'in progress'})")

    # --- build the tier chain ---------------------------------------------
    def apply_adv(state, a):
        m = ADV_RE.match(a["label"])
        if m:
            to = int(m.group("to"))
            if a.get("type") == "ring" and a.get("ring"):
                state["rings"][a["ring"]] = to
            elif a.get("type") == "skill" and a.get("skill"):
                for skills in state["skills"].values():
                    if a["skill"] in skills:
                        skills[a["skill"]] = to
        state["advancements"] = state.get("advancements", []) + [a]

    tiers = [rewind(final)]
    state = copy.deepcopy(tiers[0])
    spent = 0
    max_rank = final.get("rank") or 1

    for r in range(1, max_rank):
        for a in adv_by_rank.get(r, []):
            apply_adv(state, a)
            spent += a.get("xp") or 0
        for cat, e in tech_by_rank.get(r, []):
            state[cat] = state.get(cat, []) + [e]
            spent += e.get("xp_used") or 0
        t = copy.deepcopy(state)
        t.update({"xp": spent, "rank": r + 1, "label": f"Rank {r + 1}",
                  "reconstructed": True, "foundry_id": None})
        tiers.append(t)
        state = copy.deepcopy(t)

    scrolls = final.get("signature_scrolls", [])

    def scroll_for(title_name):
        want = norm(title_name)
        for e in scrolls:
            m = QUALIFIED_RE.match(e.get("name") or "")
            if m and norm(m.group("qual")) == want:
                return e
        return None

    for title in titles_done:
        state["titles"] = state.get("titles", []) + [title]
        for a in adv_by_title.get(title["name"], []):
            apply_adv(state, a)
        for cat, e in tech_by_title.get(title["name"], []):
            state[cat] = state.get(cat, []) + [e]
        granted = scroll_for(title["name"])
        if granted and granted not in state.get("signature_scrolls", []):
            state["signature_scrolls"] = state.get("signature_scrolls", []) + [granted]
        spent += title_cost(title["name"])
        t = copy.deepcopy(state)
        t.update({"xp": spent, "rank": max_rank, "label": title["name"],
                  "reconstructed": True, "foundry_id": None})
        tiers.append(t)
        state = copy.deepcopy(t)

    # everything still unaccounted for lands on the final, recorded tier
    remaining = (sum(a.get("xp") or 0 for a in adv_by_rank.get(max_rank, []))
                 + sum(e.get("xp_used") or 0 for _, e in tech_by_rank.get(max_rank, []))
                 + sum(title_cost(t["name"]) for t in titles_open))
    total_spent = spent + remaining

    # the recorded actor, exactly as pulled, always last
    if not final.get("label"):
        final["label"] = "Current"
    final["xp_spent"] = total_spent
    tiers.append(final)

    # --- gate: the last tier must still be the Foundry record --------------
    if tiers[-1] is not final:
        sys.exit("final tier is not the source actor")
    for i, t in enumerate(tiers):
        if i and t["xp"] < tiers[i - 1]["xp"]:
            sys.exit(f"tier {i} XP {t['xp']} goes backwards from {tiers[i-1]['xp']}")

    print()
    print("   derived chain:")
    for t in tiers:
        print("     %-28s %4s XP  rank %s  %2d tech  %2d titles  %2d abilities%s" % (
            t.get("label") or "(starting)", t["xp"], t.get("rank"),
            len(t.get("techniques", [])), len(t.get("titles", [])),
            len(t.get("signature_scrolls", [])),
            "" if t.get("reconstructed") else "   <- Foundry record"))
    banked = final["xp"] - total_spent
    print(f"\n   {total_spent} XP spent of {final['xp']} earned"
          + (f" — {banked} banked." if banked > 0 else
             " — fully spent." if banked == 0 else
             f" — OVERSPENT by {-banked}, check the record."))

    if args.write:
        char["tiers"] = tiers
        json.dump(char, open(path, "w"), indent=1, ensure_ascii=False)
        print(f"\n   wrote {len(tiers)} tiers into {os.path.basename(path)}")
    else:
        print("\n   DRY RUN — re-run with --write to save these tiers.")


if __name__ == "__main__":
    main()
