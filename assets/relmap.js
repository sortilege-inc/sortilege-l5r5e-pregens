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

   A clan is not a line. Two people being Tortoise says nothing about whether
   they have met, so affiliation is a label on a node and never an edge.
   ============================================================ */
(function () {
  "use strict";

  var DATA = window.L5R_RELMAP || { campaigns: {}, order: [] };
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
        (e.text ? e.text : e.kind === "party" ? "not written yet" : e.kind);

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
      hit.addEventListener("click", function (ev) {
        ev.stopPropagation(); showEdge(e, s, t);
      });

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
      grp.addEventListener("click", function (ev) {
        ev.stopPropagation();
        state.selected = state.selected === d.id ? null : d.id;
        draw(); showNode(d);
      });
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
    el("detail").innerHTML =
      '<p class="rm-eyebrow">' + esc(e.kind === "party" ? "In the party together" : e.kind) +
      "</p><h2>" + esc(s.name) + " &amp; " + esc(t.name) + "</h2>" +
      (e.text ? '<p class="rm-quote">' + esc(e.text) + "</p>"
              : '<p class="rm-todo">This pair has no relationship written yet. ' +
                "Every pair of characters in a party has one; this is where you " +
                "would decide what it is.</p>");
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
    var c = DATA.campaigns[name];
    if (!c) return;
    state.campaign = name;
    state.nodes = JSON.parse(JSON.stringify(c.nodes));
    state.edges = c.edges;
    state.selected = null;
    var size = canvasSize();
    layout(state.nodes, state.edges, size.w, size.h);
    draw();
    fit();
    var party = state.edges.filter(function (e) { return e.kind === "party"; });
    var undef = party.filter(function (e) { return !e.defined; }).length;
    function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }
    el("summary").innerHTML =
      plural(c.pcs, "character", "characters") + " · " +
      plural(c.npcs, "person they named", "people they named") +
      (party.length
        ? " · " + plural(party.length, "pair", "pairs") + " in the party, " +
          (undef ? '<strong class="rm-todo">' + undef + " not yet written</strong>"
                 : "all written")
        : " · nobody else in the campaign yet");
    el("detail").innerHTML =
      '<p class="rm-eyebrow">' + esc(name) + "</p>" +
      "<p>Click a character, a person, or a line between them.</p>" +
      '<p class="rm-sub">A dashed line is a pair whose relationship nobody has ' +
      "decided yet.</p>";
  }

  function init() {
    var pick = el("campaign");
    pick.innerHTML = DATA.order.map(function (n) {
      return '<option value="' + esc(n) + '">' + esc(n) +
        " (" + DATA.campaigns[n].pcs + ")</option>";
    }).join("");
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
    svg.addEventListener("click", function () {
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

    whenSized(function () { load(first); });
  }

  // window.load rather than DOMContentLoaded: the layout needs the stylesheet
  // to have applied, and this page's whole content is one measured box.
  if (document.readyState === "complete") { init(); }
  else { window.addEventListener("load", init); }
})();
