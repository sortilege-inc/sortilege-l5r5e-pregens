/* roster.js — the character card grid, shared by the landing page and the
   character index. Kept out of the pages so both render identically.
   Reads data/roster.js (window.L5R_ROSTER) — card fields only, no tier data. */
(function () {
  "use strict";
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  /* `opts.actions` puts Edit, +XP and Legacy at the foot of every card.

     Those three used to be a "Promoted characters" list in the Creator's
     drafts panel, which is the wrong place twice over: that panel is for work
     in progress, and someone who wants to do something with a finished
     character starts from the character, not from a wizard's sidebar. So they
     sit under the card they belong to. The landing page leaves them off — it
     is a shop window, not a workbench. */
  window.renderRoster = function (chars, prefix, opts) {
    if (!chars.length) return '<p class="muted">No characters built yet.</p>';
    var actions = !!(opts && opts.actions);
    // Portrait paths are stored relative to the repo root, and the Creator is
    // a sibling of characters/. The landing page (prefix "characters/") is at
    // the root; the character index is one level down, so it needs "../".
    var imgBase = prefix ? "" : "../";
    var creator = (prefix ? "" : "../") + "creator/index.html?";
    return chars.map(function (c) {
      var art = c.portrait
        ? '<img src="' + esc(imgBase) + esc(c.portrait) + '" alt="' + esc(c.name) + '">'
        : '<div class="initial">' + esc(c.name.charAt(0)) + "</div>";
      function act(kind, label, title) {
        return '<a class="pc-act" title="' + esc(title) + '" href="' +
          esc(creator + kind + "=" + encodeURIComponent(c.slug)) + '">' +
          label + "</a>";
      }
      return '<div class="pcard">' +
        '<a class="pc-open" href="' + esc(prefix) + esc(c.slug) + '.html">' +
        '<div class="frame">' + art +
        '<span class="tiercount">' + c.tier_count +
        (c.tier_count === 1 ? " tier" : " tiers") + "</span></div>" +
        '<span class="nm">' + esc(c.name) + "</span>" +
        '<span class="rl">' + esc(c.school || "—") + "</span>" +
        // a ronin has no clan; the region answers the same question
        '<span class="xp">' +
        esc(c.clan || String(c.region || "").replace(/ Region$/, "")) + " · " +
        (c.xp_min === c.xp_max ? c.xp_min : c.xp_min + "–" + c.xp_max) + " XP</span>" +
        (c.campaign ? '<span class="camp">' + esc(c.campaign) + "</span>" : "") +
        "</a>" +
        (actions
          ? '<div class="pc-actions">' +
            act("edit", "Edit", "Change " + c.name + " — landed against the " +
                "record, not exported as a new one") +
            act("advance", "+XP", "Spend experience: adds a tier rather than " +
                "changing the one that is there") +
            act("legacy", "Legacy", "Leave a Legacy for a successor to take " +
                "instead of a heritage result") +
            "</div>"
          : "") +
        "</div>";
    }).join("");
  };
})();
