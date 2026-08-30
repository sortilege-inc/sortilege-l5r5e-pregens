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
      Foundry  "Do not use my name too freely, beloved, on every tea matron and
                Miwaku Kabe guard…  The following apply to a character with the
                Ally [Name] distinction: - You have proven yourself to a someone…"
                                                                     ^ compendium typo

The corpus is composed by titterpig-synthesist, which applies the errata files
last, so what comes out is the corrected text. That composition is cached under
pipeline/ (gitignored) and only rebuilt on --refresh.

    python3 scripts/dsl_rules_text.py
    python3 scripts/dsl_rules_text.py --refresh    # recompile the corpus first

Writes data/chargen/peculiarities.js (window.L5R_PECULIARITY_TEXT), keyed by
the compendium uuid so the Creator can look up by catalog entry. Five
Shadowlands Taint entries share a name, which is why the key is the uuid.

GATE: every peculiarity in the compendium must resolve to a DSL entity. The
script exits non-zero and names the strays otherwise — a name that drifts must
be noticed, not silently rendered blank.
"""
import argparse, collections, html, json, os, re, shutil, sqlite3, subprocess, sys, unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORKING = os.path.dirname(ROOT)
SYNTH = os.path.join(WORKING, "Titterpig Utilities", "titterpig-synthesist")
MANIFEST = os.path.join(SYNTH, "manifests", "l5r5e-0.4.json")
CACHE = os.path.join(ROOT, "pipeline", "dsl", "l5r5e-resolved.json")
DB = os.path.join(ROOT, "pipeline", "l5r.sqlite")
OUT = os.path.join(ROOT, "data", "chargen", "peculiarities.js")

PEC_KINDS = {"Distinction", "Adversity", "Passion", "Anxiety"}

# The compendium pre-expands three parametric entries into one document each;
# the DSL keeps the single rule that says "choose one". Both are right, so the
# expansion resolves to its parent and the UI names the parent it came from.
PARAMETRIC = {
    "Paragon of": "Paragon of a Bushidō Tenet",
    "Disdain for": "Disdain for a Bushidō Tenet",
    "Overconfidence in": "Overconfidence in [Feature]",
}
# ...except these, which are entries in their own right, not expansions.
NOT_PARAMETRIC = {"Disdain for Urban Sprawl"}


def norm(s):
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", "", s.lower())


def compose(refresh=False):
    """The resolved corpus, composed by the synthesist with errata applied last."""
    if os.path.exists(CACHE) and not refresh:
        return json.load(open(CACHE))
    if not os.path.isdir(SYNTH):
        sys.exit(f"titterpig-synthesist not found at {SYNTH}")
    go = shutil.which("go") or os.path.expanduser("~/.local/go/bin/go")
    if not os.path.exists(go):
        sys.exit("go not found (expected ~/.local/go/bin/go)")
    # Always rebuild: a stale synthesist binary drops content silently and
    # still exits 0. This is a standing trap in this toolchain.
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
    print("   " + r.stdout.strip().splitlines()[0])
    return json.load(open(CACHE))


def index_peculiarities(corpus):
    """Every peculiarity DEF in the corpus, by normalised name and by stem.

    DEFs nest — inside blocks, inside other DEFs — so this walks the whole
    document rather than the top-level entity list. Walking only the top level
    finds 237 of them; walking properly finds every one.
    """
    idx = {}

    def add(key, e):
        idx.setdefault(key, e)

    def walk(o):
        if isinstance(o, dict):
            if o.get("kind") == "def" and o.get("extends") in PEC_KINDS:
                nm = o.get("name") or ""
                add(norm(nm), o)
                # "Ally [Name]" is filed by the compendium as name "Ally" with
                # "Name" in a separate column, so index the stem as well
                stem = re.sub(r"\s*\[[^\]]*\]\s*$", "", nm)
                if stem != nm:
                    add(norm(stem), o)
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)

    walk(corpus)
    return idx


def effect_html(entity):
    """The DSL's EFFECT clauses as a list. This is the rules text, verbatim."""
    out = []
    for b in (entity.get("blocks") or []):
        if b.get("keyword") == "EFFECT":
            out.extend(b.get("text") or [])
    if not out:
        return ""
    return "<ul>" + "".join("<li>" + html.escape(t) + "</li>" for t in out) + "</ul>"


def prop(entity, name):
    for p in (entity.get("properties") or []):
        if p.get("name") == name:
            return p.get("value")
    return None


def types_of(entity):
    """The DSL's own Types list ("Interpersonal", "Spiritual"), as a string."""
    v = prop(entity, "Types")
    if not v:
        return ""
    try:
        parsed = json.loads(v)
        if isinstance(parsed, list):
            return ", ".join(str(x) for x in parsed)
    except (ValueError, TypeError):
        pass
    return str(v)


def resolve(name, clan, idx):
    """A compendium peculiarity to its DSL entity, with the reason it matched."""
    if norm(name) in idx:
        return idx[norm(name)], None
    if clan and norm(f"{name} [{clan}]") in idx:            # "Ally" + "[Name]"
        return idx[norm(f"{name} [{clan}]")], None
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
    idx = index_peculiarities(corpus)

    cx = sqlite3.connect(DB)
    cx.row_factory = sqlite3.Row
    rows = [dict(r) for r in cx.execute(
        "SELECT uuid, name, kind, clan FROM catalog"
        " WHERE sub_type='peculiarity' ORDER BY name")]

    out, unresolved, empty = {}, [], []
    via = collections.Counter()
    for r in rows:
        e, parent = resolve(r["name"], r["clan"], idx)
        if not e:
            unresolved.append(r["name"])
            continue
        text = effect_html(e)
        if not text:
            empty.append(r["name"])
        if parent:
            via[parent] += 1
        out[r["uuid"]] = {"text": text, "types": types_of(e), "dsl": e["name"],
                          "via": parent or ""}

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write("window.L5R_PECULIARITY_TEXT = ")
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")

    print(f"peculiarities: {len(out)}/{len(rows)} resolved against the DSL corpus"
          f" -> {os.path.relpath(OUT, ROOT)} ({os.path.getsize(OUT)/1024:.1f} KB)")
    print(f"   {len(idx)} peculiarity DEFs indexed from the corpus")
    for parent, n in sorted(via.items()):
        print(f"   {n} compendium entries resolve to the parametric {parent!r}")
    if empty:
        print(f"   ! {len(empty)} resolved but carry no EFFECT block: "
              f"{', '.join(sorted(empty)[:6])}")

    if unresolved:
        print(f"\nFAIL — {len(unresolved)} compendium peculiarities have no DSL entity:")
        for n in sorted(unresolved):
            print("   -", n)
        print("\nEither the corpus is missing them, or a name has drifted. Fix the "
              "corpus or extend PARAMETRIC — do not fall back to Foundry's text.")
        sys.exit(1)
    print("DONE_MARKER dsl rules text ok")


if __name__ == "__main__":
    main()
