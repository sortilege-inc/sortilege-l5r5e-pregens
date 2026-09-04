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
  var LS_TKEY = "sortilege.l5r.creator.tableKey";    // the shared-drafts key
  var LS_EDITOR = "sortilege.l5r.creator.editor";    // who is editing, for labels
  var MODEL = "claude-haiku-4-5-20251001";

  var RINGS = ["air", "earth", "fire", "water", "void"];

  /* Rokugani coin. The corpus states the exchange rate -- "One koku can be
     exchanged for five silver bu... One bu can be exchanged for ten copper
     zeni" (core-systems.ttrpg, currency-of-rokugan) -- but a purse is added up
     one denomination at a time and never carried into the next.

     Two reasons. A koku total cannot hold Peasant Family's 10 zeni without
     calling it 0.2 of a coin, which is what the panel used to show. And
     normalizing the other way restates the book: 10 zeni is exactly 1 bu in
     value, but the family entry says ten copper coins, and a character sheet
     that says one silver one is not reporting what they were given.

     Exchanging is something the character does at a table, with a rate the
     corpus already states. It is not the sheet's job to do it for them. */
  var COINS = ["koku", "bu", "zeni"];

  function addCoins(into, coins) {
    COINS.forEach(function (k) {
      into[k] = (into[k] || 0) + (Number(coins && coins[k]) || 0);
    });
    return into;
  }

  function scaleCoins(coins, n) {
    var out = {};
    COINS.forEach(function (k) { out[k] = (Number(coins[k]) || 0) * n; });
    return out;
  }

  // "1 koku, 2 bu" — and "nothing" rather than an empty string, since a
  // character with no money at all is a fact worth reading
  function coinLabel(coins) {
    var bits = COINS.filter(function (k) {
      return (Number(coins && coins[k]) || 0) > 0;
    }).map(function (k) { return coins[k] + " " + k; });
    return bits.length ? bits.join(", ") : "nothing";
  }

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
  /* One per school pencilled in for a pack, from scripts/pack_stubs.py. Not
     characters — nothing of theirs is in the archive and they count towards no
     coverage — just the retyping taken out of starting one: the school, the
     campaign it is for, and the question set its book uses. */
  var PACK_STUBS = window.L5R_PACK_STUBS || [];
  var CLAN_TENETS = window.L5R_CLAN_TENETS || {};
  var QUESTIONS = window.L5R_QUESTIONS || {};
  var NAMES = window.L5R_NAMES || {};
  var TAROT = window.L5R_TAROT || [];

  /* An honest draw. crypto.getRandomValues with rejection sampling, so there is
     no modulo bias: a 32-bit value is discarded and redrawn if it falls in the
     short tail that would over-represent the low indices. Nothing here weights
     the deck, avoids a card, or retries a spread it does not like — three
     distinct cards from 78, each equally likely, each upright or reversed on a
     separate fair bit. */
  function randomBelow(n) {
    if (n <= 0) return 0;
    var limit = Math.floor(4294967296 / n) * n;   // largest unbiased multiple
    var buf = new Uint32Array(1);
    var v;
    do {
      crypto.getRandomValues(buf);
      v = buf[0];
    } while (v >= limit);
    return v % n;
  }

  function drawSpread(count) {
    var pool = TAROT.slice();
    var out = [];
    for (var i = 0; i < count && pool.length; i++) {
      var card = pool.splice(randomBelow(pool.length), 1)[0];
      out.push({ card: card, reversed: randomBelow(2) === 1 });
    }
    return out;
  }

  function spreadText(spread) {
    return spread.map(function (d, i) {
      var o = d.reversed ? "Reversed" : "Upright";
      return "— " + (i + 1) + ". " + d.card.name + ", " + o + " —\n\n" +
        (d.reversed ? d.card.reversed : d.card.upright);
    }).join("\n\n");
  }

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

  /* A mentor belongs to a clan far more often than to an order, a tradition or
     a conspiracy, so the roll is weighted 3:1 toward a clan — three parts clan
     to one part everything else, as a category, not per entry. Inside whichever
     side wins, the choice is uniform. */
  var CLAN_WEIGHT = 3;

  function rollAssociation() {
    var a = NAMES.association || {};
    var clans = a.clans || [], bodies = a.bodies || [];
    if (!clans.length && !bodies.length) return null;
    if (!bodies.length) return pickFrom(clans);
    if (!clans.length) return pickFrom(bodies);
    return randomBelow(CLAN_WEIGHT + 1) < CLAN_WEIGHT
      ? pickFrom(clans) : pickFrom(bodies);
  }

  // Is this association one of the clans? Decides whether a rolled mentor name
  // gets a family name in front of it.
  function isClan(name) {
    return ((NAMES.association || {}).clans || []).some(function (c) {
      return normName(c) === normName(name);
    });
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
  /* The question's wording, which falls back further than its mechanics do.

     A mode inherits the wording of the book it revises before falling back to
     core: Writ of the Wilds is a partial revision of Path of Waves, restating
     only questions 1, 2, 5, 6, 7 and 8, so a Wilds character takes Path of
     Waves' wording for the other fourteen rather than the core rulebook's
     samurai phrasing. qFor() still walks pow -> core, because the wording of
     the same question travels between the two books and the options do not:
     Writ of the Wilds offers three regions where Path of Waves offers six.

     This chain was added when the corpus stated questions 1, 2, 3 and 5 for
     neither book properly, and a rōnin was asked "What Clan Does Your
     Character Belong To?" over a list of regions. The corpus was fixed on
     2026-09-04 and Path of Waves now states all twenty, so the pow -> wow hop
     no longer fires — the wow -> pow one does, and only now works. */
  function qText(n) {
    var q = QUESTIONS[String(n)] || {};
    var m = mode();
    var chain = m === "wow" ? [q.wow, q.pow, q.core]
              : m === "pow" ? [q.pow, q.wow, q.core]
              : [q.core];
    for (var i = 0; i < chain.length; i++) {
      if (chain[i] && chain[i].text) return chain[i].text;
    }
    return null;
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
  /* Path of Waves p.46, and the corpus's own rules labels
     (pow_ronin_base_status_24, pow_peasant_base_status_15,
     pow_gaijin_base_status_0): the character's type sets the status their
     upbringing then modifies. Every one of the thirteen upbringings applies to
     all three types, so this gates nothing — it only sets the base. */
  var ORIGIN_TYPES = [
    { key: "ronin", label: "Rōnin", status: 24,
      note: "a samurai without a lord" },
    { key: "peasant", label: "Peasant", status: 15,
      note: "open about the upbringing" },
    { key: "gaijin", label: "Gaijin", status: 0,
      note: "status works differently; see the book" }
  ];
  function originType() {
    var t = C.origin_type;
    return ORIGIN_TYPES.filter(function (x) { return x.key === t; })[0]
      // the mode is labelled Ronin, so that is the base a draft without an
      // explicit answer already assumed
      || ORIGIN_TYPES[0];
  }

  var MODES = [
    { key: "core", label: "Samurai", book: "Core Rulebook" },
    { key: "pow", label: "Ronin", book: "Path of Waves" },
    { key: "wow", label: "Wilds", book: "Writ of the Wilds" }
  ];
  function mode() { return C.mode || "core"; }
  function isCore() { return mode() === "core"; }
  /* Question 1 asks a region and question 2 an upbringing, in both modes.
     This used to be one function returning REGIONS for Path of Waves and
     UPBRINGINGS for Writ of the Wilds, which meant question 1 in Wilds mode
     offered upbringings. Each question gets its own set, and each is scoped to
     the books that actually state it -- scripts/origin_tables.py records that
     per entry as `modes`, because Path of Waves and Writ of the Wilds share
     four upbringings and the resolved corpus presents each of them once. */
  function originScoped(list, n) {
    var m = mode();
    /* When the mode's own question names its options, those are the set: Writ
       of the Wilds offers three of the six regions and four of the thirteen
       upbringings, and states which in its OPTIONS. Matching on the option
       label, because the question says "Forest" where the entry is called
       "Forest Region". */
    var q = (QUESTIONS[String(n)] || {})[m];
    var named = (q && q.options || []).map(function (o) {
      return normName(o.label);
    });
    if (named.length) {
      var byOption = list.filter(function (x) {
        var k = normName(x.name);
        return named.some(function (o) { return k.indexOf(o) === 0; });
      });
      if (byOption.length === named.length) return byOption;
    }
    // otherwise every entry the mode's book states
    var scoped = list.filter(function (x) {
      return (x.modes || []).indexOf(m) >= 0;
    });
    return scoped.length ? scoped : list;
  }
  function regionSet() { return originScoped(REGIONS, 1); }
  function upbringingSet() { return originScoped(UPBRINGINGS, 2); }
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
        accomplishment: "", challenge: "", peace: "", fear: "", accoutrement: "",
        past: "", known_for: "", known_skill: null,
        lord_name: "", lord_gender: "any",
        prized_possession: "", group_history: "", raised_by: "", raised_skill: null,
        clan_relationship: { path: null, skill: null, text: "" },
        mentor: { name: "", path: null, granted: null, skill: "", text: "",
                  gender: "any", association: "" },
        first_impression: "", accoutrement: "", stress_reaction: "",
        relationships: "", people: [],
        parent_opinion: { description: "", skill: null },
        heritage: null, heritage_table: null, heritage_sub: null,
        legacy: null, legacy_inverted: false, death: ""
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
    // An empty drafts object is truthy, and taking it at face value left
    // activeChar() reading a draft that is not there — which throws during
    // boot and renders a blank page, with no control left to recover with.
    // The wizard always has one draft open; if the store has none, start one.
    if (st && st.drafts && Object.keys(st.drafts).length) return st;
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
    if (d) {
      d.character = C;
      d.updated = Date.now();
      // `stamp` counts edits, so a push that is already in flight can tell
      // whether anything changed underneath it. `dirty` is what the flusher
      // looks for.
      d.stamp = (d.stamp || 0) + 1;
      if (d.shared) { d.dirty = true; flushSoon(); }
    }
    persist();
    renderWip();
    renderNav();
    renderDrafts();
  }

  // The draft the wizard is on, and whether it is an edit of a promoted
  // character rather than a new one.
  function activeDraft() { return STORE.drafts[STORE.activeId] || {}; }
  function isEdit() { return activeDraft().kind === "edit"; }
  function editSlug() { return isEdit() ? activeDraft().fromArchive : null; }

  function draftLabel(d) {
    var c = d.character || {};
    // a court has no character name; it is named as a court
    if (d.kind === "court") return (c.court && c.court.name) || "Unnamed court";
    if (d.kind === "army") return (c.army && c.army.name) || "Unnamed army";
    if (d.kind === "school") {
      return (c.school_build && c.school_build.name) || "Unnamed school";
    }
    return c.name || "Unnamed draft";
  }
  function draftProgress(c) {
    var saved = C, n;
    C = c;
    n = STEPS.filter(function (s) { return s.id !== "export" && s.done(); }).length;
    C = saved;
    return n;
  }

  // What the chip says under the name: how far along a draft is, or for an
  // advance, what it spends.
  function draftMeta(d) {
    var c = d.character || {};
    if (d.kind === "legacy" && c.legacy) {
      return "legacy of " + (c.legacy.predecessor_name || c.legacy.predecessor);
    }
    if (d.kind === "advance" && c.advance) {
      var saved = C, st;
      C = c;
      try { st = advanceState(); } catch (e) { st = null; }
      C = saved;
      return "advance · " + ((st && st.spent) || 0) + " of " +
             ((c.advance && c.advance.xp) || 0) + " XP";
    }
    if (d.kind === "school" && c.school_build) {
      var sb = c.school_build;
      return "school · " + (sb.roles && sb.roles.length
        ? sb.roles.join(", ") : "no role yet");
    }
    if (d.kind === "army" && c.army) {
      var am = c.army;
      return "army · strength " + (am.strength == null ? "—" : am.strength) +
             (am.marshaller ? ", " + am.marshaller.name : "");
    }
    if (d.kind === "court" && c.court) {
      var ct = c.court, mv = (ct.npcs || []).filter(function (n) {
        return n.tier === "mover";
      }).length;
      return "court · " + mv + " mover" + (mv === 1 ? "" : "s") + ", " +
             ((ct.npcs || []).length - mv) + " secondar" +
             ((ct.npcs || []).length - mv === 1 ? "y" : "ies");
    }
    return (c.school || c.clan || "no clan yet") + " · " +
           draftProgress(c) + "/21";
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
  /* Start a draft from a pack's shortlist: the school chosen, the campaign
     tagged, and the mode set to the question set that school's book uses — a
     Path of Waves school asks question 1 as a region, not a clan, and getting
     that wrong is a wrong character rather than a wrong label.

     Everything else is left blank. The stub is a starting point, not a
     character: nobody has decided who this is yet. */
  function openStub(i) {
    var st = PACK_STUBS[i];
    if (!st) return;
    var c = newCharacter();
    c.school = st.school;
    c.campaign = st.campaign;
    c.mode = st.mode || "core";
    var id = newId();
    STORE.drafts[id] = { id: id, updated: Date.now(), character: c };
    switchDraft(id);
    setStatus("started " + st.school + " for " + st.campaign +
              " — the school and campaign are set, the rest is yours");
  }

  function removeDraft(id) {
    var d = STORE.drafts[id];
    if (!d) return;
    var shared = d.shared && syncOn();
    if (!confirm(shared
          ? "Delete “" + draftLabel(d) + "” from the table?\n\nIt goes for " +
            "everyone, not just this browser, and cannot be undone."
          : "Delete “" + draftLabel(d) + "”? This cannot be undone.")) return;
    if (shared) {
      syncFetch("/drafts/" + encodeURIComponent(id), { method: "DELETE" })
        .then(function (res) {
          if (!res.ok) setStatus("could not delete from the table (" + res.status + ")");
        });
    }
    delete STORE.drafts[id];
    if (!Object.keys(STORE.drafts).length) { addDraft(); return; }
    if (STORE.activeId === id) STORE.activeId = Object.keys(STORE.drafts)[0];
    C = activeChar();
    persist();
    render();
  }
  /* A draft whose character the archive now holds as a promoted record has
     been promoted: the file was downloaded, committed and built, and the repo
     copy is the one that counts. Leaving the chip behind puts the same
     character in two places and makes the finished one look provisional —
     which is how Sanpei stayed in the drafts list after promotion.

     Two conditions before anything is deleted. The archive has to actually
     hold the character, which is what makes the local copy redundant rather
     than merely stale. And the draft has to be local: a shared draft keeps its
     chip, labelled "promoted", because deleting it would take it off
     everyone's table and not just this browser's list.

     An edit, advance or legacy of a promoted character is not a copy of it —
     it is work against it — so only plain drafts are considered. */
  function promotedNames() {
    var out = {};
    ARCHIVE.forEach(function (a) {
      if (a.status !== "draft") out[a.slug] = true;
    });
    return out;
  }

  function pruneSuperseded() {
    var done = promotedNames(), gone = [];
    Object.keys(STORE.drafts).forEach(function (id) {
      var d = STORE.drafts[id];
      if ((d.kind || "draft") !== "draft") return;
      var name = (d.character || {}).name;
      if (!name || !done[slugify(name)]) return;
      if (d.shared) return;
      gone.push(draftLabel(d));
      delete STORE.drafts[id];
      if (STORE.activeId === id) STORE.activeId = null;
    });
    if (!gone.length) return;
    if (!Object.keys(STORE.drafts).length) { addDraft(); return; }
    if (!STORE.activeId || !STORE.drafts[STORE.activeId]) {
      STORE.activeId = Object.keys(STORE.drafts)[0];
    }
    C = activeChar();
    persist();
    setStatus(gone.join(", ") + (gone.length > 1 ? " are" : " is") +
              " in the archive now, so " +
              (gone.length > 1 ? "those drafts" : "that draft") +
              " has been cleared — open " +
              (gone.length > 1 ? "them" : "it") +
              " from the Characters tab to edit, advance or leave a Legacy.");
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
    /* A record written by this wizard carries the state it was made from, so
       hydrating is exact — the same character comes back, choices and all.
       Everything after this is the path for records that predate that: the
       Foundry actors, and the characters exported before `wizard` existed. It
       reads what it can out of the answers, and what it cannot read is why an
       edit is landed as a difference from what this produced rather than as a
       replacement (see baselineFor(), and scripts/apply_edit.py). */
    if (a.wizard) {
      c = withDefaults(a.wizard, newCharacter());
      c.concept = a.concept || "";
      return c;
    }
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
    // Question 13 exports as "<name> — <what they taught>", and hydrate read
    // neither half, so opening an archive character lost its mentor entirely.
    var m13 = ans("step13", "most_learn").split(" — ");
    c.answers.mentor.name = (m13[0] || "").trim();
    c.answers.mentor.text = m13.slice(1).join(" — ").trim();
    c.answers.first_impression = ans("step14", "first_sight");
    c.answers.accoutrement = ans("step14", "accoutrement");
    c.answers.stress_reaction = ans("step15", "stress");
    c.answers.relationships = ans("step16", "relations");
    c.answers.lord_name = ans("step5", "lord_name");
    c.answers.parent_opinion.description = ans("step17", "parents_pov");
    c.answers.legacy = ans("step18", "legacy") || null;
    c.answers.legacy_inverted = !!((tq.step18 || {}).answers || {}).legacy_inverted;
    c.answers.heritage = ans("step18", "heritage_name") || null;
    c.answers.heritage_table = heritageTableKey(ans("step18", "heritage_table"));
    c.answers.heritage_sub = ans("step18", "heritage_sub") || null;
    var hp = (tq.step18 || {}).picks || {};
    Object.keys(hp).forEach(function (k) {
      if (k.indexOf("heritage.") === 0) c.choices[k] = hp[k];
    });
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

  /* The packs' shortlists, as chips that start a draft.

     Each says the school on top and the campaign it is for underneath, so a
     chip stands on its own — the list is long enough that a heading per
     campaign would scroll off the top of whichever one you were reading.
     A school already built somewhere in the archive is marked, because the
     shortlist was drawn when it was not. */
  function stubList() {
    if (!PACK_STUBS.length) return "";
    return '<span class="drafts-label drafts-archive">Pencilled in for a pack' +
      '<span class="dl-n">' + PACK_STUBS.length + "</span></span>" +
      '<div class="archive-list stub-list">' +
      PACK_STUBS.map(function (st, i) {
        var also = (st.also || []).length
          ? " · also " + st.also.join(", ") : "";
        // two different facts, and the difference matters: the archive having
        // built it means the shortlist has gone stale, while a publisher's
        // folio having it is the reason to build one of our own
        var tag = st.built_by === "archive" ? " · already built"
                : st.built_by === "published" ? " · a folio has this school"
                : "";
        return '<button type="button" class="archivechip stubchip' +
          (st.built_by === "archive" ? " taken" : "") +
          (st.built_by === "published" ? " folio" : "") +
          '" data-stub="' + i + '"' +
          ' title="' + esc(st.school + " — " + (st.book || "") +
            (st.page ? " p" + st.page : "") +
            (st.mode !== "core" ? " · asks questions 1 and 2 as a region and "
                                  + "an upbringing" : "")) + '">' +
          esc(st.school) +
          '<span class="dc-meta">' + esc(st.campaign) + esc(also) + tag +
          "</span></button>";
      }).join("") + "</div>";
  }

  /* The archive's unfinished characters, to be carried on with here.

     Promoted characters used to have a second list beside this one, with Edit,
     +XP and Legacy on every row. They are on each character's own card in the
     Characters tab now, which is where someone looking for a finished
     character goes — and this panel is for work in progress, which a promoted
     character is not. */
  function archiveList() {
    var rows = ARCHIVE.filter(function (a) { return a.status === "draft"; });
    if (!rows.length) return "";
    return '<span class="drafts-label drafts-archive">From the archive</span>' +
      '<div class="archive-list">' +
      rows.map(function (a) {
        var open = Object.keys(STORE.drafts).some(function (id) {
          return STORE.drafts[id].fromArchive === a.slug;
        });
        var tiers = a.tier_count > 1 ? " · " + a.tier_count + " tiers" : "";
        return '<span class="archiverow">' +
          '<button type="button" class="archivechip' + (open ? " open" : "") +
          '" data-slug="' + esc(a.slug) + '" data-mode="draft">' +
          esc(a.name) + '<span class="dc-meta">' +
          esc(a.identity.school || a.identity.clan || "—") + tiers +
          (open ? " · opened" : "") + "</span></button>" +
          "</span>";
      }).join("") + "</div>";
  }

  /* A promoted character whose numbers this wizard did not derive. Foundry
     holds it at several XP tiers, and tier 0 is what those were built from, so
     a mechanical change to the base would leave tiers 1..N no longer following
     from it. Its prose is still editable.

     Nothing else needs to be out of reach, because an edit is landed as a
     difference rather than as a replacement: see baselineFor() below. */
  function proseOnly(a) {
    return (a.tier_count || 1) > 1;
  }

  /* What the record looks like coming straight back out of the wizard, before
     anybody has changed anything.

     This is what makes an edit safe. Hydrating a record written before the
     wizard carried its own state is a reconstruction, not a restoration: the
     answers come back, but not the choices behind the numbers, so re-exporting
     Shosuro Hisano gave Water 1 for her Water 2 and three techniques for her
     four. Writing that back would have quietly undone her.

     So scripts/apply_edit.py does not write what the wizard now says. It
     writes the difference between what the wizard says now and what it said
     the moment the record was opened — and a field nobody touched has no
     difference, whatever the wizard managed to reconstruct of it. */
  function baselineFor(a) {
    try { return sourceFor(hydrate(a)); } catch (e) { return null; }
  }

  function openArchiveDraft(slug, mode, asked) {
    var a = ARCHIVE.filter(function (x) { return x.slug === slug; })[0];
    if (!a) return;
    var edit = mode === "edit";
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
    if (!asked && !confirm(edit
          ? "Open “" + a.name + "” for editing?\n\n" +
            (proseOnly(a)
              ? "Foundry holds this character at " + a.tier_count + " XP tiers, " +
                "whose numbers were built from this one — so only its prose " +
                "can be changed here. Rings, skills, techniques and gear are " +
                "left alone.\n\n"
              : "") +
            "Nothing is written until you land the edit with " +
            "scripts/apply_edit.py, which shows you the change first."
          : "Open “" + a.name + "” from the archive as a working draft?\n\n" +
            "It is copied into this browser; the archive file is not changed. " +
            "Export when you are done.")) return;
    var id = newId();
    STORE.drafts[id] = { id: id, updated: Date.now(), fromArchive: slug,
                         kind: edit ? "edit" : "draft",
                         proseOnly: edit && proseOnly(a),
                         baseTiers: a.tier_count || 1,
                         baseline: edit ? baselineFor(a) : null,
                         character: hydrate(a) };
    switchDraft(id);
  }

  /* Advancing a character. Unlike an edit, this does not touch the tier it
     starts from: it reads the highest tier on the record, keeps a ledger
     against it, and lands as a new tier beside the others. So there is nothing
     to lose here and no baseline to keep — the record is only ever added to. */
  function openAdvance(slug, asked) {
    var a = ARCHIVE.filter(function (x) { return x.slug === slug; })[0];
    if (!a || !a.top) return;
    var existing = Object.keys(STORE.drafts).filter(function (id) {
      return STORE.drafts[id].kind === "advance" &&
        STORE.drafts[id].fromArchive === slug;
    })[0];
    if (existing) { switchDraft(existing); return;

    }
    if (!asked &&
        !confirm("Spend experience for “" + a.name + "”?\n\n" +
                 "They are at " + (a.top.xp || 0) + " XP, school rank " +
                 (a.top.rank || 1) + ". Landing this adds a tier; the ones " +
                 "already on the record are not changed.")) return;
    var id = newId();
    var c = hydrate(a);
    c.advance = newAdvance(a);
    STORE.drafts[id] = { id: id, updated: Date.now(), fromArchive: slug,
                         kind: "advance", baseTiers: a.tier_count || 1,
                         character: c };
    switchDraft(id);
  }

  /* Leaving a Legacy. Like an advance it reads the character's highest tier
     and does not touch the record it came from — a Legacy is a thing the
     predecessor leaves behind, not a change to them. */
  function openLegacy(slug, asked) {
    var a = ARCHIVE.filter(function (x) { return x.slug === slug; })[0];
    if (!a || !a.top) return;
    var existing = Object.keys(STORE.drafts).filter(function (id) {
      return STORE.drafts[id].kind === "legacy" &&
        STORE.drafts[id].fromArchive === slug;
    })[0];
    if (existing) { switchDraft(existing); return; }
    if (!asked &&
        !confirm("Leave a Legacy from “" + a.name + "”?\n\n" +
                 "A successor who takes it applies no heritage result at " +
                 "question 18. Their own record is not changed.")) return;
    var id = newId();
    var c = hydrate(a);
    c.legacy = newLegacy(a);
    STORE.drafts[id] = { id: id, updated: Date.now(), fromArchive: slug,
                         kind: "legacy", baseTiers: a.tier_count || 1,
                         character: c };
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

  // The row that joins or leaves the table, and says what syncing is doing.
  // Absent entirely when no Worker is configured, so a local-only build of the
  // site does not advertise a feature it cannot offer.
  function syncRow() {
    if (!syncConfigured()) return "";
    if (!syncOn()) {
      return '<div class="syncrow">' +
        '<span class="drafts-label">Shared drafts</span>' +
        '<input type="password" id="sync-key" placeholder="table key" ' +
          'autocomplete="off" spellcheck="false">' +
        '<button type="button" class="draftnew" id="sync-join">Join</button>' +
        '<span class="sync-status" id="sync-status">' + esc(syncStatus) + "</span>" +
        '<span class="sync-hint">Drafts stay in this browser until you join. ' +
        "With the key, everyone at the table sees and edits the same ones.</span>" +
        "</div>";
    }
    var n = Object.keys(STORE.drafts).filter(function (id) {
      return STORE.drafts[id].shared;
    }).length;
    return '<div class="syncrow on">' +
      '<span class="drafts-label">Shared drafts</span>' +
      "<span>" + n + " on the table</span>" +
      '<input type="text" id="sync-editor" placeholder="your name" ' +
        'value="' + esc(editorName) + '" autocomplete="off" maxlength="40">' +
      '<button type="button" class="draftnew" id="sync-leave">Leave</button>' +
      '<span class="sync-status" id="sync-status">' + esc(syncStatus) + "</span>" +
      "</div>";
  }

  // Both versions are held and neither is thrown away, so this asks rather than
  // picks. It is the only place the wizard interrupts to ask about syncing.
  function conflictRows() {
    return Object.keys(STORE.drafts).filter(function (id) {
      return STORE.drafts[id].conflict;
    }).map(function (id) {
      var d = STORE.drafts[id];
      var who = d.conflict.editor ? esc(d.conflict.editor) : "someone else";
      return '<div class="syncconflict" data-id="' + id + '">' +
        "<span><strong>" + esc(draftLabel(d)) + "</strong> was changed on the table by " +
        who + " while you were editing it. Both versions are still here.</span>" +
        '<button type="button" class="draftnew" data-keep="mine" data-id="' + id +
          '">Keep mine</button>' +
        '<button type="button" class="draftnew" data-keep="theirs" data-id="' + id +
          '">Take theirs</button>' +
        "</div>";
    }).join("");
  }

  function renderDrafts() {
    // A poll rewrites this panel every twenty seconds. Doing that while
    // somebody is typing their name into it would take the focus away
    // mid-word, so a re-render defers to whoever is using the panel; the next
    // save renders it anyway.
    var focused = document.activeElement;
    if (focused && focused.tagName === "INPUT" &&
        el("drafts").contains(focused)) return;

    var ids = Object.keys(STORE.drafts).sort(function (a, b) {
      return STORE.drafts[b].updated - STORE.drafts[a].updated;
    });
    var active = STORE.drafts[STORE.activeId];
    var shared = ids.filter(function (id) { return STORE.drafts[id].shared; }).length;
    var summary =
      '<summary class="drafts-sum">' +
        '<span class="drafts-label">Drafts</span>' +
        '<span class="ds-active">' + esc(active ? draftLabel(active) : "none") + "</span>" +
        '<span class="ds-n">' + ids.length + " here" +
        (shared ? " · " + shared + " shared" : "") +
        (ARCHIVE.length ? " · " + ARCHIVE.length + " from Foundry" : "") +
        "</span>" +
      "</summary>";
    el("drafts").innerHTML = summary + '<div class="drafts-body">' +
      syncRow() + conflictRows() +
      '<span class="drafts-label">Drafts</span>' +
      ids.map(function (id) {
        var d = STORE.drafts[id];
        var c = d.character || {};
        var mark = d.conflict ? " conflict" : (d.shared ? " shared" : "");
        // a shared draft the archive already holds is not deleted from under
        // the table, so it says what it is instead
        var over = (d.kind || "draft") === "draft" && c.name &&
                   promotedNames()[slugify(c.name)];
        var tag = d.conflict ? " · needs a decision"
                : over ? " · promoted, delete when you are done with it"
                : d.shared ? (d.dirty ? " · saving" : " · shared") : "";
        return '<span class="draftchip' + (id === STORE.activeId ? " active" : "") +
          mark + '" data-id="' + id + '">' +
          '<button type="button" class="dc-open" data-id="' + id + '">' +
          esc(draftLabel(d)) +
          '<span class="dc-meta">' + esc(draftMeta(d)) + tag + "</span></button>" +
          (syncOn() && !d.shared
            ? '<button type="button" class="dc-share" data-id="' + id +
              '" title="Put this draft on the table">↑</button>'
            : "") +
          '<button type="button" class="dc-x" data-id="' + id + '" title="Delete">×</button>' +
          "</span>";
      }).join("") +
      '<button type="button" class="draftnew" id="draft-new">+ New</button>' +
      '<button type="button" class="draftnew" id="draft-dup">Duplicate</button>' +
      '<button type="button" class="draftnew" id="draft-court" ' +
        'title="Courts of Stone: assemble a court in seven steps">' +
        "+ Court</button>" +
      '<button type="button" class="draftnew" id="draft-army" ' +
        'title="Fields of Victory: marshal an army">' +
        "+ Army</button>" +
      '<button type="button" class="draftnew" id="draft-school" ' +
        'title="Path of Waves: build a school in nine steps">' +
        "+ School</button>" +
      archiveList() + stubList() + "</div>";

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
    el("draft-court").addEventListener("click", function () { openCourt(); });
    el("draft-army").addEventListener("click", function () { openArmy(); });
    el("draft-school").addEventListener("click", function () { openSchoolBuild(); });
    el("draft-dup").addEventListener("click", function () { duplicateDraft(STORE.activeId); });
    Array.prototype.forEach.call(el("drafts").querySelectorAll(".archivechip"), function (b) {
      if (b.hasAttribute("data-stub")) return;
      b.addEventListener("click", function () {
        openArchiveDraft(b.getAttribute("data-slug"), b.getAttribute("data-mode"));
      });
    });
    Array.prototype.forEach.call(el("drafts").querySelectorAll(".stubchip"), function (b) {
      b.addEventListener("click", function () {
        openStub(Number(b.getAttribute("data-stub")));
      });
    });
    Array.prototype.forEach.call(el("drafts").querySelectorAll(".dc-share"), function (b) {
      b.addEventListener("click", function (e) {
        e.stopPropagation(); shareDraft(b.getAttribute("data-id"));
      });
    });
    Array.prototype.forEach.call(el("drafts").querySelectorAll("[data-keep]"), function (b) {
      b.addEventListener("click", function () {
        resolveConflict(b.getAttribute("data-id"), b.getAttribute("data-keep"));
      });
    });

    var kf = document.getElementById("sync-key");
    var jb = document.getElementById("sync-join");
    if (kf && jb) {
      jb.addEventListener("click", function () { joinTable(kf.value); });
      kf.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); joinTable(kf.value); }
      });
    }
    var lb = document.getElementById("sync-leave");
    if (lb) lb.addEventListener("click", leaveTable);
    var nf = document.getElementById("sync-editor");
    if (nf) {
      nf.addEventListener("change", function () {
        editorName = nf.value.trim();
        try { localStorage.setItem(LS_EDITOR, editorName); } catch (e) { /* private mode */ }
      });
    }
  }

  /* ------------------------------------------------- shared drafts */

  // Drafts used to live only in this browser's localStorage, so a character in
  // progress belonged to whoever started it, on the machine they started it on.
  // With a table key set, a draft is instead kept by the Worker (see
  // worker/src/index.js) and anyone at the table can pick it up and carry on.
  //
  // localStorage stays the working copy — the wizard reads and writes it exactly
  // as before, so editing is never waiting on the network and a dropped
  // connection costs nothing. Syncing is a layer on top: push what changed,
  // poll for what others changed.
  //
  // The one thing that cannot be handled quietly is two people saving the same
  // draft. Every push says which revision it was based on and the Worker
  // refuses it if that revision has moved on, so instead of one person's work
  // vanishing, both versions survive and the second saver is asked which to
  // keep.

  var SYNC = (window.L5R_AI_PROXY || "").replace(/\/+$/, "");
  var tableKey = "";
  var editorName = "";
  var syncStatus = "";     // one short line for the panel
  var flushTimer = null;
  var pollTimer = null;

  try { tableKey = localStorage.getItem(LS_TKEY) || ""; } catch (e) { /* private mode */ }
  try { editorName = localStorage.getItem(LS_EDITOR) || ""; } catch (e) { /* private mode */ }

  function syncConfigured() { return !!SYNC; }
  function syncOn() { return !!(SYNC && tableKey); }

  function setStatus(t) {
    syncStatus = t;
    var n = document.getElementById("sync-status");
    if (n) n.textContent = t;
  }

  function syncFetch(path, opts) {
    opts = opts || {};
    opts.headers = { "x-table-key": tableKey };
    if (opts.body) opts.headers["content-type"] = "application/json";
    return fetch(SYNC + path, opts).then(function (r) {
      return r.text().then(function (t) {
        var body = {};
        try { body = t ? JSON.parse(t) : {}; } catch (e) { /* not JSON */ }
        return { ok: r.ok, status: r.status, body: body };
      });
    }, function () {
      return { ok: false, status: 0, body: {} };   // offline; not an error to shout about
    });
  }

  // What goes over the wire. The server stores this verbatim and never looks
  // inside it, so the wizard's shape can keep changing without a migration.
  function draftPayload(d) {
    var body = { character: d.character, fromArchive: d.fromArchive || null,
                 // an edit of a promoted character is not a new character, and
                 // everyone at the table should see which it is
                 kind: d.kind || "draft", proseOnly: !!d.proseOnly,
                 baseTiers: d.baseTiers || 1, baseline: d.baseline || null };
    /* An edit rides with the document it exports to. Only the wizard can work
       that out — computed() is what turns a clan, a family, a school and
       twenty answers into rings and skills — so without this, landing an edit
       would always need somebody to open the browser and press Copy, even for
       a one-word change. With it, scripts/apply_edit.py can read the edit off
       the table. Drafts do not carry one: they are promoted by download, and
       every draft would pay for it. */
    if (d.kind === "edit") body.source = sourceFor(d.character);
    // and an advance rides with the tier its ledger comes to, for the same
    // reason: working that out means running the ledger, and only the wizard
    // knows the costs and the curriculum.
    if (d.kind === "advance") body.advancePatch = advancePatchFor(d.character);
    return { rev: d.rev || 0, name: draftLabel(d), editor: editorName,
             body: body };
  }

  // `stamp` is bumped by every edit. A push clears the dirty flag only if no
  // edit landed while it was in flight — otherwise typing during a save would
  // be marked as saved and then never sent.
  function pushDraft(id) {
    var d = STORE.drafts[id];
    if (!d || !syncOn() || !d.shared || d.conflict) return Promise.resolve();
    var stamp = d.stamp || 0;
    return syncFetch("/drafts/" + encodeURIComponent(id),
                     { method: "PUT", body: JSON.stringify(draftPayload(d)) })
      .then(function (res) {
        if (res.ok) {
          d.rev = res.body.rev;
          d.updated = res.body.updated;
          if ((d.stamp || 0) === stamp) d.dirty = false;
          setStatus("saved to the table");
        } else if (res.status === 409) {
          flagConflict(id, res.body.current);
        } else if (res.status === 403) {
          setStatus("the table key was rejected");
        } else if (res.status === 0) {
          setStatus("offline — will save when you are back");
        } else {
          setStatus("could not save (" + res.status + ")");
        }
        persist();
        renderDrafts();
      });
  }

  function flushSoon() {
    if (!syncOn()) return;
    if (flushTimer) clearTimeout(flushTimer);
    setStatus("saving…");
    flushTimer = setTimeout(flushNow, 1200);
  }

  function flushNow() {
    flushTimer = null;
    if (!syncOn()) return Promise.resolve();
    var ids = Object.keys(STORE.drafts).filter(function (id) {
      var d = STORE.drafts[id];
      return d.shared && d.dirty && !d.conflict;
    });
    return Promise.all(ids.map(pushDraft));
  }

  function flagConflict(id, current) {
    var d = STORE.drafts[id];
    if (!d || !current) return;
    // Hold both versions and stop pushing. Resolving is the author's call —
    // guessing here is exactly how the losing edit disappears.
    d.conflict = current;
    d.dirty = false;
    setStatus("“" + draftLabel(d) + "” was changed by someone else");
  }

  function resolveConflict(id, keep) {
    var d = STORE.drafts[id];
    if (!d || !d.conflict) return;
    var theirs = d.conflict;
    delete d.conflict;
    if (keep === "theirs") {
      d.character = remoteCharacter(theirs.body);
      d.rev = theirs.rev;
      d.updated = theirs.updated;
      d.dirty = false;
      if (id === STORE.activeId) C = activeChar();
      setStatus("took the version from the table");
      persist();
      render();
      return;
    }
    // Keep mine: rebase onto their revision so the next push is accepted.
    d.rev = theirs.rev;
    d.dirty = true;
    persist();
    renderDrafts();
    flushNow();
  }

  // A draft off the table was written by another browser, possibly running an
  // older build of this page, so it cannot be trusted to have every field the
  // wizard reads. Anything absent falls back to what a new character would
  // have; anything the remote carries that we do not recognise is kept, so a
  // newer build's work is not stripped by an older one.
  //
  // Without this a single missing key threw inside renderDrafts and took the
  // whole drafts panel down — the one control you would need to get out of it.
  function plain(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }
  function withDefaults(remote, base) {
    if (!plain(remote) || !plain(base)) return remote === undefined ? base : remote;
    var out = {};
    Object.keys(base).forEach(function (k) { out[k] = withDefaults(remote[k], base[k]); });
    Object.keys(remote).forEach(function (k) { if (!(k in out)) out[k] = remote[k]; });
    return out;
  }
  function remoteCharacter(body) {
    return withDefaults((body && body.character) || {}, newCharacter());
  }

  // Take a draft as the server has it. Never overwrites local work: a draft
  // with unsent edits, or one already in conflict, is left alone.
  function adoptRemote(r) {
    var d = STORE.drafts[r.id];
    if (d && (d.dirty || d.conflict)) return;
    if (!d) d = STORE.drafts[r.id] = { id: r.id };
    d.shared = true;
    d.rev = r.rev;
    d.updated = r.updated;
    d.editor = r.editor || "";
    d.character = remoteCharacter(r.body);
    if (r.body && r.body.fromArchive) d.fromArchive = r.body.fromArchive;
    if (r.body && r.body.kind) {
      d.kind = r.body.kind;
      d.proseOnly = !!r.body.proseOnly;
      d.baseTiers = r.body.baseTiers || 1;
      // whoever opened the record captured this; a second browser must not
      // recompute it from its own hydrate and call that the starting point
      if (r.body.baseline) d.baseline = r.body.baseline;
    }
    if (r.id === STORE.activeId) C = activeChar();
  }

  function pullDrafts() {
    if (!syncOn()) return Promise.resolve();
    return syncFetch("/drafts", {}).then(function (res) {
      if (res.status === 403) { setStatus("the table key was rejected"); return; }
      if (!res.ok) {
        if (res.status === 0) setStatus("offline");
        return;
      }
      var list = res.body.drafts || [];
      var onServer = {};
      var stale = [];
      list.forEach(function (r) {
        onServer[r.id] = true;
        var d = STORE.drafts[r.id];
        // The list carries revisions, not bodies — a poll every few seconds
        // should not drag every character across the wire. Only what actually
        // moved is fetched in full.
        if (!d || (d.rev !== r.rev && !d.dirty && !d.conflict)) stale.push(r.id);
      });

      // A shared draft that is no longer on the server was deleted by someone
      // else. One with unsent edits is kept: it is not gone, it is not up yet.
      var dropped = 0;
      Object.keys(STORE.drafts).forEach(function (id) {
        var d = STORE.drafts[id];
        if (d.shared && d.rev && !onServer[id] && !d.dirty && !d.conflict) {
          delete STORE.drafts[id];
          dropped++;
        }
      });

      return Promise.all(stale.map(function (id) {
        return syncFetch("/drafts/" + encodeURIComponent(id), {}).then(function (r) {
          if (r.ok && r.body && r.body.id) adoptRemote(r.body);
        });
      })).then(function () {
        // Said before anything returns early: emptying the table used to leave
        // the panel reporting whatever it had been doing before, which read as
        // if the deletion had not happened.
        if (stale.length || dropped) {
          setStatus(stale.length + " updated" +
                    (dropped ? ", " + dropped + " deleted" : "") + " on the table");
        } else if (!syncStatus || syncStatus === "offline") {
          setStatus("in step with the table");
        }
        // The wizard always has a draft open. If the last one was deleted by
        // someone else, this browser starts a fresh local one rather than
        // rendering nothing.
        if (!Object.keys(STORE.drafts).length) { addDraft(); return; }
        if (!STORE.drafts[STORE.activeId]) {
          STORE.activeId = Object.keys(STORE.drafts)[0];
        }
        C = activeChar();
        persist();
        if (stale.length || dropped) render();
        else renderDrafts();
      });
    });
  }

  function shareDraft(id) {
    var d = STORE.drafts[id];
    if (!d || !syncOn()) return;
    d.shared = true;
    d.rev = 0;            // 0 means "I believe this is new"
    d.dirty = true;
    persist();
    renderDrafts();
    pushDraft(id);
  }

  // Key order is not meaningful, and two browsers building the same character
  // will not agree on it, so a plain JSON.stringify would report differences
  // that are not there.
  function canonical(v) {
    if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
    if (plain(v)) {
      return "{" + Object.keys(v).sort().map(function (k) {
        return JSON.stringify(k) + ":" + canonical(v[k]);
      }).join(",") + "}";
    }
    return JSON.stringify(v === undefined ? null : v);
  }

  function joinTable(key) {
    key = (key || "").trim();
    if (!key) return;
    var previous = tableKey;
    tableKey = key;
    // Bodies as well as revisions: joining reconciles this browser against the
    // table in one pass, and it cannot tell whether a draft it already has is
    // the same as the table's copy without seeing both.
    return syncFetch("/drafts?full=1", {}).then(function (res) {
      if (res.status === 403) {
        tableKey = previous;
        setStatus("that key was not accepted");
        renderDrafts();
        return;
      }
      if (!res.ok) {
        tableKey = previous;
        setStatus(res.status === 0 ? "could not reach the table" : "error " + res.status);
        renderDrafts();
        return;
      }
      try { localStorage.setItem(LS_TKEY, tableKey); } catch (e) { /* private mode */ }

      var onTable = {};
      (res.body.drafts || []).forEach(function (r) { onTable[r.id] = r; });

      // A draft this browser has already had on the table — before leaving, or
      // on another visit — is re-attached rather than offered up as new.
      // Treating it as new made its own existing row reject the write, so
      // rejoining used to raise a conflict against yourself on every draft.
      var reattached = 0;
      Object.keys(STORE.drafts).forEach(function (id) {
        var r = onTable[id];
        if (!r) return;
        var d = STORE.drafts[id];
        d.shared = true;
        d.rev = r.rev;
        d.dirty = false;
        reattached++;
        // Carried on with while away from the table? Then there really are two
        // versions, and that is the one thing worth interrupting for.
        if (canonical(d.character) !== canonical(remoteCharacter(r.body))) {
          flagConflict(id, r);
        }
      });

      var mine = Object.keys(STORE.drafts).filter(function (id) {
        return !STORE.drafts[id].shared && !onTable[id];
      });
      // Joining should not silently publish whatever is lying around in this
      // browser, so the local drafts go up only if asked for. Anything left
      // behind can still be shared one at a time from its own chip.
      if (mine.length && confirm(
            "Joined. Put your " + mine.length + " local draft" +
            (mine.length === 1 ? "" : "s") + " on the table as well, so others " +
            "can edit them?\n\nYou can also share them one at a time later.")) {
        mine.forEach(function (id) {
          STORE.drafts[id].shared = true;
          STORE.drafts[id].rev = 0;
          STORE.drafts[id].dirty = true;
        });
      }

      // Everything on the table this browser has never seen.
      Object.keys(onTable).forEach(function (id) {
        if (!STORE.drafts[id]) adoptRemote(onTable[id]);
      });

      persist();
      startPolling();
      setStatus(reattached ? "rejoined the table" : "joined the table");
      render();
      return flushNow();
    });
  }

  function leaveTable() {
    if (!confirm("Stop syncing with the table?\n\nShared drafts stay on the table " +
                 "for everyone else. This browser keeps its own copy of them.")) return;
    tableKey = "";
    try { localStorage.removeItem(LS_TKEY); } catch (e) { /* private mode */ }
    Object.keys(STORE.drafts).forEach(function (id) {
      var d = STORE.drafts[id];
      delete d.shared; delete d.rev; delete d.dirty; delete d.conflict;
    });
    stopPolling();
    setStatus("");
    persist();
    renderDrafts();
  }

  function startPolling() {
    stopPolling();
    if (!syncOn()) return;
    pollTimer = setInterval(function () {
      if (!document.hidden) pullDrafts();
    }, 20000);
  }
  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  function initSync() {
    if (!syncConfigured()) return;

    // Registered whether or not a table has been joined yet, because joining
    // happens in the middle of a session: hanging these off syncOn() at load
    // meant the first join of a session got the poll and nothing else, so
    // coming back to the tab did not refresh and the last edits before closing
    // it were never sent.
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) pullDrafts();
    });
    // keepalive, because a normal fetch is cancelled when the page goes away —
    // and this is exactly the save that matters, the one at the end.
    window.addEventListener("pagehide", function () {
      if (!syncOn()) return;
      Object.keys(STORE.drafts).forEach(function (id) {
        var d = STORE.drafts[id];
        if (!d.shared || !d.dirty || d.conflict) return;
        try {
          fetch(SYNC + "/drafts/" + encodeURIComponent(id), {
            method: "PUT", keepalive: true,
            headers: { "content-type": "application/json", "x-table-key": tableKey },
            body: JSON.stringify(draftPayload(d))
          });
        } catch (e) { /* going away anyway */ }
      });
    });

    if (!syncOn()) return;
    // Anything typed while offline is sent before asking what changed, so a
    // pull cannot come back and overwrite work that was never uploaded.
    flushNow().then(pullDrafts);
    startPolling();
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
  // "Grave and poetic" was the old instruction and it is what produced the
  // over-written results. Ask for a colleague's account, not a narrator's.
  var REGISTER =
    "Plain and concrete. Write the way someone who works with them would " +
    "describe them to a stranger — not the way a story would introduce them. " +
    "Human scale: one person, one place, one incident. No grand totals, no " +
    "sweeping spans (\"three provinces\", \"a hundred men\", \"all his life\"); " +
    "one specific thing is more interesting than a large vague one.";
  var TENSION =
    "Give it some tension, but make it a fact rather than a mood: something that " +
    "costs them, that they are bad at, that contradicts what they say they are, " +
    "or that has not been settled yet. Do not reach for atmosphere.";
  // Named individually, because naming the exact tic works and asking for
  // "good writing" does not.
  var AVOID =
    "Avoid the house style of machine-written prose. In particular, never end a " +
    "sentence with a detached participial or appositive flourish — the " +
    "\", asking nothing of the spirits but their names\" move, or " +
    "\", her hands still steady\", or \", knowing what it would cost\". If the " +
    "sentence works without a trailing clause, it is finished; stop there. " +
    "Never speculate about an inner state with a simile clause. That means no " +
    "\"as if\", no \"as though\", and no \"like she/he/they \u2026\": " +
    "\"as if the weight changes under observation\", \"as if she hasn\u2019t " +
    "noticed\", \"like she\u2019s swallowing something down\". It is the " +
    "trailing flourish wearing a simile, and banning only one of its wordings " +
    "gets you the others. State what happens and let the reader draw the " +
    "inference. A plain comparison of one thing to another is fine \u2014 " +
    "\"a scar like a fishhook\" \u2014 it is the guess at what someone is " +
    "feeling that is banned. " +
    "Also do not use: the \"not just X, but Y\" or \"more than X — Y\" " +
    "construction; a dash or colon pivot carrying the point at the end; three " +
    "abstract nouns in a row (duty, honor, sacrifice); opening on a participial " +
    "clause (\"Having served…\"); a closing clause that restates the sentence in " +
    "grander words; the words weight, quiet, echo, whisper, tapestry, testament, " +
    "navigate, delve, resonate, unwavering, steely, haunted, or \"speaks volumes\". " +
    "Do not restate the question. Do not explain the answer after giving it.";
  /* One rejected shape and one good one. They are deliberately about different
     characters: an earlier version used the same character for both, and the
     answers for that archetype came back as paraphrases of the good example
     rather than as their own sentence. */
  var EXAMPLE =
    "For calibration. A rejected answer, for a diviner: \"Nergüi traced a " +
    "murderer's path through three provinces by reading the bones of her victims " +
    "in Nagiko's presence, asking nothing of the spirits but their names.\" — " +
    "inflated scale, an ornamental verb, and a trailing flourish that adds " +
    "nothing. A good answer, for an unrelated character, a quartermaster: " +
    "\"She signs for grain she knows is short and makes the difference up out of " +
    "her own stipend, which she has never mentioned to anyone.\" — one incident, " +
    "ordinary scale, and the tension is a fact rather than a mood. Match the " +
    "second in register, not in subject.";
  var STYLE = [VOICE, SHAPE, REGISTER, TENSION, AVOID, EXAMPLE].join(" ");

  /* Questions 9 to 12 ask a narrative question AND grant a mechanical pick, and
     the two are meant to be the same fact seen twice. The suggestion used to
     ignore the pick entirely — a character who had taken Blessed Lineage got an
     accomplishment about smuggling — so where a pick exists, the prompt names it
     and asks for the answer that produces it. Naming it, not describing it: the
     sentence should read as the deed, not as a gloss on the advantage. */
  function grants(kind, picked, want) {
    if (!picked) return "";
    // Give the model what the advantage actually says. Naming it alone was not
    // enough: a long concept note pulls hard, and a character whose concept is
    // loud about one difficulty got answers about that difficulty while holding
    // an unrelated adversity. The rules text plus an explicit precedence rule
    // is what makes the pick win.
    var rules = ruleTextFor(picked);
    var plain = rules
      ? String(rules).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
      : "";
    return " This character has taken the " + kind + " \"" + picked + "\" for this " +
      "question" +
      (plain ? ", which reads: " + plain.slice(0, 600) : "") + ". " +
      "The sentence must be " + want + ", so that the " + kind + " reads as its " +
      "consequence. Use the concept notes for the texture around it — the people, " +
      "the place, the work — so that both show up in the same sentence wherever " +
      "they can. Where they pull apart, the " + kind + " they actually took " +
      "governs what the sentence is about, and the notes supply only the setting. " +
      "Do not name the " + kind + " itself and do not quote its rules text — show " +
      "it happening.";
  }

  var SETTING = "Legend of the Five Rings 5th Edition, a samurai drama RPG set in " +
    "the fantasy realm of Rokugan.";
  var PROMPTS = {
    giri: "You are helping create a character for " + SETTING + "\n\nWrite a single sentence describing this character's giri (duty/obligation to their lord). Giri is what they must do even at personal cost. It should be specific to their clan, school, and lord.\n\n" + STYLE,
    ninjo: "L5R 5e character creation. Write a single sentence describing this character's ninjō (personal desire). The ninjō should sit in tension with their giri — something they want for themselves that conflicts with their duty.\n\n" + STYLE,
    standout_quality: "L5R 5e character creation. Write a single sentence naming and briefly framing the standout quality — a memorable trait or moment — that earned this character their +1 ring increase. Concrete and unmistakable.\n\n" + STYLE,
    clan_relationship: "L5R 5e character creation. Write a single sentence describing how this character carries, or resists, their clan's ideals. Specific to the clan they belong to.\n\n" + STYLE,
    /* Question 14 asks what people NOTICE, and the book's answer is a
       deviation from the norm rather than a portrait — "slight oddities of
       appearance to trivial mannerisms", recorded under Personality, Habits
       and Quirks, with "chewing one's lip when nervous" as its own example.

       Asking for build, bearing, voice and dress got general impressions back:
       composed, watchful, plainly dressed. Those are conclusions a stranger
       draws, not things a stranger can see, so the answer said nothing anyone
       could point at. Naming that failure with examples is what works here;
       asking for "something concrete" does not.

       It also asked for the accoutrement, which is its own field on this same
       step, so the sentence was spent answering the next question. */
    first_impression: "L5R 5e character creation. Name the one thing a stranger " +
      "notices first about this character, and make it something they could " +
      "point at: a physical feature, a habit of movement, a mannerism, a tic, or " +
      "a verbal habit. It should veer from what is expected of someone of their " +
      "clan and station — that is why it gets noticed at all.\n\n" +
      "It must be observable. Not an impression, a bearing, or an air: " +
      "\"composed\", \"watchful\", \"an unsettling stillness\", \"carries " +
      "herself with quiet authority\" are all conclusions a stranger draws, not " +
      "things they see. Give the thing that would make them draw it — where the " +
      "eye goes, or what the hands do.\n\n" +
      "Do not name anything they carry or wear. That is a separate answer on " +
      "this same question.\n\n" +
      "Describe the thing; do not assert that it is visible. \"A real visible " +
      "flinch\", \"a noticeable habit of\", \"an observable tendency to\" are " +
      "the instruction leaking into the answer — if the reader can see it, " +
      "saying so is wasted words.\n\n" + STYLE,
    accoutrement: "L5R 5e character creation. Write a phrase or a short sentence " +
      "naming one distinctive thing this character carries or wears most of the " +
      "time — a scarf, a hair ornament, an engraved scabbard, an eyepatch. It " +
      "should either accent how they already strike people or cut against it. " +
      "Name the object and say what is particular about it; do not explain what " +
      "it means about them.\n\n" + STYLE,
    stress_reaction: "L5R 5e character creation. Write a single sentence describing what this character does when pushed past their composure. Visible, physical, particular to them.\n\n" + STYLE,
    parent_opinion: "L5R 5e character creation. Write a single sentence reporting a parent or guardian's opinion of this character — what they are proud of, frustrated by, or worried about. Report it in the third person; do not write it as the parent speaking.\n\n" + STYLE,
    accomplishment: function () {
      return "L5R 5e character creation. Write a single sentence naming this " +
        "character's greatest accomplishment so far — a deed, not a trait, with a " +
        "place or a person in it." + grants("distinction", C.distinctions[0],
          "the deed, circumstance, or history that this distinction records — " +
          "some are earned and some are inherited, so do not force it into a deed " +
          "if it is not one") + "\n\n" + STYLE;
    },
    challenge: function () {
      return "L5R 5e character creation. Write a single sentence describing what " +
        "holds this character back the most in life. A standing difficulty they " +
        "carry, not a mood." + grants("adversity", C.adversities[0],
          "the difficulty it names, as it shows up in their life") + "\n\n" + STYLE;
    },
    peace: function () {
      return "L5R 5e character creation. Write a single sentence describing the " +
        "activity that most makes this character feel at peace — something they do " +
        "for themselves, unrelated to duty." + grants("passion", C.passions[0],
          "that activity, and what it looks like when they are doing it") +
        "\n\n" + STYLE;
    },
    fear: function () {
      return "L5R 5e character creation. Write a single sentence describing the " +
        "concern, fear, or foible that troubles this character most." +
        grants("anxiety", C.anxieties[0],
          "that fear, and where it costs them") + "\n\n" + STYLE;
    },
    past: "L5R 5e character creation, Path of Waves. This character has no lord; a past replaces giri. Write a single sentence naming what drives them and what it costs — an obligation, a pursuer, or a choice that still follows them.\n\n" + STYLE,
    known_for: "L5R 5e character creation, Path of Waves. Write a single sentence describing what this character is known for where they have travelled, and to whom.\n\n" + STYLE,
    prized_possession: "L5R 5e character creation, Path of Waves. Write a single sentence about the one possession that matters most when everything they own fits in a pack — what it is, and why this one.\n\n" + STYLE,
    group_history: "L5R 5e character creation, Path of Waves. Write a single sentence of shared history between this character and one other member of their group, answering the prompt they chose.\n\n" + STYLE,
    raised_by: "L5R 5e character creation, Path of Waves. Write a single sentence describing who raised this character and how they regard it.\n\n" + STYLE,
    mentor_relationship: "L5R 5e character creation. Write a single sentence describing the relationship between this character and a mentor — what they were taught, and at what cost.\n\n" + STYLE,
    relationship_person: "L5R 5e character creation. Write a single sentence about " +
      "one person in this character's life: who they are to each other, and what " +
      "sits between them. A rival, an ally, a relative, a creditor, a former " +
      "teacher — the relationship, not a description of the other person.\n\n" + STYLE,
    relationships: "L5R 5e character creation. Write a single sentence naming one or two people who matter to this character — a rival, an ally, a family member — and what stands between them.\n\n" + STYLE,
    death: "L5R 5e character creation. Write a single sentence describing the death this character would not regret — the ending they invite, not the one the GM must give them. Solemn and declarative, in the third person.\n\n" + STYLE,
    "default": "L5R 5e character creation suggestion. " + STYLE
  };

  /* One of these is picked per call. They are ways in, not topics: the same
     fact looks different depending on whether you catch it as an incident, a
     habit, or something a third party noticed. */
  var ANGLES = [
    "a single incident, on a particular day, with someone else present",
    "a standing habit — the thing they do every time, not once",
    "what somebody else notices about them and has not said",
    "a workaround they have built, and what it costs to maintain",
    "the practical consequence at work, in the middle of their duty",
    "something that happens when they are alone",
    "a small thing they are unreasonably good or bad at because of it",
    "the way it shapes who they will and will not be in a room with"
  ];

  // The last few suggestions per field, so the next one is asked to differ.
  // Lives on the draft and is never exported — toSourceJson builds its own
  // object and does not carry it.
  function rememberSuggestion(fieldKey, text) {
    if (!text) return;
    C.ai_history = C.ai_history || {};
    var list = C.ai_history[fieldKey] || [];
    list.push(text);
    while (list.length > 4) list.shift();
    C.ai_history[fieldKey] = list;
    save();
  }

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
  /* `omit` is the text of the field being replaced. "New suggestion" means
     ignore what is in the box, and the box's own contents are part of this
     context — without dropping them the model reads its own previous answer
     back and stays in its orbit. */
  function characterContext(omit) {
    var b = [];
    var a = C.answers;
    var skip = (omit || "").trim();
    function add(k, v) {
      if (v === null || v === undefined || v === "") return;
      if (skip && String(v).trim() === skip) return;
      b.push(k + ": " + v);
    }

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
    add("Distinction (question 9)", C.distinctions.join(", "));
    add("Adversity (question 10)", C.adversities.join(", "));
    add("Passion (question 11)", C.passions.join(", "));
    add("Anxiety (question 12)", C.anxieties.join(", "));
    add("Mentor", a.mentor.name + (a.mentor.text ? " — " + a.mentor.text : ""));
    add("From the mentor", a.mentor.granted);
    add("First impression", a.first_impression);
    add("Accoutrement", a.accoutrement);
    add("Stress reaction", a.stress_reaction);
    add("Relationships", a.relationships);
    add("Starting item", C.starting_item);
    add("Parent's opinion", a.parent_opinion.description);
    add("Heritage", a.heritage + (a.heritage_sub ? " — " + a.heritage_sub : ""));
    add("Vision of death", a.death);
    return b.join("\n");
  }

  /* Which of the twenty questions each AI-assisted field answers, so a
     suggestion can be handed the book's own advice for that question and not
     just this file's instruction about register.

     The advice is what the corpus calls GUIDANCE — the core rulebook's
     walkthrough of each question, pp.88-98, carried through
     l5r5e-0.4-core-character.ttrpg and into data/chargen/questions.js. It is
     the only thing in the corpus that says what a good answer to "what does
     your character long for" looks like, which is exactly what a suggestion
     needs and previously never saw.

     Core only. Path of Waves and Writ of the Wilds ask their own questions and
     the book states no per-question advice for them, so their fields — past,
     known_for, prized_possession, group_history, raised_by — are absent here
     and get none rather than borrowing the core book's answer to a different
     question. */
  var FIELD_QUESTION = {
    standout_quality: 4, giri: 5, ninjo: 6, clan_relationship: 7,
    accomplishment: 9, challenge: 10, peace: 11, fear: 12,
    mentor_relationship: 13, first_impression: 14, stress_reaction: 15,
    relationships: 16, relationship_person: 16, parent_opinion: 17,
    death: 20
  };

  // The Worker caps a request body, and the longest of these (question 5, the
  // lord and giri) is over 5,000 characters on its own. Trimmed at a sentence
  // so the model is never handed half a clause; the substance of each entry is
  // at the front and the tails are lists of examples.
  var GUIDANCE_MAX = 4000;

  // The simile clause, in the wordings it actually comes back as. A plain
  // comparison is not matched — "a scar like a fishhook" is fine; it is the
  // guess at an inner state that is not.
  var SIMILE =
    /\b(as if|as though|like (?:she|he|they|it)\s+\w|the way (?:an?|the|she|he|they)\b)/i;

  function questionGuidance(fieldKey) {
    var n = FIELD_QUESTION[fieldKey];
    if (!n || !isCore()) return "";
    var g = ((QUESTIONS[String(n)] || {}).core || {}).guidance || "";
    if (g.length <= GUIDANCE_MAX) return g;
    var cut = g.lastIndexOf(". ", GUIDANCE_MAX);
    return g.slice(0, cut > GUIDANCE_MAX / 2 ? cut + 1 : GUIDANCE_MAX);
  }

  // Two routes to a suggestion. A key in this browser calls Anthropic directly;
  // otherwise the request goes to the Worker, which holds the key server-side.
  // The published site has no key of its own and must never be given one.
  function aiSuggest(fieldKey, sourceText, current, extra) {
    var key = aiKey();
    var proxy = window.L5R_AI_PROXY || "";
    if (!key && !proxy) return Promise.reject(new Error("No API key set."));

    // A prompt may be a function, so a question that also grants a mechanical
    // pick can name the pick and ask for the answer that produces it.
    var system = PROMPTS[fieldKey] || PROMPTS["default"];
    if (typeof system === "function") system = system();
    // A field that exists more than once on a step — one per person at
    // question 16 — says here which one it is.
    if (extra) system = extra + "\n\n" + system;
    /* Each call was independent, so every one landed on the same most obvious
       intersection of the pick and the concept — three of five answers for one
       character were the same image in different words. Two corrections: tell
       it what has already been offered, and send it in from a different angle. */
    var seen = (C.ai_history && C.ai_history[fieldKey]) || [];
    /* Prepended to the user turn rather than the system prompt: it is reference
       material, it is long, and the Worker's system ceiling is 4,000
       characters — putting it there would have silently truncated the
       instructions that follow it. */
    var advice = questionGuidance(fieldKey);
    var preamble = advice
      ? "The rulebook's own guidance for this question, for what it asks and " +
        "what a good answer does. Use it to decide what the answer should be " +
        "about; do not quote it, restate it, or answer in its voice:\n\n" +
        advice + "\n\n---\n\n"
      : "";
    var user;
    if (sourceText && sourceText.trim()) {
      /* Rewriting what the player wrote. Their words are the content and the
         only content: the angle rotation and the "do not repeat yourself" list
         are both suppressed, because both exist to find NEW material and would
         fight the text they were handed. */
      user = preamble + "Existing draft for context:\n" + characterContext() +
        "\n\nTHE PLAYER HAS WRITTEN THE ANSWER BELOW. This overrides every " +
        "instruction about what to write about, including any advantage or " +
        "disadvantage named above. Your job is only how it is written.\n\n" +
        "Their text:\n" + sourceText.trim() + "\n\n" +
        "Put that into the register described in your instructions. Keep every " +
        "specific they gave — names, places, objects, relationships, the actual " +
        "claim. Do not add a fact they did not write, do not drop one they did, " +
        "and do not change the subject. If it is already in the register, return " +
        "it close to unchanged rather than finding something to alter.";
    } else {
      user = preamble + "Existing draft for context:\n" + characterContext(current) +
        "\n\nSuggest a single " + fieldKey.replace(/_/g, " ") + " for this character." +
        "\n\nApproach it as: " + ANGLES[Math.floor(Math.random() * ANGLES.length)] +
        ". Write that, rather than gesturing at it." +
        (seen.length
          ? "\n\nYou have already offered these for this field and they were not " +
            "taken:\n" + seen.map(function (t) { return "> " + t; }).join("\n") +
            "\nGive something different in substance. Whatever activity, object, " +
            "place or person those used, do not use it again — a character has more " +
            "than one part to their life, and the concept notes are a starting point " +
            "rather than the only material. Rewording an answer above does not count " +
            "as a new one."
          : "");
    }

    function once(note) {
      var sys = note ? system + "\n\n" + note : system;
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
              model: MODEL, max_tokens: 256, system: sys,
              messages: [{ role: "user", content: user }]
            })
          })
        : fetch(proxy, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ system: sys, user: user })
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

    /* Banning the simile clause in the instructions did not hold. Across three
       generations it came back as "the way a deer does before it bolts" and as
       "as though she has to remind herself" — the second being a wording the
       prompt names outright. A prohibition sitting in a long list competes with
       everything else in the prompt and loses often enough to matter, so the
       answer is checked and asked for again, naming what it did.

       One retry. If it does it twice the second answer is returned anyway: it
       is a suggestion the player can reject, and spending calls to chase it is
       worse than showing it. */
    return once(null).then(function (text) {
      var m = SIMILE.exec(text || "");
      if (!m) return text;
      return once(
        "Your previous attempt was rejected for writing \"" + m[0] + "\". Do " +
        "not guess at what this character feels by comparing them to something. " +
        "No \"as if\", no \"as though\", no \"like she \u2026\", no \"the " +
        "way a \u2026 does\". Write what happens and stop."
      ).then(function (retry) { return retry || text; },
             function () { return text; });   // a failed retry still has an answer
    });
  }

  // Tab (on an empty field) or the Suggest button asks Claude — same
  // affordance as the dashboard.
  /* Which pick a suggestion for this field will be written against, if any.
     Questions 9-12 ask the narrative half first and take the mechanical pick
     after, so suggesting in the order the step reads gives the model nothing to
     work from — and the answer comes back with no sign of the advantage in it.
     Saying so on the button is the honest fix: the state is visible, and one
     more click gets an answer that uses it. */
  var USES_PICK = {
    accomplishment: function () { return C.distinctions[0]; },
    challenge: function () { return C.adversities[0]; },
    peace: function () { return C.passions[0]; },
    fear: function () { return C.anxieties[0]; }
  };

  function wireAi(input, fieldKey, onChange, opts) {
    opts = opts || {};
    var pickFor = USES_PICK[fieldKey];
    var row = document.createElement("div");
    row.className = "ai-row";
    input.insertAdjacentElement("afterend", row);

    function hintText() {
      if (!aiAvailable()) return "Set an API key below to enable AI suggestions";
      var pick = pickFor && pickFor();
      return "Tab in an empty field for an AI suggestion" +
        (aiKey()
          ? (window.L5R_LOCAL_AI_KEY ? " · key from .env" : "")
          : " · via the shared proxy") +
        (pickFor
          ? (pick
              ? ' · <strong class="ai-uses">using ' + esc(pick) + "</strong>"
              : ' · <span class="ai-uses none">nothing chosen below yet</span>')
          : "");
    }

    /* With text in the field there are two different things to want, and one
       button cannot mean both: keep what I wrote and fix how it reads, or throw
       it away and try again. Empty, only the second is possible. */
    function paint() {
      var has = !!(input.value && input.value.trim());
      row.innerHTML = (has
        ? '<button type="button" class="ai-btn" data-mode="from">Suggest from text</button>' +
          '<button type="button" class="ai-btn ghosted" data-mode="new">New suggestion</button>'
        : '<button type="button" class="ai-btn" data-mode="new">Suggest</button>') +
        '<span class="ai-hint">' + hintText() + "</span>" +
        '<span class="ai-status" aria-live="polite"></span>';
      Array.prototype.forEach.call(row.querySelectorAll(".ai-btn"), function (b) {
        b.addEventListener("click", function () { go(b.getAttribute("data-mode")); });
      });
    }

    function go(mode) {
      if (!aiAvailable()) { el("ai-key").focus(); return; }
      var source = mode === "from" ? input.value : "";
      var status = row.querySelector(".ai-status");
      Array.prototype.forEach.call(row.querySelectorAll(".ai-btn"), function (b) {
        b.disabled = true;
      });
      status.textContent = "…";
      aiSuggest(fieldKey, source, input.value,
                opts.extra && opts.extra()).then(function (text) {
        input.value = text;
        onChange(text);
        // Only a fresh suggestion joins the "already offered" list; a rewrite of
        // the player's own words is not an alternative that was turned down.
        if (!source) rememberSuggestion(fieldKey, text);
        paint();
      }).catch(function (e) {
        paint();
        alert(e.message);
      });
    }

    paint();
    input.addEventListener("input", function () {
      var has = !!(input.value && input.value.trim());
      var showing = row.querySelectorAll(".ai-btn").length > 1;
      if (has !== showing) paint();          // only when the pair must change
    });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Tab" && !e.shiftKey && (!input.value || e.altKey)) {
        e.preventDefault();
        go("new");
      }
    });
  }

  /* ---------------------------------------------------------- derived */

  function familiesOf(clan) {
    return FAMILIES.filter(function (f) { return f.clan === clan; });
  }
  // The clan step stores clan_short_name where there is one, so C.clan is
  // "Tortoise" while the entry is named "Tortoise Minor Clan". Matching on
  // `name`, even with " Clan" appended, therefore found nothing for the seven
  // clans whose name is neither "<short>" nor "<short> Clan" — Badger,
  // Centipede, Deer, Falcon, Fox, Imperial Families and Tortoise — and
  // computed() then skipped their ring bonus, skill bonus and starting status
  // without saying so. A Kasuga smuggler came out at Air 2 rather than Air 3,
  // missing Commerce and at status 0 instead of 25.
  function clanByName(name) {
    if (!name) return null;
    var want = normName(name);
    return CLANS.filter(function (c) {
      return (c.clan_short_name && normName(c.clan_short_name) === want) ||
             normName(c.name) === want ||
             normName(c.name) === normName(name + " Clan");
    })[0] || null;
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
    var honor = 0, glory = 0, status = 0;
    // coin per denomination, never carried into the next
    var purse = { koku: 0, bu: 0, zeni: 0 };
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
    /* A grant can be flat, a choice, or BOTH: Hunter or Fisher gives
       "+1 Labor, +1 Seafaring or +1 Survival" — one fixed rank and one the
       player picks. These used to return as soon as they saw a _choose, so the
       flat part beside it was dropped and that Labor rank never arrived. The
       choice is applied and then the flat keys, every time. */
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
      }
      Object.keys(obj).forEach(function (k) {
        if (k === "_choose") return;
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
      }
      Object.keys(obj).forEach(function (k) {
        if (k === "_choose") return;
        var s = SKILL_BY_LABEL[String(k).toLowerCase()] || k.toLowerCase();
        skills[s] = (skills[s] || 0) + obj[k];
        credit("skills", s, obj[k], source);
      });
    }

    var clan = clanByName(C.clan);
    if (clan) {
      addRing(clan.ring_bonus, "clan.ring_bonus", C.clan);
      addSkills(clan.skill_bonus, "clan.skill_bonus", C.clan);
      status = clan.starting_status || 0;
    }
    var fam = find(FAMILIES, C.family);
    if (fam) {
      addRing(fam.ring_increase, "family.ring_increase", C.family);
      addSkills(fam.skill_increases, "family.skill_increases", C.family);
      glory = fam.glory || 0;
      addCoins(purse, fam.starting_coins);
      // Tonbo starts with two Dragonfly glass ornaments beside its koku. The
      // corpus states a family's items the same way it states an upbringing's,
      // so they are surfaced the same way rather than dropped.
      (fam.starting_items || []).forEach(function (it) {
        pending.push({ type: "item", name: it, source: C.family });
      });
    }
    /* Path of Waves and Writ of the Wilds answer questions 1 and 2 with a
       region and an upbringing, which grant rings, skills, glory, status and
       wealth exactly as a clan and a family do. computed() read only clan and
       family, so those two questions added nothing at all and a rōnin came out
       with bare 1s. (Jordan, 2026-09-03.)

       After the clan and family blocks, not before: a mode switch can
       leave the other mode's answer on the draft, and in this mode it is
       the region and the upbringing that are the answers. */
    if (!isCore()) {
      var reg = find(REGIONS, C.region);
      if (reg) {
        addRing(reg.ring_increase, "region.ring_increase", C.region);
        addSkills(reg.skill_increase, "region.skill_increase", C.region);
        if (reg.glory != null) glory = reg.glory;
      }
      // the type's base status, which the upbringing then modifies
      status = originType().status;
      var up = find(UPBRINGINGS, C.upbringing);
      if (up) {
        addRing(up.ring_increase, "upbringing.ring_increase", C.upbringing);
        addSkills(up.skill_increases, "upbringing.skill_increases", C.upbringing);
        // a region sets glory and an upbringing modifies status, the way a
        // family sets glory and a clan sets status in core
        if (up.status_modification != null) {
          status += up.status_modification;
          // every negative Status Modification in the chapter is printed
          // "(minimum 0)" — six of the thirteen — so a reduction floors there
          if (up.status_modification < 0) status = Math.max(0, status);
        }
        addCoins(purse, up.starting_coins);
        // Temple starts with a day's rations, Fallen Noble with an heirloom
        // worth 3 koku and a wakizashi. Those are gear, not currency, and
        // were being dropped along with the distinction between the two.
        (up.starting_items || []).forEach(function (it) {
          pending.push({ type: "item", name: it, source: C.upbringing });
        });
      }
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

    /* Question 18's heritage. Its social modifiers, the rank its second roll
       grants, the ring it lets the character move and — for one entry in the
       Lion table — double starting koku. All of it used to be dropped on the
       floor: the entry's name went into the export and none of its effect did.

       The swap is applied last and only if it is legal here, because the ring
       it raises is capped at 3 during creation like every other ring, and the
       one it lowers cannot go below 1. */
    var her = heritageGrants();
    honor += her.social.honor;
    glory += her.social.glory;
    status += her.social.status;
    // one Lion heritage doubles the starting money; doubling each
    // denomination is exact, where doubling a koku float was not
    if ((her.koku || 1) !== 1) purse = scaleCoins(purse, her.koku);
    Object.keys(her.skills).forEach(function (k) {
      skills[k] = (skills[k] || 0) + her.skills[k];
      credit("skills", k, her.skills[k], "Question 18");
    });
    if (her.swap) {
      var lo = String(her.swap.from).toLowerCase();
      var hi = String(her.swap.to).toLowerCase();
      if (rings[lo] != null && rings[hi] != null && lo !== hi &&
          rings[lo] > 1 && rings[hi] < (her.swap.cap || 3)) {
        rings[lo] -= 1;
        rings[hi] += 1;
        credit("rings", lo, -1, "Question 18");
        credit("rings", hi, 1, "Question 18");
      } else {
        pending.push({ type: "swap", from: lo, to: hi });
      }
    }
    return { rings: rings, skills: skills, honor: honor, glory: glory,
             status: status,
             // the coins, and the label to show them. No koku float: that is
             // the thing being fixed.
             coins: purse, coin_label: coinLabel(purse),
             pending: pending, school: sch, from: from };
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
        var tip = opts.tip && opts.tip(i.value);
        return '<button type="button" class="pick' +
          (i.value === current ? " active" : "") + (tip ? " has-tip" : "") +
          '" data-v="' + esc(i.value) + '">' +
          '<span class="pick-n">' + esc(i.label) + "</span>" +
          (i.meta ? '<span class="pick-m">' + esc(i.meta) + "</span>" : "") + "</button>";
      }).join("") || '<p class="muted small">Nothing matches.</p>';
      Array.prototype.forEach.call(list.querySelectorAll(".pick"), function (b) {
        if (opts.tip) {
          var v = b.getAttribute("data-v");
          var html = opts.tip(v);
          if (html) {
            b.addEventListener("mouseenter", function () { showTip(b, v, html); });
            b.addEventListener("mouseleave", hideTip);
          }
        }
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
  /* ------------------------------------------ what a heritage result grants

     A heritage result is not only a line of family history and a social
     modifier. Every one of the fifty-three entries in the line hands the
     character something — a skill rank, a technique from outside their school,
     an heirloom, a distinction — and about half of those make the player
     choose what.

     Almost none of it was recorded. Question 18 showed the entry, wrote its
     name into the export and dropped the rest: Ichiro Tsutomu rolled
     "Gain +1 Commerce" and has Commerce 0, Shosuro Hisano rolled "+1 Command"
     and has Command 0, and three more carry a grant nobody ever picked. The
     MODIFIERS went the same way, so Hisano's glory is her family's 40 rather
     than the 37 Dynasty Builder leaves her with.

     scripts/heritage_tables.py now reads the obligation out of the corpus and
     emits it as `requires`, on the entry and on each sub-table range. This is
     the other half: a control for each requirement, the answer kept in
     C.choices where every other resolved choice lives, and the result folded
     into computed(), the side panel and the export.

     Only the answers are stored. What the requirements ARE is derived from the
     entry every time, so changing the heritage cannot leave a stale grant
     behind — which is the same reason the old hard-coded gear map is gone. */

  var RING_NAMES = ["Air", "Earth", "Fire", "Water", "Void"];

  // The technique categories a sub-roll can name, in the corpus's own words,
  // mapped to what the compendium calls them. "Mahō or ninjutsu" is one roll
  // and two categories.
  var TECH_KIND = {
    kata: ["kata"], shuji: ["shuji"], ritual: ["ritual"], rituals: ["ritual"],
    invocation: ["invocation"], invocations: ["invocation"], kiho: ["kiho"],
    mahoorninjutsu: ["maho", "ninjutsu"], ninjutsuormaho: ["maho", "ninjutsu"]
  };

  function techKinds(text) {
    var t = normName(String(text || "").replace(/^gain access to\s*/i, ""));
    return TECH_KIND[t] || null;
  }

  /* What the heirloom sub-tables mean by their categories. The phrasings are
     the books' own. Three of them have no compendium behind them — a horse, a
     boat, the deed to a piece of land are not items in the equipment packs —
     so those are named by the player and carried as custom, the same way the
     talisman always was. */
  var HEIRLOOM = [
    [/^a weapon/i, { type: "weapon" }],
    [/^a set of armor/i, { type: "armor" }],
    [/^a game set/i, { type: "item" }],
    [/^(another item|some other item)/i, { type: "" }],
    [/^a horse or (an)?other animal/i, { free: "the animal" }],
    [/^a boat or estate/i, { free: "the boat or estate" }],
    [/^the deed to/i, { free: "the land" }]
  ];

  function heirloomKind(text) {
    for (var i = 0; i < HEIRLOOM.length; i++) {
      if (HEIRLOOM[i][0].test(String(text || "").trim())) return HEIRLOOM[i][1];
    }
    return { type: "" };
  }

  // The sixteen item qualities, which the books cite by page rather than list
  // ("from the list of item qualities on page 240"). Filtered from the
  // compendium by that page, so the set is the book's and not a copy of it.
  function itemQualities() {
    return CATALOG.filter(function (e) {
      return e.sub_type === "property" && e.source_book === "core_rulebook" &&
        (e.source_page === 240 || e.source_page === 241);
    }).map(function (e) { return e.name; }).sort();
  }

  /* A roll range as the corpus states it: "1", or "2-3". Entries do not each
     occupy one face of the die — Courts of Stone's six entries span 1, 2-3,
     4-5, 6-7, 8-9 and 10 — so rolling has to roll the die and find the entry
     the result lands on, rather than picking an entry uniformly. Picking
     uniformly made a two-face entry as likely as a one-face entry. */
  function rollSpan(range) {
    var m = /^(\d+)\s*[-–—]\s*(\d+)$/.exec(String(range || "").trim());
    if (m) {
      var out = [];
      for (var i = Number(m[1]); i <= Number(m[2]); i++) out.push(i);
      return out;
    }
    var n = Number(String(range || "").trim());
    return isNaN(n) ? [] : [n];
  }

  /* The entry a die lands on. Falls back to a uniform pick over the list when
     the spans do not cover the die, so a corpus gap cannot leave the button
     doing nothing.

     `sides` defaults to 10 because every heritage table is a d10; Path of
     Waves' sample-pasts table is a d100, and reading it on a d10 would only
     ever reach its first two rows. */
  function rollOn(list, rangeOf, sides) {
    var n = sides || 10;
    var faces = {};
    list.forEach(function (x) {
      rollSpan(rangeOf(x)).forEach(function (f) {
        if (f >= 1 && f <= n && faces[f] === undefined) faces[f] = x;
      });
    });
    var covered = [];
    for (var f = 1; f <= n; f++) if (faces[f] !== undefined) covered.push(f);
    if (covered.length < n) return list[randomBelow(list.length)];
    return faces[covered[randomBelow(covered.length)]];
  }

  /* Roll the die and say which face came up, not just which row it hit.

     rollOn() returns the row, so a report built from it can only name the
     row's span — "rolled 39-46", which is not a number anybody rolled. This
     rolls a face and finds the row containing it, falling back to rollOn when
     the spans do not cover the die. */
  function rollFace(rows, rangeOf, sides) {
    var n = sides || 10;
    var faces = {};
    rows.forEach(function (x) {
      rollSpan(rangeOf(x)).forEach(function (f) {
        if (f >= 1 && f <= n && faces[f] === undefined) faces[f] = x;
      });
    });
    var covered = 0;
    for (var f = 1; f <= n; f++) if (faces[f] !== undefined) covered++;
    if (covered < n) {
      var any = rollOn(rows, rangeOf, n);
      return any ? { face: null, entry: any } : null;
    }
    var roll = randomBelow(n) + 1;
    return { face: roll, entry: faces[roll] };
  }

  // "d100" -> 100. A table states its own die; nothing here assumes one.
  function dieSides(die) {
    var m = /d(\d+)/i.exec(String(die || ""));
    return m ? Number(m[1]) : 10;
  }

  /* A row of a roll table, as a name and what it says. The row's own label is
     its roll range — bookkeeping for rolling, not something to read, so it is
     used by the roll button and never shown.

     The corpus states the name in its own cell (since the tables were
     re-verbatimised on 2026-09-04), and the generator carries it as `name`.
     Older rows that fold the name into the text as "Name: what it means" are
     still split on the colon, so a table converted before that holds up. */
  function tableRow(r) {
    var t = String(r.text || "");
    if (r.name) return { label: String(r.name), text: t, roll: r.label };
    var i = t.indexOf(":");
    return i > 0 && i < 60
      ? { label: t.slice(0, i).trim(), text: t.slice(i + 1).trim(), roll: r.label }
      : { label: t.slice(0, 48), text: t, roll: r.label };
  }

  function heritageTable() { return HERITAGES[C.answers.heritage_table] || null; }

  // The export writes the table's printed name; the draft holds its key. This
  // is what lets a character exported from here be opened here again.
  function heritageTableKey(name) {
    if (!name) return null;
    if (HERITAGES[name]) return name;
    return Object.keys(HERITAGES).filter(function (k) {
      return normName(HERITAGES[k].name) === normName(name);
    })[0] || null;
  }

  // Every answer given to a heritage requirement, for the export. They ride in
  // step 18's `picks`, which every step has and Foundry ignores.
  function heritagePicks() {
    var out = {};
    Object.keys(C.choices || {}).sort().forEach(function (k) {
      if (k.indexOf("heritage.") === 0) out[k] = C.choices[k];
    });
    return out;
  }

  function heritageEntry() {
    var t = heritageTable();
    if (!t || !C.answers.heritage) return null;
    return t.entries.filter(function (e) {
      return e.name === C.answers.heritage;
    })[0] || null;
  }

  // The sub-table range chosen under the entry. `heritage_sub` is stored as it
  // is shown — "1-3 — A weapon" — so the range is found by rebuilding that.
  function heritageSubRange() {
    var e = heritageEntry();
    if (!e || !e.sub_table || !C.answers.heritage_sub) return null;
    return e.sub_table.ranges.filter(function (r) {
      return r.range + " — " + r.text === C.answers.heritage_sub;
    })[0] || null;
  }

  // A requirement that reads from the sub-roll is only answerable once the
  // roll has happened, because the range's own text is the category, the ring
  // or the kind of heirloom.
  function resolveReq(r, sub, key) {
    var out = {}, k;
    for (k in r) if (r.hasOwnProperty(k)) out[k] = r[k];
    out.key = key;
    var text = sub ? sub.text : "";
    if (r.kind === "pick_one") {
      out.options = (r.options || []).map(function (o, i) {
        return resolveReq(o, sub, key + ".p" + i);
      });
      return out;
    }
    if (!sub && (r.category_from_sub || r.ring_from_sub || r.name_from_sub ||
                 r.to === "from_sub")) {
      out.waiting = true;               // the second roll has not happened yet
      return out;
    }
    if (r.category_from_sub && r.kind === "technique") {
      out.kinds = techKinds(text);
      out.category_label = text;
    }
    if (r.category_from_sub && r.kind === "item") {
      var h = heirloomKind(text);
      out.type = h.type;
      out.free = h.free;
      out.category_label = text;
    }
    if (r.ring_from_sub) out.ring = String(text || "").toLowerCase();
    if (r.name_from_sub) out.name = text + (r.name_suffix || "");
    if (r.to === "from_sub") out.to = [cap(String(text || "").toLowerCase())];
    return out;
  }

  // Everything the result puts on the sheet: the entry's own requirements
  // first, then the ones the second roll brought with it. Each carries a key
  // of its own, so an answer survives a re-render and the CLI can read it.
  function heritageRequirements() {
    var e = heritageEntry();
    if (!e) return [];
    var sub = heritageSubRange();
    var base = "heritage." + slugify(e.name);
    return (e.requires || []).concat((sub && sub.requires) || [])
      .map(function (r, i) { return resolveReq(r, sub, base + "." + i); });
  }

  /* Re-rolling the heritage, or the second roll, invalidates every answer the
     old result asked for. They are dropped rather than left in C.choices under
     a key nothing reads any more — a stale pick that reappears when the same
     entry is rolled again is the kind of thing nobody would think to check. */
  function forgetHeritagePicks() {
    Object.keys(C.choices || {}).forEach(function (k) {
      if (k.indexOf("heritage.") === 0) delete C.choices[k];
    });
  }

  function pick1(key) { return chosen(key)[0] || null; }
  function setPick1(key, v) { setChosen(key, v ? [v] : []); }

  // Which requirements still need an answer. A requirement that grants outright
  // — "+1 Commerce", "gain the Sixth Sense distinction" — needs none.
  function reqOpen(r) {
    if (r.waiting) return true;
    switch (r.kind) {
      case "skill":
        return !r.skill && !pick1(r.key);
      case "technique":
        return !pick1(r.key);
      case "peculiarity":
        if (r.options) return !pick1(r.key);
        if (r.subject_options || r.subject_free) return !pick1(r.key + ".subject");
        return false;
      case "item":
        if (r.name) return false;
        return !pick1(r.key + ".item") ||
          (!!r.qualities && !pick1(r.key + ".quality"));
      case "ring_swap":
        if (r.optional) return false;
        return !(pick1(r.key + ".from") && pick1(r.key + ".to"));
      case "pick_one":
        var p = pick1(r.key + ".pick");
        if (!p) return true;
        return reqOpen(r.options[Number(p)]);
      default:
        return false;
    }
  }

  /* What still needs an answer. The second roll counts: most entries state
     their whole grant in the sub-table, so an entry with a sub-table and no
     range chosen has granted nothing yet — and used to read as settled,
     because there were no requirements to be open. */
  function heritageOpen() {
    var e = heritageEntry();
    var out = heritageRequirements().filter(reqOpen);
    if (e && e.sub_table && !heritageSubRange()) {
      out.unshift({ kind: "sub_roll", prompt: "Second roll" });
    }
    return out;
  }

  // The corpus writes a name as a reference: `^"Finger of Jade"`. That is its
  // syntax, not the book's punctuation, so it comes off before display.
  function refText(t) {
    return String(t == null ? "" : t).replace(/\^"([^"]*)"/g, "$1");
  }

  /* The result, folded into one shape the rest of the wizard reads. Nothing in
     here is stored: it is the entry plus the answers, recomputed. */
  function heritageGrants() {
    var out = { skills: {}, swap: null, techniques: [], peculiarities: [],
                gear: [], koku: 1, social: { honor: 0, glory: 0, status: 0 } };
    // "If they do, the player does not apply any results from the Heritage
    // table in Question 18." The Legacy itself is an advantage and rides in
    // through peculiarityRefs(), not as a heritage grant.
    if (hasLegacy()) return out;
    var e = heritageEntry();
    if (!e) return out;

    var mods = e.modifiers || {};
    Object.keys(mods).forEach(function (k) {
      var n = parseInt(String(mods[k]).replace(/[^\-0-9]/g, ""), 10);
      var slot = k.toLowerCase();
      if (!isNaN(n) && out.social[slot] != null) out.social[slot] += n;
    });

    function fold(r) {
      if (r.waiting) return;
      if (r.kind === "pick_one") {
        var p = pick1(r.key + ".pick");
        if (p) fold(r.options[Number(p)]);
        return;
      }
      if (r.kind === "skill") {
        var name = r.skill || pick1(r.key);
        var sk = name && (SKILL_BY_LABEL[String(name).toLowerCase()] ||
                          String(name).toLowerCase());
        if (sk) out.skills[sk] = (out.skills[sk] || 0) + 1;
        return;
      }
      if (r.kind === "technique") {
        var t = pick1(r.key);
        if (t) out.techniques.push(t);
        return;
      }
      if (r.kind === "peculiarity") {
        var pn = r.options ? pick1(r.key) : r.name;
        if (!pn) return;
        var subject = r.subject || pick1(r.key + ".subject");
        if (subject) {
          // an open-ended entry with its subject filled in: the compendium
          // holds the stem, so the specific wording is carried as custom, the
          // way the archive already records "Support of the Yogo"
          out.peculiarities.push({
            name: pn.replace(/\s*\[[^\]]*\]\s*$/, "") + " " + subject,
            custom: true });
        } else {
          out.peculiarities.push({ name: pn });
        }
        return;
      }
      if (r.kind === "item") {
        var iname = r.name || pick1(r.key + ".item");
        if (!iname) return;
        var custom = !!r.custom || !!r.free;
        var note = [];
        if (r.define) note.push(r.define);
        if (r.held === false) note.push("lost — it exists somewhere in the world");
        if (r.heirloom) note.push(r.heirloom + " heirloom");
        var q = pick1(r.key + ".quality"), gq = pick1(r.key + ".gm_quality");
        if (q) note.push("quality chosen by the player: " + q);
        if (gq) note.push("quality chosen by the GM: " + gq);
        out.gear.push({ name: iname, custom: custom, held: r.held !== false,
                        note: note.join("; "),
                        needs: reqOpen(r) });
        return;
      }
      if (r.kind === "ring_swap") {
        var from = pick1(r.key + ".from"), to = pick1(r.key + ".to");
        if (from && to) out.swap = { from: from, to: to, cap: r.cap || 3 };
        return;
      }
      if (r.kind === "money" && r.koku === "double") out.koku = 2;
    }
    heritageRequirements().forEach(fold);
    return out;
  }

  // Gear the rules confer without naming it — the talisman, the estate, the
  // animal — plus any heirloom still to be chosen. The panel marks these as
  // open rather than settled.
  function grantedGear() {
    return heritageGrants().gear.filter(function (g) {
      return g.custom || g.needs;
    }).map(function (g) {
      return { name: g.name, note: g.note || "Granted by the heritage rolled at " +
               "question 18, and still to be settled with the GM.",
               needs_definition: true };
    });
  }

  // The names a heritage hands over outright, so the peculiarity pickers can
  // mark them met rather than drawing them as a collision.
  function heritageGrantedNames() {
    return heritageGrants().peculiarities.map(function (p) { return p.name; });
  }

  /* The same set as heldPeculiarities(), as references rather than names. An
     open-ended entry with its subject filled in ("Support of the Kakita
     Dueling Academy") is not in the compendium under that wording, so it
     travels as custom — otherwise the build cannot resolve it and stops. */
  function peculiarityRefs() {
    var her = heritageGrants().peculiarities;
    var byName = {};
    her.forEach(function (p) { byName[normName(p.name)] = p; });
    var leg = legacyAdvantage();
    if (leg) byName[normName(leg.name)] = leg;
    return heldPeculiarities().map(function (n) {
      var p = byName[normName(n)];
      if (!p || !p.custom) return { name: n };
      var o = { name: p.name, custom: true };
      if (p.text) o.text = p.text;
      return o;
    });
  }

  function heldPeculiarities() {
    var leg = takenLegacy();
    return [].concat(C.distinctions, C.adversities, C.passions, C.anxieties,
                     C.answers.mentor.granted ? [C.answers.mentor.granted] : [],
                     // a Legacy is an advantage in its own right, assigned with
                     // the distinctions and allowed to exceed their limit
                     leg ? [leg.name] : [],
                     // Several heritages confer one outright, and say so: "this
                     // can be assigned in excess of the normal limitations on
                     // advantages at character creation".
                     heritageGrants().peculiarities.map(function (p) {
                       return p.name;
                     }));
  }

  // L5R5e peculiarities carry no prerequisites: neither the compendium nor the
  // DSL has a requirement field, because the game does not gate them on rings,
  // clan, or school. What does gate a choice is the question being asked, what
  // the character already holds, and the handful of entries the rules confer
  // rather than sell. Those are what colour the list — nothing here is invented.
  //   "no"   red    cannot be taken here
  //   "yes"  green  a stated condition, and this character meets it
  //   "open" amber  takeable, but it needs a subject naming
  function pecStatus(e, kinds, current) {
    if (kinds.indexOf(e.kind) < 0)
      return { state: "no",
               why: "Question asks for a " + kinds.join(" or ") + "." };

    if (/^Shadowlands Taint/i.test(e.name))
      return { state: "no",
               why: "Instilled by the Afflicted condition, an oni, or a cursed " +
                    "mask. Never chosen at creation." };

    // The one chosen for this very question is the answer, not a collision —
    // it was being drawn struck through and red, reading as ineligible.
    if (current && normName(current) === normName(e.name)) {
      return { state: "plain", why: "" };
    }
    // Asked before "already on this character", because a heritage grant IS on
    // the character — it is held, and the reason it is held is worth saying.
    if (heritageGrantedNames().filter(function (g) {
      return normName(g) === normName(e.name);
    }).length)
      return { state: "yes", why: "Granted by the heritage rolled at question 18." };

    var mine = heldPeculiarities().filter(function (h) {
      return normName(h) === normName(e.name);
    });
    if (mine.length) return { state: "no", why: "Already on this character." };

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
      // What is already taken goes first, as it does in every other picker —
      // this list runs to 88 entries and the answer was otherwise below the
      // fold, which reads as nothing being chosen.
      var held = shown.filter(function (e) {
        return !!current && normName(e.name) === normName(current);
      });
      if (held.length) {
        shown = held.concat(shown.filter(function (e) {
          return normName(e.name) !== normName(current);
        }));
      }
      var takeable = shown.filter(function (e) {
        return pecStatus(e, kinds, get()).state !== "no";
      });
      count.textContent = shown.length + " shown, " + takeable.length + " takeable";
      rand.disabled = !takeable.length;

      list.innerHTML = shown.map(function (e) {
        var st = pecStatus(e, kinds, current);
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
          var st = pecStatus(e, kinds, current);
          if (st.state === "no" &&
              !confirm(e.name + " — " + st.why +
                       "\n\nTake it anyway? Nothing downstream will stop you.")) return;
          set(!!get() && normName(get()) === normName(e.name) ? null : e.name);
          draw();
          list.scrollTop = 0;
          // the AI hint above names the pick, so it has to be redrawn too
          render();
        });
      });
    }

    search.addEventListener("input", draw);
    rand.addEventListener("click", function () {
      var pool = shown.filter(function (e) {
        return pecStatus(e, kinds, get()).state !== "no";
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

        if (TAROT.length) {
          var row = document.createElement("div");
          row.className = "ai-row";
          var draw = document.createElement("button");
          draw.type = "button";
          draw.className = "ai-btn";
          draw.textContent = "Draw tarot spread";
          draw.title = "Three distinct cards from the full 78, upright or reversed, " +
            "appended to the concept above";
          draw.addEventListener("click", function () {
            var spread = drawSpread(3);
            if (!spread.length) return;
            var block = "Tarot spread\n\n" + spreadText(spread);
            C.concept = C.concept && C.concept.trim()
              ? C.concept.replace(/\s+$/, "") + "\n\n" + block
              : block;
            ta.value = C.concept;
            ta.scrollTop = ta.scrollHeight;
            save();
          });
          row.appendChild(draw);
          var hint = document.createElement("span");
          hint.className = "ai-hint";
          hint.textContent = TAROT.length + " cards · no card twice · appended, never replaced";
          row.appendChild(hint);
          body.appendChild(row);
        }
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
          pickList(body, regionSet().map(function (r) {
            return { value: r.name, label: r.name,
                     meta: [r.ring_increase_label, r.skill_increase_label,
                            r.glory != null ? "Glory " + r.glory : null]
                       .filter(Boolean).join(" · ") };
          }), C.region, function (v) {
            if (C.region !== v) C.choices = C.choices || {};
            C.region = v; save(); render();
          });
          // a region can grant a ring the player picks between
          renderChoices(body, find(REGIONS, C.region), "region");
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
        var cl = clanByName(C.clan);
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
          /* The book asks this here: "Depending on what type of character you
             choose, you have a particular base status value that is modified
             by your upbringing" (Path of Waves p.46). Without it the base was
             0 and every upbringing's modification was applied to nothing. */
          label(body, "What kind of character is this");
          var trow = document.createElement("div");
          trow.className = "need-row wrapped";
          trow.innerHTML = '<span class="need-k">Type</span>' +
            ORIGIN_TYPES.map(function (t) {
              return '<button type="button" class="choice small' +
                (originType().key === t.key ? " active" : "") +
                '" data-v="' + t.key + '" title="' + esc(t.note) + '">' +
                esc(t.label) + " · status " + t.status + "</button>";
            }).join("");
          trow.addEventListener("click", function (e) {
            var b = e.target.closest("button[data-v]");
            if (!b) return;
            C.origin_type = b.dataset.v; save(); render();
          });
          body.appendChild(trow);
          var tn = document.createElement("p");
          tn.className = "muted small";
          tn.textContent = "Status begins there, and the upbringing below "
            + "modifies it — a reduction never takes it below 0.";
          body.appendChild(tn);

          label(body, "Upbringing");
          pickList(body, upbringingSet().map(function (u) {
            return { value: u.name, label: u.name,
                     meta: [u.ring_increase_label, u.skill_increases_label,
                            u.starting_wealth_label,
                            u.status_modification != null
                              ? "Status " + (u.status_modification > 0 ? "+" : "") +
                                u.status_modification : null]
                       .filter(Boolean).join(" · ") };
          }), C.upbringing, function (v) {
            if (C.upbringing !== v) C.choices = C.choices || {};
            C.upbringing = v; save(); render();
          });
          renderChoices(body, find(UPBRINGINGS, C.upbringing), "upbringing");
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
                          // the corpus's own wording: "10 zeni" reads better
                          // than the 0.2 koku it is equivalent to
                          f.starting_wealth_label || null,
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
            label(body, (g.category_label || cap(g.category) || "Technique") + " — choose " + (g.n || 1));
            var p = document.createElement("p");
            p.className = "muted small";
            p.textContent = note || g.options[0];
            body.appendChild(p);
            return;
          }
          chooseGroup(body, "school.tech." + i,
                      (g.category_label || cap(g.category) || "Technique") +
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
        var table = (alt.table) ||
                    (QUESTIONS["5"] && QUESTIONS["5"].pow || {}).table;
        if (table && (table.rows || []).length) {
          var rows = table.rows.map(tableRow);
          label(body, "Sample pasts");
          rollRow(body, "q5.past", rows, table.die);
          optionRow(body, "q5.past", rows);
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
            }, { atZero: true });
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
          }, { atZero: true });
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
          }, { only: BUSHIDO_DIVERGENT_SKILLS });
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
        mentorSection(body);
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

    { id: "appearance", n: 14, label: "Noticed First", title: function () { return qText(14) || "First Impression"; },
      desc: function () {
        return qAlt(14)
          ? "When everything you own fits in a pack, one thing still matters more than the rest. Choose it from your outfit, or any item of rarity 5 or lower."
          : "Not a portrait — the one oddity that gets noticed, from an unusual " +
            "feature to a trivial mannerism. The book's own examples are chewing " +
            "one's lip when nervous, or clasping the hands to hide trembling " +
            "fingers. Then one distinctive aesthetic accoutrement they carry or " +
            "wear most of the time.";
      },
      done: function () {
        if (qAlt(14)) return has(C.answers.prized_possession);
        return has(C.answers.first_impression) && has(C.answers.accoutrement);
      },
      render: function (body) {
        var alt = qAlt(14);
        if (!alt) {
          textStep("appearance", "answers.first_impression", "first_impression",
            "A feature, a mannerism, a tic — something you could point at…")(body);
          // Core p.93: "choose one distinctive aesthetic accoutrement that your
          // character carries or wears most of the time" — a second answer the
          // question asks for, and the step had nowhere to put it.
          label(body, "Aesthetic accoutrement");
          textStep("accoutrement", "answers.accoutrement", "accoutrement",
            "A scarf, a hair ornament, an engraved scabbard, an eyepatch…")(body);
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
        // Seed the first person from a relationships answer written before this
        // step had structure, so an older draft is not silently emptied.
        C.answers.people = C.answers.people || [];
        if (!C.answers.people.length) {
          C.answers.people.push({ name: "", gender: "any", association: "",
                                  text: C.answers.relationships || "" });
        }
        C.answers.people.forEach(function (p, i) { personBlock(body, p, i); });

        var add = document.createElement("button");
        add.type = "button";
        add.className = "btn ghost add-person";
        add.textContent = "+ Another person";
        add.addEventListener("click", function () {
          C.answers.people.push({ name: "", gender: "any", association: "", text: "" });
          save(); render();
        });
        body.appendChild(add);

        startingItemSection(body);
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
        }, { atZero: true });
      } },

    { id: "heritage", n: 18, label: "Heritage", title: function () { return qText(18) || "Family Heritage"; },
      desc: function () {
        return qAlt(18)
          ? "Most people know who raised them; some do not. Record the relationship, and the skill it left behind."
          : "Roll d10 (or pick) on a heritage table. The result says something about your family's past, and usually carries a modifier and a second roll. The core Samurai table is the default; most supplements offer a replacement table you may use instead.";
      },
      done: function () {
        if (qAlt(18)) return has(C.answers.raised_by) && has(C.answers.raised_skill);
        // A Legacy answers the question instead, and answers it fully only
        // when any obligation it puts on the successor is on the character.
        if (hasLegacy()) {
          var ob = legacyObligation();
          return !ob || ob.met;
        }
        // Rolling the entry is half the question. The step is answered when
        // what it grants has actually been settled — the skill picked, the
        // technique chosen, the heirloom named.
        return has(C.answers.heritage) && !heritageOpen().length &&
          !computed().pending.filter(function (p) {
            return p.type === "swap";
          }).length;
      },
      render: function (body) {
        var alt18 = qAlt(18);
        if (!alt18) {
          /* The other door. Legacies of War: a player making a new character
             mid-campaign may take on their last PC's Legacy, and if they do
             they apply no heritage result at all. Offered only when a Legacy
             has actually been left, so a table not using them never sees it. */
          if (LEGACY_RECORDS.length) {
            label(body, "How this question is answered");
            /* Which door is open is its own state: "" means the Legacy door
               with nothing picked yet. Deriving it from whether a Legacy is
               chosen meant choosing the door did nothing visible and dropped
               you back on the heritage tables. */
            choice(body, [["heritage", "Roll on a heritage table"],
                          ["legacy", "Take on a Legacy"]],
                   C.answers.legacy === null ? "heritage" : "legacy",
                   function (v) {
              if (v === "legacy") {
                forgetHeritagePicks();
                C.answers.heritage = null;
                C.answers.heritage_sub = null;
                C.answers.legacy = "";
              } else {
                C.answers.legacy = null;
                C.answers.legacy_inverted = false;
              }
              save(); render();
            });
          }
          if (C.answers.legacy !== null && C.answers.legacy !== undefined) {
            return legacySection(body);
          }
        }
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
          }, { atZero: true });
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
            forgetHeritagePicks();
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
          var e = rollOn(table.entries, function (x) { return x.roll; });
          forgetHeritagePicks();
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
            (e.effect ? '<span class="h-eff">' + esc(refText(e.effect)) + "</span>" : "") +
            (e.sub_table
              ? '<span class="h-sub">' + esc(e.sub_table.die) + ": " +
                e.sub_table.ranges.map(function (r) {
                  return "<em>" + esc(r.range) + "</em> " + esc(refText(r.text));
                }).join(" · ") + "</span>"
              : "") +
            "</span></button>";
        }).join("");
        Array.prototype.forEach.call(list.querySelectorAll(".heritage"), function (b) {
          b.addEventListener("click", function () {
            forgetHeritagePicks();
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
            var r = rollOn(chosen.sub_table.ranges, function (x) { return x.range; });
            forgetHeritagePicks();
            C.answers.heritage_sub = r.range + " — " + r.text;
            save(); render();
          });
          body.appendChild(subRoll);
          pickList(body, chosen.sub_table.ranges.map(function (r) {
            return { value: r.range + " — " + r.text, label: refText(r.text),
                     meta: r.range };
          }), C.answers.heritage_sub, function (v) {
            C.answers.heritage_sub = v; save(); render();
          });
        }

        heritageGrantSection(body);
      } },

    { id: "final-name", n: 19, label: "Name", title: function () { return qText(19) || "Your Character's Name"; },
      desc: "Settle on a final name. In Rokugan this is conventionally &lt;Family&gt; &lt;Personal&gt;, family name first.",
      done: function () { return has(C.name); },
      render: ownNameSection },

    { id: "death", n: 20, label: "Death", title: function () { return qText(20) || "Vision of Death"; },
      desc: "How does your character die? A vision, premonition, or expectation of their end — not a prediction the game must honour, but a meaningful death the player invites.",
      done: function () { return has(C.answers.death); },
      render: textStep("death", "answers.death", "death", "The ending they would not regret…") },

    { id: "export", n: 21,
      label: function () { return isEdit() ? "Save" : "Export"; },
      title: function () {
        return isEdit() ? "Land the Edit" : "Add to the Archive";
      },
      desc: function () {
        return isEdit()
          ? "This character is already in the archive, so there is nothing to " +
            "add — the change is landed against the record it came from. " +
            "Copy or download what is below and run " +
            "<code>python3 scripts/apply_edit.py &lt;name&gt;</code>, which shows " +
            "you field by field what would change before it writes anything." +
            (activeDraft().proseOnly
              ? " Only the prose of this one can change: it is held at " +
                activeDraft().baseTiers + " XP tiers, whose numbers were built " +
                "from tier 0, and the applier refuses the rest."
              : "")
          : "The creator emits this repo's own character source format. Save it as <code>src/characters/&lt;slug&gt;.json</code>, then run <code>./scripts/pipeline.sh</code> — the build resolves every name to the compendium's verbatim rules text and generates the dossier, the coverage entry, and a playable sheet.";
      },
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
  var GEAR_TEXT = window.L5R_EQUIPMENT_TEXT || {};
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

  /* "During character creation, no ring may exceed 3 and no skill may exceed
     3" — l5r5e-0.4-core-chargen.ttrpg, and Path of Waves states it again for
     rōnin. The book's remedy is not to clamp: "if a choice would result in a
     ring rising above rank 3 during character creation, then the player must
     choose a different ring to increase instead". So an option that would
     breach it is marked and refused, and the same confirm-and-continue the
     peculiarity picker uses is offered, because the GM outranks the tool. */
  var CREATION_CAP = 3;

  // What an option would bring its ring or skill to if taken.
  function wouldReach(heading, option, by) {
    var d;
    try { d = computed(); } catch (e) { return null; }
    if (/^Ring/.test(heading)) {
      var r = String(option).toLowerCase();
      if (d.rings[r] == null) return null;
      return { kind: "ring", label: cap(r), now: d.rings[r],
               then: d.rings[r] + by };
    }
    if (/kill/.test(heading)) {
      var sk = SKILL_BY_LABEL[String(option).toLowerCase()] ||
               String(option).toLowerCase();
      var now = d.skills[sk] || 0;
      return { kind: "skill", label: SKILL_LABEL[sk] || cap(sk), now: now,
               then: now + by };
    }
    return null;
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
      // only a pick that is not already held can breach the cap
      var w = on ? null : wouldReach(heading, o, yield_);
      var over = w && w.then > CREATION_CAP;
      return '<button type="button" class="choice' + (on ? " active" : "") +
        (over ? " over-cap" : "") + '" data-v="' + esc(o) + '"' +
        (over ? ' title="' + esc(w.label + " is at " + w.now + "; this would " +
                              "make it " + w.then + ", and nothing may pass " +
                              CREATION_CAP + " during creation") + '"' : "") +
        '>' + esc(fmt ? fmt(o) : o) + "</button>";
    }).join("") +
      '<span class="choose-n' + (picked.length === n ? " ok" : "") + '">' +
      picked.length + "/" + n + "</span>";

    Array.prototype.forEach.call(row.querySelectorAll(".choice"), function (b) {
      if (tips) wireTip(b, b.getAttribute("data-v"));
      b.addEventListener("click", function () {
        var v = b.getAttribute("data-v");
        var at = picked.indexOf(v);
        if (at < 0) {
          var w = wouldReach(heading, v, yield_);
          if (w && w.then > CREATION_CAP &&
              !confirm(w.label + " is at " + w.now + ", and this would make it " +
                       w.then + ".\n\nDuring character creation nothing may " +
                       "pass " + CREATION_CAP + " — the rule is to increase " +
                       "something else instead.\n\nTake it anyway?")) {
            hideTip();
            return;
          }
        }
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
     // a region states ^"Skill Increase" and an upbringing ^"Skill Increases";
     // both are here or a region's skill choice is never offered
     ["skill_increase", "Skill"],
     ["starting_skills", "Starting skill"]].forEach(function (pair) {
      var v = source[pair[0]];
      if (v && v._choose) {
        out.push([prefix + "." + pair[0], pair[1], v._choose]);
      }
    });
    return out;
  }

  // "families" -> "family", "schools" -> "school"; stripping the s alone gave
  // "is not a Dragonfly familie"
  function singular(noun) {
    return noun.replace(/ies$/, "y").replace(/s$/, "");
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
          singular(noun) + ", so the list is unfiltered to keep it in view.";
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

  /* Roll on a table instead of choosing from it. The row that comes up is
     selected the same way a click would select it, so the two paths cannot
     diverge, and the die and the number rolled are both said out loud. */
  function rollRow(body, key, rows, die) {
    var sides = dieSides(die);
    var row = document.createElement("div");
    row.className = "ai-row";
    var b = document.createElement("button");
    b.type = "button";
    b.className = "ai-btn";
    b.textContent = "Roll " + (die || "d10");
    var said = document.createElement("span");
    said.className = "ai-hint";
    /* The number rolled is shown here rather than through setStatus(), which
       writes to the sync row — absent entirely when no table Worker is
       configured, so on a local build the roll would say nothing at all.

       Kept per key, with the entry it produced, so the line cannot outlive
       what it describes: choose a different entry by hand and it stops
       claiming a roll. */
    C.answers.rolls = C.answers.rolls || {};
    var was = C.answers.rolls[key];
    var still = was && chosen(key)[0] === was.label;
    said.textContent = still
      ? "rolled " + was.roll + " on " + (die || "d10")
      : rows.length + " entries · roll or choose";
    b.addEventListener("click", function () {
      var hit = rollFace(rows, function (x) { return x.roll; }, sides);
      if (!hit || !hit.entry) return;
      setChosen(key, [hit.entry.label]);
      C.answers.rolls[key] = { roll: hit.face == null ? hit.entry.roll : hit.face,
                               label: hit.entry.label };
      save();
      render();
    });
    row.appendChild(b);
    row.appendChild(said);
    body.appendChild(row);
  }

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

  /* The mentor: who they are, and who they belong to. The association drives
     the name roll — a Crane mentor gets a Crane family in front of their name,
     an order or a tradition gets a personal name alone. */
  function mentorSection(body) {
    var m = C.answers.mentor;

    label(body, "Their clan or association");
    var row = document.createElement("div");
    row.className = "lord-row";
    var assoc = document.createElement("input");
    assoc.type = "text";
    assoc.placeholder = "A clan, an order, a tradition — or roll one";
    assoc.value = m.association || "";
    assoc.addEventListener("input", function () {
      m.association = assoc.value;
      save();
    });
    row.appendChild(assoc);
    var rollA = document.createElement("button");
    rollA.type = "button";
    rollA.className = "btn ghost lord-roll";
    rollA.textContent = "Roll";
    rollA.title = "A clan three times out of four, otherwise one of the orders, " +
      "traditions or conspiracies the corpus names";
    rollA.addEventListener("click", function () {
      var a = rollAssociation();
      if (!a) return;
      m.association = a;
      save();
      render();
    });
    row.appendChild(rollA);
    body.appendChild(row);

    nameSection(body, {
      heading: "Their name",
      placeholder: "Name your mentor, or roll one",
      get: function () { return m.name; },
      set: function (v) { m.name = v; },
      gender: function () { return m.gender; },
      setGender: function (v) { m.gender = v; },
      family: function () {
        var byClan = (NAMES.family || {}).by_clan || {};
        if (m.association && isClan(m.association)) {
          var key = Object.keys(byClan).filter(function (k) {
            return normName(k) === normName(m.association);
          })[0];
          if (key) return pickFrom(byClan[key]);
        }
        return null;   // an order or a tradition: a personal name alone
      },
      note: m.association
        ? (isClan(m.association)
            ? "Rolls a " + m.association + " family in front of the name."
            : m.association + " is not a clan, so the roll gives a personal name alone.")
        : "Roll or name an association above and the name roll will follow it."
    });
  }

  /* One person in the character's life, at question 16. Same controls as the
     mentor — an association with its own roll, a name roll that follows it —
     plus the relationship itself, with the usual suggestion. Any number of
     these; they are distinct people and each keeps its own fields. */
  function personBlock(body, person, index) {
    var wrap = document.createElement("div");
    wrap.className = "person";
    body.appendChild(wrap);

    var head = document.createElement("div");
    head.className = "person-head";
    head.innerHTML = '<span class="person-n">Person ' + (index + 1) + "</span>";
    var del = document.createElement("button");
    del.type = "button";
    del.className = "person-x";
    del.title = "Remove this person";
    del.textContent = "×";
    del.addEventListener("click", function () {
      C.answers.people.splice(index, 1);
      syncRelationships();
      save();
      render();
    });
    head.appendChild(del);
    wrap.appendChild(head);

    label(wrap, "Their clan or association");
    var row = document.createElement("div");
    row.className = "lord-row";
    var assoc = document.createElement("input");
    assoc.type = "text";
    assoc.placeholder = "A clan, an order, a tradition — or roll one";
    assoc.value = person.association || "";
    assoc.addEventListener("input", function () {
      person.association = assoc.value; syncRelationships(); save();
    });
    row.appendChild(assoc);
    var rollA = document.createElement("button");
    rollA.type = "button";
    rollA.className = "btn ghost lord-roll";
    rollA.textContent = "Roll";
    rollA.addEventListener("click", function () {
      var a = rollAssociation();
      if (!a) return;
      person.association = a; syncRelationships(); save(); render();
    });
    row.appendChild(rollA);
    wrap.appendChild(row);

    nameSection(wrap, {
      heading: "Their name",
      placeholder: "Name them, or roll one",
      get: function () { return person.name; },
      set: function (v) { person.name = v; syncRelationships(); },
      gender: function () { return person.gender; },
      setGender: function (v) { person.gender = v; },
      family: function () { return familyForAssociation(person.association); },
      note: person.association
        ? (isClan(person.association)
            ? "Rolls a " + person.association + " family in front of the name."
            : person.association + " is not a clan, so the roll gives a personal name alone.")
        : "Roll or name an association above and the name roll will follow it."
    });

    label(wrap, "The relationship");
    var ta = document.createElement("textarea");
    ta.rows = 2;
    ta.placeholder = "What are they to each other, and what stands between them?";
    ta.value = person.text || "";
    ta.addEventListener("input", function () {
      person.text = ta.value; syncRelationships(); save();
    });
    wrap.appendChild(ta);
    wireAi(ta, "relationship_person", function (v) {
      person.text = v; ta.value = v; syncRelationships(); save();
    }, {
      extra: function () {
        var who = [person.name, person.association && ("of the " + person.association)]
          .filter(Boolean).join(", ");
        return who
          ? "The person in question is " + who + ". Write the relationship between " +
            "them and the character."
          : "";
      }
    });
  }

  // A family of that association's clan, or null if it is not a clan.
  function familyForAssociation(assoc) {
    var byClan = (NAMES.family || {}).by_clan || {};
    if (!assoc || !isClan(assoc)) return null;
    var key = Object.keys(byClan).filter(function (k) {
      return normName(k) === normName(assoc);
    })[0];
    return key ? pickFrom(byClan[key]) : null;
  }

  /* answers.relationships stays the exported answer and the one the rest of the
     wizard reads, so the structured people are folded back into it whenever they
     change rather than becoming a second source of truth. */
  function syncRelationships() {
    var people = C.answers.people || [];
    if (!people.length) return;
    C.answers.relationships = people.map(function (p) {
      var who = [p.name, p.association && ("(" + p.association + ")")]
        .filter(Boolean).join(" ");
      return [who, p.text].filter(function (x) { return x && x.trim(); }).join(" — ");
    }).filter(Boolean).join("\n");
  }

  /* The starting item. Filters by type and by rarity, because 261 pieces of
     equipment in one alphabetical list is not a choice anyone can make, and two
     ways to roll: flat, or weighted toward whatever one of the people above is
     connected to — a gift has a provenance. */
  var ITEM_TYPES = [["", "All"], ["item", "Items"], ["weapon", "Weapons"],
                    ["armor", "Armour"]];
  // In the weapons pack but not kit: a creature's natural attack, a siege
  // engine, a chair swung in a brawl. Same exclusion the pregen generator uses.
  var NOT_KIT_CATEGORIES = ["Unarmed profiles", "Siege Weapons", "Improvised Weapons"];

  function isEquipment(e) {
    return ["item", "weapon", "armor"].indexOf(e.sub_type) >= 0 &&
      NOT_KIT_CATEGORIES.indexOf(e.category) < 0;
  }

  function itemRarity(e) {
    var r = e.rarity != null ? e.rarity : (e.data && e.data.rarity);
    r = parseInt(r, 10);
    return isNaN(r) ? null : r;
  }

  /* How strongly an item belongs to a person's clan or association, so a gift
     has a provenance. Matched on the association's name and, when it is a clan,
     its families — "Kaiu no Oyumi" is a Crab thing because Kaiu is a Crab family.

     The catalog gives little to work with: the equipment packs carry no clan
     field, so only 1 to 3 of the 261 pieces match any given clan by name. The
     weight is therefore large — a match has to be worth something for the button
     to mean anything — and where nothing matches the roll is simply flat, which
     the button says when it happens. */
  var AFFINITY_WEIGHT = 40;

  function affinityTokens(assoc) {
    if (!assoc) return [];
    var out = [assoc];
    var byClan = (NAMES.family || {}).by_clan || {};
    Object.keys(byClan).forEach(function (k) {
      if (normName(k) === normName(assoc)) out = out.concat(byClan[k]);
    });
    return out.map(normName).filter(function (t) { return t.length > 3; });
  }

  function affinity(e, tokens) {
    if (!tokens.length) return 1;
    var hay = normName(e.name + " " + (e.source_book || "") + " " + (e.clan || ""));
    return tokens.some(function (t) { return hay.indexOf(t) >= 0; })
      ? AFFINITY_WEIGHT : 1;
  }

  function startingItemSection(body) {
    label(body, "Starting item");

    var state = C._item_filter || (C._item_filter = { type: "", rarity: 7 });
    var pool = function () {
      return CATALOG.filter(function (e) {
        if (!isEquipment(e)) return false;
        if (state.type && e.sub_type !== state.type) return false;
        var r = itemRarity(e);
        if (state.rarity && r != null && r > state.rarity) return false;
        return true;
      });
    };

    label(body, "Type");
    choice(body, ITEM_TYPES, state.type, function (v) {
      state.type = v; save(); render();
    });

    label(body, "Rarity at most");
    choice(body, [["4", "4"], ["6", "6"], ["7", "7 (starting)"], ["9", "Any"]],
      String(state.rarity), function (v) {
        state.rarity = Number(v); save(); render();
      });

    var row = document.createElement("div");
    row.className = "ai-row item-rolls";
    var rand = document.createElement("button");
    rand.type = "button";
    rand.className = "btn ghost";
    rand.textContent = "Choose at random";
    rand.addEventListener("click", function () {
      var p = pool();
      if (!p.length) return;
      C.starting_item = p[randomBelow(p.length)].name;
      save(); render();
    });
    row.appendChild(rand);

    var people = (C.answers.people || []).filter(function (p) {
      return (p.name || p.association || "").trim();
    });
    if (people.length) {
      var sel = document.createElement("select");
      sel.className = "item-by";
      sel.innerHTML = people.map(function (p, i) {
        return '<option value="' + i + '">' +
          esc(p.name || p.association) + "</option>";
      }).join("");
      var byBtn = document.createElement("button");
      byBtn.type = "button";
      byBtn.className = "btn ghost";
      byBtn.textContent = "Random, weighted by";
      byBtn.addEventListener("click", function () {
        var who = people[Number(sel.value)] || people[0];
        var p = pool();
        if (!p.length) return;
        var tokens = affinityTokens(who.association);
        var matches = p.filter(function (e) {
          return affinity(e, tokens) > 1;
        }).length;
        var weights = p.map(function (e) { return affinity(e, tokens); });
        var total = weights.reduce(function (a, b) { return a + b; }, 0);
        var roll = randomBelow(total), acc = 0, chosenItem = p[p.length - 1];
        for (var i = 0; i < p.length; i++) {
          acc += weights[i];
          if (roll < acc) { chosenItem = p[i]; break; }
        }
        C.starting_item = chosenItem.name;
        C._item_weighted = who.association
          ? (matches
              ? matches + " of " + p.length + " weighted toward " + who.association
              : "nothing in this filter is tied to " + who.association +
                " — rolled flat")
          : "no association on that person — rolled flat";
        save(); render();
      });
      row.appendChild(byBtn);
      row.appendChild(sel);
    }
    body.appendChild(row);

    if (C._item_weighted) {
      var wn = document.createElement("p");
      wn.className = "muted small";
      wn.textContent = C._item_weighted;
      body.appendChild(wn);
    }

    var p = pool();
    var items = p.map(function (e) {
      var r = itemRarity(e);
      return { value: e.name, label: e.name,
               meta: [cap(e.sub_type), r != null ? "Rarity " + r : null,
                      e.source_book].filter(Boolean).join(" · ") };
    });
    var count = document.createElement("p");
    count.className = "muted small";
    count.textContent = items.length + " of " +
      CATALOG.filter(isEquipment).length + " shown";
    body.appendChild(count);
    pickList(body, items, C.starting_item, function (v) {
      C.starting_item = v; save();
    }, { tip: ruleTextFor });
  }

  /* ------------------------------------- question 18: settling the result

     One control per requirement, in the order the rules state them. Each is
     the same picker used wherever else the wizard asks for that kind of thing,
     so a technique from a heritage is chosen from the compendium exactly as a
     school technique is. */

  function reqHeading(body, r, n) {
    var h = document.createElement("h4");
    h.className = "field-label her-req" + (reqOpen(r) ? " open" : " settled");
    h.innerHTML = '<span class="hr-n">' + n + "</span>" + esc(r.prompt) +
      (r.optional ? ' <span class="hr-opt">optional</span>' : "") +
      (r.category_label
        ? ' <span class="hr-sub">' + esc(refText(r.category_label)) + "</span>"
        : "");
    body.appendChild(h);
  }

  // A technique the heritage teaches: rank 1, of the rolled category, and
  // performable even where the school does not allow it.
  function reqTechnique(body, r) {
    var kinds = r.kinds || (r.category ? [r.category] : []);
    if (!kinds.length) return needs(body, "The second roll names the category.");
    var pool = CATALOG.filter(function (e) {
      return e.sub_type === "technique" && e.rank === (r.rank || 1) &&
        kinds.indexOf(String(e.kind || "").toLowerCase()) >= 0 &&
        (!r.ring || String(e.ring || "").toLowerCase() === r.ring);
    });
    if (!pool.length) {
      return needs(body, "Nothing in the compendium matches " +
        kinds.join(" or ") + " at rank " + (r.rank || 1) +
        (r.ring ? " with the " + cap(r.ring) + " ring" : "") + ".");
    }
    pickList(body, pool.map(function (e) {
      return { value: e.name, label: e.name,
               meta: [cap(e.kind), e.ring ? cap(e.ring) : null,
                      e.source_book].filter(Boolean).join(" · ") };
    }), pick1(r.key), function (v) { setPick1(r.key, v); render(); },
      { tip: ruleTextFor });
  }

  function reqSkill(body, r) {
    if (r.skill) {
      // nothing to choose: the roll named it
      var p = document.createElement("p");
      p.className = "muted small";
      p.textContent = "+1 rank in " + r.skill + ", applied.";
      body.appendChild(p);
      return;
    }
    var opts = r.options;
    if (r.from === "school_starting_at_zero") {
      // "one of the starting skills for your school in which your character
      // has no ranks" — measured before this grant, so the one just chosen
      // does not vanish out of its own list
      var sch = schoolByRollName(C.school);
      var spec = sch && sch.starting_skills && sch.starting_skills._choose;
      var all = spec ? spec.options : [];
      var have = computed().skills, mine = heritageGrants().skills;
      opts = all.filter(function (o) {
        var k = SKILL_BY_LABEL[String(o).toLowerCase()] ||
                String(o).toLowerCase();
        return ((have[k] || 0) - (mine[k] || 0)) === 0;
      });
      if (!opts.length) {
        return needs(body, sch
          ? "Every starting skill for " + C.school + " already has a rank."
          : "Choose a school first.");
      }
    }
    pickList(body, (opts || []).map(function (o) {
      return { value: o, label: o };
    }), pick1(r.key), function (v) { setPick1(r.key, v); render(); });
  }

  function reqPeculiarity(body, r) {
    if (r.options) {
      pickList(body, r.options.map(function (o) {
        return { value: o, label: o };
      }), pick1(r.key), function (v) { setPick1(r.key, v); render(); },
        { tip: ruleTextFor });
      return;
    }
    var note = document.createElement("p");
    note.className = "muted small";
    note.innerHTML = "Gains <strong>" + esc(r.name) + "</strong>" +
      (r.subject ? " (" + esc(r.subject) + ")" : "") + ".";
    body.appendChild(note);
    if (r.subject_options) {
      pickList(body, r.subject_options.map(function (o) {
        return { value: o, label: o };
      }), pick1(r.key + ".subject"), function (v) {
        setPick1(r.key + ".subject", v); render();
      });
    } else if (r.subject_free) {
      var inp = document.createElement("input");
      inp.type = "text";
      inp.className = "textline";
      inp.placeholder = "Name " + r.subject_free;
      inp.value = pick1(r.key + ".subject") || "";
      inp.addEventListener("change", function () {
        setPick1(r.key + ".subject", inp.value.trim()); render();
      });
      body.appendChild(inp);
    }
  }

  function reqItem(body, r) {
    if (r.name) {
      var p = document.createElement("p");
      p.className = "muted small";
      p.textContent = r.name + (r.define ? " — " + r.define : "") + ".";
      body.appendChild(p);
    } else if (r.free) {
      // no compendium behind it: a horse, a boat, the deed to a piece of land
      var inp = document.createElement("input");
      inp.type = "text";
      inp.className = "textline";
      inp.placeholder = "Name " + r.free;
      inp.value = pick1(r.key + ".item") || "";
      inp.addEventListener("change", function () {
        setPick1(r.key + ".item", inp.value.trim()); render();
      });
      body.appendChild(inp);
    } else {
      var pool = CATALOG.filter(function (e) {
        if (!isEquipment(e)) return false;
        if (r.type && e.sub_type !== r.type) return false;
        var rr = itemRarity(e);
        if (r.rarity_max != null && rr != null && rr > r.rarity_max) return false;
        return true;
      });
      var count = document.createElement("p");
      count.className = "muted small";
      count.textContent = pool.length + " to choose from" +
        (r.rarity_max != null ? ", rarity " + r.rarity_max + " or lower" : "") + ".";
      body.appendChild(count);
      pickList(body, pool.map(function (e) {
        var rr = itemRarity(e);
        return { value: e.name, label: e.name,
                 meta: [cap(e.sub_type), rr != null ? "Rarity " + rr : null,
                        e.source_book].filter(Boolean).join(" · ") };
      }), pick1(r.key + ".item"), function (v) {
        setPick1(r.key + ".item", v); render();
      }, { tip: ruleTextFor });
    }
    if (r.held === false) {
      var lost = document.createElement("p");
      lost.className = "muted small";
      lost.textContent = "It is not in hand: it exists somewhere in the world, " +
        "and reclaiming it is something the campaign can be about.";
      body.appendChild(lost);
    }
    if (r.qualities) {
      // "You choose one quality and the GM chooses one quality" — the player's
      // is theirs to settle here; the GM's is recorded when the GM says.
      var qs = itemQualities().map(function (q) {
        return { value: q, label: q };
      });
      label(body, "Quality you choose");
      pickList(body, qs, pick1(r.key + ".quality"), function (v) {
        setPick1(r.key + ".quality", v); render();
      }, { tip: ruleTextFor });
      label(body, "Quality the GM chooses (optional here)");
      pickList(body, qs, pick1(r.key + ".gm_quality"), function (v) {
        setPick1(r.key + ".gm_quality", v); render();
      }, { tip: ruleTextFor });
    }
  }

  function reqRingSwap(body, r) {
    var d = computed();
    var to = r.to === "any" ? RING_NAMES : (r.to || RING_NAMES);
    var from = pick1(r.key + ".from"), into = pick1(r.key + ".to");
    label(body, "Reduce by 1");
    choice(body, RING_NAMES.map(function (n) {
      return [n.toLowerCase(), n + " " + d.rings[n.toLowerCase()]];
    }), from, function (v) {
      setPick1(r.key + ".from", from === v ? null : v); render();
    });
    label(body, "Raise by 1" + (r.cap ? " (never above " + r.cap + ")" : ""));
    choice(body, to.map(function (n) {
      return [String(n).toLowerCase(), n + " " + d.rings[String(n).toLowerCase()]];
    }), into, function (v) {
      setPick1(r.key + ".to", into === v ? null : v); render();
    });
    if (from && into) {
      var swapped = d.from.rings[into] && d.from.rings[into].filter(function (c) {
        return c.source === "Question 18";
      }).length;
      if (!swapped) {
        var why = document.createElement("p");
        why.className = "muted small";
        why.textContent = from === into
          ? "Pick two different rings."
          : "Not applied: a ring cannot go below 1, and cannot be raised above " +
            (r.cap || 3) + " during creation.";
        body.appendChild(why);
      }
    }
  }

  function renderRequirement(body, r, n) {
    reqHeading(body, r, n);
    if (r.waiting) {
      return needs(body, "Roll or choose on the second table first — it names " +
                         "what this grants.");
    }
    if (r.kind === "sub_roll") {
      return needs(body, "Roll or choose on the second table above — it names " +
                         "what this result grants.");
    }
    if (r.kind === "skill") return reqSkill(body, r);
    if (r.kind === "technique") return reqTechnique(body, r);
    if (r.kind === "peculiarity") return reqPeculiarity(body, r);
    if (r.kind === "item") return reqItem(body, r);
    if (r.kind === "ring_swap") return reqRingSwap(body, r);
    if (r.kind === "money") {
      return needs(body, "Starting koku doubled.");
    }
    if (r.kind === "pick_one") {
      var picked = pick1(r.key + ".pick");
      choice(body, r.options.map(function (o, i) {
        // "Passion" says less than "Glorious Deeds (passion)"
        return [String(i), o.name ? o.name + " (" + o.prompt.toLowerCase() + ")"
                                  : o.prompt];
      }), picked, function (v) {
        setPick1(r.key + ".pick", picked === v ? null : v); render();
      });
      if (picked) renderRequirement(body, r.options[Number(picked)], n + "·");
      return;
    }
  }

  // The block under the entry cards: what this result actually does, and every
  // control needed to settle it.
  function heritageGrantSection(body) {
    var e = heritageEntry();
    if (!e) return;
    var reqs = heritageRequirements();
    // Where the grant is stated in the sub-table, there is nothing to show
    // until the second roll happens — so say that, in place of the controls.
    if (e.sub_table && !heritageSubRange()) {
      reqs = [{ kind: "sub_roll", prompt: "Second roll", key: "heritage.sub" }];
    }
    var mods = Object.keys(e.modifiers || {}).filter(function (k) {
      return k !== "note";
    });
    if (!reqs.length && !mods.length) return;

    var wrap = document.createElement("div");
    wrap.className = "her-grants";
    // An answered swap that the ring caps will not allow is not settled either,
    // and computed() is the only thing that knows whether it applies.
    var open = heritageOpen().length +
      computed().pending.filter(function (p) { return p.type === "swap"; }).length;
    wrap.innerHTML = '<h4 class="field-label her-head">What this result grants' +
      '<span class="hg-n' + (open ? "" : " ok") + '">' +
      (open ? open + " to settle" : "settled") + "</span></h4>" +
      (mods.length
        ? '<p class="her-mods">' + mods.map(function (k) {
            return "<span>" + esc(k) + " " + esc(e.modifiers[k]) + "</span>";
          }).join("") + "</p>"
        : "");
    body.appendChild(wrap);
    reqs.forEach(function (r, i) { renderRequirement(wrap, r, i + 1); });
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
  /* Several questions grant a skill rank but restrict what may be chosen, and
     the restriction is part of the rule rather than a nicety:

       opts.atZero  the book's "one skill currently at rank 0" (questions 7 and
                    17, and their Path of Waves counterparts). The skill this
                    step itself raised is already at 1 by the time the list is
                    drawn, so `current` is always kept in view — otherwise the
                    answer would vanish the moment it was given.
       opts.only    an explicit list, as question 8's divergent attitude allows
                    only Commerce, Labor, Medicine, Seafaring, Skulduggery or
                    Survival.

     Ranks counted here are the running total, so a skill raised by the clan,
     family or school no longer qualifies for a rank-0 grant. */
  // Core Rulebook p. 91: a character who diverges from common beliefs about
  // honourable behaviour gains a rank in one of these six, "to reflect past
  // behavior that was unbefitting of a samurai".
  var BUSHIDO_DIVERGENT_SKILLS =
    ["commerce", "labor", "medicine", "seafaring", "skulduggery", "survival"];

  function skillPicker(body, current, onPick, opts) {
    opts = opts || {};
    var d = computed();
    var items = [];
    Object.keys(SKILL_GROUPS).forEach(function (g) {
      SKILL_GROUPS[g].forEach(function (s) {
        if (opts.only && opts.only.indexOf(s) < 0 && s !== current) return;
        var rank = (d.skills && d.skills[s]) || 0;
        if (opts.atZero && s !== current && rank > 0) return;
        items.push({ value: s, label: SKILL_LABEL[s], meta: cap(g) });
      });
    });
    if (opts.atZero) {
      var n = document.createElement("p");
      n.className = "muted small";
      n.textContent = "Only skills you have no ranks in are listed.";
      body.appendChild(n);
    }
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
        region: C.region || null, upbringing: C.upbringing || null,
        // rōnin / peasant / gaijin — what set the base status
        origin_type: isCore() ? null : originType().key
      },
      mode: mode(),
      portrait: null,
      concept: a.first_impression || null,
      summary: null,
      // C.concept is deliberately absent: it informs the making of the
      // character and is not part of the finished one.
      notes: C.notes || "",
      /* The wizard's own state, so this file describes the character rather
         than only its results.

         Everything below `tiers` is derived: rings and skills are what the
         clan, the family, the school and twenty answers add up to. Which is
         fine until somebody wants to change one — hydrate() could read the
         answers back but not the choices behind the numbers, so re-exporting a
         character dropped every resolved "+1 Earth or Fire", every "three of
         these six skills", every chosen kata, and the ranks that questions 7,
         8, 13 and 17 hand out. Shosuro Hisano came back with Water 1 for Water
         2 and three techniques for four, and nothing said so.

         So the state travels with the record. `concept` is left out: it is
         authoring material and promotion is where it stops being part of this. */
      wizard: (function () {
        var w = {}, k;
        for (k in C) if (C.hasOwnProperty(k) && k !== "concept" &&
                         k !== "advance" && k !== "legacy" &&
                         k.charAt(0) !== "_") w[k] = C[k];
        return w;
      })(),
      twenty_questions: {
        template: isCore() ? "core" : "pow", generated: false,
        steps: {
          step4: { answers: { stand_out: a.standout_quality, ring: C.standout_ring }, picks: {} },
          // The lord's name is asked for at question 5 and is the one named
          // person in a giri, so it is worth keeping as a field rather than
          // only inside the prose. Foundry has no key for it either.
          step5: { answers: { social_giri: a.giri, lord_name: a.lord_name }, picks: {} },
          step6: { answers: { social_ninjo: a.ninjo }, picks: {} },
          step7: { answers: { clan_relations: a.clan_relationship.text }, picks: {} },
          step8: { answers: { tenet_paramount: C.bushido.paramount,
                              tenet_less_significant: C.bushido.lesser }, picks: {} },
          // Questions 9 to 12 each ask for a narrative answer beside their
          // mechanical pick. hydrate() reads all four on the way in — its
          // comment records that they were once dropped on the floor — but the
          // export never wrote them, so every character made here left the
          // Creator without its greatest accomplishment, its greatest
          // challenge, what calms it or what it fears. The keys match the ones
          // hydrate() looks for, so a character now round-trips.
          step9: { answers: { success: a.accomplishment }, picks: {} },
          step10: { answers: { difficulty: a.challenge }, picks: {} },
          step11: { answers: { calms: a.peace }, picks: {} },
          step12: { answers: { worries: a.fear }, picks: {} },
          step13: { answers: { most_learn: a.mentor.name + (a.mentor.text ? " — " + a.mentor.text : "") }, picks: {} },
          // Question 14 asks two things: what people notice, and one
          // distinctive accoutrement carried or worn most of the time. Foundry
          // records only the first — its step14 has a single `first_sight` key
          // — so the accoutrement had nowhere to go and was written by every
          // player and exported by nobody. It rides alongside; an extra key is
          // harmless to Foundry and hydrate() reads it back.
          step14: { answers: { first_sight: a.first_impression,
                               accoutrement: a.accoutrement }, picks: {} },
          step15: { answers: { stress: a.stress_reaction }, picks: {} },
          step16: { answers: { relations: a.relationships }, picks: {} },
          step17: { answers: { parents_pov: a.parent_opinion.description }, picks: {} },
          step18: { answers: {
            // which door out of question 18 was taken
            legacy: a.legacy || null,
            legacy_inverted: !!a.legacy_inverted,
            // A Legacy means no heritage result applies, so the record must
            // not name a table either — it was never consulted, and a
            // consumer reading one would think it had been.
            heritage_name: hasLegacy() ? null : a.heritage,
            heritage_table: hasLegacy() ? null
              : ((HERITAGES[a.heritage_table] || {}).name || a.heritage_table),
            heritage_sub: hasLegacy() ? null : a.heritage_sub
          }, picks: heritagePicks() },
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
        // the coins as the source states them, not a koku fraction: a
        // character with 10 zeni used to export koku 0.2
        money: { zeni: d.coins.zeni, koku: d.coins.koku, bu: d.coins.bu },
        // Both halves: the techniques the school simply grants, and the ones the
        // player chose from its lists. Only the fixed ones used to be exported,
        // so every chosen kata, ritual and shūji was dropped on the way out.
        // The same list the side panel shows: what the school grants, what the
        // player chose from its lists, and the one a heritage teaches from
        // outside it.
        techniques: refs(wipTechniques()),
        peculiarities: peculiarityRefs(),
        titles: [], bonds: [], signature_scrolls: [],
        gear: refs(C.starting_item ? [C.starting_item] : []).concat(
          heritageGrants().gear.filter(function (g) {
            return g.name;
          }).map(function (g) {
            // custom where there is nothing in the compendium to resolve
            // against — an heirloom still to be settled, a horse, an estate —
            // and the note carries what the rules said about it
            var o = { name: g.name };
            if (g.custom) o.custom = true;
            if (g.note) o.text = g.note;
            if (!g.held) { o.custom = true; o.held = false; }
            return o;
          })),
        advancements: []
      }]
    };
  }

  /* ===================================================== advancement ledger

     An advance is the third thing a draft can be. A character in play spends
     experience between sessions — a rank of a skill, a ring, a technique, a
     rank of a bond — and their school's curriculum decides how much of that
     spending counts toward their next school rank. A title runs in parallel:
     assigned by narrative events, advanced with the same purchases, completed
     at a stated total.

     None of that is the Game of Twenty Questions, so an advance draft renders
     its own screen instead of the wizard's, and when it lands it appends a new
     tier to the record rather than merging into the one it started from.

     Every number here is the corpus's, and nothing is rounded in the
     character's favour:

       ring        3 XP x the value bought; never above the lowest ring plus
                   the Void Ring, and never above 5
       skill       2 XP x the rank bought; never above 5
       technique   3 XP; of a category the school allows, or listed in the
                   curriculum, and of a rank no higher than the school rank
       passion     3 XP, at the GM's discretion, and never a fourth
       bond        3, 4, 6, 8, 10 XP for its five ranks, and counts toward
                   neither the school rank nor a title
       rank        20, 24, 32, 44, 60 curriculum XP, reset on each advance
       curriculum  a listed purchase contributes its whole cost, anything else
                   half rounded up — and rings are never listed anywhere */

  var CURRICULA = window.L5R_CURRICULA || {};
  var TITLES = window.L5R_TITLES || {};
  var PATTERNS = window.L5R_PATTERNS || {};
  var RANK_THRESHOLD = { 1: 20, 2: 24, 3: 32, 4: 44, 5: 60 };
  var BOND_COST = [3, 4, 6, 8, 10];
  var BUYABLE = [
    ["skill", "Skill rank"], ["ring", "Ring"], ["technique", "Technique"],
    ["passion", "Passion"], ["pattern", "Item pattern"],
    ["bond", "Bond rank"]
  ];

  function activeAdvance() { return (C && C.advance) || null; }
  function isAdvance() { return activeDraft().kind === "advance"; }

  function newAdvance(a) {
    return { slug: a.slug, from: a.top, xp: 0, ledger: [], title: null,
             label: "" };
  }

  // The school's curriculum at a rank. Reported rather than assumed away: a
  // school the corpus has no curriculum for cannot tell in from out, and the
  // ledger says so instead of calling everything out of curriculum.
  function curriculumFor(school) {
    var bare = String(school || "").replace(/\s+School$/i, "");
    return CURRICULA[normName(bare)] || CURRICULA[normName(school)] || null;
  }

  function curriculumAt(school, rank) {
    var c = curriculumFor(school);
    return ((c && c.ranks) || {})[String(rank)] || [];
  }

  var SKILL_GROUP_LABEL = { artisan: "Artisan Skills", martial: "Martial Skills",
                            scholar: "Scholar Skills", social: "Social Skills",
                            trade: "Trade Skills" };

  function groupOfSkill(sk) {
    var out = null;
    Object.keys(SKILL_GROUPS).forEach(function (g) {
      if (SKILL_GROUPS[g].indexOf(sk) >= 0) out = g;
    });
    return out;
  }

  // "Rank 1-2 Kata", "Rank 1 Earth Invocations" — the ranks it spans, the
  // category it names, and the ring it is restricted to, if any.
  function techGroupSpec(label) {
    var m = /rank\s*(\d)\s*(?:[-–—]\s*(\d))?/i.exec(label || "");
    var lo = m ? Number(m[1]) : 1;
    var hi = m && m[2] ? Number(m[2]) : lo;
    var ring = null;
    RING_NAMES.forEach(function (r) {
      if (new RegExp("\\b" + r + "\\b", "i").test(label || "")) ring = r.toLowerCase();
    });
    return { lo: lo, hi: hi, kind: techKindOfLabel(label), ring: ring };
  }

  function techKindOfLabel(label) {
    var l = normName(label);
    var found = null;
    ["kata", "shuji", "ritual", "invocation", "kiho", "maho", "ninjutsu",
     "mantra", "inversion"].forEach(function (k) {
      if (l.indexOf(k) >= 0) found = k;
    });
    return found;
  }

  function catalogTechnique(name) {
    return CATALOG.filter(function (e) {
      return e.sub_type === "technique" && normName(e.name) === normName(name);
    })[0] || null;
  }

  /* Whether a purchase appears on the curriculum for the rank being completed.
     A skill is listed by its own name or by its group; a technique by its name
     or by a group covering its category and rank. */
  function listedIn(entries, e, st) {
    if (!entries.length) return false;
    if (e.kind === "skill") {
      var label = SKILL_LABEL[e.target] || e.target;
      var grp = SKILL_GROUP_LABEL[groupOfSkill(e.target)];
      return entries.some(function (x) {
        if (x.kind === "Skill") return normName(x.label) === normName(label);
        if (x.kind === "Skill Group") return grp && normName(x.label) === normName(grp);
        return false;
      });
    }
    if (e.kind === "technique") {
      var t = catalogTechnique(e.target);
      return entries.some(function (x) {
        if (x.kind === "Technique") return normName(x.label) === normName(e.target);
        if (x.kind !== "Tech. Grp.") return false;
        var spec = techGroupSpec(x.label);
        var kind = x.group || spec.kind;
        return t && kind && String(t.kind || "").toLowerCase() === kind &&
          t.rank >= spec.lo && t.rank <= spec.hi &&
          (!spec.ring || String(t.ring || "").toLowerCase() === spec.ring);
      });
    }
    return false;      // rings, passions and bonds appear on no curriculum
  }

  function flatten(skills) {
    var out = {};
    Object.keys(skills || {}).forEach(function (g) {
      if (typeof skills[g] === "object") {
        Object.keys(skills[g]).forEach(function (s) { out[s] = skills[g][s]; });
      } else {
        out[g] = skills[g];
      }
    });
    return out;
  }

  function ceilHalf(n) { return Math.ceil(n / 2); }

  // A ring cannot be raised past the lowest ring plus the Void Ring, to a
  // maximum of 5 — measured before the purchase, as the table states it.
  function ringCeiling(rings) {
    var lowest = RING_NAMES.map(function (r) {
      return rings[r.toLowerCase()] || 0;
    }).reduce(function (a, b) { return Math.min(a, b); }, 99);
    return Math.min(5, lowest + (rings["void"] || 0));
  }

  /* Where a purchase belongs.

     Experience is not spent into a pool — every advancement is filed against
     one thing, and that filing is what decides which curriculum it is measured
     against and whether it counts in full or at half. The corpus is explicit
     that the three are separate ledgers: XP allocated to a title does not
     count toward the school rank and vice versa, and XP spent on a bond counts
     toward neither.

     So a bucket is the school, one held title, or one bond, and every row in
     the ledger names the one it belongs to. */
  function advBuckets() {
    var a = activeAdvance();
    var st = { school: null, titles: [], bonds: [] };
    if (!a) return st;
    var from = a.from || {};
    // The label carries no rank: the rank moves as the ledger is applied, so
    // a rank baked in here would be the one they started at.
    st.school = { kind: "school", key: "school",
                  label: from.school || "School", school: from.school };
    (from.titles || []).concat(a.addedTitles || []).forEach(function (t) {
      var rec = TITLES[normName(t.name)] || null;
      st.titles.push({
        kind: "title", key: "title:" + t.name, ref: t.name, label: t.name,
        // what the record already had against it, so a title half finished
        // stays half finished
        was: t.xp_used || 0,
        needs: t.xp_cost || (rec && rec.xp_to_completion) || null,
        curriculum: (rec && rec.curriculum) || [],
        ability: rec && rec.ability,
        award: rec && rec.award,
        assigned_now: !!t.assigned_now,
        known: !!rec
      });
    });
    (from.bonds || []).concat(a.addedBonds || []).forEach(function (b) {
      st.bonds.push({ kind: "bond", key: "bond:" + b.name, ref: b.name,
                      label: b.name, type: b.type || null,
                      rank: b.rank || null, added_now: !!b.added_now });
    });
    return st;
  }

  // The title a purchase defaults to: the one still incomplete, since the
  // corpus allows only one of those at a time.
  function openTitle(buckets, st) {
    return buckets.titles.filter(function (t) {
      var got = t.was + ((st && st.titleXp[t.key]) || 0);
      return t.needs && got < t.needs;
    })[0] || null;
  }

  function bucketByKey(buckets, key) {
    if (!key || key === "school") return buckets.school;
    return buckets.titles.concat(buckets.bonds).filter(function (b) {
      return b.key === key;
    })[0] || null;
  }

  /* The ledger, applied in order. Order matters: a purchase's cost is set by
     the rank it takes the character to, and whether it counts in curriculum is
     set by the bucket it belongs to and the school rank held at the time. */
  function advanceState() {
    var a = activeAdvance();
    if (!a) return null;
    var from = a.from || {};
    var buckets = advBuckets();
    var st = {
      rings: JSON.parse(JSON.stringify(from.rings || {})),
      skills: flatten(from.skills),
      techniques: (from.techniques || []).slice(),
      peculiarities: (from.peculiarities || []).slice(),
      titles: (from.titles || []).map(function (t) { return t.name; }),
      bonds: (from.bonds || []).map(function (b) { return b.name; }),
      scrolls: (from.signature_scrolls || []).slice(),
      gear: (from.gear || []).slice(),
      patterns: [],
      rank: from.rank || 1,
      school: from.school,
      spent: 0, curXp: 0, titleXp: {}, bondXp: {}, rankUps: [], completed: [],
      rows: [], problems: [], buckets: buckets
    };
    (a.addedTitles || []).forEach(function (t) {
      if (st.titles.indexOf(t.name) < 0) st.titles.push(t.name);
    });
    (a.addedBonds || []).forEach(function (b) {
      if (st.bonds.indexOf(b.name) < 0) st.bonds.push(b.name);
    });
    if (!curriculumFor(st.school)) {
      st.problems.push("The corpus has no curriculum for " +
                       (st.school || "this school") + ", so nothing can be " +
                       "told in curriculum from out. Every purchase toward the " +
                       "school rank is counted at half.");
    }
    buckets.titles.forEach(function (t) {
      if (!t.known) {
        st.problems.push("The corpus has no title called “" + t.ref +
                         "”, so its curriculum and completion cost are " +
                         "unknown; purchases filed against it count at half.");
      }
    });

    (a.ledger || []).forEach(function (e, i) {
      // an older draft filed purchases with `allocate`; read it as a bucket
      var key = e.belongs ||
        (e.allocate === "title" ? (openTitle(buckets, st) || {}).key
         : e.allocate === "none" ? null : "school");
      var bucket = key ? bucketByKey(buckets, key) : null;
      var row = { i: i, kind: e.kind, target: e.target, to: e.to,
                  belongs: bucket ? bucket.key : null,
                  belongs_label: bucket ? bucket.label : "nothing",
                  at_rank: st.rank, xp: 0, listed: false, contributes: 0,
                  note: null, bad: null };
      var entries = bucket && bucket.kind === "school"
        ? curriculumAt(st.school, st.rank)
        : (bucket && bucket.curriculum) || [];

      if (e.kind === "skill") {
        var was = st.skills[e.target] || 0;
        var to = e.to != null ? e.to : was + 1;
        row.to = to;
        row.xp = to * 2;
        if (to > 5) row.bad = "A skill cannot go past rank 5.";
        else if (to !== was + 1) row.bad = "Ranks are bought one at a time: " +
          (SKILL_LABEL[e.target] || e.target) + " is at " + was + ".";
        else st.skills[e.target] = to;
        row.listed = listedIn(entries, e, st);
      } else if (e.kind === "ring") {
        var wasR = st.rings[e.target] || 0;
        var toR = e.to != null ? e.to : wasR + 1;
        var cap = ringCeiling(st.rings);
        row.to = toR;
        row.xp = toR * 3;
        if (toR > cap) row.bad = "The lowest ring plus Void allows " + cap +
          " at most right now.";
        else if (toR !== wasR + 1) row.bad = "Ring values are bought one at a " +
          "time: " + cap0(e.target) + " is at " + wasR + ".";
        else st.rings[e.target] = toR;
        row.note = "no curriculum lists rings";
      } else if (e.kind === "technique") {
        var t = catalogTechnique(e.target);
        row.xp = 3;
        row.listed = listedIn(entries, e, st);
        if (!t) row.bad = "Not a technique in the compendium.";
        else if (st.techniques.some(function (n) {
          return normName(n) === normName(e.target);
        })) row.bad = "Already known.";
        else if (t.rank > st.rank && !row.listed) {
          row.bad = "Rank " + t.rank + " technique, and the character is " +
            "school rank " + st.rank + ".";
        } else if (!techniqueAllowed(t, row.listed)) {
          row.bad = cap0(String(t.kind || "")) + " is not among this school's " +
            "categories, and the technique is not on the curriculum.";
        } else {
          st.techniques.push(t.name);
        }
      } else if (e.kind === "passion") {
        row.xp = 3;
        var held = st.peculiarities.filter(isPassionName).length;
        if (held >= 3) row.bad = "A character can never have more than three " +
          "passions.";
        else if (st.peculiarities.some(function (n) {
          return normName(n) === normName(e.target);
        })) row.bad = "Already held.";
        else st.peculiarities.push(e.target);
        row.note = "at the GM's discretion";
      } else if (e.kind === "pattern") {
        var pat = PATTERNS[normName(e.target)];
        row.xp = pat ? pat.xp_cost : 0;
        if (!pat) row.bad = "Not an item pattern in the corpus.";
        else if (st.patterns.some(function (n) {
          return normName(n) === normName(e.target);
        })) row.bad = "Already bought.";
        else st.patterns.push(pat.name);
        row.note = "no curriculum lists item patterns";
      } else if (e.kind === "bond") {
        var rank = e.to || 1;
        row.to = rank;
        row.xp = BOND_COST[rank - 1] || 0;
        if (rank < 1 || rank > 5) row.bad = "A bond has five ranks.";
        row.note = "counts toward neither a school rank nor a title";
        if (!bucket || bucket.kind !== "bond") {
          row.belongs = "bond:" + e.target;
          row.belongs_label = e.target;
        }
      }

      if (row.bad) { st.rows.push(row); return; }
      st.spent += row.xp;

      if (e.kind === "bond" || (bucket && bucket.kind === "bond")) {
        // the corpus: experience spent on a bond contributes to neither the
        // school curriculum rank nor a title
        st.bondXp[row.belongs] = (st.bondXp[row.belongs] || 0) + row.xp;
        row.contributes = 0;
        st.rows.push(row);
        return;
      }
      if (!bucket) { st.rows.push(row); return; }

      row.contributes = row.listed ? row.xp : ceilHalf(row.xp);
      if (bucket.kind === "title") {
        st.titleXp[bucket.key] = (st.titleXp[bucket.key] || 0) + row.contributes;
        var got = bucket.was + st.titleXp[bucket.key];
        if (bucket.needs && got >= bucket.needs &&
            st.completed.indexOf(bucket.ref) < 0) {
          st.completed.push(bucket.ref);
          if (bucket.ability) {
            var scroll = bucket.ability + " (" + bucket.ref + ")";
            if (st.scrolls.indexOf(scroll) < 0) st.scrolls.push(scroll);
          }
        }
      } else {
        st.curXp += row.contributes;
        var need = RANK_THRESHOLD[st.rank];
        while (need && st.curXp >= need && st.rank < 6) {
          st.rankUps.push({ to: st.rank + 1, after: i });
          st.rank += 1;
          st.curXp = 0;          // the corpus: the total resets on advancing
          need = RANK_THRESHOLD[st.rank];
        }
      }
      st.rows.push(row);
    });

    st.threshold = RANK_THRESHOLD[st.rank] || null;
    st.remaining = (a.xp || 0) - st.spent;
    st.openTitle = openTitle(buckets, st);
    return st;
  }

  function cap0(s) { return cap(String(s || "")); }

  function isPassionName(name) {
    var e = CATALOG.filter(function (x) {
      return x.sub_type === "peculiarity" && normName(x.name) === normName(name);
    })[0];
    return !!e && e.kind === "passion";
  }

  // "Category must be listed among available techniques, or the technique must
  // appear on your curriculum."
  function techniqueAllowed(t, listed) {
    if (listed) return true;
    var sch = schoolByRollName((activeAdvance() || {}).from &&
                               activeAdvance().from.school);
    var avail = (sch && sch.techniques_available) || [];
    return avail.some(function (a) {
      return techKindOfLabel(a) === String(t.kind || "").toLowerCase();
    });
  }

  /* ------------------------------------------------- the advance screen */

  function advSave() { save(); }

  function addLedger(e) {
    var a = activeAdvance();
    if (!a) return;
    // A new purchase is filed where the last one was, which is almost always
    // right and always visible.
    if (!e.belongs) e.belongs = a.lastBelongs || "school";
    a.ledger = (a.ledger || []).concat([e]);
    a.lastBelongs = e.belongs;
    advSave(); render();
  }

  function dropLedger(i) {
    var a = activeAdvance();
    a.ledger = a.ledger.filter(function (_, k) { return k !== i; });
    advSave(); render();
  }

  function setBelongs(i, key) {
    var a = activeAdvance();
    a.ledger[i].belongs = key;
    a.lastBelongs = key;
    advSave(); render();
  }

  function advXpRow(body) {
    var a = activeAdvance();
    var st = advanceState();
    var wrap = document.createElement("div");
    wrap.className = "adv-xp";
    wrap.innerHTML =
      '<label class="adv-xp-in">Experience to spend' +
      '<input type="number" min="0" max="999" value="' + (a.xp || 0) + '"></label>' +
      '<span class="adv-tot' + (st.remaining < 0 ? " over" : "") + '">' +
      st.spent + " spent · " + st.remaining + " left</span>" +
      '<span class="adv-tot">new tier ' + ((a.from.xp || 0) + st.spent) +
      " XP</span>";
    wrap.querySelector("input").addEventListener("change", function (e) {
      a.xp = Math.max(0, Number(e.target.value) || 0);
      advSave(); render();
    });
    body.appendChild(wrap);
  }

  // One curriculum, as a row of what it lists.
  function curriculumChips(entries) {
    if (!entries.length) return '<span class="muted small">nothing listed</span>';
    return entries.map(function (e) {
      return '<span class="cur-chip" title="' + esc(e.kind) + '">' +
        esc(e.label) + "</span>";
    }).join("");
  }

  /* Where this character stands: the school rank and its curriculum, each
     title with its own curriculum and how far along it is, and any bonds.
     These are the three ledgers a purchase can be filed against, so they are
     shown before anything is bought rather than after. */
  function advTracks(body) {
    var st = advanceState();
    var a = activeAdvance();
    var b = st.buckets;

    var wrap = document.createElement("div");
    wrap.className = "adv-tracks";

    var cur = curriculumAt(st.school, st.rank);
    wrap.innerHTML +=
      '<div class="track school"><div class="tr-head">' +
        '<span class="tr-name">' + esc(st.school || "School") + "</span>" +
        '<span class="tr-prog">rank ' + st.rank +
          (st.threshold ? " · " + st.curXp + " / " + st.threshold + " toward rank " +
            (st.rank + 1) : " · mastery") + "</span></div>" +
        '<div class="tr-cur">' + curriculumChips(cur) + "</div></div>";

    b.titles.forEach(function (t) {
      var got = t.was + (st.titleXp[t.key] || 0);
      var done = t.needs && got >= t.needs;
      wrap.innerHTML +=
        '<div class="track title' + (done ? " done" : "") + '">' +
        '<div class="tr-head"><span class="tr-name">' + esc(t.ref) +
          (t.assigned_now ? ' <span class="tr-new">assigned now</span>' : "") +
          "</span>" +
        '<span class="tr-prog">' + got + " / " + (t.needs || "?") +
          (done ? " · complete" : "") + "</span></div>" +
        (t.ability
          ? '<div class="tr-note">Ability: ' + esc(t.ability) +
            (t.award ? " · " + esc(t.award) : "") + "</div>"
          : "") +
        '<div class="tr-cur">' + curriculumChips(t.curriculum) + "</div></div>";
    });

    b.bonds.forEach(function (bo) {
      var spent = st.bondXp[bo.key] || 0;
      wrap.innerHTML +=
        '<div class="track bond"><div class="tr-head">' +
        '<span class="tr-name">' + esc(bo.label) +
          (bo.type ? ' <span class="tr-new">' + esc(bo.type) + "</span>" : "") +
          "</span>" +
        '<span class="tr-prog">' + (spent ? spent + " XP this advance" : "held") +
        "</span></div>" +
        '<div class="tr-note">Counts toward neither a school rank nor a title.' +
        "</div></div>";
    });
    body.appendChild(wrap);

    st.problems.forEach(function (p) { needs(body, p); });
    if (st.rankUps.length) {
      var up = document.createElement("p");
      up.className = "adv-rankup";
      up.textContent = st.rankUps.map(function (r) {
        return "Reaches school rank " + r.to;
      }).join("; ") + ".";
      body.appendChild(up);
    }
    if (st.completed.length) {
      var c = document.createElement("p");
      c.className = "adv-rankup";
      c.textContent = "Completes " + st.completed.join(", ") +
        ", gaining its title ability.";
      body.appendChild(c);
    }
  }

  /* Taking on a title, or forming a bond. A title is assigned by narrative
     events rather than bought, and the corpus allows only one incomplete title
     at a time — so this offers one only when none is outstanding, and says so
     when one is. */
  function advAddTrack(body) {
    var a = activeAdvance();
    var st = advanceState();
    a.adding_track = a.adding_track || null;

    label(body, "Take on a title, or form a bond");
    var row = document.createElement("div");
    row.className = "choicerow";
    var openT = st.openTitle;
    row.innerHTML =
      '<button type="button" class="choice' +
        (a.adding_track === "title" ? " active" : "") +
        (openT ? " disabled" : "") + '" data-v="title"' +
        (openT ? ' disabled title="' + esc(openT.ref) + ' is still ' +
          'incomplete, and a character can only have one incomplete title at ' +
          'a time"' : "") + ">Assign a title</button>" +
      '<button type="button" class="choice' +
        (a.adding_track === "bond" ? " active" : "") +
        '" data-v="bond">Form a bond</button>';
    Array.prototype.forEach.call(row.querySelectorAll(".choice"), function (btn) {
      if (btn.disabled) return;
      btn.addEventListener("click", function () {
        var v = btn.getAttribute("data-v");
        a.adding_track = a.adding_track === v ? null : v;
        advSave(); render();
      });
    });
    body.appendChild(row);
    if (openT) {
      needs(body, openT.ref + " is at " +
            (openT.was + (st.titleXp[openT.key] || 0)) + " of " +
            (openT.needs || "?") + " XP. A character can only have one " +
            "incomplete title at a time, so finish it before taking another.");
    }

    if (a.adding_track === "title") {
      var held = st.titles.map(normName);
      var items = Object.keys(TITLES).filter(function (k) {
        return held.indexOf(normName(TITLES[k].name)) < 0;
      }).sort(function (x, y) {
        return TITLES[x].name.localeCompare(TITLES[y].name);
      }).map(function (k) {
        var t = TITLES[k];
        return { value: t.name, label: t.name,
                 meta: [t.xp_to_completion ? t.xp_to_completion + " XP" : "cost unknown",
                        t.award, t.ability].filter(Boolean).join(" · ") };
      });
      needs(body, "A title is assigned by what happens in play, not bought. " +
            "Assigning it here opens its curriculum as somewhere to file " +
            "purchases, and applies its award.");
      pickList(body, items, null, function (n) {
        a.addedTitles = (a.addedTitles || []).concat(
          [{ name: n, xp_used: 0, assigned_now: true }]);
        a.adding_track = null;
        a.lastBelongs = "title:" + n;
        advSave(); render();
      }, { tip: ruleTextFor });
    } else if (a.adding_track === "bond") {
      var bonds = CATALOG.filter(function (e) { return e.sub_type === "bond"; })
        .map(function (e) { return e.name; }).sort();
      a.bondDraft = a.bondDraft || { type: bonds[0] || "", who: "" };
      var bd = a.bondDraft;
      label(body, "Kind of bond");
      choice(body, bonds.map(function (x) { return [x, x]; }), bd.type,
        function (v) { bd.type = v; advSave(); render(); });
      label(body, "With whom");
      var who = document.createElement("input");
      who.type = "text"; who.className = "textline";
      who.placeholder = "Name the person";
      who.value = bd.who || "";
      who.addEventListener("change", function () {
        bd.who = who.value.trim(); advSave();
      });
      body.appendChild(who);
      var add = document.createElement("button");
      add.type = "button"; add.className = "btn";
      add.textContent = "Form this bond";
      add.addEventListener("click", function () {
        if (!bd.who) return;
        a.addedBonds = (a.addedBonds || []).concat(
          [{ name: bd.who, type: bd.type, added_now: true }]);
        a.adding_track = null;
        a.lastBelongs = "bond:" + bd.who;
        // rank 1 is the bond, so it is bought with it
        addLedger({ kind: "bond", target: bd.who, bondType: bd.type, to: 1,
                    belongs: "bond:" + bd.who });
      });
      body.appendChild(add);
      needs(body, "Rank 1 costs 3 XP and is what forms the bond; further " +
            "ranks cost 4, 6, 8 and 10.");
    }
  }

  function advAdd(body) {
    var a = activeAdvance();
    var st = advanceState();
    a.adding = a.adding || "skill";
    label(body, "Buy an advancement");
    choice(body, BUYABLE, a.adding, function (v) {
      a.adding = v; advSave(); render();
    });

    // Which ledger the next purchase is filed against.
    var b = st.buckets;
    var opts = [["school", (st.school || "School") + " · rank " + st.rank]]
      .concat(b.titles.map(function (t) { return [t.key, t.ref]; }))
      .concat(b.bonds.map(function (x) { return [x.key, x.label]; }));
    if (opts.length > 1) {
      label(body, "File it against");
      choice(body, opts, a.lastBelongs || "school", function (v) {
        a.lastBelongs = v; advSave(); render();
      });
    }
    var against = bucketByKey(b, a.lastBelongs || "school");
    var entries = against && against.kind === "school"
      ? curriculumAt(st.school, st.rank)
      : (against && against.curriculum) || [];

    var kind = a.adding;
    var wrap = document.createElement("div");
    wrap.className = "adv-add";
    body.appendChild(wrap);

    if (kind === "skill") {
      var items = Object.keys(SKILL_LABEL).sort(function (x, y) {
        return SKILL_LABEL[x].localeCompare(SKILL_LABEL[y]);
      }).map(function (sk) {
        var at = st.skills[sk] || 0;
        var listed = listedIn(entries, { kind: "skill", target: sk }, st);
        return { value: sk, label: SKILL_LABEL[sk],
                 meta: (at >= 5 ? "at 5, the maximum"
                                : "rank " + at + " → " + (at + 1) + " · " +
                                  ((at + 1) * 2) + " XP") +
                       (listed ? " · in curriculum" : "") };
      });
      pickList(wrap, items, null, function (sk) {
        if ((st.skills[sk] || 0) >= 5) return;
        addLedger({ kind: "skill", target: sk, to: (st.skills[sk] || 0) + 1 });
      });
    } else if (kind === "ring") {
      var cap = ringCeiling(st.rings);
      choice(wrap, RING_NAMES.map(function (r) {
        var k = r.toLowerCase();
        var at = st.rings[k] || 0;
        return [k, r + " " + at + (at + 1 <= cap ? " → " + (at + 1) +
                " (" + ((at + 1) * 3) + " XP)" : " · capped")];
      }), null, function (k) {
        if ((st.rings[k] || 0) + 1 > cap) return;
        addLedger({ kind: "ring", target: k, to: (st.rings[k] || 0) + 1 });
      });
      needs(wrap, "The lowest ring plus the Void Ring allows " + cap +
                  " at most right now, and 5 is the ceiling in any case. No " +
                  "curriculum lists rings, so a ring always counts at half.");
    } else if (kind === "technique") {
      var pool = CATALOG.filter(function (e) {
        if (e.sub_type !== "technique") return false;
        if (["school_ability", "mastery_ability", "title_ability"]
            .indexOf(String(e.kind || "")) >= 0) return false;
        if (st.techniques.some(function (n) {
          return normName(n) === normName(e.name);
        })) return false;
        var listed = listedIn(entries, { kind: "technique", target: e.name }, st);
        return (e.rank <= st.rank || listed) && techniqueAllowed(e, listed);
      });
      var titems = pool.map(function (e) {
        var listed = listedIn(entries, { kind: "technique", target: e.name }, st);
        return { value: e.name, label: e.name,
                 meta: [cap0(e.kind), "rank " + e.rank,
                        e.ring ? cap0(e.ring) : null, "3 XP",
                        listed ? "in curriculum" : null]
                   .filter(Boolean).join(" · ") };
      });
      needs(wrap, titems.length + " available: rank " + st.rank + " or lower, " +
            "in a category " + (st.school || "the school") + " teaches, or on " +
            "the curriculum it is filed against.");
      pickList(wrap, titems, null, function (n) {
        addLedger({ kind: "technique", target: n });
      });
    } else if (kind === "passion") {
      var pitems = CATALOG.filter(function (e) {
        return e.sub_type === "peculiarity" && e.kind === "passion" &&
          !st.peculiarities.some(function (n) {
            return normName(n) === normName(e.name);
          });
      }).map(function (e) {
        return { value: e.name, label: e.name, meta: "3 XP" };
      }).sort(function (x, y) { return x.label.localeCompare(y.label); });
      needs(wrap, "At the GM's discretion, and never a fourth — this character " +
            "holds " + st.peculiarities.filter(isPassionName).length + ".");
      pickList(wrap, pitems, null, function (n) {
        addLedger({ kind: "passion", target: n });
      });
    } else if (kind === "pattern") {
      var pitems2 = Object.keys(PATTERNS).map(function (k) {
        return PATTERNS[k];
      }).filter(function (p) {
        return !st.patterns.some(function (n) {
          return normName(n) === normName(p.name);
        });
      }).sort(function (x, y) { return x.name.localeCompare(y.name); })
        .map(function (p) {
          return { value: p.name, label: p.name,
                   meta: [p.xp_cost + " XP",
                          p.rarity_modifier ? "rarity " + p.rarity_modifier : null]
                     .filter(Boolean).join(" · "),
                   why: p.effect };
        });
      needs(wrap, pitems2.length + " item patterns, " +
            "3 to 8 XP. A pattern is applied to an item; no curriculum lists " +
            "one, so it counts at half against whatever it is filed under.");
      pickList(wrap, pitems2, null, function (n) {
        addLedger({ kind: "pattern", target: n });
      });
    } else if (kind === "bond") {
      var bnds = st.buckets.bonds;
      if (!bnds.length) {
        return needs(wrap, "No bonds yet — form one above first.");
      }
      label(wrap, "Which bond");
      a.bondRankFor = a.bondRankFor || bnds[0].ref;
      choice(wrap, bnds.map(function (x) { return [x.ref, x.label]; }),
        a.bondRankFor, function (v) { a.bondRankFor = v; advSave(); render(); });
      label(wrap, "Rank being bought");
      choice(wrap, BOND_COST.map(function (c, i) {
        return [String(i + 1), "Rank " + (i + 1) + " · " + c + " XP"];
      }), null, function (v) {
        addLedger({ kind: "bond", target: a.bondRankFor, to: Number(v),
                    belongs: "bond:" + a.bondRankFor });
      });
    }
  }

  function advLedger(body) {
    var st = advanceState();
    if (!st.rows.length) return needs(body, "Nothing bought yet.");
    label(body, "The ledger");
    var opts = [["school", "school"]]
      .concat(st.buckets.titles.map(function (t) { return [t.key, t.ref]; }))
      .concat(st.buckets.bonds.map(function (x) { return [x.key, x.label]; }));
    var list = document.createElement("div");
    list.className = "adv-ledger";
    list.innerHTML = st.rows.map(function (r) {
      var name = r.kind === "skill" ? (SKILL_LABEL[r.target] || r.target)
               : r.kind === "ring" ? cap0(r.target)
               : r.target;
      var to = r.to != null ? " → " + r.to : "";
      var where = r.bad ? esc(r.bad)
        : r.kind === "bond"
          ? esc(r.note)
          : (r.listed ? "in curriculum" : "out of curriculum") + " · " +
            r.contributes + " toward " + esc(r.belongs_label);
      return '<div class="adv-row' + (r.bad ? " bad" : "") + '">' +
        '<span class="ar-k">' + esc(r.kind) + "</span>" +
        '<span class="ar-n">' + esc(name + to) + "</span>" +
        '<span class="ar-x">' + r.xp + " XP</span>" +
        '<span class="ar-a">' + where + "</span>" +
        (r.bad || r.kind === "bond"
          ? '<span class="ar-alloc"></span>'
          : '<span class="ar-alloc">' + opts.map(function (o) {
              return '<button type="button" class="choice' +
                (r.belongs === o[0] ? " active" : "") + '" data-b="' +
                esc(o[0]) + '" data-i="' + r.i + '">' + esc(o[1]) +
                "</button>";
            }).join("") + "</span>") +
        '<button type="button" class="ar-x-btn" data-drop="' + r.i +
        '" title="Remove">×</button></div>';
    }).join("");
    Array.prototype.forEach.call(list.querySelectorAll("[data-drop]"), function (b) {
      b.addEventListener("click", function () {
        dropLedger(Number(b.getAttribute("data-drop")));
      });
    });
    Array.prototype.forEach.call(list.querySelectorAll("[data-b]"), function (b) {
      b.addEventListener("click", function () {
        setBelongs(Number(b.getAttribute("data-i")), b.getAttribute("data-b"));
      });
    });
    body.appendChild(list);
  }

  function renderAdvance(body) {
    var a = activeAdvance();
    if (!a) return needs(body, "This draft has no advance on it.");
    advXpRow(body);
    advTracks(body);
    advAddTrack(body);
    advAdd(body);
    advLedger(body);
  }

  /* What an advance hands to scripts/apply_advance.py: the tier it started
     from, the ledger, and the tier it comes to. The applier recomputes the
     result from the ledger rather than trusting the tier, so the two have to
     agree — which is the check that the ledger says what the numbers show. */
  // The patch for a character that is not the one open in the wizard, the way
  // sourceFor() does it for an edit.
  function advancePatchFor(ch) {
    var saved = C, out = null;
    C = ch;
    try { out = ch && ch.advance ? toAdvancePatch() : null; }
    catch (e) { out = null; }
    finally { C = saved; }
    return out;
  }

  function toAdvancePatch() {
    var a = activeAdvance();
    var st = advanceState();
    var skills = {};
    Object.keys(SKILL_GROUPS).forEach(function (g) {
      skills[g] = {};
      SKILL_GROUPS[g].forEach(function (s) { skills[g][s] = st.skills[s] || 0; });
    });
    function refs(names) {
      return (names || []).map(function (n) { return { name: n }; });
    }
    var money = a.from.money || { zeni: 0, koku: 0, bu: 0 };
    return {
      advance: a.slug,
      from_xp: a.from.xp || 0,
      xp_available: a.xp || 0,
      ledger: (a.ledger || []).map(function (e, i) {
        var r = st.rows[i] || {};
        return { kind: e.kind, target: e.target, to: r.to,
                 bond_type: e.bondType || null,
                 // which ledger it is filed against, and what that was
                 belongs: r.belongs, belongs_label: r.belongs_label,
                 xp: r.xp, listed: !!r.listed,
                 contributes: r.contributes, at_rank: r.at_rank };
      }),
      titles_assigned: (a.addedTitles || []).map(function (t) { return t.name; }),
      bonds_formed: (a.addedBonds || []).map(function (b) {
        return { name: b.name, type: b.type };
      }),
      title_xp: st.titleXp,
      bond_xp: st.bondXp,
      titles_completed: st.completed,
      tier: {
        xp: (a.from.xp || 0) + st.spent,
        label: a.label || null,
        rank: st.rank,
        school: a.from.school,
        foundry_id: null,
        rings: st.rings,
        skills: skills,
        social: a.from.social,
        derived: {
          endurance: (st.rings.earth + st.rings.fire) * 2,
          composure: (st.rings.earth + st.rings.water) * 2,
          focus: st.rings.air + st.rings.fire,
          vigilance: Math.ceil((st.rings.air + st.rings.water) / 2),
          void_points: st.rings["void"]
        },
        money: money,
        techniques: refs(st.techniques),
        peculiarities: refs(st.peculiarities),
        titles: st.titles.map(function (n) {
          var b = st.buckets.titles.filter(function (t) {
            return t.ref === n;
          })[0];
          var o = { name: n };
          if (b) {
            o.xp_used = b.was + (st.titleXp[b.key] || 0);
            if (b.needs) o.xp_cost = b.needs;
            o.bought_at_rank = st.rank;
          }
          return o;
        }),
        bonds: st.bonds.map(function (n) {
          var b = st.buckets.bonds.filter(function (x) {
            return x.ref === n;
          })[0];
          var o = { name: n, custom: true };
          if (b && b.type) o.text = b.type + " bond";
          if (b && st.bondXp[b.key]) o.xp_used = st.bondXp[b.key];
          return o;
        }),
        // patterns bought this advance ride with the gear they modify; the
        // corpus states each one's effect and rarity modifier
        gear_patterns: st.patterns.slice(),
        signature_scrolls: refs(st.scrolls),
        gear: refs(st.gear),
        advancements: st.rows.filter(function (r) { return !r.bad; })
          .map(function (r) {
            var name = r.kind === "skill" ? (SKILL_LABEL[r.target] || r.target)
                     : r.kind === "ring" ? cap0(r.target) : r.target;
            return { label: name + (r.to != null ? " +1 (→ " + r.to + ")" : ""),
                     type: r.kind, at_rank: r.at_rank, xp: r.xp,
                     // what it was filed against, so the tier records which
                     // ledger each purchase counted toward
                     via: r.belongs_label, belongs: r.belongs,
                     in_curriculum: !!r.listed };
          })
      }
    };
  }

  function renderAdvanceSave(body) {
    var a = activeAdvance();
    var st = advanceState();
    var doc = toAdvancePatch();
    var bad = st.rows.filter(function (r) { return r.bad; });

    var head = document.createElement("p");
    head.className = "muted small";
    head.innerHTML = "Advancing <strong>" + esc(a.slug) + "</strong> from " +
      (a.from.xp || 0) + " XP to " + doc.tier.xp + " XP" +
      (st.rank !== (a.from.rank || 1)
        ? ", school rank " + (a.from.rank || 1) + " to " + st.rank : "") + "." +
      (doc.titles_assigned.length
        ? " Takes on " + esc(doc.titles_assigned.join(", ")) + "." : "") +
      (doc.titles_completed.length
        ? " Completes " + esc(doc.titles_completed.join(", ")) + "." : "") +
      (doc.bonds_formed.length
        ? " Forms a bond with " +
          esc(doc.bonds_formed.map(function (b) { return b.name; }).join(", ")) +
          "." : "");
    body.appendChild(head);

    label(body, "Label for the new tier");
    var lab = document.createElement("input");
    lab.type = "text"; lab.className = "textline";
    lab.placeholder = st.rank !== (a.from.rank || 1) ? "Rank " + st.rank : "optional";
    lab.value = a.label || "";
    lab.addEventListener("change", function () {
      a.label = lab.value.trim(); advSave();
    });
    body.appendChild(lab);

    if (bad.length) {
      var warn = document.createElement("p");
      warn.className = "export-warn";
      warn.textContent = bad.length + " purchase" + (bad.length === 1 ? "" : "s") +
        " in the ledger cannot be made and are left out of the new tier.";
      body.appendChild(warn);
    }
    if (st.remaining < 0) {
      var over = document.createElement("p");
      over.className = "export-warn";
      over.textContent = "The ledger spends " + (-st.remaining) +
        " XP more than the character has.";
      body.appendChild(over);
    }

    var row = document.createElement("div");
    row.className = "choicerow";
    row.innerHTML = '<button type="button" class="btn" id="dl">Download</button>' +
      '<button type="button" class="btn" id="cp">Copy</button>';
    body.appendChild(row);
    var how = document.createElement("p");
    how.className = "muted small";
    how.innerHTML = "Then: <code>python3 scripts/apply_advance.py " +
      esc(a.slug) + "</code> — it recomputes the tier from the ledger, shows " +
      "it against the record, and writes nothing without <code>--apply</code>.";
    body.appendChild(how);

    var pre = document.createElement("pre");
    pre.className = "export-json";
    pre.textContent = JSON.stringify(doc, null, 1);
    body.appendChild(pre);
    row.querySelector("#dl").addEventListener("click", function () {
      var blob = new Blob([JSON.stringify(doc, null, 1)],
                          { type: "application/json" });
      var n = document.createElement("a");
      n.href = URL.createObjectURL(blob);
      n.download = a.slug + "-advance.json";
      document.body.appendChild(n); n.click(); n.remove();
      setTimeout(function () { URL.revokeObjectURL(n.href); }, 1000);
    });
    row.querySelector("#cp").addEventListener("click", function () {
      navigator.clipboard.writeText(JSON.stringify(doc, null, 1));
    });
  }

  var ADVANCE_STEPS = [
    { id: "advance", n: 0, label: "Ledger",
      title: function () {
        var a = activeAdvance();
        return "Advancing " + ((a && a.from && a.from.label) ||
                               (C && C.name) || "a character");
      },
      desc: "Experience spent between sessions. A purchase counts toward the " +
        "school rank in full if the curriculum for the current rank lists it, " +
        "and at half rounded up if it does not — or toward a title instead, " +
        "on the same terms. Rings are on no curriculum, and bonds count for " +
        "neither.",
      done: function () {
        var st = advanceState();
        return !!st && st.spent > 0 && !st.rows.filter(function (r) {
          return r.bad;
        }).length && st.remaining >= 0;
      },
      render: renderAdvance },
    { id: "advance-save", n: 1, label: "Save", title: "Land the Advance",
      desc: "This appends a new tier to the record. The one it started from " +
        "is left exactly as it is, so the character keeps every version of " +
        "themself the archive already holds.",
      done: function () { return false; },
      render: renderAdvanceSave }
  ];

  /* ------------------------------------ question 18: taking a Legacy instead

     "When a player makes a new character during a campaign using Legacies,
     they may choose to take on the Legacy of their last PC (or another
     character, at the GM's discretion). If they do, the player does not apply
     any results from the Heritage table in Question 18."

     So this is not an extra grant beside a heritage — it is the other door out
     of question 18, and taking it means the heritage tables do not apply at
     all. The corpus states three more things about it: a Legacy is applied at
     the same time as distinctions, it may exceed the normal limit on
     advantages at creation, and the GM may invert it as an adversity.

     One template in the line obliges the successor in turn — Inherited
     Connections requires them to take Ally [Name] or Support of [One Group] as
     one of their own advantages — and that is required here rather than
     printed, so the step cannot be finished while it is unmet. */

  var LEGACY_RECORDS = window.L5R_LEGACY_RECORDS || [];

  function takenLegacy() {
    var slug = C.answers.legacy;
    if (!slug) return null;
    return LEGACY_RECORDS.filter(function (l) {
      return l.legacy === slug;
    })[0] || null;
  }

  function hasLegacy() { return !!takenLegacy(); }

  // A Legacy's obligation on the successor, and whether they have met it.
  function legacyObligation() {
    var l = takenLegacy();
    var spec = l && l.successor;
    if (!spec) return null;
    var held = heldPeculiarities();
    var got = held.filter(function (n) {
      return (spec.any_of || []).some(function (want) {
        return new RegExp("^" + want.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
                          "\\b", "i").test(String(n));
      });
    });
    return { spec: spec, text: l.successor_text, held: got,
             met: got.length >= (spec.n || 1) };
  }

  /* What a taken Legacy puts on the successor's sheet.

     Carried as custom: a Legacy is a new kind of advantage from Legacies of
     War and is not in the compendium, so a bare name would fail the build. Its
     own charge and effects travel with it, because a successor has to play to
     the charge and the record should not depend on the Legacy table still
     saying the same thing. */
  function legacyAdvantage() {
    var l = takenLegacy();
    if (!l) return null;
    var inverted = !!C.answers.legacy_inverted;
    return {
      name: l.name,
      custom: true,
      text: [(inverted ? "Legacy (inverted as an adversity at the GM's " +
                         "discretion)" : "Legacy") +
             ", left by " + l.predecessor_name + ".",
             l.charge ? "Charge. " + l.charge : null,
             l.effects ? "Effects. " + l.effects : null,
             l.successor_text || null].filter(Boolean).join(" ")
    };
  }

  function legacySection(body) {
    var recs = LEGACY_RECORDS;
    if (!recs.length) {
      return needs(body, "No Legacies have been left yet. One is made from a " +
                   "finished character — Promoted characters, then Legacy.");
    }
    label(body, "The Legacy this character takes on");
    pickList(body, recs.map(function (l) {
      return { value: l.legacy, label: l.name,
               meta: ["left by " + l.predecessor_name,
                      l.ring, l.from_template,
                      l.successor ? "obliges the successor" : null]
                 .filter(Boolean).join(" · ") };
    }), C.answers.legacy, function (v) {
      C.answers.legacy = C.answers.legacy === v ? null : v;
      save(); render();
    });

    var l = takenLegacy();
    if (!l) return;

    var card = document.createElement("div");
    card.className = "legacy-detail";
    card.innerHTML =
      '<h4 class="field-label">' + esc(l.name) + " — as the book states it</h4>" +
      (l.requirement
        ? '<p><strong>Requirement on ' + esc(l.predecessor_name) + ".</strong> " +
          esc(l.requirement) + "</p>" : "") +
      (l.charge ? '<p><strong>Charge.</strong> ' + esc(l.charge) + "</p>" : "") +
      (l.effects ? '<p><strong>Effects.</strong> ' + esc(l.effects) + "</p>" : "") +
      (l.recovery_note
        ? '<p><strong>Recovery.</strong> ' + esc(l.recovery_note) + "</p>" : "");
    body.appendChild(card);

    var ob = legacyObligation();
    if (ob) {
      var box = document.createElement("div");
      box.className = "legacy-oblig" + (ob.met ? " met" : "");
      box.innerHTML = "<strong>" + (ob.met ? "Met" : "Required") + ".</strong> " +
        esc(ob.text) +
        (ob.met
          ? " — this character holds " + esc(ob.held.join(", ")) + "."
          : " Take one at question 9; the step is not finished until it is on " +
            "the character.");
      body.appendChild(box);
    }

    // The GM may invert a Legacy as an adversity rather than an advantage.
    var inv = document.createElement("label");
    inv.className = "filtercheck";
    inv.innerHTML = '<input type="checkbox"' +
      (C.answers.legacy_inverted ? " checked" : "") + ">" +
      "<span>Inverted as an adversity, at the GM's discretion</span>";
    inv.querySelector("input").addEventListener("change", function (e) {
      C.answers.legacy_inverted = e.target.checked;
      save(); render();
    });
    body.appendChild(inv);

    needs(body, "Taking this Legacy means no result from a heritage table " +
          "applies. It is assigned at the same time as distinctions and may " +
          "exceed the normal limit on advantages at creation.");
  }

  /* ========================================================== legacies

     A Legacy is Legacies of War's alternative to question 18. When a player
     makes a new character mid-campaign they may take on the Legacy of their
     last PC, and if they do they apply no result from the heritage table. Each
     one carries a Ring, Categories, a Requirement the predecessor must
     satisfy, a Charge that removes or gains strife, and Effects — a narrative
     boon and a reroll.

     So a Legacy is made FROM a finished character, which makes it the fourth
     thing a draft can be. Ten templates are published; the book also gives a
     four-step framework for writing one, and both paths land the same record.

     Six of the ten requirements are arithmetic on the predecessor's own sheet
     and are checked here. The other four turn on what happened in play —
     whether a ninjō went unfulfilled, whether a death earned honor — and are
     put as a question rather than guessed at. */

  var LEGACY = window.L5R_LEGACIES || { templates: {}, framework: [] };

  function activeLegacy() { return (C && C.legacy) || null; }
  function isLegacy() { return activeDraft().kind === "legacy"; }

  function newLegacy(a) {
    return { predecessor: a.slug, predecessor_name: a.name,
             from: a.top, template: null, custom: null, answers: {},
             name: "", notes: "" };
  }

  /* What Inherited Connections counts, in the book's own words: "five or more
     of the following (in any combination): Ally advantages, Support of [One
     Group] advantages, and/or Bonds."

     Three things worth being exact about. Bonds count, and they are a list of
     their own on the tier rather than advantages. Only those two advantage
     families count — an earlier version of this also counted Blackmail on,
     Well Connected and Sworn, which the book does not name, and inventing a
     rule that hands out a Legacy is worse than not checking at all. And the
     match is on the family, because the archive records these with their
     subject filled in ("Support of the Yogo"). */
  var CONNECTION = /^(Ally|Support of)\b/i;

  function connectionCount(top) {
    var adv = (top.peculiarities || []).filter(function (n) {
      return CONNECTION.test(String(n));
    }).length;
    return adv + (top.bonds || []).length;
  }

  /* Whether a predecessor meets a template's requirement.
     -> {state: "met"|"unmet"|"ask", why: "…"} */
  function legacyStatus(t, top) {
    if (!top) return { state: "ask", why: "No record for the predecessor." };
    var test = t.test;
    if (test) {
      var have, label;
      if (test.kind === "social") {
        have = (top.social || {})[test.attr] || 0;
        label = cap(test.attr) + " " + have;
      } else if (test.kind === "skill") {
        have = flatten(top.skills)[test.skill] || 0;
        label = (SKILL_LABEL[test.skill] || test.skill) + " rank " + have;
      } else if (test.kind === "count") {
        have = connectionCount(top);
        label = have + " connection advantage" + (have === 1 ? "" : "s");
      }
      var ok = test.op === ">=" ? have >= test.value : have <= test.value;
      return { state: ok ? "met" : "unmet",
               why: label + " — needs " + test.op + " " + test.value +
                    (t.judgement ? ". " + t.judgement : "") };
    }
    return { state: "ask", why: t.judgement || t.requirement };
  }

  function legacyDone() {
    var l = activeLegacy();
    if (!l) return false;
    if (l.template) return !!has(l.name);
    var c = l.custom || {};
    return !!(has(l.name) && has(c.ring) && has(c.requirement) &&
              has(c.charge) && has(c.effects));
  }

  /* ------------------------------------------------------ the screen */

  function legacyPredecessor(body) {
    var l = activeLegacy();
    var p = document.createElement("p");
    p.className = "muted small";
    p.innerHTML = "The Legacy of <strong>" + esc(l.predecessor_name) +
      "</strong> — " + (l.from.xp || 0) + " XP, honor " +
      ((l.from.social || {}).honor) + ", glory " +
      ((l.from.social || {}).glory) + ", status " +
      ((l.from.social || {}).status) + ". A successor who takes it applies no " +
      "result from the heritage table at question 18.";
    body.appendChild(p);
  }

  function legacyTemplates(body) {
    var l = activeLegacy();
    var keys = Object.keys(LEGACY.templates).sort(function (a, b) {
      return LEGACY.templates[a].name.localeCompare(LEGACY.templates[b].name);
    });
    if (!keys.length) return needs(body, "No Legacy templates loaded.");
    label(body, "Published templates");
    var met = 0;
    var list = document.createElement("div");
    list.className = "legacy-list";
    list.innerHTML = keys.map(function (k) {
      var t = LEGACY.templates[k];
      var st = legacyStatus(t, l.from);
      if (st.state === "met") met++;
      var on = l.template === k;
      return '<button type="button" class="legacy ' + st.state +
        (on ? " active" : "") + '" data-k="' + esc(k) + '">' +
        '<span class="lg-head"><span class="lg-name">' + esc(t.name) + "</span>" +
        '<span class="lg-ring">' + esc(t.ring || "") + "</span>" +
        '<span class="lg-state">' +
          (st.state === "met" ? "qualifies"
            : st.state === "unmet" ? "does not qualify" : "a call for the table") +
        "</span></span>" +
        '<span class="lg-req">' + esc(t.requirement || "") + "</span>" +
        '<span class="lg-why">' + esc(st.why || "") + "</span>" +
        "</button>";
    }).join("");
    Array.prototype.forEach.call(list.querySelectorAll(".legacy"), function (b) {
      b.addEventListener("click", function () {
        var k = b.getAttribute("data-k");
        l.template = l.template === k ? null : k;
        if (l.template) {
          l.custom = null;
          if (!l.name) l.name = LEGACY.templates[k].name;
        }
        save(); render();
      });
    });
    body.appendChild(list);
    var note = document.createElement("p");
    note.className = "muted small";
    note.textContent = met + " of " + keys.length +
      " qualify on this predecessor's record; the rest either do not, or turn " +
      "on what happened in play and are for the table to settle.";
    body.appendChild(note);
  }

  function legacyChosen(body) {
    var l = activeLegacy();
    if (!l.template) return;
    var t = LEGACY.templates[l.template];
    if (!t) return;
    var wrap = document.createElement("div");
    wrap.className = "legacy-detail";
    wrap.innerHTML =
      '<h4 class="field-label">' + esc(t.name) + " — as the book states it</h4>" +
      '<p><strong>Charge.</strong> ' + esc(t.charge || "") + "</p>" +
      '<p><strong>Effects.</strong> ' + esc(t.effects || "") + "</p>" +
      (t.recovery_note
        ? '<p><strong>Recovery.</strong> ' + esc(t.recovery_note) + "</p>" : "");
    body.appendChild(wrap);
  }

  function legacyCustom(body) {
    var l = activeLegacy();
    label(body, "Or write one");
    if (!l.custom && l.template) {
      var start = document.createElement("button");
      start.type = "button";
      start.className = "btn ghost";
      start.textContent = "Write a custom Legacy instead";
      start.addEventListener("click", function () {
        l.template = null;
        l.custom = { ring: null, categories: [], requirement: "", charge: "",
                     effects: "" };
        save(); render();
      });
      body.appendChild(start);
      return;
    }
    if (!l.custom) {
      l.custom = { ring: null, categories: [], requirement: "", charge: "",
                   effects: "" };
    }
    var c = l.custom;

    (LEGACY.framework || []).forEach(function (s, i) {
      var p = document.createElement("p");
      p.className = "legacy-step";
      p.innerHTML = "<span>" + (i + 1) + "</span>" + esc(s);
      body.appendChild(p);
    });

    label(body, "Ring the ability most often uses");
    ringPicker(body, c.ring, function (r) { c.ring = r; save(); render(); });

    [["requirement", "What the predecessor must have been or done"],
     ["charge", "The charge — what removes strife, and what gains it"],
     ["effects", "Effects — a narrative boon, and a reroll"]].forEach(function (f) {
      label(body, f[1]);
      var ta = document.createElement("textarea");
      ta.rows = f[0] === "requirement" ? 2 : 4;
      ta.value = c[f[0]] || "";
      ta.addEventListener("change", function () {
        c[f[0]] = ta.value.trim(); save();
      });
      body.appendChild(ta);
    });
  }

  function renderLegacy(body) {
    var l = activeLegacy();
    if (!l) return needs(body, "This draft has no Legacy on it.");
    legacyPredecessor(body);
    label(body, "What this Legacy is called");
    var nm = document.createElement("input");
    nm.type = "text";
    nm.className = "textline";
    nm.placeholder = "Its name on the successor's sheet";
    nm.value = l.name || "";
    nm.addEventListener("change", function () { l.name = nm.value.trim(); save(); });
    body.appendChild(nm);
    legacyTemplates(body);
    legacyChosen(body);
    legacyCustom(body);
  }

  /* What a Legacy hands to scripts/apply_legacy.py. The template's own text is
     carried rather than referenced: a successor's sheet has to state the
     charge and the effects, and the record should not depend on the template
     table still saying the same thing years later. */
  function toLegacyPatch() {
    var l = activeLegacy();
    var t = l.template ? LEGACY.templates[l.template] : null;
    var c = l.custom || {};
    return {
      legacy: slugify(l.name || (t && t.name) || l.predecessor + "-legacy"),
      name: l.name || (t && t.name) || null,
      predecessor: l.predecessor,
      predecessor_name: l.predecessor_name,
      from_template: t ? t.name : null,
      ring: t ? t.ring : c.ring,
      categories: t ? t.categories : (c.categories || []),
      requirement: t ? t.requirement : c.requirement,
      charge: t ? t.charge : c.charge,
      effects: t ? t.effects : c.effects,
      recovery_note: t ? t.recovery_note : null,
      successor_must: t && /the successor PC must/i.test(t.requirement || "")
        ? String(t.requirement).replace(/^[\s\S]*?(During character creation)/i,
                                        "$1")
        : null,
      qualifies: t ? legacyStatus(t, l.from).state : "ask",
      qualifies_why: t ? legacyStatus(t, l.from).why : null,
      notes: l.notes || ""
    };
  }

  function renderLegacySave(body) {
    var l = activeLegacy();
    var doc = toLegacyPatch();
    var head = document.createElement("p");
    head.className = "muted small";
    head.innerHTML = "A Legacy left by <strong>" + esc(l.predecessor_name) +
      "</strong>" + (doc.from_template
        ? ", from the published <strong>" + esc(doc.from_template) + "</strong> template"
        : ", written for this predecessor") + ".";
    body.appendChild(head);
    if (doc.qualifies === "unmet") {
      var warn = document.createElement("p");
      warn.className = "export-warn";
      warn.textContent = "This predecessor does not meet the template's " +
        "requirement: " + doc.qualifies_why + " The record says so; landing it " +
        "is the GM's call.";
      body.appendChild(warn);
    }
    var row = document.createElement("div");
    row.className = "choicerow";
    row.innerHTML = '<button type="button" class="btn" id="dl">Download</button>' +
      '<button type="button" class="btn" id="cp">Copy</button>';
    body.appendChild(row);
    var how = document.createElement("p");
    how.className = "muted small";
    how.innerHTML = "Then: <code>python3 scripts/apply_legacy.py " +
      esc(doc.legacy) + "</code> — it writes " +
      "<code>src/legacies/" + esc(doc.legacy) + ".json</code> and points " +
      esc(l.predecessor_name) + "'s page at it. Nothing is written without " +
      "<code>--apply</code>.";
    body.appendChild(how);
    var pre = document.createElement("pre");
    pre.className = "export-json";
    pre.textContent = JSON.stringify(doc, null, 1);
    body.appendChild(pre);
    row.querySelector("#dl").addEventListener("click", function () {
      var blob = new Blob([JSON.stringify(doc, null, 1)],
                          { type: "application/json" });
      var n = document.createElement("a");
      n.href = URL.createObjectURL(blob);
      n.download = doc.legacy + "-legacy.json";
      document.body.appendChild(n); n.click(); n.remove();
      setTimeout(function () { URL.revokeObjectURL(n.href); }, 1000);
    });
    row.querySelector("#cp").addEventListener("click", function () {
      navigator.clipboard.writeText(JSON.stringify(doc, null, 1));
    });
  }

  var LEGACY_STEPS = [
    { id: "legacy", n: 0, label: "Legacy",
      title: function () {
        var l = activeLegacy();
        return "The Legacy of " + ((l && l.predecessor_name) || "a character");
      },
      desc: "A successor who takes this on applies no result from the heritage " +
        "table at question 18. Ten templates are published; the book's own " +
        "four-step framework is here too if none of them fits.",
      done: legacyDone,
      render: renderLegacy },
    { id: "legacy-save", n: 1, label: "Save", title: "Leave the Legacy",
      desc: "This writes a record of its own and points the predecessor's page " +
        "at it. Their own record is not changed.",
      done: function () { return false; },
      render: renderLegacySave }
  ];

  /* What an edit hands to scripts/apply_edit.py: the whole wizard-owned
     document, and which record it belongs to. Deliberately not a field list —
     the applier decides what it is allowed to take from this, so there is one
     statement of that policy rather than two that can drift. */
  /* toSourceJson() for a character that is not the one open in the wizard.
     Everything downstream of it reads the global C — computed(), the heritage
     grants, mode() — so the character is swapped in and put back, the way
     draftProgress() does for the step count. */
  function sourceFor(ch) {
    var saved = C, out;
    C = ch;
    try { out = toSourceJson(); }
    finally { C = saved; }
    return out;
  }

  function toEditPatch() {
    var d = activeDraft();
    return { edit: d.fromArchive, prose_only: !!d.proseOnly,
             base_tiers: d.baseTiers || 1,
             baseline: d.baseline || null, source: toSourceJson() };
  }

  function renderExport(body) {
    var edit = isEdit();
    var doc = edit ? toEditPatch() : toSourceJson();
    var missing = activeSteps().filter(function (s) {
      return s.id !== "export" && !s.done();
    }).map(function (s) {
      return typeof s.label === "function" ? s.label() : s.label;
    });

    if (edit) {
      var head = document.createElement("p");
      head.className = "muted small";
      head.innerHTML = "Editing <strong>" + esc(editSlug()) + "</strong>. " +
        (missing.length
          ? esc(missing.length + " step" + (missing.length === 1 ? "" : "s") +
                " unanswered — the applier only writes what changed, so an " +
                "unanswered question is left as the record has it.")
          : "Every question answered.");
      body.appendChild(head);
      var row0 = document.createElement("div");
      row0.className = "choicerow";
      row0.innerHTML = '<button type="button" class="btn" id="dl">Download patch</button>' +
        '<button type="button" class="btn" id="cp">Copy patch</button>';
      body.appendChild(row0);
      var how = document.createElement("p");
      how.className = "muted small";
      how.innerHTML = "Then: <code>python3 scripts/apply_edit.py " +
        esc(editSlug()) + "</code> — it reads the edit off the table if this " +
        "draft is shared, or <code>--file</code> the download. Nothing is " +
        "written without <code>--apply</code>.";
      body.appendChild(how);
      var pre0 = document.createElement("pre");
      pre0.className = "export-json";
      pre0.textContent = JSON.stringify(doc, null, 1);
      body.appendChild(pre0);
      row0.querySelector("#dl").addEventListener("click", function () {
        var blob = new Blob([JSON.stringify(doc, null, 1)],
                            { type: "application/json" });
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = editSlug() + "-edit.json";
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      });
      row0.querySelector("#cp").addEventListener("click", function () {
        navigator.clipboard.writeText(JSON.stringify(doc, null, 1));
      });
      return;
    }

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

  /* ------------------------------------------------------------ court

     Courts of Stone's "Assembling a Court in Seven Steps": the GM sketches the
     movers, seeds the conflicts, and creates the secondaries (steps 1-3), the
     table assigns traits, bonds and personal details (steps 4-6), and the GM
     retouches and finalises (step 7). data/chargen/court.js carries the step
     list and who does each one, read from the corpus by scripts/court_tables.py.

     A court is not a character, so a court draft holds its content on
     c.court the way a legacy holds c.legacy — the wizard's shell (drafts,
     sharing, nav) is reused, the character document is not.

     What the tool enforces is what the steps state, and nothing else:

       step 4  one advantage and one disadvantage per NPC, no more
       step 5  bonds are rank 1, and every NPC ends with at least one
       step 7  one further trait per NPC that the PCs do not know about, and a
               profile — movers Adversaries, secondaries Adversary or Minion

     The book's own example movers and example giri are not offered, because
     they are absent from the corpus (its "$"-bullet lists were dropped in
     conversion) and the corpus is the only source this site reads. The need
     tiers stand in as the prompt for writing a ninjō. */

  var COURT = window.L5R_COURT || { steps: [], needs: [], templates: {} };
  /* The steps say "advantage" and "disadvantage"; the compendium files a
     peculiarity as one of four kinds. Two are advantages, two are not. */
  var PEC_KINDS = { advantage: ["distinction", "passion"],
                    disadvantage: ["adversity", "anxiety"] };
  var BOND_TYPES = CATALOG.filter(function (e) { return e.sub_type === "bond"; })
    .map(function (e) { return e.name; }).sort();
  var NPC_PROFILES = CATALOG.filter(function (e) { return e.sub_type === "npc"; })
    .map(function (e) { return e.name; }).sort();

  function isCourt() { return (activeDraft() || {}).kind === "court"; }
  function activeCourt() { return (activeChar() || {}).court || null; }

  function newCourt() {
    return { name: "", place: "", premise: "", npcs: [], bonds: [], pcs: [] };
  }

  function openCourt(asked) {
    if (!asked && !confirm(
          "Assemble a court?\n\nSeven steps: you sketch the movers, seed the " +
          "conflicts and create the secondaries, then the table assigns " +
          "traits, bonds and details, and you finalise.")) return;
    var id = newId();
    var c = newCharacter();
    c.court = newCourt();
    STORE.drafts[id] = { id: id, updated: Date.now(), kind: "court",
                         character: c };
    switchDraft(id);
  }

  function courtNpcs(tier) {
    var ct = activeCourt();
    if (!ct) return [];
    return tier ? ct.npcs.filter(function (n) { return n.tier === tier; })
                : ct.npcs;
  }

  function addNpc(tier) {
    var ct = activeCourt();
    if (!ct) return;
    ct.npcs.push({ id: newId(), tier: tier, role: "", ninjo: "", need: "",
                   giri: "", conflicts: [], advantage: "", disadvantage: "",
                   assigned_by: "", connection: "", name: "", details: "",
                   heir: "", hidden: { kind: "", name: "" }, goal: "",
                   opposition: "", offenses: ["", "", "", ""],
                   profile: "", profile_type: "", templates: [] });
    save();
  }

  function removeNpc(id) {
    var ct = activeCourt();
    if (!ct) return;
    var n = ct.npcs.filter(function (x) { return x.id === id; })[0];
    if (n && (n.name || n.role) &&
        !confirm("Remove " + (n.name || n.role) + " from the court?")) return;
    ct.npcs = ct.npcs.filter(function (x) { return x.id !== id; });
    // and every bond and conflict that pointed at them
    ct.bonds = ct.bonds.filter(function (b) {
      return b.a !== "npc:" + id && b.b !== "npc:" + id;
    });
    ct.npcs.forEach(function (x) {
      x.conflicts = (x.conflicts || []).filter(function (c) { return c !== id; });
    });
    save();
  }

  function npcById(id) {
    return courtNpcs().filter(function (n) { return n.id === id; })[0] || null;
  }

  function partyLabel(ref) {
    if (!ref) return "";
    if (ref.indexOf("pc:") === 0) return ref.slice(3);
    var n = npcById(ref.slice(4));
    return n ? (n.name || n.role || "an unnamed NPC") : "someone removed";
  }

  function npcLabel(n) {
    return n.name || n.role || (n.tier === "mover" ? "a mover" : "a secondary");
  }

  /* A line of text bound to a field, so the seven screens do not each
     hand-roll one. */
  function textField(body, ph, get, set, kind) {
    var i = document.createElement(kind === "area" ? "textarea" : "input");
    if (kind !== "area") i.type = "text";
    i.className = kind === "area" ? "textbox" : "textline";
    i.placeholder = ph;
    i.value = get() || "";
    i.addEventListener("change", function () { set(i.value.trim()); save(); });
    body.appendChild(i);
    return i;
  }

  function npcCard(body, n, fill) {
    var card = document.createElement("div");
    card.className = "npc-card" + (n.tier === "mover" ? " mover" : "");
    var head = document.createElement("div");
    head.className = "npc-head";
    head.innerHTML = '<span class="npc-tier">' + esc(n.tier) + "</span>" +
      '<span class="npc-name">' + esc(npcLabel(n)) + "</span>";
    var x = document.createElement("button");
    x.type = "button";
    x.className = "ar-x-btn";
    x.textContent = "×";
    x.title = "Remove from the court";
    x.addEventListener("click", function () { removeNpc(n.id); render(); });
    head.appendChild(x);
    card.appendChild(head);
    fill(card, n);
    body.appendChild(card);
    return card;
  }

  function addRow(body, text, tier) {
    var row = document.createElement("div");
    row.className = "choicerow";
    var b = document.createElement("button");
    b.type = "button";
    b.className = "btn ghost";
    b.textContent = text;
    b.addEventListener("click", function () { addNpc(tier); render(); });
    row.appendChild(b);
    body.appendChild(row);
  }

  /* The book's target counts, said as advice. It says three to four movers and
     three to five secondaries are good targets — targets, not limits, so this
     says where you are rather than stopping you. */
  function countNote(body, have, lo, hi, what) {
    var p = document.createElement("p");
    p.className = "muted small";
    p.textContent = have + " " + what + (have === 1 ? "" : "s") + ". " +
      (have < lo ? "The book suggests " + lo + " to " + hi + "."
       : have > hi ? "The book suggests " + lo + " to " + hi +
                     " — more makes a more complex court, which is a choice."
       : "Within the " + lo + " to " + hi + " the book suggests.");
    body.appendChild(p);
  }

  // ---- step 1: sketch out the movers (GM)

  function renderCourtMovers(body) {
    var ct = activeCourt();
    if (!ct) return needs(body, "This draft has no court on it.");
    label(body, "What this court is called");
    textField(body, "Kyūden Doji, the winter court at…",
              function () { return ct.name; },
              function (v) { ct.name = v; });
    label(body, "The arc and themes you want");
    textField(body, "What the campaign is about — the movers are the people " +
              "whose desires cut across it.",
              function () { return ct.premise; },
              function (v) { ct.premise = v; }, "area");

    label(body, "The movers");
    var note = document.createElement("p");
    note.className = "muted small";
    note.textContent = "A role at court and a ninjō are enough here — not " +
      "even a name yet. Movers are the ones whose desires intersect the PCs' " +
      "in ways that create friction.";
    body.appendChild(note);

    courtNpcs("mover").forEach(function (n) {
      npcCard(body, n, function (card) {
        textField(card, "Role at court — a daimyō, a yōjimbō, a visiting scholar…",
                  function () { return n.role; },
                  function (v) { n.role = v; });
        textField(card, "Ninjō — what they want",
                  function () { return n.ninjo; },
                  function (v) { n.ninjo = v; });
        needTier(card, n);
      });
    });
    countNote(body, courtNpcs("mover").length, 3, 4, "mover");
    addRow(body, "+ Add a mover", "mover");
  }

  /* The five tiers of need the book adapts, as a prompt rather than a field
     with consequences: which level of need a ninjō comes from changes what
     kind of story it makes. */
  function needTier(card, n) {
    if (!(COURT.needs || []).length) return;
    var wrap = document.createElement("div");
    wrap.className = "need-row";
    wrap.innerHTML = '<span class="need-k">Need</span>' +
      COURT.needs.map(function (t) {
        return '<button type="button" class="choice small' +
          (n.need === t.tier ? " active" : "") + '" data-v="' + esc(t.tier) +
          '" title="' + esc(t.turns_on) + '">' + esc(t.tier) + "</button>";
      }).join("");
    wrap.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-v]");
      if (!b) return;
      n.need = n.need === b.dataset.v ? "" : b.dataset.v;
      save(); render();
    });
    card.appendChild(wrap);
  }

  // ---- step 2: seed the conflicts (GM)

  function renderCourtConflicts(body) {
    var movers = courtNpcs("mover");
    if (!movers.length) return needs(body, "Sketch the movers first.");
    var note = document.createElement("p");
    note.className = "muted small";
    note.textContent = "Give each mover a giri that conflicts directly with " +
      "the ninjō of at least one other mover. The friction should not have " +
      "boiled over yet.";
    body.appendChild(note);

    movers.forEach(function (n) {
      npcCard(body, n, function (card) {
        var r = document.createElement("p");
        r.className = "muted small npc-recap";
        r.innerHTML = "<strong>" + esc(n.role || "no role yet") +
          "</strong> — wants: " + esc(n.ninjo || "nothing stated yet");
        card.appendChild(r);
        textField(card, "Giri — their sworn duty",
                  function () { return n.giri; },
                  function (v) { n.giri = v; });
        var others = movers.filter(function (m) { return m.id !== n.id; });
        if (!others.length) {
          var only = document.createElement("p");
          only.className = "muted small";
          only.textContent = "Only one mover, so there is no other ninjō for " +
            "this giri to cut across yet.";
          card.appendChild(only);
          return;
        }
        var lab = document.createElement("div");
        lab.className = "need-row";
        lab.innerHTML = '<span class="need-k">Cuts across</span>' +
          others.map(function (m) {
            return '<button type="button" class="choice small' +
              ((n.conflicts || []).indexOf(m.id) >= 0 ? " active" : "") +
              '" data-v="' + esc(m.id) + '" title="' +
              esc(m.ninjo || "no ninjō stated") + '">' +
              esc(npcLabel(m)) + "</button>";
          }).join("");
        lab.addEventListener("click", function (e) {
          var b = e.target.closest("button[data-v]");
          if (!b) return;
          n.conflicts = n.conflicts || [];
          var i = n.conflicts.indexOf(b.dataset.v);
          if (i >= 0) n.conflicts.splice(i, 1); else n.conflicts.push(b.dataset.v);
          save(); render();
        });
        card.appendChild(lab);
      });
    });
  }

  // ---- step 3: create secondaries (GM)

  function renderCourtSecondaries(body) {
    var ct = activeCourt();
    if (!ct) return needs(body, "This draft has no court on it.");
    var note = document.createElement("p");
    note.className = "muted small";
    note.textContent = "Made the same way as movers — a role, a ninjō and a " +
      "giri — but less pressing, and less likely to conflict with the others. " +
      "A secondary the players take an interest in can become a mover later.";
    body.appendChild(note);
    courtNpcs("secondary").forEach(function (n) {
      npcCard(body, n, function (card) {
        textField(card, "Role at court",
                  function () { return n.role; },
                  function (v) { n.role = v; });
        textField(card, "Ninjō — what they want",
                  function () { return n.ninjo; },
                  function (v) { n.ninjo = v; });
        textField(card, "Giri — their sworn duty",
                  function () { return n.giri; },
                  function (v) { n.giri = v; });
        needTier(card, n);
      });
    });
    countNote(body, courtNpcs("secondary").length, 3, 5, "secondary");
    addRow(body, "+ Add a secondary", "secondary");
  }

  // ---- step 4: assign traits (players and GM)

  /* One advantage and one disadvantage per NPC, from the compendium's 253,
     with the corpus's rule text. Not peculiarityPicker(): that colours its
     rows against the open character's tenets, heritage and rings, none of
     which mean anything for an NPC at court. */
  function traitPicker(card, n, kind) {
    var held = kind === "advantage" ? n.advantage : n.disadvantage;
    var all = CATALOG.filter(function (e) {
      return e.sub_type === "peculiarity" && PEC_KINDS[kind].indexOf(e.kind) >= 0;
    }).sort(function (a, b) { return a.name.localeCompare(b.name); });

    var row = document.createElement("div");
    row.className = "trait-row";
    var sel = document.createElement("select");
    sel.className = "trait-sel";
    sel.innerHTML = '<option value="">— ' + kind + " —</option>" +
      all.map(function (e) {
        return '<option value="' + esc(e.name) + '"' +
          (e.name === held ? " selected" : "") + ">" + esc(e.name) +
          (e.ring ? " (" + esc(cap(e.ring)) + ")" : "") + "</option>";
      }).join("");
    sel.addEventListener("change", function () {
      if (kind === "advantage") n.advantage = sel.value;
      else n.disadvantage = sel.value;
      save(); render();
    });
    row.appendChild(sel);
    card.appendChild(row);
    if (held) {
      // ruleTextFor() is the wizard's own resolver and returns the corpus's
      // HTML, so this is innerHTML rather than a second lookup of its own
      var t = ruleTextFor(held);
      if (t) {
        var d = document.createElement("div");
        d.className = "muted small trait-text";
        d.innerHTML = t;
        card.appendChild(d);
      }
    }
  }

  function renderCourtTraits(body) {
    var all = courtNpcs();
    if (!all.length) return needs(body, "There is nobody at this court yet.");
    var note = document.createElement("p");
    note.className = "muted small";
    note.innerHTML = "Going around the table, each player picks an NPC and " +
      "gives them one advantage or disadvantage — then says how their own PC " +
      "is connected to it. One of each per NPC, no more; once an NPC has " +
      "both, they are out of the round. <strong>Do not read out a mover's " +
      "ninjō, or which of these people is a mover.</strong>";
    body.appendChild(note);

    all.forEach(function (n) {
      npcCard(body, n, function (card) {
        var r = document.createElement("p");
        r.className = "muted small npc-recap";
        r.textContent = (n.role || "no role yet") +
          " · giri: " + (n.giri || "none stated");
        card.appendChild(r);
        traitPicker(card, n, "advantage");
        traitPicker(card, n, "disadvantage");
        textField(card, "Which player assigned it",
                  function () { return n.assigned_by; },
                  function (v) { n.assigned_by = v; });
        textField(card, "How their PC is connected to it",
                  function () { return n.connection; },
                  function (v) { n.connection = v; }, "area");
      });
    });
    var short = all.filter(function (n) { return !n.advantage || !n.disadvantage; });
    if (short.length) {
      var p = document.createElement("p");
      p.className = "muted small";
      p.textContent = short.length + " still to fill: " +
        short.map(npcLabel).join(", ") + ".";
      body.appendChild(p);
    }
  }

  // ---- step 5: assign bonds (players and GM)

  function bondRefs() {
    var ct = activeCourt();
    return courtNpcs().map(function (n) {
      return ["npc:" + n.id, npcLabel(n)];
    }).concat((ct.pcs || []).map(function (p) { return ["pc:" + p, p]; }));
  }

  function renderCourtBonds(body) {
    var ct = activeCourt();
    if (!ct) return needs(body, "This draft has no court on it.");
    if (!courtNpcs().length) return needs(body, "There is nobody at this court yet.");

    var note = document.createElement("p");
    note.className = "muted small";
    note.textContent = "Each player picks two NPCs and a bond they share, " +
      "recorded at rank 1 — or gives the bond to their own PC instead. Keep " +
      "going until every NPC has at least one.";
    body.appendChild(note);

    label(body, "The party");
    var pcnote = document.createElement("p");
    pcnote.className = "muted small";
    pcnote.textContent = "So a bond can run to a PC as well as between NPCs.";
    body.appendChild(pcnote);
    var pcrow = document.createElement("div");
    pcrow.className = "pc-row";
    (ct.pcs || []).forEach(function (p) {
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "choice small active";
      chip.textContent = p + " ×";
      chip.title = "Remove from the party";
      chip.addEventListener("click", function () {
        ct.pcs = ct.pcs.filter(function (x) { return x !== p; });
        ct.bonds = ct.bonds.filter(function (b) {
          return b.a !== "pc:" + p && b.b !== "pc:" + p;
        });
        save(); render();
      });
      pcrow.appendChild(chip);
    });
    body.appendChild(pcrow);
    var pcadd = document.createElement("select");
    pcadd.className = "trait-sel";
    pcadd.innerHTML = '<option value="">— add a PC —</option>' +
      ARCHIVE.filter(function (a) {
        return (ct.pcs || []).indexOf(a.name) < 0;
      }).map(function (a) {
        return '<option value="' + esc(a.name) + '">' + esc(a.name) + "</option>";
      }).join("");
    pcadd.addEventListener("change", function () {
      if (!pcadd.value) return;
      ct.pcs = (ct.pcs || []).concat([pcadd.value]);
      save(); render();
    });
    body.appendChild(pcadd);
    textField(body, "…or a name not in the archive, then press Enter",
              function () { return ""; },
              function (v) {
                if (!v || (ct.pcs || []).indexOf(v) >= 0) return;
                ct.pcs = (ct.pcs || []).concat([v]);
                render();
              });

    label(body, "Bonds");
    (ct.bonds || []).forEach(function (b, i) {
      var row = document.createElement("div");
      row.className = "bond-row";
      row.innerHTML = '<span class="bond-t">' + esc(b.type) + "</span>" +
        '<span class="bond-p">' + esc(partyLabel(b.a)) + " ↔ " +
        esc(partyLabel(b.b)) + "</span>" +
        '<span class="bond-r">rank 1</span>';
      var x = document.createElement("button");
      x.type = "button";
      x.className = "ar-x-btn";
      x.textContent = "×";
      x.addEventListener("click", function () {
        ct.bonds.splice(i, 1); save(); render();
      });
      row.appendChild(x);
      body.appendChild(row);
    });

    var refs = bondRefs();
    var form = document.createElement("div");
    form.className = "bond-form";
    var a = document.createElement("select");
    var bb = document.createElement("select");
    var ty = document.createElement("select");
    [a, bb].forEach(function (s, k) {
      s.className = "trait-sel";
      s.innerHTML = '<option value="">— ' + (k ? "and" : "between") +
        " —</option>" + refs.map(function (r) {
          return '<option value="' + esc(r[0]) + '">' + esc(r[1]) + "</option>";
        }).join("");
    });
    ty.className = "trait-sel";
    ty.innerHTML = '<option value="">— bond —</option>' +
      BOND_TYPES.map(function (t) {
        return '<option value="' + esc(t) + '">' + esc(t) + "</option>";
      }).join("");
    var add = document.createElement("button");
    add.type = "button";
    add.className = "btn ghost";
    add.textContent = "Record the bond";
    add.addEventListener("click", function () {
      if (!a.value || !bb.value || !ty.value) {
        setStatus("a bond needs two people and a type");
        return;
      }
      if (a.value === bb.value) {
        setStatus("a bond runs between two people");
        return;
      }
      var dup = (ct.bonds || []).some(function (x) {
        return (x.a === a.value && x.b === bb.value) ||
               (x.a === bb.value && x.b === a.value);
      });
      if (dup && !confirm("These two already share a bond. Record another?")) return;
      ct.bonds = (ct.bonds || []).concat([{ a: a.value, b: bb.value,
                                            type: ty.value, rank: 1 }]);
      save(); render();
    });
    [a, bb, ty, add].forEach(function (n) { form.appendChild(n); });
    body.appendChild(form);

    var bondless = courtNpcs().filter(function (n) {
      return !(ct.bonds || []).some(function (b) {
        return b.a === "npc:" + n.id || b.b === "npc:" + n.id;
      });
    });
    var p = document.createElement("p");
    p.className = "muted small";
    p.textContent = bondless.length
      ? bondless.length + " with no bond yet: " + bondless.map(npcLabel).join(", ") + "."
      : "Everyone at court has at least one bond.";
    body.appendChild(p);
  }

  // ---- step 6: assign personal details (players and GM)

  function renderCourtDetails(body) {
    var all = courtNpcs();
    if (!all.length) return needs(body, "There is nobody at this court yet.");
    var note = document.createElement("p");
    note.className = "muted small";
    note.textContent = "Names, families, quirks — offer these to the players, " +
      "especially for an NPC one of them is bonded to or sworn to. A player " +
      "is far less likely to forget a name they invented.";
    body.appendChild(note);
    var ct = activeCourt();
    all.forEach(function (n) {
      npcCard(body, n, function (card) {
        var bonds = (ct.bonds || []).filter(function (b) {
          return b.a === "npc:" + n.id || b.b === "npc:" + n.id;
        });
        if (bonds.length) {
          var r = document.createElement("p");
          r.className = "muted small npc-recap";
          r.textContent = "bonded: " + bonds.map(function (b) {
            var other = b.a === "npc:" + n.id ? b.b : b.a;
            return b.type + " with " + partyLabel(other);
          }).join("; ");
          card.appendChild(r);
        }
        textField(card, "Name", function () { return n.name; },
                  function (v) { n.name = v; });
        textField(card, "Family, quirks, whatever the table invented",
                  function () { return n.details; },
                  function (v) { n.details = v; }, "area");
      });
    });
    var unnamed = all.filter(function (n) { return !n.name; });
    if (unnamed.length) {
      var p = document.createElement("p");
      p.className = "muted small";
      p.textContent = unnamed.length + " still unnamed.";
      body.appendChild(p);
    }
  }

  // ---- step 7: retouch and finalise (GM)

  /* Prior Offenses by the PCs: the Court Sheet's twelfth field, and the only
     one with a rule attached. Four slots, and the corpus states what filling
     them all does — "if all four offenses are ever filled by any PCs' actions,
     the NPC begins to see the last PC or PCs to offend them as their current
     opposition, and begins to take action to remove them from the court".

     So the fourth entry is what the rule turns on, and when all four are there
     the screen says whose opposition it makes them and offers to write it into
     the opposition field rather than doing it silently — the corpus also says
     "the GM is the final arbiter of how these are assigned and how they
     manifest". They fill during play, not at the table where the court is
     built, so an empty set is not an unfinished step. */
  function offenseSlots(card, n) {
    n.offenses = n.offenses || ["", "", "", ""];
    while (n.offenses.length < 4) n.offenses.push("");
    var lab = document.createElement("div");
    lab.className = "need-row";
    lab.innerHTML = '<span class="need-k">Prior offenses by the PCs</span>' +
      '<span class="muted small">' +
      n.offenses.filter(function (o) { return o; }).length + " of 4</span>";
    card.appendChild(lab);
    n.offenses.forEach(function (_, i) {
      var f = document.createElement("input");
      f.type = "text";
      f.className = "textline offense";
      f.placeholder = "Offense " + (i + 1) + " — who gave it, and how";
      f.value = n.offenses[i] || "";
      f.addEventListener("change", function () {
        n.offenses[i] = f.value.trim(); save(); render();
      });
      card.appendChild(f);
    });
    var filled = n.offenses.filter(function (o) { return o; });
    if (filled.length === 4) {
      var p = document.createElement("p");
      p.className = "muted small warn";
      p.textContent = "All four are filled. " + npcLabel(n) + " now sees the " +
        "last to offend them as their opposition, and acts to remove them " +
        "from the court until it is redressed — a formal apology, a lavish " +
        "gift, or a duel.";
      card.appendChild(p);
      if (n.opposition !== n.offenses[3]) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "btn ghost";
        b.textContent = "Set their opposition to “" + n.offenses[3] + "”";
        b.addEventListener("click", function () {
          n.opposition = n.offenses[3]; save(); render();
        });
        card.appendChild(b);
      }
    }
  }

  function renderCourtFinalise(body) {
    var all = courtNpcs();
    if (!all.length) return needs(body, "There is nobody at this court yet.");
    var note = document.createElement("p");
    note.className = "muted small";
    note.innerHTML = "One more advantage or disadvantage each, that the PCs " +
      "know nothing about — so there is still something to discover. Then a " +
      "profile: <strong>movers are Adversaries</strong>, secondaries may be " +
      "Adversaries or Minions.";
    body.appendChild(note);

    all.forEach(function (n) {
      npcCard(body, n, function (card) {
        var r = document.createElement("p");
        r.className = "muted small npc-recap";
        r.textContent = "known: " + (n.advantage || "—") + " / " +
          (n.disadvantage || "—");
        card.appendChild(r);

        var kindrow = document.createElement("div");
        kindrow.className = "need-row";
        kindrow.innerHTML = '<span class="need-k">Hidden</span>' +
          ["advantage", "disadvantage"].map(function (k) {
            return '<button type="button" class="choice small' +
              (n.hidden.kind === k ? " active" : "") + '" data-v="' + k + '">' +
              cap(k) + "</button>";
          }).join("");
        kindrow.addEventListener("click", function (e) {
          var b = e.target.closest("button[data-v]");
          if (!b) return;
          if (n.hidden.kind !== b.dataset.v) { n.hidden.kind = b.dataset.v; n.hidden.name = ""; }
          save(); render();
        });
        card.appendChild(kindrow);

        if (n.hidden.kind) {
          var taken = [n.advantage, n.disadvantage];
          var opts = CATALOG.filter(function (e) {
            return e.sub_type === "peculiarity" &&
                   PEC_KINDS[n.hidden.kind].indexOf(e.kind) >= 0 &&
                   taken.indexOf(e.name) < 0;
          }).sort(function (a, b) { return a.name.localeCompare(b.name); });
          var sel = document.createElement("select");
          sel.className = "trait-sel";
          sel.innerHTML = '<option value="">— the one they do not know —</option>' +
            opts.map(function (e) {
              return '<option value="' + esc(e.name) + '"' +
                (e.name === n.hidden.name ? " selected" : "") + ">" +
                esc(e.name) + "</option>";
            }).join("");
          sel.addEventListener("change", function () {
            n.hidden.name = sel.value; save(); render();
          });
          card.appendChild(sel);
        }

        textField(card, "Current goal", function () { return n.goal; },
                  function (v) { n.goal = v; });
        textField(card, "Who they see as the obstacle to it",
                  function () { return n.opposition; },
                  function (v) { n.opposition = v; });
        textField(card, "Current heir, if their position warrants one",
                  function () { return n.heir; },
                  function (v) { n.heir = v; });
        offenseSlots(card, n);

        var prow = document.createElement("div");
        prow.className = "need-row";
        var types = n.tier === "mover" ? ["Adversary"] : ["Adversary", "Minion"];
        prow.innerHTML = '<span class="need-k">Profile</span>' +
          types.map(function (t) {
            return '<button type="button" class="choice small' +
              (n.profile_type === t ? " active" : "") + '" data-v="' + t + '">' +
              t + "</button>";
          }).join("") +
          (n.tier === "mover"
            ? '<span class="muted small"> — a mover is an Adversary</span>' : "");
        prow.addEventListener("click", function (e) {
          var b = e.target.closest("button[data-v]");
          if (!b) return;
          n.profile_type = n.profile_type === b.dataset.v ? "" : b.dataset.v;
          save(); render();
        });
        card.appendChild(prow);

        var psel = document.createElement("select");
        psel.className = "trait-sel";
        psel.innerHTML = '<option value="">— a published profile, or none —</option>' +
          NPC_PROFILES.map(function (p) {
            return '<option value="' + esc(p) + '"' +
              (p === n.profile ? " selected" : "") + ">" + esc(p) + "</option>";
          }).join("");
        psel.addEventListener("change", function () {
          n.profile = psel.value; save(); render();
        });
        card.appendChild(psel);
        var pn = document.createElement("p");
        pn.className = "muted small";
        pn.textContent = n.profile
          ? "Replace its advantages and disadvantages with the ones above, and " +
            "swap its rings to fit. A mover should generally match the party's " +
            "rank in their own sphere."
          : "Or build one from whole cloth — the book allows it.";
        card.appendChild(pn);

        var tpl = Object.keys(COURT.templates || {});
        if (tpl.length) {
          var trow = document.createElement("div");
          trow.className = "need-row wrapped";
          trow.innerHTML = '<span class="need-k">Templates</span>' +
            tpl.map(function (k) {
              var t = COURT.templates[k];
              var on = (n.templates || []).indexOf(t.name) >= 0;
              return '<button type="button" class="choice small' +
                (on ? " active" : "") + '" data-v="' + esc(t.name) + '" title="' +
                esc((t.roles.description && t.roles.description[0].value) ||
                    "an overlay on a base profile") + '">' +
                esc(t.name.replace(/\s*(NPC\s*)?Template$/, "")) + "</button>";
            }).join("");
          trow.addEventListener("click", function (e) {
            var b = e.target.closest("button[data-v]");
            if (!b) return;
            n.templates = n.templates || [];
            var i = n.templates.indexOf(b.dataset.v);
            if (i >= 0) n.templates.splice(i, 1); else n.templates.push(b.dataset.v);
            save(); render();
          });
          card.appendChild(trow);
          (n.templates || []).forEach(function (name) {
            var t = COURT.templates[norm_(name)];
            if (!t) return;
            var d = document.createElement("div");
            d.className = "tpl-detail";
            d.innerHTML = "<strong>" + esc(t.name) + "</strong>" +
              t.properties.filter(function (p) {
                return !/^base profile$|^description$/i.test(p.label);
              }).map(function (p) {
                return '<div><span class="tk">' + esc(p.label) + "</span> " +
                  esc(String(p.value)) + "</div>";
              }).join("");
            card.appendChild(d);
          });
        }
      });
    });
  }

  function norm_(s) {
    return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  }

  // ---- what the court hands to scripts/apply_court.py

  function toCourtPatch() {
    var ct = activeCourt() || newCourt();
    return {
      court: slugify(ct.name || "a-court"),
      name: ct.name || null,
      premise: ct.premise || "",
      party: (ct.pcs || []).slice(),
      npcs: courtNpcs().map(function (n) {
        return {
          id: n.id, tier: n.tier, role: n.role, name: n.name || null,
          ninjo: n.ninjo, need: n.need || null, giri: n.giri,
          // named, not id-referenced: the record should still read as prose
          // when an id means nothing to anyone
          giri_cuts_across: (n.conflicts || []).map(function (id) {
            var m = npcById(id);
            return m ? npcLabel(m) : null;
          }).filter(Boolean),
          advantage: n.advantage || null,
          disadvantage: n.disadvantage || null,
          assigned_by: n.assigned_by || null,
          pc_connection: n.connection || "",
          details: n.details || "",
          heir: n.heir || null,
          hidden: n.hidden.name
            ? { kind: n.hidden.kind, name: n.hidden.name } : null,
          goal: n.goal || null,
          opposition: n.opposition || null,
          // the Court Sheet's four slots, kept in order: the fourth is the one
          // the rule turns on
          offenses: (n.offenses || []).slice(0, 4),
          profile: n.profile || null,
          profile_type: n.profile_type || null,
          templates: (n.templates || []).slice()
        };
      }),
      bonds: (ct.bonds || []).map(function (b) {
        return { type: b.type, rank: 1,
                 between: [partyLabel(b.a), partyLabel(b.b)],
                 refs: [b.a, b.b] };
      })
    };
  }

  function renderCourtSave(body) {
    var doc = toCourtPatch();
    var open = activeSteps().filter(function (s) {
      return s.id !== "court-save" && !s.done();
    }).map(function (s) { return s.n + ". " + s.label; });
    var head = document.createElement("p");
    head.className = "muted small";
    head.innerHTML = "<strong>" + esc(doc.name || "An unnamed court") +
      "</strong> — " + doc.npcs.length + " at court (" +
      doc.npcs.filter(function (n) { return n.tier === "mover"; }).length +
      " movers), " + doc.bonds.length + " bonds.";
    body.appendChild(head);
    if (open.length) {
      var w = document.createElement("p");
      w.className = "muted small warn";
      w.textContent = "Steps still open: " + open.join(", ") +
        ". A court can be saved part-built — steps 4 to 6 happen at the table.";
      body.appendChild(w);
    }
    var secret = doc.npcs.filter(function (n) { return n.hidden || n.ninjo; }).length;
    if (secret) {
      var s = document.createElement("p");
      s.className = "muted small warn";
      s.textContent = "This record holds what the players do not know — " +
        "ninjō, and the hidden trait from step 7. It is GM material: it is " +
        "written to src/courts/ and no character page reads it.";
      body.appendChild(s);
    }
    var row = document.createElement("div");
    row.className = "choicerow";
    row.innerHTML = '<button type="button" class="btn" id="dl">Download</button>' +
      '<button type="button" class="btn" id="cp">Copy</button>';
    body.appendChild(row);
    var how = document.createElement("p");
    how.className = "muted small";
    how.innerHTML = "Then: <code>python3 scripts/apply_court.py " +
      esc(doc.court) + "</code> — it writes <code>src/courts/" +
      esc(doc.court) + ".json</code>. Nothing is written without " +
      "<code>--apply</code>.";
    body.appendChild(how);
    var pre = document.createElement("pre");
    pre.className = "export-json";
    pre.textContent = JSON.stringify(doc, null, 1);
    body.appendChild(pre);
    row.querySelector("#dl").addEventListener("click", function () {
      var blob = new Blob([JSON.stringify(doc, null, 1)],
                          { type: "application/json" });
      var n = document.createElement("a");
      n.href = URL.createObjectURL(blob);
      n.download = doc.court + "-court.json";
      document.body.appendChild(n); n.click(); n.remove();
      setTimeout(function () { URL.revokeObjectURL(n.href); }, 1000);
    });
    row.querySelector("#cp").addEventListener("click", function () {
      navigator.clipboard.writeText(JSON.stringify(doc, null, 1));
    });
  }

  // ---- the step list

  /* done() per step is the step's own stated requirement, not "has the GM
     typed something" — step 2 is done when every mover's giri cuts across
     another's ninjō, which is what the step is for. */
  var COURT_STEPS = [
    { id: "court-movers", n: 1, label: "Movers", title: "Sketch out the movers",
      desc: "A role at court and a ninjō for each. Three to four is a good " +
        "target — one or two will turn out to matter less, and that is fine.",
      done: function () {
        var m = courtNpcs("mover");
        return m.length > 0 && m.every(function (n) { return n.role && n.ninjo; });
      },
      render: renderCourtMovers },
    { id: "court-conflicts", n: 2, label: "Conflicts", title: "Seed the conflicts",
      desc: "Each mover gets a giri, and each giri conflicts directly with " +
        "the ninjō of at least one other mover.",
      done: function () {
        var m = courtNpcs("mover");
        if (!m.length) return false;
        if (m.length === 1) return !!m[0].giri;
        return m.every(function (n) {
          return n.giri && (n.conflicts || []).length > 0;
        });
      },
      render: renderCourtConflicts },
    { id: "court-secondaries", n: 3, label: "Secondaries", title: "Create secondaries",
      desc: "Role, ninjō and giri again, less pressing. Three to five.",
      done: function () {
        var s = courtNpcs("secondary");
        return s.length > 0 &&
          s.every(function (n) { return n.role && n.ninjo && n.giri; });
      },
      render: renderCourtSecondaries },
    { id: "court-traits", n: 4, label: "Traits", title: "Assign traits",
      desc: "With the players. One advantage and one disadvantage per NPC, " +
        "and how the assigning PC is connected to it.",
      done: function () {
        var a = courtNpcs();
        return a.length > 0 &&
          a.every(function (n) { return n.advantage && n.disadvantage; });
      },
      render: renderCourtTraits },
    { id: "court-bonds", n: 5, label: "Bonds", title: "Assign bonds",
      desc: "With the players. Rank 1 bonds, until every NPC has at least one.",
      done: function () {
        var ct = activeCourt();
        var a = courtNpcs();
        if (!ct || !a.length) return false;
        return a.every(function (n) {
          return (ct.bonds || []).some(function (b) {
            return b.a === "npc:" + n.id || b.b === "npc:" + n.id;
          });
        });
      },
      render: renderCourtBonds },
    { id: "court-details", n: 6, label: "Details", title: "Assign personal details",
      desc: "With the players. Names above all — a player remembers a name " +
        "they made up.",
      done: function () {
        var a = courtNpcs();
        return a.length > 0 && a.every(function (n) { return !!n.name; });
      },
      render: renderCourtDetails },
    { id: "court-finalise", n: 7, label: "Finalise", title: "Retouch and finalise",
      desc: "One hidden trait each, a current goal, and a profile — movers " +
        "as Adversaries, secondaries as Adversaries or Minions.",
      done: function () {
        var a = courtNpcs();
        return a.length > 0 && a.every(function (n) {
          return n.hidden && n.hidden.name && n.profile_type;
        });
      },
      render: renderCourtFinalise },
    { id: "court-save", n: 0, label: "Save", title: "Keep the court",
      desc: "Written to src/courts/ as GM material. Nothing about it reaches " +
        "a character page.",
      done: function () { return false; },
      render: renderCourtSave }
  ];

  function renderCourtWip() {
    var ct = activeCourt();
    var box = el("wip");
    if (!ct) { box.innerHTML = ""; return; }
    var movers = courtNpcs("mover"), secs = courtNpcs("secondary");
    function line(n) {
      var bits = [n.role || "no role"];
      if (n.profile_type) bits.push(n.profile_type);
      return '<div class="wip-npc"><span class="wn">' + esc(npcLabel(n)) +
        '</span><span class="wr">' + esc(bits.join(" · ")) + "</span>" +
        (n.advantage || n.disadvantage
          ? '<span class="wt">' + esc([n.advantage, n.disadvantage]
              .filter(Boolean).join(" / ")) + "</span>" : "") +
        (n.hidden && n.hidden.name
          ? '<span class="wh">hidden: ' + esc(n.hidden.name) + "</span>" : "") +
        "</div>";
    }
    box.innerHTML =
      '<h3 class="wip-name">' + esc(ct.name || "An unnamed court") + "</h3>" +
      '<p class="muted small">' + movers.length + " mover" +
      (movers.length === 1 ? "" : "s") + ", " + secs.length + " secondar" +
      (secs.length === 1 ? "y" : "ies") + ", " +
      ((ct.bonds || []).length) + " bond" +
      ((ct.bonds || []).length === 1 ? "" : "s") + "</p>" +
      (movers.length ? '<h4 class="wip-h">Movers</h4>' +
        movers.map(line).join("") : "") +
      (secs.length ? '<h4 class="wip-h">Secondaries</h4>' +
        secs.map(line).join("") : "") +
      ((ct.bonds || []).length
        ? '<h4 class="wip-h">Bonds</h4>' + ct.bonds.map(function (b) {
            return '<div class="wip-npc"><span class="wn">' + esc(b.type) +
              '</span><span class="wr">' + esc(partyLabel(b.a)) + " ↔ " +
              esc(partyLabel(b.b)) + "</span></div>";
          }).join("") : "");
  }

  /* ------------------------------------------------------------- army

     Fields of Victory's "Marshaling an Army". Unlike a court, this is
     arithmetic: a TN 3 Command check as a down-time activity, and then the
     marshaller's status sets the army's maximum strength (Table 3-1) and their
     bonus successes set its discipline (Table 3-2). Allied lords, mercenaries,
     doctrines, equipment upgrades and the monthly maintenance check all hang
     off that.

     data/chargen/army.js carries the whole system as the corpus states it,
     read by scripts/army_tables.py. Nothing about the numbers is written here:
     the status bands, the discipline formulae, the mercenary rates and the
     upgrade costs are all read out of the corpus at run time, so a corpus
     correction arrives without a change to this file.

     Two things the published book leaves ragged, reproduced as printed rather
     than tidied:

       - the prose says discipline is set by "bonus successes and their honor",
         while Table 3-2 says "+ ranks in Government + glory rank" and never
         mentions honor. The table is what is applied, and the screen says so.
       - Table 3-1's bands 20-24 and 24-29 both contain status 24. At exactly
         24 the screen shows both and takes the better, saying which. */

  var ARMY = window.L5R_ARMY || { systems: {}, tables: {} };

  function isArmy() { return (activeDraft() || {}).kind === "army"; }
  function activeArmy() { return (activeChar() || {}).army || null; }

  function newArmy() {
    return { name: "", marshaller: null, status_mods: [], bonus: 0,
             strength: null, allies: [], mercenaries: [], doctrines: [],
             upgrades: [], conditions: [], notes: "" };
  }

  function openArmy(asked) {
    if (!asked && !confirm(
          "Marshal an army?\n\nA TN 3 Command check as a down-time activity. " +
          "The marshaller's status sets its strength and their bonus successes " +
          "set its discipline.")) return;
    var id = newId();
    var c = newCharacter();
    c.army = newArmy();
    STORE.drafts[id] = { id: id, updated: Date.now(), kind: "army",
                         character: c };
    switchDraft(id);
  }

  function armyTable(key) {
    var t = ARMY.tables[key];
    return t ? t.entries || [] : [];
  }
  function armySystem(key) { return ARMY.systems[key] || null; }

  /* A band named "Status 90-99" or "Status 100" or "Allied Status 0-19",
     read off the corpus's own entry name rather than a hard-coded ladder. */
  function bandRange(name) {
    var m = String(name).match(/(\d+)\s*[-–—]\s*(\d+)/);
    if (m) return [parseInt(m[1], 10), parseInt(m[2], 10)];
    var one = String(name).match(/(\d+)/);
    return one ? [parseInt(one[1], 10), parseInt(one[1], 10)] : null;
  }

  /* Every band that contains this status. Normally one; at status 24 the
     book's own bands overlap and this returns two. */
  function bandsFor(entries, status, prop) {
    return entries.filter(function (e) {
      var r = bandRange(e.name);
      return r && status >= r[0] && status <= r[1] &&
             e.properties[prop] != null;
    });
  }

  function armyRank(n) {
    // the corpus states it: rank is the tens digit (honor 35 = rank 3)
    return Math.floor((Number(n) || 0) / 10);
  }

  function effStatus() {
    var a = activeArmy();
    if (!a) return 0;
    var base = (a.marshaller && Number(a.marshaller.status)) || 0;
    return (a.status_mods || []).reduce(function (t, m) {
      return t + (Number(m.by) || 0);
    }, base);
  }

  /* What the army comes out as. Kept in one place so the screens and the
     export cannot disagree about it. */
  function armyState() {
    var a = activeArmy() || newArmy();
    var st = effStatus();
    var bands = bandsFor(armyTable("table31determiningarmystrength"), st,
                         "Maximum Strength");
    var maxes = bands.map(function (b) {
      return Number(b.properties["Maximum Strength"]);
    });
    var max = maxes.length ? Math.max.apply(null, maxes) : null;

    var disc = null, discWhy = null;
    var rows = armyTable("table32determiningarmydiscipline");
    var bonus = Number(a.bonus) || 0;
    // the entries are named "4+ Bonus Successes", "3 Bonus Successes", …
    var hit = rows.filter(function (e) {
      var m = e.name.match(/(\d+)\s*(\+)?/);
      if (!m) return false;
      var n = parseInt(m[1], 10);
      return m[2] || /\bor more\b/i.test(e.name) ? bonus >= n : bonus === n;
    })[0];
    if (hit) {
      var f = String(hit.properties.Discipline || "");
      var lead = f.match(/^(\d+)/);
      var gov = (a.marshaller && Number(a.marshaller.government)) || 0;
      var gl = armyRank((a.marshaller && a.marshaller.glory) || 0);
      disc = (lead ? parseInt(lead[1], 10) : 0) +
             (/Government/i.test(f) ? gov : 0) +
             (/glory rank/i.test(f) ? gl : 0);
      discWhy = f;
    }

    var allied = (a.allies || []).map(function (al) {
      var b = bandsFor(armyTable("table35alliedforces"),
                       Number(al.status) || 0, "Modifiers")[0] ||
              bandsFor(armyTable("table35alliedforces"),
                       Number(al.status) || 0, "Base Army Stats")[0] || null;
      return { lord: al.lord, status: al.status, band: b };
    });

    var monthly = (a.mercenaries || []).reduce(function (t, m) {
      var e = armyTable("table34mercenaryforces").filter(function (x) {
        return x.name === m.name;
      })[0];
      var k = e && String(e.properties.Cost || "").match(/([\d,]+)\s*koku/);
      return t + (k ? parseInt(k[1].replace(/,/g, ""), 10) : 0) *
                 (Number(m.n) || 1);
    }, 0);

    var outlay = (a.upgrades || []).reduce(function (t, name) {
      var e = ((armySystem("equipmentupgrades") || {}).entries || [])
        .filter(function (x) { return x.name === name; })[0];
      var k = e && String(e.properties.Cost || "").match(/([\d,]+)\s*koku/);
      return t + (k ? parseInt(k[1].replace(/,/g, ""), 10) : 0);
    }, 0);

    return { eff: st, bands: bands, max: max, overlap: bands.length > 1,
             strength: a.strength, discipline: disc, discipline_formula: discWhy,
             allied: allied, monthly: monthly, outlay: outlay };
  }

  // ---- step 1: the marshaller

  function renderArmyMarshaller(body) {
    var a = activeArmy();
    if (!a) return needs(body, "This draft has no army on it.");
    var sys = armySystem("marshalinganarmy");

    label(body, "What this army is called");
    textField(body, "The Host of the Twin Rivers…",
              function () { return a.name; },
              function (v) { a.name = v; });

    if (sys && sys.properties) {
      var p = document.createElement("p");
      p.className = "muted small";
      p.textContent = ["Check: " + (sys.properties.Check || "—"),
                       sys.properties.Activation,
                       sys.properties.Frequency].filter(Boolean).join(" · ");
      body.appendChild(p);
    }

    label(body, "Who marshals it");
    var pick = document.createElement("select");
    pick.className = "trait-sel";
    pick.innerHTML = '<option value="">— from the archive, or fill it in below —</option>' +
      ARCHIVE.filter(function (x) { return x.top; }).map(function (x) {
        return '<option value="' + esc(x.slug) + '"' +
          ((a.marshaller && a.marshaller.slug) === x.slug ? " selected" : "") +
          ">" + esc(x.name) + "</option>";
      }).join("");
    pick.addEventListener("change", function () {
      var x = ARCHIVE.filter(function (y) { return y.slug === pick.value; })[0];
      if (!x) { a.marshaller = null; save(); render(); return; }
      var soc = (x.top && x.top.social) || x.social || {};
      var sk = (x.top && x.top.skills) || x.skills || {};
      a.marshaller = {
        slug: x.slug, name: x.name,
        status: Number(soc.status) || 0,
        honor: Number(soc.honor) || 0,
        glory: Number(soc.glory) || 0,
        command: ((sk.social || {}).command) || 0,
        government: ((sk.scholar || {}).government) || 0
      };
      save(); render();
    });
    body.appendChild(pick);

    var m = a.marshaller || { name: "", status: 0, honor: 0, glory: 0,
                              command: 0, government: 0 };
    if (!a.marshaller) {
      textField(body, "…or a name",
                function () { return ""; },
                function (v) {
                  if (!v) return;
                  a.marshaller = { slug: null, name: v, status: 0, honor: 0,
                                   glory: 0, command: 0, government: 0 };
                  render();
                });
      return;
    }

    var grid = document.createElement("div");
    grid.className = "army-grid";
    [["status", "Status"], ["honor", "Honor"], ["glory", "Glory"],
     ["command", "Command"], ["government", "Government"]]
      .forEach(function (f) {
        var cell = document.createElement("label");
        cell.className = "army-cell";
        cell.innerHTML = "<span>" + f[1] + "</span>";
        var i = document.createElement("input");
        i.type = "number";
        i.min = "0";
        i.value = m[f[0]];
        i.addEventListener("change", function () {
          a.marshaller[f[0]] = Number(i.value) || 0; save(); render();
        });
        cell.appendChild(i);
        grid.appendChild(cell);
      });
    body.appendChild(grid);

    label(body, "Temporary status, if their wealth does not match their rank");
    var ex = armySystem("supplementalforces");
    var exs = ex && ex.properties["Status Modifier Examples"];
    if (exs) {
      var note = document.createElement("p");
      note.className = "muted small";
      note.textContent = "The book's examples: " +
        (Array.isArray(exs) ? exs.join("; ") : exs);
      body.appendChild(note);
    }
    (a.status_mods || []).forEach(function (sm, i) {
      var row = document.createElement("div");
      row.className = "mod-row";
      var w = document.createElement("input");
      w.type = "text";
      w.placeholder = "A ship with luxury goods";
      w.value = sm.what || "";
      w.addEventListener("change", function () { sm.what = w.value.trim(); save(); });
      var b = document.createElement("input");
      b.type = "number";
      b.value = sm.by || 0;
      b.addEventListener("change", function () {
        sm.by = Number(b.value) || 0; save(); render();
      });
      var x = document.createElement("button");
      x.type = "button";
      x.className = "ar-x-btn";
      x.textContent = "×";
      x.addEventListener("click", function () {
        a.status_mods.splice(i, 1); save(); render();
      });
      [w, b, x].forEach(function (n) { row.appendChild(n); });
      body.appendChild(row);
    });
    var add = document.createElement("button");
    add.type = "button";
    add.className = "btn ghost";
    add.textContent = "+ Add a status modifier";
    add.addEventListener("click", function () {
      a.status_mods = (a.status_mods || []).concat([{ what: "", by: 0 }]);
      save(); render();
    });
    body.appendChild(add);

    var st = armyState();
    var out = document.createElement("p");
    out.className = "muted small";
    out.innerHTML = "Effective status <strong>" + st.eff + "</strong>" +
      (st.max != null
        ? " — maximum strength <strong>" + st.max + "</strong>"
        : " — no status band in Table 3-1 covers that");
    body.appendChild(out);
    if (st.overlap) {
      var ov = document.createElement("p");
      ov.className = "muted small warn";
      ov.textContent = "Table 3-1 prints " +
        st.bands.map(function (b) {
          return b.name + " → " + b.properties["Maximum Strength"];
        }).join(" and ") +
        ", and status " + st.eff + " falls in both. Taking the higher, as " +
        "printed — the overlap is the book's.";
      body.appendChild(ov);
    }
  }

  // ---- step 2: the marshaling check

  function renderArmyCheck(body) {
    var a = activeArmy();
    if (!a) return needs(body, "This draft has no army on it.");
    if (!a.marshaller) return needs(body, "Say who marshals it first.");
    var sys = armySystem("marshalinganarmy");

    var p = document.createElement("p");
    p.className = "muted small";
    p.textContent = (sys && sys.note) ||
      "A TN 3 Command check as a down-time activity.";
    body.appendChild(p);

    label(body, "Bonus successes on the check");
    var row = document.createElement("div");
    row.className = "need-row";
    row.innerHTML = '<span class="need-k">Bonus</span>' +
      [0, 1, 2, 3, 4].map(function (n) {
        return '<button type="button" class="choice small' +
          ((Number(a.bonus) || 0) === n ? " active" : "") + '" data-v="' + n +
          '">' + (n === 4 ? "4 or more" : n) + "</button>";
      }).join("");
    row.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-v]");
      if (!b) return;
      a.bonus = Number(b.dataset.v); save(); render();
    });
    body.appendChild(row);

    var st = armyState();
    var d = document.createElement("p");
    d.className = "muted small";
    d.innerHTML = st.discipline != null
      ? "Discipline <strong>" + st.discipline + "</strong> — " +
        esc(st.discipline_formula) + ", with Government " +
        a.marshaller.government + " and glory rank " +
        armyRank(a.marshaller.glory) + " (glory " + a.marshaller.glory + ")"
      : "No row in Table 3-2 for that many bonus successes.";
    body.appendChild(d);

    var anom = document.createElement("p");
    anom.className = "muted small";
    anom.textContent = "The prose says discipline is set by bonus successes " +
      "and honor; Table 3-2 says Government and glory rank, and never " +
      "mentions honor. The table is what is applied here. Both are as printed.";
    body.appendChild(anom);

    label(body, "Strength");
    var st2 = armyState();
    var note = document.createElement("p");
    note.className = "muted small";
    note.textContent = st2.max != null
      ? "Up to " + st2.max + ", and never below 5 — a smaller army is easier " +
        "to maintain, which is a real reason to take one."
      : "Set the marshaller's status first.";
    body.appendChild(note);
    var s = document.createElement("input");
    s.type = "number";
    s.min = "5";
    if (st2.max != null) s.max = String(st2.max);
    s.value = a.strength == null ? "" : a.strength;
    s.placeholder = st2.max != null ? "5 to " + st2.max : "";
    s.addEventListener("change", function () {
      var v = s.value === "" ? null : Number(s.value);
      if (v != null && v < 5) { setStatus("the minimum army is 5"); v = 5; }
      if (v != null && st2.max != null && v > st2.max) {
        setStatus("status " + st2.eff + " allows at most " + st2.max);
        v = st2.max;
      }
      a.strength = v; save(); render();
    });
    body.appendChild(s);
  }

  // ---- step 3: supplemental forces

  function renderArmySupplemental(body) {
    var a = activeArmy();
    if (!a) return needs(body, "This draft has no army on it.");
    var sys = armySystem("supplementalforces");

    label(body, "Allied lords");
    var an = document.createElement("p");
    an.className = "muted small";
    an.textContent = "Winning a lord's support should take an Intrigue or a " +
      "run of scenes, and usually a concession — territory, a marriage, " +
      "somebody else's enemy defeated. What they bring follows their status.";
    body.appendChild(an);

    (a.allies || []).forEach(function (al, i) {
      var row = document.createElement("div");
      row.className = "mod-row";
      var nm = document.createElement("input");
      nm.type = "text";
      nm.placeholder = "The lord's name";
      nm.value = al.lord || "";
      nm.addEventListener("change", function () { al.lord = nm.value.trim(); save(); render(); });
      var stt = document.createElement("input");
      stt.type = "number";
      stt.min = "0";
      stt.value = al.status || 0;
      stt.addEventListener("change", function () {
        al.status = Number(stt.value) || 0; save(); render();
      });
      var x = document.createElement("button");
      x.type = "button";
      x.className = "ar-x-btn";
      x.textContent = "×";
      x.addEventListener("click", function () {
        a.allies.splice(i, 1); save(); render();
      });
      [nm, stt, x].forEach(function (n) { row.appendChild(n); });
      body.appendChild(row);
      var b = armyState().allied[i] && armyState().allied[i].band;
      var d = document.createElement("p");
      d.className = "muted small ally-band";
      d.textContent = b
        ? b.name + " — " + Object.keys(b.properties).map(function (k) {
            return k + ": " + b.properties[k];
          }).join(" · ")
        : "No band in Table 3-5 covers status " + (al.status || 0) + ".";
      body.appendChild(d);
    });
    var addA = document.createElement("button");
    addA.type = "button";
    addA.className = "btn ghost";
    addA.textContent = "+ Add an allied lord";
    addA.addEventListener("click", function () {
      a.allies = (a.allies || []).concat([{ lord: "", status: 0 }]);
      save(); render();
    });
    body.appendChild(addA);

    label(body, "Mercenaries");
    var mn = document.createElement("p");
    mn.className = "muted small";
    mn.textContent = "Paid a fixed amount each month, when the maintenance " +
      "check is made.";
    body.appendChild(mn);
    armyTable("table34mercenaryforces").forEach(function (e) {
      var held = (a.mercenaries || []).filter(function (m) {
        return m.name === e.name;
      })[0];
      var row = document.createElement("div");
      row.className = "merc-row" + (held ? " on" : "");
      var t = document.createElement("button");
      t.type = "button";
      t.className = "choice small" + (held ? " active" : "");
      t.textContent = e.name;
      t.addEventListener("click", function () {
        if (held) {
          a.mercenaries = a.mercenaries.filter(function (m) {
            return m.name !== e.name;
          });
        } else {
          a.mercenaries = (a.mercenaries || []).concat([{ name: e.name, n: 1 }]);
        }
        save(); render();
      });
      row.appendChild(t);
      var d = document.createElement("span");
      d.className = "muted small";
      d.textContent = Object.keys(e.properties).map(function (k) {
        return k + ": " + e.properties[k];
      }).join(" · ");
      row.appendChild(d);
      if (held) {
        var n = document.createElement("input");
        n.type = "number";
        n.min = "1";
        n.value = held.n || 1;
        n.className = "merc-n";
        n.addEventListener("change", function () {
          held.n = Math.max(1, Number(n.value) || 1); save(); render();
        });
        row.appendChild(n);
      }
      body.appendChild(row);
    });

    var st = armyState();
    var tot = document.createElement("p");
    tot.className = "muted small";
    tot.innerHTML = "Mercenaries cost <strong>" +
      st.monthly.toLocaleString() + " koku</strong> a month.";
    body.appendChild(tot);

    if (sys) {
      (sys.entries || []).filter(function (e) {
        return !/^Table /.test(e.name) && (e.note || e.properties.Rule);
      }).forEach(function (e) {
        var d = document.createElement("div");
        d.className = "tpl-detail";
        d.innerHTML = "<strong>" + esc(e.name) + "</strong>" +
          (e.note ? "<div>" + esc(e.note) + "</div>" : "") +
          Object.keys(e.properties).map(function (k) {
            return '<div><span class="tk">' + esc(k) + "</span> " +
              esc(String(e.properties[k])) + "</div>";
          }).join("");
        body.appendChild(d);
      });
    }
  }

  // ---- step 4: doctrines

  /* Doctrines nest, and the parent is not an empty folder: "Clan Doctrines"
     carries the Applies To, Narrative Requirements and Training Check that all
     seven clan doctrines share, while each clan carries only its own Effect.
     So a parent with children becomes a group whose shared terms are stated
     once, and each child is pickable and inherits them. Rendering the parent
     as a pickable card would offer a doctrine that is not one; hiding its
     properties would drop the requirements the clan ones are taken under. */
  function doctrineList() {
    var sys = armySystem("doctrines");
    if (!sys) return [];
    var out = [];
    (sys.entries || []).forEach(function (e) {
      if ((e.entries || []).length) {
        e.entries.forEach(function (c) {
          out.push({ d: c, group: e.name, shared: e.properties, note: e.note });
        });
      } else {
        out.push({ d: e, group: null, shared: null, note: null });
      }
    });
    return out;
  }

  function renderArmyDoctrines(body) {
    var a = activeArmy();
    if (!a) return needs(body, "This draft has no army on it.");
    var all = doctrineList();
    if (!all.length) return needs(body, "The corpus states no doctrines.");
    var n = document.createElement("p");
    n.className = "muted small";
    n.textContent = "Each doctrine states what training or narrative it takes " +
      "to have. Nothing here is compulsory — an army with none is an army.";
    body.appendChild(n);

    var groups = {}, shared = {};
    all.forEach(function (x) {
      var g = x.group || "General";
      (groups[g] = groups[g] || []).push(x.d);
      if (x.shared) shared[g] = { props: x.shared, note: x.note };
    });
    Object.keys(groups).sort(function (p, q) {
      return p === "General" ? -1 : q === "General" ? 1 : p.localeCompare(q);
    }).forEach(function (g) {
      label(body, g);
      // the terms every doctrine in the group is taken under, stated once
      if (shared[g]) {
        var sh = document.createElement("div");
        sh.className = "tpl-detail";
        sh.innerHTML = (shared[g].note
            ? "<div>" + esc(shared[g].note) + "</div>" : "") +
          Object.keys(shared[g].props).map(function (k) {
            return '<div><span class="tk">' + esc(k) + "</span> " +
              esc(String(shared[g].props[k])) + "</div>";
          }).join("");
        body.appendChild(sh);
      }
      groups[g].forEach(function (d) {
        var on = (a.doctrines || []).indexOf(d.name) >= 0;
        var card = document.createElement("div");
        card.className = "doc-card" + (on ? " on" : "");
        var t = document.createElement("button");
        t.type = "button";
        t.className = "choice small" + (on ? " active" : "");
        t.textContent = d.name;
        t.addEventListener("click", function () {
          a.doctrines = a.doctrines || [];
          var i = a.doctrines.indexOf(d.name);
          if (i >= 0) a.doctrines.splice(i, 1); else a.doctrines.push(d.name);
          save(); render();
        });
        card.appendChild(t);
        var body2 = document.createElement("div");
        body2.className = "doc-body";
        body2.innerHTML = Object.keys(d.properties).map(function (k) {
          return '<div><span class="tk">' + esc(k) + "</span> " +
            esc(String(d.properties[k])) + "</div>";
        }).join("") + (d.note ? '<div class="muted small">' + esc(d.note) +
                                "</div>" : "");
        card.appendChild(body2);
        body.appendChild(card);
      });
    });
  }

  // ---- step 5: outfitting

  function renderArmyOutfitting(body) {
    var a = activeArmy();
    if (!a) return needs(body, "This draft has no army on it.");
    var sys = armySystem("equipmentupgrades");
    if (!sys) return needs(body, "The corpus states no equipment upgrades.");
    var n = document.createElement("p");
    n.className = "muted small";
    n.textContent = "Bought once, and each states what it applies to and how " +
      "rare it is.";
    body.appendChild(n);
    (sys.entries || []).forEach(function (e) {
      var on = (a.upgrades || []).indexOf(e.name) >= 0;
      var card = document.createElement("div");
      card.className = "doc-card" + (on ? " on" : "");
      var t = document.createElement("button");
      t.type = "button";
      t.className = "choice small" + (on ? " active" : "");
      t.textContent = e.name;
      t.addEventListener("click", function () {
        a.upgrades = a.upgrades || [];
        var i = a.upgrades.indexOf(e.name);
        if (i >= 0) a.upgrades.splice(i, 1); else a.upgrades.push(e.name);
        save(); render();
      });
      card.appendChild(t);
      var d = document.createElement("div");
      d.className = "doc-body";
      d.innerHTML = Object.keys(e.properties).map(function (k) {
        return '<div><span class="tk">' + esc(k) + "</span> " +
          esc(String(e.properties[k])) + "</div>";
      }).join("");
      card.appendChild(d);
      body.appendChild(card);
    });
    var st = armyState();
    var tot = document.createElement("p");
    tot.className = "muted small";
    tot.innerHTML = "One-off outlay <strong>" + st.outlay.toLocaleString() +
      " koku</strong>.";
    body.appendChild(tot);
  }

  // ---- step 6: maintenance

  function renderArmyMaintenance(body) {
    var a = activeArmy();
    if (!a) return needs(body, "This draft has no army on it.");
    var sys = armySystem("armymaintenance");
    if (!sys) return needs(body, "The corpus states no maintenance rules.");

    if (sys.properties && Object.keys(sys.properties).length) {
      var d = document.createElement("div");
      d.className = "tpl-detail";
      d.innerHTML = Object.keys(sys.properties).map(function (k) {
        return '<div><span class="tk">' + esc(k) + "</span> " +
          esc(String(sys.properties[k])) + "</div>";
      }).join("");
      body.appendChild(d);
    }

    label(body, "Table 3-6: what the check does");
    armyTable("table36armymaintenancecheckresults").forEach(function (e) {
      var row = document.createElement("div");
      row.className = "res-row";
      row.innerHTML = '<span class="res-k">' + esc(e.name) + "</span>" +
        '<span class="res-v">' + Object.keys(e.properties).map(function (k) {
          return esc(String(e.properties[k]));
        }).join(" · ") + "</span>";
      body.appendChild(row);
    });

    var harsh = (sys.entries || []).filter(function (e) {
      return /Harsh Conditions/i.test(e.name);
    })[0];
    var conds = harsh ? harsh.entries || [] : [];
    if (conds.length) {
      label(body, "Harsh conditions in play");
      conds.forEach(function (c) {
        var on = (a.conditions || []).indexOf(c.name) >= 0;
        var row = document.createElement("div");
        row.className = "merc-row" + (on ? " on" : "");
        var t = document.createElement("button");
        t.type = "button";
        t.className = "choice small" + (on ? " active" : "");
        t.textContent = c.name;
        t.addEventListener("click", function () {
          a.conditions = a.conditions || [];
          var i = a.conditions.indexOf(c.name);
          if (i >= 0) a.conditions.splice(i, 1); else a.conditions.push(c.name);
          save(); render();
        });
        row.appendChild(t);
        var s = document.createElement("span");
        s.className = "muted small";
        s.textContent = Object.keys(c.properties).map(function (k) {
          return k + ": " + c.properties[k];
        }).join(" · ");
        row.appendChild(s);
        body.appendChild(row);
      });
    }

    (sys.entries || []).filter(function (e) {
      return !/^Table |Harsh Conditions/i.test(e.name) &&
             (Object.keys(e.properties).length || e.note);
    }).forEach(function (e) {
      var d = document.createElement("div");
      d.className = "tpl-detail";
      d.innerHTML = "<strong>" + esc(e.name) + "</strong>" +
        (e.note ? "<div>" + esc(e.note) + "</div>" : "") +
        Object.keys(e.properties).map(function (k) {
          return '<div><span class="tk">' + esc(k) + "</span> " +
            esc(String(e.properties[k])) + "</div>";
        }).join("");
      body.appendChild(d);
    });

    var st = armyState();
    var p = document.createElement("p");
    p.className = "muted small";
    p.innerHTML = "Running cost: <strong>" + st.monthly.toLocaleString() +
      " koku</strong> a month in mercenaries" +
      ((a.conditions || []).length
        ? ", under " + a.conditions.length + " harsh condition" +
          (a.conditions.length === 1 ? "" : "s") : "") + ".";
    body.appendChild(p);
  }

  // ---- what the army hands to scripts/apply_army.py

  function toArmyPatch() {
    var a = activeArmy() || newArmy();
    var st = armyState();
    return {
      army: slugify(a.name || "an-army"),
      name: a.name || null,
      marshaller: a.marshaller
        ? { slug: a.marshaller.slug, name: a.marshaller.name,
            status: a.marshaller.status, honor: a.marshaller.honor,
            glory: a.marshaller.glory, glory_rank: armyRank(a.marshaller.glory),
            command: a.marshaller.command,
            government: a.marshaller.government }
        : null,
      status_modifiers: (a.status_mods || []).slice(),
      effective_status: st.eff,
      bonus_successes: Number(a.bonus) || 0,
      // both the number and the band it came from, so the arithmetic can be
      // re-done rather than taken on trust
      maximum_strength: st.max,
      strength_band: st.bands.map(function (b) { return b.name; }),
      strength: a.strength,
      discipline: st.discipline,
      discipline_formula: st.discipline_formula,
      allies: (a.allies || []).map(function (al, i) {
        var b = st.allied[i] && st.allied[i].band;
        return { lord: al.lord, status: al.status,
                 band: b ? b.name : null,
                 brings: b ? b.properties : null };
      }),
      mercenaries: (a.mercenaries || []).slice(),
      monthly_koku: st.monthly,
      doctrines: (a.doctrines || []).slice(),
      upgrades: (a.upgrades || []).slice(),
      upgrade_koku: st.outlay,
      harsh_conditions: (a.conditions || []).slice(),
      notes: a.notes || ""
    };
  }

  function renderArmySave(body) {
    var doc = toArmyPatch();
    var open = activeSteps().filter(function (s) {
      return s.id !== "army-save" && !s.done();
    }).map(function (s) { return s.n + ". " + s.label; });
    var head = document.createElement("p");
    head.className = "muted small";
    head.innerHTML = "<strong>" + esc(doc.name || "An unnamed army") +
      "</strong> — strength " + (doc.strength == null ? "not set" : doc.strength) +
      " of " + (doc.maximum_strength == null ? "?" : doc.maximum_strength) +
      ", discipline " + (doc.discipline == null ? "not set" : doc.discipline) +
      ", " + doc.allies.length + " allied lord" +
      (doc.allies.length === 1 ? "" : "s") + ", " +
      doc.monthly_koku.toLocaleString() + " koku a month.";
    body.appendChild(head);
    if (open.length) {
      var w = document.createElement("p");
      w.className = "muted small warn";
      w.textContent = "Steps still open: " + open.join(", ") + ".";
      body.appendChild(w);
    }
    var row = document.createElement("div");
    row.className = "choicerow";
    row.innerHTML = '<button type="button" class="btn" id="dl">Download</button>' +
      '<button type="button" class="btn" id="cp">Copy</button>';
    body.appendChild(row);
    var how = document.createElement("p");
    how.className = "muted small";
    how.innerHTML = "Then: <code>python3 scripts/apply_army.py " +
      esc(doc.army) + "</code> — it writes <code>src/armies/" +
      esc(doc.army) + ".json</code> and re-does the arithmetic from the " +
      "corpus before it will. Nothing is written without <code>--apply</code>.";
    body.appendChild(how);
    var pre = document.createElement("pre");
    pre.className = "export-json";
    pre.textContent = JSON.stringify(doc, null, 1);
    body.appendChild(pre);
    row.querySelector("#dl").addEventListener("click", function () {
      var blob = new Blob([JSON.stringify(doc, null, 1)],
                          { type: "application/json" });
      var n = document.createElement("a");
      n.href = URL.createObjectURL(blob);
      n.download = doc.army + "-army.json";
      document.body.appendChild(n); n.click(); n.remove();
      setTimeout(function () { URL.revokeObjectURL(n.href); }, 1000);
    });
    row.querySelector("#cp").addEventListener("click", function () {
      navigator.clipboard.writeText(JSON.stringify(doc, null, 1));
    });
  }

  var ARMY_STEPS = [
    { id: "army-marshaller", n: 1, label: "Marshaller",
      title: "Who marshals it",
      desc: "Their status sets the army's maximum strength. If their wealth " +
        "does not match their rank, the book lets the GM treat the status as " +
        "the wealth they can actually reach.",
      done: function () {
        var a = activeArmy();
        return !!(a && a.name && a.marshaller && armyState().max != null);
      },
      render: renderArmyMarshaller },
    { id: "army-check", n: 2, label: "The check", title: "Marshal the army",
      desc: "A TN 3 Command check as a down-time activity. Bonus successes " +
        "set the discipline; the strength is chosen up to the maximum, and " +
        "never below 5.",
      done: function () {
        var a = activeArmy(), st = armyState();
        return !!(a && a.strength != null && a.strength >= 5 &&
                  st.discipline != null);
      },
      render: renderArmyCheck },
    { id: "army-supplemental", n: 3, label: "Supplements",
      title: "Allies and mercenaries",
      desc: "Optional. An allied lord brings what their status allows; " +
        "mercenaries are paid every month.",
      done: function () { return !!activeArmy(); },
      render: renderArmySupplemental },
    { id: "army-doctrines", n: 4, label: "Doctrines", title: "Doctrines",
      desc: "Optional. Each states the training or the narrative it takes.",
      done: function () { return !!activeArmy(); },
      render: renderArmyDoctrines },
    { id: "army-outfitting", n: 5, label: "Outfitting",
      title: "Equipment upgrades",
      desc: "Optional, and bought once each.",
      done: function () { return !!activeArmy(); },
      render: renderArmyOutfitting },
    { id: "army-maintenance", n: 6, label: "Maintenance",
      title: "Keeping it in the field",
      desc: "What the monthly check costs and what happens when it fails.",
      done: function () { return !!activeArmy(); },
      render: renderArmyMaintenance },
    { id: "army-save", n: 0, label: "Save", title: "Keep the army",
      desc: "Written to src/armies/, with the band and the formula each number " +
        "came from so the arithmetic can be checked rather than trusted.",
      done: function () { return false; },
      render: renderArmySave }
  ];

  function renderArmyWip() {
    var a = activeArmy();
    var box = el("wip");
    if (!a) { box.innerHTML = ""; return; }
    var st = armyState();
    function stat(k, v) {
      return '<div class="wip-npc"><span class="wn">' + esc(String(v)) +
        '</span><span class="wr">' + esc(k) + "</span></div>";
    }
    box.innerHTML =
      '<h3 class="wip-name">' + esc(a.name || "An unnamed army") + "</h3>" +
      '<p class="muted small">' +
        (a.marshaller ? "marshalled by " + esc(a.marshaller.name)
                      : "no marshaller yet") + "</p>" +
      stat("strength", (a.strength == null ? "—" : a.strength) +
           (st.max != null ? " / " + st.max : "")) +
      stat("discipline", st.discipline == null ? "—" : st.discipline) +
      stat("effective status", st.eff) +
      (st.monthly ? stat("koku a month", st.monthly.toLocaleString()) : "") +
      (st.outlay ? stat("koku outlay", st.outlay.toLocaleString()) : "") +
      ((a.allies || []).length
        ? '<h4 class="wip-h">Allies</h4>' + a.allies.map(function (al, i) {
            var b = st.allied[i] && st.allied[i].band;
            return '<div class="wip-npc"><span class="wn">' +
              esc(al.lord || "unnamed lord") + '</span><span class="wr">' +
              (b ? esc(b.name) : "status " + al.status) + "</span></div>";
          }).join("") : "") +
      ((a.mercenaries || []).length
        ? '<h4 class="wip-h">Mercenaries</h4>' + a.mercenaries.map(function (m) {
            return '<div class="wip-npc"><span class="wn">' + esc(m.name) +
              '</span><span class="wr">×' + (m.n || 1) + "</span></div>";
          }).join("") : "") +
      ((a.doctrines || []).length
        ? '<h4 class="wip-h">Doctrines</h4>' + a.doctrines.map(function (d) {
            return '<div class="wip-npc"><span class="wn">' + esc(d) +
              "</span></div>";
          }).join("") : "") +
      ((a.upgrades || []).length
        ? '<h4 class="wip-h">Equipment</h4>' + a.upgrades.map(function (u) {
            return '<div class="wip-npc"><span class="wn">' + esc(u) +
              "</span></div>";
          }).join("") : "");
  }

  /* ----------------------------------------------------------- school

     Path of Waves' "Building a School", nine steps. data/chargen/schoolbuild.js
     carries the framework and Tables 2-3 through 2-11 as the corpus states
     them, read by scripts/school_tables.py.

     Almost everything keys off the school's ROLE, so step 1 asks for that and
     the rest follows: the first ring bonus (2-5), how many skills it makes
     available and how many a player picks (2-7), how many starting techniques
     (2-8), the outfit (2-11), and which ability and mastery templates are
     open to it (2-4, 2-10, both of which also carry "Any" templates).

     Two steps carry rules a tool can hold, and it holds them:

       step 6  rituals plus two other common categories. ninjutsu and mahō are
               "exceptionally rare and should only be given in unique cases",
               so they are offered but marked; a heretical school "might lack
               rituals", so rituals can be dropped, also marked.
       step 7  ranks 1-5 each hold exactly seven advances — one skill group,
               three skills, one technique group, two techniques — and the
               three skills "should not be from the skill group selected for
               that rank", which is checked per rank. Rank 6 is the mastery
               ability and nothing else. */

  var SCHOOLBUILD = window.L5R_SCHOOLBUILD ||
    { steps: [], roles: [], tables: {}, technique_access: {}, curriculum: {} };

  function isSchool() { return (activeDraft() || {}).kind === "school"; }
  function activeSchool() { return (activeChar() || {}).school_build || null; }

  function newSchoolBuild() {
    return { name: "", roles: [], affiliation: "", summary: "",
             ability: { template: null, text: "", choice: "" },
             rings: { first: "", second: "", known_for: "" },
             skills: [], access: ["Rituals"], starting: [],
             curriculum: [], mastery: { template: null, text: "" },
             outfit: { clothing: "", weapons: "", other: "" },
             notes: "" };
  }

  function openSchoolBuild(asked) {
    if (!asked && !confirm(
          "Build a school?\n\nNine steps: a role, its affiliations, a school " +
          "ability, ring bonuses, skills, technique access, a five-rank " +
          "curriculum with a mastery ability, an outfit, and a name.")) return;
    var id = newId();
    var c = newCharacter();
    c.school_build = newSchoolBuild();
    STORE.drafts[id] = { id: id, updated: Date.now(), kind: "school",
                         character: c };
    switchDraft(id);
  }

  function sbTable(key) {
    var t = SCHOOLBUILD.tables[key];
    return t ? t.entries || [] : [];
  }

  /* The row of a role-keyed table that applies to this school's primary role.
     Two of the tables key by a role pair as the book writes it ("Courtier or
     Shinobi"), so a row matches when it names the role anywhere. */
  function sbForRole(key, role) {
    if (!role) return null;
    var rows = sbTable(key);
    return rows.filter(function (e) {
      return normName(e.name) === normName(role);
    })[0] || rows.filter(function (e) {
      return e.name.toLowerCase().indexOf(role.toLowerCase()) >= 0;
    })[0] || null;
  }

  function primaryRole() {
    var s = activeSchool();
    return (s && s.roles && s.roles[0]) || null;
  }

  // Templates a role may use: its own, plus every "Any".
  function sbTemplates(key, role) {
    return sbTable(key).filter(function (e) {
      var r = String(e.Role || e.role || "");
      return !role || /^any$/i.test(r) ||
             r.toLowerCase().indexOf(role.toLowerCase()) >= 0;
    });
  }

  // ---- step 1: role

  function renderSchoolRole(body) {
    var s = activeSchool();
    if (!s) return needs(body, "This draft has no school on it.");
    var note = document.createElement("p");
    note.className = "muted small";
    note.textContent = "Roles are listed in order of importance, the primary " +
      "first. Nearly everything after this follows from the primary role.";
    body.appendChild(note);

    (SCHOOLBUILD.roles || []).forEach(function (r) {
      var at = s.roles.indexOf(r.name);
      var card = document.createElement("div");
      card.className = "doc-card" + (at >= 0 ? " on" : "");
      var b = document.createElement("button");
      b.type = "button";
      b.className = "choice small" + (at >= 0 ? " active" : "");
      b.textContent = r.name + (at === 0 ? " · primary"
                                : at > 0 ? " · " + ordinal(at + 1) : "");
      b.addEventListener("click", function () {
        if (at >= 0) s.roles.splice(at, 1); else s.roles.push(r.name);
        save(); render();
      });
      card.appendChild(b);
      var d = document.createElement("div");
      d.className = "doc-body";
      d.textContent = r.Description || r.description || "";
      card.appendChild(d);
      body.appendChild(card);
    });

    if (s.roles.length > 1) {
      var row = document.createElement("p");
      row.className = "muted small";
      row.textContent = "In order: " + s.roles.join(", ") + ". Clear and " +
        "re-pick to reorder — the first is the primary.";
      body.appendChild(row);
    }
  }

  function ordinal(n) {
    return n === 2 ? "secondary" : n === 3 ? "tertiary" : n + "th";
  }

  // ---- step 2: affiliations and summary

  function renderSchoolAffiliation(body) {
    var s = activeSchool();
    if (!s) return needs(body, "This draft has no school on it.");
    var note = document.createElement("p");
    note.className = "muted small";
    note.textContent = "A school is usually tied to a Great Clan, but need " +
      "not be — a minor clan, a monastic order, a gaijin tradition, or none " +
      "at all.";
    body.appendChild(note);
    label(body, "Affiliation");
    var pick = document.createElement("select");
    pick.className = "trait-sel";
    pick.innerHTML = '<option value="">— none, or typed below —</option>' +
      CLANS.map(function (c) {
        return '<option value="' + esc(c.clan_short_name || c.name) + '"' +
          (s.affiliation === (c.clan_short_name || c.name) ? " selected" : "") +
          ">" + esc(c.name) + "</option>";
      }).join("");
    pick.addEventListener("change", function () {
      s.affiliation = pick.value; save(); render();
    });
    body.appendChild(pick);
    textField(body, "…or an affiliation of its own",
              function () { return s.affiliation; },
              function (v) { s.affiliation = v; });
    label(body, "Summary");
    textField(body, "What the school teaches, and what it is for.",
              function () { return s.summary; },
              function (v) { s.summary = v; }, "area");
  }

  // ---- step 3: school ability

  function renderSchoolAbility(body) {
    var s = activeSchool();
    if (!s) return needs(body, "This draft has no school on it.");
    var role = primaryRole();
    if (!role) return needs(body, "Choose a role first.");
    var note = document.createElement("p");
    note.className = "muted small";
    note.textContent = "The most critical element of a school's design. Take " +
      "a template and fill in what it asks you to choose, or write one.";
    body.appendChild(note);

    sbTemplates("table24genericschoolabilities", role).forEach(function (t) {
      var on = s.ability.template === t.name;
      var card = document.createElement("div");
      card.className = "doc-card" + (on ? " on" : "");
      var b = document.createElement("button");
      b.type = "button";
      b.className = "choice small" + (on ? " active" : "");
      b.textContent = t.name.replace(/^School Ability /, "") +
                      " · " + (t.Role || "Any");
      b.addEventListener("click", function () {
        s.ability.template = on ? null : t.name;
        if (!on) s.ability.text = t["Ability Template"] || "";
        save(); render();
      });
      card.appendChild(b);
      var d = document.createElement("div");
      d.className = "doc-body";
      d.textContent = t["Ability Template"] || "";
      card.appendChild(d);
      body.appendChild(card);
    });

    if (s.ability.template) {
      label(body, "What this template asks you to choose");
      textField(body, "The skill group, skill, weapon type, action type or " +
                "keyword the template names",
                function () { return s.ability.choice; },
                function (v) { s.ability.choice = v; });
    }
    label(body, "The ability as the school states it");
    textField(body, "The template's wording with your choice filled in, or " +
              "an ability of your own.",
              function () { return s.ability.text; },
              function (v) { s.ability.text = v; }, "area");
  }

  // ---- step 4: ring bonuses

  function renderSchoolRings(body) {
    var s = activeSchool();
    if (!s) return needs(body, "This draft has no school on it.");
    var role = primaryRole();
    var sug = sbForRole("table25suggestedfirstringbonuses", role);
    if (sug) {
      var p = document.createElement("p");
      p.className = "muted small";
      p.innerHTML = "For a <strong>" + esc(sug.name) + "</strong> school the " +
        "book suggests <strong>" + esc(sug["Ring Increase"]) +
        "</strong> as the first increase.";
      body.appendChild(p);
    }
    label(body, "First ring increase");
    ringRow(body, function () { return s.rings.first; },
            function (v) { s.rings.first = v; });

    label(body, "What the school is known for");
    var known = sbTable("table26suggestedsecondringbonus");
    known.forEach(function (e) {
      var on = s.rings.known_for === e.name;
      var row = document.createElement("div");
      row.className = "merc-row" + (on ? " on" : "");
      var b = document.createElement("button");
      b.type = "button";
      b.className = "choice small" + (on ? " active" : "");
      b.textContent = e.name;
      b.addEventListener("click", function () {
        s.rings.known_for = on ? "" : e.name;
        // Table 2-6 is keyed by the ring's printed name ("Water"); a ring is
        // held everywhere else on the site as its lowercase key, and mixing
        // the two printed "air / Water" on the same line
        if (!on) s.rings.second = e.name.toLowerCase();
        save(); render();
      });
      row.appendChild(b);
      var d = document.createElement("span");
      d.className = "muted small";
      d.textContent = e["Trait School Is Known For"] || "";
      row.appendChild(d);
      body.appendChild(row);
    });

    label(body, "Second ring increase");
    ringRow(body, function () { return s.rings.second; },
            function (v) { s.rings.second = v; });
    if (s.rings.first && s.rings.first === s.rings.second) {
      var w = document.createElement("p");
      w.className = "muted small warn";
      w.textContent = "Both increases raise " + cap(s.rings.first) +
        ". Allowed, but it makes a school with one very tall ring and four short.";
      body.appendChild(w);
    }
  }

  function ringRow(body, get, set) {
    var row = document.createElement("div");
    row.className = "need-row";
    row.innerHTML = '<span class="need-k">Ring</span>' +
      RINGS.map(function (r) {
        return '<button type="button" class="choice small' +
          (get() === r ? " active" : "") + '" data-v="' + r + '">' +
          cap(r) + "</button>";
      }).join("");
    row.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-v]");
      if (!b) return;
      set(get() === b.dataset.v ? "" : b.dataset.v);
      save(); render();
    });
    body.appendChild(row);
  }

  // ---- step 5: skills

  function renderSchoolSkills(body) {
    var s = activeSchool();
    if (!s) return needs(body, "This draft has no school on it.");
    var role = primaryRole();
    var t = sbForRole("table27skillchoices", role);
    if (!t) return needs(body, "Choose a role first.");
    var avail = Number(t["Skills Available"]) || 0;
    var picks = Number(t["Skill Picks"]) || 0;

    var p = document.createElement("p");
    p.className = "muted small";
    p.innerHTML = "A <strong>" + esc(t.name) + "</strong> school makes " +
      "<strong>" + avail + "</strong> skills available, of which a player " +
      "picks <strong>" + picks + "</strong>. The book's common list for the " +
      "role: " + esc(t["Common Skills Available"] || "—") + ".";
    body.appendChild(p);

    label(body, "The skills this school makes available");
    var common = String(t["Common Skills Available"] || "").split(/,\s*/)
      .filter(Boolean);
    var row = document.createElement("div");
    row.className = "need-row wrapped";
    row.innerHTML = '<span class="need-k">Common</span>' +
      common.map(function (sk) {
        return '<button type="button" class="choice small' +
          (s.skills.indexOf(sk) >= 0 ? " active" : "") + '" data-v="' +
          esc(sk) + '">' + esc(sk) + "</button>";
      }).join("");
    row.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-v]");
      if (!b) return;
      var at = s.skills.indexOf(b.dataset.v);
      if (at >= 0) s.skills.splice(at, 1); else s.skills.push(b.dataset.v);
      save(); render();
    });
    body.appendChild(row);

    label(body, "…or any other skill");
    skillPicker(body, null, function (sk) {
      var lbl = SKILL_LABEL[sk] || cap(sk);
      if (s.skills.indexOf(lbl) < 0) s.skills.push(lbl);
      save(); render();
    });

    var have = document.createElement("p");
    have.className = "muted small" + (s.skills.length === avail ? "" : " warn");
    have.textContent = s.skills.length + " of " + avail + " available: " +
      (s.skills.join(", ") || "none yet") +
      (s.skills.length === avail ? "."
       : s.skills.length > avail
         ? " — " + (s.skills.length - avail) + " more than the role allows."
         : " — " + (avail - s.skills.length) + " still to name.");
    body.appendChild(have);
  }

  // ---- step 6: technique access and starting techniques

  function renderSchoolTechniques(body) {
    var s = activeSchool();
    if (!s) return needs(body, "This draft has no school on it.");
    var role = primaryRole();
    var acc = SCHOOLBUILD.technique_access || {};
    var t8 = sbForRole("table28startingtechniques", role);

    var p = document.createElement("p");
    p.className = "muted small";
    p.textContent = "Open access means a member may buy any technique in that " +
      "category, prerequisites permitting. Most schools have rituals plus two " +
      "of the common categories.";
    body.appendChild(p);

    label(body, "Open access");
    var all = (acc["default"] || []).concat(acc.common || [], acc.rare || []);
    var row = document.createElement("div");
    row.className = "need-row wrapped";
    row.innerHTML = '<span class="need-k">Categories</span>' +
      all.map(function (c) {
        var on = s.access.indexOf(c) >= 0;
        var rare = (acc.rare || []).indexOf(c) >= 0;
        return '<button type="button" class="choice small' +
          (on ? " active" : "") + (rare ? " over-cap" : "") +
          '" data-v="' + esc(c) + '"' +
          (rare ? ' title="' + esc("Exceptionally rare — only in unique cases") +
                  '"' : "") + ">" + esc(c) + "</button>";
      }).join("");
    row.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-v]");
      if (!b) return;
      var c = b.dataset.v, at = s.access.indexOf(c);
      if (at < 0 && (acc.rare || []).indexOf(c) >= 0 &&
          !confirm("Access to " + c + " is exceptionally rare, and should " +
                   "only be given in unique cases.\n\nNo reputable tradition " +
                   "would admit to teaching it.\n\nGive it anyway?")) return;
      if (at >= 0 && (acc["default"] || []).indexOf(c) >= 0 &&
          !confirm("Most schools have rituals. A school without them is " +
                   "heretical — fundamentally opposed to the Celestial " +
                   "Order.\n\nDrop rituals?")) return;
      if (at >= 0) s.access.splice(at, 1); else s.access.push(c);
      save(); render();
    });
    body.appendChild(row);

    var chosenCommon = s.access.filter(function (c) {
      return (acc.common || []).indexOf(c) >= 0;
    });
    var n = acc.choose_from_common || 2;
    var note = document.createElement("p");
    note.className = "muted small" + (chosenCommon.length === n ? "" : " warn");
    note.textContent = chosenCommon.length + " of " + n +
      " common categories beside rituals" +
      (chosenCommon.length === n ? "." : " — the book's shape is " + n + ".");
    body.appendChild(note);

    if (t8) {
      label(body, "Starting techniques");
      var sp = document.createElement("p");
      sp.className = "muted small";
      sp.innerHTML = "A <strong>" + esc(t8.name) + "</strong> school gives " +
        "<strong>" + esc(String(t8["Number of Starting Techniques"])) +
        "</strong>, known at rank 1 without spending experience.";
      body.appendChild(sp);
      s.starting.forEach(function (tn, i) {
        var r = document.createElement("div");
        r.className = "mod-row";
        var f = document.createElement("input");
        f.type = "text";
        f.value = tn;
        f.addEventListener("change", function () {
          s.starting[i] = f.value.trim(); save();
        });
        var x = document.createElement("button");
        x.type = "button";
        x.className = "ar-x-btn";
        x.textContent = "×";
        x.addEventListener("click", function () {
          s.starting.splice(i, 1); save(); render();
        });
        r.appendChild(f);
        r.appendChild(document.createElement("span"));
        r.appendChild(x);
        body.appendChild(r);
      });
      var add = document.createElement("button");
      add.type = "button";
      add.className = "btn ghost";
      add.textContent = "+ Add a starting technique";
      add.addEventListener("click", function () {
        s.starting.push(""); save(); render();
      });
      body.appendChild(add);
    }
  }

  // ---- step 7: curriculum and mastery

  function sbRank(i) {
    var s = activeSchool();
    s.curriculum = s.curriculum || [];
    while (s.curriculum.length < 5) {
      s.curriculum.push({ skill_group: "", skills: ["", "", ""],
                          technique_group: "", techniques: ["", ""] });
    }
    return s.curriculum[i];
  }

  /* The corpus's one restriction on a rank: "skills selected should not be
     from the skill group selected for that rank". The groups are the skill
     categories the site already knows, so membership is a lookup rather than
     a list to maintain here. */
  function skillsInGroup(group) {
    // SKILL_GROUPS is group -> skill keys; the curriculum names a group as the
    // book writes it ("Martial Skills"), so the trailing word is dropped
    var g = normName(group).replace(/skills?$/, "");
    var keys = SKILL_GROUPS[g] || [];
    return keys.map(function (k) { return SKILL_LABEL[k] || k; });
  }

  // The group names as the book writes them, from the groups the site knows.
  function sbSkillGroups() {
    return Object.keys(SKILL_GROUPS).map(function (g) {
      return cap(g) + " Skills";
    });
  }

  function rankClash(r) {
    if (!r.skill_group) return [];
    var inGroup = skillsInGroup(r.skill_group).map(normName);
    return (r.skills || []).filter(function (sk) {
      return sk && inGroup.indexOf(normName(sk)) >= 0;
    });
  }

  function renderSchoolCurriculum(body) {
    var s = activeSchool();
    if (!s) return needs(body, "This draft has no school on it.");
    var cur = SCHOOLBUILD.curriculum || {};
    var p = document.createElement("p");
    p.className = "muted small";
    p.textContent = "Ranks 1 to 5 hold the same seven advances each: one " +
      "skill group, three skills, one technique group, two techniques. The " +
      "three skills should not come from that rank's own skill group. Rank " +
      (cur.mastery_rank || 6) + " is the mastery ability and nothing else.";
    body.appendChild(p);

    for (var i = 0; i < (cur.ranks || 5); i++) {
      (function (i) {
        var r = sbRank(i);
        var card = document.createElement("div");
        card.className = "npc-card";
        var head = document.createElement("div");
        head.className = "npc-head";
        var filled = (r.skill_group ? 1 : 0) +
          (r.skills || []).filter(Boolean).length +
          (r.technique_group ? 1 : 0) +
          (r.techniques || []).filter(Boolean).length;
        head.innerHTML = '<span class="npc-tier">Rank ' + (i + 1) + "</span>" +
          '<span class="npc-name">' + filled + " of 7</span>";
        card.appendChild(head);

        var gl = document.createElement("div");
        gl.className = "need-row wrapped";
        gl.innerHTML = '<span class="need-k">Skill group</span>' +
          sbSkillGroups().map(function (g) {
            return '<button type="button" class="choice small' +
              (normName(r.skill_group) === normName(g) ? " active" : "") +
              '" data-v="' + esc(g) + '">' + esc(g) + "</button>";
          }).join("");
        gl.addEventListener("click", function (e) {
          var b = e.target.closest("button[data-v]");
          if (!b) return;
          r.skill_group = normName(r.skill_group) === normName(b.dataset.v)
            ? "" : b.dataset.v;
          save(); render();
        });
        card.appendChild(gl);

        [0, 1, 2].forEach(function (k) {
          var f = document.createElement("input");
          f.type = "text";
          f.className = "textline";
          f.placeholder = "Skill " + (k + 1);
          f.value = (r.skills || [])[k] || "";
          f.addEventListener("change", function () {
            r.skills[k] = f.value.trim(); save(); render();
          });
          card.appendChild(f);
        });

        var clash = rankClash(r);
        if (clash.length) {
          var w = document.createElement("p");
          w.className = "muted small warn";
          w.textContent = clash.join(", ") +
            (clash.length === 1 ? " is" : " are") + " in " + r.skill_group +
            ", this rank's own skill group — the book says the three skills " +
            "should come from outside it.";
          card.appendChild(w);
        }

        var tf = document.createElement("input");
        tf.type = "text";
        tf.className = "textline";
        tf.placeholder = "Technique group — e.g. Rank " + (i + 1) + " Shūji";
        tf.value = r.technique_group || "";
        tf.addEventListener("change", function () {
          r.technique_group = tf.value.trim(); save(); render();
        });
        card.appendChild(tf);

        [0, 1].forEach(function (k) {
          var f = document.createElement("input");
          f.type = "text";
          f.className = "textline";
          f.placeholder = "Technique " + (k + 1);
          f.value = (r.techniques || [])[k] || "";
          f.addEventListener("change", function () {
            r.techniques[k] = f.value.trim(); save(); render();
          });
          card.appendChild(f);
        });
        body.appendChild(card);
      })(i);
    }

    label(body, "Rank " + (cur.mastery_rank || 6) + ": the mastery ability");
    var mnote = document.createElement("p");
    mnote.className = "muted small";
    mnote.textContent = "Powerful and awe-inspiring, and something to aspire " +
      "to. Purely narrative is fine; the templates below are for the more " +
      "mechanical kind.";
    body.appendChild(mnote);
    sbTemplates("table210genericmasteryabilities", primaryRole())
      .forEach(function (t) {
        var on = s.mastery.template === t.name;
        var card = document.createElement("div");
        card.className = "doc-card" + (on ? " on" : "");
        var b = document.createElement("button");
        b.type = "button";
        b.className = "choice small" + (on ? " active" : "");
        b.textContent = t.name.replace(/^Mastery Ability /, "") +
                        " · " + (t.Role || "Any");
        b.addEventListener("click", function () {
          s.mastery.template = on ? null : t.name;
          if (!on) s.mastery.text = t["Ability Template"] || "";
          save(); render();
        });
        card.appendChild(b);
        var d = document.createElement("div");
        d.className = "doc-body";
        d.textContent = t["Ability Template"] || "";
        card.appendChild(d);
        body.appendChild(card);
      });
    label(body, "The mastery ability as the school states it");
    textField(body, "Its wording, with anything the template asks you to " +
              "choose filled in.",
              function () { return s.mastery.text; },
              function (v) { s.mastery.text = v; }, "area");
  }

  // ---- step 8: outfit

  function renderSchoolOutfit(body) {
    var s = activeSchool();
    if (!s) return needs(body, "This draft has no school on it.");
    var t = sbForRole("table211suggestedstartingoutfits", primaryRole());
    if (t) {
      var d = document.createElement("div");
      d.className = "tpl-detail";
      d.innerHTML = "<strong>" + esc(t.name) + ", as the book suggests" +
        "</strong>" +
        ["Clothing and Armor", "Weapons", "Other Gear"].map(function (k) {
          return t[k] ? '<div><span class="tk">' + esc(k) + "</span> " +
            esc(t[k]) + "</div>" : "";
        }).join("");
      body.appendChild(d);
      var take = document.createElement("button");
      take.type = "button";
      take.className = "btn ghost";
      take.textContent = "Take the suggested outfit";
      take.addEventListener("click", function () {
        s.outfit = { clothing: t["Clothing and Armor"] || "",
                     weapons: t.Weapons || "",
                     other: t["Other Gear"] || "" };
        save(); render();
      });
      body.appendChild(take);
    }
    label(body, "Clothing and armour");
    textField(body, "", function () { return s.outfit.clothing; },
              function (v) { s.outfit.clothing = v; });
    label(body, "Weapons");
    textField(body, "", function () { return s.outfit.weapons; },
              function (v) { s.outfit.weapons = v; });
    label(body, "Other gear");
    textField(body, "", function () { return s.outfit.other; },
              function (v) { s.outfit.other = v; });
  }

  // ---- step 9: name

  function renderSchoolName(body) {
    var s = activeSchool();
    if (!s) return needs(body, "This draft has no school on it.");
    var p = document.createElement("p");
    p.className = "muted small";
    p.textContent = "The name comes last, with the school in front of you. " +
      "Its roles are listed after it, primary first.";
    body.appendChild(p);
    label(body, "Name");
    textField(body, "Asahina Artificer School", function () { return s.name; },
              function (v) { s.name = v; });
    if (s.name) {
      var line = document.createElement("p");
      line.className = "muted small";
      line.textContent = s.name +
        (s.roles.length ? " [" + s.roles.join(", ") + "]" : "");
      body.appendChild(line);
    }
    label(body, "Anything else worth recording");
    textField(body, "", function () { return s.notes; },
              function (v) { s.notes = v; }, "area");
  }

  // ---- what the school hands to scripts/apply_school.py

  function toSchoolPatch() {
    var s = activeSchool() || newSchoolBuild();
    var role = primaryRole();
    var t7 = sbForRole("table27skillchoices", role);
    var t8 = sbForRole("table28startingtechniques", role);
    return {
      school: slugify(s.name || "a-school"),
      name: s.name || null,
      roles: (s.roles || []).slice(),
      primary_role: role,
      affiliation: s.affiliation || null,
      summary: s.summary || "",
      ability: { from_template: s.ability.template,
                 choice: s.ability.choice || null,
                 text: s.ability.text || "" },
      rings: { first: s.rings.first || null, second: s.rings.second || null,
               known_for: s.rings.known_for || null },
      skills_available: (s.skills || []).slice(),
      // the figures the role's own row states, so the applier can check the
      // count without re-deriving which row applies
      skills_available_n: t7 ? Number(t7["Skills Available"]) : null,
      skill_picks: t7 ? Number(t7["Skill Picks"]) : null,
      technique_access: (s.access || []).slice(),
      starting_techniques: (s.starting || []).filter(Boolean),
      starting_techniques_n: t8 ? t8["Number of Starting Techniques"] : null,
      curriculum: (s.curriculum || []).slice(0, 5).map(function (r, i) {
        return { rank: i + 1, skill_group: r.skill_group || null,
                 skills: (r.skills || []).filter(Boolean),
                 technique_group: r.technique_group || null,
                 techniques: (r.techniques || []).filter(Boolean),
                 skills_in_own_group: rankClash(r) };
      }),
      mastery: { from_template: s.mastery.template,
                 text: s.mastery.text || "" },
      outfit: { clothing: s.outfit.clothing || "",
                weapons: s.outfit.weapons || "",
                other: s.outfit.other || "" },
      notes: s.notes || ""
    };
  }

  function renderSchoolSave(body) {
    var doc = toSchoolPatch();
    var open = activeSteps().filter(function (x) {
      return x.id !== "school-save" && !x.done();
    }).map(function (x) { return x.n + ". " + x.label; });
    var head = document.createElement("p");
    head.className = "muted small";
    head.innerHTML = "<strong>" + esc(doc.name || "An unnamed school") +
      "</strong>" + (doc.roles.length
        ? " [" + esc(doc.roles.join(", ")) + "]" : "") +
      " — " + doc.skills_available.length + " skills, " +
      doc.technique_access.length + " technique categories, " +
      doc.curriculum.filter(function (r) {
        return r.skill_group && r.skills.length === 3 &&
               r.technique_group && r.techniques.length === 2;
      }).length + " of 5 ranks complete.";
    body.appendChild(head);
    if (open.length) {
      var w = document.createElement("p");
      w.className = "muted small warn";
      w.textContent = "Steps still open: " + open.join(", ") + ".";
      body.appendChild(w);
    }
    var row = document.createElement("div");
    row.className = "choicerow";
    row.innerHTML = '<button type="button" class="btn" id="dl">Download</button>' +
      '<button type="button" class="btn" id="cp">Copy</button>';
    body.appendChild(row);
    var how = document.createElement("p");
    how.className = "muted small";
    how.innerHTML = "Then: <code>python3 scripts/apply_school.py " +
      esc(doc.school) + "</code> — it writes <code>src/schools/" +
      esc(doc.school) + ".json</code> and checks it against the corpus's own " +
      "figures first. Nothing is written without <code>--apply</code>.";
    body.appendChild(how);
    var pre = document.createElement("pre");
    pre.className = "export-json";
    pre.textContent = JSON.stringify(doc, null, 1);
    body.appendChild(pre);
    row.querySelector("#dl").addEventListener("click", function () {
      var blob = new Blob([JSON.stringify(doc, null, 1)],
                          { type: "application/json" });
      var n = document.createElement("a");
      n.href = URL.createObjectURL(blob);
      n.download = doc.school + "-school.json";
      document.body.appendChild(n); n.click(); n.remove();
      setTimeout(function () { URL.revokeObjectURL(n.href); }, 1000);
    });
    row.querySelector("#cp").addEventListener("click", function () {
      navigator.clipboard.writeText(JSON.stringify(doc, null, 1));
    });
  }

  var SCHOOL_STEPS = [
    { id: "school-role", n: 1, label: "Role", title: "Determine school role",
      desc: "One or more, primary first. Nearly everything after this follows " +
        "from the primary role.",
      done: function () {
        var s = activeSchool();
        return !!(s && s.roles && s.roles.length);
      },
      render: renderSchoolRole },
    { id: "school-affiliation", n: 2, label: "Affiliation",
      title: "Choose affiliations and summary",
      desc: "Who the school answers to, if anyone, and what it is for.",
      done: function () {
        var s = activeSchool();
        return !!(s && s.summary);
      },
      render: renderSchoolAffiliation },
    { id: "school-ability", n: 3, label: "Ability", title: "Design school ability",
      desc: "The most critical element of a school's design.",
      done: function () {
        var s = activeSchool();
        return !!(s && s.ability && s.ability.text);
      },
      render: renderSchoolAbility },
    { id: "school-rings", n: 4, label: "Rings", title: "Ring bonuses",
      desc: "Two increases: one from the role, one from what the school is " +
        "known for.",
      done: function () {
        var s = activeSchool();
        return !!(s && s.rings.first && s.rings.second);
      },
      render: renderSchoolRings },
    { id: "school-skills", n: 5, label: "Skills", title: "Choosing skills",
      desc: "As many as the role makes available; the player picks from among " +
        "them at character creation.",
      done: function () {
        var s = activeSchool();
        var t = sbForRole("table27skillchoices", primaryRole());
        return !!(s && t && s.skills.length === Number(t["Skills Available"]));
      },
      render: renderSchoolSkills },
    { id: "school-techniques", n: 6, label: "Techniques",
      title: "Technique access and starting techniques",
      desc: "Rituals plus two common categories, and the techniques members " +
        "know at rank 1 for free.",
      done: function () {
        var s = activeSchool();
        if (!s) return false;
        var acc = SCHOOLBUILD.technique_access || {};
        var common = s.access.filter(function (c) {
          return (acc.common || []).indexOf(c) >= 0;
        });
        return common.length === (acc.choose_from_common || 2) &&
               s.starting.filter(Boolean).length > 0;
      },
      render: renderSchoolTechniques },
    { id: "school-curriculum", n: 7, label: "Curriculum",
      title: "Curriculum and mastery ability",
      desc: "Five ranks of seven advances each, then the mastery ability at " +
        "rank six.",
      done: function () {
        var s = activeSchool();
        if (!s || (s.curriculum || []).length < 5) return false;
        return s.curriculum.slice(0, 5).every(function (r) {
          return r.skill_group && (r.skills || []).filter(Boolean).length === 3 &&
                 r.technique_group &&
                 (r.techniques || []).filter(Boolean).length === 2;
        }) && !!s.mastery.text;
      },
      render: renderSchoolCurriculum },
    { id: "school-outfit", n: 8, label: "Outfit", title: "Starting outfit",
      desc: "What a member of the school walks out with.",
      done: function () {
        var s = activeSchool();
        return !!(s && (s.outfit.clothing || s.outfit.weapons ||
                        s.outfit.other));
      },
      render: renderSchoolOutfit },
    { id: "school-name", n: 9, label: "Name", title: "Name the school",
      desc: "Last, with the school in front of you.",
      done: function () {
        var s = activeSchool();
        return !!(s && s.name);
      },
      render: renderSchoolName },
    { id: "school-save", n: 0, label: "Save", title: "Keep the school",
      desc: "Written to src/schools/, checked against the corpus's own " +
        "figures for the role first.",
      done: function () { return false; },
      render: renderSchoolSave }
  ];

  function renderSchoolWip() {
    var s = activeSchool();
    var box = el("wip");
    if (!s) { box.innerHTML = ""; return; }
    var t7 = sbForRole("table27skillchoices", primaryRole());
    var done = (s.curriculum || []).slice(0, 5).filter(function (r) {
      return r.skill_group && (r.skills || []).filter(Boolean).length === 3 &&
             r.technique_group && (r.techniques || []).filter(Boolean).length === 2;
    }).length;
    function line(k, v) {
      return '<div class="wip-npc"><span class="wn">' + esc(String(v)) +
        '</span><span class="wr">' + esc(k) + "</span></div>";
    }
    box.innerHTML =
      '<h3 class="wip-name">' + esc(s.name || "An unnamed school") + "</h3>" +
      '<p class="muted small">' +
        (s.roles.length ? esc(s.roles.join(", ")) : "no role yet") +
        (s.affiliation ? " · " + esc(s.affiliation) : "") + "</p>" +
      line("rings", (s.rings.first ? cap(s.rings.first) : "—") + " / " +
                    (s.rings.second ? cap(s.rings.second) : "—")) +
      line("skills available", s.skills.length +
           (t7 ? " / " + t7["Skills Available"] : "")) +
      line("technique access", s.access.join(", ") || "—") +
      line("starting techniques", s.starting.filter(Boolean).length) +
      line("ranks complete", done + " / 5") +
      (s.ability.text ? '<h4 class="wip-h">School ability</h4>' +
        '<p class="muted small">' + esc(s.ability.text.slice(0, 160)) +
        (s.ability.text.length > 160 ? "…" : "") + "</p>" : "") +
      (s.mastery.text ? '<h4 class="wip-h">Mastery</h4>' +
        '<p class="muted small">' + esc(s.mastery.text.slice(0, 160)) +
        (s.mastery.text.length > 160 ? "…" : "") + "</p>" : "");
  }

  /* ---------------------------------------------------------- shell */

  // Path of Waves and Writ of the Wilds characters have no clan, so the
  // clan-relationship question is dropped rather than asked emptily.
  /* Which set of steps is in play. An advance is not the Game of Twenty
     Questions — it is a ledger and a save — so it has its own two. */
  function steps() {
    if (isAdvance()) return ADVANCE_STEPS;
    if (isLegacy()) return LEGACY_STEPS;
    if (isCourt()) return COURT_STEPS;
    if (isArmy()) return ARMY_STEPS;
    if (isSchool()) return SCHOOL_STEPS;
    return STEPS;
  }

  function activeSteps() {
    return steps().filter(function (s) {
      return !(s.id === "clan-tie" && !isCore());
    });
  }

  function renderNav() {
    el("steps").innerHTML = steps().map(function (s, i) {
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
    var t = TECH_TEXT[normName(name)] || GEAR_TEXT[normName(name)];
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
    var out = [];
    if (sch) {
      (sch.starting_techniques || []).forEach(function (g, i) {
        if (g.kind === "fixed" && g.name) out.push(g.name);
        else if (g.kind === "choose") out = out.concat(chosen("school.tech." + i));
      });
      if (sch.school_ability) out.push(sch.school_ability);
    }
    // Stolen Knowledge, Knowledge Exchange and Spirit Companion each teach one
    // technique from outside the school, and say it may be performed anyway.
    out = out.concat(heritageGrants().techniques);
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
      [14, "Aesthetic accoutrement", a.accoutrement],
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

  /* The panel beside an advance shows where the character is now, not what
     twenty questions would build — C is only hydrated here to carry the name
     and the school, and computed() would report a 0 XP derivation of a
     character who is at 279. */
  function renderAdvanceWip() {
    var st = advanceState();
    var a = activeAdvance();
    if (!st) return;
    var ring = RING_NAMES.map(function (n) {
      var k = n.toLowerCase();
      var was = (a.from.rings || {})[k] || 0;
      return '<div class="ring' + (st.rings[k] > was ? " up" : "") +
        '" data-ring="' + k + '"><div class="rn">' + n + "</div>" +
        '<div class="rv">' + (st.rings[k] || 0) + "</div></div>";
    }).join("");
    var skills = Object.keys(st.skills).filter(function (k) { return st.skills[k]; })
      .sort().map(function (k) {
        var was = flatten(a.from.skills)[k] || 0;
        return '<div class="skill' + (st.skills[k] > was ? " up" : "") +
          '"><span class="sn">' + esc(SKILL_LABEL[k] || cap(k)) +
          '</span><span class="sv">' + st.skills[k] + "</span></div>";
      }).join("") || '<p class="muted small">No skills.</p>';
    el("wip").innerHTML =
      '<h3 class="wip-name">' + esc(C.name || a.slug) + "</h3>" +
      '<p class="wip-sub">' + esc([C.clan, C.family, a.from.school]
        .filter(Boolean).join(" · ")) + "</p>" +
      '<p class="wip-editing">Advancing from ' + (a.from.xp || 0) + " XP" +
      (a.from.label ? " · " + esc(a.from.label) : "") + "</p>" +
      '<div class="rings">' + ring + "</div>" +
      '<div class="statrow">' +
      ['<div class="stat"><span class="k">XP</span><span class="v">' +
         ((a.from.xp || 0) + st.spent) + "</span></div>",
       '<div class="stat"><span class="k">Rank</span><span class="v">' +
         st.rank + "</span></div>",
       '<div class="stat"><span class="k">Curriculum</span><span class="v">' +
         st.curXp + (st.threshold ? "/" + st.threshold : "") + "</span></div>",
       '<div class="stat"><span class="k">Left</span><span class="v">' +
         st.remaining + "</span></div>"].join("") + "</div>" +
      '<h4 class="field-label">Skills</h4><div class="wip-skills">' + skills +
      "</div>" +
      (st.titles.length
        ? '<h4 class="field-label">Titles</h4>' + chipRow(st.titles) : "") +
      (st.bonds.length
        ? '<h4 class="field-label">Bonds</h4>' + chipRow(st.bonds) : "") +
      (st.patterns.length
        ? '<h4 class="field-label">Item patterns</h4>' + chipRow(st.patterns)
        : "") +
      (st.techniques.length
        ? '<h4 class="field-label">Techniques<span class="wa-n">' +
          st.techniques.length + "</span></h4>" +
          chipRow(st.techniques, "tech")
        : "");
    wireWipTips();
  }

  function renderLegacyWip() {
    var l = activeLegacy();
    if (!l) return;
    var t = l.template ? LEGACY.templates[l.template] : null;
    var st = t ? legacyStatus(t, l.from) : null;
    el("wip").innerHTML =
      '<h3 class="wip-name">' + esc(l.name || "Unnamed Legacy") + "</h3>" +
      '<p class="wip-sub">left by ' + esc(l.predecessor_name) + "</p>" +
      '<p class="wip-editing">' +
        (t ? esc(t.name) + " · " + esc(t.ring || "")
           : "written for this predecessor") + "</p>" +
      '<div class="statrow">' +
      ['<div class="stat"><span class="k">Honor</span><span class="v">' +
         ((l.from.social || {}).honor) + "</span></div>",
       '<div class="stat"><span class="k">Glory</span><span class="v">' +
         ((l.from.social || {}).glory) + "</span></div>",
       '<div class="stat"><span class="k">Status</span><span class="v">' +
         ((l.from.social || {}).status) + "</span></div>",
       '<div class="stat"><span class="k">XP</span><span class="v">' +
         (l.from.xp || 0) + "</span></div>"].join("") + "</div>" +
      (st ? '<p class="muted small">' + esc(st.why) + "</p>" : "");
  }

  function renderWip() {
    if (isLegacy()) return renderLegacyWip();
    if (isAdvance()) return renderAdvanceWip();
    if (isCourt()) return renderCourtWip();
    if (isArmy()) return renderArmyWip();
    if (isSchool()) return renderSchoolWip();
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
    // Everything the character carries: the item question 16 buys, and whatever
    // the heritage handed over. Settled pieces used to be invisible here — only
    // the ones still to be defined were listed.
    var gear = (C.starting_item ? [{ name: C.starting_item, note: "" }] : [])
      .concat(heritageGrants().gear.filter(function (g) { return g.name; })
        .map(function (g) {
          return { name: g.name, note: g.note,
                   open: g.needs || g.custom,
                   held: g.held !== false };
        }));
    var answered = answeredQuestions();

    el("wip").innerHTML =
      '<h3 class="wip-name">' + esc(C.name || "Unnamed") + "</h3>" +
      '<p class="wip-sub">' +
      esc([C.clan, C.family, C.school].filter(Boolean).join(" · ") || "—") + "</p>" +
      // Which of the two things this is. An edit looks exactly like making a
      // character, and it is not one: there is a record behind it.
      (isEdit()
        ? '<p class="wip-editing">Editing <strong>' + esc(editSlug()) +
          "</strong>" + (activeDraft().proseOnly ? " · prose only" : "") + "</p>"
        : "") +
      '<div class="rings">' + ring + "</div>" +
      '<div class="statrow">' +
      ['<div class="stat"><span class="k">Honor</span><span class="v">' + d.honor + "</span></div>",
       '<div class="stat"><span class="k">Glory</span><span class="v">' + d.glory + "</span></div>",
       '<div class="stat"><span class="k">Status</span><span class="v">' + d.status + "</span></div>",
       '<div class="stat"><span class="k">Purse</span><span class="v">' +
         esc(d.coin_label) + "</span></div>"
      ].join("") + "</div>" +
      // Anything already past the creation cap, whatever put it there: a
      // choice the GM waved through, or fixed grants that stack past 3 with no
      // choice involved at all. Named rather than clamped, because the book's
      // remedy is to increase something else.
      (function () {
        var over = [];
        RINGS.forEach(function (r) {
          if (d.rings[r] > CREATION_CAP) over.push(cap(r) + " " + d.rings[r]);
        });
        Object.keys(d.skills).sort().forEach(function (k) {
          if (d.skills[k] > CREATION_CAP) {
            over.push((SKILL_LABEL[k] || cap(k)) + " " + d.skills[k]);
          }
        });
        return over.length
          ? '<p class="muted small wip-overcap">Past the creation cap of ' +
            CREATION_CAP + ": " + esc(over.join(", ")) +
            ". During character creation nothing may pass " + CREATION_CAP +
            " — the rule is to increase something else instead.</p>"
          : "";
      })() +
      (d.pending.length
        // a rōnin has no clan and no family; the question those choices came
        // from is a region and an upbringing instead
        ? '<p class="muted small wip-pending">Choices from your ' +
          (isCore() ? "clan, family or school" : "region, upbringing or school") +
          " still to resolve: " + d.pending.map(function (p) {
            if (p.type === "ring") return "a ring (" + p.opts.join("/") + ")";
            if (p.type === "swap") {
              return "the heritage's swap — " + cap(p.to) + " cannot be raised " +
                     "or " + cap(p.from) + " lowered from here";
            }
            if (p.type === "item") {
              return p.name + " from " + p.source + ", to record as gear";
            }
            return p.n + (p.n === 1 ? " skill" : " skills");
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
      // A piece a rule confers without naming it keeps its own marker, because
      // it is an open item: the character has it, and what it is has still to
      // be settled with the GM.
      (gear.length
        ? '<h4 class="field-label">Gear</h4>' +
          '<div class="tagrow">' + gear.map(function (g) {
            var why = [g.note, g.held ? "" : "Not in hand."].filter(Boolean).join(" ");
            return '<span class="chip' + (g.open ? " needs-def" : "") +
              (why || ruleTextFor(g.name) ? " has-tip" : "") +
              '" data-tip="' + esc(g.name) + '"' +
              (why ? ' data-why="' + esc(why) + '"' : "") + ">" +
              esc(g.name) + "</span>";
          }).join("") + "</div>"
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
    var s = steps()[step] || steps()[0];
    step = steps().indexOf(s);
    function val(x) { return typeof x === "function" ? x() : x; }
    // the twenty questions are Questions; a court's seven steps are Steps, and
    // a step numbered 0 is the one at the end that saves
    el("step-n").textContent = s.eyebrow ? s.eyebrow
      : s.n === 0 ? (isCourt() || isArmy() || isSchool() ? "Keep it" : "Begin")
      : (isCourt() || isArmy() || isSchool() ? "Step " : "Question ") + s.n;
    el("step-title").textContent = val(s.title);
    el("step-desc").innerHTML = val(s.desc);
    var body = el("step-body");
    body.innerHTML = "";
    s.render(body);
    el("prev").disabled = step === 0;
    el("next").disabled = step === steps().length - 1;
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
      if (step < steps().length - 1) goToStep(step + 1);
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
    pruneSuperseded();
    render();
    initSync();
    openFromQuery();
  }

  /* A deep link from a character's page: ?advance=<slug> or ?edit=<slug>.

     The two things anyone does with a finished character are on its own page
     now, and pressing one of them should land here on that character rather
     than on the drafts panel with instructions. If a draft for it is already
     open this switches to it; the confirm the panel asks is skipped, because
     following the link IS the answer to it.

     The query is cleared afterwards, so a reload does not re-ask and the
     browser's back button behaves. */
  function openFromQuery() {
    var q = {};
    String(location.search || "").replace(/^\?/, "").split("&")
      .forEach(function (pair) {
        var kv = pair.split("=");
        if (kv[0]) q[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || "");
      });
    // ?new=1 is the site's front-door link: start a fresh character rather
    // than resuming whichever draft happened to be open last.
    if (q["new"] || q.court || q.army || q.school) {
      if (history.replaceState) {
        history.replaceState(null, "", location.pathname + location.hash);
      }
      if (q.court) openCourt(true);
      else if (q.army) openArmy(true);
      else if (q.school) openSchoolBuild(true);
      else addDraft();
      return;
    }
    var slug = q.advance || q.edit || q.legacy;
    if (!slug) return;
    var a = ARCHIVE.filter(function (x) { return x.slug === slug; })[0];
    if (!a) {
      setStatus("no character called “" + slug + "” in the archive");
      return;
    }
    var kind = q.advance ? "advance" : q.legacy ? "legacy" : "edit";
    var open = Object.keys(STORE.drafts).filter(function (id) {
      return STORE.drafts[id].fromArchive === slug &&
             (STORE.drafts[id].kind || "draft") === kind;
    })[0];
    if (history.replaceState) {
      history.replaceState(null, "", location.pathname + location.hash);
    }
    if (open) { switchDraft(open); return; }
    if (kind === "advance") openAdvance(slug, true);
    else if (kind === "legacy") openLegacy(slug, true);
    else openArchiveDraft(slug, "edit", true);
  }

  function boot() { loadLocalKey(init); }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
