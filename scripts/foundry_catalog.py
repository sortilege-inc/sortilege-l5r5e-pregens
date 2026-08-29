#!/usr/bin/env python3
"""Enumerate the L5R compendium catalog (the coverage denominator).

Reads the pack list from the `l5r5e-compendia-sortilege` module manifest served
by the Foundry host, then enumerates each pack through the REST relay's
`/search?filter=package:<pack>`. With --full it also fetches every entry's full
document via /get.

Writes:
  data/foundry/catalog/index.json          pack -> [{id,name,subType,uuid}]
  data/foundry/catalog/<pack>.json         full docs (only with --full)
"""
import json, os, sys, time, urllib.error, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = "https://foundryrestapi.com"
OUT = os.path.join(ROOT, "pipeline", "foundry", "catalog")
MODULE = "l5r5e-compendia-sortilege"
HOST = os.environ.get("FOUNDRY_HOST", "https://foundry.sortilege.online")


def load_env():
    p = os.path.join(ROOT, ".env")
    if os.path.exists(p):
        for line in open(p):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


def get_json(url, headers=None, timeout=90):
    req = urllib.request.Request(url, headers={"User-Agent": "curl/8.0", **(headers or {})})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.load(r)
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError):
            if attempt == 3:
                raise
            time.sleep(2 * (attempt + 1))


def api(path, params, timeout=90):
    qs = urllib.parse.urlencode({**params, "clientId": CLIENT})
    return get_json(f"{BASE}{path}?{qs}", {"x-api-key": KEY}, timeout)


def pick_client():
    if os.environ.get("FOUNDRY_CLIENT"):
        return os.environ["FOUNDRY_CLIENT"]
    clients = get_json(f"{BASE}/clients", {"x-api-key": KEY})["clients"]
    live = [c for c in clients if c.get("systemId") == "l5r5e" and c.get("isOnline")]
    if not live:
        raise SystemExit("No online l5r5e Foundry client.")
    return live[0]["clientId"]


def main():
    full = "--full" in sys.argv
    force = "--force" in sys.argv
    os.makedirs(OUT, exist_ok=True)
    manifest = get_json(f"{HOST}/modules/{MODULE}/module.json")
    packs = [p for p in manifest["packs"] if p["type"] in ("Item", "JournalEntry", "Actor")]
    index = {}
    for p in packs:
        pack = f"{MODULE}.{p['name']}"
        res = api("/search", {"filter": f"package:{pack}", "limit": 500}).get("results", [])
        index[pack] = {
            "label": p["label"], "type": p["type"],
            "entries": [{"id": r["id"], "name": r["name"], "subType": r.get("subType"),
                         "uuid": r["uuid"]} for r in res],
        }
        flag = "  <-- AT LIMIT, may be truncated" if len(res) >= 500 else ""
        print(f"{len(res):5}  {p['label']:38} {pack}{flag}", flush=True)

    with open(os.path.join(OUT, "index.json"), "w") as f:
        json.dump(index, f, indent=1, ensure_ascii=False)
    total = sum(len(v["entries"]) for v in index.values())
    print(f"packs={len(index)} entries={total}", flush=True)

    if full:
        for pack, v in index.items():
            dest = os.path.join(OUT, pack.split(".", 1)[1] + ".json")
            if os.path.exists(dest) and not force:
                continue
            docs = []
            for i, e in enumerate(v["entries"], 1):
                try:
                    d = api("/get", {"uuid": e["uuid"]})
                    docs.append(d.get("data", d))
                except Exception as ex:
                    print(f"   FAIL {e['uuid']}: {ex}", flush=True)
            with open(dest, "w") as f:
                json.dump(docs, f, indent=1, ensure_ascii=False)
            print(f"   wrote {len(docs):4} -> {os.path.basename(dest)}", flush=True)
    print("DONE_MARKER", flush=True)


load_env()
KEY = os.environ["FOUNDRY_API"]
CLIENT = pick_client()

if __name__ == "__main__":
    main()
