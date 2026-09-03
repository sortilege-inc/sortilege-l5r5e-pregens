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


# ---------------------------------------------------------------- the wizard's
# own definitions. Everything below reads the same files assets/creator.js
# reads, rather than keeping a second copy of the rules that would drift out of
# step with it the first time a school is added.

CREATOR = os.path.join(ROOT, "assets", "creator.js")
DATA = os.path.join(ROOT, "data", "chargen")
RINGS = ["Air", "Earth", "Fire", "Water", "Void"]


def _js(name):
    """One `window.X = {...};` data file, as Python."""
    t = open(os.path.join(DATA, name), encoding="utf-8").read()
    return json.loads(t[t.index("=") + 1:].rstrip().rstrip(";\n").rstrip(";"))


def norm(s):
    """creator.js's normName: fold accents, keep [a-z0-9]."""
    import unicodedata
    s = unicodedata.normalize("NFKD", str(s or ""))
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", "", s.lower())


def defaults():
    """The shape newCharacter() returns, read out of creator.js.

    Drafts on the table can be missing fields — one has no `choices` at all,
    from before that key existed. The browser fills them in on the way past;
    without the same thing here, writing to such a draft either crashes or is
    refused for a field that is legitimately part of a character.

    Parsed rather than copied, so adding a field to the wizard does not quietly
    leave this behind. If the parse ever fails it says so instead of falling
    back to a stale duplicate.
    """
    src = open(CREATOR, encoding="utf-8").read()
    m = re.search(r"function newCharacter\(\) \{\s*return \{", src)
    if not m:
        sys.exit("could not find newCharacter() in assets/creator.js")
    i = src.index("{", m.end() - 1)
    depth, j = 0, i
    while j < len(src):
        if src[j] == "{":
            depth += 1
        elif src[j] == "}":
            depth -= 1
            if depth == 0:
                break
        j += 1
    body = src[i:j + 1]
    body = re.sub(r"//[^\n]*", "", body)                      # authoring notes
    body = re.sub(r'(?<=[{,\s])([A-Za-z_][A-Za-z0-9_]*)\s*:', r'"\1":', body)
    body = re.sub(r",(\s*[}\]])", r"\1", body)                 # trailing commas
    try:
        return json.loads(body)
    except ValueError as e:
        sys.exit(f"could not read newCharacter() out of creator.js: {e}")


def with_defaults(remote, base):
    """Same merge the browser does: defaults fill gaps, unknown keys survive."""
    if not isinstance(remote, dict) or not isinstance(base, dict):
        return base if remote is None else remote
    out = {k: with_defaults(remote.get(k), v) for k, v in base.items()}
    for k, v in remote.items():
        out.setdefault(k, v)
    return out


def find(rows, name, suffixes=()):
    """The wizard is tolerant about names — the draft says 'Isawa Tensai School'
    where the data says 'Isawa Tensai', and 'Phoenix' where it says 'Phoenix
    Clan'. Match the same way rather than demanding the stored spelling."""
    if not name:
        return None
    want = {norm(name)} | {norm(name + s) for s in suffixes}
    want |= {norm(re.sub(r"\s+(School|Clan)$", "", str(name)))}
    for r in rows:
        if norm(r.get("name")) in want or norm(r.get("clan_short_name")) in want:
            return r
    return None


def specs(ch):
    """Every choice this character's clan, family and school put to the player,
    keyed exactly as creator.js keys them in C.choices."""
    out = []

    def add(key, label, node, n=None, options=None):
        sp = (node or {}).get("_choose") if isinstance(node, dict) else None
        if sp:
            n, options = sp.get("n", 1), sp.get("options") or []
        elif options is None:
            return
        out.append({"key": key, "label": label, "n": n or 1, "options": options,
                    "picked": list((ch.get("choices") or {}).get(key) or [])})

    clan = find(_js("clans.js"), ch.get("clan"), (" Clan",))
    if clan:
        add("clan.ring_bonus", f"{ch['clan']} ring", clan.get("ring_bonus"))
        add("clan.skill_bonus", f"{ch['clan']} skill", clan.get("skill_bonus"))
    fam = find(_js("families.js"), ch.get("family"))
    if fam:
        add("family.ring_increase", f"{ch['family']} ring", fam.get("ring_increase"))
        add("family.skill_increases", f"{ch['family']} skill", fam.get("skill_increases"))
    sch = find(_js("schools.js"), ch.get("school"), (" School",))
    if sch:
        add("school.ring_increase", "School ring (+2)", sch.get("ring_increase"))
        add("school.starting_skills", "School skills", sch.get("starting_skills"))
        # The inspired element is its own choice, read off the school ability's
        # text the way creator.js reads it.
        txt = (_js("techniques.js") or {}).get(norm(sch.get("school_ability")), "")
        plain = re.sub(r"<[^>]+>", " ", str(txt))
        m = re.search(r"Choose one:\s*([^.]+)\.", plain, re.I)
        found = [e for e in RINGS if m and re.search(rf"\b{e}\b", m.group(1), re.I)]
        if found:
            add("school.inspired", "Inspired element", None, 1, found)
        inspired = ((ch.get("choices") or {}).get("school.inspired") or [None])[0]
        for i, g in enumerate(sch.get("starting_techniques") or []):
            if g.get("kind") != "choose":
                continue
            opts = list(g.get("options") or [])
            # Some starting techniques are written as an instruction rather than
            # a list — "Any one rank 1 invocation of your inspired element" — and
            # the wizard expands it against the compendium. Compare against what
            # it expands to, or a legal pick reads as an illegal one.
            if len(opts) == 1 and re.search(r"\bany one\b|\bchoose\b", opts[0], re.I):
                by_ring = inspired if re.search(r"inspired element", opts[0], re.I) else None
                if re.search(r"inspired element", opts[0], re.I) and not by_ring:
                    opts = []          # nothing to choose from until the element is
                else:
                    opts = expand(opts[0], g.get("category"), by_ring)
            add(f"school.tech.{i}", f"{g.get('category','technique')} technique",
                None, g.get("n", 1), opts)
    return out


def expand(option, kind, ring):
    """creator.js's expandInstruction: the techniques an instruction stands for."""
    m = re.search(r"\brank (\d)\b", option, re.I)
    rank = int(m.group(1)) if m else 1
    t = open(os.path.join(ROOT, "data", "catalog.js"), encoding="utf-8").read()
    cat = json.loads(t[t.index("=") + 1:].rstrip().rstrip(";\n").rstrip(";"))
    return sorted(e["name"] for e in cat
                  if e.get("sub_type") == "technique"
                  and str(e.get("kind") or "").lower() == str(kind or "").lower()
                  and e.get("rank") == rank
                  and (not ring or str(e.get("ring") or "").lower() == str(ring).lower()))


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


def bushido():
    """The seven tenets, from creator.js rather than a second copy of them."""
    m = re.search(r"var BUSHIDO = \[(.*?)\];",
                  open(CREATOR, encoding="utf-8").read(), re.S)
    return re.findall(r'"([^"]+)"', m.group(1)) if m else []


# Fields where a wrong value is not a typo but a thing that does not exist.
# Everything else is prose and is nobody's business to police.
def check(path, value):
    if path == "character.clan":
        if not find(_js("clans.js"), value, (" Clan",)):
            return "no such clan"
    elif path == "character.family":
        if not find(_js("families.js"), value):
            return "no such family"
    elif path == "character.school":
        if not find(_js("schools.js"), value, (" School",)):
            return "no such school"
    elif path == "character.standout_ring":
        if str(value).lower() not in [r.lower() for r in RINGS]:
            return "not a ring — " + ", ".join(r.lower() for r in RINGS)
    elif path in ("character.bushido.paramount", "character.bushido.lesser"):
        if value not in bushido():
            return "not a tenet — " + ", ".join(bushido())
    return None


def load_body(who):
    """A draft, with the wizard's own defaults filled in for anything it
    predates. Returns (row, full, body)."""
    row = resolve(who)
    status, full = call("/drafts/" + row["id"])
    if status != 200:
        sys.exit(f"{status}: {full.get('error')}")
    body = full["body"] or {}
    body["character"] = with_defaults(body.get("character") or {}, defaults())
    return row, full, body


def write(row, full, body, editor):
    status, res = call("/drafts/" + row["id"], "PUT",
                       {"rev": full["rev"], "name": full["name"],
                        "editor": editor, "body": body})
    if status == 409:
        cur = res.get("current") or {}
        sys.exit(f"refused: somebody saved first (now rev {cur.get('rev')}"
                 f"{', by ' + cur['editor'] if cur.get('editor') else ''}). "
                 "Nothing was overwritten. Read it again and redo the change.")
    if status != 200:
        sys.exit(f"{status}: {res.get('error')}")
    print(f"\nwritten as rev {res['rev']}, attributed to {editor}. "
          "It reaches an open Creator within 20s.")


def cmd_options(a):
    """What this character still has to choose, and what the choices are."""
    row, full, body = load_body(a.who)
    ch = body["character"]
    print(f"{ch.get('name') or full['name']} — "
          f"{ch.get('clan') or '?'} / {ch.get('family') or '?'} / "
          f"{ch.get('school') or '?'}\n")
    rows = specs(ch)
    if not rows:
        print("no clan, family or school set yet, so nothing to choose from")
        return
    for sp in rows:
        left = sp["n"] - len(sp["picked"])
        mark = "·" if left > 0 else "\u2713"
        print(f"{mark} {sp['key']:<24} {sp['label']}"
              + (f"   [{left} still to pick]" if left > 0 else ""))
        if sp["picked"]:
            print(f"      chosen: {', '.join(sp['picked'])}")
        if left > 0:
            print(f"      pick {sp['n']} of: "
                  + (", ".join(sp["options"]) if sp["options"]
                     else "(nothing yet — an earlier choice fills this in)"))
    stray = [(sp["key"], p) for sp in rows for p in sp["picked"]
             if sp["options"] and p not in sp["options"]]
    if stray:
        print("\npicks that are not in their option list (the wizard drops these "
              "silently, so they are worth knowing about):")
        for k, p in stray:
            print(f"  {k}: {p}")


def cmd_pick(a):
    """Make one of the choices the wizard would offer, checked against its own
    option list — the whole point being that an unchecked pick is silently
    dropped by computed() rather than refused, and so goes unnoticed."""
    row, full, body = load_body(a.who)
    ch = body["character"]
    rows = {sp["key"]: sp for sp in specs(ch)}
    sp = rows.get(a.key)
    if not sp:
        sys.exit(f"{a.key!r} is not a choice this character has.\n  " +
                 "\n  ".join(rows) if rows else "this character has no choices yet")
    if not sp["options"]:
        sys.exit(f"{a.key} has no options yet — an earlier choice fills it in")
    canon = []
    for v in a.values:
        hit = [o for o in sp["options"] if o.lower() == v.lower()]
        if not hit:
            sys.exit(f"{v!r} is not an option for {a.key}.\n  choose from: "
                     + ", ".join(sp["options"]))
        canon.append(hit[0])
    if len(canon) > sp["n"]:
        sys.exit(f"{a.key} takes {sp['n']}, got {len(canon)}")
    ch.setdefault("choices", {})[a.key] = canon
    print(f"{full['name']}  (rev {full['rev']}, last touched {ago(full['updated'])}"
          f"{' by ' + full['editor'] if full.get('editor') else ''})")
    print(f"  {a.key}  ({sp['label']})")
    print(f"    was: {sp['picked'] or '— nothing'}")
    print(f"    now: {canon}")
    if len(canon) < sp["n"]:
        print(f"    note: {sp['n'] - len(canon)} of {sp['n']} still unpicked")
    if not a.apply:
        print("\nDry run. Add --apply to write it.")
        return
    write(row, full, body, a.editor)


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
    row, full, body = load_body(a.who)
    bad = check(a.field, a.value)
    if bad:
        sys.exit(f"refusing {a.field} = {a.value!r}: {bad}")
    before = poke(body, a.field, a.value)
    print(f"{full['name']}  (rev {full['rev']}, last touched {ago(full['updated'])}"
          f"{' by ' + full['editor'] if full.get('editor') else ''})")
    print(f"  {a.field}")
    print(f"    was: {json.dumps(before, ensure_ascii=False)[:300]}")
    print(f"    now: {json.dumps(a.value, ensure_ascii=False)[:300]}")
    if not a.apply:
        print("\nDry run. Add --apply to write it.")
        return
    write(row, full, body, a.editor)


SRC_CHARS = os.path.join(ROOT, "src", "characters")


def slugify(name):
    """creator.js's slugify, so the guard looks for the file the export writes."""
    import unicodedata
    t = unicodedata.normalize("NFKD", str(name or ""))
    t = "".join(c for c in t if not unicodedata.combining(c))
    return re.sub(r"^-|-$", "", re.sub(r"[^a-z0-9]+", "-", t.lower()))


def prose_of(node, out=None):
    """Every substantial string a draft holds. Short values — a ring name, a
    gender, a tenet — are skipped: they are not what gets lost, and matching
    them would flag everything."""
    out = [] if out is None else out
    if isinstance(node, str):
        if len(node.strip()) >= 25:
            out.append(node.strip())
    elif isinstance(node, dict):
        for k, v in node.items():
            if k != "concept":      # deliberately not exported; see toSourceJson
                prose_of(v, out)
    elif isinstance(node, list):
        for v in node:
            prose_of(v, out)
    return out


def unexported(body):
    """What this draft has written that its source file does not.

    Returns (slug, path, missing). `missing` empty means the file already holds
    everything the draft does, so deleting the draft loses nothing.

    Compared by looking for the draft's own sentences in the file rather than by
    mapping field to field. A mapping would be a second copy of the export's
    own, and would drift from it — which is exactly how questions 9 to 12 came
    to be written by the wizard and never exported.
    """
    ch = (body or {}).get("character") or {}
    slug = (body or {}).get("fromArchive") or slugify(ch.get("name"))
    path = os.path.join(SRC_CHARS, slug + ".json") if slug else ""
    written = prose_of(ch)
    if not path or not os.path.exists(path):
        return slug, path, written
    have = open(path, encoding="utf-8").read()
    return slug, path, [w for w in written if json.dumps(w, ensure_ascii=False)[1:-1] not in have
                        and w not in have]


def cmd_delete(a):
    """Take a draft off the table. It goes for everyone, and there is no undo:
    the table is not in git and nothing keeps a copy.

    So before removing one, this checks that its work is actually on disk.
    Kitsuki Nagiko sat at rev 68 with twenty written answers while her source
    file was still the archive stub she was opened from, and Ichiro Tsutomu's
    export was missing four answers the Creator never wrote. Either deletion
    would have destroyed work that existed nowhere else.
    """
    row = resolve(a.who)
    status, full = call("/drafts/" + row["id"])
    if status != 200:
        sys.exit(f"{status}: {full.get('error')}")
    ch = (full.get("body") or {}).get("character") or {}
    ans = sum(1 for v in (ch.get("answers") or {}).values()
              if v not in ("", None, [], {}))
    print(f"{full['name']}  ({row['id']}, rev {full['rev']}, "
          f"last touched {ago(full['updated'])}"
          f"{' by ' + full['editor'] if full.get('editor') else ''})")
    print(f"  {ch.get('clan') or 'no clan'} / {ch.get('school') or 'no school'}"
          f" · {ans} answers · {len(ch.get('choices') or {})} choices")

    slug, path, missing = unexported(full.get("body"))
    if missing and not a.force:
        where = (os.path.relpath(path, ROOT) if path and os.path.exists(path)
                 else f"src/characters/{slug or '?'}.json (not there)")
        print(f"\n  REFUSED — {len(missing)} written answer"
              f"{'' if len(missing) == 1 else 's'} in this draft "
              f"{'is' if len(missing) == 1 else 'are'} not in {where}:")
        for w in missing[:6]:
            print(f"     {w[:96]}{'…' if len(w) > 96 else ''}")
        if len(missing) > 6:
            print(f"     …and {len(missing) - 6} more")
        print("\n  Export it from the Creator first, then delete. If you mean to "
              "throw this work\n  away, --force says so.")
        return
    if missing:
        print(f"  --force: discarding {len(missing)} answers that are not on disk")
    elif path and os.path.exists(path):
        print(f"  its work is in {os.path.relpath(path, ROOT)}")
    if not a.yes:
        print("\nNot deleted. Add --yes to remove it from the table for everyone.")
        return
    status, res = call("/drafts/" + row["id"], "DELETE")
    if status != 200:
        sys.exit(f"{status}: {res.get('error')}")
    print("  deleted from the table.")


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

    o = sub.add_parser("options", help="what this character still has to choose")
    o.add_argument("who"); o.set_defaults(fn=cmd_options)

    k = sub.add_parser("pick", help="make a choice, checked against its options")
    k.add_argument("who"); k.add_argument("key"); k.add_argument("values", nargs="+")
    k.add_argument("--apply", action="store_true")
    k.add_argument("--editor", default="Claude")
    k.set_defaults(fn=cmd_pick)

    x = sub.add_parser("delete", help="remove a draft from the table for everyone")
    x.add_argument("who"); x.add_argument("--yes", action="store_true")
    x.add_argument("--force", action="store_true",
                   help="delete even though the draft holds work no source file has")
    x.set_defaults(fn=cmd_delete)

    w = sub.add_parser("watch", help="print changes as other people make them")
    w.add_argument("--seconds", type=int, default=300)
    w.add_argument("--interval", type=int, default=10)
    w.set_defaults(fn=cmd_watch)

    a = ap.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
