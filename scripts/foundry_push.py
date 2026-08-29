#!/usr/bin/env python3
"""Push repo character sources back into the Foundry world.

The repo is the source of truth (site-first). This turns each tier of a
src/characters/<slug>.json into a Foundry Actor document under
`General / <bucket> / <Character>`, resolving every content reference to its
compendium entry so the actor carries the real rules text.

    python3 scripts/foundry_push.py                 # dry run: prints the plan
    python3 scripts/foundry_push.py --apply         # actually writes
    python3 scripts/foundry_push.py --apply --only nasu-kogo

DRY RUN IS THE DEFAULT. Nothing is sent to Foundry without --apply.

Updates are matched by the tier's recorded foundry_id; a tier with no
foundry_id is created fresh and the new id is written back into the source
file, so the next push updates rather than duplicates.
"""
import argparse, glob, json, os, re, sys, time, unicodedata
import urllib.error, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "src", "characters")
CATDIR = os.path.join(ROOT, "pipeline", "foundry", "catalog")
BASE = "https://foundryrestapi.com"

RINGS = ["air", "earth", "fire", "water", "void"]
# tier category -> the Foundry item type it becomes
CATEGORY_TYPE = {"techniques": "technique", "peculiarities": "peculiarity",
                 "titles": "title", "bonds": "bond"}


def load_env():
    p = os.path.join(ROOT, ".env")
    if os.path.exists(p):
        for line in open(p):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


def norm(s):
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", "", s.lower())


def http(method, path, params=None, payload=None, timeout=90):
    qs = urllib.parse.urlencode({**(params or {}), "clientId": CLIENT})
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        f"{BASE}{path}?{qs}", data=data, method=method,
        headers={"x-api-key": KEY, "User-Agent": "curl/8.0",
                 "Content-Type": "application/json"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "replace")[:400]
            raise SystemExit(f"{method} {path} -> HTTP {e.code}: {body}")
        except (urllib.error.URLError, TimeoutError):
            if attempt == 2:
                raise
            time.sleep(2 * (attempt + 1))


def pick_client():
    if os.environ.get("FOUNDRY_CLIENT"):
        return os.environ["FOUNDRY_CLIENT"]
    req = urllib.request.Request(f"{BASE}/clients",
                                 headers={"x-api-key": KEY, "User-Agent": "curl/8.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        clients = json.load(r)["clients"]
    live = [c for c in clients if c.get("systemId") == "l5r5e" and c.get("isOnline")]
    if not live:
        raise SystemExit("No online l5r5e Foundry client — open the world first.")
    return live[0]["clientId"]


def load_catalog_docs():
    """(subType, normalized name) -> full compendium document."""
    idx = json.load(open(os.path.join(CATDIR, "index.json")))
    by_uuid_pack = {}
    for pack, v in idx.items():
        by_uuid_pack[pack] = v
    docs = {}
    for path in glob.glob(os.path.join(CATDIR, "*.json")):
        if os.path.basename(path) == "index.json":
            continue
        pack = "l5r5e-compendia-sortilege." + os.path.basename(path)[:-5]
        meta = by_uuid_pack.get(pack, {})
        subs = {norm(e["name"]): e for e in meta.get("entries", [])}
        for doc in json.load(open(path)):
            n = norm(doc["name"])
            e = subs.get(n)
            sub = (e or {}).get("subType") or doc.get("type")
            docs[(sub, n)] = doc
    return docs


def item_from_ref(ref, cat, docs):
    """Build a Foundry embedded item for one content reference."""
    if ref.get("custom"):
        sysd = {k: v for k, v in ref.items()
                if k not in ("name", "custom", "kind", "catalog", "source", "uuid")}
        sysd.setdefault("description", ref.get("description", ""))
        itype = ref.get("_type") or ("item" if cat == "gear" else CATEGORY_TYPE.get(cat, "item"))
        return {"name": ref["name"], "type": itype, "system": sysd}

    n = norm(ref["name"])
    candidates = (["weapon", "armor", "item"] if cat == "gear"
                  else [CATEGORY_TYPE.get(cat, "item")])
    for sub in candidates:
        doc = docs.get((sub, n))
        if doc:
            item = {"name": doc["name"], "type": doc.get("type", sub),
                    "img": doc.get("img"), "system": dict(doc.get("system") or {})}
            if ref.get("quantity"):
                item["system"]["quantity"] = ref["quantity"]
            if ref.get("equipped"):
                item["system"]["equipped"] = True
            return item
    raise SystemExit(f"push aborted: no compendium entry for {cat} {ref['name']!r} "
                     f"(and it is not marked custom)")


def actor_from_tier(char, tier, docs):
    label = tier.get("label")
    name = f"{char['name']} {tier['xp']} XP" + (f" ({label})" if label else "")
    social = tier.get("social") or {}
    items = []
    for cat in ("techniques", "peculiarities", "titles", "bonds", "gear"):
        for ref in tier.get(cat, []):
            items.append(item_from_ref(ref, cat, docs))
    for adv in tier.get("advancements", []):
        items.append({"name": adv["label"], "type": "advancement", "system": {
            "advancement_type": adv.get("type"), "skill": adv.get("skill") or "",
            "ring": adv.get("ring") or "void", "rank": adv.get("at_rank"),
            "xp_used": adv.get("xp"), "in_curriculum": adv.get("in_curriculum", False),
            "description": ""}})

    derived = tier.get("derived") or {}
    return {
        "name": name, "type": "character",
        "system": {
            "identity": {
                "clan": char["identity"].get("clan") or "",
                "family": char["identity"].get("family") or "",
                "school": tier.get("school") or char["identity"].get("school") or "",
                "roles": char["identity"].get("role") or "",
                "school_rank": tier.get("rank") or 1,
                "age": char["identity"].get("age") or "",
            },
            "rings": {r: (tier.get("rings") or {}).get(r, 1) for r in RINGS},
            "skills": tier.get("skills") or {},
            "social": {k: social.get(k) for k in
                       ("honor", "glory", "status", "ninjo", "giri", "bushido_tenets")},
            "endurance": derived.get("endurance"), "composure": derived.get("composure"),
            "focus": derived.get("focus"), "vigilance": derived.get("vigilance"),
            "void_points": {"max": derived.get("void_points"), "value": 0},
            "xp_total": tier["xp"], "xp_spent": 0, "xp_saved": 0,
            "zeni": (tier.get("money") or {}).get("zeni", 0),
            "notes": char.get("notes", ""),
            "twenty_questions": char.get("twenty_questions", {}),
        },
        "items": items,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true",
                    help="actually write to Foundry (default is a dry run)")
    ap.add_argument("--only", help="push a single character slug")
    args = ap.parse_args()

    docs = load_catalog_docs()
    paths = sorted(glob.glob(os.path.join(SRC, "*.json")))
    if args.only:
        paths = [p for p in paths if os.path.basename(p)[:-5] == args.only]
        if not paths:
            raise SystemExit(f"no character source named {args.only!r}")

    planned = created = updated = 0
    for path in paths:
        char = json.load(open(path))
        dirty = False
        print(f"== {char['name']}  ({len(char['tiers'])} tiers)")
        for tier in char["tiers"]:
            actor = actor_from_tier(char, tier, docs)
            fid = tier.get("foundry_id")
            verb = "update" if fid else "create"
            print(f"   {verb:6} {actor['name']:52} {len(actor['items']):3} items")
            planned += 1
            if not args.apply:
                continue
            if fid:
                http("PUT", "/update", {"uuid": f"Actor.{fid}"}, {"data": actor})
                updated += 1
            else:
                res = http("POST", "/create", {"entityType": "Actor"}, {"data": actor})
                new_id = ((res.get("data") or {}).get("_id")
                          or (res.get("entity") or {}).get("_id") or res.get("id"))
                if not new_id:
                    raise SystemExit(f"create returned no id: {json.dumps(res)[:300]}")
                tier["foundry_id"] = new_id
                dirty = True
                created += 1
        if dirty:
            json.dump(char, open(path, "w"), indent=1, ensure_ascii=False)
            print(f"   wrote new foundry_ids back into {os.path.basename(path)}")

    if args.apply:
        print(f"DONE_MARKER created={created} updated={updated}")
    else:
        print(f"DRY RUN — {planned} actors would be written. Re-run with --apply to send them.")


load_env()
KEY = os.environ["FOUNDRY_API"]
CLIENT = pick_client()

if __name__ == "__main__":
    main()
