/* The Audit section: one subsection per source book, each carrying the measured
   numbers and the written assessment of what they mean.

   Everything here is read-only reporting. A rate is never rendered without the
   denominator it came from, and "unjudgeable" is always shown beside "verbatim"
   so a good-looking percentage cannot hide how little of the book it covers. */
(function () {
  "use strict";
  var D = window.L5R_AUDIT || { sources: [], orphan_books: [] };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function pct(n, d) { return d ? Math.round((100 * n) / d) + "%" : "—"; }

  // Confidence is about the assessment, not the corpus, so it gets its own scale.
  function confClass(c) {
    var s = (c || "").toLowerCase();
    if (s.indexOf("none") === 0) return "conf-none";
    if (s.indexOf("high") === 0 || s.indexOf("moderate to high") === 0) return "conf-high";
    if (s.indexOf("low to moderate") === 0 || s.indexOf("low") === 0) return "conf-low";
    return "conf-mid";
  }

  /* A book with almost nothing to measure should not look like a book that was
     measured and passed, so the band is driven by sample size first. */
  function band(s) {
    if (!s.judged) return ["unmeasured", "Not measured"];
    if (s.judged < 30) return ["unmeasured", "Sample too small"];
    var v = (100 * s.verbatim) / s.judged;
    if (v >= 80) return ["good", "Mostly verbatim"];
    if (v >= 45) return ["mixed", "Mixed"];
    return ["poor", "Largely reworded"];
  }

  function summary() {
    var t = el("table", "audittable");
    t.innerHTML =
      "<thead><tr><th>Source</th><th>Files</th><th>Entities</th>" +
      "<th>Verbatim</th><th>Unjudgeable</th><th>Compendium</th><th></th></tr></thead>";
    var tb = el("tbody");
    D.sources.forEach(function (s) {
      var total = s.verbatim + s.drift + s.unjudgeable;
      var b = band(s);
      var tr = el("tr");
      tr.innerHTML =
        '<td><a href="#' + esc(s.key) + '">' + esc(s.title) + "</a></td>" +
        "<td>" + s.corpus_files.length + "</td>" +
        "<td>" + s.entities + "</td>" +
        "<td>" + (s.judged ? pct(s.verbatim, s.judged) +
          ' <span class="muted small">of ' + s.judged + "</span>" : "—") + "</td>" +
        "<td>" + (total ? pct(s.unjudgeable, total) : "—") + "</td>" +
        "<td>" + (s.catalog_entries
          ? s.catalog_resolved + "/" + s.catalog_entries
          : '<span class="muted">not listed</span>') + "</td>" +
        '<td><span class="aband ' + b[0] + '">' + b[1] + "</span></td>";
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    // the table is wider than a phone; it scrolls inside its own box so the
    // page body never scrolls sideways
    var scroller = el("div", "ascroll");
    scroller.appendChild(t);
    document.getElementById("summary").appendChild(scroller);
  }

  function assessment(label, a) {
    return '<div class="assess">' +
      '<div class="assess-h">' + esc(label) +
      '<span class="conf ' + confClass(a.confidence) + '">Confidence: ' +
      esc(a.confidence) + "</span></div>" +
      "<p class=\"assess-v\">" + esc(a.verdict) + "</p>" +
      "<p class=\"assess-b\">" + esc(a.basis) + "</p>" +
      "</div>";
  }

  function section(s) {
    var total = s.verbatim + s.drift + s.unjudgeable;
    var n = el("section", "panel asource");
    n.id = s.key;
    var b = band(s);

    var head = '<h2>' + esc(s.title) +
      ' <span class="aband ' + b[0] + '">' + b[1] + "</span></h2>";

    var facts = '<div class="afacts">' +
      fact(s.entities, "entities") +
      fact(total, "rules strings") +
      fact(s.judged ? pct(s.verbatim, s.judged) : "—", "verbatim, of " + s.judged + " judgeable") +
      fact(s.unjudgeable, "unjudgeable (symbols)") +
      fact(s.catalog_entries ? s.catalog_resolved + " / " + s.catalog_entries : "—",
           "compendium entries with a rule") +
      "</div>";

    var files = '<p class="afiles"><span class="muted small">Corpus files: </span>' +
      s.corpus_files.map(function (f) { return "<code>" + esc(f) + "</code>"; }).join(" ") +
      (s.has_text ? "" : ' <strong>— no source text available</strong>') + "</p>";

    // The character of the drift is the useful part: a string that tracks the
    // book's sentence and stops early is a different problem from one whose
    // wording appears nowhere in the book.
    var drift = "";
    if (s.drift) {
      drift = '<div class="adrift"><h3>Where the ' + s.drift + " drifting strings sit</h3>" +
        "<ul>" +
        "<li><strong>" + s.drift_tracks + "</strong> track the book's own sentence for 60+ characters, then diverge — compression, or a dropped cross-reference.</li>" +
        "<li><strong>" + s.drift_partial + "</strong> share a shorter run.</li>" +
        "<li><strong>" + s.drift_novel + "</strong> share almost nothing: wording the book does not print anywhere.</li>" +
        "</ul></div>";
    }

    var ex = "";
    if (s.drift_examples && s.drift_examples.length) {
      ex = '<details class="aex"><summary>Examples of drifting text (' +
        s.drift_examples.length + " of " + s.drift + ")</summary><ul>" +
        s.drift_examples.map(function (e) {
          return "<li><code>" + esc(e.file) + "</code> " + esc(e.text.slice(0, 260)) +
            (e.text.length > 260 ? "…" : "") + "</li>";
        }).join("") + "</ul></details>";
    }

    var absent = "";
    if (s.names_absent_n) {
      absent = '<details class="aex"><summary>' + s.names_absent_n +
        " entity names not found in this book's text</summary>" +
        '<p class="muted small">Mostly names the converter coined for its own filing. ' +
        "Treat as a lead, not a defect count.</p><ul>" +
        s.names_absent.map(function (a) {
          return "<li><code>" + esc(a.file) + "</code> " + esc(a.name) + "</li>";
        }).join("") + "</ul></details>";
    }

    // what this pass actually changed, so a reader can tell a live number from
    // one that was already acted on
    var fixed = "";
    if (s.notes.fixed && s.notes.fixed.length) {
      fixed = '<div class="afixed"><h3>Corrected in this pass</h3><ul>' +
        s.notes.fixed.map(function (f) { return "<li>" + esc(f) + "</li>"; }).join("") +
        "</ul></div>";
    }

    n.innerHTML = head + facts + files +
      assessment("Completeness", s.notes.completeness) +
      assessment("Correctness", s.notes.correctness) +
      fixed + drift + ex + absent +
      '<p class="anext"><strong>What would settle it: </strong>' + esc(s.notes.next) + "</p>";
    return n;
  }

  function fact(v, label) {
    return '<div class="afact"><div class="afact-v">' + esc(v) +
      '</div><div class="afact-l">' + esc(label) + "</div></div>";
  }

  function orphans() {
    var n = document.getElementById("orphans");
    if (!D.orphan_books || !D.orphan_books.length) { n.remove(); return; }
    n.innerHTML = "<h2>Books the compendium knows and the corpus does not</h2>" +
      "<p>These source books appear on compendium entries but have no corpus file at all, " +
      "so nothing in the corpus carries their rules.</p><ul>" +
      D.orphan_books.map(function (o) {
        return "<li><strong>" + esc(o[0]) + "</strong> — " + o[1] + " compendium entries, 0 in the corpus</li>";
      }).join("") + "</ul>";
  }

  summary();
  var host = document.getElementById("sources");
  D.sources.forEach(function (s) { host.appendChild(section(s)); });
  orphans();
})();
