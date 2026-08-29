/* ============================================================
   admin.js — the coverage ledger.

   The denominator is the compendium itself (window.L5R_CATALOG,
   pulled from the Foundry module by scripts/foundry_catalog.py).
   The numerator is what the built characters actually reference
   (window.L5R_COVERAGE.used, joined at build time in SQLite).

   Nothing here estimates. An entry is either referenced by a
   character or it is not, and the table says which.
   ============================================================ */
(function () {
  "use strict";

  var CAT = window.L5R_CATALOG || [];
  var COV = window.L5R_COVERAGE || {};
  var CHARS = window.L5R_ROSTER || [];
  var USED = COV.used || {};
  var SCHOOLS = COV.schools || [];

  var CHAR_BY_SLUG = {};
  CHARS.forEach(function (c) { CHAR_BY_SLUG[c.slug] = c; });

  var BOOK_LABEL = {
    core_rulebook: "Core Rulebook", emerald_empire: "Emerald Empire",
    shadowlands: "Shadowlands", courts_of_stone: "Courts of Stone",
    court_of_stones: "Courts of Stone", path_of_waves: "Path of Waves",
    celestial_realms: "Celestial Realms", fields_of_victory: "Fields of Victory",
    mask_of_the_oni: "Mask of the Oni", writ_of_the_wanderer: "Writ of the Wanderer",
    wanderers: "Wanderer's Path", game_masters_kit: "Game Master's Kit",
    sins_of_regret: "Sins of Regret", blood_of_the_kami: "Blood of the Kami"
  };

  // Ledger sections, in the order they appear as tabs.
  // School, mastery and title abilities are split out from techniques proper:
  // they come attached to a school or title rather than being bought freely,
  // so mixing them into one total misrepresents both.
  var ABILITY_PACKS = /(school-abilities|mastery-abilities|title-abilities)/;
  var SECTIONS = [
    { key: "schools", label: "Schools" },
    { key: "techniques", label: "Techniques", subs: ["technique"],
      packFilter: function (p) { return !ABILITY_PACKS.test(p); } },
    { key: "abilities", label: "School & Title Abilities", subs: ["technique"],
      packFilter: function (p) { return ABILITY_PACKS.test(p); } },
    { key: "peculiarities", label: "Advantages & Disadvantages", subs: ["peculiarity"] },
    { key: "titles", label: "Titles", subs: ["title"] },
    { key: "gear", label: "Equipment", subs: ["weapon", "armor", "item"] },
    { key: "bonds", label: "Bonds", subs: ["bond"] },
    { key: "other", label: "Other", subs: ["property", "item_pattern", "signature_scroll"] },
    { key: "heritage", label: "Heritages" }
  ];

  var HCOV = window.L5R_HERITAGE_COVERAGE || {};

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function book(b) { return b ? (BOOK_LABEL[b] || b.replace(/_/g, " ")) : "—"; }
  function titleCase(s) {
    return String(s || "").replace(/(^|[\s\-_])([a-z])/g, function (m, a, b) {
      return (a === "_" ? " " : a) + b.toUpperCase();
    });
  }

  /* ---------------------------------------------------------- rows */

  // The schools tab is its own shape: the curriculum pack is the roll of
  // schools, and "used" means a character has been built to it.
  function schoolRows() {
    return SCHOOLS.map(function (s) {
      return {
        uuid: s.uuid, name: s.name, kind: s.clan || "—",
        book: s.source_book, rank: null,
        by: s.slug ? [{ slug: s.slug, xp: null }] : []
      };
    });
  }

  function catalogRows(subs, packFilter) {
    return CAT.filter(function (e) {
      if (subs.indexOf(e.sub_type) < 0) return false;
      return packFilter ? packFilter(e.pack) : true;
    })
      .map(function (e) {
        return {
          uuid: e.uuid, name: e.name,
          kind: e.kind ? titleCase(e.kind) : e.pack_label,
          book: e.source_book, rank: e.rank, ring: e.ring,
          by: USED[e.uuid] || []
        };
      });
  }

  // Question 18 rolls on one of seven heritage tables, so the ledger tracks
  // which entry on which table each character actually took.
  function heritageRows() {
    var rows = [];
    Object.keys(HCOV.tables || {}).forEach(function (key) {
      var t = HCOV.tables[key];
      t.entries.forEach(function (e) {
        var who = (HCOV.used || {})[key + "::" + e.name] || [];
        rows.push({
          uuid: key + "::" + e.name,
          name: e.name,
          kind: t.name,
          rank: e.roll,
          book: (t.source || "").replace(/^l5r5e-0\.4-|\.ttrpg$/g, ""),
          by: who.map(function (w) { return { slug: w.slug, xp: null }; })
        });
      });
    });
    return rows;
  }

  function rowsFor(section) {
    if (section.key === "schools") return schoolRows();
    if (section.key === "heritage") return heritageRows();
    return catalogRows(section.subs, section.packFilter);
  }

  /* ---------------------------------------------------------- state */

  var state = { section: "schools", q: "", book: "", kind: "", status: "all" };

  function currentSection() {
    return SECTIONS.filter(function (s) { return s.key === state.section; })[0];
  }

  function filtered(rows) {
    var term = state.q.trim().toLowerCase();
    return rows.filter(function (r) {
      if (state.book && (r.book || "") !== state.book) return false;
      if (state.kind && r.kind !== state.kind) return false;
      if (state.status === "used" && !r.by.length) return false;
      if (state.status === "unused" && r.by.length) return false;
      if (term && r.name.toLowerCase().indexOf(term) < 0) return false;
      return true;
    });
  }

  /* ---------------------------------------------------------- render */

  function renderTabs() {
    return SECTIONS.map(function (s) {
      var rows = rowsFor(s);
      var used = rows.filter(function (r) { return r.by.length; }).length;
      return '<button class="' + (s.key === state.section ? "active" : "") +
        '" data-section="' + s.key + '">' + esc(s.label) +
        " <span>" + used + "/" + rows.length + "</span></button>";
    }).join("");
  }

  function renderHeadline(rows) {
    var used = rows.filter(function (r) { return r.by.length; }).length;
    var byBook = {};
    rows.forEach(function (r) {
      var b = r.book || "—";
      byBook[b] = byBook[b] || [0, 0];
      byBook[b][1]++;
      if (r.by.length) byBook[b][0]++;
    });
    var tiles = ['<div class="cov"><span class="k">' + esc(currentSection().label) +
      ' covered</span><div class="v">' + used + " <small>/ " + rows.length +
      '</small></div><div class="bar"><i style="width:' +
      (rows.length ? Math.round((used / rows.length) * 100) : 0) + '%"></i></div></div>'];
    Object.keys(byBook).filter(function (b) { return b !== "—"; }).sort(function (a, b) {
      return byBook[b][1] - byBook[a][1];
    }).slice(0, 5).forEach(function (b) {
      var v = byBook[b];
      tiles.push('<div class="cov"><span class="k">' + esc(book(b)) +
        '</span><div class="v">' + v[0] + " <small>/ " + v[1] +
        '</small></div><div class="bar"><i style="width:' +
        Math.round((v[0] / v[1]) * 100) + '%"></i></div></div>');
    });
    return tiles.join("");
  }

  function byCell(r) {
    if (!r.by.length) return '<span class="none">not yet used</span>';
    return r.by.map(function (u) {
      var c = CHAR_BY_SLUG[u.slug];
      var label = c ? c.name : u.slug;
      return '<a href="../characters/' + esc(u.slug) + ".html" +
        (u.xp != null ? "#" + u.xp + "xp" : "") + '">' + esc(label) +
        (u.xp != null ? ' <span class="muted small">' + u.xp + " XP</span>" : "") + "</a>";
    }).join(", ");
  }

  function renderTable(rows) {
    if (!rows.length) return '<p class="muted">Nothing matches those filters.</p>';
    var isSchools = state.section === "schools";
    var isHeritage = state.section === "heritage";
    return '<table class="cov-table"><thead><tr>' +
      "<th></th><th>Name</th><th>" +
      (isSchools ? "Clan" : isHeritage ? "Table" : "Kind") + "</th>" +
      "<th>Source</th><th>First used by</th></tr></thead><tbody>" +
      rows.map(function (r) {
        return '<tr class="' + (r.by.length ? "used" : "") + '">' +
          '<td><span class="dot ' + (r.by.length ? "on" : "off") + '"></span></td>' +
          '<td class="nm">' + esc(r.name) +
          (r.rank ? ' <span class="muted small">' +
            (isHeritage ? "roll " : "Rank ") + esc(r.rank) + "</span>" : "") +
          "</td>" +
          "<td>" + esc(r.kind || "—") + "</td>" +
          "<td>" + esc(book(r.book)) + "</td>" +
          '<td class="by">' + byCell(r) + "</td></tr>";
      }).join("") + "</tbody></table>";
  }

  function fillSelect(sel, values, keep) {
    sel.innerHTML = '<option value="">All</option>' + values.map(function (v) {
      return '<option value="' + esc(v[0]) + '"' + (v[0] === keep ? " selected" : "") +
        ">" + esc(v[1]) + "</option>";
    }).join("");
  }

  function draw() {
    var rows = rowsFor(currentSection());

    var books = {}, kinds = {};
    rows.forEach(function (r) {
      if (r.book) books[r.book] = 1;
      if (r.kind) kinds[r.kind] = 1;
    });
    fillSelect(document.getElementById("f-book"),
      Object.keys(books).sort().map(function (b) { return [b, book(b)]; }), state.book);
    fillSelect(document.getElementById("f-kind"),
      Object.keys(kinds).sort().map(function (k) { return [k, k]; }), state.kind);

    document.getElementById("tabs").innerHTML = renderTabs();
    document.getElementById("headline").innerHTML = renderHeadline(rows);

    var shown = filtered(rows);
    document.getElementById("count").textContent =
      shown.length + " of " + rows.length;
    document.getElementById("table").innerHTML = renderTable(shown);

    Array.prototype.forEach.call(document.querySelectorAll("#tabs button"), function (b) {
      b.addEventListener("click", function () {
        state.section = b.getAttribute("data-section");
        state.book = state.kind = "";
        draw();
        document.getElementById("extras").innerHTML =
          renderHeritageGaps() + renderSchoolGaps() + renderCustoms();
      });
    });
  }

  /* ---------------------------------------------------------- custom + gaps */

  function renderCustoms() {
    var customs = COV.customs || [];
    if (!customs.length) return "";
    var byChar = {};
    customs.forEach(function (c) {
      (byChar[c.slug] = byChar[c.slug] || []).push(c);
    });
    return '<h2 class="section-h"><span class="kanji">外</span>Off-catalog content' +
      '<span class="en">' + customs.length + " entries</span></h2>" +
      '<p class="muted small">Content a character carries that has no compendium entry — ' +
      "bespoke distinctions, campaign items, custom titles. These are authored in the " +
      "character's own source file and count towards nothing in the ledger above.</p>" +
      Object.keys(byChar).sort().map(function (slug) {
        var c = CHAR_BY_SLUG[slug];
        return '<p><strong><a href="../characters/' + esc(slug) + '.html">' +
          esc(c ? c.name : slug) + "</a></strong> — " +
          byChar[slug].map(function (x) { return esc(x.name); }).join(", ") + "</p>";
      }).join("");
  }

  // characters whose Question 18 answer is prose rather than a table entry
  function renderHeritageGaps() {
    var un = HCOV.unmatched || [];
    if (state.section !== "heritage" || !un.length) return "";
    return '<h2 class="section-h"><span class="kanji">問</span>Heritage recorded as prose' +
      '<span class="en">' + un.length + "</span></h2>" +
      '<p class="muted small">These characters answered Question 18 with their own ' +
      "wording rather than naming a table entry, so they cannot be counted against a " +
      "table. Nothing is inferred from the text." + "</p>" +
      un.map(function (u) {
        return '<p><strong><a href="../characters/' + esc(u.slug) + '.html">' +
          esc(u.name) + "</a></strong> — <span class=\"muted\">" + esc(u.text) + "</span></p>";
      }).join("");
  }

  function renderSchoolGaps() {
    var off = CHARS.filter(function (c) {
      if (!c.school) return false;
      return !SCHOOLS.some(function (s) { return s.slug === c.slug; });
    });
    if (!off.length) return "";
    return '<h2 class="section-h"><span class="kanji">欠</span>Schools outside the roll' +
      '<span class="en">' + off.length + "</span></h2>" +
      '<p class="muted small">These characters are built to a school with no entry in the ' +
      "compendium's School Curriculum pack, so they do not count towards the schools total.</p>" +
      off.map(function (c) {
        return '<p><strong><a href="../characters/' + esc(c.slug) + '.html">' +
          esc(c.name) + "</a></strong> — " + esc(c.school) + "</p>";
      }).join("");
  }

  /* ---------------------------------------------------------- init */

  function init() {
    ["q"].forEach(function (id) {
      document.getElementById(id).addEventListener("input", function (e) {
        state.q = e.target.value; draw();
      });
    });
    document.getElementById("f-book").addEventListener("change", function (e) {
      state.book = e.target.value; draw();
    });
    document.getElementById("f-kind").addEventListener("change", function (e) {
      state.kind = e.target.value; draw();
    });
    Array.prototype.forEach.call(document.querySelectorAll("#status button"), function (b) {
      b.addEventListener("click", function () {
        state.status = b.getAttribute("data-status");
        Array.prototype.forEach.call(document.querySelectorAll("#status button"), function (o) {
          o.classList.toggle("active", o === b);
        });
        draw();
      });
    });
    draw();
    document.getElementById("extras").innerHTML =
      renderHeritageGaps() + renderSchoolGaps() + renderCustoms();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
