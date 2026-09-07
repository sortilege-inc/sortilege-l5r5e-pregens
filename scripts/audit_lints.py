#!/usr/bin/env python3
"""The deterministic half of a pack audit, as a script.

The Blood of the Lioness audit found fourteen field-versus-prose defects by
reading nine records; the Creator's export lints now catch them for new
characters, and this runs the same checks -- plus the audit's other mechanical
sweeps -- over the records already in the archive, so the next pack's report
starts from a list rather than a read.

    python3 scripts/audit_lints.py "Mask of the Oni"
"""
import collections, glob, json, os, re, sys, unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "src", "characters")

PHYSICAL = {
    "lost eye": r"\b(eye|socket|patch)\b", "lost arm or lost hand": r"\b(hand|arm|glove|sleeve|stump)\b",
    "lost leg": r"\b(leg|crutch|limp|stump)\b", "lost fingers": r"finger", "demon wound": r"\b(scar|wound)\b",
    "maimed visage": r"\b(scar|face|mouth|lip|cheek|jaw)\b", "dashing scar": r"scar",
    "large stature": r"\b(tall|large|broad|towering|big|heavy)\b", "small stature": r"\b(small|short|slight|little)\b",
    "fractured spine": r"\b(stoop|spine|back|bent|hunch)\b", "muteness": r"\b(mute|sign|silent|speak|voice|slate)\b",
    "nerve damage": r"\b(hand|arm|stiff|tremor|shak)", "one eye": r"\b(eye|socket|patch)\b",
}


def fold(s):
    s = unicodedata.normalize("NFD", str(s or ""))
    return "".join(c for c in s if not unicodedata.combining(c)).lower()


def mentions(hay, needle):
    return bool(needle) and fold(needle) in fold(hay)


def main(camp):
    docs = []
    for p in sorted(glob.glob(os.path.join(SRC, "*.json"))):
        d = json.load(open(p, encoding="utf-8"))
        if d.get("campaign") == camp and (d.get("provenance") or "archive") == "archive":
            docs.append(d)
    if not docs:
        sys.exit(f"no archive characters on {camp!r}")
    blocks, warns = [], []
    given = collections.defaultdict(list)
    npc_names = collections.defaultdict(list)
    for d in docs:
        n = d["name"]; w = d.get("wizard") or {}; a = w.get("answers") or {}; t = d["tiers"][0]
        given[n.split()[-1]].append(n)
        if a.get("lord_name") and a.get("giri") and not mentions(a["giri"], a["lord_name"]):
            blocks.append(f"{n}: lord {a['lord_name']!r} is not in the giri")
        m = a.get("mentor") or {}
        if m.get("name") and m.get("text") and not mentions(m["text"], m["name"]):
            blocks.append(f"{n}: mentor {m['name']!r} is not in the mentor text")
        for p in a.get("people") or []:
            npc_names[p["name"]].append(n)
            tx = p.get("text") or ""
            f = len(re.findall(r"\b(she|her|hers)\b", tx, re.I)); mm = len(re.findall(r"\b(he|him|his)\b", tx, re.I))
            if p.get("gender") == "male" and f and not mm:
                warns.append(f"{n}: {p['name']} marked male; line uses only she/her — is that the PC?")
            if p.get("gender") == "female" and mm and not f:
                warns.append(f"{n}: {p['name']} marked female; line uses only he/him")
        for g in t.get("gear") or []:
            if g.get("held") is False:
                blocks.append(f"{n}: outfit either-or unsettled: {g['name'][:60]!r}")
            if g.get("text") == "The accoutrement named at question 14":
                warns.append(f"{n}: accoutrement in the old shape ({len(g['name'].split())} words as the title)")
        for pcl in t.get("peculiarities") or []:
            nm = pcl["name"]
            if "TBD" in nm or re.search(r"\[[^\]]+\]", nm):
                blocks.append(f"{n}: unfilled subject {nm!r}")
            key = re.sub(r"\s*\(.*$", "", nm).lower()
            q14 = (a.get("first_impression") or "") + " " + (a.get("accoutrement") or "")
            if key in PHYSICAL and not re.search(PHYSICAL[key], q14, re.I):
                warns.append(f"{n}: {nm!r} on the sheet, not shown at Q14")
        if not a.get("accoutrement_name"):
            warns.append(f"{n}: no accoutrement object name")
        # giri shape: a want or a prohibition rather than a duty
        gi = a.get("giri") or ""
        if re.search(r"\b(must (discover|find out|learn|know)|wants to|needs to)\b", gi):
            warns.append(f"{n}: giri reads as a want: {gi[:90]!r}")
        if re.search(r"\b(keep .* from|prevent|forbid|stop .* from)\b", gi):
            warns.append(f"{n}: giri reads as a prohibition: {gi[:90]!r}")
        ni = a.get("ninjo") or ""
        if ni and not re.search(r"\b(want|wish|long|need|hope|crave|desire)", ni, re.I):
            warns.append(f"{n}: ninjō states no want: {ni[:90]!r}")
    for k, v in given.items():
        if len(v) > 1:
            warns.append(f"duplicate personal name in pack: {k} -> {v}")
    for k, v in npc_names.items():
        if len(v) > 1:
            warns.append(f"NPC named by more than one PC (merge or split?): {k} <- {v}")
    print(f"{camp}: {len(docs)} records\n")
    print(f"BLOCKS ({len(blocks)}):"); [print("  ", b) for b in blocks]
    print(f"\nWARNINGS ({len(warns)}):"); [print("  ", w) for w in warns]


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "Mask of the Oni")
