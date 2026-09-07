#!/usr/bin/env python3
"""Regenerate the narrative half of `twenty_questions.steps` from `wizard.answers`.

A record carries its answers twice: `wizard.answers` (what the Creator edits and
the sheet renders) and `twenty_questions.steps` (the Foundry-shaped export the
Creator writes at export time and reads back when it hydrates an actor without
answers). An edit made to the record by hand -- an audit rewrite -- lands in the
first and leaves the second stale, and the stale copy is public data: the Mask of
the Oni audit removed a GM secret from a peace answer and it stayed in step11.

This rewrites the narrative keys of the step store, and `tiers[0].social.giri/
ninjo`, from the answers, the same mapping creator.js uses at export. Step 18
(heritage), step 8 (tenets), step 4's ring and every `picks` are mechanical and
untouched. Run by the pipeline after promotion; idempotent.

    python3 scripts/sync_step_store.py            # every record with a wizard
    python3 scripts/sync_step_store.py --check    # exit 1 if anything would change
"""
import glob, json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "src", "characters")


def mapping(a):
    m = (a.get("mentor") or {})
    return {
        "step4": {"stand_out": a.get("standout_quality")},
        "step5": {"social_giri": a.get("giri"), "lord_name": a.get("lord_name")},
        "step6": {"social_ninjo": a.get("ninjo")},
        "step7": {"clan_relations": (a.get("clan_relationship") or {}).get("text"),
                  "path": (a.get("clan_relationship") or {}).get("path"),
                  "skill": (a.get("clan_relationship") or {}).get("skill")},
        "step9": {"success": a.get("accomplishment")},
        "step10": {"difficulty": a.get("challenge")},
        "step11": {"calms": a.get("peace")},
        "step12": {"worries": a.get("fear")},
        "step13": {"most_learn": (m.get("name") or "") + (" — " + m["text"] if m.get("text") else "")},
        "step14": {"first_sight": a.get("first_impression"), "accoutrement": a.get("accoutrement")},
        "step15": {"stress": a.get("stress_reaction")},
        "step16": {"relations": a.get("relationships")},
        "step17": {"parents_pov": (a.get("parent_opinion") or {}).get("description")},
        "step20": {"death": a.get("death")},
    }


def sync(d):
    a = (d.get("wizard") or {}).get("answers")
    tq = (d.get("twenty_questions") or {}).get("steps")
    if not a or tq is None:
        return []
    changed = []
    for step, keys in mapping(a).items():
        st = tq.setdefault(step, {"answers": {}, "picks": {}})
        ans = st.setdefault("answers", {})
        for k, v in keys.items():
            if v is None and k not in ans:
                continue
            if ans.get(k) != v:
                ans[k] = v; changed.append(f"{step}.{k}")
    soc = d["tiers"][0].setdefault("social", {})
    for k in ("giri", "ninjo"):
        if a.get(k) is not None and soc.get(k) != a.get(k):
            soc[k] = a[k]; changed.append(f"social.{k}")
    return changed


def main(check):
    total = 0
    for p in sorted(glob.glob(os.path.join(SRC, "*.json"))):
        d = json.load(open(p, encoding="utf-8"))
        ch = sync(d)
        if ch:
            total += len(ch)
            print(f"{d['slug']}: {', '.join(ch)}")
            if not check:
                open(p, "w", encoding="utf-8").write(json.dumps(d, ensure_ascii=False, indent=1))
    print(f"{'would change' if check else 'synced'} {total} fields")
    return 1 if (check and total) else 0


if __name__ == "__main__":
    sys.exit(main("--check" in sys.argv))
