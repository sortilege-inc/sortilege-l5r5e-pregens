#!/usr/bin/env python3
"""Shared text handling for the source audit.

Kept in one place because the measuring tool and the probe must agree exactly:
if they normalise differently, the probe explains a divergence the measurement
did not find, which is how an earlier pass produced findings that were not real.
"""
import re

# Page furniture interrupts sentences. A rule that runs across a page break has
# the page number and the running head sitting inside it, so a corpus string
# that is a perfect quotation still fails a naive comparison. Verified on the
# Void-point passage of the Core Rulebook, where "100 CHAPTER 2: CREATING A
# CHARACTER" lands mid-clause.
FURNITURE = re.compile(r"^(?:\d{1,3}|-{3,})$")
RUNNING_HEAD = re.compile(r"^(?:CHAPTER\d.*|INTRODUCTION|INDEX|APPENDIX.*|"
                          r"TABLEOFCONTENTS)$")


def strip_furniture(text):
    """Drop page numbers, rule separators and running heads, line by line.

    Conservative on purpose: a line is only removed when the whole line is
    furniture. The spaced-capital variants the extractor produces
    ("C H APT E R 2 : C R E AT I N G A C H AR ACTER") are caught by testing the
    line with its spaces removed, so no partial line is ever edited.
    """
    out = []
    for line in text.split("\n"):
        s = line.strip()
        if not s:
            out.append(line)
            continue
        if FURNITURE.match(s):
            continue
        squashed = re.sub(r"[^A-Za-z0-9]", "", s).upper()
        if squashed and RUNNING_HEAD.match(squashed) and s.upper() == s:
            continue
        out.append(line)
    return "\n".join(out)


def stream(t):
    """Letters and digits only, lowercased — the comparison currency.

    The extraction breaks words across columns and line ends ("hon or",
    "accompLishment"), so comparison folds every separator away. Digits survive,
    so numbers are never matched loosely.
    """
    return re.sub(r"[^a-z0-9]", "", t.lower())
