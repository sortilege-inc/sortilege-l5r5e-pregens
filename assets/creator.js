/* ============================================================
   creator.js — the L5R5e Game of Twenty Questions, as a wizard.

   The step list, the flow, and the AI prompts follow
   titterpig-dashboard-web (src/systems/l5r5e/chargen.js,
   src/components/tp-chargen-wizard.js, src/lib/ai.js) so the two
   surfaces ask the same questions in the same order.

   What differs is the output: this one emits a character in *this*
   repo's source format — src/characters/<slug>.json — so a character
   made here drops straight into the archive and is built by
   scripts/build.py like any other.

   Data:
     data/chargen/*.js   clans, families, schools, heritages (mechanics)
     data/catalog.js     the compendium — peculiarities, items, techniques
   Rules text is never authored here; the build resolves names to the
   compendium's own verbatim description.
   ============================================================ */
(function () {
  "use strict";

  var LS_DRAFT = "sortilege.l5r.creator.draft";      // legacy single draft
  var LS_DRAFTS = "sortilege.l5r.creator.drafts";    // { activeId, drafts: {} }
  var LS_KEY = "sortilege.l5r.creator.apiKey";
  var MODEL = "claude-haiku-4-5-20251001";

  var RINGS = ["air", "earth", "fire", "water", "void"];
  var SKILL_GROUPS = {
    artisan: ["aesthetics", "composition", "design", "smithing"],
    martial: ["fitness", "melee", "ranged", "unarmed", "meditation", "tactics"],
    scholar: ["culture", "government", "medicine", "sentiment", "theology"],
    social: ["command", "courtesy", "games", "performance"],
    trade: ["commerce", "labor", "seafaring", "skulduggery", "survival"]
  };
  var SKILL_LABEL = {
    aesthetics: "Aesthetics", composition: "Composition", design: "Design",
    smithing: "Smithing", fitness: "Fitness", melee: "Martial Arts [Melee]",
    ranged: "Martial Arts [Ranged]", unarmed: "Martial Arts [Unarmed]",
    meditation: "Meditation", tactics: "Tactics", culture: "Culture",
    government: "Government", medicine: "Medicine", sentiment: "Sentiment",
    theology: "Theology", command: "Command", courtesy: "Courtesy",
    games: "Games", performance: "Performance", commerce: "Commerce",
    labor: "Labor", seafaring: "Seafaring", skulduggery: "Skulduggery",
    survival: "Survival"
  };
  var SKILL_BY_LABEL = {};
  Object.keys(SKILL_LABEL).forEach(function (k) {
    SKILL_BY_LABEL[SKILL_LABEL[k].toLowerCase()] = k;
  });
  var BUSHIDO = ["Compassion", "Courage", "Courtesy", "Duty and Loyalty",
                 "Honor", "Righteousness", "Sincerity"];

  var CLANS = window.L5R_CLANS || [];
  var FAMILIES = window.L5R_FAMILIES || [];
  var SCHOOLS = window.L5R_SCHOOLS || [];
  var HERITAGES = window.L5R_HERITAGES || {};
  var CATALOG = window.L5R_CATALOG || [];
  var REGIONS = window.L5R_REGIONS || [];
  var UPBRINGINGS = window.L5R_UPBRINGINGS || [];
  var ARCHIVE = window.L5R_ARCHIVE_DRAFTS || [];
  var CLAN_TENETS = window.L5R_CLAN_TENETS || {};
  var QUESTIONS = window.L5R_QUESTIONS || {};
  var NAMES = window.L5R_NAMES || {};

  function pickFrom(list) {
    return list && list.length ? list[Math.floor(Math.random() * list.length)] : null;
  }

  /* Typing a Rokugani name is friction at exactly the moment a question wants
     an answer, so the character and their lord can both roll one from the
     l5r5e system's own tables. `family` is the family name to carry, or null
     for a personal name alone — a rōnin or a gaijin has none.

     NOT `rollName` — that name already belongs to the school-name resolver
     above, and taking it made every roll return the character's school. */
  function rollPersonalName(family, gender) {
    var pool = (NAMES.given || {})[gender] || (NAMES.given || {}).any || [];
    var personal = pickFrom(pool);
    if (!personal) return null;
    return family ? family + " " + personal : personal;
  }

  // A lord is usually of the character's own family; failing that, of their
  // clan; failing that, anyone. Resolved per roll, so the button gives variety.
  function rollLordFamily() {
    if (C.family) return C.family;
    var byClan = (NAMES.family || {}).by_clan || {};
    return pickFrom(byClan[C.clan] || []) ||
      pickFrom([].concat.apply([], Object.keys(byClan).map(function (k) {
        return byClan[k];
      }))) ||
      pickFrom((NAMES.family || {}).vassal || []);
  }

  // The corpus's wording for a question, for the mode in play. The wizard used
  // to invent its own titles — "A Distinction" where the corpus asks "What Is
  // Your Character's Greatest Accomplishment?" — which quietly turned a
  // narrative question into a shopping trip. Path of Waves and Writ of the
  // Wilds reword most of the twenty; where a mode says nothing, core stands.
  /* Writ of the Wilds is a partial revision of Path of Waves — the corpus says
     so in as many words: it gives its own Q1, Q2, Q5, Q6, Q7 and Q8 and leaves
     the rest of that book's set alone. So a Wilds character falls back to Path
     of Waves, and only then to core. */
  function qFor(n) {
    var q = QUESTIONS[String(n)] || {};
    var m = mode();
    if (m === "wow") return q.wow || q.pow || q.core || null;
    if (m === "pow") return q.pow || q.core || null;
    return q.core || null;
  }
  function qText(n) {
    var q = qFor(n);
    return (q && q.text) || null;
  }
  // True when the mode asks a different question here, not a reworded one.
  function qAlt(n) {
    var m = mode();
    if (m === "core") return null;
    var q = QUESTIONS[String(n)] || {};
    var mine = (m === "wow" ? (q.wow || q.pow) : q.pow);
    return mine && mine !== q.core ? mine : null;
  }

  // Core builds a samurai from clan and family. Path of Waves and Writ of the
  // Wilds replace those two questions with region and upbringing, and drop the
  // clan-relationship beat, since those characters have no clan.
  var MODES = [
    { key: "core", label: "Samurai", book: "Core Rulebook" },
    { key: "pow", label: "Ronin", book: "Path of Waves" },
    { key: "wow", label: "Wilds", book: "Writ of the Wilds" }
  ];
  function mode() { return C.mode || "core"; }
  function isCore() { return mode() === "core"; }
  function originSet() {
    var src = mode() === "wow" ? "writ-of-wilds" : "path-of-waves";
    var list = (mode() === "wow" ? UPBRINGINGS : REGIONS);
    var scoped = list.filter(function (x) {
      return (x.source || "").indexOf(src) >= 0;
    });
    return scoped.length ? scoped : list;
  }
  var ROLL = (window.L5R_COVERAGE || {}).schools || [];

  // The chargen data and the compendium spell schools differently ("Asahina
  // Artificer" vs "Asahina Artificer School"). Everything downstream — the
  // build's school-roll gate, the coverage ledger — keys off the compendium
  // name, so resolve to it here and show that name in the picker too.
  var SCHOOL_ALIAS = {
    "wanderingblade": "The Wandering Blade"
  };
  var ROLL_BY_NORM = {};
  ROLL.forEach(function (r) { ROLL_BY_NORM[normName(r.name)] = r.name; });

  function rollName(name) {
    var n = normName(name);
    if (SCHOOL_ALIAS[n]) return SCHOOL_ALIAS[n];
    if (ROLL_BY_NORM[n]) return ROLL_BY_NORM[n];
    if (ROLL_BY_NORM[n + "school"]) return ROLL_BY_NORM[n + "school"];
    var hit = Object.keys(ROLL_BY_NORM).filter(function (k) {
      return k.indexOf(n) === 0 || n.indexOf(k) === 0;
    });
    return hit.length === 1 ? ROLL_BY_NORM[hit[0]] : name;
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function el(id) { return document.getElementById(id); }
  function cap(s) { return String(s || "").charAt(0).toUpperCase() + String(s || "").slice(1); }
  function normName(s) {
    return String(s || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, "");
  }
  function slugify(s) {
    return String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }
  function has(v) {
    return v !== null && v !== undefined && v !== "" &&
      !(Array.isArray(v) && v.length === 0);
  }
  /* ---------------------------------------------------------- draft */

  function newCharacter() {
    return {
      name: "", mode: "core", clan: null, family: null, school: null, role: null,
      region: null, upbringing: null,
      standout_ring: null,
      rings: { air: 1, earth: 1, fire: 1, water: 1, "void": 1 },
      skills: {},
      distinctions: [], adversities: [], passions: [], anxieties: [],
      bushido: { paramount: null, lesser: null, attitude: null, skill: null },
      answers: {
        giri: "", ninjo: "", standout_quality: "",
        accomplishment: "", challenge: "", peace: "", fear: "",
        past: "", known_for: "", known_skill: null,
        lord_name: "", lord_gender: "any",
        prized_possession: "", group_history: "", raised_by: "", raised_skill: null,
        clan_relationship: { path: null, skill: null, text: "" },
        mentor: { name: "", path: null, granted: null, skill: "", text: "" },
        first_impression: "", accoutrement: "", stress_reaction: "",
        relationships: "", parent_opinion: { description: "", skill: null },
        heritage: null, heritage_table: null, heritage_sub: null, death: ""
      },
      starting_item: "", campaign: "", notes: "", gender: "any",
      // clan/family/school choices the player resolved, keyed by what granted them
      choices: {},
      // Loose concept material. Feeds every AI suggestion and is deliberately
      // NOT exported — it is scaffolding for making the character, not part of
      // the finished one.
      concept: ""
    };
  }

  // The draft store. Every character the Creator makes is a draft and stays one
  // until it is deliberately promoted, so the store is the whole working set —
  // visible, switchable, and never silently overwritten.
  var STORE = loadStore();
  var C = activeChar();
  var step = 0;
  var jumpToTop = false;

  function newId() {
    return "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function loadStore() {
    var st = null;
    try { st = JSON.parse(localStorage.getItem(LS_DRAFTS)); } catch (e) { /* ignore */ }
    if (st && st.drafts) return st;
    // migrate the old single-draft key, so an in-progress character survives
    var legacy = null;
    try { legacy = JSON.parse(localStorage.getItem(LS_DRAFT)); } catch (e) { /* ignore */ }
    var id = newId();
    var drafts = {};
    drafts[id] = { id: id, updated: Date.now(), character: legacy || newCharacter() };
    return { activeId: id, drafts: drafts };
  }

  function activeChar() {
    var d = STORE.drafts[STORE.activeId];
    if (!d) {
      var ids = Object.keys(STORE.drafts);
      STORE.activeId = ids[0];
      d = STORE.drafts[STORE.activeId];
    }
    return d.character;
  }

  function persist() {
    try { localStorage.setItem(LS_DRAFTS, JSON.stringify(STORE)); } catch (e) { /* private mode */ }
  }

  function save() {
    var d = STORE.drafts[STORE.activeId];
    if (d) { d.character = C; d.updated = Date.now(); }
    persist();
    renderWip();
    renderNav();
    renderDrafts();
  }

  function draftLabel(d) {
    var c = d.character || {};
    return c.name || "Unnamed draft";
  }
  function draftProgress(c) {
    var saved = C, n;
    C = c;
    n = STEPS.filter(function (s) { return s.id !== "export" && s.done(); }).length;
    C = saved;
    return n;
  }

  function switchDraft(id) {
    if (!STORE.drafts[id]) return;
    STORE.activeId = id;
    C = STORE.drafts[id].character;
    step = 0;
    jumpToTop = true;
    persist();
    render();
  }
  function addDraft() {
    var id = newId();
    STORE.drafts[id] = { id: id, updated: Date.now(), character: newCharacter() };
    switchDraft(id);
  }
  function removeDraft(id) {
    var d = STORE.drafts[id];
    if (!d) return;
    if (!confirm("Delete “" + draftLabel(d) + "”? This cannot be undone.")) return;
    delete STORE.drafts[id];
    if (!Object.keys(STORE.drafts).length) { addDraft(); return; }
    if (STORE.activeId === id) STORE.activeId = Object.keys(STORE.drafts)[0];
    C = activeChar();
    persist();
    render();
  }
  function duplicateDraft(id) {
    var src = STORE.drafts[id];
    if (!src) return;
    var nid = newId();
    var copy = JSON.parse(JSON.stringify(src.character));
    copy.name = (copy.name || "Unnamed") + " (copy)";
    STORE.drafts[nid] = { id: nid, updated: Date.now(), character: copy };
    switchDraft(nid);
  }

  // A draft pulled from Foundry is hydrated into a local one so it can be
  // carried on with. Only what the wizard asks about comes across; the rest of
  // the character stays in the archive file until it is exported again.
  function hydrate(a) {
    var c = newCharacter();
    var tq = (a.twenty_questions || {}).steps || {};
    function ans(step, key) {
      return ((tq[step] || {}).answers || {})[key] || "";
    }
    c.name = a.name;
    c.mode = (a.twenty_questions || {}).template === "pow" ? "pow" : "core";
    c.clan = a.identity.clan;
    c.family = a.identity.family;
    c.school = a.identity.school;
    c.role = a.identity.role;
    c.campaign = a.campaign || "";
    // Authoring context from the manifest, not from the character record — it
    // feeds the AI suggestions and is dropped again on export.
    c.concept = a.concept || "";
    c.standout_ring = ans("step4", "ring") || null;
    c.answers.standout_quality = ans("step4", "stand_out");
    c.answers.giri = (a.social || {}).giri || ans("step5", "social_giri");
    c.answers.ninjo = (a.social || {}).ninjo || ans("step6", "social_ninjo");
    c.answers.clan_relationship.text = ans("step7", "clan_relations");
    var tenets = (a.social || {}).bushido_tenets || {};
    c.bushido.paramount = tenets.paramount ||
      ans("step8", "tenet_paramount") || null;
    c.bushido.lesser = tenets.less_significant ||
      ans("step8", "tenet_less_significant") || null;
    // questions 9-12 are narrative in the book; the actor records the answers
    // under these keys and the wizard used to drop all four on the floor
    c.answers.accomplishment = ans("step9", "success");
    c.answers.challenge = ans("step10", "difficulty");
    c.answers.peace = ans("step11", "calms");
    c.answers.fear = ans("step12", "worries");
    c.answers.first_impression = ans("step14", "first_sight");
    c.answers.stress_reaction = ans("step15", "stress");
    c.answers.relationships = ans("step16", "relations");
    c.answers.parent_opinion.description = ans("step17", "parents_pov");
    c.answers.heritage = ans("step18", "heritage_name") || null;
    c.answers.death = ans("step20", "death");
    // peculiarities land in whichever bucket the catalog says they belong to
    (a.peculiarities || []).forEach(function (n) {
      var e = CATALOG.filter(function (x) {
        return x.sub_type === "peculiarity" && normName(x.name) === normName(n);
      })[0];
      var bucket = { distinction: "distinctions", adversity: "adversities",
                     passion: "passions", anxiety: "anxieties" }[e && e.kind];
      if (bucket && c[bucket].indexOf(n) < 0) c[bucket].push(n);
    });
    return c;
  }

  function openArchiveDraft(slug) {
    var a = ARCHIVE.filter(function (x) { return x.slug === slug; })[0];
    if (!a) return;
    var existing = Object.keys(STORE.drafts).filter(function (id) {
      return STORE.drafts[id].fromArchive === slug;
    })[0];
    if (existing) {
      // Concept material lives in the manifest, so a draft opened before the
      // concept was written should pick it up rather than stay empty.
      var d = STORE.drafts[existing];
      if (a.concept && !d.character.concept) { d.character.concept = a.concept; persist(); }
      switchDraft(existing); return;
    }
    if (!confirm("Open “" + a.name + "” from the archive as a working draft?\n\n" +
                 "It is copied into this browser; the archive file is not changed. " +
                 "Export when you are done.")) return;
    var id = newId();
    STORE.drafts[id] = { id: id, updated: Date.now(), fromArchive: slug,
                         character: hydrate(a) };
    switchDraft(id);
  }

  // The panel is a <details>, shut unless the author opened it. With 98 archive
  // drafts an always-open list pushed the wizard itself below the fold, and the
  // wizard is what the page is for. renderDrafts() rewrites its own markup on
  // every save, so the open state is held here rather than in the DOM.
  var LS_DRAFTS_OPEN = "sortilege.l5r.creator.draftsOpen";

  function draftsOpen() {
    try { return localStorage.getItem(LS_DRAFTS_OPEN) === "1"; }
    catch (e) { return false; }
  }
  function setDraftsOpen(v) {
    try { localStorage.setItem(LS_DRAFTS_OPEN, v ? "1" : "0"); } catch (e) { /* private mode */ }
  }

  function renderDrafts() {
    var ids = Object.keys(STORE.drafts).sort(function (a, b) {
      return STORE.drafts[b].updated - STORE.drafts[a].updated;
    });
    var active = STORE.drafts[STORE.activeId];
    var summary =
      '<summary class="drafts-sum">' +
        '<span class="drafts-label">Drafts</span>' +
        '<span class="ds-active">' + esc(active ? draftLabel(active) : "none") + "</span>" +
        '<span class="ds-n">' + ids.length + " here" +
        (ARCHIVE.length ? " · " + ARCHIVE.length + " from Foundry" : "") +
        "</span>" +
      "</summary>";
    el("drafts").innerHTML = summary + '<div class="drafts-body">' +
      '<span class="drafts-label">Drafts</span>' +
      ids.map(function (id) {
        var d = STORE.drafts[id];
        var c = d.character || {};
        var n = draftProgress(c);
        return '<span class="draftchip' + (id === STORE.activeId ? " active" : "") +
          '" data-id="' + id + '">' +
          '<button type="button" class="dc-open" data-id="' + id + '">' +
          esc(draftLabel(d)) +
          '<span class="dc-meta">' + esc(c.school || c.clan || "no clan yet") +
          " · " + n + "/21</span></button>" +
          '<button type="button" class="dc-x" data-id="' + id + '" title="Delete">×</button>' +
          "</span>";
      }).join("") +
      '<button type="button" class="draftnew" id="draft-new">+ New</button>' +
      '<button type="button" class="draftnew" id="draft-dup">Duplicate</button>' +
      (ARCHIVE.length
        ? '<span class="drafts-label drafts-archive">From the archive</span>' +
          '<div class="archive-list">' +
          ARCHIVE.map(function (a) {
            var open = Object.keys(STORE.drafts).some(function (id) {
              return STORE.drafts[id].fromArchive === a.slug;
            });
            return '<button type="button" class="archivechip' +
              (open ? " open" : "") + '" data-slug="' + esc(a.slug) + '">' +
              esc(a.name) + '<span class="dc-meta">' +
              esc(a.identity.school || a.identity.clan || "—") +
              (open ? " · opened" : "") + "</span></button>";
          }).join("") + "</div>"
        : "") + "</div>";

    el("drafts").open = draftsOpen();
    el("drafts").addEventListener("toggle", function () {
      setDraftsOpen(el("drafts").open);
    });

    Array.prototype.forEach.call(el("drafts").querySelectorAll(".dc-open"), function (b) {
      b.addEventListener("click", function () { switchDraft(b.getAttribute("data-id")); });
    });
    Array.prototype.forEach.call(el("drafts").querySelectorAll(".dc-x"), function (b) {
      b.addEventListener("click", function (e) {
        e.stopPropagation(); removeDraft(b.getAttribute("data-id"));
      });
    });
    el("draft-new").addEventListener("click", addDraft);
    el("draft-dup").addEventListener("click", function () { duplicateDraft(STORE.activeId); });
    Array.prototype.forEach.call(el("drafts").querySelectorAll(".archivechip"), function (b) {
      b.addEventListener("click", function () { openArchiveDraft(b.getAttribute("data-slug")); });
    });
  }

  /* ---------------------------------------------------------- AI */

  // The dashboard's prompts, with two deliberate divergences (Jordan, 2026-08-30):
  // they write in the THIRD person here, and they carry an explicit list of the
  // habits that make machine prose read as machine prose. If the dashboard is
  // ever brought into line, move this block across whole.
  var VOICE =
    "Write in the third person, about the character. Use their name, or they/them " +
    "if no name is given. Never write \"you\" or address the player.";
  var SHAPE =
    "One or two sentences, at most 200 characters. Give the sentence itself and " +
    "nothing else: no preamble, no framing, no quotation marks, no trailing gloss.";
  var REGISTER =
    "Rokugan's register: grave, exact, understated. Plain nouns and plain verbs. " +
    "Prefer one concrete particular — a person, a place, an object, an act, a debt — " +
    "over a summary of a feeling.";
  // Named because naming them works better than asking for "good writing".
  var AVOID =
    "Avoid the house style of machine-written prose. Do not use: the " +
    "\"not just X, but Y\" or \"more than X — Y\" construction; a dash or colon " +
    "pivot carrying the point at the end of the sentence; three abstract nouns in a " +
    "row (duty, honor, sacrifice); the words weight, quiet, echo, whisper, tapestry, " +
    "testament, navigate, delve, resonate, unwavering, steely, haunted, or " +
    "\"speaks volumes\"; opening on a participial clause (\"Having served…\"); " +
    "a closing clause that restates the sentence in grander words. Do not restate " +
    "the question. Do not explain the answer after giving it.";
  var STYLE = [VOICE, SHAPE, REGISTER, AVOID].join(" ");

  var SETTING = "Legend of the Five Rings 5th Edition, a samurai drama RPG set in " +
    "the fantasy realm of Rokugan.";
  var PROMPTS = {
    giri: "You are helping create a character for " + SETTING + "\n\nWrite a single sentence describing this character's giri (duty/obligation to their lord). Giri is what they must do even at personal cost. It should be specific to their clan, school, and lord.\n\n" + STYLE,
    ninjo: "L5R 5e character creation. Write a single sentence describing this character's ninjō (personal desire). The ninjō should sit in tension with their giri — something they want for themselves that conflicts with their duty.\n\n" + STYLE,
    standout_quality: "L5R 5e character creation. Write a single sentence naming and briefly framing the standout quality — a memorable trait or moment — that earned this character their +1 ring increase. Concrete and unmistakable.\n\n" + STYLE,
    clan_relationship: "L5R 5e character creation. Write a single sentence describing how this character carries, or resists, their clan's ideals. Specific to the clan they belong to.\n\n" + STYLE,
    first_impression: "L5R 5e character creation. Write a single sentence describing how this character first appears to a stranger: build, bearing, voice, dress, and a distinctive accoutrement they always carry.\n\n" + STYLE,
    stress_reaction: "L5R 5e character creation. Write a single sentence describing what this character does when pushed past their composure. Visible, physical, particular to them.\n\n" + STYLE,
    parent_opinion: "L5R 5e character creation. Write a single sentence reporting a parent or guardian's opinion of this character — what they are proud of, frustrated by, or worried about. Report it in the third person; do not write it as the parent speaking.\n\n" + STYLE,
    accomplishment: "L5R 5e character creation. Write a single sentence naming this character's greatest accomplishment so far — a deed, not a trait, with a place or a person in it.\n\n" + STYLE,
    challenge: "L5R 5e character creation. Write a single sentence describing what holds this character back the most in life. A standing difficulty they carry, not a mood.\n\n" + STYLE,
    peace: "L5R 5e character creation. Write a single sentence describing the activity that most makes this character feel at peace — something they do for themselves, unrelated to duty.\n\n" + STYLE,
    fear: "L5R 5e character creation. Write a single sentence describing the concern, fear, or foible that troubles this character most.\n\n" + STYLE,
    past: "L5R 5e character creation, Path of Waves. This character has no lord; a past replaces giri. Write a single sentence naming what drives them and what it costs — an obligation, a pursuer, or a choice that still follows them.\n\n" + STYLE,
    known_for: "L5R 5e character creation, Path of Waves. Write a single sentence describing what this character is known for where they have travelled, and to whom.\n\n" + STYLE,
    prized_possession: "L5R 5e character creation, Path of Waves. Write a single sentence about the one possession that matters most when everything they own fits in a pack — what it is, and why this one.\n\n" + STYLE,
    group_history: "L5R 5e character creation, Path of Waves. Write a single sentence of shared history between this character and one other member of their group, answering the prompt they chose.\n\n" + STYLE,
    raised_by: "L5R 5e character creation, Path of Waves. Write a single sentence describing who raised this character and how they regard it.\n\n" + STYLE,
    mentor_relationship: "L5R 5e character creation. Write a single sentence describing the relationship between this character and a mentor — what they were taught, and at what cost.\n\n" + STYLE,
    relationships: "L5R 5e character creation. Write a single sentence naming one or two people who matter to this character — a rival, an ally, a family member — and what stands between them.\n\n" + STYLE,
    death: "L5R 5e character creation. Write a single sentence describing the death this character would not regret — the ending they invite, not the one the GM must give them. Solemn and declarative, in the third person.\n\n" + STYLE,
    "default": "L5R 5e character creation suggestion. " + STYLE
  };

  function aiKey() {
    try {
      var k = localStorage.getItem(LS_KEY);
      if (k) return k;
    } catch (e) { /* private mode */ }
    // .env's key, loaded only when this page is served locally
    return window.L5R_LOCAL_AI_KEY || null;
  }

  // The published site must never request the key file — it does not exist
  // there, and asking for it would be both a 404 and the wrong intent.
  function loadLocalKey(done) {
    var h = location.hostname;
    var local = h === "localhost" || h === "127.0.0.1" || h === "" || h === "[::1]";
    if (!local || window.L5R_LOCAL_AI_KEY) return done();
    var el = document.createElement("script");
    el.src = "../data/ai-key.local.js";
    el.onload = done;
    el.onerror = done;      // absent is normal; the Creator just asks for a key
    document.head.appendChild(el);
  }
  function aiAvailable() { return !!aiKey() || !!window.L5R_AI_PROXY; }

  // Everything the draft holds at the moment of the call — the current step's
  // selection included, since every widget writes to C before this runs. A
  // suggestion is only as good as what it knows the character already is.
  function characterContext() {
    var b = [];
    var a = C.answers;
    function add(k, v) { if (v !== null && v !== undefined && v !== "") b.push(k + ": " + v); }

    if (C.concept) b.push("Concept the player is holding:\n" + C.concept + "\n");
    add("Mode", (MODES.filter(function (m) { return m.key === mode(); })[0] || {}).book);
    add("Name", C.name);
    if (isCore()) {
      add("Clan", C.clan);
      add("Family", C.family);
    } else {
      add("Region", C.region);
      add("Upbringing", C.upbringing);
    }
    add("School", C.school + (C.role ? " (" + C.role + ")" : ""));

    var d = computed();
    b.push("Rings: " + RINGS.map(function (r) {
      return cap(r) + " " + d.rings[r];
    }).join(", "));
    var sk = Object.keys(d.skills).filter(function (k) { return d.skills[k]; })
      .map(function (k) { return (SKILL_LABEL[k] || cap(k)) + " " + d.skills[k]; });
    if (sk.length) b.push("Skills: " + sk.join(", "));
    b.push("Honor " + d.honor + ", Glory " + d.glory + ", Status " + d.status);

    add("Standout ring", C.standout_ring && cap(C.standout_ring));
    add("Standout quality", a.standout_quality);
    add("Giri (duty)", a.giri);
    add("Ninjō (desire)", a.ninjo);
    add("Clan relationship", a.clan_relationship.text);
    add("Paramount tenet", C.bushido.paramount);
    add("Lesser tenet", C.bushido.lesser);
    add("Past", a.past);
    add("Known for", a.known_for);
    add("Prized possession", a.prized_possession);
    add("Shared history", a.group_history);
    add("Raised by", a.raised_by);
    add("Greatest accomplishment", a.accomplishment);
    add("Greatest challenge", a.challenge);
    add("At peace when", a.peace);
    add("Troubled by", a.fear);
    add("Distinctions", C.distinctions.join(", "));
    add("Adversities", C.adversities.join(", "));
    add("Passions", C.passions.join(", "));
    add("Anxieties", C.anxieties.join(", "));
    add("Mentor", a.mentor.name + (a.mentor.text ? " — " + a.mentor.text : ""));
    add("From the mentor", a.mentor.granted);
    add("First impression", a.first_impression);
    add("Stress reaction", a.stress_reaction);
    add("Relationships", a.relationships);
    add("Starting item", C.starting_item);
    add("Parent's opinion", a.parent_opinion.description);
    add("Heritage", a.heritage + (a.heritage_sub ? " — " + a.heritage_sub : ""));
    add("Vision of death", a.death);
    return b.join("\n");
  }

  // Two routes to a suggestion. A key in this browser calls Anthropic directly;
  // otherwise the request goes to the Worker, which holds the key server-side.
  // The published site has no key of its own and must never be given one.
  function aiSuggest(fieldKey) {
    var key = aiKey();
    var proxy = window.L5R_AI_PROXY || "";
    if (!key && !proxy) return Promise.reject(new Error("No API key set."));

    var system = PROMPTS[fieldKey] || PROMPTS["default"];
    var user = "Existing draft for context:\n" + characterContext() +
      "\n\nSuggest a single " + fieldKey.replace(/_/g, " ") + " for this character.";

    var req = key
      ? fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true"
          },
          body: JSON.stringify({
            model: MODEL, max_tokens: 256, system: system,
            messages: [{ role: "user", content: user }]
          })
        })
      : fetch(proxy, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ system: system, user: user })
        });

    return req.then(function (r) {
      if (!r.ok) {
        return r.text().then(function (t) {
          var msg = t;
          try { msg = JSON.parse(t).error || t; } catch (e) { /* plain text */ }
          throw new Error("AI request failed (" + r.status + "): " +
                          String(msg).slice(0, 200));
        });
      }
      return r.json();
    }).then(function (d) {
      if (typeof d.text === "string") return d.text;      // via the Worker
      return (d.content || []).filter(function (b) { return b.type === "text"; })
        .map(function (b) { return b.text; }).join("").trim();
    });
  }

  // Tab (on an empty field) or the Suggest button asks Claude — same
  // affordance as the dashboard.
  function wireAi(input, fieldKey, onChange) {
    var row = document.createElement("div");
    row.className = "ai-row";
    row.innerHTML = '<button type="button" class="ai-btn">Suggest</button>' +
      '<span class="ai-hint">' +
      (aiAvailable()
        ? "Tab in an empty field for an AI suggestion" +
          (aiKey()
            ? (window.L5R_LOCAL_AI_KEY ? " · key from .env" : "")
            : " · via the shared proxy")
        : "Set an API key below to enable AI suggestions") +
      '</span><span class="ai-status" aria-live="polite"></span>';
    input.insertAdjacentElement("afterend", row);
    var status = row.querySelector(".ai-status");

    function go() {
      if (!aiAvailable()) { el("ai-key").focus(); return; }
      status.textContent = "…";
      aiSuggest(fieldKey).then(function (text) {
        input.value = text;
        onChange(text);
        status.textContent = "";
      }).catch(function (e) {
        status.textContent = "";
        alert(e.message);
      });
    }
    row.querySelector(".ai-btn").addEventListener("click", go);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Tab" && !e.shiftKey && (!input.value || e.altKey)) {
        e.preventDefault();
        go();
      }
    });
  }

  /* ---------------------------------------------------------- derived */

  function familiesOf(clan) {
    return FAMILIES.filter(function (f) { return f.clan === clan; });
  }
  // The clan's own view of Bushidō, where the book states one. Minor clans and
  // rōnin are not in that table, so they get no default rather than a guess.
  function clanTenets() {
    if (!isCore() || !C.clan) return null;
    var key = Object.keys(CLAN_TENETS).filter(function (k) {
      return normName(k) === normName(C.clan) ||
             normName(k + " Clan") === normName(C.clan);
    })[0];
    return key ? CLAN_TENETS[key] : null;
  }

  // Fill an unanswered tenet from the clan. Never overwrite an answer: this is
  // a default, and question 8 belongs to the player.
  function applyTenetDefaults() {
    var def = clanTenets();
    if (!def) return;
    var dirty = false;
    if (!has(C.bushido.paramount) && def.paramount.length) {
      C.bushido.paramount = def.paramount[0]; dirty = true;
    }
    if (!has(C.bushido.lesser) && def.lesser.length) {
      C.bushido.lesser = def.lesser[0]; dirty = true;
    }
    if (dirty) save();
  }

  function schoolsOf(clan) {
    var list = SCHOOLS.filter(function (s) { return s.clan === clan; });
    return list.length ? list : SCHOOLS;
  }
  // A school arrives spelled three ways: the chargen data's ("Isawa Tensai"),
  // the compendium's ("Isawai Tensai School" — its typo), and whatever the
  // character source records ("Isawa Tensai School"). Match on all of them,
  // ignoring case, accents and a trailing "School". A hydrated draft used to
  // fail this and show its own school as unselected, with no choices offered.
  function schoolKeys(name) {
    var n = normName(name);
    return [n, n.replace(/school$/, ""), normName(rollName(name))];
  }
  function schoolByRollName(name) {
    if (!name) return null;
    var want = schoolKeys(name);
    return SCHOOLS.filter(function (s) {
      return schoolKeys(s.name).concat(schoolKeys(rollName(s.name)))
        .some(function (k) { return k && want.indexOf(k) >= 0; });
    })[0] || null;
  }
  function find(list, name) {
    return list.filter(function (x) { return x.name === name; })[0] || null;
  }

  // Rings and skills accumulate from clan, family, school and the standout
  // pick. Where the source data offers a choice ({_choose}) the wizard shows
  // the options rather than silently picking one.
  function computed() {
    var rings = { air: 1, earth: 1, fire: 1, water: 1, "void": 1 };
    var skills = {};
    var honor = 0, glory = 0, status = 0, wealth = 0;
    var pending = [];
    // Where each increase came from, so the panel can say "+1 Iuchi, +1 Ujik
    // Diviner School" rather than only the total. Base ranks are not a source.
    var from = { rings: {}, skills: {} };
    function credit(kind, key, by, source) {
      if (!key || !source || !by) return;
      (from[kind][key] = from[kind][key] || [])
        .push({ by: by, source: source });
    }

    // A _choose is resolved by the player at the step that granted it; whatever
    // is still unanswered goes on `pending` for the side panel to name.
    function resolved(key, spec) {
      var picked = ((C.choices || {})[key] || [])
        .filter(function (o) { return spec.options.indexOf(o) >= 0; });
      return picked.slice(0, spec.n || 1);
    }
    function addRing(obj, key, source) {
      if (!obj) return;
      if (obj._choose) {
        var spec = obj._choose;
        var picked = resolved(key, spec);
        var by = spec.yield_value != null ? spec.yield_value : 1;
        picked.forEach(function (o) {
          var r = String(o).toLowerCase();
          if (rings[r] != null) { rings[r] += by; credit("rings", r, by, source); }
        });
        if (picked.length < (spec.n || 1)) {
          pending.push({ type: "ring", opts: spec.options,
                         n: (spec.n || 1) - picked.length });
        }
        return;
      }
      Object.keys(obj).forEach(function (k) {
        var r = k.toLowerCase();
        if (rings[r] != null) { rings[r] += obj[k]; credit("rings", r, obj[k], source); }
      });
    }
    function addSkills(obj, key, source) {
      if (!obj) return;
      if (obj._choose) {
        var spec = obj._choose;
        var picked = resolved(key, spec);
        var by = spec.yield_value != null ? spec.yield_value : 1;
        picked.forEach(function (o) {
          var sk = SKILL_BY_LABEL[String(o).toLowerCase()] || String(o).toLowerCase();
          skills[sk] = (skills[sk] || 0) + by;
          credit("skills", sk, by, source);
        });
        if (picked.length < (spec.n || 1)) {
          pending.push({ type: "skill", opts: spec.options,
                         n: (spec.n || 1) - picked.length });
        }
        return;
      }
      Object.keys(obj).forEach(function (k) {
        var s = SKILL_BY_LABEL[String(k).toLowerCase()] || k.toLowerCase();
        skills[s] = (skills[s] || 0) + obj[k];
        credit("skills", s, obj[k], source);
      });
    }

    var clan = find(CLANS, C.clan) || find(CLANS, C.clan + " Clan");
    if (clan) {
      addRing(clan.ring_bonus, "clan.ring_bonus", C.clan);
      addSkills(clan.skill_bonus, "clan.skill_bonus", C.clan);
      status = clan.starting_status || 0;
    }
    var fam = find(FAMILIES, C.family);
    if (fam) {
      addRing(fam.ring_increase, "family.ring_increase", C.family);
      addSkills(fam.skill_increases, "family.skill_increases", C.family);
      glory = fam.glory || 0; wealth = fam.starting_wealth || 0;
    }
    var sch = schoolByRollName(C.school);
    if (sch) {
      addRing(sch.ring_increase, "school.ring_increase", C.school);
      addSkills(sch.starting_skills, "school.starting_skills", C.school);
      honor = sch.starting_honor || 0;
    }
    if (C.standout_ring && rings[C.standout_ring] != null) {
      rings[C.standout_ring] += 1;
      credit("rings", C.standout_ring, 1, "Question 4");
    }
    if (C.bushido.attitude === "A") honor += 10;
    if (C.answers.clan_relationship.path === "A") glory += 5;

    // Skills the player resolved by hand at a question that grants one. The
    // question is the source; C.skills is a flat tally, so match on the answer.
    var byQuestion = {};
    [[C.answers.clan_relationship.skill, "Question 7"],
     [C.bushido.skill, "Question 8"],
     [C.answers.mentor.skill, "Question 13"],
     [C.answers.known_skill, "Question 7"],
     [C.answers.parent_opinion.skill, "Question 17"],
     [C.answers.raised_skill, "Question 18"]].forEach(function (p) {
      if (p[0]) byQuestion[p[0]] = p[1];
    });
    Object.keys(C.skills || {}).forEach(function (k) {
      skills[k] = (skills[k] || 0) + C.skills[k];
      credit("skills", k, C.skills[k], byQuestion[k] || "a question");
    });
    return { rings: rings, skills: skills, honor: honor, glory: glory,
             status: status, wealth: wealth, pending: pending, school: sch,
             from: from };
  }

  /* ---------------------------------------------------------- steps */

  function textStep(id, key, fieldKey, placeholder) {
    return function (body) {
      var ta = document.createElement("textarea");
      ta.rows = 3;
      ta.placeholder = placeholder || "";
      ta.value = key.split(".").reduce(function (o, k) { return o ? o[k] : ""; }, C) || "";
      ta.addEventListener("input", function () {
        var parts = key.split("."), o = C;
        for (var i = 0; i < parts.length - 1; i++) o = o[parts[i]];
        o[parts[parts.length - 1]] = ta.value;
        save();
      });
      body.appendChild(ta);
      wireAi(ta, fieldKey, function (v) {
        var parts = key.split("."), o = C;
        for (var i = 0; i < parts.length - 1; i++) o = o[parts[i]];
        o[parts[parts.length - 1]] = v;
        save();
      });
    };
  }

  function pickList(body, items, current, onPick, opts) {
    opts = opts || {};
    var wrap = document.createElement("div");
    wrap.className = "pick-wrap";
    var search = document.createElement("input");
    search.type = "search";
    search.placeholder = "Filter…";
    var list = document.createElement("div");
    list.className = "pick-list";

    function draw() {
      var q = search.value.trim().toLowerCase();
      var shown = items.filter(function (i) {
        return !q || (i.label + " " + (i.meta || "")).toLowerCase().indexOf(q) >= 0;
      });
      // What is already chosen goes first. Opening a draft at School or Family
      // otherwise showed a list scrolled to the top with the actual answer
      // somewhere below the fold, which reads as nothing being chosen.
      var picked = shown.filter(function (i) { return i.value === current; });
      if (picked.length) {
        shown = picked.concat(shown.filter(function (i) { return i.value !== current; }));
      }
      list.innerHTML = shown.map(function (i) {
        return '<button type="button" class="pick' +
          (i.value === current ? " active" : "") + '" data-v="' + esc(i.value) + '">' +
          '<span class="pick-n">' + esc(i.label) + "</span>" +
          (i.meta ? '<span class="pick-m">' + esc(i.meta) + "</span>" : "") + "</button>";
      }).join("") || '<p class="muted small">Nothing matches.</p>';
      Array.prototype.forEach.call(list.querySelectorAll(".pick"), function (b) {
        b.addEventListener("click", function () {
          onPick(b.getAttribute("data-v"));
          current = b.getAttribute("data-v");
          draw();
          list.scrollTop = 0;
        });
      });
    }
    search.addEventListener("input", draw);
    if (items.length > 8) wrap.appendChild(search);
    wrap.appendChild(list);
    body.appendChild(wrap);
    draw();
  }

  /* ------------------------------------------- advantages & disadvantages */

  var PEC_TEXT = window.L5R_PECULIARITY_TEXT || {};
  var TENET_RE = /^(?:Disdain for|Paragon of)\s+(.+)$/;

  // Everything the character already holds, in any bucket, plus the extra the
  // mentor question grants — so a picker can refuse to sell the same thing twice.
  function heldPeculiarities() {
    return [].concat(C.distinctions, C.adversities, C.passions, C.anxieties,
                     C.answers.mentor.granted ? [C.answers.mentor.granted] : []);
  }

  // Some heritage results hand over a named peculiarity outright ("Gain the
  // Guiding Ancestor (Void) distinction"). That is a stated condition the
  // character demonstrably meets, so the picker marks it as met.
  function heritageGrantedNames() {
    var t = HERITAGES[C.answers.heritage_table];
    if (!t || !C.answers.heritage) return [];
    var e = t.entries.filter(function (x) { return x.name === C.answers.heritage; })[0];
    if (!e) return [];
    var blob = [e.effect, e.description,
                Object.keys(e.modifiers || {}).map(function (k) {
                  return e.modifiers[k];
                }).join(" ")].filter(Boolean).join(" ");
    var out = [], m;
    var re = /[Gg]ain the ([^,.;]+?)\s*(?:\([^)]*\)\s*)?(distinction|adversity|passion|anxiety)\b/g;
    while ((m = re.exec(blob))) out.push(m[1].trim());
    return out;
  }

  // L5R5e peculiarities carry no prerequisites: neither the compendium nor the
  // DSL has a requirement field, because the game does not gate them on rings,
  // clan, or school. What does gate a choice is the question being asked, what
  // the character already holds, and the handful of entries the rules confer
  // rather than sell. Those are what colour the list — nothing here is invented.
  //   "no"   red    cannot be taken here
  //   "yes"  green  a stated condition, and this character meets it
  //   "open" amber  takeable, but it needs a subject naming
  function pecStatus(e, kinds) {
    if (kinds.indexOf(e.kind) < 0)
      return { state: "no",
               why: "Question asks for a " + kinds.join(" or ") + "." };

    if (/^Shadowlands Taint/i.test(e.name))
      return { state: "no",
               why: "Instilled by the Afflicted condition, an oni, or a cursed " +
                    "mask. Never chosen at creation." };

    var mine = heldPeculiarities().filter(function (h) {
      return normName(h) === normName(e.name);
    });
    if (mine.length) return { state: "no", why: "Already on this character." };

    if (heritageGrantedNames().filter(function (g) {
      return normName(g) === normName(e.name);
    }).length)
      return { state: "yes", why: "Granted by the heritage rolled at question 18." };

    var m = TENET_RE.exec(e.name);
    if (m) {
      var tenet = normName(m[1]);
      var paramount = normName(C.bushido.paramount || "");
      var lesser = normName(C.bushido.lesser || "");
      var disdain = e.name.indexOf("Disdain") === 0;
      if (tenet && tenet === paramount)
        return disdain
          ? { state: "no", why: "Question 8 holds this tenet paramount." }
          : { state: "yes", why: "Question 8 holds this tenet paramount." };
      if (tenet && tenet === lesser)
        return disdain
          ? { state: "yes", why: "Question 8 holds this tenet least significant." }
          : { state: "no", why: "Question 8 holds this tenet least significant, " +
                                "and a Paragon believes in it utterly." };
    }

    // the catalog keeps an open-ended entry's bracket text ("Ally [Name]")
    if (e.clan)
      return { state: "open",
               why: "Open-ended. Name the " + e.clan.toLowerCase() + " it applies to." };

    return { state: "plain", why: "" };
  }

  var SOURCE_LABEL = {};
  function sourceLabel(s) {
    if (!s) return "";
    if (!SOURCE_LABEL[s]) {
      SOURCE_LABEL[s] = s.replace(/_/g, " ").replace(/\b\w/g, function (c) {
        return c.toUpperCase();
      });
    }
    return SOURCE_LABEL[s];
  }

  /* One picker serves every question that hands out an advantage or a
     disadvantage: questions 9 to 12 take a single kind, question 13 takes
     either of a pair. It filters, it reads out the compendium's own words, it
     rolls at random, and it says plainly what a character may not take and why. */
  function peculiarityPicker(body, kinds, get, set) {
    var all = CATALOG.filter(function (e) {
      return e.sub_type === "peculiarity" && kinds.indexOf(e.kind) >= 0;
    }).sort(function (a, b) { return a.name.localeCompare(b.name); });

    var bar = document.createElement("div");
    bar.className = "pec-bar";
    var search = document.createElement("input");
    search.type = "search";
    search.className = "pec-search";
    search.placeholder = "Filter " + all.length + " by name, ring, type, book, or rule text";
    var rand = document.createElement("button");
    rand.type = "button";
    rand.className = "btn ghost pec-random";
    rand.textContent = "Choose at random";
    rand.title = "Picks from whatever the filter is showing, skipping anything " +
                 "this character may not take";
    var count = document.createElement("span");
    count.className = "pec-count";
    bar.appendChild(search);
    bar.appendChild(rand);
    bar.appendChild(count);
    body.appendChild(bar);

    var legend = document.createElement("p");
    legend.className = "pec-legend muted small";
    legend.innerHTML =
      '<span class="pec-key yes"></span> a stated condition this character meets ' +
      '<span class="pec-key open"></span> needs a subject named ' +
      '<span class="pec-key no"></span> cannot be taken here';
    body.appendChild(legend);

    var list = document.createElement("div");
    list.className = "pick-list pec-list";
    body.appendChild(list);

    var open = {};          // uuid -> its text is showing
    var shown = [];

    function matches(e, q) {
      if (!q) return true;
      var t = PEC_TEXT[e.uuid] || {};
      return (e.name + " " + (e.kind || "") + " " + (e.ring || "") + " " +
              (t.types || "") + " " + sourceLabel(e.source_book) + " " +
              (t.text || "")).toLowerCase().indexOf(q) >= 0;
    }

    function draw() {
      var q = search.value.trim().toLowerCase();
      var current = get();
      shown = all.filter(function (e) { return matches(e, q); });
      var takeable = shown.filter(function (e) {
        return pecStatus(e, kinds).state !== "no";
      });
      count.textContent = shown.length + " shown, " + takeable.length + " takeable";
      rand.disabled = !takeable.length;

      list.innerHTML = shown.map(function (e) {
        var st = pecStatus(e, kinds);
        var t = PEC_TEXT[e.uuid] || {};
        var active = !!current && normName(e.name) === normName(current);
        var meta = [e.ring ? cap(e.ring) : null, t.types || null,
                    sourceLabel(e.source_book) +
                      (e.source_page ? " p." + e.source_page : "")]
          .filter(Boolean).join(" · ");
        return '<div class="pec' + (active ? " is-active" : "") + " st-" + st.state +
          '" data-u="' + esc(e.uuid) + '">' +
          '<button type="button" class="pick pec-pick" data-u="' + esc(e.uuid) + '">' +
            '<span class="pick-n">' + esc(e.name) +
              (e.clan ? ' <span class="pec-open">[' + esc(e.clan) + "]</span>" : "") +
              (kinds.length > 1 ? ' <span class="pec-kind">' + esc(e.kind) + "</span>" : "") +
            "</span>" +
            '<span class="pick-m">' + esc(meta) + "</span>" +
            (st.why ? '<span class="pec-why">' + esc(st.why) + "</span>" : "") +
          "</button>" +
          '<button type="button" class="pec-more" data-u="' + esc(e.uuid) + '"' +
            ' aria-expanded="' + (open[e.uuid] ? "true" : "false") + '">' +
            (open[e.uuid] ? "Hide" : "Text") + "</button>" +
          (open[e.uuid]
            ? '<div class="pec-text">' +
              (t.via
                ? '<p class="pec-src">The rule is stated once, as <strong>' +
                  esc(t.via) + "</strong>.</p>"
                : "") +
              (syms(t.text) || '<p class="muted">No effect recorded in the corpus.</p>') +
              '<p class="pec-src">From the DSL corpus' +
              (t.dsl && t.dsl !== e.name ? " as " + esc(t.dsl) : "") + ".</p>" +
              "</div>"
            : "") +
          "</div>";
      }).join("") || '<p class="muted small">Nothing matches.</p>';

      Array.prototype.forEach.call(list.querySelectorAll(".pec-more"), function (b) {
        b.addEventListener("click", function () {
          var u = b.getAttribute("data-u");
          open[u] = !open[u];
          draw();
        });
      });
      Array.prototype.forEach.call(list.querySelectorAll(".pec-pick"), function (b) {
        b.addEventListener("click", function () {
          var e = all.filter(function (x) {
            return x.uuid === b.getAttribute("data-u");
          })[0];
          if (!e) return;
          var st = pecStatus(e, kinds);
          if (st.state === "no" &&
              !confirm(e.name + " — " + st.why +
                       "\n\nTake it anyway? Nothing downstream will stop you.")) return;
          set(!!get() && normName(get()) === normName(e.name) ? null : e.name);
          draw();
        });
      });
    }

    search.addEventListener("input", draw);
    rand.addEventListener("click", function () {
      var pool = shown.filter(function (e) {
        return pecStatus(e, kinds).state !== "no";
      });
      if (!pool.length) return;
      var e = pool[Math.floor(Math.random() * pool.length)];
      set(e.name);
      open[e.uuid] = true;
      draw();
      var row = list.querySelector('.pec[data-u="' + e.uuid + '"]');
      if (row) row.scrollIntoView({ block: "center" });
    });
    draw();
  }

  function peculiarityStep(kind, listKey) {
    return function (body) {
      peculiarityPicker(body, [kind],
        function () { return C[listKey][0] || null; },
        function (v) { C[listKey] = v ? [v] : []; save(); });
    };
  }

  var STEPS = [
    { id: "name", n: 0, label: "Begin", title: "Begin a New Character",
      desc: "Give your character a working name. You can change it later. L5R5e characters are samurai of Rokugan; the final name is conventionally &lt;Family&gt; &lt;Personal&gt;.",
      done: function () { return has(C.name); },
      render: function (body) {
        ownNameSection(body);

        label(body, "Character mode");
        choice(body, MODES.map(function (m) {
          return [m.key, m.label + " — " + m.book];
        }), mode(), function (v) {
          if (v === C.mode) return;
          C.mode = v;
          // the first two questions differ by mode, so their answers cannot carry
          C.clan = C.family = C.region = C.upbringing = null;
          C.school = C.role = null;
          save(); render();
        });
        var note = document.createElement("p");
        note.className = "muted small";
        note.innerHTML = isCore()
          ? "A samurai of a Great or Minor Clan. Questions 1 and 2 are clan and family."
          : "Questions 1 and 2 become <strong>region</strong> and <strong>upbringing</strong>, " +
            "and the clan-relationship question is dropped — these characters have no clan.";
        body.appendChild(note);

        label(body, "Concept");
        var hint = document.createElement("p");
        hint.className = "muted small";
        hint.innerHTML = "Anything loose you are holding about this character — a " +
          "premise, an image, a line of dialogue, a role at the table. Every AI " +
          "suggestion is given this as context. <strong>It is not exported</strong>: " +
          "it shapes the character without becoming part of it.";
        body.appendChild(hint);
        var ta = document.createElement("textarea");
        ta.rows = 5;
        ta.placeholder = "A duellist who has never drawn in anger; the family owes a debt no one will name…";
        ta.value = C.concept || "";
        ta.addEventListener("input", function () { C.concept = ta.value; save(); });
        body.appendChild(ta);
      } },

    { id: "clan", n: 1,
      label: function () { return isCore() ? "Clan" : "Region"; },
      title: function () { return qText(1) || (isCore() ? "Choose Your Clan" : "Choose Your Region"); },
      desc: function () {
        return isCore()
          ? "Every samurai belongs to a clan. The clan you choose shapes your culture, politics, and starting skills."
          : "These characters come from the wider world rather than a clan. Pick the region that shaped you: where you grew up, what you saw, what was scarce or abundant.";
      },
      done: function () { return isCore() ? has(C.clan) : has(C.region); },
      render: function (body) {
        if (!isCore()) {
          var regions = originSet();
          pickList(body, regions.map(function (r) {
            return { value: r.name, label: r.name,
                     meta: [r.ring_increase, r.skill_increase || r.skill_increases,
                            r.glory != null ? "Glory " + r.glory : null]
                       .filter(Boolean).join(" · ") };
          }), C.region, function (v) { C.region = v; save(); });
          return;
        }
        var items = CLANS.map(function (c) {
          return { value: c.clan_short_name || c.name, label: c.name,
                   meta: [ringLine(c.ring_bonus), skillLine(c.skill_bonus),
                          c.starting_status ? "Status " + c.starting_status : null]
                     .filter(Boolean).join(" · ") };
        });
        pickList(body, items, C.clan, function (v) {
          if (C.clan !== v) {
            var was = clanTenets();
            C.family = null; C.school = null; C.role = null;
            C.choices = {};
            // an untouched default belongs to the old clan; a deliberate answer stays
            if (was && C.bushido.paramount === was.paramount[0]) C.bushido.paramount = null;
            if (was && C.bushido.lesser === was.lesser[0]) C.bushido.lesser = null;
          }
          C.clan = v; applyTenetDefaults(); save(); render();
        });
        var cl = find(CLANS, C.clan) || find(CLANS, C.clan + " Clan");
        renderChoices(body, cl, "clan");
      } },

    { id: "family", n: 2,
      label: function () { return isCore() ? "Family" : "Upbringing"; },
      title: function () { return qText(2) || (isCore() ? "Choose Your Family" : "Choose Your Upbringing"); },
      desc: function () {
        return isCore()
          ? "Within your clan, choose a family. Each emphasises a different ring or set of skills, and sets your starting wealth and glory."
          : "Your upbringing — craftsperson, hunter, temple acolyte, fallen noble, and so on. It grants ring and skill bonuses, sets your starting wealth, and adjusts your Status.";
      },
      done: function () { return isCore() ? has(C.family) : has(C.upbringing); },
      render: function (body) {
        if (!isCore()) {
          pickList(body, UPBRINGINGS.map(function (u) {
            return { value: u.name, label: u.name,
                     meta: [u.ring_increase, u.skill_increases,
                            u.starting_wealth,
                            u.status_modification != null
                              ? "Status " + (u.status_modification > 0 ? "+" : "") +
                                u.status_modification : null]
                       .filter(Boolean).join(" · ") };
          }), C.upbringing, function (v) { C.upbringing = v; save(); });
          return;
        }
        // No clan is not a dead end: a character can carry a family name without
        // one, and Iuchi Nergüi in the archive does exactly that.
        var pool = clanFilter(body, "family_all", "families",
                              familiesOf(C.clan), FAMILIES, find(FAMILIES, C.family));
        var showingAll = pool === FAMILIES;
        var items = pool.map(function (f) {
          return { value: f.name, label: f.name,
                   meta: [showingAll ? f.clan : null,
                          ringLine(f.ring_increase), skillLine(f.skill_increases),
                          f.starting_wealth ? f.starting_wealth + " koku" : null,
                          f.glory ? "Glory " + f.glory : null].filter(Boolean).join(" · ") };
        });
        pickList(body, items, C.family, function (v) {
          if (v !== C.family) {
            Object.keys(C.choices || {}).forEach(function (k) {
              if (k.indexOf("family.") === 0) delete C.choices[k];
            });
          }
          C.family = v; save(); render();
        });
        renderChoices(body, find(FAMILIES, C.family), "family");
      } },

    { id: "school", n: 3, label: "School", title: function () { return qText(3) || "Choose Your School"; },
      desc: "Your school determines your starting techniques, your curriculum, your starting skills, and your starting honor and outfit.",
      done: function () { return has(C.school) && choicesMade(schoolByRollName(C.school), "school"); },
      render: function (body) {
        var current = schoolByRollName(C.school);
        var pool = clanFilter(body, "school_all", "schools",
                              C.clan ? SCHOOLS.filter(function (x) { return x.clan === C.clan; })
                                     : [],
                              SCHOOLS, current);
        var showAll = pool === SCHOOLS;

        var items = pool.map(function (s) {
          return { value: rollName(s.name), label: rollName(s.name),
                   meta: [showAll ? (s.clan || "No clan") : null,
                          (s.roles || []).join(", "), ringLine(s.ring_increase),
                          s.starting_honor ? "Honor " + s.starting_honor : null,
                          s.school_ability].filter(Boolean).join(" · ") };
        });
        // show the draft's own school as selected even if it is spelled the
        // character source's way rather than the picker's
        pickList(body, items, current ? rollName(current.name) : C.school, function (v) {
          if (v !== C.school) {
            // the old school's picks are meaningless against a new one
            Object.keys(C.choices || {}).forEach(function (k) {
              if (k.indexOf("school.") === 0) delete C.choices[k];
            });
          }
          C.school = v;
          var s = schoolByRollName(v);
          C.role = s && s.roles ? s.roles[0] : null;
          save(); render();
        });
        var sch = schoolByRollName(C.school);
        if (!sch) return;
        renderChoices(body, sch, "school");
        var needsInspired = (sch.starting_techniques || []).some(function (g) {
          return (g.options || []).some(function (o) { return INSPIRED.test(o); });
        });
        if (needsInspired) {
          chooseGroup(body, "school.inspired", "Inspired element",
                      { n: 1, options: inspiredOptions(sch), yield_value: 0 },
                      null, false, function () {
                        // the invocations on offer are the new element's now
                        Object.keys(C.choices || {}).forEach(function (k) {
                          if (k.indexOf("school.tech.") === 0) delete C.choices[k];
                        });
                      });
        }
        var inspired = chosen("school.inspired")[0] || null;

        (sch.starting_techniques || []).forEach(function (g, i) {
          if (g.kind !== "choose") return;
          var opts = g.options, note = null;
          if (g.options.length === 1 && INSTRUCTION.test(g.options[0])) {
            var byRing = INSPIRED.test(g.options[0]) ? inspired : null;
            if (INSPIRED.test(g.options[0]) && !byRing) {
              note = "Choose an inspired element above and this list fills in.";
              opts = [];
            } else {
              opts = expandInstruction(g.options[0], g.category, byRing);
            }
          }
          if (!opts.length) {
            label(body, cap(g.category || "Technique") + " — choose " + (g.n || 1));
            var p = document.createElement("p");
            p.className = "muted small";
            p.textContent = note || g.options[0];
            body.appendChild(p);
            return;
          }
          chooseGroup(body, "school.tech." + i,
                      cap(g.category || "Technique") +
                        (opts !== g.options && inspired ? " (" + inspired + ")" : ""),
                      { n: g.n || 1, options: opts, yield_value: 1 },
                      null, true);
        });
      } },

    { id: "standout", n: 4, label: "Standout", title: function () { return qText(4) || "A Standout Quality"; },
      desc: function () {
        return qAlt(4)
          ? "Choose the temperament that gets your character into trouble, and out of it again. Each grants a different ring."
          : "Pick one ring to raise by +1, reflecting a moment from your character's past that defines what sets them apart from their peers.";
      },
      done: function () { return has(C.standout_ring) && has(C.answers.standout_quality); },
      render: function (body) {
        var alt = qAlt(4);
        if (alt && alt.options) {
          // the ring is not free here: each temperament grants a stated one
          optionRow(body, "q4.trouble", alt.options, function (label) {
            var o = alt.options.filter(function (x) { return x.label === label; })[0];
            C.standout_ring = o ? ringFromEffect(o.text) : null;
            save();
          });
        } else {
          ringPicker(body, C.standout_ring, function (r) { C.standout_ring = r; save(); });
        }
        textStep("standout", "answers.standout_quality", "standout_quality",
          alt ? "What gets them into trouble?" : "What sets them apart?")(body);
      } },

    { id: "giri", n: 5, label: "Giri", title: function () { return qText(5) || "Giri (Duty)"; },
      desc: function () {
        return qAlt(5)
          ? "These characters have no lord, so a past replaces giri. It works the same way: something that drives them, and that their ninjō can run against."
          : "Every samurai owes a duty. What is your giri, and to whom? Name the lord or institution you serve, and the obligation it places on your shoulders.";
      },
      done: function () {
        return has(qAlt(5) ? C.answers.past : C.answers.giri);
      },
      render: function (body) {
        var alt = qAlt(5);
        if (!alt) {
          lordSection(body);
          textStep("giri", "answers.giri", "giri", "Whom do you serve, and how?")(body);
          return;
        }
        var table = (QUESTIONS["5"] && QUESTIONS["5"].pow || {}).table;
        if (table) {
          label(body, "Sample pasts — " + table.die);
          optionRow(body, "q5.past", table.rows.map(function (r) {
            return { label: r.label, text: r.text };
          }));
        }
        textStep("past", "answers.past", "past", "What drives them, and what does it cost?")(body);
      } },

    { id: "ninjo", n: 6, label: "Ninjō", title: function () { return qText(6) || "Ninjō (Desire)"; },
      desc: "Your ninjō is the thing your character wants for themselves, which lives in tension with their giri. A good ninjō can't be satisfied without compromising the duty.",
      done: function () { return has(C.answers.ninjo); },
      render: textStep("ninjo", "answers.ninjo", "ninjo", "What do they long for?") },

    { id: "clan-tie", n: 7, label: "Clan Tie", title: function () { return qText(7) || "Relationship with Your Clan"; },
      desc: function () {
        return qAlt(7)
          ? "These characters answer to no clan. What are they known for where they have been, and did it earn them standing or a skill learned the hard way?"
          : "How does your character relate to their clan? <strong>A) Embrace it</strong> — you exemplify the clan's ideals, +5 Glory. <strong>B) Diverge</strong> — you walk a different path, +1 rank in a skill of your choice.";
      },
      done: function () {
        if (qAlt(7)) return chosen("q7.known").length > 0 && has(C.answers.known_for);
        return has(C.answers.clan_relationship.path);
      },
      render: function (body) {
        var alt7 = qAlt(7);
        if (alt7) {
          optionRow(body, "q7.known", alt7.options || []);
          // the wicked branch grants a rank in a skill currently at 0
          if (/skill/i.test(((alt7.options || []).filter(function (o) {
                return o.label === chosen("q7.known")[0];
              })[0] || {}).text || "")) {
            label(body, "The skill it taught them (one currently at 0 ranks)");
            skillPicker(body, C.answers.known_skill, function (sk) {
              var was = C.answers.known_skill;
              if (was) C.skills[was] = (C.skills[was] || 1) - 1;
              C.answers.known_skill = sk;
              C.skills[sk] = (C.skills[sk] || 0) + 1;
              save();
            });
          }
          textStep("known-for", "answers.known_for", "known_for",
            "What are they known for, and to whom?")(body);
          return;
        }
        choice(body, [["A", "Embrace — +5 Glory"], ["B", "Diverge — +1 skill rank"]],
          C.answers.clan_relationship.path, function (v) {
            C.answers.clan_relationship.path = v; save(); render();
          });
        if (C.answers.clan_relationship.path === "B") {
          skillPicker(body, C.answers.clan_relationship.skill, function (s) {
            var old = C.answers.clan_relationship.skill;
            if (old) C.skills[old] = (C.skills[old] || 1) - 1;
            C.answers.clan_relationship.skill = s;
            C.skills[s] = (C.skills[s] || 0) + 1;
            save();
          });
        }
        textStep("clan-tie", "answers.clan_relationship.text", "clan_relationship",
          "How do they carry, or resist, the clan's ideals?")(body);
      } },

    { id: "bushido", n: 8, label: "Bushidō", title: function () { return qText(8) || "Tenets of Bushidō"; },
      desc: "Select one tenet as paramount (the one you live by) and one as lesser (the one you struggle with). Then your attitude: <strong>A) Devoted</strong> — +10 Honor, or <strong>B) Nuanced</strong> — +1 rank in a skill.",
      done: function () {
        return has(C.bushido.paramount) && has(C.bushido.lesser) && has(C.bushido.attitude);
      },
      render: function (body) {
        // The core book's Clan Views of Bushidō give each Great Clan a paramount
        // tenet and one or two lesser ones. Those are the defaults; the question
        // is still the player's to answer, so they are only a starting point.
        var def = clanTenets();
        applyTenetDefaults();

        if (def) {
          var note = document.createElement("p");
          note.className = "muted small";
          note.innerHTML = "<strong>" + esc(C.clan) + "</strong> holds " +
            "<strong>" + esc(def.paramount.join(" and ")) + "</strong> paramount and " +
            "<strong>" + esc(def.lesser.join(" and ")) + "</strong> less significant" +
            (def.lesser.length > 1 ? " (both)" : "") +
            ". Filled in below — change either if this character sees it differently.";
          body.appendChild(note);
        }

        label(body, "Paramount tenet");
        choice(body, BUSHIDO.map(function (t) {
          return [t, t + (def && def.paramount.indexOf(t) >= 0 ? " ✦" : "")];
        }), C.bushido.paramount,
          function (v) { C.bushido.paramount = v; save(); render(); });
        label(body, "Lesser tenet");
        choice(body, BUSHIDO.map(function (t) {
          return [t, t + (def && def.lesser.indexOf(t) >= 0 ? " ✦" : "")];
        }), C.bushido.lesser,
          function (v) { C.bushido.lesser = v; save(); render(); });
        label(body, "Attitude");
        choice(body, [["A", "Devoted — +10 Honor"], ["B", "Nuanced — +1 skill rank"]],
          C.bushido.attitude, function (v) { C.bushido.attitude = v; save(); render(); });
        if (C.bushido.attitude === "B") {
          skillPicker(body, C.bushido.skill, function (s) {
            var old = C.bushido.skill;
            if (old) C.skills[old] = (C.skills[old] || 1) - 1;
            C.bushido.skill = s;
            C.skills[s] = (C.skills[s] || 0) + 1;
            save();
          });
        }
      } },

    { id: "distinction", n: 9, label: "Distinction",
      title: function () { return qText(9) || "A Distinction"; },
      desc: function () {
        return "Answer in your character's own history, then take the distinction that records it.";
      },
      done: function () { return has(C.answers.accomplishment) && C.distinctions.length > 0; },
      render: function (body) {
        textStep("distinction", "answers.accomplishment", "accomplishment", "What did they do?")(body);
        label(body, "The distinction it earns them:");
        peculiarityStep("distinction", "distinctions")(body);
      } },

    { id: "adversity", n: 10, label: "Adversity",
      title: function () { return qText(10) || "An Adversity"; },
      desc: function () {
        return "Answer first, then take the adversity that carries it.";
      },
      done: function () { return has(C.answers.challenge) && C.adversities.length > 0; },
      render: function (body) {
        textStep("adversity", "answers.challenge", "challenge", "What holds them back?")(body);
        label(body, "The adversity it reflects:");
        peculiarityStep("adversity", "adversities")(body);
      } },

    { id: "passion", n: 11, label: "Passion",
      title: function () { return qText(11) || "A Passion"; },
      desc: function () {
        return "Answer first, then take the passion that names it.";
      },
      done: function () { return has(C.answers.peace) && C.passions.length > 0; },
      render: function (body) {
        textStep("passion", "answers.peace", "peace", "What do they do for themselves?")(body);
        label(body, "The passion it becomes:");
        peculiarityStep("passion", "passions")(body);
      } },

    { id: "anxiety", n: 12, label: "Anxiety",
      title: function () { return qText(12) || "An Anxiety"; },
      desc: function () {
        return "Answer first, then take the anxiety that names it.";
      },
      done: function () { return has(C.answers.fear) && C.anxieties.length > 0; },
      render: function (body) {
        textStep("anxiety", "answers.fear", "fear", "What troubles them?")(body);
        label(body, "The anxiety it names:");
        peculiarityStep("anxiety", "anxieties")(body);
      } },

    { id: "mentor", n: 13, label: "Mentor", title: function () { return qText(13) || "A Mentor"; },
      desc: "Name a mentor and describe the relationship. Then choose: <strong>A)</strong> an additional advantage (distinction or passion), or <strong>B)</strong> an additional disadvantage plus +1 rank in a skill.",
      done: function () {
        var m = C.answers.mentor;
        return has(m.name) && has(m.path) && has(m.granted) &&
          (m.path !== "B" || has(m.skill));
      },
      render: function (body) {
        var i = document.createElement("input");
        i.type = "text"; i.placeholder = "Mentor's name";
        i.value = C.answers.mentor.name || "";
        i.addEventListener("input", function () { C.answers.mentor.name = i.value; save(); });
        body.appendChild(i);
        choice(body, [["A", "An extra advantage"], ["B", "An extra disadvantage + skill"]],
          C.answers.mentor.path, function (v) {
            if (v === C.answers.mentor.path) return;
            C.answers.mentor.path = v;
            C.answers.mentor.granted = null;   // the kinds on offer just changed
            save(); render();
          });
        if (C.answers.mentor.path === "B") {
          skillPicker(body, C.answers.mentor.skill, function (s) {
            var old = C.answers.mentor.skill;
            if (old) C.skills[old] = (C.skills[old] || 1) - 1;
            C.answers.mentor.skill = s;
            C.skills[s] = (C.skills[s] || 0) + 1;
            save();
          });
        }
        // Path A is a distinction or a passion; path B an adversity or an
        // anxiety (core p.36). Until now the question recorded the choice
        // without ever letting the extra be picked.
        if (C.answers.mentor.path) {
          label(body, C.answers.mentor.path === "A"
            ? "The extra advantage" : "The extra disadvantage");
          peculiarityPicker(body,
            C.answers.mentor.path === "A" ? ["distinction", "passion"]
                                          : ["adversity", "anxiety"],
            function () { return C.answers.mentor.granted || null; },
            function (v) { C.answers.mentor.granted = v; save(); });
        }
        textStep("mentor", "answers.mentor.text", "mentor_relationship",
          "What were they taught, and at what cost?")(body);
      } },

    { id: "appearance", n: 14, label: "Appearance", title: function () { return qText(14) || "First Impression"; },
      desc: function () {
        return qAlt(14)
          ? "When everything you own fits in a pack, one thing still matters more than the rest. Choose it from your outfit, or any item of rarity 5 or lower."
          : "Describe your character's appearance and a distinctive accoutrement they always carry.";
      },
      done: function () {
        return has(qAlt(14) ? C.answers.prized_possession : C.answers.first_impression);
      },
      render: function (body) {
        var alt = qAlt(14);
        if (!alt) {
          textStep("appearance", "answers.first_impression", "first_impression",
            "How do they strike a stranger?")(body);
          return;
        }
        label(body, "The possession");
        var items = CATALOG.filter(function (e) {
          return ["item", "weapon", "armor"].indexOf(e.sub_type) >= 0 &&
                 (e.rank == null || true);
        }).map(function (e) {
          return { value: e.name, label: e.name,
                   meta: [cap(e.sub_type), e.source_book].filter(Boolean).join(" · ") };
        });
        pickList(body, items, chosen("q14.prized")[0] || null, function (v) {
          setChosen("q14.prized", [v]);
        });
        if (alt.gain) {
          var g = document.createElement("p");
          g.className = "muted small";
          g.textContent = alt.gain;
          body.appendChild(g);
        }
        textStep("prized", "answers.prized_possession", "prized_possession",
          "Why this one?")(body);
      } },

    { id: "stress", n: 15, label: "Stress", title: function () { return qText(15) || "Stress Reaction"; },
      desc: "How does your character react under duress? Pushed past their composure, do they rage, withdraw, scheme, freeze?",
      done: function () { return has(C.answers.stress_reaction); },
      render: textStep("stress", "answers.stress_reaction", "stress_reaction",
        "What happens when they break?") },

    { id: "ties", n: 16, label: "Ties & Item", title: function () { return qText(16) || "Relationships & Starting Item"; },
      desc: "Name a few people important to your character. Then pick a starting item of rarity 7 or lower.",
      done: function () { return has(C.starting_item); },
      render: function (body) {
        textStep("ties", "answers.relationships", "relationships",
          "Rivals, allies, family, lovers…")(body);
        label(body, "Starting item");
        var items = CATALOG.filter(function (e) {
          return ["item", "weapon", "armor"].indexOf(e.sub_type) >= 0;
        }).map(function (e) {
          return { value: e.name, label: e.name,
                   meta: [cap(e.sub_type), e.source_book].filter(Boolean).join(" · ") };
        });
        pickList(body, items, C.starting_item, function (v) { C.starting_item = v; save(); });
      } },

    { id: "parent", n: 17, label: "Parent", title: function () { return qText(17) || "A Parent's Opinion"; },
      desc: function () {
        return qAlt(17)
          ? "Answered with the group and the GM. Choose a prompt, answer it together, and settle on a bond between you."
          : "Describe a parent or guardian and their opinion of your character. Then gain +1 rank in a skill you currently have at rank 0.";
      },
      done: function () {
        if (qAlt(17)) return chosen("q17.history").length > 0 && has(C.answers.group_history);
        return has(C.answers.parent_opinion.description) && has(C.answers.parent_opinion.skill);
      },
      render: function (body) {
        var alt = qAlt(17);
        if (alt) {
          optionRow(body, "q17.history", alt.prompts || []);
          textStep("group-history", "answers.group_history", "group_history",
            "Answer it — who, and what happened?")(body);
          if (alt.gain) {
            var g = document.createElement("p");
            g.className = "muted small";
            g.textContent = alt.gain;
            body.appendChild(g);
          }
          return;
        }
        textStep("parent", "answers.parent_opinion.description", "parent_opinion",
          "What do they say of their child?")(body);
        label(body, "Skill raised");
        skillPicker(body, C.answers.parent_opinion.skill, function (s) {
          var old = C.answers.parent_opinion.skill;
          if (old) C.skills[old] = (C.skills[old] || 1) - 1;
          C.answers.parent_opinion.skill = s;
          C.skills[s] = (C.skills[s] || 0) + 1;
          save();
        });
      } },

    { id: "heritage", n: 18, label: "Heritage", title: function () { return qText(18) || "Family Heritage"; },
      desc: function () {
        return qAlt(18)
          ? "Most people know who raised them; some do not. Record the relationship, and the skill it left behind."
          : "Roll d10 (or pick) on a heritage table. The result says something about your family's past, and usually carries a modifier and a second roll. The core Samurai table is the default; most supplements offer a replacement table you may use instead.";
      },
      done: function () {
        if (qAlt(18)) return has(C.answers.raised_by) && has(C.answers.raised_skill);
        return has(C.answers.heritage);
      },
      render: function (body) {
        var alt18 = qAlt(18);
        if (alt18) {
          textStep("raised", "answers.raised_by", "raised_by",
            "Who raised them, and how do they feel about it?")(body);
          label(body, "The skill it left them (one currently at 0 ranks)");
          skillPicker(body, C.answers.raised_skill, function (sk) {
            var was = C.answers.raised_skill;
            if (was) C.skills[was] = (C.skills[was] || 1) - 1;
            C.answers.raised_skill = sk;
            C.skills[sk] = (C.skills[sk] || 0) + 1;
            save();
          });
          return;
        }
        var keys = Object.keys(HERITAGES);
        if (!keys.length) return needs(body, "No heritage tables loaded.");

        label(body, "Heritage table");
        var tabs = document.createElement("div");
        tabs.className = "choicerow";
        tabs.innerHTML = keys.map(function (k) {
          var t = HERITAGES[k];
          var unencoded = t.form === "unencoded";
          return '<button type="button" class="choice' +
            (k === C.answers.heritage_table ? " active" : "") +
            (unencoded ? " disabled" : "") + '" data-v="' + esc(k) + '"' +
            (unencoded ? " disabled title=\"Named in the book but not encoded in the DSL corpus\"" : "") +
            ">" + esc(t.name.replace(/^New Samurai Heritages?\s*/i, "")
                        .replace(/Table$/, "").trim() || t.name) +
            '<span class="ch-n">' + (unencoded ? "—" : t.entries.length) + "</span></button>";
        }).join("");
        Array.prototype.forEach.call(tabs.querySelectorAll(".choice"), function (b) {
          if (b.disabled) return;
          b.addEventListener("click", function () {
            C.answers.heritage_table = b.getAttribute("data-v");
            C.answers.heritage = null;
            C.answers.heritage_sub = null;
            save(); render();
          });
        });
        body.appendChild(tabs);

        var key = C.answers.heritage_table || keys.filter(function (k) {
          return HERITAGES[k].form !== "unencoded";
        })[0];
        C.answers.heritage_table = key;
        var table = HERITAGES[key];
        var src = document.createElement("p");
        src.className = "muted small";
        src.innerHTML = "<strong>" + esc(table.name) + "</strong> — " +
          table.entries.length + " entries · <code>" + esc(table.source) + "</code>";
        body.appendChild(src);

        var roll = document.createElement("button");
        roll.type = "button"; roll.className = "btn ghost"; roll.textContent = "Roll d10";
        roll.addEventListener("click", function () {
          var e = table.entries[Math.floor(Math.random() * table.entries.length)];
          C.answers.heritage = e.name;
          C.answers.heritage_sub = null;
          save(); render();
        });
        body.appendChild(roll);

        // full entry cards — the point of the step is reading these
        var list = document.createElement("div");
        list.className = "heritage-list";
        list.innerHTML = table.entries.map(function (e) {
          var active = e.name === C.answers.heritage;
          var mods = Object.keys(e.modifiers || {}).map(function (k2) {
            return k2 === "note" ? e.modifiers[k2] : k2 + " " + e.modifiers[k2];
          }).join(" · ");
          return '<button type="button" class="heritage' + (active ? " active" : "") +
            '" data-v="' + esc(e.name) + '">' +
            '<span class="h-roll">' + esc(e.roll || "—") + "</span>" +
            '<span class="h-body"><span class="h-name">' + esc(e.name) + "</span>" +
            (e.description ? '<span class="h-desc">' + esc(e.description) + "</span>" : "") +
            (mods ? '<span class="h-mod">' + esc(mods) + "</span>" : "") +
            (e.effect ? '<span class="h-eff">' + esc(e.effect) + "</span>" : "") +
            (e.sub_table
              ? '<span class="h-sub">' + esc(e.sub_table.die) + ": " +
                e.sub_table.ranges.map(function (r) {
                  return "<em>" + esc(r.range) + "</em> " + esc(r.text);
                }).join(" · ") + "</span>"
              : "") +
            "</span></button>";
        }).join("");
        Array.prototype.forEach.call(list.querySelectorAll(".heritage"), function (b) {
          b.addEventListener("click", function () {
            C.answers.heritage = b.getAttribute("data-v");
            C.answers.heritage_sub = null;
            save(); render();
          });
        });
        body.appendChild(list);

        // second roll, where the chosen entry has one
        var chosen = table.entries.filter(function (e) {
          return e.name === C.answers.heritage;
        })[0];
        if (chosen && chosen.sub_table) {
          label(body, "Second roll — " + chosen.sub_table.die);
          var subRoll = document.createElement("button");
          subRoll.type = "button"; subRoll.className = "btn ghost";
          subRoll.textContent = "Roll " + chosen.sub_table.die;
          subRoll.addEventListener("click", function () {
            var r = chosen.sub_table.ranges[
              Math.floor(Math.random() * chosen.sub_table.ranges.length)];
            C.answers.heritage_sub = r.range + " — " + r.text;
            save(); render();
          });
          body.appendChild(subRoll);
          pickList(body, chosen.sub_table.ranges.map(function (r) {
            return { value: r.range + " — " + r.text, label: r.text, meta: r.range };
          }), C.answers.heritage_sub, function (v) {
            C.answers.heritage_sub = v; save();
          });
        }
      } },

    { id: "final-name", n: 19, label: "Name", title: function () { return qText(19) || "Your Character's Name"; },
      desc: "Settle on a final name. In Rokugan this is conventionally &lt;Family&gt; &lt;Personal&gt;, family name first.",
      done: function () { return has(C.name); },
      render: ownNameSection },

    { id: "death", n: 20, label: "Death", title: function () { return qText(20) || "Vision of Death"; },
      desc: "How does your character die? A vision, premonition, or expectation of their end — not a prediction the game must honour, but a meaningful death the player invites.",
      done: function () { return has(C.answers.death); },
      render: textStep("death", "answers.death", "death", "The ending they would not regret…") },

    { id: "export", n: 21, label: "Export", title: "Add to the Archive",
      desc: "The creator emits this repo's own character source format. Save it as <code>src/characters/&lt;slug&gt;.json</code>, then run <code>./scripts/pipeline.sh</code> — the build resolves every name to the compendium's verbatim rules text and generates the dossier, the coverage entry, and a playable sheet.",
      done: function () { return false; },
      render: renderExport }
  ];

  /* ---------------------------------------------------------- widgets */

  function label(body, text) {
    var h = document.createElement("h4");
    h.className = "field-label";
    h.textContent = text;
    body.appendChild(h);
  }
  function needs(body, msg) {
    var p = document.createElement("p");
    p.className = "muted";
    p.textContent = msg;
    body.appendChild(p);
  }
  function choice(body, pairs, current, onPick) {
    var wrap = document.createElement("div");
    wrap.className = "choicerow";
    wrap.innerHTML = pairs.map(function (p) {
      return '<button type="button" class="choice' + (p[0] === current ? " active" : "") +
        '" data-v="' + esc(p[0]) + '">' + esc(p[1]) + "</button>";
    }).join("");
    Array.prototype.forEach.call(wrap.querySelectorAll(".choice"), function (b) {
      b.addEventListener("click", function () { onPick(b.getAttribute("data-v")); });
    });
    body.appendChild(wrap);
  }
  /* Clan, family and school each hand out choices — "+1 Earth or Fire", "three
     of these six skills", "two of these four shūji". computed() has always
     spotted them and written a note in the side panel, but there was nowhere to
     actually make one, so every character carried the note and none of the
     ranks. These render the choice where it is granted and record the answer in
     C.choices, keyed by the step and field that granted it. */

  function chosen(key) {
    return (C.choices && C.choices[key]) || [];
  }

  function setChosen(key, list) {
    C.choices = C.choices || {};
    C.choices[key] = list;
    save();
  }

  var TECH_TEXT = window.L5R_TECHNIQUE_TEXT || {};
  // "(op)" and "[Water]" are how the corpus writes the dice symbols and rings;
  // assets/symbols.js renders them the way the play sheet does.
  var syms = window.L5R_SYMBOLS || function (h) { return h || ""; };

  /* Some starting techniques are written as an instruction rather than a list:
     Isawa Tensai's is "Any one rank 1 invocation of your inspired element".
     That is a real choice with a real set behind it, so expand it from the
     compendium instead of showing the sentence as if it were a technique.

     The inspired element is its OWN choice, not the +2 ring — the school
     ability reads "Choose one: Air, Earth, Water, or Fire. This is your
     inspired element" (Fields of Victory p.79), and the ring line is a separate
     "+2 any one ring", Void included. */
  var INSTRUCTION = /\bany one\b|\bchoose\b/i;
  var INSPIRED = /inspired element/i;
  var RANK_IN = /\brank (\d)\b/i;
  var ELEMENTS = ["Air", "Earth", "Fire", "Water", "Void"];

  // The elements a school ability offers, read from its own text.
  function inspiredOptions(sch) {
    var txt = sch && sch.school_ability && TECH_TEXT[normName(sch.school_ability)];
    var plain = String(txt || "").replace(/<[^>]+>/g, " ");
    var m = /Choose one:\s*([^.]+)\./i.exec(plain);
    if (m) {
      var found = ELEMENTS.filter(function (e) {
        return new RegExp("\\b" + e + "\\b", "i").test(m[1]);
      });
      if (found.length) return found;
    }
    return ["Air", "Earth", "Fire", "Water"];
  }

  // The techniques an instruction actually stands for.
  function expandInstruction(option, kind, ring) {
    var m = RANK_IN.exec(option);
    var rank = m ? Number(m[1]) : 1;
    return CATALOG.filter(function (e) {
      return e.sub_type === "technique" &&
        String(e.kind || "").toLowerCase() === String(kind || "").toLowerCase() &&
        e.rank === rank &&
        (!ring || String(e.ring || "").toLowerCase() === String(ring).toLowerCase());
    }).map(function (e) { return e.name; }).sort();
  }

  /* One hover card, moved and refilled rather than one per button — a school
     step can carry twenty options and twenty always-present panels is twenty
     things to keep positioned. Follows the pointer's element, not the pointer. */
  var tipEl = null;

  function tipNode() {
    if (!tipEl) {
      tipEl = document.createElement("div");
      tipEl.className = "rule-tip";
      tipEl.setAttribute("role", "tooltip");
      tipEl.hidden = true;
      document.body.appendChild(tipEl);
    }
    return tipEl;
  }

  function showTip(target, title, html) {
    var t = tipNode();
    t.innerHTML = '<strong class="rt-name">' + esc(title) + "</strong>" + syms(html);
    t.hidden = false;
    var r = target.getBoundingClientRect();
    var w = Math.min(380, window.innerWidth - 24);
    t.style.width = w + "px";
    var left = Math.max(12, Math.min(r.left, window.innerWidth - w - 12));
    var h = t.getBoundingClientRect().height;
    // above the target when there is room, below when there is not
    var top = r.top - h - 8;
    if (top < 8) top = r.bottom + 8;
    // Viewport coordinates, because the card is position:fixed. Absolute
    // positioning on the body made the document grow to contain the card, so
    // hovering anything near the right edge widened the page under the cursor.
    t.style.left = left + "px";
    t.style.top = Math.max(8, Math.min(top, window.innerHeight - h - 8)) + "px";
  }

  function hideTip() {
    if (tipEl) tipEl.hidden = true;
  }

  // Attach the rules text of `name` to a button, on hover and on keyboard focus.
  function wireTip(btn, name) {
    var html = TECH_TEXT[normName(name)];
    if (!html) return;
    btn.classList.add("has-tip");
    btn.addEventListener("mouseenter", function () { showTip(btn, name, html); });
    btn.addEventListener("focus", function () { showTip(btn, name, html); });
    btn.addEventListener("mouseleave", hideTip);
    btn.addEventListener("blur", hideTip);
  }

  function chooseGroup(body, key, heading, spec, fmt, tips, after) {
    var n = spec.n || 1;
    var yield_ = spec.yield_value != null ? spec.yield_value : 1;
    var picked = chosen(key).filter(function (o) { return spec.options.indexOf(o) >= 0; });
    var suffix = yield_ > 1 ? " (+" + yield_ + " each)" : "";
    label(body, heading + " — choose " + n + suffix);

    var row = document.createElement("div");
    row.className = "choicerow choose-group" +
      (picked.length === n ? " done" : "");
    row.innerHTML = spec.options.map(function (o) {
      var on = picked.indexOf(o) >= 0;
      return '<button type="button" class="choice' + (on ? " active" : "") +
        '" data-v="' + esc(o) + '">' + esc(fmt ? fmt(o) : o) + "</button>";
    }).join("") +
      '<span class="choose-n' + (picked.length === n ? " ok" : "") + '">' +
      picked.length + "/" + n + "</span>";

    Array.prototype.forEach.call(row.querySelectorAll(".choice"), function (b) {
      if (tips) wireTip(b, b.getAttribute("data-v"));
      b.addEventListener("click", function () {
        var v = b.getAttribute("data-v");
        var at = picked.indexOf(v);
        var next = picked.slice();
        if (at >= 0) next.splice(at, 1);
        else if (spec.distinct === false || next.indexOf(v) < 0) next.push(v);
        // taking one past the limit drops the oldest, so the row never jams
        while (next.length > n) next.shift();
        setChosen(key, next);
        // `after` may drop dependent picks; save again so the removal persists
        if (after) { after(next); save(); }
        hideTip();
        render();
      });
    });
    body.appendChild(row);
  }

  // Every choice a source grants, as [key, heading, spec] triples.
  function choicesFrom(source, prefix) {
    var out = [];
    if (!source) return out;
    [["ring_bonus", "Ring"], ["ring_increase", "Ring"],
     ["skill_bonus", "Skill"], ["skill_increases", "Skill"],
     ["starting_skills", "Starting skill"]].forEach(function (pair) {
      var v = source[pair[0]];
      if (v && v._choose) {
        out.push([prefix + "." + pair[0], pair[1], v._choose]);
      }
    });
    return out;
  }

  /* Clan is a shortcut on the family and school lists, not a rule. Cross-clan
     training happens, rōnin and gaijin schools have no clan at all, and the
     archive already holds characters trained outside their own clan — so the
     filter is a convenience the player can switch off. `flag` is the field on
     the draft that remembers the choice, per character. */
  function clanFilter(body, flag, noun, mine, all, current) {
    var outside = current && all.indexOf(current) >= 0 && mine.indexOf(current) < 0;
    if (outside) C[flag] = true;                 // never hide the thing in hand
    var showAll = !!C[flag] || !mine.length;

    if (C.clan && mine.length && mine.length < all.length) {
      var row = document.createElement("label");
      row.className = "filtercheck";
      row.innerHTML = '<input type="checkbox"' + (showAll ? "" : " checked") + ">" +
        "<span>Filter to " + esc(C.clan) + " " + noun + "</span>" +
        '<span class="fc-n">' +
          (showAll ? all.length + " shown" : mine.length + " of " + all.length) +
        "</span>";
      row.querySelector("input").addEventListener("change", function (e) {
        C[flag] = !e.target.checked;
        save(); render();
      });
      body.appendChild(row);
      if (outside) {
        var why = document.createElement("p");
        why.className = "muted small";
        why.textContent = (current.name || current) + " is not a " + C.clan + " " +
          noun.replace(/s$/, "") + ", so the list is unfiltered to keep it in view.";
        body.appendChild(why);
      }
    }
    return showAll ? all : mine;
  }

  // A step is not finished while a choice it granted is still open — that is
  // exactly the state that used to slip through and leave ranks unassigned.
  function choicesMade(source, prefix) {
    var ok = choicesFrom(source, prefix).every(function (c) {
      return chosen(c[0]).length >= (c[2].n || 1);
    });
    if (!ok || prefix !== "school" || !source) return ok;
    var groups = source.starting_techniques || [];
    if (groups.some(function (g) {
      return (g.options || []).some(function (o) { return INSPIRED.test(o); });
    }) && !chosen("school.inspired").length) return false;
    return groups.every(function (g, i) {
      return g.kind !== "choose" || chosen("school.tech." + i).length >= (g.n || 1);
    });
  }

  function renderChoices(body, source, prefix) {
    choicesFrom(source, prefix).forEach(function (c) {
      chooseGroup(body, c[0], c[1], c[2],
                  c[1] === "Ring" ? null : function (o) { return o; });
    });
  }

  /* Path of Waves and Writ of the Wilds replace six of the twenty outright.
     These render the replacement where one applies, and are no-ops in core
     mode. Each keeps its own answer field, so switching mode never silently
     reinterprets an answer given to a different question. */

  // A list of labelled options with their effect, as the corpus states them.
  function optionRow(body, key, opts, onPick) {
    var picked = chosen(key)[0] || null;
    var wrap = document.createElement("div");
    wrap.className = "qopts";
    wrap.innerHTML = opts.map(function (o) {
      return '<button type="button" class="qopt' +
        (o.label === picked ? " active" : "") + '" data-v="' + esc(o.label) + '">' +
        '<span class="qo-l">' + esc(o.label) + "</span>" +
        '<span class="qo-t">' + esc(o.text) + "</span></button>";
    }).join("");
    Array.prototype.forEach.call(wrap.querySelectorAll(".qopt"), function (b) {
      b.addEventListener("click", function () {
        var v = b.getAttribute("data-v");
        setChosen(key, chosen(key)[0] === v ? [] : [v]);
        if (onPick) onPick(chosen(key)[0] || null);
        render();
      });
    });
    body.appendChild(wrap);
  }

  // The ring an option grants: "+1 Fire" -> "fire".
  function ringFromEffect(text) {
    var m = /\+1\s*(Air|Earth|Fire|Water|Void)/i.exec(text || "");
    return m ? m[1].toLowerCase() : null;
  }

  /* A name field with a gender toggle and a roll, used for the character and
     for their lord. `family` is a function so the lord's can vary per roll
     while the character's stays their own. */
  function nameSection(body, opts) {
    label(body, opts.heading);

    var row = document.createElement("div");
    row.className = "lord-row";

    var input = document.createElement("input");
    input.type = "text";
    input.placeholder = opts.placeholder || "";
    input.value = opts.get() || "";
    input.addEventListener("input", function () { opts.set(input.value); save(); });
    row.appendChild(input);

    var roll = document.createElement("button");
    roll.type = "button";
    roll.className = "btn ghost lord-roll";
    roll.textContent = "Roll";
    roll.title = "A name from the l5r5e name tables";
    roll.addEventListener("click", function () {
      var n = rollPersonalName(opts.family(), opts.gender() || "any");
      if (!n) return;
      opts.set(n);
      input.value = n;
      save();
      renderWip();
      renderNav();
      renderDrafts();
    });
    row.appendChild(roll);
    body.appendChild(row);

    var g = document.createElement("div");
    g.className = "choicerow lord-gender";
    [["any", "Any"], ["male", "Male"], ["female", "Female"]].forEach(function (o) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "choice" + ((opts.gender() || "any") === o[0] ? " active" : "");
      b.textContent = o[1];
      b.addEventListener("click", function () { opts.setGender(o[0]); save(); render(); });
      g.appendChild(b);
    });
    body.appendChild(g);

    if (opts.note) {
      var note = document.createElement("p");
      note.className = "muted small";
      note.textContent = opts.note;
      body.appendChild(note);
    }
  }

  // The character's own name: their family, and a personal name.
  function ownNameSection(body) {
    nameSection(body, {
      heading: "Name",
      placeholder: C.family ? C.family + " …" : "Family Personal",
      get: function () { return C.name; },
      set: function (v) { C.name = v; },
      gender: function () { return C.gender; },
      setGender: function (v) { C.gender = v; },
      family: function () { return C.family || null; },
      note: C.family
        ? "Rolls a personal name under " + C.family + "."
        : (isCore()
            ? "Choose a family at question 2 and the roll will put it in front of the name."
            : "These characters carry no family name, so the roll gives a personal name alone.")
    });
  }

  // The lord's name at question 5.
  function lordSection(body) {
    nameSection(body, {
      heading: "Your lord's name",
      placeholder: "Name your lord, or roll one",
      get: function () { return C.answers.lord_name; },
      set: function (v) { C.answers.lord_name = v; },
      gender: function () { return C.answers.lord_gender; },
      setGender: function (v) { C.answers.lord_gender = v; },
      family: rollLordFamily,
      note: C.family
        ? "Rolls within the " + C.family + " family, since that is the character's."
        : (C.clan
            ? "Rolls a family from the " + C.clan + " clan."
            : "Choose a clan or family and the roll will stay within it.")
    });
  }

  function ringPicker(body, current, onPick) {
    var wrap = document.createElement("div");
    wrap.className = "rings";
    wrap.innerHTML = RINGS.map(function (r) {
      return '<button type="button" class="ring pickable' +
        (r === current ? " active" : "") + '" data-ring="' + r + '" data-v="' + r + '">' +
        '<div class="rn">' + cap(r) + "</div></button>";
    }).join("");
    Array.prototype.forEach.call(wrap.querySelectorAll("button"), function (b) {
      b.addEventListener("click", function () { onPick(b.getAttribute("data-v")); render(); });
    });
    body.appendChild(wrap);
  }
  function skillPicker(body, current, onPick) {
    var items = [];
    Object.keys(SKILL_GROUPS).forEach(function (g) {
      SKILL_GROUPS[g].forEach(function (s) {
        items.push({ value: s, label: SKILL_LABEL[s], meta: cap(g) });
      });
    });
    pickList(body, items, current, function (v) { onPick(v); render(); });
  }
  function ringLine(obj) {
    if (!obj) return null;
    if (obj._choose) return "+1 " + obj._choose.options.join(" or ");
    return Object.keys(obj).map(function (k) { return "+" + obj[k] + " " + k; }).join(", ");
  }
  function skillLine(obj) {
    if (!obj) return null;
    if (obj._choose) return "+1 to " + obj._choose.n + " of " + obj._choose.options.length;
    return Object.keys(obj).map(function (k) { return "+" + obj[k] + " " + k; }).join(", ");
  }

  /* ---------------------------------------------------------- export */

  function toSourceJson() {
    var d = computed();
    var skills = {};
    Object.keys(SKILL_GROUPS).forEach(function (g) {
      skills[g] = {};
      SKILL_GROUPS[g].forEach(function (s) { skills[g][s] = d.skills[s] || 0; });
    });
    var sch = d.school || {};
    var a = C.answers;
    function refs(names) {
      return (names || []).map(function (n) { return { name: n }; });
    }
    return {
      slug: slugify(C.name),
      name: C.name,
      campaign: C.campaign || null,
      // the Creator only ever writes drafts; see the Promote button
      status: "draft",
      identity: {
        clan: C.clan, family: C.family, school: C.school,
        role: C.role, age: "",
        region: C.region || null, upbringing: C.upbringing || null
      },
      mode: mode(),
      portrait: null,
      concept: a.first_impression || null,
      summary: null,
      // C.concept is deliberately absent: it informs the making of the
      // character and is not part of the finished one.
      notes: C.notes || "",
      twenty_questions: {
        template: isCore() ? "core" : "pow", generated: false,
        steps: {
          step4: { answers: { stand_out: a.standout_quality, ring: C.standout_ring }, picks: {} },
          step5: { answers: { social_giri: a.giri }, picks: {} },
          step6: { answers: { social_ninjo: a.ninjo }, picks: {} },
          step7: { answers: { clan_relations: a.clan_relationship.text }, picks: {} },
          step8: { answers: { tenet_paramount: C.bushido.paramount,
                              tenet_less_significant: C.bushido.lesser }, picks: {} },
          step13: { answers: { most_learn: a.mentor.name + (a.mentor.text ? " — " + a.mentor.text : "") }, picks: {} },
          step14: { answers: { first_sight: a.first_impression }, picks: {} },
          step15: { answers: { stress: a.stress_reaction }, picks: {} },
          step16: { answers: { relations: a.relationships }, picks: {} },
          step17: { answers: { parents_pov: a.parent_opinion.description }, picks: {} },
          step18: { answers: {
            heritage_name: a.heritage,
            heritage_table: (HERITAGES[a.heritage_table] || {}).name || a.heritage_table,
            heritage_sub: a.heritage_sub
          }, picks: {} },
          step20: { answers: { death: a.death }, picks: {} }
        }
      },
      tiers: [{
        xp: 0, label: null, rank: 1, school: C.school, foundry_id: null,
        rings: d.rings,
        skills: skills,
        social: {
          honor: d.honor, glory: d.glory, status: d.status,
          ninjo: a.ninjo, giri: a.giri,
          bushido_tenets: { paramount: C.bushido.paramount,
                            less_significant: C.bushido.lesser }
        },
        derived: {
          endurance: (d.rings.earth + d.rings.fire) * 2,
          composure: (d.rings.earth + d.rings.water) * 2,
          focus: d.rings.air + d.rings.fire,
          vigilance: Math.ceil((d.rings.air + d.rings.water) / 2),
          void_points: d.rings["void"]
        },
        money: { zeni: 0, koku: d.wealth, bu: 0 },
        // Both halves: the techniques the school simply grants, and the ones the
        // player chose from its lists. Only the fixed ones used to be exported,
        // so every chosen kata, ritual and shūji was dropped on the way out.
        techniques: refs((sch.starting_techniques || []).reduce(function (acc, t, i) {
          if (t.kind === "fixed") return acc.concat([t.name]);
          if (t.kind === "choose") return acc.concat(chosen("school.tech." + i));
          return acc;
        }, []).concat(sch.school_ability ? [sch.school_ability] : [])),
        peculiarities: refs(heldPeculiarities()),
        titles: [], bonds: [], signature_scrolls: [],
        gear: refs(C.starting_item ? [C.starting_item] : []),
        advancements: []
      }]
    };
  }

  function renderExport(body) {
    var doc = toSourceJson();
    var missing = activeSteps().filter(function (s) {
      return s.id !== "export" && !s.done();
    }).map(function (s) {
      return typeof s.label === "function" ? s.label() : s.label;
    });

    if (missing.length) {
      var warn = document.createElement("p");
      warn.className = "export-warn";
      warn.innerHTML = "<strong>" + missing.length + " step" +
        (missing.length === 1 ? "" : "s") + " unanswered:</strong> " +
        esc(missing.join(", ")) + ". You can still export — the build will " +
        "tell you what it cannot resolve.";
      body.appendChild(warn);
    }

    var complete = missing.length === 0;

    var note = document.createElement("p");
    note.className = "muted small";
    note.innerHTML = "Everything the Creator saves is a <strong>draft</strong>. " +
      "Promotion is a separate, deliberate act — either here once every question " +
      "is answered, or later with <code>python3 scripts/promote.py &lt;slug&gt;</code>.";
    body.appendChild(note);

    var row = document.createElement("div");
    row.className = "choicerow";
    row.innerHTML = '<button type="button" class="btn" id="dl">Download draft</button>' +
      '<button type="button" class="btn" id="cp">Copy JSON</button>' +
      '<button type="button" class="btn promote" id="promote"' +
      (complete ? "" : " disabled title=\"Answer every question first\"") +
      ">Promote &amp; download</button>" +
      '<button type="button" class="btn ghost" id="reset">Delete this draft</button>';
    body.appendChild(row);

    var pre = document.createElement("pre");
    pre.className = "export-json";
    pre.textContent = JSON.stringify(doc, null, 1);
    body.appendChild(pre);

    function download(d) {
      var blob = new Blob([JSON.stringify(d, null, 1)], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = (d.slug || "character") + ".json";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    }
    row.querySelector("#dl").addEventListener("click", function () { download(doc); });
    row.querySelector("#promote").addEventListener("click", function () {
      if (!complete) return;
      // promotion is the one way a character leaves draft status
      var promoted = JSON.parse(JSON.stringify(doc));
      promoted.status = null;
      download(promoted);
      alert("Promoted. Save it as src/characters/" + promoted.slug +
            ".json and run ./scripts/pipeline.sh.\n\nIf you have already committed " +
            "it as a draft, add the slug with:\n  python3 scripts/promote.py " +
            promoted.slug);
    });
    row.querySelector("#cp").addEventListener("click", function () {
      navigator.clipboard.writeText(JSON.stringify(doc, null, 1)).then(function () {
        row.querySelector("#cp").textContent = "Copied";
        setTimeout(function () { row.querySelector("#cp").textContent = "Copy JSON"; }, 1500);
      });
    });
    row.querySelector("#reset").addEventListener("click", function () {
      removeDraft(STORE.activeId);
    });
  }

  /* ---------------------------------------------------------- shell */

  // Path of Waves and Writ of the Wilds characters have no clan, so the
  // clan-relationship question is dropped rather than asked emptily.
  function activeSteps() {
    return STEPS.filter(function (s) {
      return !(s.id === "clan-tie" && !isCore());
    });
  }

  function renderNav() {
    el("steps").innerHTML = STEPS.map(function (s, i) {
      var skip = s.id === "clan-tie" && !isCore();
      var done = s.id !== "export" && s.done();
      return '<button type="button" class="stepnav' + (i === step ? " active" : "") +
        (done ? " done" : "") + (skip ? " skipped" : "") + '" data-i="' + i + '">' +
        '<span class="sn-n">' + (s.n || "·") + "</span>" +
        '<span class="sn-l">' +
        esc(typeof s.label === "function" ? s.label() : s.label) + "</span></button>";
    }).join("");
    Array.prototype.forEach.call(document.querySelectorAll(".stepnav"), function (b) {
      b.addEventListener("click", function () {
        goToStep(Number(b.getAttribute("data-i")));
      });
    });
    var live = activeSteps().filter(function (s) { return s.id !== "export"; });
    var done = live.filter(function (s) { return s.done(); }).length;
    el("progress").innerHTML = '<i style="width:' +
      Math.round((done / live.length) * 100) + '%"></i>';
    el("progress-label").textContent = done + " of " + live.length + " answered";
  }

  // "+1 Iuchi, +1 Ujik Diviner School" — what actually built this number.
  function provenance(list, base) {
    var bits = (list || []).map(function (c) {
      return (c.by > 0 ? "+" : "") + c.by + " " + c.source;
    });
    if (base != null) bits.unshift(base + " base");
    return bits.join(", ");
  }

  // Rules text for a name, from whichever table holds it.
  function ruleTextFor(name) {
    var t = TECH_TEXT[normName(name)];
    if (t) return t;
    var e = CATALOG.filter(function (x) {
      return x.sub_type === "peculiarity" && normName(x.name) === normName(name);
    })[0];
    var p = e && PEC_TEXT[e.uuid];
    return (p && p.text) || null;
  }

  // Everything the character has taken that carries rules text.
  function wipTechniques() {
    var sch = schoolByRollName(C.school);
    if (!sch) return [];
    var out = [];
    (sch.starting_techniques || []).forEach(function (g, i) {
      if (g.kind === "fixed" && g.name) out.push(g.name);
      else if (g.kind === "choose") out = out.concat(chosen("school.tech." + i));
    });
    if (sch.school_ability) out.push(sch.school_ability);
    return out.filter(function (v, i, a) { return a.indexOf(v) === i; });
  }

  function chipRow(names, cls) {
    return '<div class="tagrow">' + names.map(function (n) {
      var txt = ruleTextFor(n);
      return '<span class="chip' + (txt ? " has-tip" : "") + (cls ? " " + cls : "") +
        '" data-tip="' + esc(n) + '">' + esc(n) + "</span>";
    }).join("") + "</div>";
  }

  // Questions already answered, so a later one can be written against them.
  // Titled as the corpus words them, and mode-aware — a Path of Waves
  // character is asked about their past where a samurai is asked about a lord.
  function answeredQuestions() {
    var a = C.answers;
    var rows = [
      [4, null, a.standout_quality],
      [5, null, qAlt(5) ? a.past : a.giri],
      [5, "Your lord's name", a.lord_name],
      [6, null, a.ninjo],
      [7, null, qAlt(7) ? a.known_for : a.clan_relationship.text],
      [8, null, [C.bushido.paramount, C.bushido.lesser].filter(Boolean).join(" / ")],
      [9, null, a.accomplishment],
      [10, null, a.challenge],
      [11, null, a.peace],
      [12, null, a.fear],
      [13, null, [a.mentor.name, a.mentor.text].filter(Boolean).join(" — ")],
      [14, null, qAlt(14) ? a.prized_possession : a.first_impression],
      [15, null, a.stress_reaction],
      [16, null, a.relationships],
      [17, null, qAlt(17) ? a.group_history : a.parent_opinion.description],
      [18, null, qAlt(18) ? a.raised_by : a.heritage],
      [19, null, C.name],
      [20, null, a.death]
    ];
    return rows
      .filter(function (r) { return r[2] && String(r[2]).trim(); })
      .map(function (r) {
        return { n: r[0], title: r[1] || qText(r[0]) || "Question " + r[0],
                 answer: String(r[2]) };
      });
  }

  function renderWip() {
    var d = computed();
    var ring = RINGS.map(function (r) {
      var why = provenance(d.from.rings[r], 1);
      return '<div class="ring' + (why ? " has-tip" : "") + '" data-ring="' + r +
        '" data-tip="' + esc(cap(r)) + '" data-why="' + esc(why) + '">' +
        '<div class="rn">' + cap(r) + '</div><div class="rv">' + d.rings[r] +
        "</div></div>";
    }).join("");

    var skills = Object.keys(d.skills).filter(function (k) { return d.skills[k]; })
      .sort().map(function (k) {
        var why = provenance(d.from.skills[k], null);
        return '<div class="skill' + (why ? " has-tip" : "") +
          '" data-tip="' + esc(SKILL_LABEL[k] || cap(k)) + '" data-why="' + esc(why) +
          '"><span class="sn">' + esc(SKILL_LABEL[k] || cap(k)) +
          '</span><span class="sv">' + d.skills[k] + "</span></div>";
      }).join("") || '<p class="muted small">No skills yet.</p>';

    var advantages = heldPeculiarities();
    var techs = wipTechniques();
    var answered = answeredQuestions();

    el("wip").innerHTML =
      '<h3 class="wip-name">' + esc(C.name || "Unnamed") + "</h3>" +
      '<p class="wip-sub">' +
      esc([C.clan, C.family, C.school].filter(Boolean).join(" · ") || "—") + "</p>" +
      '<div class="rings">' + ring + "</div>" +
      '<div class="statrow">' +
      ['<div class="stat"><span class="k">Honor</span><span class="v">' + d.honor + "</span></div>",
       '<div class="stat"><span class="k">Glory</span><span class="v">' + d.glory + "</span></div>",
       '<div class="stat"><span class="k">Status</span><span class="v">' + d.status + "</span></div>",
       '<div class="stat"><span class="k">Koku</span><span class="v">' + d.wealth + "</span></div>"
      ].join("") + "</div>" +
      (d.pending.length
        ? '<p class="muted small wip-pending">Choices from your clan, family or school ' +
          "still to resolve: " + d.pending.map(function (p) {
            return p.type === "ring" ? "a ring (" + p.opts.join("/") + ")"
                                     : p.n + " skills";
          }).join("; ") + ".</p>"
        : "") +
      '<h4 class="field-label">Skills</h4><div class="wip-skills">' + skills + "</div>" +
      (advantages.length
        ? '<h4 class="field-label">Advantages &amp; Disadvantages</h4>' +
          chipRow(advantages)
        : "") +
      (techs.length
        ? '<h4 class="field-label">Techniques</h4>' + chipRow(techs, "tech")
        : "") +
      (answered.length
        ? '<details class="wip-answers"><summary>Answered so far' +
          '<span class="wa-n">' + answered.length + "</span></summary>" +
          '<div class="wa-list">' + answered.map(function (r) {
            return '<span class="wa-q has-tip" data-tip="Question ' + r.n + '" ' +
              'data-why="' + esc(r.answer) + '">' +
              '<span class="wa-n-i">' + r.n + "</span>" + esc(r.title) + "</span>";
          }).join("") + "</div></details>"
        : "");

    wireWipTips();
  }

  /* Hover anywhere in the panel that has something to say: a rule's text, or
     where a number came from. Reuses the technique card, so the two look the
     same and there is only one thing to position. */
  function wireWipTips() {
    Array.prototype.forEach.call(el("wip").querySelectorAll(".has-tip"), function (n) {
      var title = n.getAttribute("data-tip") || "";
      var why = n.getAttribute("data-why");
      var html = why ? "<p>" + esc(why) + "</p>" : ruleTextFor(title);
      if (!html) return;
      n.addEventListener("mouseenter", function () { showTip(n, title, html); });
      n.addEventListener("mouseleave", hideTip);
    });
  }

  function render() {
    var s = STEPS[step];
    function val(x) { return typeof x === "function" ? x() : x; }
    el("step-n").textContent = s.n === 0 ? "Begin" : "Question " + s.n;
    el("step-title").textContent = val(s.title);
    el("step-desc").innerHTML = val(s.desc);
    var body = el("step-body");
    body.innerHTML = "";
    s.render(body);
    el("prev").disabled = step === 0;
    el("next").disabled = step === STEPS.length - 1;
    renderNav();
    renderWip();
    renderDrafts();
    // Only a change of step returns to the top. render() also runs after every
    // pick — choosing a skill used to throw you back to the masthead, which
    // makes a five-choice step unusable.
    if (jumpToTop) {
      // The question, not the masthead. Scrolling the window to 0 put the
      // Creator's title and the drafts bar back on screen every time, so each
      // Next cost a scroll to get back to where you were reading.
      var panel = document.querySelector(".creator-step");
      var nav = document.querySelector(".topnav");
      if (panel) {
        var offset = (nav ? nav.getBoundingClientRect().height : 0) + 12;
        var y = panel.getBoundingClientRect().top + window.scrollY - offset;
        window.scrollTo({ top: Math.max(0, y), behavior: "instant" });
      } else {
        window.scrollTo({ top: 0, behavior: "instant" });
      }
      jumpToTop = false;
    }
  }

  // Move to a step and return to the top, as opposed to re-rendering in place.
  function goToStep(i) {
    step = i;
    jumpToTop = true;
    render();
  }

  function init() {
    el("prev").addEventListener("click", function () {
      if (step > 0) goToStep(step - 1);
    });
    el("next").addEventListener("click", function () {
      if (step < STEPS.length - 1) goToStep(step + 1);
    });
    var k = el("ai-key");
    var stored = null;
    try { stored = localStorage.getItem(LS_KEY); } catch (e) { /* private mode */ }
    k.value = stored || "";
    if (!stored && window.L5R_LOCAL_AI_KEY) {
      k.placeholder = "using ANTHROPIC_API_KEY from .env (local only)";
    }
    k.addEventListener("change", function () {
      try {
        if (k.value.trim()) localStorage.setItem(LS_KEY, k.value.trim());
        else localStorage.removeItem(LS_KEY);
      } catch (e) { /* private mode */ }
      render();
    });
    render();
  }

  function boot() { loadLocalKey(init); }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
