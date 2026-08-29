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
  window.renderRoster = function (chars, prefix) {
    if (!chars.length) return '<p class="muted">No characters built yet.</p>';
    return chars.map(function (c) {
      // Portrait paths are stored relative to the repo root. The landing page
      // (prefix "characters/") is at the root; the character index is one level
      // down, so it needs "../".
      var imgBase = prefix ? "" : "../";
      var art = c.portrait
        ? '<img src="' + esc(imgBase) + esc(c.portrait) + '" alt="' + esc(c.name) + '">'
        : '<div class="initial">' + esc(c.name.charAt(0)) + "</div>";
      return '<a class="pcard" href="' + esc(prefix) + esc(c.slug) + '.html">' +
        '<div class="frame">' + art +
        '<span class="tiercount">' + c.tier_count +
        (c.tier_count === 1 ? " tier" : " tiers") + "</span></div>" +
        '<span class="nm">' + esc(c.name) + "</span>" +
        '<span class="rl">' + esc(c.school || "—") + "</span>" +
        '<span class="xp">' + esc(c.clan || "") + " · " +
        (c.xp_min === c.xp_max ? c.xp_min : c.xp_min + "–" + c.xp_max) + " XP</span>" +
        (c.campaign ? '<span class="camp">' + esc(c.campaign) + "</span>" : "") +
        "</a>";
    }).join("");
  };
})();
