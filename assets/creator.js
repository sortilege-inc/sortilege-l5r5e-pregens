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

  var LS_DRAFT = "sortilege.l5r.creator.draft";
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
  var ROLL = (window.L5R_COVERAGE || {}).schools || [];

  // The chargen data and the compendium spell schools differently ("Asahina
  // Artificer" vs "Asahina Artificer School"). Everything downstream — the
  // build's school-roll gate, the coverage ledger — keys off the compendium
  // name, so resolve to it here and show that name in the picker too.
  var SCHOOL_ALIAS = {
    "isawatensai": "Isawai Tensai School",   // the compendium has the typo
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
  function byKind(kind) {
    return CATALOG.filter(function (e) {
      return e.sub_type === "peculiarity" && e.kind === kind;
    });
  }

  /* ---------------------------------------------------------- draft */

  function newCharacter() {
    return {
      name: "", clan: null, family: null, school: null, role: null,
      standout_ring: null,
      rings: { air: 1, earth: 1, fire: 1, water: 1, "void": 1 },
      skills: {},
      distinctions: [], adversities: [], passions: [], anxieties: [],
      bushido: { paramount: null, lesser: null, attitude: null, skill: null },
      answers: {
        giri: "", ninjo: "", standout_quality: "",
        clan_relationship: { path: null, skill: null, text: "" },
        mentor: { name: "", path: null, granted: null, skill: "", text: "" },
        first_impression: "", accoutrement: "", stress_reaction: "",
        relationships: "", parent_opinion: { description: "", skill: null },
        heritage: null, death: ""
      },
      starting_item: "", campaign: "", notes: ""
    };
  }

  var C = load() || newCharacter();
  var step = 0;

  function load() {
    try { return JSON.parse(localStorage.getItem(LS_DRAFT)); } catch (e) { return null; }
  }
  function save() {
    try { localStorage.setItem(LS_DRAFT, JSON.stringify(C)); } catch (e) { /* private mode */ }
    renderWip();
    renderNav();
  }

  /* ---------------------------------------------------------- AI */

  // Prompts are the dashboard's, kept word-for-word so both surfaces
  // suggest in the same register.
  var STYLE = 'Write in second person ("you"). No quotation marks. 1-2 sentences, ' +
    "under 120 characters. Match Rokugan's grave, considered, poetic register.";
  var PROMPTS = {
    giri: "You are helping create a character for Legend of the Five Rings 5th Edition, a samurai drama RPG set in the fantasy realm of Rokugan.\n\nWrite a single sentence describing this character's giri (duty/obligation to their lord). Giri is the character's sense of duty — what they must do even at personal cost. It should feel specific to their clan, school, and lord.\n\n" + STYLE,
    ninjo: "L5R 5e character creation. Write a single sentence describing this character's ninjō (personal desire). The ninjō should sit in tension with their giri — something the character wants for themselves that conflicts with their duty.\n\n" + STYLE,
    standout_quality: "L5R 5e character creation. Write a single sentence naming and briefly framing a standout quality (a memorable trait or moment) that earned this character their +1 ring increase. Be concrete and unmistakable.\n\n" + STYLE,
    clan_relationship: "L5R 5e character creation. Write a single sentence describing how this character carries — or resists — their clan's ideals. Be specific to the clan they belong to.\n\n" + STYLE,
    first_impression: "L5R 5e character creation. Write a single sentence describing how this character first appears to a stranger: their build, bearing, voice, dress, and a distinctive accoutrement they always carry. Concrete details.\n\n" + STYLE,
    stress_reaction: "L5R 5e character creation. Write a single sentence describing how this character reacts when pushed past their composure. Concrete, visible, in-character.\n\n" + STYLE,
    parent_opinion: "L5R 5e character creation. Write a single sentence as a parent or guardian's opinion of this character — what they're proud of, frustrated by, or worried about.\n\n" + STYLE,
    mentor_relationship: "L5R 5e character creation. Write a single sentence describing the relationship between this character and a mentor — what they were taught, and at what cost.\n\n" + STYLE,
    relationships: "L5R 5e character creation. Write a single sentence naming one or two people who matter to this character — a rival, an ally, a family member — and what stands between them.\n\n" + STYLE,
    death: "L5R 5e character creation. Write a single-sentence vision of this character's death — the meaningful ending they would not regret. Solemn, declarative, in their own voice. Not the death the GM must give them, but one the player invites.\n\n" + STYLE,
    "default": "L5R 5e character creation suggestion. " + STYLE
  };

  function aiKey() {
    try { return localStorage.getItem(LS_KEY) || null; } catch (e) { return null; }
  }
  function aiAvailable() { return !!aiKey(); }

  function characterContext() {
    var b = [];
    if (C.clan) b.push("Clan: " + C.clan);
    if (C.family) b.push("Family: " + C.family);
    if (C.school) b.push("School: " + C.school + (C.role ? " (" + C.role + ")" : ""));
    if (C.bushido.paramount) b.push("Paramount tenet: " + C.bushido.paramount);
    if (C.bushido.lesser) b.push("Lesser tenet: " + C.bushido.lesser);
    if (C.answers.giri) b.push("Giri: " + C.answers.giri);
    if (C.answers.ninjo) b.push("Ninjō: " + C.answers.ninjo);
    if (C.answers.standout_quality) b.push("Standout quality: " + C.answers.standout_quality);
    if (C.distinctions.length) b.push("Distinctions: " + C.distinctions.join(", "));
    if (C.adversities.length) b.push("Adversities: " + C.adversities.join(", "));
    return b.join("\n");
  }

  function aiSuggest(fieldKey) {
    var key = aiKey();
    if (!key) return Promise.reject(new Error("No API key set."));
    return fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({
        model: MODEL, max_tokens: 256,
        system: PROMPTS[fieldKey] || PROMPTS["default"],
        messages: [{
          role: "user",
          content: "Existing draft for context:\n" + characterContext() +
            "\n\nSuggest a single " + fieldKey.replace(/_/g, " ") + " for this character."
        }]
      })
    }).then(function (r) {
      if (!r.ok) {
        return r.text().then(function (t) {
          throw new Error("AI request failed (" + r.status + "): " + t.slice(0, 200));
        });
      }
      return r.json();
    }).then(function (d) {
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
      (aiAvailable() ? "Tab in an empty field for an AI suggestion"
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
  function schoolsOf(clan) {
    var list = SCHOOLS.filter(function (s) { return s.clan === clan; });
    return list.length ? list : SCHOOLS;
  }
  function schoolByRollName(name) {
    return SCHOOLS.filter(function (s) { return rollName(s.name) === name; })[0]
      || find(SCHOOLS, name);
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

    function addRing(obj) {
      if (!obj) return;
      if (obj._choose) { pending.push({ type: "ring", opts: obj._choose.options }); return; }
      Object.keys(obj).forEach(function (k) {
        var r = k.toLowerCase();
        if (rings[r] != null) rings[r] += obj[k];
      });
    }
    function addSkills(obj) {
      if (!obj) return;
      if (obj._choose) {
        pending.push({ type: "skill", n: obj._choose.n, opts: obj._choose.options });
        return;
      }
      Object.keys(obj).forEach(function (k) {
        var s = SKILL_BY_LABEL[String(k).toLowerCase()] || k.toLowerCase();
        skills[s] = (skills[s] || 0) + obj[k];
      });
    }

    var clan = find(CLANS, C.clan) || find(CLANS, C.clan + " Clan");
    if (clan) {
      addRing(clan.ring_bonus); addSkills(clan.skill_bonus);
      status = clan.starting_status || 0;
    }
    var fam = find(FAMILIES, C.family);
    if (fam) {
      addRing(fam.ring_increase); addSkills(fam.skill_increases);
      glory = fam.glory || 0; wealth = fam.starting_wealth || 0;
    }
    var sch = schoolByRollName(C.school);
    if (sch) {
      addRing(sch.ring_increase); addSkills(sch.starting_skills);
      honor = sch.starting_honor || 0;
    }
    if (C.standout_ring && rings[C.standout_ring] != null) rings[C.standout_ring] += 1;
    if (C.bushido.attitude === "A") honor += 10;
    if (C.answers.clan_relationship.path === "A") glory += 5;

    // chosen skills the player resolved by hand
    Object.keys(C.skills || {}).forEach(function (k) {
      skills[k] = (skills[k] || 0) + C.skills[k];
    });
    return { rings: rings, skills: skills, honor: honor, glory: glory,
             status: status, wealth: wealth, pending: pending, school: sch };
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
        });
      });
    }
    search.addEventListener("input", draw);
    if (items.length > 8) wrap.appendChild(search);
    wrap.appendChild(list);
    body.appendChild(wrap);
    draw();
  }

  function peculiarityStep(kind, listKey) {
    return function (body) {
      var items = byKind(kind).map(function (e) {
        return { value: e.name, label: e.name,
                 meta: [e.ring ? cap(e.ring) : null, e.source_book].filter(Boolean).join(" · ") };
      });
      pickList(body, items, C[listKey][0] || null, function (v) {
        C[listKey] = [v];
        save();
      });
    };
  }

  var STEPS = [
    { id: "name", n: 0, label: "Begin", title: "Begin a New Character",
      desc: "Give your character a working name. You can change it later. L5R5e characters are samurai of Rokugan; the final name is conventionally &lt;Family&gt; &lt;Personal&gt;.",
      done: function () { return has(C.name); },
      render: function (body) {
        var i = document.createElement("input");
        i.type = "text"; i.value = C.name || ""; i.placeholder = "Working name";
        i.addEventListener("input", function () { C.name = i.value; save(); });
        body.appendChild(i);
      } },

    { id: "clan", n: 1, label: "Clan", title: "Choose Your Clan",
      desc: "Every samurai belongs to a clan. The clan you choose shapes your culture, politics, and starting skills.",
      done: function () { return has(C.clan); },
      render: function (body) {
        var items = CLANS.map(function (c) {
          return { value: c.clan_short_name || c.name, label: c.name,
                   meta: [ringLine(c.ring_bonus), skillLine(c.skill_bonus),
                          c.starting_status ? "Status " + c.starting_status : null]
                     .filter(Boolean).join(" · ") };
        });
        pickList(body, items, C.clan, function (v) {
          if (C.clan !== v) { C.family = null; C.school = null; C.role = null; }
          C.clan = v; save(); render();
        });
      } },

    { id: "family", n: 2, label: "Family", title: "Choose Your Family",
      desc: "Within your clan, choose a family. Each emphasises a different ring or set of skills, and sets your starting wealth and glory.",
      done: function () { return has(C.family); },
      render: function (body) {
        if (!C.clan) return needs(body, "Choose a clan first.");
        var items = familiesOf(C.clan).map(function (f) {
          return { value: f.name, label: f.name,
                   meta: [ringLine(f.ring_increase), skillLine(f.skill_increases),
                          f.starting_wealth ? f.starting_wealth + " koku" : null,
                          f.glory ? "Glory " + f.glory : null].filter(Boolean).join(" · ") };
        });
        pickList(body, items, C.family, function (v) { C.family = v; save(); });
      } },

    { id: "school", n: 3, label: "School", title: "Choose Your School",
      desc: "Your school determines your starting techniques, your curriculum, your starting skills, and your starting honor and outfit.",
      done: function () { return has(C.school); },
      render: function (body) {
        var items = schoolsOf(C.clan).map(function (s) {
          return { value: rollName(s.name), label: rollName(s.name),
                   meta: [(s.roles || []).join(", "), ringLine(s.ring_increase),
                          s.starting_honor ? "Honor " + s.starting_honor : null,
                          s.school_ability].filter(Boolean).join(" · ") };
        });
        pickList(body, items, C.school, function (v) {
          C.school = v;
          var s = schoolByRollName(v);
          C.role = s && s.roles ? s.roles[0] : null;
          save();
        });
      } },

    { id: "standout", n: 4, label: "Standout", title: "A Standout Quality",
      desc: "Pick one ring to raise by +1, reflecting a moment from your character's past that defines what sets them apart from their peers.",
      done: function () { return has(C.standout_ring) && has(C.answers.standout_quality); },
      render: function (body) {
        ringPicker(body, C.standout_ring, function (r) { C.standout_ring = r; save(); });
        textStep("standout", "answers.standout_quality", "standout_quality",
          "What sets them apart?")(body);
      } },

    { id: "giri", n: 5, label: "Giri", title: "Giri (Duty)",
      desc: "Every samurai owes a duty. What is your giri, and to whom? Name the lord or institution you serve, and the obligation it places on your shoulders.",
      done: function () { return has(C.answers.giri); },
      render: textStep("giri", "answers.giri", "giri", "Whom do you serve, and how?") },

    { id: "ninjo", n: 6, label: "Ninjō", title: "Ninjō (Desire)",
      desc: "Your ninjō is the thing your character wants for themselves, which lives in tension with their giri. A good ninjō can't be satisfied without compromising the duty.",
      done: function () { return has(C.answers.ninjo); },
      render: textStep("ninjo", "answers.ninjo", "ninjo", "What do they long for?") },

    { id: "clan-tie", n: 7, label: "Clan Tie", title: "Relationship with Your Clan",
      desc: "How does your character relate to their clan? <strong>A) Embrace it</strong> — you exemplify the clan's ideals, +5 Glory. <strong>B) Diverge</strong> — you walk a different path, +1 rank in a skill of your choice.",
      done: function () { return has(C.answers.clan_relationship.path); },
      render: function (body) {
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

    { id: "bushido", n: 8, label: "Bushidō", title: "Tenets of Bushidō",
      desc: "Select one tenet as paramount (the one you live by) and one as lesser (the one you struggle with). Then your attitude: <strong>A) Devoted</strong> — +10 Honor, or <strong>B) Nuanced</strong> — +1 rank in a skill.",
      done: function () {
        return has(C.bushido.paramount) && has(C.bushido.lesser) && has(C.bushido.attitude);
      },
      render: function (body) {
        label(body, "Paramount tenet");
        choice(body, BUSHIDO.map(function (t) { return [t, t]; }), C.bushido.paramount,
          function (v) { C.bushido.paramount = v; save(); });
        label(body, "Lesser tenet");
        choice(body, BUSHIDO.map(function (t) { return [t, t]; }), C.bushido.lesser,
          function (v) { C.bushido.lesser = v; save(); });
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

    { id: "distinction", n: 9, label: "Distinction", title: "A Distinction",
      desc: "Select a distinction — a talent, a heritage, a hard-won skill. Something that sets your character apart.",
      done: function () { return C.distinctions.length > 0; },
      render: peculiarityStep("distinction", "distinctions") },

    { id: "adversity", n: 10, label: "Adversity", title: "An Adversity",
      desc: "Select an adversity — a hardship, weakness, or burden your character has overcome, or still bears.",
      done: function () { return C.adversities.length > 0; },
      render: peculiarityStep("adversity", "adversities") },

    { id: "passion", n: 11, label: "Passion", title: "A Passion",
      desc: "Select a passion — something or someone your character cares about deeply.",
      done: function () { return C.passions.length > 0; },
      render: peculiarityStep("passion", "passions") },

    { id: "anxiety", n: 12, label: "Anxiety", title: "An Anxiety",
      desc: "Select an anxiety — a fear or worry that haunts your character.",
      done: function () { return C.anxieties.length > 0; },
      render: peculiarityStep("anxiety", "anxieties") },

    { id: "mentor", n: 13, label: "Mentor", title: "A Mentor",
      desc: "Name a mentor and describe the relationship. Then choose: <strong>A)</strong> an additional advantage (distinction or passion), or <strong>B)</strong> an additional disadvantage plus +1 rank in a skill.",
      done: function () {
        var m = C.answers.mentor;
        return has(m.name) && has(m.path) && (m.path !== "B" || has(m.skill));
      },
      render: function (body) {
        var i = document.createElement("input");
        i.type = "text"; i.placeholder = "Mentor's name";
        i.value = C.answers.mentor.name || "";
        i.addEventListener("input", function () { C.answers.mentor.name = i.value; save(); });
        body.appendChild(i);
        choice(body, [["A", "An extra advantage"], ["B", "An extra disadvantage + skill"]],
          C.answers.mentor.path, function (v) {
            C.answers.mentor.path = v; save(); render();
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
        textStep("mentor", "answers.mentor.text", "mentor_relationship",
          "What were they taught, and at what cost?")(body);
      } },

    { id: "appearance", n: 14, label: "Appearance", title: "First Impression",
      desc: "Describe your character's appearance and a distinctive accoutrement they always carry.",
      done: function () { return has(C.answers.first_impression); },
      render: textStep("appearance", "answers.first_impression", "first_impression",
        "How do they strike a stranger?") },

    { id: "stress", n: 15, label: "Stress", title: "Stress Reaction",
      desc: "How does your character react under duress? Pushed past their composure, do they rage, withdraw, scheme, freeze?",
      done: function () { return has(C.answers.stress_reaction); },
      render: textStep("stress", "answers.stress_reaction", "stress_reaction",
        "What happens when they break?") },

    { id: "ties", n: 16, label: "Ties & Item", title: "Relationships & Starting Item",
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

    { id: "parent", n: 17, label: "Parent", title: "A Parent's Opinion",
      desc: "Describe a parent or guardian and their opinion of your character. Then gain +1 rank in a skill you currently have at rank 0.",
      done: function () {
        return has(C.answers.parent_opinion.description) && has(C.answers.parent_opinion.skill);
      },
      render: function (body) {
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

    { id: "heritage", n: 18, label: "Heritage", title: "Family Heritage",
      desc: "Roll d10 (or pick) from the heritage table. The result tells you something about your family's past, and may carry bonuses or items.",
      done: function () { return has(C.answers.heritage); },
      render: function (body) {
        var table = (HERITAGES.samurai || {}).entries || [];
        if (!table.length) return needs(body, "No heritage table loaded.");
        var roll = document.createElement("button");
        roll.type = "button"; roll.className = "btn"; roll.textContent = "Roll d10";
        roll.addEventListener("click", function () {
          var e = table[Math.floor(Math.random() * table.length)];
          C.answers.heritage = e.name; save(); render();
        });
        body.appendChild(roll);
        pickList(body, table.map(function (e) {
          return { value: e.name, label: e.roll + ". " + e.name,
                   meta: Object.keys(e.modifiers || {}).map(function (k) {
                     return cap(k) + " " + (e.modifiers[k] > 0 ? "+" : "") + e.modifiers[k];
                   }).join(" · ") };
        }), C.answers.heritage, function (v) { C.answers.heritage = v; save(); });
      } },

    { id: "final-name", n: 19, label: "Name", title: "Your Character's Name",
      desc: "Settle on a final name. In Rokugan this is conventionally &lt;Family&gt; &lt;Personal&gt;, family name first.",
      done: function () { return has(C.name); },
      render: function (body) {
        var i = document.createElement("input");
        i.type = "text"; i.value = C.name || "";
        i.placeholder = C.family ? C.family + " …" : "Family Personal";
        i.addEventListener("input", function () { C.name = i.value; save(); });
        body.appendChild(i);
      } },

    { id: "death", n: 20, label: "Death", title: "Vision of Death",
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
      status: "draft",
      identity: {
        clan: C.clan, family: C.family, school: C.school,
        role: C.role, age: ""
      },
      portrait: null,
      concept: a.first_impression || null,
      summary: null,
      notes: C.notes || "",
      twenty_questions: {
        template: "core", generated: false,
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
          step18: { answers: { heritage_name: a.heritage }, picks: {} },
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
        techniques: refs((sch.starting_techniques || []).filter(function (t) {
          return t.kind === "fixed";
        }).map(function (t) { return t.name; }).concat(
          sch.school_ability ? [sch.school_ability] : [])),
        peculiarities: refs([].concat(C.distinctions, C.adversities,
                                      C.passions, C.anxieties)),
        titles: [], bonds: [], signature_scrolls: [],
        gear: refs(C.starting_item ? [C.starting_item] : []),
        advancements: []
      }]
    };
  }

  function renderExport(body) {
    var doc = toSourceJson();
    var missing = STEPS.filter(function (s) {
      return s.id !== "export" && !s.done();
    }).map(function (s) { return s.label; });

    if (missing.length) {
      var warn = document.createElement("p");
      warn.className = "export-warn";
      warn.innerHTML = "<strong>" + missing.length + " step" +
        (missing.length === 1 ? "" : "s") + " unanswered:</strong> " +
        esc(missing.join(", ")) + ". You can still export — the build will " +
        "tell you what it cannot resolve.";
      body.appendChild(warn);
    }

    var row = document.createElement("div");
    row.className = "choicerow";
    row.innerHTML = '<button type="button" class="btn" id="dl">Download ' +
      esc(doc.slug || "character") + '.json</button>' +
      '<button type="button" class="btn" id="cp">Copy JSON</button>' +
      '<button type="button" class="btn ghost" id="reset">Start over</button>';
    body.appendChild(row);

    var pre = document.createElement("pre");
    pre.className = "export-json";
    pre.textContent = JSON.stringify(doc, null, 1);
    body.appendChild(pre);

    row.querySelector("#dl").addEventListener("click", function () {
      var blob = new Blob([JSON.stringify(doc, null, 1)], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = (doc.slug || "character") + ".json";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    });
    row.querySelector("#cp").addEventListener("click", function () {
      navigator.clipboard.writeText(JSON.stringify(doc, null, 1)).then(function () {
        row.querySelector("#cp").textContent = "Copied";
        setTimeout(function () { row.querySelector("#cp").textContent = "Copy JSON"; }, 1500);
      });
    });
    row.querySelector("#reset").addEventListener("click", function () {
      if (!confirm("Discard this draft and start a new character?")) return;
      C = newCharacter(); step = 0; save(); render();
    });
  }

  /* ---------------------------------------------------------- shell */

  function renderNav() {
    el("steps").innerHTML = STEPS.map(function (s, i) {
      var done = s.id !== "export" && s.done();
      return '<button type="button" class="stepnav' + (i === step ? " active" : "") +
        (done ? " done" : "") + '" data-i="' + i + '">' +
        '<span class="sn-n">' + (s.n || "·") + "</span>" +
        '<span class="sn-l">' + esc(s.label) + "</span></button>";
    }).join("");
    Array.prototype.forEach.call(document.querySelectorAll(".stepnav"), function (b) {
      b.addEventListener("click", function () {
        step = Number(b.getAttribute("data-i")); render();
      });
    });
    var done = STEPS.filter(function (s) { return s.id !== "export" && s.done(); }).length;
    el("progress").innerHTML = '<i style="width:' +
      Math.round((done / (STEPS.length - 1)) * 100) + '%"></i>';
    el("progress-label").textContent = done + " of " + (STEPS.length - 1) + " answered";
  }

  function renderWip() {
    var d = computed();
    var ring = RINGS.map(function (r) {
      return '<div class="ring" data-ring="' + r + '"><div class="rn">' + cap(r) +
        '</div><div class="rv">' + d.rings[r] + "</div></div>";
    }).join("");
    var skills = Object.keys(d.skills).filter(function (k) { return d.skills[k]; })
      .sort().map(function (k) {
        return '<div class="skill"><span class="sn">' +
          esc(SKILL_LABEL[k] || cap(k)) + '</span><span class="sv">' +
          d.skills[k] + "</span></div>";
      }).join("") || '<p class="muted small">No skills yet.</p>';

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
      (C.distinctions.length || C.adversities.length || C.passions.length || C.anxieties.length
        ? '<h4 class="field-label">Peculiarities</h4><div class="tagrow">' +
          [].concat(C.distinctions, C.adversities, C.passions, C.anxieties)
            .map(function (n) { return '<span class="chip">' + esc(n) + "</span>"; }).join("") +
          "</div>"
        : "");
  }

  function render() {
    var s = STEPS[step];
    el("step-n").textContent = s.n === 0 ? "Begin" : "Question " + s.n;
    el("step-title").textContent = s.title;
    el("step-desc").innerHTML = s.desc;
    var body = el("step-body");
    body.innerHTML = "";
    s.render(body);
    el("prev").disabled = step === 0;
    el("next").disabled = step === STEPS.length - 1;
    renderNav();
    renderWip();
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  function init() {
    el("prev").addEventListener("click", function () {
      if (step > 0) { step--; render(); }
    });
    el("next").addEventListener("click", function () {
      if (step < STEPS.length - 1) { step++; render(); }
    });
    var k = el("ai-key");
    k.value = aiKey() || "";
    k.addEventListener("change", function () {
      try {
        if (k.value.trim()) localStorage.setItem(LS_KEY, k.value.trim());
        else localStorage.removeItem(LS_KEY);
      } catch (e) { /* private mode */ }
      render();
    });
    render();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
