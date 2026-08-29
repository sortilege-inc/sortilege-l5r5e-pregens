#!/usr/bin/env python3
"""One-time (re-runnable) import: Foundry actor snapshots -> repo character sources.

The repo is the source of truth (site-first). This turns the raw pull in
data/foundry/actors/ into one editable file per character:

    src/characters/<slug>.json

Each file holds identity + prose once, then a `tiers` array — one entry per XP
snapshot — listing content *by name*. Catalog-backed names are resolved to their
verbatim rules text at build time; anything not in the compendium catalog is
marked "custom": true and carries its own text here.

Refuses to overwrite an existing file unless --force, so hand edits survive.
"""
import collections, json, os, re, sys, unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ACTORS = os.path.join(ROOT, "pipeline", "foundry", "actors")
CATALOG = os.path.join(ROOT, "pipeline", "foundry", "catalog", "index.json")
OUT = os.path.join(ROOT, "src", "characters")

RINGS = ["air", "earth", "fire", "water", "void"]
# XP tier label, e.g. "Hiruma Kaede 107 XP (Gunsō, Rank 4)"
TIER_RE = re.compile(r"^(?P<name>.*?)\s+(?P<xp>\d+)\s*XP\s*(?:\((?P<note>.*)\))?\s*$", re.I)


def norm(s):
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", "", s.lower())


def slugify(s):
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", s.lower())).strip("-")


def load_catalog():
    """(subType, normalized name) -> canonical catalog name."""
    cat = json.load(open(CATALOG))
    idx = collections.defaultdict(dict)
    for pack, v in cat.items():
        for e in v["entries"]:
            idx[e["subType"] or v["type"]][norm(e["name"])] = e["name"]
    return idx


def ref(item, idx):
    """A content reference: canonical name if the catalog has it, else inline custom."""
    t = item["type"]
    sysd = item.get("system", {})
    canon = idx.get(t, {}).get(norm(item["name"]))
    out = {"name": canon or item["name"]}
    if t == "peculiarity":
        out["kind"] = sysd.get("peculiarity_type")
        out["ring"] = sysd.get("ring")
        out["types"] = sysd.get("types")
    if t == "technique":
        out["kind"] = sysd.get("technique_type")
        out["rank"] = sysd.get("rank")
    if t in ("weapon", "armor", "item"):
        out["quantity"] = sysd.get("quantity", 1)
        if sysd.get("equipped"):
            out["equipped"] = True
    if not canon:
        out["custom"] = True
        out["description"] = sysd.get("description", "")
        out["source_reference"] = sysd.get("source_reference")
        for k in ("damage", "deadliness", "range", "skill", "category", "armor",
                  "rarity", "zeni", "properties", "xp_cost"):
            if k in sysd:
                out[k] = sysd[k]
    return out


def tier_from_actor(actor, idx):
    s = actor["system"]
    m = TIER_RE.match(actor["name"])
    note = (m.group("note") or "").strip() if m else ""
    items = collections.defaultdict(list)
    for i in actor["items"]:
        items[i["type"]].append(i)

    advancements = [{
        "label": a["name"],
        "type": a["system"].get("advancement_type"),
        "skill": a["system"].get("skill") or None,
        "ring": a["system"].get("ring") or None,
        "at_rank": a["system"].get("rank"),
        "xp": a["system"].get("xp_used"),
        "in_curriculum": bool(a["system"].get("in_curriculum")),
    } for a in items["advancement"]]

    return {
        "xp": int(m.group("xp")) if m else s.get("xp_total", 0),
        "label": note or None,
        "rank": s["identity"].get("school_rank"),
        "school": s["identity"].get("school"),
        "foundry_id": actor["_id"],
        "foundry_name": actor["name"],
        "rings": {r: s["rings"].get(r, 1) for r in RINGS},
        "skills": {grp: dict(v) for grp, v in s["skills"].items()},
        "social": {k: s["social"].get(k) for k in
                   ("honor", "glory", "status", "ninjo", "giri", "bushido_tenets")},
        "derived": {"endurance": s.get("endurance"), "composure": s.get("composure"),
                    "focus": s.get("focus"), "vigilance": s.get("vigilance"),
                    "void_points": (s.get("void_points") or {}).get("max")},
        "money": {"zeni": s.get("zeni"), **(s.get("money") or {})},
        "techniques": [ref(i, idx) for i in items["technique"]],
        "peculiarities": [ref(i, idx) for i in items["peculiarity"]],
        "titles": [ref(i, idx) for i in items["title"]],
        "bonds": [ref(i, idx) for i in items["bond"]],
        "gear": [ref(i, idx) for i in items["weapon"] + items["armor"] + items["item"]],
        "advancements": advancements,
    }


def main():
    force = "--force" in sys.argv
    idx = load_catalog()
    index = json.load(open(os.path.join(ROOT, "pipeline", "foundry", "index.json")))
    by_char = collections.defaultdict(list)
    for entry in index["actors"]:
        by_char[entry["character"]].append(entry)

    os.makedirs(OUT, exist_ok=True)
    wrote = skipped = 0
    for char, entries in sorted(by_char.items()):
        actors = []
        for e in entries:
            actors.append(json.load(open(os.path.join(ROOT, "pipeline", "foundry", e["file"]))))
        tiers = sorted((tier_from_actor(a, idx) for a in actors), key=lambda t: t["xp"])
        base = actors[0]["system"]
        # "Aarav (Ivory Kingdoms Sage)" -> name, parenthetical school hint
        m = re.match(r"^(?P<n>.*?)\s*\((?P<s>.*)\)\s*$", char)
        display = (m.group("n") if m else char).strip()
        slug = slugify(display)
        doc = {
            "slug": slug,
            "name": display,
            "folder_label": char,
            "bucket": entries[0]["bucket"],
            "accent": entries[0].get("color"),
            "identity": {
                "clan": base["identity"].get("clan"),
                "family": base["identity"].get("family"),
                "school": base["identity"].get("school"),
                "role": base["identity"].get("roles"),
                "age": base["identity"].get("age"),
            },
            "portrait": None,
            "concept": None,
            "summary": None,
            "notes": base.get("notes") or "",
            "twenty_questions": base.get("twenty_questions", {}),
            "tiers": tiers,
        }
        dest = os.path.join(OUT, f"{slug}.json")
        if os.path.exists(dest) and not force:
            skipped += 1
            print(f"   skip (exists) {slug}.json", flush=True)
            continue
        with open(dest, "w") as f:
            json.dump(doc, f, indent=1, ensure_ascii=False)
        wrote += 1
        print(f"   wrote {slug}.json  ({len(tiers)} tiers, {tiers[0]['xp']}-{tiers[-1]['xp']} XP)",
              flush=True)
    print(f"DONE_MARKER characters={len(by_char)} wrote={wrote} skipped={skipped}", flush=True)


if __name__ == "__main__":
    main()
