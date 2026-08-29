#!/usr/bin/env python3
"""Pull actors from the L5R Foundry world via the REST relay.

What to pull is declared in src/foundry_sources.json:

  * `roots`  — folder trees pulled whole, shaped
               `<root> / <bucket> / <Character (School)> / <actor snapshot>`
  * `actors` — individual actors elsewhere in the world, each assigned to a
               named character (several actors may share one character, and
               become that character's XP tiers)

Raw JSON lands in pipeline/foundry/actors/, with pipeline/foundry/index.json
describing what was fetched and how it is grouped.

Idempotent: re-fetches only missing files unless --force.

Env: FOUNDRY_API (relay API key) from .env at the repo root.
"""
import json, os, re, sys, time, urllib.error, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = "https://foundryrestapi.com"
OUT = os.path.join(ROOT, "pipeline", "foundry")
ACTOR_DIR = os.path.join(OUT, "actors")
SOURCES = os.path.join(ROOT, "src", "foundry_sources.json")


def load_env():
    path = os.path.join(ROOT, ".env")
    if os.path.exists(path):
        for line in open(path):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


def api(path, params, timeout=90):
    qs = urllib.parse.urlencode({**params, "clientId": CLIENT})
    req = urllib.request.Request(
        f"{BASE}{path}?{qs}",
        headers={"x-api-key": KEY, "User-Agent": "curl/8.0"},
    )
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.load(r)
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError):
            if attempt == 3:
                raise
            time.sleep(2 * (attempt + 1))


def pick_client():
    """Prefer FOUNDRY_CLIENT; else the online l5r5e client."""
    if os.environ.get("FOUNDRY_CLIENT"):
        return os.environ["FOUNDRY_CLIENT"]
    req = urllib.request.Request(
        f"{BASE}/clients", headers={"x-api-key": KEY, "User-Agent": "curl/8.0"}
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        clients = json.load(r)["clients"]
    live = [c for c in clients if c.get("systemId") == "l5r5e" and c.get("isOnline")]
    if not live:
        offline = [c["worldTitle"] for c in clients if c.get("systemId") == "l5r5e"]
        raise SystemExit(f"No online l5r5e Foundry client. Offline l5r5e worlds: {offline}")
    return live[0]["clientId"]


def slug(name):
    s = re.sub(r"[^\w\- ]", "", (name or "unnamed")).strip().replace(" ", "_")
    return (s or "unnamed")[:80]


_folders = {}


def folder(fid):
    if fid not in _folders:
        d = api("/get", {"uuid": f"Folder.{fid}"})["data"]
        _folders[fid] = {"id": fid, "name": d["name"], "parent": d.get("folder"),
                         "color": d.get("color"), "sort": d.get("sort", 0)}
    return _folders[fid]


def chain(fid):
    out = []
    while fid:
        f = folder(fid)
        out.append(f)
        fid = f["parent"]
    return list(reversed(out))


def fetch(entry, force):
    """Fetch one actor to disk; returns its index record."""
    eid = entry["id"]
    fname = f"{slug(entry['name'])}__{eid}.json"
    fpath = os.path.join(ACTOR_DIR, fname)
    entry["file"] = os.path.join("actors", fname)
    if os.path.exists(fpath) and not force:
        return entry, True
    try:
        doc = api("/get", {"uuid": entry["uuid"]})
        with open(fpath, "w") as f:
            json.dump(doc.get("data", doc), f, indent=1, ensure_ascii=False)
        return entry, True
    except Exception as e:
        print(f"   FAIL {entry['uuid']}: {e}", flush=True)
        return entry, False


def main():
    force = "--force" in sys.argv
    os.makedirs(ACTOR_DIR, exist_ok=True)
    sources = json.load(open(SOURCES))

    world = [r for r in api("/search", {"filter": "documentType:Actor",
                                        "excludeCompendiums": "true",
                                        "limit": 500}).get("results", [])
             if not r.get("package")]
    by_uuid = {r["uuid"]: r for r in world}

    index, ok, fail = [], 0, 0

    # --- folder roots ------------------------------------------------------
    for root in sources.get("roots", []):
        name = root["folder"]
        found = []
        for r in world:
            if not r.get("folder"):
                continue
            ch = chain(r["folder"])
            if ch and ch[0]["name"] == name:
                found.append((r, ch))
        print(f"== root {name}: {len(found)} actor snapshots", flush=True)
        for r, ch in found:
            path = [f["name"] for f in ch]
            entry, good = fetch({
                "uuid": r["uuid"], "id": r.get("id") or r["uuid"].split(".")[-1],
                "name": r.get("name"), "subType": r.get("subType"),
                "path": path, "root": name,
                "bucket": path[1] if len(path) > 1 else None,
                "character": path[2] if len(path) > 2 else r.get("name"),
                "campaign": root.get("campaign"),
                "color": ch[-1].get("color"), "sort": r.get("sort", 0),
            }, force)
            index.append(entry)
            ok, fail = (ok + 1, fail) if good else (ok, fail + 1)

    # --- individually listed actors ---------------------------------------
    listed = sources.get("actors", [])
    if listed:
        print(f"== listed actors: {len(listed)}", flush=True)
    for spec in listed:
        r = by_uuid.get(spec["uuid"])
        if not r:
            print(f"   MISSING from world: {spec['uuid']} ({spec.get('character')})",
                  flush=True)
            fail += 1
            continue
        path = [f["name"] for f in chain(r["folder"])] if r.get("folder") else []
        entry, good = fetch({
            "uuid": r["uuid"], "id": r.get("id") or r["uuid"].split(".")[-1],
            "name": r.get("name"), "subType": r.get("subType"),
            "path": path, "root": path[0] if path else None,
            "bucket": None, "character": spec["character"],
            "campaign": spec.get("campaign"),
            "color": None, "sort": r.get("sort", 0),
        }, force)
        index.append(entry)
        ok, fail = (ok + 1, fail) if good else (ok, fail + 1)
        print(f"   {r.get('name')}  ->  {spec['character']}", flush=True)

    with open(os.path.join(OUT, "index.json"), "w") as f:
        json.dump({"client": CLIENT, "actors": index,
                   "campaigns": sources.get("campaigns", {})}, f,
                  indent=1, ensure_ascii=False)
    print(f"DONE_MARKER ok={ok} fail={fail} characters="
          f"{len({e['character'] for e in index})}", flush=True)


load_env()
KEY = os.environ["FOUNDRY_API"]
CLIENT = pick_client()

if __name__ == "__main__":
    main()
