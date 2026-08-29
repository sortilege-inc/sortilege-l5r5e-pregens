#!/usr/bin/env python3
"""Pull the `General` actor tree from the L5R Foundry world via the REST relay.

Enumerates world Actors, resolves each one's full folder chain, keeps everything
under the `General` root folder, and writes raw JSON to data/foundry/actors/.
Also writes data/foundry/index.json describing the tree:

    General / <bucket> / <Character (School)> / <actor snapshot>

Idempotent: re-fetches only missing files unless --force.

Env: FOUNDRY_API (relay API key) from .env at the repo root.
"""
import json, os, re, sys, time, urllib.error, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = "https://foundryrestapi.com"
OUT = os.path.join(ROOT, "pipeline", "foundry")
ACTOR_DIR = os.path.join(OUT, "actors")
ROOT_FOLDER = "General"


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


def main():
    force = "--force" in sys.argv
    os.makedirs(ACTOR_DIR, exist_ok=True)
    results = [r for r in api("/search", {"filter": "documentType:Actor",
                                          "excludeCompendiums": "true",
                                          "limit": 500}).get("results", [])
               if not r.get("package")]
    keep = []
    for r in results:
        if not r.get("folder"):
            continue
        ch = chain(r["folder"])
        if ch and ch[0]["name"] == ROOT_FOLDER:
            r["_chain"] = ch
            keep.append(r)
    print(f"== {ROOT_FOLDER}: {len(keep)} actor snapshots under {len(results)} world actors",
          flush=True)

    index, ok, fail = [], 0, 0
    for i, r in enumerate(keep, 1):
        eid = r.get("id") or r["uuid"].split(".")[-1]
        fname = f"{slug(r.get('name'))}__{eid}.json"
        fpath = os.path.join(ACTOR_DIR, fname)
        path = [f["name"] for f in r["_chain"]]
        index.append({
            "uuid": r["uuid"], "id": eid, "name": r.get("name"),
            "subType": r.get("subType"), "path": path,
            "bucket": path[1] if len(path) > 1 else None,
            "character": path[2] if len(path) > 2 else None,
            "color": r["_chain"][-1].get("color"),
            "sort": r.get("sort", 0),
            "file": os.path.join("actors", fname),
        })
        if os.path.exists(fpath) and not force:
            ok += 1
            continue
        try:
            doc = api("/get", {"uuid": r["uuid"]})
            with open(fpath, "w") as f:
                json.dump(doc.get("data", doc), f, indent=1, ensure_ascii=False)
            ok += 1
            print(f"   {i}/{len(keep)} {r.get('name')}", flush=True)
        except Exception as e:
            fail += 1
            print(f"   FAIL {r['uuid']}: {e}", flush=True)

    with open(os.path.join(OUT, "index.json"), "w") as f:
        json.dump({"root": ROOT_FOLDER, "client": CLIENT, "actors": index}, f,
                  indent=1, ensure_ascii=False)
    print(f"DONE_MARKER ok={ok} fail={fail}", flush=True)


load_env()
KEY = os.environ["FOUNDRY_API"]
CLIENT = pick_client()

if __name__ == "__main__":
    main()
