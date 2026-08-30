#!/usr/bin/env python3
"""Build: repo character sources + Foundry catalog -> SQLite -> static site data.

    src/characters/*.json  ─┐
                            ├─> data/l5r.sqlite ─> site/data/*.js
    data/foundry/catalog/  ─┘

The SQLite database is the build-time store: it is where the coverage joins
happen. Nothing at runtime touches it — the served site is plain HTML + the
generated data/*.js files, so it works on GitHub Pages and from file://.

Rules text is never authored here. Every non-custom content reference resolves
to the compendium's own verbatim description; an unresolvable reference is a
build error, not a silent drop.
"""
import hashlib
import collections, difflib, glob, json, os, re, sqlite3, sys, unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "src", "characters")
CATDIR = os.path.join(ROOT, "pipeline", "foundry", "catalog")
DB = os.path.join(ROOT, "pipeline", "l5r.sqlite")
DSLTEXT = os.path.join(ROOT, "pipeline", "dsl", "rules_text.json")
LANG = os.path.join(ROOT, "pipeline", "foundry", "lang", "en.json")
SITEDATA = os.path.join(ROOT, "data")

# category in a tier -> catalog subType it resolves against
CATEGORY_SUBTYPE = {
    "techniques": "technique", "peculiarities": "peculiarity",
    "titles": "title", "bonds": "bond",
    # a title's granted ability: the actor files it as signature_scroll, the
    # compendium keeps it in Title Abilities as a technique
    "signature_scrolls": ("signature_scroll", "technique"),
    "gear": ("weapon", "armor", "item"),
}
SCHOOL_CLAN_RE = re.compile(r"^(?P<name>.*?)\s*\[(?P<clan>[^\]]+)\]\s*$")
# "Scorn of [One Group]" -> "Scorn of"; the bracket is the player's choice
OPEN_ENDED_RE = re.compile(r"\s*\[[^\]]+\]\s*$")
# "Voice of Authority" on an actor vs "Voice of Authority (Emerald Magistrate)"
# in the compendium — the qualifier names the title that granted it
QUALIFIED_RE = re.compile(r"^(?P<stem>.*?)\s*\((?P<qual>[^)]+)\)\s*$")

# --- school curriculum journals -------------------------------------------
# Each curriculum page is a <blockquote>Book p.N</blockquote> followed by a
# table whose <th> rows open a rank and whose <td><td> rows are the entries.
SRC_RE = re.compile(r"<blockquote>(.*?)</blockquote>", re.S)
SRC_PAGE_RE = re.compile(r"^(?P<book>.*?)\s*p\.\s*(?P<page>\d+)", re.S)
RANK_RE = re.compile(r"<th[^>]*>.*?Rank\s*(\d+).*?</th>", re.S | re.I)
CELL_RE = re.compile(r"<td[^>]*>(.*?)</td>\s*<td[^>]*>(.*?)</td>", re.S)
ROW_RE = re.compile(r"<tr[^>]*>(.*?)</tr>", re.S)
TAG_RE = re.compile(r"<[^>]+>")
PREFIX_RE = re.compile(r"^\((?P<grp>[^)]+)\)\s*")


# A title's curriculum is a table inside its description, under an <h2>Curriculum</h2>
# heading — single-tier, so no rank rows, but otherwise the same two-column shape.
TITLE_CUR_RE = re.compile(r"<h2>\s*Curriculum\s*</h2>\s*(?P<table><table.*?</table>)",
                          re.S | re.I)
# Both labels and their values sit in separate spans, so match on the plain text
TITLE_ABILITY_RE = re.compile(
    r"Title Ability:\s*(?P<name>.*?)(?=\s*(?:Curriculum|Status Award:|Assigned By:|$))", re.I)
STATUS_AWARD_RE = re.compile(
    r"Status Award:\s*(?P<award>.*?)(?=\s*(?:Curriculum|Title Ability:|Assigned By:|$))", re.I)


def strip_tags(h):
    import html as _html
    return re.sub(r"\s+", " ", _html.unescape(TAG_RE.sub("", h or ""))).strip()


def parse_title(doc):
    """-> (ability, status_award, [{ordinal, kind, group, label, prereq}])"""
    html = (doc.get("system") or {}).get("description") or ""
    m = TITLE_CUR_RE.search(html)
    entries = []
    if m:
        for n, row in enumerate(ROW_RE.findall(m.group("table"))):
            cm = CELL_RE.search(row)
            if not cm:
                continue
            label, kind = strip_tags(cm.group(1)), strip_tags(cm.group(2))
            prereq = "(prereq)" in label
            label = label.replace("(prereq)", "").strip()
            gm = PREFIX_RE.match(label)
            entries.append({"ordinal": n, "kind": kind, "prereq": prereq,
                            "group": gm.group("grp") if gm else None,
                            "label": PREFIX_RE.sub("", label).strip()})
    plain = strip_tags(html)
    am = TITLE_ABILITY_RE.search(plain)
    sm = STATUS_AWARD_RE.search(plain)
    return (am.group("name").strip() if am else None,
            sm.group("award").strip() if sm else None, entries)


def parse_curriculum(doc):
    """-> (book, page, [{rank, label, kind, group, prereq}])"""
    page = next((p for p in doc.get("pages", []) if p.get("type") == "text"), None)
    if not page:
        return None, None, []
    content = ((page.get("text") or {}).get("content")) or ""
    book = pageno = None
    m = SRC_RE.search(content)
    if m:
        sm = SRC_PAGE_RE.match(strip_tags(m.group(1)))
        if sm:
            book = sm.group("book").strip()
            pageno = int(sm.group("page"))
    entries, rank = [], None
    for row in ROW_RE.findall(content):
        rm = RANK_RE.search("<tr>" + row + "</tr>")
        if rm:
            rank = int(rm.group(1))
            continue
        cm = CELL_RE.search(row)
        if not cm or rank is None:
            continue
        label, kind = strip_tags(cm.group(1)), strip_tags(cm.group(2))
        prereq = "(prereq)" in label
        label = label.replace("(prereq)", "").strip()
        gm = PREFIX_RE.match(label)
        entries.append({"rank": rank, "kind": kind, "prereq": prereq,
                        "group": gm.group("grp") if gm else None,
                        "label": PREFIX_RE.sub("", label).strip()})
    return book, pageno, entries


def norm(s):
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", "", s.lower())


def book(src):
    return (src or "").strip() or None


def schema(cx):
    cx.executescript("""
    DROP TABLE IF EXISTS catalog;
    DROP TABLE IF EXISTS character;
    DROP TABLE IF EXISTS tier;
    DROP TABLE IF EXISTS tier_content;
    CREATE TABLE catalog(
      uuid TEXT PRIMARY KEY, pack TEXT, pack_label TEXT, doc_type TEXT,
      sub_type TEXT, name TEXT, norm TEXT, kind TEXT, ring TEXT, rank INTEGER,
      source_book TEXT, source_page INTEGER, clan TEXT, xp_cost INTEGER,
      description TEXT, data TEXT);
    CREATE INDEX catalog_norm ON catalog(sub_type, norm);
    CREATE TABLE character(
      slug TEXT PRIMARY KEY, name TEXT, clan TEXT, family TEXT, school TEXT,
      school_norm TEXT, role TEXT, bucket TEXT, campaign TEXT, status TEXT, accent TEXT,
      portrait TEXT, concept TEXT, summary TEXT, tier_count INTEGER,
      xp_min INTEGER, xp_max INTEGER);
    CREATE TABLE tier(
      id INTEGER PRIMARY KEY, slug TEXT, idx INTEGER, xp INTEGER, label TEXT,
      rank INTEGER, school TEXT, foundry_id TEXT, rings TEXT, skills TEXT,
      social TEXT, derived TEXT, money TEXT, advancements TEXT);
    CREATE TABLE tier_content(
      tier_id INTEGER, slug TEXT, category TEXT, name TEXT, norm TEXT,
      custom INTEGER, catalog_uuid TEXT, meta TEXT);
    CREATE INDEX tc_norm ON tier_content(norm);
    DROP TABLE IF EXISTS curriculum;
    CREATE TABLE curriculum(
      school_norm TEXT, school TEXT, rank INTEGER, kind TEXT, grp TEXT,
      label TEXT, norm TEXT, prereq INTEGER);
    CREATE INDEX cur_school ON curriculum(school_norm);
    DROP TABLE IF EXISTS title_curriculum;
    CREATE TABLE title_curriculum(
      title_norm TEXT, title TEXT, ordinal INTEGER, kind TEXT, grp TEXT,
      label TEXT, norm TEXT, prereq INTEGER, ability TEXT, status_award TEXT);
    CREATE INDEX tcur_title ON title_curriculum(title_norm);
    """)


def school_name_corrections():
    """Upstream pack typos in school titles, fixed before anything sees them."""
    src = json.load(open(os.path.join(ROOT, "src", "foundry_sources.json")))
    return {k: v["to"] for k, v in (src.get("school_name_corrections") or {}).items()
            if not k.startswith("_")}


_SCHOOL_FIX = None


def fix_school(name):
    global _SCHOOL_FIX
    if _SCHOOL_FIX is None:
        _SCHOOL_FIX = school_name_corrections()
    return _SCHOOL_FIX.get(name, name)


def load_catalog(cx):
    index = json.load(open(os.path.join(CATDIR, "index.json")))
    full = {}
    for path in glob.glob(os.path.join(CATDIR, "*.json")):
        if os.path.basename(path) == "index.json":
            continue
        pack = "l5r5e-compendia-sortilege." + os.path.basename(path)[:-5]
        for doc in json.load(open(path)):
            full[(pack, norm(doc["name"]))] = doc
    rows, missing, curriculum, title_cur = [], 0, [], []
    for pack, v in index.items():
        for e in v["entries"]:
            doc = full.get((pack, norm(e["name"])))
            sysd = (doc or {}).get("system", {}) or {}
            sr = sysd.get("source_reference") or {}
            m = SCHOOL_CLAN_RE.match(e["name"])
            if "titles-" in pack and doc:
                ability, award, tentries = parse_title(doc)
                for ce in tentries:
                    title_cur.append((norm(e["name"]), e["name"], ce["ordinal"],
                                      ce["kind"], ce["group"], ce["label"],
                                      norm(ce["label"]), 1 if ce["prereq"] else 0,
                                      ability, award))
            if "school-curriculum" in pack and doc:
                cbook, cpage, centries = parse_curriculum(doc)
                sr = {"source": cbook, "page": cpage}
                sname = fix_school(m.group("name") if m else e["name"])
                for ce in centries:
                    curriculum.append((norm(sname), sname, ce["rank"], ce["kind"],
                                       ce["group"], ce["label"], norm(ce["label"]),
                                       1 if ce["prereq"] else 0))
            if doc is None:
                missing += 1
            # School Curriculum names carry a "[Clan]" suffix; the display name and
            # the norm both drop it, so a character's school matches exactly.
            display = m.group("name") if m else e["name"]
            if pack.endswith("school-curriculum-l5r-sortilege") or "school-curriculum" in pack:
                display = fix_school(display)
            rows.append((
                e["uuid"], pack, v["label"], v["type"], e["subType"] or v["type"],
                display, norm(display),
                sysd.get("technique_type") or sysd.get("peculiarity_type")
                or sysd.get("category"),
                sysd.get("ring"), sysd.get("rank"), book(sr.get("source")),
                sr.get("page"), m.group("clan") if m else None, sysd.get("xp_cost"),
                sysd.get("description"), json.dumps(sysd, ensure_ascii=False),
            ))
    cx.executemany("INSERT INTO catalog VALUES (" + ",".join("?" * 16) + ")", rows)
    cx.executemany("INSERT INTO curriculum VALUES (?,?,?,?,?,?,?,?)", curriculum)
    cx.executemany("INSERT INTO title_curriculum VALUES (" + ",".join("?" * 10) + ")",
                   title_cur)
    return len(rows), missing, len(curriculum), len(title_cur)


def title_aliases():
    """Campaign-renamed title -> the compendium title supplying its curriculum.

    A table keeps its own name on the sheet; only the curriculum lookup moves.
    """
    src = json.load(open(os.path.join(ROOT, "src", "foundry_sources.json")))
    out = {}
    for name, spec in (src.get("title_aliases") or {}).items():
        if name.startswith("_"):
            continue
        target = spec["curriculum_from"] if isinstance(spec, dict) else spec
        out[norm(name)] = norm(target)
    return out


def school_aliases():
    """Character school name -> compendium spelling, for entries the compendium
    gets wrong. The source file keeps the printed spelling; only the match bends."""
    src = json.load(open(os.path.join(ROOT, "src", "foundry_sources.json")))
    out = {}
    for name, spec in (src.get("school_aliases") or {}).items():
        if name.startswith("_"):
            continue
        out[norm(name)] = norm(spec["roll_name"] if isinstance(spec, dict) else spec)
    return out


def load_characters(cx):
    ALIASES = school_aliases()
    unresolved = []
    tid = 0
    for path in sorted(glob.glob(os.path.join(SRC, "*.json"))):
        c = json.load(open(path))
        tiers = c["tiers"]
        snorm = norm(c["identity"].get("school"))
        snorm = ALIASES.get(snorm, snorm)
        cx.execute("INSERT INTO character VALUES (" + ",".join("?" * 17) + ")", (
            c["slug"], c["name"], c["identity"].get("clan"), c["identity"].get("family"),
            c["identity"].get("school"), snorm,
            c["identity"].get("role"), c.get("bucket"), c.get("campaign"),
            c.get("status"), c.get("accent"), c.get("portrait"),
            c.get("concept"), c.get("summary"),
            len(tiers), min(t["xp"] for t in tiers), max(t["xp"] for t in tiers)))
        for idx, t in enumerate(tiers):
            tid += 1
            cx.execute("INSERT INTO tier VALUES (" + ",".join("?" * 14) + ")", (
                tid, c["slug"], idx, t["xp"], t.get("label"), t.get("rank"),
                t.get("school"), t.get("foundry_id"),
                *[json.dumps(t.get(k), ensure_ascii=False) for k in
                  ("rings", "skills", "social", "derived", "money", "advancements")]))
            for cat, sub in CATEGORY_SUBTYPE.items():
                subs = sub if isinstance(sub, tuple) else (sub,)
                for entry in t.get(cat, []):
                    n = norm(entry["name"])
                    uuid = None
                    if not entry.get("custom"):
                        row = cx.execute(
                            "SELECT uuid FROM catalog WHERE norm=? AND sub_type IN (%s)"
                            % ",".join("?" * len(subs)), (n, *subs)).fetchone()
                        if not row:
                            # Open-ended compendium entries ("Scorn of", "Hero of")
                            # are recorded with the target filled in — resolve the
                            # stem, keep the character's specific wording.
                            stem = norm(OPEN_ENDED_RE.sub("", entry["name"]))
                            if stem and stem != n:
                                row = cx.execute(
                                    "SELECT uuid FROM catalog WHERE norm=? AND sub_type IN (%s)"
                                    % ",".join("?" * len(subs)), (stem, *subs)).fetchone()
                        if not row:
                            # The compendium may qualify the name by the title that
                            # grants it ("Voice of Authority (Emerald Magistrate)").
                            # Only accept it when this character holds that title.
                            held = {norm(x["name"]) for x in t.get("titles", [])}
                            cands = cx.execute(
                                "SELECT uuid, name FROM catalog WHERE sub_type IN (%s)"
                                " AND norm LIKE ? || '%%'" % ",".join("?" * len(subs)),
                                (*subs, n)).fetchall()
                            for cand in cands:
                                qm = QUALIFIED_RE.match(cand[1])
                                if qm and norm(qm.group("stem")) == n \
                                        and norm(qm.group("qual")) in held:
                                    row = cand
                                    break
                        if row:
                            uuid = row[0]
                        else:
                            unresolved.append((c["slug"], cat, entry["name"]))
                    cx.execute("INSERT INTO tier_content VALUES (?,?,?,?,?,?,?,?)", (
                        tid, c["slug"], cat, entry["name"], n,
                        1 if entry.get("custom") else 0, uuid,
                        json.dumps(entry, ensure_ascii=False)))
    return unresolved


def twenty_question_labels():
    """The official question wording and page references, from the l5r5e system's
    own en.json. Never retyped here — a paraphrase would be wrong on both the
    question and the page number."""
    if not os.path.exists(LANG):
        print("   ! no pipeline/foundry/lang/en.json — run foundry_catalog.py")
        return {}
    tq = json.load(open(LANG))["l5r5e"]["twenty_questions"]
    parts, questions, fields = [], {}, {}
    for pkey in sorted((k for k in tq if k.startswith("part") and k != "part0"),
                       key=lambda k: int(k[4:])):
        part = tq[pkey]
        qs = []
        for k, v in part.items():
            m = re.match(r"^q(\d+)(_pow)?$", k)
            if m:
                questions.setdefault(int(m.group(1)), {})["pow" if m.group(2) else "core"] = v
                if not m.group(2):
                    qs.append(int(m.group(1)))
            elif not k.startswith("title"):
                fields[k] = v
        parts.append({"key": pkey, "title": part.get("title"),
                      "title_pow": part.get("title_pow"), "questions": sorted(qs)})
    return {"parts": parts, "questions": questions, "fields": fields}


def emit_local_key():
    """Hand the Creator the .env Anthropic key, for local use only.

    data/ai-key.local.js is gitignored, so it exists on this machine and never
    on the published site — and the Creator only requests it when the page is
    served from localhost or opened from disk. A key must not ship with a
    static site that anyone can view source on.
    """
    dest = os.path.join(SITEDATA, "ai-key.local.js")
    key = None
    env = os.path.join(ROOT, ".env")
    if os.path.exists(env):
        for line in open(env):
            line = line.strip()
            if line.startswith("ANTHROPIC_API_KEY="):
                key = line.split("=", 1)[1].strip()
    if not key:
        if os.path.exists(dest):
            os.remove(dest)
        return False
    with open(dest, "w") as f:
        f.write("// Local convenience only — gitignored, never published.\n")
        f.write("window.L5R_LOCAL_AI_KEY = %s;\n" % json.dumps(key))
    return True


def archive_drafts(docs):
    """Enough of each draft character for the Creator to pick it up.

    Drafts exist in two places — Foundry's Draft folder, and the Creator's own
    browser storage — and a draft that only shows in one of them is a draft the
    author cannot find. This is the archive half, so the Creator can list both.

    Concept material rides along from the manifest rather than from the
    character source: it is authoring context, never part of the record, so it
    must not survive promotion. See `concepts` in src/foundry_sources.json.
    """
    concepts = (json.load(open(os.path.join(ROOT, "src", "foundry_sources.json")))
                .get("concepts") or {})
    out = []
    for c in docs:
        if c.get("status") != "draft":
            continue
        t = c["tiers"][0]
        out.append({
            "slug": c["slug"], "name": c["name"], "campaign": c.get("campaign"),
            "portrait": c.get("portrait"),
            "identity": {"clan": c.get("clan"), "family": c.get("family"),
                         "school": c.get("school"), "role": c.get("role")},
            "rings": t.get("rings"),
            "social": {k: (t.get("social") or {}).get(k)
                       for k in ("honor", "glory", "status", "giri", "ninjo",
                                 "bushido_tenets")},
            "peculiarities": [e["name"] for e in t.get("peculiarities", [])],
            "twenty_questions": c.get("twenty_questions", {}),
            "concept": concepts.get(c["slug"]) or "",
        })
    return out


def heritage_coverage():
    """Which heritage-table entry each character took, where that is determinable.

    Question 18's answer is recorded as free prose on most actors ("Named after
    her great-aunt, who perished..."), not as a table entry, so a character is
    matched only when its text actually names an entry. Everything else is
    reported as unmatched rather than guessed at.
    """
    path = os.path.join(ROOT, "data", "chargen", "heritages.js")
    if not os.path.exists(path):
        return {}
    raw = open(path).read()
    tables = json.loads(raw[raw.index("=") + 1:].rstrip().rstrip(";"))

    lookup = []
    for key, t in tables.items():
        for e in t["entries"]:
            if e["name"]:
                lookup.append((key, e["name"], norm(e["name"])))

    used, unmatched = collections.defaultdict(list), []
    for src in sorted(glob.glob(os.path.join(SRC, "*.json"))):
        c = json.load(open(src))
        step = ((c.get("twenty_questions") or {}).get("steps") or {}).get("step18") or {}
        text = (step.get("answers") or {}).get("heritage_name")
        if not text:
            continue
        n = norm(text)
        hit = [(k, name) for k, name, en in lookup if en and en in n]
        if hit:
            used[hit[0][0] + "::" + hit[0][1]].append(
                {"slug": c["slug"], "name": c["name"]})
        else:
            unmatched.append({"slug": c["slug"], "name": c["name"],
                              "text": text[:160]})
    return {
        "tables": {k: {"name": t["name"], "source": t.get("source"),
                       "entries": [{"roll": e["roll"], "name": e["name"]}
                                   for e in t["entries"]]}
                   for k, t in tables.items()},
        "used": used, "unmatched": unmatched,
    }


def emit(cx):
    """Write the site's data files.

    Split per character on purpose: a single characters.js was 781 KB at six
    characters, which would be ~14 MB at 110. Index pages load only the small
    roster; a character page loads only its own file.
    """
    os.makedirs(SITEDATA, exist_ok=True)
    chardir = os.path.join(SITEDATA, "characters")
    os.makedirs(chardir, exist_ok=True)
    for stale in glob.glob(os.path.join(chardir, "*.js")):
        os.remove(stale)

    def write(path, varname, obj):
        with open(path, "w") as f:
            f.write(f"window.{varname} = ")
            json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
            f.write(";\n")
        return os.path.getsize(path)

    cx.row_factory = sqlite3.Row
    curricula = collections.defaultdict(list)
    for r in cx.execute("SELECT * FROM curriculum ORDER BY school_norm, rank"):
        curricula[r["school_norm"]].append(
            {"rank": r["rank"], "kind": r["kind"], "group": r["grp"],
             "label": r["label"], "prereq": bool(r["prereq"])})

    # Rules text, resolved from the DSL corpus by scripts/dsl_rules_text.py.
    # It lives in a file rather than this database because main() deletes and
    # recreates the database on every run.
    dsl_text = {}
    if os.path.exists(DSLTEXT):
        dsl_text = json.load(open(DSLTEXT))

    roster, biggest, docs = [], 0, []
    for c in cx.execute("SELECT * FROM character ORDER BY name"):
        src = json.load(open(os.path.join(SRC, c["slug"] + ".json")))
        tiers = []
        for t in cx.execute("SELECT * FROM tier WHERE slug=? ORDER BY idx", (c["slug"],)):
            content = collections.defaultdict(list)
            for r in cx.execute("SELECT * FROM tier_content WHERE tier_id=?", (t["id"],)):
                entry = json.loads(r["meta"])
                if r["catalog_uuid"]:
                    cat = cx.execute(
                        "SELECT kind,ring,rank,source_book,source_page,description,data"
                        " FROM catalog WHERE uuid=?", (r["catalog_uuid"],)).fetchone()
                    # Rules text comes from the DSL corpus; Foundry is the catalog,
                    # not the rules. scripts/dsl_rules_text.py fills dsl_text and
                    # gates every referenced entry, so a fall-through here is an
                    # entry that ran the gate and has a stated exception.
                    d = dsl_text.get(r["catalog_uuid"])
                    entry["description"] = d["html"] if d else cat["description"]
                    entry["text_source"] = "dsl" if d else "foundry"
                    if d and d["via"]:
                        entry["text_via"] = d["via"]
                    entry["source"] = {"book": cat["source_book"], "page": cat["source_page"]}
                    entry["uuid"] = r["catalog_uuid"]
                    # only the mechanical fields a sheet renders; not the whole blob
                    d = json.loads(cat["data"])
                    for k in ("damage", "deadliness", "range", "grip_1", "grip_2", "skill",
                              "category", "armor", "rarity", "zeni", "properties",
                              "xp_cost", "types"):
                        if d.get(k) not in (None, "", [], {}):
                            entry.setdefault(k, d[k])
                content[r["category"]].append(entry)
            tiers.append({
                "xp": t["xp"], "label": t["label"], "rank": t["rank"],
                "school": t["school"], "foundry_id": t["foundry_id"],
                **{k: json.loads(t[k]) for k in
                   ("rings", "skills", "social", "derived", "money", "advancements")},
                **{k: content.get(k, []) for k in CATEGORY_SUBTYPE},
            })
        talias = title_aliases()
        held = {norm(e["name"]) for t in tiers for e in t.get("titles", [])}
        title_curricula = {}
        for tn in held:
            # a renamed title borrows its curriculum from the compendium title
            lookup = talias.get(tn, tn)
            entries = [dict(r) for r in cx.execute(
                "SELECT title, ordinal, kind, grp, label, prereq, ability, status_award"
                " FROM title_curriculum WHERE title_norm=? ORDER BY ordinal", (lookup,))]
            if entries:
                title_curricula[tn] = {
                    "title": entries[0]["title"],
                    "aliased_from": entries[0]["title"] if lookup != tn else None,
                    "ability": entries[0]["ability"],
                    "status_award": entries[0]["status_award"],
                    "entries": [{"kind": e["kind"], "group": e["grp"],
                                 "label": e["label"], "prereq": bool(e["prereq"])}
                                for e in entries],
                }
        doc = {**{k: c[k] for k in c.keys() if k != "school_norm"},
               "twenty_questions": src.get("twenty_questions", {}),
               "notes": src.get("notes", ""),
               "curriculum": curricula.get(c["school_norm"], []),
               "title_curricula": title_curricula,
               "tiers": tiers}
        docs.append(doc)
        size = write(os.path.join(chardir, c["slug"] + ".js"), "L5R_CHARACTER", doc)
        biggest = max(biggest, size)
        if c["status"] != "draft":
            roster.append({k: c[k] for k in
                           ("slug", "name", "clan", "family", "school", "role", "bucket",
                            "campaign", "status", "portrait", "tier_count",
                            "xp_min", "xp_max")})

    # the roster is the finished archive; drafts live in the Creator until promoted
    n1 = write(os.path.join(SITEDATA, "roster.js"), "L5R_ROSTER", roster)

    # the denominator, metadata only (no long rules text) — ledger + landing tiles
    cat = [dict(r) for r in cx.execute(
        "SELECT uuid,pack,pack_label,doc_type,sub_type,name,kind,ring,rank,"
        "source_book,source_page,clan,xp_cost FROM catalog ORDER BY sub_type,name")]
    n2 = write(os.path.join(SITEDATA, "catalog.js"), "L5R_CATALOG", cat)

    used = collections.defaultdict(list)
    for r in cx.execute(
        "SELECT c.uuid uuid, tc.slug slug, MIN(t.xp) xp,"
        " (SELECT ch.status FROM character ch WHERE ch.slug = tc.slug) status"
        " FROM tier_content tc"
        " JOIN catalog c ON c.uuid = tc.catalog_uuid"
        " JOIN tier t ON t.id = tc.tier_id GROUP BY c.uuid, tc.slug"):
        used[r["uuid"]].append({"slug": r["slug"], "xp": r["xp"],
                                "draft": r["status"] == "draft"})
    customs = [dict(r) for r in cx.execute(
        "SELECT slug,category,name,MIN(meta) meta FROM tier_content"
        " WHERE custom=1 GROUP BY slug,category,name")]
    schools = [dict(r) for r in cx.execute(
        "SELECT c.uuid uuid, c.name name, c.clan clan, c.source_book source_book,"
        " c.source_page source_page,"
        " (SELECT ch.slug FROM character ch WHERE ch.school_norm = c.norm LIMIT 1) slug,"
        " (SELECT ch.status FROM character ch WHERE ch.school_norm = c.norm LIMIT 1) status"
        " FROM catalog c WHERE c.pack LIKE '%school-curriculum%' ORDER BY c.name")]
    n3 = write(os.path.join(SITEDATA, "coverage.js"), "L5R_COVERAGE",
               {"used": used, "customs": customs, "schools": schools})
    write(os.path.join(SITEDATA, "twenty_questions.js"), "L5R_20Q",
          twenty_question_labels())
    write(os.path.join(SITEDATA, "heritage_coverage.js"), "L5R_HERITAGE_COVERAGE",
          heritage_coverage())
    write(os.path.join(SITEDATA, "drafts.js"), "L5R_ARCHIVE_DRAFTS",
          archive_drafts(docs))
    emit_local_key()
    proxy = ((json.load(open(os.path.join(ROOT, "src", "foundry_sources.json")))
              .get("ai_proxy") or {}).get("url") or "")
    write(os.path.join(SITEDATA, "ai-proxy.js"), "L5R_AI_PROXY", proxy)
    return (n1, n2, n3, biggest), docs


PLAY_PAGE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{name} — {xp} XP — Character Sheet</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;500;600;700&family=Cormorant:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500;1,600&family=EB+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="../assets/l5r.css">
<link rel="stylesheet" href="../assets/play/sheet.css">
</head>
<body class="play-body">
<div class="play-bar">
  <span class="brand">{name}</span>
  <a href="../characters/{slug}.html">&lsaquo; Dossier</a>
  <span class="chip crimson">{tier_label}</span>
  <span class="spacer"></span>
  <a href="../characters/index.html">Characters</a>
  <a href="../index.html">Home</a>
</div>
<main id="sheet"></main>

<script id="sheet-data" type="application/json">
{sheet_json}
</script>
<script>window.SHEET = JSON.parse(document.getElementById("sheet-data").textContent);</script>
<script src="../assets/play/l5rdata.js"></script>
<script src="../assets/play/sheet.js"></script>
</body>
</html>
"""

# tier category -> how the play sheet labels it
PLAY_TAG = {"technique": "Technique", "peculiarity": "Peculiarity"}


def _plain(html):
    return html or ""


def _scroll_for(tier, title_name):
    """The title ability a tier carries for one title, if any.

    The actor files it as a signature_scroll named plainly ("Voice of Authority");
    the compendium qualifies it by title ("Voice of Authority (Emerald Magistrate)"),
    so match on either.
    """
    want = norm(title_name)
    for e in tier.get("signature_scrolls", []):
        m = QUALIFIED_RE.match(e.get("name") or "")
        if m and norm(m.group("qual")) == want:
            return e
    # a single unqualified ability on a tier with one title belongs to it
    scrolls = tier.get("signature_scrolls", [])
    if len(scrolls) == 1 and len(tier.get("titles", [])) == 1:
        return scrolls[0]
    return None


def ability_for(tier, title_name):
    e = _scroll_for(tier, title_name)
    return QUALIFIED_RE.sub(r"\g<stem>", e["name"]).strip() if e else None


def ability_text(tier, title_name):
    e = _scroll_for(tier, title_name)
    return _plain(e.get("description")) if e else None


def sheet_from_tier(char, tier):
    """Adapt one XP tier to the shape assets/play/sheet.js expects.

    That engine is the Portents & Fortunes character sheet, reused as-is; this
    is the only translation layer, so the engine stays a drop-in.
    """
    derived = tier.get("derived") or {}
    social = tier.get("social") or {}
    tenets = social.get("bushido_tenets") or {}
    skills = {}
    for group in (tier.get("skills") or {}).values():
        skills.update(group)
    money = tier.get("money") or {}
    money_str = ", ".join(f"{v} {k}" for k, v in money.items() if v) or None

    def gear_entry(e):
        armor = e.get("armor") or {}
        return {k: v for k, v in {
            "name": e["name"],
            "kind": ("Weapon" if e.get("damage") is not None else
                     "Armor" if armor else "Item"),
            "category": e.get("category"), "skill": e.get("skill"),
            "range": e.get("range"), "damage": e.get("damage"),
            "deadliness": e.get("deadliness"),
            "physical": armor.get("physical") or None,
            "supernatural": armor.get("supernatural") or None,
            "grips": e.get("grip_2") or None,
            "qualities": [p["name"] for p in (e.get("properties") or [])] or None,
            "rarity": e.get("rarity"), "text": _plain(e.get("description")),
        }.items() if v not in (None, "", [])}

    def simple(e, tag):
        return {k: v for k, v in {
            "name": e["name"],
            "tag": (e.get("kind") or tag).replace("_", " ").title(),
            "ring": e.get("ring"), "kind": e.get("kind"),
            "text": _plain(e.get("description")),
        }.items() if v not in (None, "", [])}

    xp = tier["xp"]
    return {
        "id": f"{char['slug']}-{xp}xp",
        "name": char["name"], "clan": char.get("clan"), "family": char.get("family"),
        "school": tier.get("school") or char.get("school"),
        "role": char.get("role"), "rank": tier.get("rank"),
        "portrait": ("../" + char["portrait"]) if char.get("portrait") else None,
        "rings": tier.get("rings") or {},
        "derived": {k: derived.get(k) for k in
                    ("endurance", "composure", "focus", "vigilance")},
        "trackers": {
            "strife": {"max": derived.get("composure")},
            "fatigue": {"max": derived.get("endurance")},
            "void": {"max": derived.get("void_points"),
                     "start": derived.get("void_points")},
        },
        "stance": "void",
        "social": {k: social.get(k) for k in ("honor", "glory", "status")},
        "xp": {"earned": xp, "spent": xp},
        "skills": skills,
        "bushido": {"paramount": tenets.get("paramount"),
                    "less": tenets.get("less_significant")},
        "ninjo": social.get("ninjo"), "giri": social.get("giri"),
        "money": money_str,
        "techniques": [simple(e, "technique") for e in tier.get("techniques", [])],
        "peculiarities": [simple(e, "peculiarity") for e in tier.get("peculiarities", [])],
        "titles": [{"name": e["name"], "text": _plain(e.get("description")),
                    "ability": ability_for(tier, e["name"]),
                    "abilityText": ability_text(tier, e["name"])}
                   for e in tier.get("titles", [])],
        "bonds": [{"name": e["name"], "text": _plain(e.get("description"))}
                  for e in tier.get("bonds", [])],
        "gear": [gear_entry(e) for e in tier.get("gear", [])],
    }


def emit_play_pages(chars):
    """One playable sheet per character per XP tier.

    A page per tier rather than one page with a version picker, because the
    engine only lets you track state on the *live* sheet — every tier here has
    to be playable, with its own saved state.
    """
    out = os.path.join(ROOT, "play")
    os.makedirs(out, exist_ok=True)
    for stale in glob.glob(os.path.join(out, "*.html")):
        os.remove(stale)
    n = 0
    for char in chars:
        for tier in char["tiers"]:
            sheet = sheet_from_tier(char, tier)
            label = tier.get("label")
            with open(os.path.join(out, f"{sheet['id']}.html"), "w") as f:
                f.write(PLAY_PAGE.format(
                    name=char["name"], slug=char["slug"], xp=tier["xp"],
                    tier_label=(f"{tier['xp']} XP · {label}" if label
                                else f"{tier['xp']} XP"),
                    sheet_json=json.dumps(sheet, ensure_ascii=False, indent=1)))
            n += 1
    return n


PAGE_STUB = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{name} — Sortilege L5R Pregens</title>
<meta name="description" content="{name} — {school}. A Legend of the Five Rings 5th Edition pregenerated character, shown at {tiers} XP tiers.">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;500;600;700&family=Cormorant:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500;1,600&family=EB+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="../assets/l5r.css">
</head>
<body>
<nav class="topnav">
  <a class="brand" href="../index.html">Sortilege L5R Pregens</a>
  <a href="../index.html">Home</a>
  <a href="index.html" class="active">Characters</a>
  <a href="../creator/index.html">Creator</a>
  <a href="../admin/index.html">Coverage</a>
</nav>

<div class="wrap">
  <div class="sheet-head">
    <div class="portrait" id="portrait-target"></div>
    <div class="ident">
      <h1 id="char-name"></h1>
      <p class="school-line" id="school-line"></p>
      <div class="tagrow" id="char-chips"></div>
    </div>
  </div>

  <div class="timeline-section">
    <div class="tl-label">Progression — select an XP tier</div>
    <div class="tl-track" id="timeline"></div>
  </div>

  <div class="tabbar" id="tabbar">
    <button type="button" data-tab="dossier" class="active">Dossier</button>
    <button type="button" data-tab="questions">Twenty Questions</button>
    <button type="button" data-tab="play">Play</button>
  </div>

  <section id="panel-dossier">
    <div id="changelog-target"></div>
    <div id="stats-target"></div>
    <div id="duty-target"></div>
    <div id="skills-target"></div>
    <div id="content-target"></div>
  </section>

  <section id="panel-questions" hidden></section>

  <section id="panel-play" hidden>
    <p class="muted small" id="play-note"></p>
    <iframe id="play-frame" title="Playable character sheet" loading="lazy"></iframe>
  </section>
</div>

<footer class="foot"><span class="mark">❖</span>Sortilege · Legend of the Five Rings 5th Edition</footer>

<script src="../data/characters/{slug}.js"></script>
<script src="../data/twenty_questions.js"></script>
<script src="../assets/sheet.js"></script>
</body>
</html>
"""


def emit_pages(cx):
    """One thin stub per character; all the rendering lives in assets/sheet.js."""
    out = os.path.join(ROOT, "characters")
    os.makedirs(out, exist_ok=True)
    # drop stubs for characters whose source is gone, or coverage.py will
    # (rightly) fail on a page with no character behind it
    for stale in glob.glob(os.path.join(out, "*.html")):
        if os.path.basename(stale) != "index.html":
            os.remove(stale)
    cx.row_factory = sqlite3.Row
    n = 0
    for c in cx.execute("SELECT * FROM character ORDER BY slug"):
        with open(os.path.join(out, c["slug"] + ".html"), "w") as f:
            f.write(PAGE_STUB.format(name=c["name"], slug=c["slug"],
                                     school=c["school"] or "", tiers=c["tier_count"]))
        n += 1
    return n


def check_schools(cx):
    """Every character's school should match a School Curriculum entry exactly.

    A near-miss is nearly always a typo in the source record, and a typo here
    silently costs a school in the coverage count — so name them loudly.
    """
    rows = cx.execute(
        "SELECT slug, school, school_norm FROM character WHERE school IS NOT NULL").fetchall()
    roll = {r[0]: r[1] for r in cx.execute(
        "SELECT norm, name FROM catalog WHERE pack LIKE '%school-curriculum%'")}
    aliases = school_aliases()
    off = []
    for slug, school, snorm in rows:
        snorm = aliases.get(snorm, snorm)
        if snorm in roll:
            continue
        near = difflib.get_close_matches(snorm, list(roll), n=1, cutoff=0.75)
        off.append((slug, school, roll[near[0]] if near else None))
    return off


ASSET_REF = re.compile(r'(?P<attr>src|href)="(?P<path>[^"?]+\.(?:js|css))(?:\?v=[0-9a-f]+)?"')


def stamp_assets():
    """Fingerprint every local .js/.css reference with a hash of its contents.

    The site is served as plain files with no cache headers, so a browser keeps
    whatever it fetched last. That has already bitten twice — a stale
    ai-proxy.js reporting no proxy, and a stale creator.js showing a school name
    that no longer exists anywhere in the build. `?v=<hash>` makes the URL change
    whenever the file does, so a rebuild is picked up and an unchanged file still
    comes from cache.

    Returns (pages rewritten, references stamped).
    """
    digests, pages, refs = {}, 0, 0

    def digest(path):
        if path not in digests:
            try:
                with open(path, "rb") as f:
                    digests[path] = hashlib.sha256(f.read()).hexdigest()[:8]
            except OSError:
                digests[path] = None
        return digests[path]

    for html in sorted(glob.glob(os.path.join(ROOT, "*.html")) +
                       glob.glob(os.path.join(ROOT, "*", "*.html"))):
        text = open(html, encoding="utf-8").read()
        base = os.path.dirname(html)
        n = [0]

        def sub(m):
            target = os.path.normpath(os.path.join(base, m.group("path")))
            d = digest(target)
            if not d:
                return m.group(0)                      # not a file we ship
            n[0] += 1
            return f'{m.group("attr")}="{m.group("path")}?v={d}"'

        out = ASSET_REF.sub(sub, text)
        refs += n[0]
        if out != text:
            open(html, "w", encoding="utf-8").write(out)
            pages += 1
    return pages, refs


def main():
    os.makedirs(os.path.dirname(DB), exist_ok=True)
    if os.path.exists(DB):
        os.remove(DB)
    cx = sqlite3.connect(DB)
    schema(cx)
    ncat, missing, ncur, ntcur = load_catalog(cx)
    unresolved = load_characters(cx)
    off_roll = check_schools(cx)
    cx.commit()
    sizes, docs = emit(cx)
    npages = emit_pages(cx)
    nplay = emit_play_pages(docs)
    cx.commit()

    print(f"catalog:    {ncat} entries ({missing} without full text yet)"
          f", {ncur} school + {ntcur} title curriculum rows")
    print(f"characters: {cx.execute('SELECT COUNT(*) FROM character').fetchone()[0]}"
          f", tiers {cx.execute('SELECT COUNT(*) FROM tier').fetchone()[0]}"
          f", content refs {cx.execute('SELECT COUNT(*) FROM tier_content').fetchone()[0]}")
    print("site data:  roster.js %.1f KB | catalog.js %.1f KB | coverage.js %.1f KB"
          " | largest character %.1f KB" % tuple(s / 1024 for s in sizes))
    print(f"pages:      {npages} character stubs, {nplay} playable sheets")
    # last, so every emitted page gets stamped along with the hand-written ones
    spages, srefs = stamp_assets()
    print(f"cache:      {srefs} asset refs fingerprinted across {spages} pages")
    proxy_url = ((json.load(open(os.path.join(ROOT, "src", "foundry_sources.json")))
                  .get("ai_proxy") or {}).get("url") or "")
    print("AI proxy:   " + (proxy_url or "not set — published Creator will ask for a key"))
    print("local AI key: " + ("data/ai-key.local.js written from .env (gitignored)"
                              if os.path.exists(os.path.join(SITEDATA, "ai-key.local.js"))
                              else "no ANTHROPIC_API_KEY in .env — Creator will ask for one"))
    if off_roll:
        print(f"SCHOOLS off the compendium roll ({len(off_roll)}):")
        for slug, school, near in off_roll:
            print(f"    {slug}: {school!r}" +
                  (f"  — did you mean {near!r}?" if near else "  — no close match"))
    if unresolved:
        print(f"UNRESOLVED references ({len(unresolved)}) — not in catalog and not marked custom:")
        for u in unresolved[:20]:
            print("   ", u)
        sys.exit(1)
    print("DONE_MARKER build ok")


if __name__ == "__main__":
    main()
