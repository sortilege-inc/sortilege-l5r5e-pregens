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
# Every actor item type must land in one of the tier's categories. A type that
# appears on an actor and is not listed here is a silent content drop, so
# tier_from_actor refuses rather than quietly skipping it.
HANDLED_ITEM_TYPES = {
    "technique", "peculiarity", "title", "bond", "signature_scroll",
    "weapon", "armor", "item", "advancement",
}
# School Curriculum entries are titled "<School> [Clan]"; when that whole string
# is pasted into an actor's school field the suffix has to come back off.
SCHOOL_CLAN_RE = re.compile(r"^(?P<name>.*?)\s*\[[^\]]+\]\s*$")


def clean_school(name):
    m = SCHOOL_CLAN_RE.match(name or "")
    return m.group("name") if m else name
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


# "Voice of Authority" on an actor vs "Voice of Authority (Emerald Magistrate)"
# in the compendium — the qualifier names the title that granted the ability
QUALIFIED_RE = re.compile(r"^(?P<stem>.*?)\s*\((?P<qual>[^)]+)\)\s*$")


def qualified_match(idx, subtypes, name, held_titles):
    """Resolve an ability the compendium qualifies by its granting title.

    Only accepted when the character actually holds that title, so a
    "(Daimyo)" variant is never mistaken for the "(Emerald Magistrate)" one.
    """
    n = norm(name)
    for sub in subtypes:
        for cand_norm, cand_name in (idx.get(sub) or {}).items():
            m = QUALIFIED_RE.match(cand_name)
            if m and norm(m.group("stem")) == n and norm(m.group("qual")) in held_titles:
                return cand_name
    return None


def ref(item, idx, held_titles=(), via=None):
    """A content reference: canonical name if the catalog has it, else inline custom."""
    t = item["type"]
    sysd = item.get("system", {})
    canon = idx.get(t, {}).get(norm(item["name"]))
    if not canon and t == "signature_scroll":
        # the system files title abilities here; the compendium keeps them
        # among the techniques, qualified by title
        canon = qualified_match(idx, ("technique", "signature_scroll"),
                                item["name"], held_titles)
    out = {"name": canon or item["name"]}
    if via:
        # nested under a title: this was bought for that title's curriculum
        out["via"] = via
    # Purchase record: character-specific, not catalog data, so it lives here.
    # scripts/derive_tiers.py needs it to tell starting kit from bought content.
    for k in ("xp_used", "xp_cost", "in_curriculum", "bought_at_rank"):
        if sysd.get(k) not in (None, ""):
            out[k] = sysd[k]
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


# 20Q steps store their mechanical picks as arrays of the actor's own embedded
# item ids. Resolve them to names here, where the actor is still in hand.
PICK_FIELDS = ("distinction", "adversity", "passion", "anxiety", "advantage",
               "disadvantage", "item", "bond", "techniques", "school_ability",
               "equipment", "special_features", "heritage_item")


def catalog_by_id():
    cat = json.load(open(CATALOG))
    out = {}
    for pack, v in cat.items():
        for e in v["entries"]:
            out[e["id"]] = e["name"]
    return out


def resolve_twenty_questions(actor, cat_ids):
    # Picks are compendium ids for anything from a pack, and the actor's own
    # embedded item ids for bespoke content, so try both.
    by_id = {i["_id"]: i["name"] for i in actor.get("items", [])}
    tq = actor["system"].get("twenty_questions") or {}
    out = {"template": tq.get("template"), "generated": bool(tq.get("generated")),
           "steps": {}}
    for key, val in tq.items():
        if not key.startswith("step") or not isinstance(val, dict):
            continue
        answers, picks = {}, {}
        for field, v in val.items():
            if field in PICK_FIELDS and isinstance(v, list):
                names = [cat_ids.get(i) or by_id.get(i) for i in v]
                names = [n for n in names if n]
                if names:
                    picks[field] = names
            elif isinstance(v, (str, int, float)) and v not in ("", "none", None):
                answers[field] = v
        if answers or picks:
            out["steps"][key] = {"answers": answers, "picks": picks}
    return out


def walk_items(items, parent=None):
    """Every item on an actor, including those nested in a parent's system.items.

    A title's curriculum purchases live inside that title item rather than in the
    actor's top-level items array. Reading only the top level drops them —
    134 of them across this corpus — so the walk is recursive and each item
    remembers the parent that carried it.
    """
    for i in items or []:
        if not isinstance(i, dict):
            continue
        yield i, parent
        nested = (i.get("system") or {}).get("items")
        if isinstance(nested, dict):
            nested = list(nested.values())
        if isinstance(nested, list):
            yield from walk_items(nested, i.get("name"))


def tier_from_actor(actor, idx):
    s = actor["system"]
    m = TIER_RE.match(actor["name"])
    note = (m.group("note") or "").strip() if m else ""
    items = collections.defaultdict(list)
    parent_of = {}
    for i, parent in walk_items(actor["items"]):
        items[i["type"]].append(i)
        if parent:
            parent_of[id(i)] = parent
    unknown = set(items) - HANDLED_ITEM_TYPES
    if unknown:
        raise SystemExit(
            f"{actor['name']}: unhandled item type(s) {sorted(unknown)} — add them to "
            "HANDLED_ITEM_TYPES and to a tier category, or they are dropped silently")

    held_titles = {norm(i["name"]) for i in items["title"]}

    advancements = [{k: v for k, v in {
        "label": a["name"],
        "type": a["system"].get("advancement_type"),
        "skill": a["system"].get("skill") or None,
        "ring": a["system"].get("ring") or None,
        "at_rank": a["system"].get("rank"),
        "xp": a["system"].get("xp_used"),
        "in_curriculum": bool(a["system"].get("in_curriculum")),
        # the title whose curriculum this was bought for, when it was nested
        "via": parent_of.get(id(a)),
    }.items() if v is not None} for a in items["advancement"]]

    return {
        "xp": int(m.group("xp")) if m else s.get("xp_total", 0),
        "label": note or None,
        "rank": s["identity"].get("school_rank"),
        "school": clean_school(s["identity"].get("school")),
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
        "techniques": [ref(i, idx, via=parent_of.get(id(i))) for i in items["technique"]],
        "peculiarities": [ref(i, idx, via=parent_of.get(id(i))) for i in items["peculiarity"]],
        "titles": [ref(i, idx, via=parent_of.get(id(i))) for i in items["title"]],
        "bonds": [ref(i, idx, via=parent_of.get(id(i))) for i in items["bond"]],
        # the system files a title's granted ability under signature_scroll
        "signature_scrolls": [ref(i, idx, held_titles, parent_of.get(id(i)))
                              for i in items["signature_scroll"]],
        "gear": [ref(i, idx, via=parent_of.get(id(i)))
                 for i in items["weapon"] + items["armor"] + items["item"]],
        "advancements": advancements,
    }


def main():
    force = "--force" in sys.argv
    idx = load_catalog()
    cat_ids = catalog_by_id()
    index = json.load(open(os.path.join(ROOT, "pipeline", "foundry", "index.json")))
    campaigns = {k: v for k, v in index.get("campaigns", {}).items()
                 if not k.startswith("_")}
    sources = json.load(open(os.path.join(ROOT, "src", "foundry_sources.json")))
    corrections = sources.get("corrections", {})
    portraits = sources.get("portraits", {})
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
        # campaign comes from the actor's own tag, then the by-slug overrides
        campaign = campaigns.get(slug) or entries[0].get("campaign")
        doc = {
            "slug": slug,
            "name": display,
            "folder_label": char,
            "campaign": campaign,
            "status": entries[0].get("status"),
            "bucket": entries[0].get("bucket"),
            "accent": entries[0].get("color"),
            "identity": {
                "clan": base["identity"].get("clan"),
                "family": base["identity"].get("family"),
                # Path of Waves and Writ of the Wilds answer questions 1 and 2
                # with these instead of a clan and a family. Foundry has no
                # field for either, so they only ever arrive from the Creator's
                # export or a hand-authored source — but they must survive a
                # re-extract, which means living in the schema.
                "region": base["identity"].get("region"),
                "upbringing": base["identity"].get("upbringing"),
                # rōnin / peasant / gaijin: what set the base status the
                # upbringing then modified
                "origin_type": base["identity"].get("origin_type"),
                "school": clean_school(base["identity"].get("school")),
                "role": base["identity"].get("roles"),
                "age": base["identity"].get("age"),
            },
            "portrait": portraits.get(slug),
            "concept": None,
            "summary": None,
            "notes": base.get("notes") or "",
            "twenty_questions": resolve_twenty_questions(actors[0], cat_ids),
            "tiers": tiers,
        }
        # manifest corrections: the Foundry record is wrong and stays wrong,
        # so the fix has to survive every re-extract
        for field, value in (corrections.get(slug) or {}).items():
            if field.startswith("_"):
                continue
            # a tier's own field: "tiers.0.money". Identity fields live on the
            # doc, but money, rings and socials live per tier, and a
            # multi-tier character's differ between them — so the index is
            # part of the path rather than applying to all of them.
            parts = field.split(".")
            if len(parts) == 3 and parts[0] == "tiers" and parts[1].isdigit():
                i = int(parts[1])
                if i < len(doc["tiers"]):
                    was = doc["tiers"][i].get(parts[2])
                    doc["tiers"][i][parts[2]] = value
                    print(f"   correction {slug}: {field} {was!r} -> {value!r}")
                else:
                    print(f"   ! correction {slug}: {field} — only "
                          f"{len(doc['tiers'])} tier(s)")
                continue
            section, _, key = field.partition(".")
            if key and section in doc:
                was = doc[section].get(key)
                doc[section][key] = value
                for t in doc["tiers"]:
                    if t.get(key) == was:
                        t[key] = value
                print(f"   correction {slug}: {field} {was!r} -> {value!r}")

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
