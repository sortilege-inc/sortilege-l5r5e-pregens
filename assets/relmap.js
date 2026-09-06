/* ============================================================
   relmap.js — the campaign relationship map.

   A campaign at a time, because a relationship map of every character in the
   archive is not a map of anything. Data comes from data/relmap.js, built by
   scripts/relationship_map.py.

   Three kinds of line:
     party      every pair of PCs, because a party has a relationship whether
                anyone has written it down or not. Solid where it has been
                written, dashed where it has not — the dashed ones are the
                point, they are the work still to do.
     knows /    a PC to someone they named while being made: a question 16
     taught by  contact, the question 13 mentor, the question 5 lord.
     serves
     folio      a pair of published pregens. Solid where their own sheets say
                what they think of each other -- the Highwayman's six carry a
                full matrix of it -- and faint where the folios are silent,
                which is NOT work to do: these are somebody else's characters.

   A clan is not a line. Two people being Tortoise says nothing about whether
   they have met, so affiliation is a label on a node and never an edge.
   ============================================================ */
(function () {
  "use strict";

  var DATA = window.L5R_RELMAP || { campaigns: {}, order: [] };
  var PUBLISHED = DATA.published || {};
  var PUB_ORDER = DATA.published_order || [];

  // one lookup over both populations, so nothing else has to know which dict
  // a group came from
  function group(name) { return DATA.campaigns[name] || PUBLISHED[name] || null; }

  /* A product is keyed by its product name -- unique, and stable against a
     campaign of ours sharing a title -- but shown by the party it is played
     as: the Beginner Game's seven folios are the Topaz Championship party. */
  function label(name) {
    var g = group(name);
    return (g && g.label) || name;
  }

  /* Why a pair of pregens has nothing on it. Three different facts, checked
     against the printed sheets, and "nobody has written it" is none of them. */
  function pairsNote(c) {
    if (c.pairs === "printed") {
      return "What they think of each other is printed on their sheets.";
    }
    if (c.pairs === "grid") {
      return "Their sheets carry an empty standing grid for the table to " +
             "fill in, so a faint line is the sheet waiting, not a gap here.";
    }
    if (c.pairs === "none") {
      return "These folios have no relationship section at all, so the faint " +
             "lines are only who sat down together.";
    }
    return "A faint line means the product says nothing about that pair.";
  }
  var GREAT = ["crab", "crane", "dragon", "lion", "phoenix", "scorpion",
               "unicorn", "imperial"];

  var view = { k: 1, tx: 0, ty: 0 };
  var state = { campaign: null, nodes: [], edges: [], selected: null };

  function el(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

  function clanVar(clan) {
    var c = String(clan || "").toLowerCase().replace(/\s*clan$/, "");
    return GREAT.indexOf(c) >= 0 ? "var(--clan-" + c + ")" : "var(--clan-minor)";
  }

  /* ---------------------------------------------------------- layout

     Hand-rolled because the whole site ships no libraries, and at two dozen
     nodes an O(n²) repulsion costs nothing. Seeded off each node's index
     rather than at random, so reopening the page gives the same arrangement —
     a map you have to relearn every visit is not a map you can navigate. */
  function layout(nodes, edges, w, h) {
    var i, j, n = nodes.length;
    if (!n) return;
    var pcs = nodes.filter(function (d) { return d.kind === "pc"; }).length || 1;
    nodes.forEach(function (d, idx) {
      // PCs on an inner ring, their people outside it: the shape of the thing
      // before any force is applied, so the solver only has to tidy it.
      var isPc = d.kind === "pc";
      var order = isPc ? idx : idx - pcs;
      var count = isPc ? pcs : Math.max(1, n - pcs);
      var a = (order / count) * Math.PI * 2 + (isPc ? 0 : 0.35);
      var r = isPc ? Math.min(w, h) * 0.17 : Math.min(w, h) * 0.40;
      d.x = w / 2 + Math.cos(a) * r;
      d.y = h / 2 + Math.sin(a) * r;
      d.vx = d.vy = 0;
    });

    var byId = {};
    nodes.forEach(function (d) { byId[d.id] = d; });
    var links = edges.map(function (e) {
      return { s: byId[e.a], t: byId[e.b], kind: e.kind };
    }).filter(function (l) { return l.s && l.t; });

    for (var step = 0; step < 500; step++) {
      var cool = 1 - step / 500;
      for (i = 0; i < n; i++) {
        for (j = i + 1; j < n; j++) {
          var a = nodes[i], b = nodes[j];
          var dx = b.x - a.x, dy = b.y - a.y;
          var d2 = dx * dx + dy * dy || 0.01;
          var d = Math.sqrt(d2);
          var push = 26000 / d2;
          if (push > 40) push = 40;
          var ux = dx / d, uy = dy / d;
          a.vx -= ux * push; a.vy -= uy * push;
          b.vx += ux * push; b.vy += uy * push;
        }
      }
      links.forEach(function (l) {
        // A party line is short so the PCs sit together in the middle; a line
        // out to someone they know is long so the spokes read as spokes.
        var rest = l.kind === "party" ? 150 : 115;
        var dx = l.t.x - l.s.x, dy = l.t.y - l.s.y;
        var d = Math.sqrt(dx * dx + dy * dy) || 0.01;
        var f = (d - rest) * (l.kind === "party" ? 0.012 : 0.05);
        var ux = dx / d * f, uy = dy / d * f;
        l.s.vx += ux; l.s.vy += uy;
        l.t.vx -= ux; l.t.vy -= uy;
      });
      nodes.forEach(function (d) {
        d.vx += (w / 2 - d.x) * 0.004;
        d.vy += (h / 2 - d.y) * 0.004;
        d.x += Math.max(-30, Math.min(30, d.vx * cool));
        d.y += Math.max(-30, Math.min(30, d.vy * cool));
        d.vx *= 0.55; d.vy *= 0.55;
      });
    }
  }

  /* ---------------------------------------------------------- render */

  var SVGNS = "http://www.w3.org/2000/svg";
  function mk(tag, attrs) {
    var n = document.createElementNS(SVGNS, tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }

  function draw() {
    var svg = el("map");
    svg.innerHTML = "";
    var g = mk("g", { id: "camera" });
    svg.appendChild(g);

    var byId = {};
    state.nodes.forEach(function (d) { byId[d.id] = d; });

    var lines = mk("g", { class: "rm-edges" });
    g.appendChild(lines);
    state.edges.forEach(function (e, i) {
      var s = byId[e.a], t = byId[e.b];
      if (!s || !t) return;
      var cls = "rm-edge rm-" + e.kind.replace(/\s+/g, "-") +
                (e.defined ? "" : " rm-undefined");
      if (state.selected && e.a !== state.selected && e.b !== state.selected) {
        cls += " rm-dim";
      }
      var caption = s.name + " & " + t.name + " — " +
        (e.text ? e.text
                : e.kind === "party" ? "not written yet"
                : e.kind === "folio" ? "their folios do not say"
                : e.kind);

      /* A drawn line is one or two pixels wide, which is fine to look at and
         impossible to hover. So each edge is two lines: a fat transparent one
         that takes the pointer, and the visible one drawn over it with
         `pointer-events:none` so it never steals the hover.

         The hit line comes FIRST in document order on purpose — that is what
         lets `.rm-hit:hover + .rm-edge` light the visible line. Appending it
         second reads more naturally and there is no selector for it. */
      var hit = mk("line", { x1: s.x, y1: s.y, x2: t.x, y2: t.y,
                             class: "rm-hit" });
      var ht = mk("title");
      ht.textContent = caption;
      hit.appendChild(ht);
      /* The activation hangs on the element rather than on a `click`
         listener. A line is a hairline: press and release land a pixel apart
         often enough, and a `click` whose mousedown and mouseup have different
         targets is retargeted to their common ancestor -- the canvas. So every
         line on this map was unclickable and unhoverable, in every campaign,
         while driving the handler from script looked fine. The pointerdown /
         pointerup pair in init() calls this. */
      hit.__activate = function () { showEdge(e, s, t); };

      var ln = mk("line", { x1: s.x, y1: s.y, x2: t.x, y2: t.y, class: cls,
                            "data-i": i });
      lines.appendChild(hit);
      lines.appendChild(ln);
    });

    var dots = mk("g", { class: "rm-nodes" });
    g.appendChild(dots);
    state.nodes.forEach(function (d) {
      var isPc = d.kind === "pc";
      var r = isPc ? 15 : 8;
      var near = !state.selected || d.id === state.selected ||
        state.edges.some(function (e) {
          return (e.a === state.selected && e.b === d.id) ||
                 (e.b === state.selected && e.a === d.id);
        });
      var grp = mk("g", { class: "rm-node" + (near ? "" : " rm-dim") +
                                 (d.id === state.selected ? " rm-sel" : ""),
                          transform: "translate(" + d.x + "," + d.y + ")" });
      grp.appendChild(mk("circle", { r: r, class: isPc ? "rm-pc" : "rm-npc",
                                     fill: isPc ? clanVar(d.clan) : "var(--paper-3)" }));
      /* Names only, and cut short even so. The map showed nothing but names
         and still went unreadable once, because a hand-written relationship
         line parsed into an "NPC" called `Miramoto Shinzka: Is betrothed.
         Raised in the Asahina Envoy school…` and that became the label. The
         parser is fixed; this is the belt as well as the braces. */
      var label = mk("text", { class: isPc ? "rm-label rm-label-pc" : "rm-label",
                               y: isPc ? r + 15 : r + 12 });
      label.textContent = d.name.length > 28 ? d.name.slice(0, 27) + "…" : d.name;
      grp.appendChild(label);

      // What the relationship actually is belongs on hover and on click, not
      // on the canvas: forty lines of it at once is not a map of anything.
      var tip = mk("title");
      tip.textContent = d.name +
        (d.affiliation ? " (" + d.affiliation + ")" : "") +
        (isPc ? " — " + [d.clan, d.school].filter(Boolean).join(", ")
              : (d.named_by || []).length
                  ? " — named by " + d.named_by.join(", ") : "");
      grp.appendChild(tip);
      grp.__activate = function () {
        state.selected = state.selected === d.id ? null : d.id;
        draw(); showNode(d);
      };
      dots.appendChild(grp);
    });

    applyView();
  }

  function applyView() {
    var g = el("camera");
    if (g) {
      g.setAttribute("transform", "translate(" + view.tx + "," + view.ty +
                                  ") scale(" + view.k + ")");
    }
    var z = el("zoomlevel");
    if (z) z.textContent = Math.round(view.k * 100) + "%";
  }

  /* ---------------------------------------------------------- details */

  function showNode(d) {
    var p = el("detail");
    if (d.kind === "pc") {
      var mine = state.edges.filter(function (e) {
        return e.a === d.id || e.b === d.id;
      });
      var byId = {};
      state.nodes.forEach(function (x) { byId[x.id] = x; });
      var party = mine.filter(function (e) { return e.kind === "party"; });
      p.innerHTML =
        '<p class="rm-eyebrow">Player character</p>' +
        "<h2>" + esc(d.name) + "</h2>" +
        '<p class="rm-sub">' +
          esc([d.clan, d.family, d.school, d.role].filter(Boolean).join(" · ")) +
        "</p>" +
        (d.connection
          ? '<p class="rm-quote">' + esc(d.connection) + "</p>" : "") +
        // Why this character has no lines out to anybody. Two different
        // states, and neither is "they know nobody".
        (d.kind === "pc" && !d.named && d.asked === false
          ? '<p class="rm-todo">Questions 5, 13 and 16 — their lord, who ' +
            "taught them, who they know — are unanswered on this character, " +
            "so there is nobody to draw. Open their page and answer them and " +
            "they will appear here.</p>"
          : "") +
        (d.kind === "pc" && !d.named && d.asked && d.unread
          ? '<p class="rm-todo">' + plural(d.unread, "line", "lines") +
            " here name somebody in prose rather than at the start of the " +
            "line, so the map does not guess at them. Rewriting one as " +
            "<em>Name (Clan) — what it is</em> puts them on the map.</p>"
          : "") +
        '<p><a class="rm-link" href="' + esc(d.slug) + '.html">Open their page →</a></p>' +
        '<p class="rm-eyebrow">In the party with</p><ul class="rm-list">' +
        party.map(function (e) {
          var other = byId[e.a === d.id ? e.b : e.a];
          return "<li><strong>" + esc(other ? other.name : "?") + "</strong>" +
            (e.defined ? " — " + esc(e.text)
                       : ' <em class="rm-todo">not written yet</em>') + "</li>";
        }).join("") + "</ul>" +
        '<p class="rm-eyebrow">People they named</p><ul class="rm-list">' +
        (mine.filter(function (e) { return e.kind !== "party"; }).map(function (e) {
          var other = byId[e.a === d.id ? e.b : e.a];
          return "<li><strong>" + esc(other ? other.name : "?") + "</strong> <span " +
            'class="rm-kind">' + esc(e.kind) + "</span>" +
            (e.text ? " — " + esc(e.text) : "") + "</li>";
        }).join("") || '<li class="rm-todo">nobody yet</li>') + "</ul>";
    } else {
      p.innerHTML =
        '<p class="rm-eyebrow">Created in character creation</p>' +
        "<h2>" + esc(d.name) + "</h2>" +
        (d.affiliation ? '<p class="rm-sub">' + esc(d.affiliation) + "</p>" : "") +
        '<p class="rm-eyebrow">Named by</p><ul class="rm-list">' +
        (d.named_by || []).map(function (n) { return "<li>" + esc(n) + "</li>"; }).join("") +
        "</ul>" +
        state.edges.filter(function (e) {
          return (e.a === d.id || e.b === d.id) && e.text;
        }).map(function (e) {
          return '<p class="rm-quote">' + esc(e.text) + "</p>";
        }).join("");
    }
  }

  function showEdge(e, s, t) {
    var pub = (group(state.campaign) || {}).published;
    var kindLabel = e.kind === "party" ? "In the party together"
              : e.kind === "folio" ? "On the same printed folio"
              // on a folio this is not what the character worked out, it is
              // what their handout told them before play began
              : e.kind === "knows" ? (pub ? "What their handout told them"
                                          : "Knows")
              : e.kind === "taught by" ? "Taught by"
              : e.kind === "serves" ? "Serves"
              : e.kind;
    // Nothing is owed on a published pair: the folios either say or they do
    // not, and either way it is not this archive's decision to make.
    var empty = e.kind === "folio"
      ? '<p class="rm-sub">Neither folio says anything about the other. ' +
        pairsNote(group(state.campaign) || {}) + "</p>"
      : '<p class="rm-todo">This pair has no relationship written yet. ' +
        "Every pair of characters in a party has one; this is where you " +
        "would decide what it is.</p>";
    el("detail").innerHTML =
      '<p class="rm-eyebrow">' + esc(kindLabel) +
      "</p><h2>" + esc(s.name) + " &amp; " + esc(t.name) + "</h2>" +
      (e.text ? '<p class="rm-quote">' + esc(e.text) + "</p>" : empty);
  }

  /* ---------------------------------------------------------- shell */

  /* The canvas gets its height from the stylesheet, so at DOMContentLoaded it
     can measure about two pixels wide — and `box.width || 900` does not catch
     that, because two is truthy. Laying out against it put every node within a
     pixel of the centre and fitted the camera to scale 0.002: a blank page.
     Nothing is measured until the box is real. */
  var MIN_BOX = 120;
  function canvasSize() {
    var box = el("map").getBoundingClientRect();
    return { w: box.width >= MIN_BOX ? box.width : 900,
             h: box.height >= MIN_BOX ? box.height : 620,
             real: box.width >= MIN_BOX && box.height >= MIN_BOX };
  }
  function whenSized(cb) {
    var tries = 0;
    (function poll() {
      if (canvasSize().real || tries++ > 90) return cb();
      requestAnimationFrame(poll);
    })();
  }

  function fit() {
    var size = canvasSize();
    var w = size.w, h = size.h;
    if (!state.nodes.length) return;
    var xs = state.nodes.map(function (d) { return d.x; });
    var ys = state.nodes.map(function (d) { return d.y; });
    var pad = 70;
    var minx = Math.min.apply(null, xs) - pad, maxx = Math.max.apply(null, xs) + pad;
    var miny = Math.min.apply(null, ys) - pad, maxy = Math.max.apply(null, ys) + pad;
    view.k = Math.min(w / (maxx - minx), h / (maxy - miny), 1.6);
    view.tx = (w - (maxx + minx) * view.k) / 2;
    view.ty = (h - (maxy + miny) * view.k) / 2;
    applyView();
  }

  function load(name) {
    var c = group(name);
    if (!c) return;
    state.campaign = name;
    state.nodes = JSON.parse(JSON.stringify(c.nodes));
    state.edges = c.edges;
    state.selected = null;
    var size = canvasSize();
    layout(state.nodes, state.edges, size.w, size.h);
    draw();
    fit();

    if (c.published) {
      // A shipped party. Its pairs are described or not by the product, so
      // there is no worklist here and the summary does not imply one.
      var folio = state.edges.filter(function (e) { return e.kind === "folio"; });
      var said = folio.filter(function (e) { return e.defined; }).length;
      var knows = state.edges.filter(function (e) { return e.kind === "knows"; });
      el("summary").innerHTML =
        plural(c.pcs, "pregen", "pregens") + " · " +
        (folio.length
          ? said + " of " + folio.length + " pairs described on the folios"
          : "a single folio") +
        (c.npcs ? " · " + plural(c.npcs, "guest they were told about",
                                 "guests they were told about") : "") +
        (c.publisher ? " · " + esc(c.publisher) +
                       (c.year ? " " + c.year : "") : "");
      el("detail").innerHTML =
        '<p class="rm-eyebrow">Published pregens</p><h2>' + esc(label(name)) +
        "</h2>" +
        (c.adventure && c.adventure !== label(name)
          ? "<p>The folios that ship with " + esc(c.adventure) + ".</p>" : "") +
        '<p class="rm-sub">Somebody else\u2019s characters, transcribed. ' +
        pairsNote(c) + "</p>" +
        (knows.length
          ? '<p class="rm-sub">The lines out to the guests are what each folio ' +
            "was privately told about them — four of these characters were " +
            "handed different things about the same person.</p>"
          : "");
      return;
    }

    var party = state.edges.filter(function (e) { return e.kind === "party"; });
    var undef = party.filter(function (e) { return !e.defined; }).length;
    el("summary").innerHTML =
      plural(c.pcs, "character", "characters") + " · " +
      plural(c.npcs, "person they named", "people they named") +
      (party.length
        ? " · " + plural(party.length, "pair", "pairs") + " in the party, " +
          (undef ? '<strong class="rm-todo">' + undef + " not yet written</strong>"
                 : "all written")
        : " · nobody else in the campaign yet") +
      /* An empty map and an unasked party look identical, and that is how
         five promoted characters could sit here naming nobody without it
         being visible. */
      (c.unasked
        ? ' · <strong class="rm-todo">' + c.unasked + " of " + c.pcs +
          " not yet asked who they know</strong>"
        : "");
    el("detail").innerHTML =
      '<p class="rm-eyebrow">' + esc(name) + "</p>" +
      "<p>Click a character, a person, or a line between them.</p>" +
      '<p class="rm-sub">A dashed line is a pair whose relationship nobody has ' +
      "decided yet.</p>";
  }

  function init() {
    var pick = el("campaign");
    function opts(names) {
      return names.map(function (n) {
        return '<option value="' + esc(n) + '">' + esc(label(n)) +
          " (" + group(n).pcs + ")</option>";
      }).join("");
    }
    /* Two optgroups rather than one list, because a product is not one of our
       campaigns -- and because two of them share a name with one ("Wedding at
       Kyotei Castle" is both a product and a pack of our own), which a single
       flat list would silently collapse. */
    pick.innerHTML =
      (PUB_ORDER.length
        ? '<optgroup label="Campaigns">' + opts(DATA.order) + "</optgroup>" +
          '<optgroup label="Published pregens">' + opts(PUB_ORDER) + "</optgroup>"
        : opts(DATA.order));
    var first = DATA.order.indexOf("Slow Tide Harbor") >= 0
      ? "Slow Tide Harbor" : DATA.order[0];
    pick.value = first;
    pick.addEventListener("change", function () { load(pick.value); });

    var svg = el("map");
    svg.addEventListener("wheel", function (ev) {
      ev.preventDefault();
      var box = svg.getBoundingClientRect();
      var mx = ev.clientX - box.left, my = ev.clientY - box.top;
      var f = Math.exp(-ev.deltaY * 0.0016);
      var k = Math.max(0.25, Math.min(5, view.k * f));
      // keep whatever is under the cursor under the cursor
      view.tx = mx - (mx - view.tx) * (k / view.k);
      view.ty = my - (my - view.ty) * (k / view.k);
      view.k = k;
      applyView();
    }, { passive: false });

    var drag = null;
    svg.addEventListener("pointerdown", function (ev) {
      drag = { x: ev.clientX, y: ev.clientY, tx: view.tx, ty: view.ty };
      svg.setPointerCapture(ev.pointerId);
      svg.classList.add("rm-grabbing");
    });
    svg.addEventListener("pointermove", function (ev) {
      if (!drag) return;
      view.tx = drag.tx + (ev.clientX - drag.x);
      view.ty = drag.ty + (ev.clientY - drag.y);
      applyView();
    });
    ["pointerup", "pointercancel"].forEach(function (t) {
      svg.addEventListener(t, function () { drag = null; svg.classList.remove("rm-grabbing"); });
    });
    /* Click versus pan, decided by how far the pointer moved rather than by
       what the browser chose to call the click's target. Under the threshold
       and over a line or a node, that is a click on it; under the threshold
       over nothing, a deselect; over the threshold, the pan already happened
       and nothing else should. */
    var CLICK_SLOP = 5;
    var press = null;
    svg.addEventListener("pointerdown", function (ev) {
      var el2 = ev.target && ev.target.closest
        ? ev.target.closest(".rm-hit, .rm-node") : null;
      press = { x: ev.clientX, y: ev.clientY, el: el2 };
    });
    svg.addEventListener("pointerup", function (ev) {
      if (!press) return;
      var moved = Math.hypot(ev.clientX - press.x, ev.clientY - press.y);
      var target = press.el;
      press = null;
      if (moved > CLICK_SLOP) return;
      /* A hairline is easy to press and miss by a pixel, so if the press
         landed on nothing, look again at where the pointer actually is. */
      if (!target) {
        var under = document.elementFromPoint(ev.clientX, ev.clientY);
        target = under && under.closest ? under.closest(".rm-hit, .rm-node") : null;
      }
      if (target && typeof target.__activate === "function") {
        target.__activate();
        return;
      }
      if (state.selected) { state.selected = null; draw(); }
    });

    el("zin").addEventListener("click", function () {
      view.k = Math.min(5, view.k * 1.3); applyView();
    });
    el("zout").addEventListener("click", function () {
      view.k = Math.max(0.25, view.k / 1.3); applyView();
    });
    el("zfit").addEventListener("click", fit);
    window.addEventListener("resize", fit);
    // The canvas can also gain its size after load — a web font arriving, or
    // the pane being resized — so re-fit when it actually changes rather than
    // only on a window resize.
    if (window.ResizeObserver) {
      var last = 0;
      new ResizeObserver(function () {
        var w = el("map").getBoundingClientRect().width;
        if (Math.abs(w - last) > 8) { last = w; fit(); }
      }).observe(el("map"));
    }

    /* The first draw waits for a real box, and that wait can be long: opened
       in a hidden pane, `whenSized` polls until the pane is shown. Two things
       can happen in the meantime -- the reader picks a campaign, or the
       browser restores the one they had picked before a reload -- and firing
       `first` then would throw their choice away. So this loads whatever the
       picker says by then, and only if nothing is loaded yet. */
    whenSized(function () {
      if (!state.campaign) load(group(pick.value) ? pick.value : first);
    });
  }

  // window.load rather than DOMContentLoaded: the layout needs the stylesheet
  // to have applied, and this page's whole content is one measured box.
  if (document.readyState === "complete") { init(); }
  else { window.addEventListener("load", init); }
})();
