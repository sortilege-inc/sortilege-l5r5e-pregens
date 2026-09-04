#!/usr/bin/env python3
"""Build a mechanically complete 0 XP pregen for a school, from the DSL corpus.

The archive wants one playable character per school — 110 of them — and the
mechanical half of that is not a writing job. It is exactly the Game of Twenty
Questions' bookkeeping, and every input is already stated in the corpus:

    school     ring increase, starting skills (choose N), starting honor,
               starting techniques, starting outfit, school ability
    clan       ring bonus, skill bonus, starting status
    family     ring increase, skill increases, glory, starting coin

A Path of Waves or Writ of the Wilds school answers the first two differently,
and the generator follows:

    region       ring increase, skill increase, glory        (question 1)
    upbringing   ring and skill increases, starting coin, and a
                 status modification applied to the base the
                 character's type sets                       (question 2)
    type         ronin 24, peasant 15, gaijin 0 -- the corpus states these as
                 its own rules labels, and a reduction floors at 0

and question 18 grants a skill rather than a heritage, because the heritage
table is not part of that set.

So this answers the mechanical questions from the corpus and leaves the
narrative ones empty. It writes `src/characters/<slug>.json` with
status "draft", so a generated character shows up in the Creator and never in
the roster until someone promotes it deliberately.

Where a question offers a free choice — five skills from seven, one weapon of
rarity 6 or lower, which distinction — it takes the option the archive has
covered least. The point of the set is coverage, so the choices are made to
widen it rather than at random.

    python3 scripts/generate_pregen.py --list
    python3 scripts/generate_pregen.py "Akodo Commander School"
    python3 scripts/generate_pregen.py --all --write

Nothing here authors rules text: every name it emits must resolve against the
compendium catalog or scripts/build.py fails the build, which is the check that
this produced a real character rather than a plausible-looking one.
"""
import argparse, collections, hashlib, json, os, re, sys, sqlite3, unicodedata

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dsl_rules_text import (CACHE, DB, ROOT, compose, norm, variants, walk)

SRC = os.path.join(ROOT, "src", "characters")

# The books whose schools answer questions 1 and 2 with a region and an
# upbringing. The catalog's own source_book is what says which.
NONCORE_BOOKS = {"path of waves", "writ of the wild", "writ of the wilds"}

# Path of Waves p.46, and the corpus's own rules labels
# (pow_ronin_base_status_24, pow_peasant_base_status_15,
# pow_gaijin_base_status_0). A generated character defaults to ronin, which is
# what the mode is called -- and says so in needs_attention, because for a
# nezumi or tengu tradition the book states no type at all.
ORIGIN_BASE_STATUS = {"ronin": 24, "peasant": 15, "gaijin": 0}
DEFAULT_ORIGIN_TYPE = "ronin"
CHARGEN = os.path.join(ROOT, "data", "chargen")

RINGS = ["air", "earth", "fire", "water", "void"]
SKILL_GROUPS = {
    "artisan": ["aesthetics", "composition", "design", "smithing"],
    "martial": ["fitness", "melee", "ranged", "unarmed", "meditation", "tactics"],
    "scholar": ["culture", "government", "medicine", "sentiment", "theology"],
    "social": ["command", "courtesy", "games", "performance"],
    "trade": ["commerce", "labor", "seafaring", "skulduggery", "survival"],
}
SKILL_LABEL = {
    "aesthetics": "Aesthetics", "composition": "Composition", "design": "Design",
    "smithing": "Smithing", "fitness": "Fitness", "melee": "Martial Arts [Melee]",
    "ranged": "Martial Arts [Ranged]", "unarmed": "Martial Arts [Unarmed]",
    "meditation": "Meditation", "tactics": "Tactics", "culture": "Culture",
    "government": "Government", "medicine": "Medicine", "sentiment": "Sentiment",
    "theology": "Theology", "command": "Command", "courtesy": "Courtesy",
    "games": "Games", "performance": "Performance", "commerce": "Commerce",
    "labor": "Labor", "seafaring": "Seafaring", "skulduggery": "Skulduggery",
    "survival": "Survival",
}
SKILL_KEY = {v.lower(): k for k, v in SKILL_LABEL.items()}
SKILL_KEY.update({"martial arts [melee]": "melee", "martial arts [ranged]": "ranged",
                  "martial arts [unarmed]": "unarmed"})


# Rokugani coin, added one denomination at a time and never carried into the
# next. The corpus states the exchange rate -- a koku is five bu is fifty zeni
# (core-systems.ttrpg, the currency-of-rokugan entry) -- but a koku total
# cannot hold Peasant Family's 10 zeni without calling it 0.2 of a coin, and
# normalizing the other way restates the book: the entry says ten copper
# coins, so the sheet says ten copper coins.
COINS = ("koku", "bu", "zeni")


def coins_of(entity_coins):
    """A starting allotment in the shape the character format keeps."""
    src = entity_coins or {}
    return {k: int(src.get(k) or 0) for k in COINS}


def coin_label(coins):
    return ", ".join(f"{coins[k]} {k}" for k in COINS
                     if (coins or {}).get(k)) or "nothing"


def load_js(name, var):
    """One of the data/chargen/*.js payloads, as Python."""
    path = os.path.join(CHARGEN, name)
    text = open(path, encoding="utf-8").read()
    body = text[text.index("=") + 1:].rstrip().rstrip(";\n").rstrip(";")
    return json.loads(body)


def skill_key(label):
    k = SKILL_KEY.get((label or "").strip().lower())
    if k:
        return k
    m = re.match(r"^Martial Arts \[(\w+)\]", label or "")
    return m.group(1).lower() if m else None


def prop(entity, name):
    for p in (entity.get("properties") or []):
        if p.get("name") == name:
            return p
    return None


def prop_value(entity, name):
    p = prop(entity, name)
    if not p:
        return None
    if p.get("value") is not None:
        return p["value"]
    for m in (p.get("modifiers") or []):
        if m.get("kind") == "DEFAULT" and m.get("value") is not None:
            return m["value"]
    return None


def blocks_of(entity, keyword):
    return [b for b in (entity.get("blocks") or []) if b.get("keyword") == keyword]


def school_index(corpus):
    return {norm(o["name"]): o for o in walk(corpus)
            if isinstance(o, dict) and o.get("extends") == "School" and o.get("name")}


def corpus_aliases():
    src = json.load(open(os.path.join(ROOT, "src", "foundry_sources.json")))
    return {k: v for k, v in (src.get("school_corpus_aliases") or {}).items()
            if not k.startswith("_")}


def find_school(name, idx, aliases=None):
    for cand in ([(aliases or {}).get(name)] if aliases else []) + [name]:
        if not cand:
            continue
        for v in variants(cand):
            if norm(v) in idx:
                return idx[norm(v)]
    return None


# ---------------------------------------------------------------- coverage

def usage_counts():
    """How often each catalog entry is already carried by a character.

    The set exists to cover the compendium, so every free choice below is
    resolved toward whatever is covered least. Ties break on name, so the
    generator is deterministic: same archive in, same character out.
    """
    if not os.path.exists(DB):
        return {}
    cx = sqlite3.connect(DB)
    return {r[0]: r[1] for r in cx.execute(
        "SELECT norm, COUNT(DISTINCT slug) FROM tier_content GROUP BY norm")}


def least_used(names, counts, n=1, seed=""):
    """The least-covered options, ties broken by a stable hash rather than by name.

    Sorting ties alphabetically made every generated character open with the top
    of the list — Accustomed to Luxury, Affinity with, Allergy, Ally, Ancestry.
    Hashing on (seed, name) keeps the generator reproducible while making the
    set look chosen rather than enumerated.
    """
    def key(x):
        h = hashlib.sha256((seed + "\x00" + x).encode("utf-8")).hexdigest()
        return (counts.get(norm(x), 0), h)
    return sorted(names, key=key)[:n]


OPEN_ENDED = re.compile(r"\[[^\]]+\]")


def prefer_concrete(names):
    """Entries that name their own subject first.

    "Ally [Name]" and "Affinity with [Animal Type]" are legitimate picks but
    each needs a person to say who or what, so a generator should reach for them
    only once the self-contained entries are used up.
    """
    concrete = [n for n in names if not OPEN_ENDED.search(n)]
    return concrete or names


# ---------------------------------------------------------------- outfit

# A starting outfit is written for a reader, not a parser: "daishō (katana and
# wakizashi)" is two items, "two knives" is a quantity, and "any one weapon of
# rarity 6 or lower" is a choice the player makes. Everything that is a plain
# name resolves by name; these are the ones that do not.
OUTFIT_SPLIT = {
    "daishō (katana and wakizashi)": [("Katana", 1), ("Wakizashi", 1)],
    "daishō (katana or scimitar, wakizashi)": [("Katana", 1), ("Wakizashi", 1)],
    "daishō (katana and wakizashi) or two knives": [("Katana", 1), ("Wakizashi", 1)],
    "two knives": [("Knife", 2)],
    "three knives": [("Knife", 3)],
    "quiver of arrows": [("Quiver of Arrow", 1)],
    "traveling pack": [("Traveling pack", 1)],
    "scroll satchel": [("Scroll satchel", 1)],
}
# "One weapon of rarity 6 or lower" means one a samurai carries. These
# categories are in the same pack but are not kit: a creature's natural attack,
# a castle-breaking engine, a chair swung in a brawl.
NOT_KIT = {"Unarmed profiles", "Siege Weapons", "Improvised Weapons"}

# A free choice, resolved to whatever the archive covers least within the bound.
OUTFIT_CHOICE = re.compile(
    r"^(?:any\s+)?one\s+(?P<what>weapon|item|trinket|armor)\b"
    r"(?:.*?rarity\s+(?P<rarity>\d+))?", re.I)
PARENTHETICAL = re.compile(r"\s*\([^)]*\)\s*$")


# Outfit phrasing the compendium spells differently. Explicit, because guessing
# at gear is how a character ends up carrying something the rules never gave it.
OUTFIT_ALIAS = {
    "journal": "Journal of observations",
    "journal of insights": "Journal of observations",
    "personal chop": "Personal Seal or Chop",
    "personal seal": "Personal Seal or Chop",
    "smithing hammer": "Smithing Hammer",
    "shinjo horsebow": "Horsebow",
    "carving knife": "Knife",
    "bundle of medicinal herbs": "Herbal Medicines",
    "medicinal herbs": "Herbal Medicines",
    "gambling set": "Dice and Cup",
    "divination set": "Divination Kit",
    "set of glass vials": "Glass Vial",
    "daisho": "Katana",
    "ceremonial robes": "Ceremonial Clothes",
    "peasant clothes": "Common Clothes",
    "calligraphy kit": "Calligraphy Set",
    "one musical instrument": "Musical Instrument",
    "any one musical instrument": "Musical Instrument",
    "one vial of poison": "Poison (One Vial)",
    "vial of poison": "Poison (One Vial)",
    "50 feet of rope": "Rope (By the Foot)",
    "rope": "Rope (By the Foot)",
    "quiver of bolts": "Quiver of Arrow",
    "satchel of medicinal supplies": "Medicine Kit",
    "small satchel of ingredients worth 10 bu": "Medicine Kit",
    "pouch of incense": "Omamori",
    "drafting paper": "Calligraphy Set",
    "satchel of messages": "Scroll satchel",
}

NUMBER = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5}
ARTICLE = re.compile(r"^(?:a|an|the)\s+", re.I)
QUANTITY = re.compile(r"^(?P<n>one|two|three|four|five|\d+)\s+(?P<rest>.+)$", re.I)
PLURAL = re.compile(r"s$")


def resolve_one(line, catalog, counts, seed):
    """One outfit phrase to (name, quantity), or None.

    Outfit lines are written for a reader: articles, plurals, quantities in
    words, "X or Y" choices, and "X with Y" bundles. Peel those off before
    asking the catalog, and take the first branch of a choice — it is a choice,
    so any branch is correct and a person can change it.
    """
    line = line.strip().strip('"').strip().rstrip(".")
    if not line:
        return None
    qty = 1
    m = QUANTITY.match(line)
    if m:
        raw = m.group("n").lower()
        qty = NUMBER.get(raw, int(raw) if raw.isdigit() else 1)
        line = m.group("rest")
    line = ARTICLE.sub("", line)

    for branch in re.split(r"\s+or\s+", line):
        branch = ARTICLE.sub("", branch.strip())
        stem = PARENTHETICAL.sub("", branch)
        alias = OUTFIT_ALIAS.get(norm_words(stem)) or OUTFIT_ALIAS.get(norm_words(branch))
        for cand in ([alias] if alias else []) + [
                branch, stem,
                re.split(r"\s+with\s+", branch)[0],
                PLURAL.sub("", stem)]:
            hit = cand and catalog_by_name(catalog).get(norm(cand))
            if hit:
                return hit, qty
    return None


def norm_words(s):
    """Lowercased, accent-stripped words — the key OUTFIT_ALIAS is written in."""
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]+", "", s.lower())).strip()


def outfit_items(lines, catalog, counts, seed=""):
    """Each outfit line to (catalog name, quantity) pairs."""
    out, unresolved = [], []
    for raw in lines:
        line = raw.strip().strip('"').strip()
        key = line.lower()
        if key in OUTFIT_SPLIT:
            out += OUTFIT_SPLIT[key]
            continue
        m = OUTFIT_CHOICE.match(line)
        if m:
            rarity = int(m.group("rarity")) if m.group("rarity") else 9
            kinds = ({"weapon": ("weapon",), "armor": ("armor",),
                      "item": ("item",), "trinket": ("item",)}[m.group("what").lower()])
            pool = [e["name"] for e in catalog
                    if e["sub_type"] in kinds
                    and (e["rarity"] or 0) <= rarity
                    and e.get("category") not in NOT_KIT]
            if pool:
                out.append((least_used(pool, counts, seed=seed)[0], 1))
            continue
        hit = resolve_one(line, catalog, counts, seed)
        if hit:
            out.append(hit)
            continue
        # a single line can name two things — "yumi (bow) and quiver of arrows"
        parts = [p for p in re.split(r"\s+and\s+", line) if p.strip()]
        got = [resolve_one(p, catalog, counts, seed) for p in parts] if len(parts) > 1 else []
        if got and all(got):
            out += got
        else:
            unresolved.append(line)
    # a line can name something twice ("daishō" then "wakizashi"); keep one
    merged = {}
    for name, qty in out:
        merged[name] = max(merged.get(name, 0), qty)
    return list(merged.items()), unresolved


def catalog_name(name, catalog):
    """A corpus name in the compendium's spelling, or None if it has none."""
    return catalog_by_name(catalog).get(norm(name))


_CAT_BY_NAME = None


def catalog_by_name(catalog):
    global _CAT_BY_NAME
    if _CAT_BY_NAME is None:
        _CAT_BY_NAME = {}
        for e in catalog:
            _CAT_BY_NAME.setdefault(norm(e["name"]), e["name"])
            for v in variants(e["name"]):
                _CAT_BY_NAME.setdefault(norm(v), e["name"])
    return _CAT_BY_NAME


# ---------------------------------------------------------------- assembly

def choose_list(p):
    """A CHOOSE block's options and how many are taken."""
    for n in (p.get("nested") or []):
        c = n.get("choose")
        if c:
            return c.get("options") or [], int(c.get("n") or 0)
    return [], 0


def fixed_map(p):
    """A DEF-typed property whose children are name -> integer."""
    return {n["name"]: int(n.get("value") or 0)
            for n in (p.get("nested") or []) if n.get("name") and n.get("value")}


def starting_techniques(school):
    """Every technique a rank-1 character of this school begins with."""
    out = []
    for grp in blocks_of(school, "STARTING_TECHNIQUES"):
        for b in (grp.get("blocks") or []):
            kind = (b.get("keyword") or "").lower()
            if b.get("list"):
                opts = [x.strip('^"') for x in b["list"]]
                out.append({"kind": kind, "options": opts,
                            "n": int((b.get("choose") or {}).get("n") or 1)})
            elif b.get("label"):
                out.append({"kind": kind, "options": [b["label"].strip('^"')], "n": 1})
    return out


# A starting technique is usually a name, but a few schools write an instruction
# instead: "Any one rank 1 invocation of your inspired element". That is a
# choice, so make it — from the catalog, at the stated rank and kind.
CHOICE_TECH = re.compile(r"\bany one\b|\bchoose\b|\bone of\b", re.I)
RANK_IN = re.compile(r"\brank (\d)\b", re.I)


def resolve_choice(option, kind, catalog, counts, seed):
    if not CHOICE_TECH.search(option):
        return option
    m = RANK_IN.search(option)
    rank = int(m.group(1)) if m else 1
    pool = [e["name"] for e in catalog
            if e["sub_type"] == "technique"
            and (e["kind"] or "").lower() == kind.lower()
            and (json.loads(e["data"]) or {}).get("rank") == rank]
    return least_used(pool, counts, seed=seed)[0] if pool else None


def school_ability(school):
    for b in blocks_of(school, "SCHOOL_ABILITY"):
        if b.get("label"):
            return b["label"].strip().strip('^').strip('"')
    return None


BUSHIDO = ["Compassion", "Courage", "Courtesy", "Duty and Loyalty",
           "Honor", "Righteousness", "Sincerity"]


def least_used_entry(pool, counts, seed):
    def key(e):
        h = hashlib.sha256((seed + "\x00" + e["name"]).encode("utf-8")).hexdigest()
        return (counts.get(norm(e["name"]), 0), h)
    return sorted(pool, key=key)[0]


def pick_heritage(heritages, counts, seed=""):
    """The heritage entry the archive has covered least, across every table."""
    pool = []
    for key, table in (heritages or {}).items():
        if table.get("form") == "unencoded":
            continue
        for e in table.get("entries") or []:
            pool.append(dict(e, _table=key))
    if not pool:
        return None
    return least_used_entry(pool, counts, seed)


def build_character(school_name, school, clans, families, catalog, counts,
                    peculiarities, given_names, heritages, regions=None,
                    upbringings=None, book=None):
    clan_name = prop_value(school, "Clan")
    roles = json.loads(prop_value(school, "Roles") or "[]")
    # A school from Path of Waves or Writ of the Wilds replaces the clan and the
    # family with a region and an upbringing. Decided by the book rather than by
    # the absence of a clan: a monk order has no clan either and is still core.
    noncore = (book or "").strip().lower() in NONCORE_BOOKS
    clan = next((c for c in clans
                 if clan_name and norm(c.get("clan_short_name") or c["name"]) == norm(clan_name)),
                None)
    fams = [f for f in families if clan_name and norm(f.get("clan") or "") == norm(clan_name)]

    rings = {r: 1 for r in RINGS}
    skills = {g: {s: 0 for s in ss} for g, ss in SKILL_GROUPS.items()}
    # where an increase had to be redirected to stay inside the creation cap
    ring_notes = []

    def bump_skill(label, by=1, why=""):
        return bump_skill_capped(label, by, why)

    def _apply_grant(obj, bump):
        """A region's or an upbringing's grant, which may be flat, a choice, or
        both at once -- Hunter or Fisher gives "+1 Labor, +1 Seafaring or +1
        Survival". The choice takes its first option, which is what a generated
        character does everywhere else it has a free pick."""
        if not obj:
            return
        ch = obj.get("_choose") if isinstance(obj, dict) else None
        if ch:
            opts = ch.get("options") or []
            by = int(ch.get("yield_value") or 1)
            for o in opts[:int(ch.get("n") or 1)]:
                bump(o, by)
        if isinstance(obj, dict):
            for k, v in obj.items():
                if k == "_choose":
                    continue
                bump(k, int(v))

    # "During character creation, no ring may exceed 3 and no skill may exceed
    # 3" (core-chargen.ttrpg; Path of Waves states it again). The book's remedy
    # is not to clamp: "if a choice would result in a ring rising above rank 3
    # during character creation, then the player must choose a different ring
    # to increase instead, as long as that ring would not be increased above
    # 3." Every increase here is the generator's own pick, so it redirects —
    # and says where, because a redirected increase is not what the school
    # printed.
    CREATION_CAP = 3

    def bump_ring(name, by=1, why=""):
        k = (name or "").strip().lower()
        if k not in rings:
            return False
        for _ in range(by):
            if rings[k] < CREATION_CAP:
                rings[k] += 1
                continue
            spare = [r for r in RINGS if rings[r] < CREATION_CAP]
            if not spare:
                ring_notes.append(
                    f"+1 {k.capitalize()} could not be taken: every ring is at "
                    f"{CREATION_CAP}, the creation cap" +
                    (f" ({why})" if why else ""))
                continue
            alt = sorted(spare, key=lambda r: (rings[r], RINGS.index(r)))[0]
            rings[alt] += 1
            ring_notes.append(
                f"+1 {k.capitalize()} would have passed the creation cap of "
                f"{CREATION_CAP}, so it went to {alt.capitalize()} instead" +
                (f" ({why})" if why else ""))
        return True

    def bump_skill_capped(label, by=1, why=""):
        """The same rule for skills: a different skill not already at 3."""
        k = skill_key(label)
        if not k:
            return False
        for g, ss in skills.items():
            if k not in ss:
                continue
            for _ in range(by):
                if ss[k] < CREATION_CAP:
                    ss[k] += 1
                    continue
                spare = [(gg, s) for gg, sss in skills.items()
                         for s in sss if sss[s] < CREATION_CAP]
                if not spare:
                    ring_notes.append(
                        f"+1 {SKILL_LABEL.get(k, k)} could not be taken: every "
                        f"skill is at {CREATION_CAP}")
                    continue
                gg, alt = sorted(spare, key=lambda x: (skills[x[0]][x[1]], x[1]))[0]
                skills[gg][alt] += 1
                ring_notes.append(
                    f"+1 {SKILL_LABEL.get(k, k)} would have passed the creation "
                    f"cap, so it went to {SKILL_LABEL.get(alt, alt)} instead")
            return True
        return False

    attention = []

    if noncore:
        # --- region (Q1) and upbringing (Q2) -------------------------------
        origin_type = DEFAULT_ORIGIN_TYPE
        status = ORIGIN_BASE_STATUS[origin_type]
        glory, family = 40, None
        region = upbringing = None
        purse = coins_of(None)

        pool = [r for r in (regions or [])
                if not r.get("modes") or "pow" in r["modes"] or "wow" in r["modes"]]
        if pool:
            region = sorted(pool, key=lambda r: (counts.get(norm(r["name"]), 0),
                                                 r["name"]))[0]
            counts[norm(region["name"])] = counts.get(norm(region["name"]), 0) + 1
            _apply_grant(region.get("ring_increase"), bump_ring)
            _apply_grant(region.get("skill_increase"), bump_skill)
            if region.get("glory") is not None:
                glory = region["glory"]

        upool = list(upbringings or [])
        if upool:
            upbringing = sorted(upool, key=lambda u: (counts.get(norm(u["name"]), 0),
                                                      u["name"]))[0]
            counts[norm(upbringing["name"])] = \
                counts.get(norm(upbringing["name"]), 0) + 1
            _apply_grant(upbringing.get("ring_increase"), bump_ring)
            _apply_grant(upbringing.get("skill_increases"), bump_skill)
            mod = upbringing.get("status_modification")
            if mod is not None:
                status += int(mod)
                # every negative Status Modification in the chapter is printed
                # "(minimum 0)" -- six of the thirteen
                if int(mod) < 0:
                    status = max(0, status)
            purse = coins_of(upbringing.get("starting_coins"))
            # a day's rations, an heirloom worth 3 koku, a wakizashi: gear
            for it in upbringing.get("starting_items") or []:
                attention.append(
                    f"{upbringing['name']} starts with {it} — record it as gear")
            if upbringing.get("from_clan"):
                attention.append(
                    f"{upbringing['name']} takes its increases from a clan the "
                    f"character names, or falls back to a free choice — the "
                    f"fallback was taken here")

        attention.append(
            f"type is {origin_type} by default, for a base status of "
            f"{ORIGIN_BASE_STATUS[origin_type]} — confirm it, and the region "
            f"and upbringing below, which were chosen for coverage rather than "
            f"for this character")
        if region:
            attention.append(f"region: {region['name']} (question 1)")
        if upbringing:
            attention.append(f"upbringing: {upbringing['name']} (question 2)")

    # --- clan (Q1) ---------------------------------------------------------
    if not noncore:
        status = 30
    if clan and not noncore:
        for r, v in (clan.get("ring_bonus") or {}).items():
            bump_ring(r, v)
        for s, v in (clan.get("skill_bonus") or {}).items():
            bump_skill(s, v)
        status = clan.get("starting_status") or status

    # --- family (Q2) — the least-used family of the clan, for variety ------
    if not noncore:
        glory, family = 40, None
        purse = coins_of(None)
    if fams and not noncore:
        # A school named for a family belongs to it: the Kaito Shrine Keeper is a
        # Kaito, not whichever Phoenix family the archive has covered least.
        # Cross-family training is legal, so this is a default, not a rule.
        eponymous = [f for f in fams if norm(school_name).startswith(norm(f["name"]))]
        pool = eponymous or fams
        family = sorted(pool, key=lambda f: (counts.get(norm(f["name"]), 0), f["name"]))[0]
        glory = family.get("glory") or glory
        purse = coins_of(family.get("starting_coins"))
        inc = family.get("ring_increase") or {}
        if "_choose" in inc:
            opts = inc["_choose"].get("options") or []
            if opts:
                bump_ring(opts[0], int(inc["_choose"].get("yield_value") or 1))
        else:
            for r, v in inc.items():
                bump_ring(r, v)
        for s, v in (family.get("skill_increases") or {}).items():
            bump_skill(s, v)

    # --- school (Q3) -------------------------------------------------------
    for r, v in fixed_map(prop(school, "Ring Increase") or {}).items():
        bump_ring(r, v)
    opts, n = choose_list(prop(school, "Starting Skills") or {})
    picked_skills = least_used(opts, counts, n, seed=school_name) if opts else []
    for s in picked_skills:
        bump_skill(s)
    honor = int(prop_value(school, "Starting Honor") or 40)

    # The corpus names a technique plainly; the compendium qualifies it by clan
    # ("Lord Akodo's Roar" vs "Lord Akodo's Roar (Lion)"). Everything downstream
    # keys off the compendium spelling, so resolve to it here — the same rule
    # rollName() follows in the Creator.
    techs = []
    for grp in starting_techniques(school):
        options = [resolve_choice(o, grp["kind"], catalog, counts, school_name)
                   for o in grp["options"]]
        options = [o for o in options if o]
        for name in least_used(options, counts, grp["n"], seed=school_name):
            techs.append({"name": catalog_name(name, catalog) or name,
                          "xp_used": 0, "xp_cost": 3,
                          "in_curriculum": True, "bought_at_rank": 0,
                          "kind": grp["kind"], "rank": 1})
    ability = school_ability(school)
    if ability:
        ability = catalog_name(ability, catalog) or ability

    # --- peculiarities (Q9-Q13) — four picks, widening coverage ------------
    picks = []
    for kind in ("distinction", "adversity", "passion", "anxiety"):
        pool = [e["name"] for e in peculiarities
                if e["kind"] == kind and not e["name"].startswith("Shadowlands Taint")]
        if pool:
            picks.append(least_used(prefer_concrete(pool), counts, seed=school_name)[0])
            counts[norm(picks[-1])] = counts.get(norm(picks[-1]), 0) + 1
    pecs = []
    for name in picks:
        e = next(x for x in peculiarities if x["name"] == name)
        pecs.append({"name": name, "xp_used": 0, "xp_cost": e.get("xp_cost") or 3,
                     "in_curriculum": False, "bought_at_rank": 0,
                     "kind": e["kind"], "ring": e.get("ring")})

    # --- Q4 standout quality: +1 to a ring ---------------------------------
    # Narratively this is "what made your character remarkable"; mechanically it
    # is one ring increase, and without it the character sits at 9 ring points
    # where a finished samurai has 10.
    standout = least_used([r.capitalize() for r in RINGS], counts, seed=school_name)[0]
    bump_ring(standout)
    counts[norm(standout)] = counts.get(norm(standout), 0) + 1

    # --- Q8 bushidō: a paramount tenet and a less significant one ----------
    tenets = least_used(BUSHIDO, counts, 2, seed=school_name)
    counts[norm(tenets[0])] = counts.get(norm(tenets[0]), 0) + 1
    counts[norm(tenets[1])] = counts.get(norm(tenets[1]), 0) + 1

    # --- Q13 mentor, path A: one extra advantage ---------------------------
    extra_pool = [e["name"] for e in peculiarities
                  if e["kind"] in ("distinction", "passion") and e["name"] not in picks]
    if extra_pool:
        extra = least_used(prefer_concrete(extra_pool), counts, seed=school_name)[0]
        counts[norm(extra)] = counts.get(norm(extra), 0) + 1
        e = next(x for x in peculiarities if x["name"] == extra)
        pecs.append({"name": extra, "xp_used": 0, "xp_cost": e.get("xp_cost") or 3,
                     "in_curriculum": False, "bought_at_rank": 0,
                     "kind": e["kind"], "ring": e.get("ring"), "via": "mentor"})

    # --- Q17 a parent's opinion: +1 to a skill currently at rank 0 ---------
    zero = [SKILL_LABEL[k] for g in skills.values() for k, v in g.items() if v == 0]
    if zero:
        parent_skill = least_used(zero, counts, seed=school_name)[0]
        bump_skill(parent_skill)
        counts[norm(parent_skill)] = counts.get(norm(parent_skill), 0) + 1
    else:
        parent_skill = None

    # --- Q18 --------------------------------------------------------------
    # The heritage table is core's question 18. Path of Waves and Writ of the
    # Wilds ask "Who raised you?" and grant a skill instead, so rolling a
    # heritage for one of their characters would hand out an ancestor, a
    # modifier and sometimes an item the set does not have.
    heritage = None
    raised_skill = None
    if noncore:
        zero18 = [SKILL_LABEL[k] for g in skills.values()
                  for k, v in g.items() if v == 0]
        if zero18:
            raised_skill = least_used(zero18, counts, seed=school_name + "18")[0]
            bump_skill(raised_skill)
            counts[norm(raised_skill)] = counts.get(norm(raised_skill), 0) + 1
            attention.append(
                f"question 18 is \"who raised you\", which grants a skill "
                f"rather than a heritage: {raised_skill} — say who they were")
    else:
        heritage = pick_heritage(heritages, counts, school_name)
    if heritage:
        counts[norm(heritage["name"])] = counts.get(norm(heritage["name"]), 0) + 1
        for field, delta in (heritage.get("modifiers") or {}).items():
            m = re.match(r"^([+-]?\d+)$", str(delta).strip())
            if not m:
                continue
            v = int(m.group(1))
            if field.lower() == "honor":
                honor += v
            elif field.lower() == "glory":
                glory += v
            elif field.lower() == "status":
                status += v
        # a heritage that grants an item, a peculiarity, or a ring swap needs a
        # person: record it rather than guessing at it
        if heritage.get("effect") or heritage.get("sub_table"):
            attention.append("heritage effect needs resolving: " +
                             (heritage.get("effect") or
                              f"roll {heritage['sub_table']['die']} on its sub-table"))

    # --- gear (starting outfit) -------------------------------------------
    outfit = []
    for b in blocks_of(school, "STARTING_OUTFIT"):
        outfit += [x for x in (b.get("list") or [])]
    gear, unresolved = outfit_items(outfit, catalog, counts, seed=school_name)

    # --- name --------------------------------------------------------------
    # A ronin, a gaijin or a nezumi has no family name to carry, so the
    # personal name stands alone rather than being prefixed with "Ronin".
    fam_name = (family or {}).get("name") or (None if noncore else clan_name)
    # Names must not repeat across the archive — "Akodo Akemi" and "Agasha Akemi"
    # in the same set reads as a generator, not a roster. Walk the pool until an
    # unused personal name comes up, seeded off the school so the order varies.
    used = {norm(g) for g in given_names["used"]}
    pool = least_used(given_names["pool"], {}, len(given_names["pool"]), seed=school_name)
    given = next((g for g in pool if norm(g) not in used), None)
    if given is None:                       # pool exhausted: fall back to a suffix
        given = pool[0] + str(1 + sum(1 for u in given_names["used"] if u.startswith(pool[0])))
    given_names["used"].append(given)
    display = f"{fam_name} {given}" if (family and fam_name) else given

    slug = re.sub(r"[^a-z0-9]+", "-",
                  unicodedata.normalize("NFKD", display.lower())
                  .encode("ascii", "ignore").decode()).strip("-")

    tier = {
        "xp": 0, "label": None, "rank": 1, "school": school_name,
        "foundry_id": None, "foundry_name": None,
        "rings": rings, "skills": skills,
        "social": {"honor": honor, "glory": glory, "status": status,
                   "ninjo": "", "giri": "",
                   "bushido_tenets": {"paramount": tenets[0],
                                      "less_significant": tenets[1]}},
        "derived": {
            "endurance": (rings["earth"] + rings["fire"]) * 2,
            "composure": (rings["earth"] + rings["water"]) * 2,
            "focus": rings["air"] + rings["fire"],
            "vigilance": -(-(rings["air"] + rings["water"]) // 2),
            "void_points": rings["void"],
        },
        "money": purse,
        "techniques": techs,
        "peculiarities": pecs,
        "titles": [], "bonds": [], "signature_scrolls": [],
        "gear": [{"name": n, "quantity": q} for n, q in gear],
        "advancements": [],
        "generated": True,
        "generated_choices": {
            "standout_ring": standout.lower(),
            "parent_skill": parent_skill,
            "heritage": (heritage or {}).get("name"),
            "heritage_table": (heritage or {}).get("_table"),
            "raised_by_skill": raised_skill,
            "mentor_path": "A",
        },
    }
    if ability:
        tier["techniques"].append({
            "name": ability, "xp_used": 0, "xp_cost": 0, "in_curriculum": False,
            "bought_at_rank": 0, "kind": "school ability", "rank": 1})

    doc = {
        "slug": slug, "name": display, "folder_label": display,
        # which question set answered this character, the way the Creator
        # records it on a draft it made
        "mode": "pow" if noncore else "core",
        "campaign": None, "status": "draft", "bucket": "generated",
        "accent": None,
        "identity": {"clan": None if noncore else clan_name,
                     "family": (family or {}).get("name"),
                     "region": (region or {}).get("name") if noncore else None,
                     "upbringing": (upbringing or {}).get("name") if noncore else None,
                     "origin_type": origin_type if noncore else None,
                     "school": school_name, "role": (roles or [None])[0], "age": None},
        "portrait": None, "concept": None, "summary": None,
        "notes": "",
        "twenty_questions": {},
        "tiers": [tier],
    }
    # Never drop an outfit line silently. Anything the compendium has no entry
    # for — a warhorse, an attendant, "a trophy from a slain enemy" — is part of
    # what this school issues, and a person has to decide how to record it.
    for line in unresolved:
        attention.append(f"starting outfit line has no catalog item: {line}")
    # a redirected increase is not what the school printed, so it is named
    attention += ring_notes
    if attention:
        doc["needs_attention"] = attention
    return doc, unresolved


# Rokugani given names, for characters the archive is inventing rather than
# importing. Plain and period-appropriate; the family name carries the clan.
GIVEN = ["Akemi", "Arata", "Ayame", "Chiyo", "Daisuke", "Emiko", "Fumiko", "Genji",
         "Hana", "Haruki", "Hisao", "Ichiro", "Kaede", "Kaito", "Kenshin", "Kiyoshi",
         "Kohaku", "Kumiko", "Mariko", "Masashi", "Michiko", "Nobuo", "Noriko",
         "Osamu", "Reiko", "Rin", "Saburo", "Sachiko", "Satoshi", "Shiori", "Sora",
         "Sumire", "Tadashi", "Takeo", "Tamiko", "Tetsuo", "Toshiro", "Umeko",
         "Yasuo", "Yoshiko", "Yuki", "Yuriko", "Akira", "Botan", "Chieko", "Danjuro",
         "Eiji", "Fusao", "Goro", "Hideo", "Isamu", "Junko", "Kazuo", "Machiko",
         "Naoki", "Okiku", "Ryuu", "Shinji", "Takara", "Ume", "Wataru", "Yori"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("school", nargs="*", help="school name(s); omit with --all")
    ap.add_argument("--all", action="store_true", help="every school with no character")
    ap.add_argument("--list", action="store_true", help="list uncovered schools and stop")
    ap.add_argument("--write", action="store_true", help="write src/characters/<slug>.json")
    args = ap.parse_args()

    if not os.path.exists(DB):
        sys.exit("no pipeline/l5r.sqlite — run scripts/build.py first")
    cx = sqlite3.connect(DB)
    cx.row_factory = sqlite3.Row

    covered = {norm(r["school"]) for r in cx.execute(
        "SELECT school FROM character WHERE school IS NOT NULL")}
    all_schools = [r["name"] for r in cx.execute(
        "SELECT name FROM catalog WHERE pack LIKE '%school-curriculum%' ORDER BY name")]
    uncovered = [s for s in all_schools if norm(s) not in covered]

    if args.list:
        print(f"{len(uncovered)} of {len(all_schools)} schools have no character:")
        for s in uncovered:
            print("   ", s)
        return

    wanted = args.school or (uncovered if args.all else [])
    if not wanted:
        sys.exit("name a school, or pass --all (see --list)")

    corpus = compose()
    idx = school_index(corpus)
    aliases = corpus_aliases()
    clans = load_js("clans.js", "L5R_CLANS")
    families = load_js("families.js", "L5R_FAMILIES")
    catalog = [dict(r) for r in cx.execute(
        "SELECT name, sub_type, kind, ring, xp_cost, data FROM catalog"
        " WHERE sub_type IN ('item','weapon','armor','peculiarity','technique',"
        "'signature_scroll')")]
    for e in catalog:
        d = json.loads(e["data"]) or {}
        e["category"] = d.get("category")
        r = d.get("rarity")
        # the compendium stores rarity as an int on some packs and a string on
        # others; a bare `<=` on the mixed set raises rather than mis-sorting
        e["rarity"] = int(r) if str(r).strip().isdigit() else None
    peculiarities = [e for e in catalog if e["sub_type"] == "peculiarity"]
    heritages = load_js("heritages.js", "L5R_HERITAGES")
    # questions 1 and 2 for a Path of Waves or Writ of the Wilds school
    regions = load_js("regions.js", "L5R_REGIONS")
    upbringings = load_js("upbringings.js", "L5R_UPBRINGINGS")
    # which book each school is from, which is what decides the question set
    books = {norm(r["name"]): r["source_book"] for r in cx.execute(
        "SELECT name, source_book FROM catalog"
        " WHERE pack LIKE '%school-curriculum%'")}
    counts = usage_counts()
    # every personal name already in the archive, so generated ones do not collide
    taken = []
    for r in cx.execute("SELECT name FROM character"):
        taken += (r["name"] or "").split()
    names = {"pool": GIVEN, "used": taken}

    made, missing, bad = 0, [], []
    for name in wanted:
        school = find_school(name, idx, aliases)
        if not school:
            bad.append(name)
            continue
        doc, unresolved = build_character(name, school, clans, families, catalog,
                                          counts, peculiarities, names, heritages,
                                          regions=regions, upbringings=upbringings,
                                          book=books.get(norm(name)))
        missing += [(name, u) for u in unresolved]
        t = doc["tiers"][0]
        ident = doc["identity"]
        origin = (ident.get("clan") or
                  " · ".join(x for x in (
                      str(ident.get("region") or "").replace(" Region", ""),
                      str(ident.get("upbringing") or "").replace(" Upbringing", ""),
                      ident.get("origin_type") or "") if x) or "—")
        print(f"{doc['name']:22} {name:40} {doc['mode']:5} "
              f"rings {'/'.join(str(t['rings'][r]) for r in RINGS)}  "
              f"h{t['social']['honor']} g{t['social']['glory']} "
              f"s{t['social']['status']}  "
              f"{len(t['techniques'])}t {len(t['peculiarities'])}p "
              f"{len(t['gear'])}g  {coin_label(t['money']):14} "
              f"{origin[:34]}")
        if args.write:
            os.makedirs(SRC, exist_ok=True)
            dest = os.path.join(SRC, doc["slug"] + ".json")
            if os.path.exists(dest):
                print(f"   skip — {doc['slug']}.json already exists")
                continue
            json.dump(doc, open(dest, "w"), indent=1, ensure_ascii=False)
        made += 1

    if bad:
        print(f"\n! {len(bad)} schools not found in the corpus: {', '.join(bad)}")
    if missing:
        seen = collections.Counter(u for _, u in missing)
        print(f"\n! {len(seen)} outfit lines did not resolve to a catalog item:")
        for line, n in seen.most_common():
            print(f"   {n:3}x  {line}")
    print(f"\n{made} character(s) {'written' if args.write else 'generated (dry run)'}")


if __name__ == "__main__":
    main()
