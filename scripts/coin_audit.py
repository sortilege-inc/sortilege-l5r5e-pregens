#!/usr/bin/env python3
"""Every character's purse against what question 2 gives them.

This gate exists because the first pass at this missed two characters. It
matched each record's family against the corpus's 42 by exact name, so Nasu and
Tsume -- vassal houses the corpus does not define -- resolved to nothing and
were skipped rather than flagged. Both were carrying no coin at all. A check
that goes quiet on the cases it cannot resolve is not a check.

So question 2 is resolved the way records actually write it:

  - "Military" is the Military Upbringing, "Isawa" the Isawa family: the
    corpus's suffix is dropped in a character record.
  - "Nasu (Shiba Vassal)" is a vassal house. The corpus defines no Nasu, but it
    names the patron in the parenthetical, and a vassal family takes its
    patron's starting wealth.
  - "Fallen Noble (Gaijin)" is the Fallen Noble Upbringing, which gives no coin
    at all -- only an heirloom and a wakizashi. Zero is the right answer there,
    not a missing one.
  - and where none of that resolves, the character's own step-2 answers record
    the koku they were given. That is the source the manifest already treats as
    winning over the actor.

Only a record that resolves to nothing at all goes unchecked, and it is named
in the output rather than passed over in silence.

Two deliberate loosenesses, so the gate does not fight correct data:

  - value, not denomination. Foundry stores some purses in zeni; 400 zeni is
    8 koku and the gate says nothing. Which denomination a record keeps is a
    separate question from whether the money is there.
  - the lowest tier only. A character who has played may have spent it and
    nothing records that. What cannot be right is a record whose earliest tier
    already contradicts what question 2 gave.

    python3 scripts/coin_audit.py
"""
import glob
import json
import os
import re
import sys
import unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "src", "characters")
CHARGEN = os.path.join(ROOT, "data", "chargen")

# the corpus states the rate in core-systems.ttrpg (currency-of-rokugan):
# a koku is five bu is fifty zeni
ZENI_PER = {"koku": 50, "bu": 10, "zeni": 1}


def norm(s):
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "", s.lower())


def load(name):
    text = open(os.path.join(CHARGEN, name), encoding="utf-8").read()
    return json.loads(text[text.index("["):].rstrip().rstrip(";"))


def zeni(coins):
    return sum(int((coins or {}).get(k) or 0) * v for k, v in ZENI_PER.items())


def q2_source(doc, grants):
    """(what question 2 gives in zeni, how it was resolved), or (None, why not).

    grants maps a normalised name to (zeni, label). Both the corpus's own name
    and the name with its Family/Upbringing suffix dropped are keys, so a
    record's shorthand resolves.
    """
    ident = doc.get("identity") or {}
    step2 = (((doc.get("twenty_questions") or {}).get("steps") or {})
             .get("step2") or {}).get("answers", {})
    names = [ident.get("upbringing"), ident.get("family"), step2.get("family")]
    for raw in names:
        if not raw:
            continue
        # "Nasu (Shiba Vassal)" -> the patron gives the wealth; "Fallen Noble
        # (Gaijin)" -> the parenthetical is not a patron, so the bare name is
        # tried first and the patron only as a fallback
        bare = re.sub(r"\s*\(.*\)\s*$", "", str(raw)).strip()
        if norm(bare) in grants:
            z, label = grants[norm(bare)]
            return z, f"{bare} -> {label}"
        m = re.search(r"\(([^)]*?)\s+vassal\)", str(raw), re.I)
        if m and norm(m.group(1)) in grants:
            z, label = grants[norm(m.group(1))]
            return z, f"{raw} -> its patron {label}"

    w = step2.get("wealth")
    try:
        return int(w) * ZENI_PER["koku"], f"its own step-2 answers ({int(w)} koku)"
    except (TypeError, ValueError):
        pass
    return None, "no family, upbringing or step-2 wealth to resolve"


def main():
    grants = {}
    for fname in ("families.js", "upbringings.js"):
        for row in load(fname):
            z = zeni(row.get("starting_coins"))
            label = row["name"]
            grants[norm(label)] = (z, label)
            # a record writes "Isawa", not "Isawa Family"; "Military", not
            # "Military Upbringing"
            short = re.sub(r"\s+(Family|Upbringing)$", "", label)
            grants.setdefault(norm(short), (z, label))
            # and "Hunter" for the Hunter or Fisher Upbringing: where the book
            # names one entry after two callings, a record picks the one it
            # means
            for half in re.split(r"\s+or\s+", short):
                if half.strip():
                    grants.setdefault(norm(half), (z, label))

    bad, unresolved, checked = [], [], 0
    for path in sorted(glob.glob(os.path.join(SRC, "*.json"))):
        doc = json.load(open(path, encoding="utf-8"))
        tiers = sorted(doc.get("tiers") or [], key=lambda t: t.get("xp") or 0)
        if not tiers:
            continue
        want, how = q2_source(doc, grants)
        if want is None:
            unresolved.append((doc["slug"], how))
            continue
        checked += 1
        got = zeni(tiers[0].get("money"))
        if got != want:
            bad.append((doc["slug"], tiers[0].get("xp"), want, how,
                        tiers[0].get("money") or {}, got))

    if bad or unresolved:
        if bad:
            print(f"FAIL — {len(bad)} of {checked} records carry coin that is "
                  f"not what question 2 gives:", file=sys.stderr)
            for slug, xp, want, how, money, got in bad:
                print(f"   {slug} (lowest tier {xp} XP): {how} gives {want} "
                      f"zeni, the record holds {money} = {got} zeni",
                      file=sys.stderr)
        if unresolved:
            print(f"FAIL — {len(unresolved)} record(s) could not be checked at "
                  f"all, which is how two were missed before:", file=sys.stderr)
            for slug, how in unresolved:
                print(f"   {slug}: {how}", file=sys.stderr)
        return 1

    print(f"coin audit: {checked} records carry exactly what question 2 gives, "
          f"none unresolved")
    return 0


if __name__ == "__main__":
    sys.exit(main())
