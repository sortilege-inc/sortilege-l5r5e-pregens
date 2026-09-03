#!/usr/bin/env python3
"""Promote a draft character out of draft status (or send one back).

Characters become drafts two ways: they sit in Foundry's `Draft` folder, or the
Creator made them (it only ever writes drafts). Both are derived, so clearing the
flag on the source file alone would not survive the next `--force` re-extract.
Promotion is therefore recorded in src/foundry_sources.json and re-applied by
scripts/pipeline.sh on every run.

    python3 scripts/promote.py doji-sayaka          # promote
    python3 scripts/promote.py doji-sayaka --demote # back to draft
    python3 scripts/promote.py --list               # who is a draft right now
"""
import argparse, glob, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCES = os.path.join(ROOT, "src", "foundry_sources.json")
SRC = os.path.join(ROOT, "src", "characters")


def load_sources():
    return json.load(open(SOURCES))


def save_sources(d):
    json.dump(d, open(SOURCES, "w"), indent=1, ensure_ascii=False)


# Where a concept stops being about the character and starts being about
# running her. Every concept that has sections at all opens with an unheaded
# block — name, pronouns, school and clan, and the hook in a sentence — and
# then breaks into headings. Those headings are the authoring layer, all of
# them: "Candidate hooks (unpicked)", "Open" and "Cross-character" obviously,
# but "Established" carries plot ("she is implicated in the adventure's plot",
# "she has no idea what the partnership actually is"), and even "Cards" and
# "Reading" are interpretation rather than description ("she is deluding
# herself", "the specific frustration of a competent subordinate").
#
# So the cut is the first heading, which also fails in the safe direction: a
# section nobody has classified yet stays off the page rather than landing on
# it. The five concepts with no headings are unaffected and land whole.
HEADING = re.compile(r"^#{1,6}\s", re.M)


def player_facing(concept):
    """The part of a concept that belongs on a public character page."""
    m = HEADING.search(concept or "")
    return (concept[:m.start()] if m else (concept or "")).strip()


def apply_promotions():
    """Clear `status` on every promoted slug, and land its concept as a bio.

    Concept material is authoring context while a character is a draft — it
    lives in `concepts` in the manifest, feeds the Creator's AI suggestions, and
    is deliberately not part of the record. Promotion is the moment part of it
    becomes part of the record.

    Only the part that is about the character: the bio is the concept up to its
    first heading, because everything under a heading is written for whoever is
    running her and some of it is the adventure's plot. Landing concepts raw put
    a tarot reading, a list of unpicked hooks, open prep questions and notes
    naming other PCs onto a public page — twice, before anyone noticed.

    Copied rather than moved, and never over an existing bio, so re-running the
    pipeline cannot overwrite prose someone has since written.

    Called by the pipeline after extract.
    """
    d = load_sources()
    promoted = set((d.get("promoted") or {}).get("slugs") or [])
    concepts = {k: v for k, v in (d.get("concepts") or {}).items()
                if not k.startswith("_")}
    changed, bios = [], []
    for path in sorted(glob.glob(os.path.join(SRC, "*.json"))):
        doc = json.load(open(path))
        if doc["slug"] not in promoted:
            continue
        dirty = False
        if doc.get("status"):
            doc["status"] = None
            dirty = True
            changed.append(doc["slug"])
        concept = concepts.get(doc["slug"])
        if concept and not (doc.get("bio") or "").strip():
            bio = player_facing(concept)
            if bio:
                doc["bio"] = bio
                dirty = True
                bios.append((doc["slug"], len(bio), len(concept.strip())))
        if dirty:
            json.dump(doc, open(path, "w"), indent=1, ensure_ascii=False)
    for slug, kept, whole in bios:
        held = whole - kept
        print(f"   bio from concept: {slug} ({kept} chars"
              + (f"; {held} of authoring notes held back)" if held else ")"))
    return changed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("slug", nargs="?")
    ap.add_argument("--demote", action="store_true", help="send a character back to draft")
    ap.add_argument("--list", action="store_true", help="list current drafts")
    ap.add_argument("--apply", action="store_true",
                    help="re-apply the promoted list to the sources (used by pipeline.sh)")
    args = ap.parse_args()

    if args.apply:
        for s in apply_promotions():
            print(f"   promoted {s}")
        return

    docs = {}
    for path in sorted(glob.glob(os.path.join(SRC, "*.json"))):
        doc = json.load(open(path))
        docs[doc["slug"]] = (path, doc)

    if args.list or not args.slug:
        drafts = [s for s, (_, d) in docs.items() if d.get("status") == "draft"]
        promoted = (load_sources().get("promoted") or {}).get("slugs") or []
        print(f"drafts ({len(drafts)}):")
        for s in drafts:
            print("   " + s)
        print(f"\npromoted ({len(promoted)}):")
        for s in promoted:
            print("   " + s)
        if not args.slug:
            print("\nUsage: python3 scripts/promote.py <slug> [--demote]")
        return

    if args.slug not in docs:
        sys.exit(f"no character source named {args.slug!r}")
    path, doc = docs[args.slug]

    d = load_sources()
    d.setdefault("promoted", {"slugs": []})
    slugs = d["promoted"].setdefault("slugs", [])

    if args.demote:
        if args.slug in slugs:
            slugs.remove(args.slug)
        doc["status"] = "draft"
        json.dump(doc, open(path, "w"), indent=1, ensure_ascii=False)
        save_sources(d)
        print(f"{doc['name']} is a draft again.")
    else:
        # Promotion does two things: it clears the draft flag, and it lands the
        # character's concept as a bio. A source that arrived with no status —
        # hand-written, or exported before the Creator set one — needs the
        # second without the first, so "not a draft" is not on its own a reason
        # to refuse. Refuse only when there is nothing left to do.
        concepts = {k: v for k, v in (d.get("concepts") or {}).items()
                    if not k.startswith("_")}
        pending_bio = bool(concepts.get(args.slug)) and not (doc.get("bio") or "").strip()
        if doc.get("status") != "draft" and args.slug not in slugs and not pending_bio:
            print(f"{doc['name']} is not a draft and has no concept to land — "
                  "nothing to promote.")
            return
        if args.slug not in slugs:
            slugs.append(args.slug)
            slugs.sort()
        was_draft = doc.get("status") == "draft"
        doc["status"] = None
        json.dump(doc, open(path, "w"), indent=1, ensure_ascii=False)
        save_sources(d)
        print("%s %s." % (doc["name"],
                          "promoted out of draft" if was_draft
                          else "recorded as promoted; its concept will land as a bio"))
    print("Run ./scripts/pipeline.sh to rebuild.")


if __name__ == "__main__":
    main()
