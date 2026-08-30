/* ============================================================
   symbols.js — L5R5e dice symbols and ring icons inside rules text.

   The corpus writes symbols as tokens: "(op)" for opportunity, "(su)" for a
   success, "[Water]" for the ring of a check. Printed straight, a technique
   reads "you may spend (op)", which is not what the book says.

   The representation follows portents-and-fortunes: a glyph in a coloured
   span for the die symbols, and the ring SVGs for the five rings, so the two
   surfaces look like the same game. assets/play/sheet.js carries its own copy
   of this, because that engine is a verbatim drop-in and is not edited here.

   Only the tokens the corpus actually uses are matched, by name. A blanket
   "anything in brackets" rule would turn Martial Arts [Melee] into a ring.

   Operates on an HTML string and returns one. Idempotent: a second pass finds
   nothing left to replace, so it is safe to run on already-marked text.
   ============================================================ */
(function () {
  "use strict";

  var GLYPH = {
    op: ["◈", "Opportunity"],
    su: ["❁", "Success"],
    ex: ["❉", "Explosive success"],
    st: ["▲", "Strife"],
    ring: ["⬢", "Ring die"],
    skill: ["⬡", "Skill die"]
  };
  var RINGS = ["air", "earth", "fire", "water", "void"];

  // Ring art sits beside this file, so the path works whatever depth the page is.
  var here = (document.currentScript && document.currentScript.src) || "";
  var BASE = here.replace(/[^/]*$/, "");

  var TOKEN = /\((op|su|ex|st|ring|skill)\)/g;
  var RING = new RegExp("[\\[(](" + RINGS.join("|") + ")[\\])]", "gi");

  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  function ringIcon(r) {
    var name = cap(r);
    return '<img class="ring-ico" src="' + BASE + "rings/" + r + '.svg"' +
           ' alt="' + name + '" title="' + name + '">';
  }

  function symbols(html) {
    if (html == null) return "";
    return String(html)
      .replace(TOKEN, function (m, k) {
        var g = GLYPH[k];
        return '<span class="sym ' + k + '" title="' + g[1] + '" aria-label="' +
               g[1] + '">' + g[0] + "</span>";
      })
      .replace(RING, function (m, r) { return ringIcon(r.toLowerCase()); });
  }

  window.L5R_SYMBOLS = symbols;
}());
