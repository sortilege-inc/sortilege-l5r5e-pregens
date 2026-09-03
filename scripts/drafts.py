#!/usr/bin/env python3
"""Read and write the Creator's shared drafts from the command line.

The point of this is working alongside somebody who is in the Creator: they
drive the wizard, this reads the same table, and either side can see what the
other is doing. The browser polls every 20 seconds while its tab is visible, so
a change made here shows up there within that.

    python3 scripts/drafts.py list
    python3 scripts/drafts.py get "Nergui"
    python3 scripts/drafts.py get "Nergui" --field character.answers.death
    python3 scripts/drafts.py set "Nergui" character.notes "..."      # dry run
    python3 scripts/drafts.py set "Nergui" character.notes "..." --apply
    python3 scripts/drafts.py watch --seconds 300

Drafts are addressed by id or by any unique fragment of the name, so you can say
"Nergui" rather than "dmtfl1zdonrqy".

The table key is read from .env (L5R_TABLE_KEY) and passed as a header. It is
never printed, and never appears in a command line — which is the reason this
exists rather than a curl you retype each time.

Writing goes through read-modify-write and sends the revision it read, so it
obeys the same rule the browser does: if somebody saved in between, the write is
refused rather than silently taking their work with it.

Two things worth knowing before writing:

  * If the other person has that draft open AND has edited it, their browser is
    holding unsent changes and will show your write as a conflict for them to
    resolve. Write to drafts they are not sitting on.
  * This edits the stored character directly, so it does not run any of the
    wizard's own bookkeeping. Narrative fields are safe. Rings, skills, school
    and heritage are the wizard's job — let it do them.
"""
import argparse, json, os, re, sys, time, urllib.error, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def env(name):
    """One value out of .env, without importing anything or echoing it."""
    p = os.path.join(ROOT, ".env")
    if not os.path.exists(p):
        sys.exit("no .env here — the table key lives there as L5R_TABLE_KEY")
    for line in open(p, encoding="utf-8"):
        if line.startswith(name + "="):
            return line.split("=", 1)[1].strip()
    sys.exit(f"no {name} in .env — run ./scripts/deploy_worker.sh first")


def base_url():
    p = os.path.join(ROOT, "src", "foundry_sources.json")
    url = ((json.load(open(p, encoding="utf-8")).get("ai_proxy") or {}).get("url") or "")
    if not url:
        sys.exit("no ai_proxy.url in src/foundry_sources.json — the Worker is not deployed")
    return url.rstrip("/")


def origin():
    """The Worker refuses anything whose Origin it does not recognise, so send
    one it does: the first entry of ALLOWED_ORIGIN, read from the config that
    defines it rather than guessed."""
    p = os.path.join(ROOT, "worker", "wrangler.toml")
    m = re.search(r'^ALLOWED_ORIGIN = "([^",]+)', open(p, encoding="utf-8").read(), re.M)
    return m.group(1) if m else "https://sortilege-inc.github.io"


def call(path, method="GET", payload=None):
    req = urllib.request.Request(
        base_url() + path, method=method,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={"x-table-key": env("L5R_TABLE_KEY"), "Origin": origin(),
                 # Cloudflare answers Python-urllib's default signature with a
                 # 1010 before the Worker ever runs, which reads exactly like a
                 # rejected table key and is not one.
                 "User-Agent": "curl/8.0",
                 **({"content-type": "application/json"} if payload is not None else {})})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        try:
            return e.code, json.loads(body or "{}")
        except ValueError:
            return e.code, {"error": body[:200]}
    except urllib.error.URLError as e:
        sys.exit(f"could not reach the table: {e.reason}")


def listing():
    status, body = call("/drafts")
    if status != 200:
        sys.exit(f"{status}: {body.get('error')}")
    return body.get("drafts") or []


def resolve(who):
    """An id, or any fragment that matches exactly one name."""
    rows = listing()
    for r in rows:
        if r["id"] == who:
            return r
    hits = [r for r in rows if who.lower() in (r["name"] or "").lower()]
    if not hits:
        sys.exit(f"nothing on the table matches {who!r}")
    if len(hits) > 1:
        sys.exit("that matches more than one draft:\n  " +
                 "\n  ".join(f"{r['name']}  ({r['id']})" for r in hits))
    return hits[0]


def dig(obj, path):
    for k in path.split("."):
        if not isinstance(obj, dict) or k not in obj:
            sys.exit(f"no such field: {path}")
        obj = obj[k]
    return obj


def poke(obj, path, value):
    keys = path.split(".")
    for k in keys[:-1]:
        if not isinstance(obj.get(k), dict):
            sys.exit(f"no such field: {path}")
        obj = obj[k]
    if keys[-1] not in obj:
        sys.exit(f"no such field: {path} — this refuses to invent one, "
                 "because a typo would otherwise land as real data")
    before = obj[keys[-1]]
    obj[keys[-1]] = value
    return before


def ago(ms):
    s = int(time.time() - ms / 1000)
    if s < 90:
        return f"{s}s ago"
    if s < 5400:
        return f"{s // 60}m ago"
    return f"{s // 3600}h ago"


def cmd_list(a):
    rows = listing()
    if not rows:
        print("nothing on the table")
        return
    w = max(len(r["name"] or "") for r in rows)
    for r in rows:
        who = f"  by {r['editor']}" if r.get("editor") else ""
        print(f"{(r['name'] or '(unnamed)'):<{w}}  rev {r['rev']:<3} "
              f"{ago(r['updated']):>8}{who}   {r['id']}")


def cmd_get(a):
    row = resolve(a.who)
    status, full = call("/drafts/" + row["id"])
    if status != 200:
        sys.exit(f"{status}: {full.get('error')}")
    if a.field:
        print(json.dumps(dig(full["body"], a.field), indent=2, ensure_ascii=False))
    else:
        print(json.dumps(full["body"], indent=2, ensure_ascii=False))


def cmd_set(a):
    row = resolve(a.who)
    status, full = call("/drafts/" + row["id"])
    if status != 200:
        sys.exit(f"{status}: {full.get('error')}")
    body = full["body"]
    before = poke(body, a.field, a.value)
    print(f"{full['name']}  (rev {full['rev']}, last touched {ago(full['updated'])}"
          f"{' by ' + full['editor'] if full.get('editor') else ''})")
    print(f"  {a.field}")
    print(f"    was: {json.dumps(before, ensure_ascii=False)[:300]}")
    print(f"    now: {json.dumps(a.value, ensure_ascii=False)[:300]}")
    if not a.apply:
        print("\nDry run. Add --apply to write it.")
        return
    status, res = call("/drafts/" + row["id"], "PUT",
                       {"rev": full["rev"], "name": full["name"],
                        "editor": a.editor, "body": body})
    if status == 409:
        cur = res.get("current") or {}
        sys.exit(f"refused: somebody saved first (now rev {cur.get('rev')}"
                 f"{', by ' + cur['editor'] if cur.get('editor') else ''}). "
                 "Nothing was overwritten. Read it again and redo the change.")
    if status != 200:
        sys.exit(f"{status}: {res.get('error')}")
    print(f"\nwritten as rev {res['rev']}, attributed to {a.editor}. "
          "It reaches an open Creator within 20s.")


def cmd_watch(a):
    """Follow the table while somebody else works in it."""
    seen = {r["id"]: r for r in listing()}
    print(f"watching {len(seen)} draft(s) for {a.seconds}s "
          f"— polling every {a.interval}s")
    for r in seen.values():
        print(f"  {r['name']}  rev {r['rev']}")
    end = time.time() + a.seconds
    while time.time() < end:
        time.sleep(a.interval)
        now = {r["id"]: r for r in listing()}
        stamp = time.strftime("%H:%M:%S")
        for i, r in now.items():
            if i not in seen:
                print(f"[{stamp}] new: {r['name']}")
            elif r["rev"] != seen[i]["rev"]:
                who = f" by {r['editor']}" if r.get("editor") else ""
                print(f"[{stamp}] {r['name']} -> rev {r['rev']}{who}"
                      + (f"  (renamed from {seen[i]['name']})"
                         if r["name"] != seen[i]["name"] else ""))
        for i, r in seen.items():
            if i not in now:
                print(f"[{stamp}] deleted: {r['name']}")
        seen = now
    print("done watching")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("list", help="every draft on the table").set_defaults(fn=cmd_list)

    g = sub.add_parser("get", help="one draft, or one field of it")
    g.add_argument("who"); g.add_argument("--field")
    g.set_defaults(fn=cmd_get)

    s = sub.add_parser("set", help="change one field (dry run unless --apply)")
    s.add_argument("who"); s.add_argument("field"); s.add_argument("value")
    s.add_argument("--apply", action="store_true")
    s.add_argument("--editor", default="Claude",
                   help="who the change is attributed to in the Creator")
    s.set_defaults(fn=cmd_set)

    w = sub.add_parser("watch", help="print changes as other people make them")
    w.add_argument("--seconds", type=int, default=300)
    w.add_argument("--interval", type=int, default=10)
    w.set_defaults(fn=cmd_watch)

    a = ap.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
