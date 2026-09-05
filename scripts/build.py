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
    # item patterns are bought with experience like anything else, and the
    # advance ledger files them on their own so they can be told from the gear
    # they modify
    "gear_patterns": "item_pattern",
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
      slug TEXT PRIMARY KEY, name TEXT, clan TEXT, family TEXT,
      -- questions 1 and 2 for a Path of Waves or Writ of the Wilds character,
      -- where a samurai has a clan and a family
      region TEXT, upbringing TEXT, origin_type TEXT,
      school TEXT,
      school_norm TEXT, role TEXT, bucket TEXT, campaign TEXT, status TEXT, accent TEXT,
      portrait TEXT, concept TEXT, summary TEXT, tier_count INTEGER,
      xp_min INTEGER, xp_max INTEGER,
      -- "archive" for a character built here, "published" for an official
      -- pregen transcribed from a printed sheet. A published one is a
      -- different kind of thing from ours: it is not evidence that a school
      -- has been covered, its purse comes off a folio rather than from
      -- question 2, and the roster hides it unless asked. See provenance()
      -- and PUBLISHED_EXCLUDED below.
      provenance TEXT, product TEXT);
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


def title_name_corrections():
    """Upstream pack typos in title names, fixed before anything sees them."""
    src = json.load(open(os.path.join(ROOT, "src", "foundry_sources.json")))
    return {k: v["to"] for k, v in (src.get("title_name_corrections") or {}).items()
            if not k.startswith("_")}


_TITLE_FIX = None


def fix_title(name):
    global _TITLE_FIX
    if _TITLE_FIX is None:
        _TITLE_FIX = title_name_corrections()
    return _TITLE_FIX.get(name, name)


def pattern_name_corrections():
    """Upstream pack typos in item-pattern names, fixed before anything sees them."""
    src = json.load(open(os.path.join(ROOT, "src", "foundry_sources.json")))
    return {k: v["to"] for k, v in (src.get("pattern_name_corrections") or {}).items()
            if not k.startswith("_")}


_PATTERN_FIX = None


def fix_pattern(name):
    global _PATTERN_FIX
    if _PATTERN_FIX is None:
        _PATTERN_FIX = pattern_name_corrections()
    return _PATTERN_FIX.get(name, name)


def catalog_additions():
    """Published content the compendium does not stock.

    The *_name_corrections maps above fix a compendium entry that is wrong;
    this covers one that is absent. Same burden of proof — the book and page —
    and deliberately no rules text: the entry exists so the name resolves, and
    the description comes from the DSL corpus like every other entry's.
    """
    src = json.load(open(os.path.join(ROOT, "src", "foundry_sources.json")))
    return {k: v for k, v in (src.get("catalog_additions") or {}).items()
            if not k.startswith("_")}


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
                tname = fix_title(e["name"])
                for ce in tentries:
                    title_cur.append((norm(tname), tname, ce["ordinal"],
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
            if "titles-" in pack:
                display = fix_title(display)
            if (e["subType"] or v["type"]) == "item_pattern":
                display = fix_pattern(display)
            rows.append((
                e["uuid"], pack, v["label"], v["type"], e["subType"] or v["type"],
                display, norm(display),
                sysd.get("technique_type") or sysd.get("peculiarity_type")
                or sysd.get("category"),
                sysd.get("ring"), sysd.get("rank"), book(sr.get("source")),
                sr.get("page"), m.group("clan") if m else None, sysd.get("xp_cost"),
                sysd.get("description"), json.dumps(sysd, ensure_ascii=False),
            ))
    # Additions last, and only when the compendium really lacks the name —
    # so a compendium entry always wins and an addition can never shadow one.
    #
    # A superseded addition is NAMED, not silently skipped. An addition is a
    # workaround for a compendium gap, and a workaround nobody is reminded of
    # is a workaround that outlives the gap it was for.
    have = {(r[4], r[6]) for r in rows}
    superseded = []
    for name, spec in catalog_additions().items():
        if (spec["sub_type"], norm(name)) in have:
            superseded.append(name)
            continue
        pack = "l5r5e-compendia-sortilege." + spec["pack"]
        label = next((v["label"] for k, v in index.items() if k == pack), None)
        rows.append((
            "Addition." + spec["pack"] + "." + norm(name), pack,
            label or spec["pack"], "Item", spec["sub_type"],
            name, norm(name), None, None, None,
            book(spec.get("source")), spec.get("page"), None,
            spec.get("xp_cost"), None,
            json.dumps({"source_reference": {"source": spec.get("source"),
                                             "page": spec.get("page")},
                        "xp_cost": spec.get("xp_cost"),
                        "_addition": True}, ensure_ascii=False),
        ))
    cx.executemany("INSERT INTO catalog VALUES (" + ",".join("?" * 16) + ")", rows)
    cx.executemany("INSERT INTO curriculum VALUES (?,?,?,?,?,?,?,?)", curriculum)
    cx.executemany("INSERT INTO title_curriculum VALUES (" + ",".join("?" * 10) + ")",
                   title_cur)
    if superseded:
        print(f"   the compendium now stocks {len(superseded)} entry(ies) the "
              f"manifest adds — delete them from catalog_additions in "
              f"src/foundry_sources.json: " + ", ".join(sorted(superseded)))
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


def corpus_base_dir():
    """Where the DSL corpus lives, from the synthesist manifest that composes
    it -- the same answer dsl_rules_text.py gets, rather than a second copy of
    the path to fall out of step."""
    import dsl_rules_text
    manifest = json.load(open(dsl_rules_text.MANIFEST))
    return os.path.normpath(os.path.join(os.path.dirname(dsl_rules_text.MANIFEST),
                                         manifest["base_dir"]))


GENDERS = ("male", "female", "nonbinary")

# The pronouns a concept can be written with. A premise that says "he" has
# settled its own entry, so the gender is checked against it rather than
# trusted -- but a concept naming a second person ("her late lord ... finds him
# unwilling") carries both, and there the sentence cannot say which is the
# character. Mixed is skipped, single-gender is enforced.
PRONOUNS = {"male": re.compile(r"\b(he|him|his|himself)\b", re.I),
            "female": re.compile(r"\b(she|her|hers|herself)\b", re.I)}


def concept_pronoun(text):
    """male, female, or None if a concept names both genders or neither."""
    hit = [g for g, rx in PRONOUNS.items() if rx.search(text or "")]
    return hit[0] if len(hit) == 1 else None


def campaigns(cx):
    """Every campaign the archive knows of, whether a character is tagged to
    one yet or not.

    A campaign used to exist only as a value on a character, so the roster's
    filter could offer nothing that had not already been built — and a campaign
    somebody means to run but has not set up had nowhere to be recorded. The
    manifest's campaign_list declares those; this merges them with what the
    characters actually carry, so the filter reads from one list.

    Counts are the archive's own characters. A published pregen carries no
    campaign and could not appear under one anyway.
    """
    declared = (json.load(open(os.path.join(ROOT, "src", "foundry_sources.json")))
                .get("campaign_list") or {})
    counts = collections.Counter()
    for (name,) in cx.execute(
            "SELECT campaign FROM character"
            " WHERE campaign IS NOT NULL AND provenance = 'archive'"):
        counts[name] += 1
    # every school on the compendium roll, and which of them the archive has
    # already built a character to
    roll = {n: name for name, n in cx.execute(
        "SELECT name, norm FROM catalog WHERE pack LIKE '%school-curriculum%'")}
    # the 42 families and whose clan each is, for checking a pencilled `family`
    famclan = {}
    fpath = os.path.join(SITEDATA, "chargen", "families.js")
    if os.path.exists(fpath):
        ftext = open(fpath, encoding="utf-8").read()
        for f in json.loads(ftext[ftext.index("[") :].rstrip().rstrip(";")):
            famclan[norm(f["name"])] = (f["name"], f.get("clan"))
    covered = {n for (n,) in cx.execute(
        "SELECT DISTINCT school_norm FROM character"
        " WHERE school_norm IS NOT NULL AND provenance = 'archive'")}

    names = sorted(set(counts) | {k for k in declared if not k.startswith("_")})

    # One pack can serve two adventures -- The Scroll or the Blade runs inside
    # Winter's Embrace, in the same palace -- so the base adventure holds the
    # shortlist and the other points at it rather than repeating it. A link
    # that only goes one way is refused: a pack_from with nothing pointing back
    # is as likely a typo as an intent.
    links = []
    for name in names:
        spec = declared.get(name) or {}
        src_name = spec.get("pack_from")
        if not src_name:
            continue
        owner = declared.get(src_name)
        if owner is None:
            links.append(f"{name}: pack_from {src_name!r} is not a declared campaign")
        elif not owner.get("pencilled_schools"):
            links.append(f"{name}: pack_from {src_name!r} has no pencilled schools "
                         f"to share")
        elif name not in (owner.get("pack_shared_with") or []):
            links.append(f"{name}: pack_from {src_name!r}, but {src_name} does not "
                         f"list it in pack_shared_with")
        if spec.get("pencilled_schools"):
            links.append(f"{name}: has both pack_from and its own "
                         f"pencilled_schools — one or the other")
    for name in names:
        for shared in (declared.get(name) or {}).get("pack_shared_with") or []:
            if (declared.get(shared) or {}).get("pack_from") != name:
                links.append(f"{name}: shares its pack with {shared!r}, which does "
                             f"not point back with pack_from")
    if links:
        raise SystemExit(f"FAIL — {len(links)} broken shared-pack link(s):\n"
                         + "\n".join("   " + m for m in links))

    out, offroll, stale, blank, badfam, badgender = [], [], [], [], [], []
    for name in names:
        spec = declared.get(name) or {}
        # a campaign sharing another's pack shows that shortlist rather than
        # keeping a copy that could drift out of step with it
        owner = spec.get("pack_from")
        labels = ((declared.get(owner) or {}).get("pencilled_schools") if owner
                  else spec.get("pencilled_schools")) or []
        # the shortlist a pack will be built from, each entry resolved against
        # the roll so a misspelling is caught while it is still a plan
        pencilled = []
        for entry in labels:
            # an entry is the school's roll name, or an object carrying a
            # one-line concept beside it
            label = entry["school"] if isinstance(entry, dict) else entry
            concept = entry.get("concept") if isinstance(entry, dict) else None
            n = norm(label)
            if n not in roll:
                offroll.append((name, label))
                continue
            # A blank concept is a note somebody started and left, which
            # reads on the page as though there were none. An absent one is
            # different and fine: an entry may be an object to carry a family
            # before anyone has written its premise.
            if isinstance(entry, dict) and "concept" in entry \
                    and not str(concept or "").strip():
                blank.append((name, label))
                continue
            if n in covered:
                stale.append((name, roll[n]))
            # the family this build takes. A school named for a family has a
            # matching build and, eventually, one where the family differs —
            # so the field is checked against the corpus but never inferred.
            fam = entry.get("family") if isinstance(entry, dict) else None
            if fam:
                key = norm(fam)
                if key not in famclan:
                    badfam.append((name, label, fam, "is not one of the 42 "
                                                     "families in the corpus"))
                else:
                    fname, fclan = famclan[key]
                    schclan = (cx.execute(
                        "SELECT clan FROM catalog WHERE norm=?", (n,)
                    ).fetchone() or [None])[0]
                    if fclan and schclan and fclan != schclan:
                        badfam.append((name, label, fam,
                                       f"is {fclan} where the school is {schclan}"))
                    fam = fname
            # The gender this build is written for. A pack is a table's
            # worth of characters and wants a spread, so it is planned here
            # rather than left to whoever builds it -- and a concept already
            # written with a pronoun in it settles its own entry.
            gender = entry.get("gender") if isinstance(entry, dict) else None
            if gender not in GENDERS:
                badgender.append((name, label, gender,
                                  "is not one of " + ", ".join(GENDERS)))
            else:
                said = concept_pronoun(concept)
                if said and said != gender:
                    badgender.append((name, label, gender,
                                      f"but the concept is written as {said}"))
            pencilled.append({"school": roll[n], "covered": n in covered,
                              "concept": concept, "family": fam,
                              "gender": gender})
        out.append({"name": name, "characters": counts.get(name, 0),
                    "arc": spec.get("arc"), "note": spec.get("note"),
                    "pencilled": pencilled,
                    "pencilled_why": spec.get("pencilled_why")
                                     or (declared.get(owner) or {}).get("pencilled_why"),
                    "pack_from": owner,
                    "pack_shared_with": spec.get("pack_shared_with") or [],
                    # declared and empty: something to set up, not a gap in the
                    # data — the roster says so rather than showing nothing
                    "declared": name in declared})

    if offroll:
        raise SystemExit(
            f"FAIL — {len(offroll)} pencilled school(s) are not on the "
            f"compendium's School Curriculum roll:\n"
            + "\n".join(f"   {c}: {s!r}" for c, s in offroll))
    if blank:
        raise SystemExit(
            f"FAIL — {len(blank)} pencilled school(s) carry an empty concept:\n"
            + "\n".join(f"   {c}: {s!r}" for c, s in blank))
    if badfam:
        raise SystemExit(
            f"FAIL — {len(badfam)} pencilled family assignment(s) do not hold:\n"
            + "\n".join(f"   {c}: {s} — {f!r} {why}"
                         for c, s, f, why in badfam))
    if badgender:
        raise SystemExit(
            f"FAIL — {len(badgender)} pencilled gender(s) do not hold:\n"
            + "\n".join(f"   {c}: {s} — {g!r} {why}"
                         for c, s, g, why in badgender))
    # Each pack splits male/female as near to evenly as its own count allows.
    # Off by one is the closest an odd-numbered pack can come; off by more is a
    # plan drifting, and the locked concepts are not currently enough to force
    # it in any pack.
    skewed = []
    for c in out:
        if c["pack_from"] or not c["pencilled"]:
            continue
        g = collections.Counter(p["gender"] for p in c["pencilled"])
        if abs(g["male"] - g["female"]) > 1:
            skewed.append((c["name"], g["male"], g["female"], g["nonbinary"]))
    if skewed:
        raise SystemExit(
            f"FAIL — {len(skewed)} pack(s) no longer split close to evenly:\n"
            + "\n".join(f"   {n}: {m}M {f}F"
                         + (f" {nb}NB" if nb else "") + " — off by "
                         + str(abs(m - f)) for n, m, f, nb in skewed))
    stale = sorted(set(stale))
    if stale:
        # not an error: a pack may deliberately revisit a school. But the point
        # of a shortlist is usually fresh ground, so say which have been taken
        # since it was written.
        print(f"   ! {len(stale)} pencilled school(s) the archive has since "
              f"covered: " + ", ".join(f"{c} → {s}" for c, s in stale))

    # The same school pencilled for two packs means only one of them can be the
    # build that covers it, so the second pack is planning ground it will not
    # gain. Also not an error -- two packs may want the same school on purpose
    # -- but it is almost always a slip, and it gets likelier with every list.
    seen = collections.defaultdict(list)
    for c in out:
        # a borrowed list is the same pack by design, so counting it here would
        # report every shared school as double-booked
        if c["pack_from"]:
            continue
        for pen in c["pencilled"]:
            seen[pen["school"]].append(c["name"])
    twice = {k: v for k, v in seen.items() if len(v) > 1}
    if twice:
        print(f"   ! {len(twice)} school(s) pencilled for more than one "
              f"campaign: "
              + "; ".join(f"{k} ({', '.join(v)})" for k, v in sorted(twice.items())))
    missing = [c["name"] for c in out
               if c["declared"] and not c["characters"] and not c["note"]]
    if missing:
        # a declared campaign with neither a character nor a reason is a line
        # somebody added and forgot; say so rather than shipping a dead filter
        print(f"   ! {len(missing)} declared campaign(s) with no characters and "
              f"no note: " + ", ".join(missing))

    # An `arc` names a file in the DSL corpus. The pipeline already cannot run
    # without that corpus, so a pointer at a file that is not there is a stated
    # fact gone stale rather than a missing optional dependency -- and a
    # renamed arc would otherwise rot here unnoticed.
    base = corpus_base_dir()
    dead = [(c["name"], c["arc"]) for c in out
            if c["arc"] and not os.path.exists(os.path.join(base, c["arc"]))]
    if dead:
        raise SystemExit(
            f"FAIL — {len(dead)} campaign_list arc(s) name a file that is not "
            f"in the corpus at {base}:\n"
            + "\n".join(f"   {n}: {a}" for n, a in dead))
    # Every adventure the corpus holds is either a campaign's or explicitly
    # not one. This is the check that was missing: the adventure list was
    # read off what happened to be on disk, so a converted arc could sit
    # there unclaimed and an adventure named only by its own supplement
    # -- Blood of the Lioness, Wheel of Judgment -- went unnoticed.
    claimed = {c["arc"] for c in out if c["arc"]}
    excused = {k: v for k, v in (json.load(open(
        os.path.join(ROOT, "src", "foundry_sources.json")))
        .get("arcs_without_a_campaign") or {}).items() if not k.startswith("_")}
    on_disk = {os.path.basename(f) for f in glob.glob(os.path.join(base, "*.arc"))}
    orphan = sorted(on_disk - claimed - set(excused))
    reasonless = sorted(a for a, why in excused.items() if not str(why).strip())
    ghosts = sorted((claimed | set(excused)) - on_disk)
    problems = []
    if orphan:
        problems += [f"{a}: an adventure in the corpus that no campaign claims "
                     f"and nothing excuses" for a in orphan]
    if reasonless:
        problems += [f"{a}: excused from having a campaign with no reason given"
                     for a in reasonless]
    if ghosts:
        problems += [f"{a}: claimed or excused, but not in the corpus" for a in ghosts]
    if problems:
        raise SystemExit(
            f"FAIL — {len(problems)} arc(s) unaccounted for:\n"
            + "\n".join("   " + m for m in problems))
    print(f"   adventures: {len(on_disk)} arcs in the corpus, {len(claimed)} "
          f"claimed by a campaign, {len(excused)} excused with a reason")

    with_arc = sum(1 for c in out if c["arc"])
    # The second build owed on every family-named school, and whether the plan
    # for it still holds: the school must be one the packs actually pencil, and
    # a named family must be a real one whose standing matches the kind.
    seconds = {k: v for k, v in (json.load(open(
        os.path.join(ROOT, "src", "foundry_sources.json")))
        .get("second_builds") or {}).items() if not k.startswith("_")}
    if seconds:
        pen_by_school = {p["school"]: p for c in out if not c["pack_from"]
                         for p in c["pencilled"]}
        # Vassal houses this archive can place to a clan. All fourteen from
        # the corpus, plus Raikuto and Ishi from the L5R wiki — see the note on
        # second_builds for why only those two were taken from it.
        VASSAL = {"Fureheshu", "Ashidaka", "Hanako", "Hiramori", "Tsume",
                  "Izaku", "Reju", "Damasu", "Goseki", "Itagawa", "Naoko",
                  "Rokugo", "Shiko", "Nasu", "Raikuto", "Ishi"}
        KINDS = {"vassal", "out of family", "out of clan"}
        bad = []
        for school, spec in sorted(seconds.items()):
            first = pen_by_school.get(school)
            if first is None:
                bad.append(f"{school}: no pack pencils this school")
                continue
            if first["family"] != spec.get("first_build_family"):
                bad.append(f"{school}: the pack's family is "
                           f"{first['family']!r}, not "
                           f"{spec.get('first_build_family')!r}")
            if spec.get("kind") not in KINDS:
                bad.append(f"{school}: kind {spec.get('kind')!r} is not one of "
                           + ", ".join(sorted(KINDS)))
            fam = spec.get("family")
            if spec.get("kind") == "vassal":
                if fam not in VASSAL:
                    bad.append(f"{school}: {fam!r} is not a vassal family this "
                               f"archive can place")
            elif spec.get("kind") == "out of family":
                if not fam:
                    bad.append(f"{school}: out of family with no family named")
                elif norm(fam) not in famclan:
                    bad.append(f"{school}: {fam!r} is not one of the 42")
                elif famclan[norm(fam)][1] != spec.get("clan"):
                    bad.append(f"{school}: {fam!r} is not of {spec.get('clan')}")
                elif norm(fam) == norm(first["family"] or ""):
                    bad.append(f"{school}: {fam!r} is the first build's own "
                               f"family, so it is not out of family")
            elif fam:
                bad.append(f"{school}: out of clan should name no family yet, "
                           f"and names {fam!r}")
        if bad:
            raise SystemExit(f"FAIL — {len(bad)} second-build plan(s) do not "
                             f"hold:\n" + "\n".join("   " + m for m in bad))
        kinds = collections.Counter(v.get("kind") for v in seconds.values())
        print(f"   second builds: {len(seconds)} owed — "
              + ", ".join(f"{v} {k}" for k, v in sorted(kinds.items())))

    # The roll, accounted for. Not a gate -- a new book adds schools and the
    # unclaimed count goes back up, which is normal -- but the number is the
    # one that says how much of the archive's own goal is even planned.
    unclaimed = sorted(roll[k] for k in roll
                       if k not in covered and k not in
                       {norm(p["school"]) for c in out if not c["pack_from"]
                        for p in c["pencilled"]})
    print(f"   schools: {len(roll)} on the roll = {len(covered)} built + "
          f"{len(roll) - len(covered) - len(unclaimed)} pencilled + "
          f"{len(unclaimed)} unclaimed"
          + ("   (the roll is closed)" if not unclaimed else ""))

    withconcept = sum(1 for c in out if not c["pack_from"]
                      for p in c["pencilled"] if p["concept"])
    withfamily = sum(1 for c in out if not c["pack_from"]
                     for p in c["pencilled"] if p["family"])
    npen = sum(len(c["pencilled"]) for c in out if not c["pack_from"])
    nshare = sum(1 for c in out if c["pack_from"])
    print(f"   campaigns: {len(out)} ({sum(1 for c in out if c['declared'])} "
          f"declared, {with_arc} pointing at an arc on disk"
          + (f", {npen} schools pencilled across "
             f"{sum(1 for c in out if c['pencilled'] and not c['pack_from'])}"
             if npen else "")
          + (f", {nshare} sharing another's pack" if nshare else "")
          + (f", {withconcept} of {npen} with a concept" if withconcept else "")
          + (f", {withfamily} with a family" if withfamily else "")
          + ")")
    if npen:
        g = collections.Counter(p["gender"] for c in out if not c["pack_from"]
                                for p in c["pencilled"])
        packs = sum(1 for c in out if c["pencilled"] and not c["pack_from"])
        print(f"   pencilled genders: {g['male']}M {g['female']}F "
              f"{g['nonbinary']}NB — every one of {packs} packs within one")
    return out


def school_aliases():
    """Character school name -> compendium spelling.

    Two cases, and neither is a dirty record: the compendium has a typo, or a
    printed sheet names a school differently from the roll (the Children of the
    Five Winds folios call the Dragonfly school 'Grace of the Spirits' and put
    the clan in front of the Worldly Rōnin Path). The source file keeps the
    printed spelling -- a transcription is not ours to reword -- and only the
    match bends."""
    src = json.load(open(os.path.join(ROOT, "src", "foundry_sources.json")))
    out = {}
    for name, spec in (src.get("school_aliases") or {}).items():
        if name.startswith("_"):
            continue
        out[norm(name)] = norm(spec["roll_name"] if isinstance(spec, dict) else spec)
    return out


# The compendium's roll name for a school ends in a word the DSL corpus drops:
# the corpus calls it "Bayushi Manipulator" and the roll "Bayushi Manipulator
# School", "Wandering Blade" against "The Wandering Blade". A record written
# from the corpus -- every published pregen is -- carries the short form, and
# a school that does not resolve costs a name on the coverage roll.
SCHOOL_SUFFIXES = ("school", "tradition", "order", "path", "conspiracy",
                   "training")


def school_norm_index(cx):
    """norm(any spelling of a school) -> norm(the compendium's roll name).

    Built from the catalog itself rather than a hand-kept list, so a book added
    tomorrow needs no entry. Only the compendium's own suffixes and a leading
    "The" are stripped: nothing else is guessed at, and a short form that two
    roll names would both answer to is left out rather than picked between.
    """
    index, ambiguous = {}, set()
    for (name, n) in cx.execute(
            "SELECT name, norm FROM catalog WHERE pack LIKE '%school-curriculum%'"):
        index[n] = n
        forms = set()
        bare = re.sub(r"^the\s+", "", name, flags=re.I)
        forms.add(bare)
        for suf in SCHOOL_SUFFIXES:
            forms.add(re.sub(rf"\s+{suf}$", "", bare, flags=re.I))
        for form in forms:
            k = norm(form)
            if not k or k == n:
                continue
            if k in index and index[k] != n:
                ambiguous.add(k)
            index[k] = n
    for k in ambiguous:
        index.pop(k, None)
    return index


def load_characters(cx):
    ALIASES = school_aliases()
    SCHOOL_INDEX = school_norm_index(cx)
    unresolved = []
    tid = 0
    for path in sorted(glob.glob(os.path.join(SRC, "*.json"))):
        c = json.load(open(path))
        tiers = c["tiers"]
        snorm = norm(c["identity"].get("school"))
        snorm = ALIASES.get(snorm, snorm)
        # then the corpus's short spelling, if that is what the record used
        snorm = SCHOOL_INDEX.get(snorm, snorm)
        cx.execute("INSERT INTO character VALUES (" + ",".join("?" * 22) + ")", (
            c["slug"], c["name"], c["identity"].get("clan"), c["identity"].get("family"),
            c["identity"].get("region"), c["identity"].get("upbringing"),
            c["identity"].get("origin_type"),
            c["identity"].get("school"), snorm,
            c["identity"].get("role"), c.get("bucket"), c.get("campaign"),
            c.get("status"), c.get("accent"), c.get("portrait"),
            c.get("concept"), c.get("summary"),
            len(tiers), min(t["xp"] for t in tiers), max(t["xp"] for t in tiers),
            # absent means ours: the archive is what this repo was for, and the
            # published pregens arrived later
            c.get("provenance") or "archive", (c.get("published") or {}).get("product")))
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


def legacies():
    """Every Legacy on disk, by the predecessor who left it.

    A Legacy is a record of its own (src/legacies/), so it survives its
    predecessor being edited or re-extracted and one character can leave more
    than one. The character's own source carries only the slugs; this is what
    turns those into something a page can show.
    """
    out, byslug = {}, {}
    for p in sorted(glob.glob(os.path.join(ROOT, "src", "legacies", "*.json"))):
        d = json.load(open(p))
        byslug[d["legacy"]] = d
        out.setdefault(d.get("predecessor"), []).append(d)
    return out, byslug


def top_tier(c):
    """The character as they stand: the highest-XP tier, with the lists reduced
    to the names an advancement ledger works in."""
    t = max(c["tiers"], key=lambda x: x["xp"])
    out = {k: t.get(k) for k in ("xp", "label", "rank", "school", "rings",
                                 "skills", "social", "derived", "money")}
    for k in ("techniques", "peculiarities", "signature_scrolls", "gear"):
        out[k] = [e["name"] for e in t.get(k) or []]
    # Titles and bonds keep their progress, not just their names. A title
    # carries xp_used against xp_cost — Emerald Magistrate reads 30/30 — and
    # that is how the ledger knows which title is still incomplete and how far
    # along it is. Reduced to names, an advance could not tell.
    for k in ("titles", "bonds"):
        out[k] = [{f: e.get(f) for f in
                   ("name", "xp_used", "xp_cost", "bought_at_rank", "text",
                    "custom")
                   if e.get(f) is not None}
                  for e in t.get(k) or []]
    return out


def archive_drafts(docs):
    """Enough of every character for the Creator to pick it up.

    Drafts exist in two places — Foundry's Draft folder, and the Creator's own
    browser storage — and a draft that only shows in one of them is a draft the
    author cannot find. This is the archive half, so the Creator can list both.

    Promoted characters are here too, because a character does not stop needing
    changes when it is promoted: a question answered thinly, a name settled
    later, a heritage grant nobody had picked. `status` is what tells the two
    apart, and `tier_count` is what tells the Creator how much of a promoted
    one it may touch — a character Foundry holds at several XP tiers has
    numbers this wizard did not derive and cannot re-derive, so only its prose
    is editable (see scripts/apply_edit.py).

    Concept material rides along from the manifest rather than from the
    character source: it is authoring context, never part of the record, so it
    must not survive promotion. See `concepts` in src/foundry_sources.json.
    """
    concepts = (json.load(open(os.path.join(ROOT, "src", "foundry_sources.json")))
                .get("concepts") or {})
    # `wizard` is a source-file key and not part of what the build derives, so
    # it is read from the source rather than from the emitted doc.
    wizards = {}
    for p in sorted(glob.glob(os.path.join(SRC, "*.json"))):
        d = json.load(open(p))
        if d.get("wizard"):
            wizards[d["slug"]] = d["wizard"]
    out = []
    for c in docs:
        t = c["tiers"][0]
        out.append({
            "slug": c["slug"], "name": c["name"], "campaign": c.get("campaign"),
            "portrait": c.get("portrait"),
            "status": c.get("status"),
            "tier_count": c.get("tier_count") or len(c["tiers"]),
            "identity": {"clan": c.get("clan"), "family": c.get("family"),
                         "region": c.get("region"),
                         "upbringing": c.get("upbringing"),
                         "origin_type": c.get("origin_type"),
                         "school": c.get("school"), "role": c.get("role")},
            "rings": t.get("rings"),
            "social": {k: (t.get("social") or {}).get(k)
                       for k in ("honor", "glory", "status", "giri", "ninjo",
                                 "bushido_tenets")},
            "peculiarities": [e["name"] for e in t.get("peculiarities", [])],
            "notes": c.get("notes") or "",
            # The wizard's own state, where the record has it. This is what
            # makes an edit exact rather than a re-derivation that quietly
            # loses the choices behind the numbers.
            "wizard": wizards.get(c["slug"]),
            # An advance starts from where the character actually is, which is
            # the highest tier on the record and not tier 0. Carried whole,
            # because the ledger adds to all of it: rings and skills, the
            # techniques and advantages held, the titles and bonds in progress.
            "top": top_tier(c),
            # ...and the numbers themselves, so the Creator can check its
            # reconstruction against them before an edit is allowed to write
            # any of them. See mechanicsAgree() in assets/creator.js.
            "skills": t.get("skills"),
            "derived": t.get("derived"),
            "money": t.get("money"),
            "techniques": [e["name"] for e in t.get("techniques", [])],
            "gear": [e["name"] for e in t.get("gear", [])],
            "twenty_questions": c.get("twenty_questions", {}),
            # Concept material is for making a character, and it is GM-facing:
            # unpicked hooks, open questions, plot the player should not read.
            # promote.py cuts it down before any of it becomes a bio, so a
            # promoted character must not carry the raw thing into a file this
            # site serves to anyone. Drafts keep theirs; the record is the bio.
            "concept": (concepts.get(c["slug"]) or ""
                        if c.get("status") == "draft" else ""),
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


LEGACY_BY_PREDECESSOR, LEGACY_BY_SLUG = {}, {}


def emit(cx):
    global LEGACY_BY_PREDECESSOR, LEGACY_BY_SLUG
    LEGACY_BY_PREDECESSOR, LEGACY_BY_SLUG = legacies()
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
        # sorted, not set order: PYTHONHASHSEED is random per process, so
        # iterating `held` directly reordered these keys on every run and every
        # rebuild showed a diff on a file whose content had not changed
        for tn in sorted(held):
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
               # concept material, landed on promotion by scripts/promote.py
               "bio": src.get("bio", ""),
               # for a published pregen: which product it is from, and the
               # sheet's own extra lines that our records have no field for
               "published": src.get("published"),
               "demeanor": src.get("demeanor"),
               "relationships": src.get("relationships"),
               "curriculum": curricula.get(c["school_norm"], []),
               "title_curricula": title_curricula,
               # what this character left behind, if anything
               "legacies": LEGACY_BY_PREDECESSOR.get(c["slug"], []),
               "tiers": tiers}
        docs.append(doc)
        size = write(os.path.join(chardir, c["slug"] + ".js"), "L5R_CHARACTER", doc)
        biggest = max(biggest, size)
        if c["status"] != "draft":
            roster.append({k: c[k] for k in
                           ("slug", "name", "clan", "family",
                            # a ronin's answers to questions 1 and 2
                            "region", "upbringing", "origin_type",
                            "school", "role", "bucket",
                            "campaign", "status", "portrait", "tier_count",
                            "xp_min", "xp_max",
                            # "archive" or "published": the roster hides the
                            # published pregens unless asked, and names the
                            # product they came from when it shows them
                            "provenance", "product")})

    # the roster is the finished archive; drafts live in the Creator until promoted
    n1 = write(os.path.join(SITEDATA, "roster.js"), "L5R_ROSTER", roster)

    # every campaign the archive knows of, tagged or not
    write(os.path.join(SITEDATA, "campaigns.js"), "L5R_CAMPAIGNS", campaigns(cx))

    # the denominator, metadata only (no long rules text) — ledger + landing tiles
    cat = [dict(r) for r in cx.execute(
        "SELECT uuid,pack,pack_label,doc_type,sub_type,name,kind,ring,rank,"
        "source_book,source_page,clan,xp_cost,data FROM catalog"
        " ORDER BY sub_type,name")]
    # rarity lives inside the system blob; the Creator filters equipment on it,
    # and it is one small integer rather than a reason to ship the whole blob
    for e in cat:
        d = json.loads(e.pop("data") or "{}")
        r = d.get("rarity")
        e["rarity"] = int(r) if str(r).strip().lstrip("-").isdigit() else None
        # category too: it is what separates a katana from a creature's Bite,
        # and the Creator's starting-item list should not offer the second
        if d.get("category"):
            e["category"] = d["category"]
    n2 = write(os.path.join(SITEDATA, "catalog.js"), "L5R_CATALOG", cat)

    used = collections.defaultdict(list)
    for r in cx.execute(
        "SELECT c.uuid uuid, tc.slug slug, MIN(t.xp) xp,"
        " (SELECT ch.status FROM character ch WHERE ch.slug = tc.slug) status"
        " FROM tier_content tc"
        " JOIN catalog c ON c.uuid = tc.catalog_uuid"
        " JOIN tier t ON t.id = tc.tier_id"
        # a technique carried only by a published pregen is not one the archive
        # has covered -- somebody else wrote that character
        " WHERE EXISTS (SELECT 1 FROM character ch WHERE ch.slug = tc.slug"
        f"               AND ch.{ARCHIVE_ONLY})"
        " GROUP BY c.uuid, tc.slug"):
        used[r["uuid"]].append({"slug": r["slug"], "xp": r["xp"],
                                "draft": r["status"] == "draft"})
    customs = [dict(r) for r in cx.execute(
        "SELECT slug,category,name,MIN(meta) meta FROM tier_content"
        " WHERE custom=1"
        " AND EXISTS (SELECT 1 FROM character ch WHERE ch.slug = tier_content.slug"
        f"            AND ch.{ARCHIVE_ONLY})"
        " GROUP BY slug,category,name")]
    schools = [dict(r) for r in cx.execute(
        "SELECT c.uuid uuid, c.name name, c.clan clan, c.source_book source_book,"
        " c.source_page source_page,"
        " (SELECT ch.slug FROM character ch WHERE ch.school_norm = c.norm"
        f"  AND ch.{ARCHIVE_ONLY} LIMIT 1) slug,"
        " (SELECT ch.status FROM character ch WHERE ch.school_norm = c.norm"
        f"  AND ch.{ARCHIVE_ONLY} LIMIT 1) status"
        " FROM catalog c WHERE c.pack LIKE '%school-curriculum%' ORDER BY c.name")]
    n3 = write(os.path.join(SITEDATA, "coverage.js"), "L5R_COVERAGE",
               {"used": used, "customs": customs, "schools": schools})
    write(os.path.join(SITEDATA, "twenty_questions.js"), "L5R_20Q",
          twenty_question_labels())
    write(os.path.join(SITEDATA, "heritage_coverage.js"), "L5R_HERITAGE_COVERAGE",
          heritage_coverage())
    write(os.path.join(SITEDATA, "legacies.js"), "L5R_LEGACY_RECORDS",
          sorted(LEGACY_BY_SLUG.values(), key=lambda x: x["name"]))
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
    # largest denomination first, whatever order the character file stores them
    # in -- "1 koku, 2 bu", never "2 bu, 1 koku"
    money_str = ", ".join(f"{money[k]} {k}" for k in ("koku", "bu", "zeni")
                          if money.get(k)) or None

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
  <a href="../lore/index.html">Lore</a>
  <a href="../creator/index.html">Creator</a>
  <a href="../admin/index.html">Coverage</a>
  <a href="../audit/index.html">Audit</a>
</nav>

<div class="wrap">
  <div class="sheet-head">
    <div class="portrait" id="portrait-target"></div>
    <div class="ident">
      <h1 id="char-name"></h1>
      <p class="school-line" id="school-line"></p>
      <div class="tagrow" id="char-chips"></div>
      <div class="char-actions" id="char-actions"></div>
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
<script src="../assets/symbols.js"></script>
<script src="../assets/sheet.js"></script>
</body>
</html>
"""


def emit_pages(cx):
    """One thin stub per character; all the rendering lives in assets/sheet.js."""
    out = os.path.join(ROOT, "characters")
    os.makedirs(out, exist_ok=True)
    # drop stubs for characters whose source is gone, or coverage.py will
    # (rightly) fail on a page with no character behind it. The hand-written
    # pages that live in this directory are not stubs and must survive; the
    # sweep silently deleted the relationship map the first time it ran.
    KEEP = {"index.html", "map.html"}
    for stale in glob.glob(os.path.join(out, "*.html")):
        if os.path.basename(stale) not in KEEP:
            os.remove(stale)
    cx.row_factory = sqlite3.Row
    n = 0
    for c in cx.execute("SELECT * FROM character ORDER BY slug"):
        with open(os.path.join(out, c["slug"] + ".html"), "w") as f:
            f.write(PAGE_STUB.format(name=c["name"], slug=c["slug"],
                                     school=c["school"] or "", tiers=c["tier_count"]))
        n += 1
    return n


# What "a published pregen does not count towards coverage" means in SQL.
# Spelled once and reused, because coverage is counted from four different
# angles -- how many characters there are, which schools have one, which
# catalog entries are carried, and which schools the generator still owes a
# character -- and a rule applied in three of the four is not a rule.
ARCHIVE_ONLY = "provenance = 'archive'"


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
    npub = cx.execute("SELECT COUNT(*) FROM character"
                      " WHERE provenance = 'published'").fetchone()[0]
    print(f"characters: {cx.execute('SELECT COUNT(*) FROM character').fetchone()[0]}"
          + (f" ({npub} published pregens, outside coverage)" if npub else "")
          + f", tiers {cx.execute('SELECT COUNT(*) FROM tier').fetchone()[0]}"
          + f", content refs {cx.execute('SELECT COUNT(*) FROM tier_content').fetchone()[0]}")
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
