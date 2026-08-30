#!/usr/bin/env python3
"""Rules text for the site comes from the DSL corpus, not from Foundry.

The Foundry compendium is the *catalog* — it says what exists, what it costs,
which pack it lives in, and it is what an actor's items resolve against. It is
not the rules. `~/Working/Titterpig DSL/titterpig-dsl-l5r5e/0.4` is, and it is
the corpus Jordan maintains (Jordan, 2026-08-30).

The difference is visible in any entry. Foundry stores one HTML blob of flavour
fiction followed by the effects; the DSL states the effects alone, as a list, in
consistent notation:

    Ally [Name]
      DSL      "You have proven yourself to someone, who is willing to help you…"
      Foundry  "Do not use my name too freely, beloved…  The following apply to a
                character with the Ally [Name] distinction: - You have proven
                yourself to a someone…"          <- compendium typo, absent in DSL

The corpus is composed by titterpig-synthesist with the errata files last, so
what comes out is corrected text. The composition is cached in pipeline/dsl/
(gitignored) and only rebuilt on --refresh.

    python3 scripts/dsl_rules_text.py
    python3 scripts/dsl_rules_text.py --refresh    # recompose the corpus first

Writes two things:
  * data/chargen/peculiarities.js   the Creator's picker text
  * pipeline/dsl/rules_text.json, keyed by catalog uuid, which scripts/build.py
    reads at its single description choke point so every dossier and play sheet
    follows.

GATE: every catalog entry a character actually references must resolve to the
corpus, or be listed in `dsl_text_exceptions` in src/foundry_sources.json with a
reason. Narrowing is the owner's signed call, never this script's default.
"""
import argparse, collections, html, json, os, re, shutil, sqlite3, subprocess, sys, unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORKING = os.path.dirname(ROOT)
SYNTH = os.path.join(WORKING, "Titterpig Utilities", "titterpig-synthesist")
MANIFEST = os.path.join(SYNTH, "manifests", "l5r5e-0.4.json")
CACHE = os.path.join(ROOT, "pipeline", "dsl", "l5r5e-resolved.json")
DB = os.path.join(ROOT, "pipeline", "l5r.sqlite")
SOURCES = os.path.join(ROOT, "src", "foundry_sources.json")
PEC_OUT = os.path.join(ROOT, "data", "chargen", "peculiarities.js")
# Not a table in l5r.sqlite: scripts/build.py deletes that database and rebuilds
# it from scratch on every run, so anything written there is gone by the time the
# build wants to read it.
TEXT_OUT = os.path.join(ROOT, "pipeline", "dsl", "rules_text.json")

PEC_KINDS = {"Distinction", "Adversity", "Passion", "Anxiety"}

# Blocks whose contents are rules prose. Structural blocks (RANK, SKILL,
# CURRICULUM tables, STARTING_OUTFIT) are deliberately absent: they are data the
# site already renders from its own columns, not text to read.
PROSE_BLOCKS = {"EFFECT", "EFFECTS", "ACTIVATION", "OPPORTUNITIES", "DESCRIPTION",
                "MASTERY_ABILITY", "SCHOOL_ABILITY", "RITUAL", "INVOCATION",
                "NEW_OPPORTUNITIES", "SPECIAL", "NOTES", "LIMITS",
                "ENHANCEMENT", "BURST", "REMOVED_WHEN", "COMPLETION", "ABILITY",
                "ASSIGNED_BY", "OBJECTIVE", "BREACHES", "SACRIFICES"}

# Properties that ARE rules text. An allowlist, not a "long string" heuristic:
# the heuristic swept in the corpus's own bookkeeping — "Errata Note",
# "Carryover From", "Source Book" — and put an editorial note where a title's
# rule belonged.
PROSE_PROPS = {"Description", "Activation", "Effect", "Effects", "Opportunities",
               "Enhancement Effect", "Burst Effect", "Assigned By", "Restriction",
               "Narrative Requirements", "Title Ability Effect", "Magnitude",
               "Ability", "Bond Ability", "Special", "Notes"}
# ...and the bookkeeping that must never reach a page.
META_PROPS = {"Errata Note", "Carryover From", "Source Book", "Source Chapter",
              "Source Page", "Source Reference"}
# Ability blocks name themselves in their label rather than being a DEF.
ABILITY_BLOCKS = {"SCHOOL_ABILITY", "MASTERY_ABILITY", "TITLE_ABILITY"}
NAMED_BLOCK = re.compile(r'^\^?"(.+)"$')

# The compendium pre-expands three parametric entries into one document each;
# the corpus keeps the single rule that says "choose one". Both are right, so
# the expansion resolves to its parent and the UI names the parent.
PARAMETRIC = {
    "Paragon of": "Paragon of a Bushidō Tenet",
    "Disdain for": "Disdain for a Bushidō Tenet",
    "Overconfidence in": "Overconfidence in [Feature]",
}
NOT_PARAMETRIC = {"Disdain for Urban Sprawl"}

# Genuine renames between the two data sets. Keep this short and explicit —
# fuzzy matching on rules text is how the wrong rule ends up on a sheet.
ALIASES = {
    "Horsebow": "Shinjo Horsebow",
    "Linguistic Liason": "Linguistic Liaison",   # the compendium has the typo
}

# "Sacred Mantras (Title Ability): You can purchase mantra techniques."
RULE_ABILITY = re.compile(r'^(?P<name>[^"(]+?)\s*\((?:Title|School) Ability\):\s*(?P<text>.+)$')
# ^"Title Ability" STRING "Linguistic Liaison: You learn the languages…"
INLINE_ABILITY = re.compile(r"^(?P<name>[A-Z][^:]{2,60}):\s+(?P<text>.{20,})$", re.S)


def norm(s):
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", "", s.lower())


def variants(name):
    """Every spelling of one name that could be the corpus's spelling.

    The compendium qualifies techniques by clan ("Lord Hida's Grip (Crab)"),
    suffixes school journals ("Hida Defender School"), and splits sub-items on a
    colon ("Arrows : Hamaya"). The corpus does none of those.
    """
    out = [(name or "").strip()]
    out.append(re.sub(r"\s*\([^)]*\)\s*$", "", out[0]))
    for base in list(out):
        out.append(re.sub(r"\s+(School|Bond|Title)$", "", base))
        out.append(re.sub(r"\s*:\s*.*$", "", base))
        out.append(re.sub(r"\s*\[[^\]]*\]\s*$", "", base))
    return [x for x in dict.fromkeys(out) if x]


def walk(o):
    if isinstance(o, dict):
        yield o
        for v in o.values():
            yield from walk(v)
    elif isinstance(o, list):
        for v in o:
            yield from walk(v)


def compose(refresh=False):
    """The resolved corpus, composed by the synthesist with errata applied last."""
    if os.path.exists(CACHE) and not refresh:
        return json.load(open(CACHE))
    if not os.path.isdir(SYNTH):
        sys.exit(f"titterpig-synthesist not found at {SYNTH}")
    go = shutil.which("go") or os.path.expanduser("~/.local/go/bin/go")
    if not os.path.exists(go):
        sys.exit("go not found (expected ~/.local/go/bin/go)")
    # Always rebuild: a stale synthesist binary drops content silently and still
    # exits 0. That is a standing trap in this toolchain.
    print("   building synthesist…", flush=True)
    subprocess.run([go, "build", "-o", "synthesist", "./cmd/synthesist"],
                   cwd=SYNTH, check=True)
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    print("   composing l5r5e corpus (errata last)…", flush=True)
    r = subprocess.run([os.path.join(SYNTH, "synthesist"), "-merge", MANIFEST,
                        "-no-timestamp", "-out-json", CACHE,
                        "-out-ttrpg", CACHE.replace(".json", ".ttrpg")],
                       cwd=SYNTH, capture_output=True, text=True)
    if r.returncode:
        sys.exit("synthesist failed:\n" + r.stdout + r.stderr)
    print("   " + (r.stdout.strip().splitlines() or ["composed"])[0])
    return json.load(open(CACHE))


def synthetic(name, text):
    return {"kind": "def", "name": name,
            "blocks": [{"keyword": "EFFECT", "text": [t for t in text if t]}]}


def build_index(corpus):
    """Every named thing in the corpus that carries rules text.

    Four shapes, all of them real and all of them load-bearing:

      1. DEF nodes                techniques, peculiarities, titles, schools
      2. labelled ability blocks  a school's SCHOOL_ABILITY / MASTERY_ABILITY —
                                  the ability's name is the block's label
      3. named value-pairs        ^"Ashigaru Armor" "Physical 3, Wargear, …"
                                  inside an ARMOR_TABLE / equipment table
      4. Title Ability pairs      ^"Title Ability" "Behold the Legend" beside
                                  ^"Title Ability Effect" "Once per scene, …"

    Reading only shape 1 finds 2402 names and misses 355 of them.
    """
    idx = {}
    counts = collections.Counter()

    def put(name, node, shape):
        first = True
        for key in {norm(v) for v in variants(name)}:
            if key and key not in idx:
                idx[key] = node
                if first:
                    counts[shape] += 1
                    first = False

    for o in walk(corpus):
        if not isinstance(o, dict):
            continue

        if o.get("kind") == "def" and o.get("name"):
            put(o["name"], o, "def")

        kw = o.get("keyword") or ""
        if kw in ABILITY_BLOCKS and o.get("label"):
            m = NAMED_BLOCK.match(o["label"].strip())
            if m:
                put(m.group(1), synthetic(m.group(1), o.get("text") or []), "ability block")

        m = NAMED_BLOCK.match(kw)
        if m and o.get("value"):
            put(m.group(1), synthetic(m.group(1), [o["value"]]), "table row")

        # shape 4: a DEF written as ^"Prop" STRING "value" pairs arrives as
        # parallel refs/text arrays; a title names its ability in one and
        # states it in the next.
        refs, txt = o.get("refs") or [], o.get("text") or []
        if len(refs) == len(txt) and "Title Ability" in refs:
            pairs = dict(zip(refs, txt))
            ability, effect = pairs.get("Title Ability"), pairs.get("Title Ability Effect")
            if ability and effect:
                put(ability, synthetic(ability, [effect]), "title ability")
            elif ability:
                m = INLINE_ABILITY.match(ability.strip())   # shape 5: "Name: effect"
                if m:
                    put(m.group("name"),
                        synthetic(m.group("name"), [m.group("text")]), "title ability")

        # ...and some state it in a plain property rather than a refs/text pair
        if o.get("name") == "Title Ability" and isinstance(o.get("value"), str):
            m = INLINE_ABILITY.match(o["value"].strip())
            if m:
                put(m.group("name"),
                    synthetic(m.group("name"), [m.group("text")]), "title ability")

        # shape 6: some books state an ability only in a RULES label,
        # 'astradhari_title_ability "Sacred Mantras (Title Ability): …"'
        t = o.get("text")
        if isinstance(t, str) and "Ability)" in t:
            for chunk in re.findall(r'"([^"]+)"', t):
                m = RULE_ABILITY.match(chunk.strip())
                if m:
                    put(m.group("name"),
                        synthetic(m.group("name"), [m.group("text")]), "rules label")

    return idx, counts


def text_of(e):
    """Whatever rules prose this node carries, in whichever shape it uses."""
    parts = []
    refs, txt = e.get("refs") or [], e.get("text") or []
    if txt:
        if len(refs) == len(txt):
            parts += [t if r in ("Description", "Effect", "Effects") else f"{r}: {t}"
                      for r, t in zip(refs, txt) if r not in META_PROPS]
        else:
            parts += list(txt)
    for b in (e.get("blocks") or []):
        if (b.get("keyword") or "") in PROSE_BLOCKS:
            if b.get("value"):
                parts.append(str(b["value"]))
            parts += [str(x) for x in (b.get("text") or [])]
    for p in (e.get("properties") or []):
        nm, v = p.get("name"), p.get("value")
        if nm in PROSE_PROPS and isinstance(v, str) and v.strip():
            parts.append(v if nm in ("Description", "Effect", "Effects") else f"{nm}: {v}")
    return [p.strip() for p in parts if p and p.strip()]


# The corpus marks a cross-reference as ^"Glory". That is authoring syntax, not
# something a reader should see, so it renders as the plain name.
DSL_REF = re.compile(r'\^"([^"]+)"')


def as_html(parts):
    parts = [DSL_REF.sub(r"\1", p) for p in parts]
    if not parts:
        return ""
    if len(parts) == 1:
        return "<p>" + html.escape(parts[0]) + "</p>"
    return "<ul>" + "".join("<li>" + html.escape(p) + "</li>" for p in parts) + "</ul>"


def resolve(name, clan, idx):
    """A catalog entry to its corpus node, and the parametric parent if any."""
    cands = variants(name)
    if clan:
        cands += variants(f"{name} [{clan}]")
    if name in ALIASES:
        cands = variants(ALIASES[name]) + cands
    for c in cands:
        if norm(c) in idx:
            return idx[norm(c)], None
    if name not in NOT_PARAMETRIC:
        for prefix, parent in PARAMETRIC.items():
            if name.startswith(prefix) and norm(parent) in idx:
                return idx[norm(parent)], parent
    return None, None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true",
                    help="rebuild the synthesist and recompose the corpus")
    args = ap.parse_args()

    if not os.path.exists(DB):
        sys.exit("no pipeline/l5r.sqlite — run scripts/build.py first")

    corpus = compose(args.refresh)
    idx, shapes = build_index(corpus)
    print("   corpus index: " + ", ".join(f"{v} {k}" for k, v in shapes.most_common()))

    exceptions = {k: v for k, v in
                  ((json.load(open(SOURCES)).get("dsl_text_exceptions") or {}).items())
                  if not k.startswith("_")}

    cx = sqlite3.connect(DB)
    cx.row_factory = sqlite3.Row
    used = {r[0] for r in cx.execute(
        "SELECT DISTINCT catalog_uuid FROM tier_content WHERE catalog_uuid IS NOT NULL")}

    rows = [dict(r) for r in cx.execute(
        "SELECT uuid, sub_type, name, clan FROM catalog WHERE sub_type != 'character'")]

    out, pec, gaps = {}, {}, []
    stats = collections.Counter()
    for r in rows:
        e, parent = resolve(r["name"], r["clan"], idx)
        parts = text_of(e) if e else []
        stats["total"] += 1
        if parts:
            stats["text"] += 1
            out[r["uuid"]] = {"dsl": e.get("name"), "via": parent or "",
                              "html": as_html(parts)}
        else:
            why = "no entity in the corpus" if not e else "entity has no prose"
            stats["gap"] += 1
            if r["uuid"] in used:
                gaps.append((r["sub_type"], r["name"], why))
        if r["sub_type"] == "peculiarity" and e:
            pec[r["uuid"]] = {"text": as_html(parts), "types": types_of(e),
                              "dsl": e.get("name"), "via": parent or ""}

    os.makedirs(os.path.dirname(TEXT_OUT), exist_ok=True)
    with open(TEXT_OUT, "w") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    os.makedirs(os.path.dirname(PEC_OUT), exist_ok=True)
    with open(PEC_OUT, "w") as f:
        f.write("window.L5R_PECULIARITY_TEXT = ")
        json.dump(pec, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")

    print(f"dsl text:   {stats['text']}/{stats['total']} catalog entries carry corpus prose"
          f"  ({stats['gap']} without)")
    print(f"            {len(pec)}/253 peculiarities -> "
          f"{os.path.relpath(PEC_OUT, ROOT)} ({os.path.getsize(PEC_OUT)/1024:.1f} KB)")

    unsigned = [g for g in gaps if g[1] not in exceptions]
    covered = [g for g in gaps if g[1] in exceptions]
    pending = [g for g in covered if exceptions[g[1]].startswith("DEFERRED")]
    if covered:
        by = collections.Counter(g[0] for g in covered)
        print(f"            {len(covered)} referenced entries stay on Foundry text by "
              f"stated exception ({', '.join(f'{v} {k}' for k, v in by.most_common())})")
    if pending:
        # A deferral is not a settled exclusion. Jordan has seen these and chosen
        # to leave them, so this does not nag — but it stays counted and named,
        # because a gap that stops being printed is a gap that gets forgotten.
        print(f"            of those, {len(pending)} are DEFERRED gaps the corpus lacks "
              f"(not settled): {', '.join(nm for _, nm, _ in sorted(pending))}")
    if unsigned:
        print(f"\nFAIL — {len(unsigned)} entries on live character pages have no corpus "
              "text and no signed exception:")
        for st, nm, why in sorted(unsigned):
            print(f"   {st:12} {nm:34} {why}")
        print("\nEither convert them into titterpig-dsl-l5r5e, or add them to "
              "`dsl_text_exceptions` in src/foundry_sources.json with a reason.")
        sys.exit(1)
    print("DONE_MARKER dsl rules text ok")


def types_of(e):
    for p in (e.get("properties") or []):
        if p.get("name") == "Types" and p.get("value"):
            try:
                v = json.loads(p["value"])
                if isinstance(v, list):
                    return ", ".join(str(x) for x in v)
            except (ValueError, TypeError):
                pass
            return str(p["value"])
    return ""


if __name__ == "__main__":
    main()
