/* ============================================================
   sheet.js — renders window.SHEET and runs an L5R5e Roll & Keep roller.
   Dice faces are the official Ring (d6) and Skill (d12) faces.
   ============================================================ */
(function () {
  "use strict";
  var CURRENT = window.SHEET;
  if (!CURRENT) return;
  var S = CURRENT;                       // active version's data (reassigned when viewing history)
  var root = document.getElementById("sheet");
  var LSKEY = "pf-sheet-" + (CURRENT.id || "pc");

  // ---- version registry: a time-series of character sheets ----
  // The live sheet is always "current". window.SHEET_HISTORY (optional) holds
  // read-only snapshots of prior sessions, each SHEET-shaped, e.g.:
  //   { id, label, date, data:{ ...rings/skills/techniques/…, state:{strife,fatigue,void,stance} } }
  var VERSIONS = [{ id:"current", label:"Current", live:true, data:CURRENT }];
  (window.SHEET_HISTORY||[]).forEach(function(h){
    VERSIONS.push({ id:h.id, label:h.label||h.id, date:h.date||"", live:false, data:h.data||{} });
  });
  var curView = "current";   // id of the version being shown
  var RO = false;            // read-only (a past snapshot is being viewed)
  var SNAP = null;           // snapshot's recorded tracker state while RO
  function verById(id){ for(var i=0;i<VERSIONS.length;i++){ if(VERSIONS[i].id===id) return VERSIONS[i]; } return null; }

  // ---- dice faces (face index 0 == pip 1) ----
  var RING_FACES = [
    {key:"ring_blank"}, {key:"ring_ot",op:1,st:1}, {key:"ring_o",op:1},
    {key:"ring_st",su:1,st:1}, {key:"ring_s",su:1}, {key:"ring_et",ex:1,st:1}
  ];
  var SKILL_FACES = [
    {key:"skill_blank"}, {key:"skill_blank"}, {key:"skill_o",op:1}, {key:"skill_o",op:1}, {key:"skill_o",op:1},
    {key:"skill_st",su:1,st:1}, {key:"skill_st",su:1,st:1}, {key:"skill_s",su:1}, {key:"skill_s",su:1},
    {key:"skill_so",su:1,op:1}, {key:"skill_et",ex:1,st:1}, {key:"skill_e",ex:1}
  ];
  function faceTitle(d){
    var parts=[]; if(d.ex)parts.push(d.ex+"× explosive success"); if(d.su)parts.push(d.su+"× success");
    if(d.op)parts.push(d.op+"× opportunity"); if(d.st)parts.push(d.st+"× strife");
    return parts.length?parts.join(", "):"blank";
  }
  var RINGS = ["air","earth","fire","water","void"];
  var SKILL_GROUPS = [
    ["Artisan", ["aesthetics","composition","design","smithing"]],
    ["Martial", ["fitness","melee","ranged","unarmed","meditation","tactics"]],
    ["Scholar", ["culture","government","medicine","sentiment","theology"]],
    ["Social", ["command","courtesy","games","performance"]],
    ["Trade", ["commerce","labor","seafaring","skulduggery","survival"]]
  ];
  var SKILL_NAMES = { unarmed:"Martial Arts [Unarmed]", melee:"Martial Arts [Melee]", ranged:"Martial Arts [Ranged]" };

  // ---- persisted state ----
  var st = { strife:0, fatigue:0, "void":(S.trackers&&S.trackers["void"]&&S.trackers["void"].start)||0,
             stance:S.stance||"void", ring:"earth", skill:null,
             inConflict:false, conflictType:"skirmish", conflictName:"", oppTable:"general",
             conditions:[], techUses:{}, sceneVoidClaims:{}, equipWeapon:null, equipArmor:null,
             honor:(S.social?S.social.honor:0), glory:(S.social?S.social.glory:0), status:(S.social?S.social.status:0) };
  var CONDITIONS = ["Afflicted","Bleeding","Burning","Compromised","Dazed","Disoriented","Enraged","Exhausted","Immobilized","Intoxicated","Prone","Silenced","Unconscious"];
  var L5RD = window.L5R || {stances:{},conflicts:{},opportunities:{},oppTables:[],techniqueOpportunities:[]};
  try { var saved = JSON.parse(localStorage.getItem(LSKEY)); if (saved) Object.assign(st, saved); } catch(e){}
  function save(){ if(RO) return; try { localStorage.setItem(LSKEY, JSON.stringify(st)); } catch(e){} }
  function trkVal(key){ return RO ? ((SNAP&&SNAP[key])||0) : (st[key]||0); }

  // ---- roll log (history of kept results) ----
  var LOGKEY = "pf-log-" + (CURRENT.id || "pc");
  var rollLog = []; try { rollLog = JSON.parse(localStorage.getItem(LOGKEY)) || []; } catch(e){}
  function saveLog(){ try { localStorage.setItem(LOGKEY, JSON.stringify(rollLog)); } catch(e){} }
  function nowStr(){ try { return new Date().toLocaleString(); } catch(e){ return ""; } }
  function logEvent(cat, desc, extra){
    if(RO) return;
    rollLog.unshift(Object.assign({ kind:"event", cat:cat, desc:desc, when:nowStr() }, extra||{}));
    saveLog(); updateLogCount(); renderLog();
  }
  function socialVal(attr){ if(RO) return (S.social&&S.social[attr])||0; return st[attr]!=null?st[attr]:((S.social&&S.social[attr])||0); }
  function ringIcon(r){ return "<img class='ring-ico' src='../assets/rings/"+r+".svg' alt='"+cap(r)+"' title='"+cap(r)+"'>"; }

  // ---- export / import (state + roll log) ----
  function buildIO(){
    // Export, import and reset all act on the live character's stored state, so they
    // are withheld while an archived snapshot is on screen — Reset in particular would
    // wipe the live sheet from behind the archive.
    if(RO) return el("div","sh-iocol");
    var wrap=el("div","sh-io");
    var ex=el("button","io-tri export","▼"); ex.title="Export JSON (state + log)"; ex.setAttribute("aria-label","Export JSON");
    var im=el("button","io-tri import","▲"); im.title="Import JSON"; im.setAttribute("aria-label","Import JSON");
    var file=el("input"); file.type="file"; file.accept="application/json,.json"; file.style.display="none";
    ex.addEventListener("click",doExport);
    im.addEventListener("click",function(){ file.click(); });
    file.addEventListener("change",function(e){ var f=e.target.files&&e.target.files[0]; if(f) doImport(f); e.target.value=""; });
    wrap.appendChild(ex); wrap.appendChild(im); wrap.appendChild(file);
    var col=el("div","sh-iocol");
    col.appendChild(wrap);
    col.appendChild(buildReset());
    return col;
  }
  // Full local reset: discards this browser's saved trackers, conflict state and
  // roll log for this character and reloads the pristine sheet. Destructive, so it
  // confirms first and offers an export on the way out.
  function buildReset(){
    var b=el("button","io-reset","⟲ Reset");
    b.title="Discard all local changes on this page (trackers, conflict, log) and reload the sheet as authored";
    b.addEventListener("click",function(){
      var n=rollLog.length;
      if(!confirm("Reset this sheet?\n\nThis discards everything stored in THIS browser for "
        +(CURRENT.name||"this character")+":\n  • trackers (strife, fatigue, Void), conditions, social standing, XP\n"
        +"  • stance, conflict, equipped weapon/armour, technique uses\n"
        +"  • the roll and event log"+(n?" ("+n+" entries)":"")
        +"\n\nThe sheet reloads exactly as authored. This cannot be undone — export first if you want a copy.")) return;
      try { localStorage.removeItem(LSKEY); localStorage.removeItem(LOGKEY); } catch(e){}
      location.reload();
    });
    return b;
  }
  function doExport(){
    var data={ app:"portents-and-fortunes", character:CURRENT.id, name:CURRENT.name,
      exportedAt:new Date().toISOString(),
      state: JSON.parse(localStorage.getItem(LSKEY)||"null"),
      log: rollLog };
    var blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
    var url=URL.createObjectURL(blob), a=document.createElement("a");
    a.href=url; a.download=(CURRENT.id||"character")+"-"+new Date().toISOString().slice(0,10)+".json";
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }
  function doImport(file){
    var r=new FileReader();
    r.onload=function(){
      try{
        var d=JSON.parse(r.result);
        if(d.character && d.character!==CURRENT.id){ alert("This file is for “"+d.character+"”, not this character."); return; }
        if(d.state!==undefined && d.state!==null){ localStorage.setItem(LSKEY, JSON.stringify(d.state)); }
        if(Array.isArray(d.log)){ localStorage.setItem(LOGKEY, JSON.stringify(d.log)); }
        location.reload();
      }catch(err){ alert("Could not read that file: "+err.message); }
    };
    r.readAsText(file);
  }

  function cap(s){ return s.charAt(0).toUpperCase()+s.slice(1); }
  function el(tag, cls, html){ var e=document.createElement(tag); if(cls)e.className=cls; if(html!=null)e.innerHTML=html; return e; }
  function symHTML(d, dark){
    var out=[];
    function push(n,c,g){ for(var i=0;i<(n||0);i++) out.push("<span class='sym "+c+"'>"+g+"</span>"); }
    push(d.ex,"ex","❉"); push(d.su,"su","❁"); push(d.op,"op","◈"); push(d.st,"st","▲");
    if(!out.length) return "<span class='blank'>blank</span>";
    return out.join("");
  }
  function succ(d){ return (d.su||0)+(d.ex||0); }
  function escapeHTML(s){ return String(s).replace(/[&<>"']/g,function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
  // Render the dice-symbol tokens the corpus stores as ASCII, e.g. (op), as styled glyphs.
  function syms(t){
    if(t==null) return "";
    return String(t)
      .replace(/\(op\)/g,"<span class='sym op'>◈</span>")
      .replace(/\(su\)/g,"<span class='sym su'>❁</span>")
      .replace(/\(ex\)/g,"<span class='sym ex'>❉</span>")
      .replace(/\(st\)/g,"<span class='sym st'>▲</span>")
      .replace(/\(ring\)/g,"<span class='sym ring'>⬢</span>")
      .replace(/\((air|earth|fire|water|void)\)/gi,function(m,r){ return ringIcon(r.toLowerCase()); })
      .replace(/\[(Air|Earth|Fire|Water|Void)\]/g,function(m,r){ return ringIcon(r.toLowerCase()); });
  }

  // ---- build the sheet ----
  function render(){
    root.innerHTML="";
    root.classList.toggle("readonly", RO);

    // header
    var head = el("div","sh-head");
    if (S.portrait){ var pf=el("div","sh-portrait"); pf.appendChild(el("img")); pf.querySelector("img").src=S.portrait; pf.querySelector("img").alt=S.name; head.appendChild(pf); }
    var id = el("div","sh-id");
    id.appendChild(el("h1",null,S.name));
    id.appendChild(el("div","sub", S.clan+" Clan · "+S.family+" family"));
    id.appendChild(el("div","sub2", S.school+" · Rank "+S.rank+" "+S.role));
    head.appendChild(id);
    var tools=el("div","sh-tools");
    var mon=el("img","sh-mon"); mon.src="../assets/mon/"+S.clan.toLowerCase()+".svg"; mon.alt=S.clan+" mon"; tools.appendChild(mon);
    tools.appendChild(buildIO());
    head.appendChild(tools);
    root.appendChild(head);

    if(RO){
      var v=verById(curView);
      root.appendChild(el("div","ro-banner","<span class='seal'>&#9719;</span><div><b>Read-only.</b> Viewing "+(v?v.label:"a past session")+(v&&v.date?" &middot; "+v.date:"")+" — a snapshot from an earlier session. Switch the sheet selector to <em>Current</em> to make changes.</div>"));
    } else {
      // Roll & Keep — collapsed by default, at the top of the sheet
      root.appendChild(buildRoller());
    }

    var grid = el("div","sh-grid");

    // --- Conflict (spans the full width, above rings/condition) ---
    if(!RO) grid.appendChild(buildConflict());

    // --- Rings + derived ---
    var cRings = el("div","sh-card");
    cRings.appendChild(el("h2",null,"Rings &amp; Approach"));
    var rr = el("div","rings");
    RINGS.forEach(function(r){
      var rc = el("div","ring"+(st.ring===r?" sel":""));
      rc.setAttribute("data-ring",r);
      rc.innerHTML="<img class='ricon' src='../assets/rings/"+r+".svg' alt=''><span class='rn'>"+cap(r)+"</span><span class='rv'>"+S.rings[r]+"</span>"+(S.deficiency===r?"<span class='defmark' title='Elemental Deficiency'>▼</span>":"");
      rc.addEventListener("click",function(){ st.ring=r; save(); syncRing(); syncRoller(); });
      rr.appendChild(rc);
    });
    cRings.appendChild(rr);
    var der = el("div","derived");
    [["Endurance",S.derived.endurance],["Composure",S.derived.composure],["Focus",S.derived.focus],["Vigilance",S.derived.vigilance]].forEach(function(d){
      der.appendChild(el("div","d","<span class='dl'>"+d[0]+"</span><span class='dv'>"+d[1]+"</span>"));
    });
    cRings.appendChild(der);
    if(!RO){
      var sr=el("button","scene-reset","&#10227; Scene Reset");
      sr.title="End of scene: reduce strife to half Composure and fatigue to half Endurance (rounded up, RAW; suppressed while Exhausted), recharge per-scene abilities, reset per-scene Void triggers, and end any active conflict.";
      sr.addEventListener("click",sceneReset);
      cRings.appendChild(sr);
    }
    grid.appendChild(cRings);

    // --- Trackers ---
    var cTrk = el("div","sh-card trackers");
    cTrk.appendChild(el("h2",null,"Condition"));
    cTrk.appendChild(tracker("strife","Strife",S.trackers.strife.max,S.derived.composure,"Compromised at "+S.derived.composure));
    cTrk.appendChild(buildStrifeButtons());
    cTrk.appendChild(tracker("fatigue","Fatigue",S.trackers.fatigue.max,S.derived.endurance,"Incapacitated at "+S.derived.endurance));
    cTrk.appendChild(tracker("void","Void Points",S.trackers["void"].max,null,null));
    cTrk.appendChild(buildConditions());
    if(S.afflictions&&S.afflictions.length) cTrk.appendChild(buildAfflictions());
    grid.appendChild(cTrk);

    // --- Social (Honor / Glory / Status) ---
    grid.appendChild(buildSocial());
    grid.appendChild(buildXP());

    // --- Skills ---
    var cSk = el("div","sh-card");
    cSk.appendChild(el("h2",null,"Skills"));
    var sbody=el("div","skills-body");
    SKILL_GROUPS.forEach(function(g){
      var wrap=el("div","skgroup");
      wrap.appendChild(el("h3",null,g[0]));
      g[1].forEach(function(k){
        var rank=(S.skills[k]||0);
        var row=el("div","skrow"+(rank>0?" ranked":"")+(st.skill===k?" sel":""));
        row.setAttribute("data-skill",k);
        var dots="";
        for(var i=1;i<=5;i++) dots+="<i class='"+(i<=rank?"on":"")+"'></i>";
        row.innerHTML="<span class='skvals'><span class='skdots'>"+dots+"</span><span class='skv'>"+rank+"</span></span><span class='skn'>"+(SKILL_NAMES[k]||cap(k))+"</span>";
        row.addEventListener("click",function(){ st.skill=(st.skill===k?null:k); save(); syncSkill(); syncRoller(); });
        wrap.appendChild(row);
      });
      sbody.appendChild(wrap);
    });
    cSk.appendChild(sbody);
    grid.appendChild(cSk);

    // --- Techniques (beside Skills) ---
    var cTech = el("div","sh-card");
    cTech.appendChild(el("h2",null,"Techniques"));
    var techBody=el("div"); techBody.id="techBody"; cTech.appendChild(techBody);
    grid.appendChild(cTech);
    setTimeout(renderTechniques,0);

    // --- Peculiarities ---
    var cPec = el("div","sh-card span2");
    cPec.appendChild(el("h2",null,"Distinctions, Adversities, Passions &amp; Anxieties"));
    var pgrid=el("div"); pgrid.style.columns="2"; pgrid.style.columnGap="1.6rem";
    S.peculiarities.forEach(function(p){ var e=entry(p.name,p.tag,p.ring,p.text); e.style.breakInside="avoid"; pgrid.appendChild(e); });
    cPec.appendChild(pgrid);
    grid.appendChild(cPec);

    // --- Gear ---
    grid.appendChild(buildGearCard());

    // --- Bushido / motivations ---
    var cMot = el("div","sh-card");
    cMot.appendChild(el("h2",null,"Bushidō &amp; Motivation"));
    var dl=el("div","deflist");
    function row(dt,dd){ dl.appendChild(el("div","row","<dt>"+dt+"</dt><dd>"+dd+"</dd>")); }
    row("Paramount", S.bushido.paramount);
    row("Least significant", S.bushido.less);
    row("Ninjō (desire)", S.ninjo);
    row("Giri (duty)", S.giri);
    if(S.bushido.register) row("Register", S.bushido.register);
    cMot.appendChild(dl);
    grid.appendChild(cMot);

    // --- Titles & bonds ---
    if((S.titles&&S.titles.length)||(S.bonds&&S.bonds.length)) grid.appendChild(buildTitlesCard());

    root.appendChild(grid);
    applyRails();          // section ids are recreated by render(), so rebuild the nav
  }

  // ===================== ABILITY USE CONTROLS =====================
  // Title abilities, bond abilities, and the shūji that spend a resource or move a
  // tracker without rolling get a Use button rather than an activation roll.
  // L5R5e social ranks are the tens digit of the attribute (honor 35 = rank 3), so
  // these read the live value and follow honor/glory/status as they are adjusted.
  function rankOf(attr){ return Math.floor(socialVal(attr)/10); }
  function useAmount(spec, ctx){
    if(spec==null) return 0;
    if(typeof spec==="number") return spec;
    if(spec==="gloryRank")  return rankOf("glory");
    if(spec==="honorRank")  return rankOf("honor");
    if(spec==="statusRank") return rankOf("status");
    if(spec==="bondRank")   return (ctx&&ctx.rank)||0;
    return (S.skills&&S.skills[spec])||0;              // a skill's ranks, e.g. "sentiment"
  }
  function useScale(u, ctx){
    var spec = u.scaleBy!=null ? u.scaleBy
             : (u.strifeRemove!=null ? u.strifeRemove : u.strifeAdd);
    return useAmount(spec, ctx);
  }
  function abilityUse(name, u, ctx){
    var key=u.usesKey||name;
    var spent=(st.techUses[key]||0);
    var maxed=!!(u.uses && spent>=u.uses.max);
    var short=!!(u.voidCost && (st["void"]||0)<u.voidCost);
    var blocked=u.locked||maxed||short||RO;

    var wrap=el("div","ability-use");
    var bits=[];
    if(u.voidCost) bits.push(u.voidCost+" Void");
    if(u.strifeRemove!=null) bits.push("&minus;"+useAmount(u.strifeRemove,ctx)+" strife");
    if(u.strifeAdd!=null) bits.push("+"+useAmount(u.strifeAdd,ctx)+" strife");
    var btn=el("button","tech-activate ability-btn"+(blocked?" spent":""),
      (u.label||"Use")+(bits.length?" &middot; "+bits.join(" &middot; "):""));
    if(u.locked){ btn.disabled=true; btn.title=u.locked; }
    else if(RO){ btn.disabled=true; }
    else if(maxed){ btn.disabled=true; btn.title="Already used — recharges per "+String(u.uses.per).toLowerCase(); }
    else if(short){ btn.disabled=true; btn.title="Not enough Void points"; }
    else btn.addEventListener("click",function(){ useAbility(name,u,ctx); });
    wrap.appendChild(btn);
    if(u.uses) wrap.appendChild(el("span","tech-uses",spent+"/"+u.uses.max+" per "+u.uses.per));
    if(u.locked) wrap.appendChild(el("div","ability-note locked",u.locked));
    if(u.note) wrap.appendChild(el("div","ability-note",syms(String(u.note).replace(/\{n\}/g, useScale(u,ctx)))));
    return wrap;
  }
  function useAbility(name,u,ctx){
    var key=u.usesKey||name, done=[];
    if(u.voidCost){
      var vf=st["void"]||0; st["void"]=Math.max(0,vf-u.voidCost);
      done.push("Void "+vf+" → "+st["void"]);
    }
    if(u.strifeRemove!=null){
      var amt=useAmount(u.strifeRemove,ctx), sf=st.strife||0;
      st.strife=Math.max(0,sf-amt); done.push("Strife "+sf+" → "+st.strife);
    }
    if(u.strifeAdd!=null){
      var add=useAmount(u.strifeAdd,ctx), s0=st.strife||0;
      st.strife=s0+add; done.push("Strife "+s0+" → "+st.strife);   // no upper clamp, as elsewhere
    }
    if(u.uses) st.techUses[key]=(st.techUses[key]||0)+1;
    save();
    logEvent("ability", name+(done.length?" — "+done.join("; "):" — used"), {source:name});
    syncTracker("strife"); syncTracker("void"); syncRoller();
    renderTechniques(); renderTitles();
  }

  // ===================== TITLES & BONDS =====================
  // Titles carry a status award, a title ability, and an advancement curriculum;
  // bonds carry a rank and a bond ability. Both are collapsible like techniques.
  function renderTitles(){
    var old=root.querySelector(".titles-card"); if(!old) return;
    var fresh=buildTitlesCard();
    if(old.id) fresh.id=old.id;          // keep the left rail's section anchor alive
    old.replaceWith(fresh);
  }
  function buildTitlesCard(){
    var c=el("div","sh-card span2 titles-card");
    c.appendChild(el("h2",null,"Titles &amp; Bonds"));
    (S.titles||[]).forEach(function(t){ c.appendChild(titleEntry(t)); });
    (S.bonds||[]).forEach(function(b){ c.appendChild(bondEntry(b)); });
    return c;
  }
  function titleEntry(t){
    var e=el("div","entry title-entry");
    var meta=[];
    if(t.state) meta.push(t.state);
    if(t.statusAward) meta.push("Status award "+t.statusAward);
    if(t.assignedBy) meta.push("Assigned by "+t.assignedBy);
    e.innerHTML="<div class='et-head'><span class='et-name'>"+t.name+"</span><span class='et-tag'>Title</span></div>"
      +(meta.length?"<div class='gearmeta'>"+meta.join(" · ")+"</div>":"")
      +(t.ability?"<div class='tech-blood'><b>Title ability — "+t.ability+"</b>"+(t.abilityText?"<br>"+syms(t.abilityText):"")+(t.abilityLocked?" <em>("+t.abilityLocked+")</em>":"")+"</div>":"")
      +(t.curriculum&&t.curriculum.length?"<div class='gearmeta'>Curriculum: "+t.curriculum.join(" · ")+"</div>":"");
    if(t.use) e.appendChild(abilityUse(t.ability||t.name, t.use, t));
    if(t.text){
      var body=el("p","et-text collapsed"); body.innerHTML=syms(boldLabels(t.text)); e.appendChild(body);
      var more=el("button","more","Read more"); e.appendChild(more); wireMore(body,more);
    }
    return e;
  }
  function bondEntry(b){
    var e=el("div","entry bond-entry");
    var meta=[];
    if(b.type) meta.push(b.type);
    if(b.rank!=null) meta.push("Rank "+b.rank);
    e.innerHTML="<div class='et-head'><span class='et-name'>"+b.name+"</span><span class='et-tag'>Bond</span></div>"
      +(meta.length?"<div class='gearmeta'>"+meta.join(" · ")+"</div>":"")
      +(b.ability?"<div class='tech-blood'><b>Bond ability — "+b.ability+"</b>"+(b.abilityText?"<br>"+syms(b.abilityText):"")+"</div>":"");
    if(b.use) e.appendChild(abilityUse(b.ability||b.name, b.use, b));
    if(b.text){
      var body=el("p","et-text collapsed"); body.innerHTML=syms(boldLabels(b.text)); e.appendChild(body);
      var more=el("button","more","Read more"); e.appendChild(more); wireMore(body,more);
    }
    return e;
  }

  // Long-running wounds and other standing mechanical burdens that are not
  // conditions and do not clear on a scene reset.
  function buildAfflictions(){
    var wrap=el("div","afflictions-wrap");
    wrap.appendChild(el("h2",null,"Standing Wounds"));
    (S.afflictions||[]).forEach(function(a){
      wrap.appendChild(el("div","affliction","<span class='aff-name'>"+a.name+"</span><span class='aff-text'>"+syms(a.text)+"</span>"));
    });
    return wrap;
  }

  var TNAMES={strife:"Strife",fatigue:"Fatigue","void":"Void points"};
  function tracker(key,name,max,limit,warnAt){
    var wrap=el("div","trk"); wrap.setAttribute("data-key",key);
    wrap.innerHTML="<div class='trk-top'><span class='trk-name'>"+name+" <span class='warn' data-warn></span></span><span class='trk-val'></span></div>";
    var pips=el("div","pips");
    for(var i=1;i<=max;i++){ (function(n){ var p=el("div","pip"); p.addEventListener("click",function(){
      if(RO) return;
      var from=st[key]||0, to=(from===n?n-1:n);
      if(to===from) return;
      st[key]=to; save(); syncTracker(key);
      logEvent(key,(TNAMES[key]||key)+" "+from+" → "+to+((key==="void"&&to<from)?" (spent)":""),{attr:key,from:from,to:to,delta:to-from});
    }); pips.appendChild(p); })(i); }
    wrap.appendChild(pips);
    if(warnAt) wrap.appendChild(el("p","trk-note",warnAt));
    setTimeout(function(){ syncTracker(key); },0);
    return wrap;
  }
  function syncTracker(key){
    var wrap=root.querySelector('.trk[data-key="'+key+'"]'); if(!wrap) return;
    var v=trkVal(key);
    var pips=wrap.querySelector(".pips");
    var base=wrap.querySelectorAll(".pip:not(.overflow)").length;
    wrap.querySelectorAll(".pip.overflow").forEach(function(p){ p.remove(); });   // clear old overflow
    for(var j=base;j<v;j++){ (function(n){                                        // beyond-max strife/fatigue
      var p=el("div","pip overflow on");
      p.title="Over maximum — click to set to "+n;
      if(!RO) p.addEventListener("click",function(){
        var from=st[key]||0, to=(from===n?n-1:n);
        if(to===from) return;
        st[key]=to; save(); syncTracker(key);
        logEvent(key,(TNAMES[key]||key)+" "+from+" → "+to,{attr:key,from:from,to:to,delta:to-from});
      });
      pips.appendChild(p);
    })(j+1); }
    wrap.querySelectorAll(".pip:not(.overflow)").forEach(function(p,i){ p.classList.toggle("on", i<v); });
    wrap.querySelector(".trk-val").textContent=v+" / "+base+(v>base?" (over)":"");
    var warn=wrap.querySelector("[data-warn]"); warn.textContent="";
    if(key==="strife" && v>=S.derived.composure) warn.textContent="Compromised";
    if(key==="fatigue" && v>=S.derived.endurance) warn.textContent="Incapacitated";
    syncRails();
  }
  function entry(name,tag,ring,text){
    var e=el("div","entry");
    var tags=(tag?"<span class='et-tag'>"+tag+"</span>":"")+(ring?"<span class='et-tag ring'>"+cap(ring)+"</span>":"");
    e.innerHTML="<div class='et-head'><span class='et-name'>"+name+"</span>"+tags+"</div><p class='et-text collapsed'>"+syms(text)+"</p><button class='more'>Read more</button>";
    var body=e.querySelector(".et-text"), btn=e.querySelector(".more");
    btn.addEventListener("click",function(){ var c=body.classList.toggle("collapsed"); btn.textContent=c?"Read more":"Show less"; });
    return e;
  }

  function syncRing(){ root.querySelectorAll(".ring").forEach(function(r){ r.classList.toggle("sel", r.getAttribute("data-ring")===st.ring); }); syncRails(); }
  function syncSkill(){ root.querySelectorAll(".skrow").forEach(function(r){ r.classList.toggle("sel", r.getAttribute("data-skill")===st.skill); }); syncRails(); }
  function syncStance(){ root.querySelectorAll(".stbtn").forEach(function(b){ b.classList.toggle("sel", b.getAttribute("data-stance")===st.stance); }); syncRails(); }

  // ===================== STRIFE SHORTCUTS =====================
  function buildStrifeButtons(){
    var wrap=el("div","strife-btns");
    (S.peculiarities||[]).filter(function(p){ return typeof p.strife==="number"; }).forEach(function(p){
      var d=p.strife;
      var b=el("button","strife-btn "+(d<0?"heal":"harm"), p.name+" ("+(d>0?"+":"")+d+")");
      if(RO) b.disabled=true;
      b.addEventListener("click",function(){
        if(RO) return;
        var from=st.strife||0, to=Math.max(0, from+d);   // no upper clamp — strife may exceed maximum
        st.strife=to; save(); syncTracker("strife");
        logEvent("strife", p.name+": Strife "+from+" → "+to, {attr:"strife", from:from, to:to, delta:to-from, source:p.name});
        // Anxiety: the first time per scene it causes strife to increase, gain 1 Void point.
        if(p.tag==="Anxiety" && d>0){
          if(!st.sceneVoidClaims) st.sceneVoidClaims={};
          if(!st.sceneVoidClaims[p.name]){
            st.sceneVoidClaims[p.name]=true;
            var vf=st["void"]||0, vmax=voidMax();
            if(vf<vmax){
              st["void"]=vf+1; save(); syncTracker("void"); syncRoller();
              logEvent("void", p.name+" (anxiety) — first trigger this scene: Void "+vf+" → "+(vf+1)+" (gained)", {attr:"void", from:vf, to:vf+1, delta:1});
            } else {
              save();
              logEvent("void", p.name+" (anxiety) — first trigger this scene (already at maximum Void, no point gained)", {attr:"void", from:vf, to:vf, delta:0});
            }
          }
        }
      });
      wrap.appendChild(b);
    });
    return wrap;
  }

  // ===================== SCENE RESET =====================
  // Resets everything scoped to a single scene: strife/fatigue "catch your breath"
  // reduction (RAW: to half Composure / half Endurance, rounded up, only if over
  // that threshold; suppressed by Exhausted), per-scene ability uses, per-scene
  // Void-grant triggers, and any active conflict.
  // Every use-limited ability, wherever it lives: techniques spent by an activation
  // roll (t.uses), techniques spent by a Use button (t.use.uses), and title/bond
  // abilities. Several may share one counter via usesKey, so callers de-duplicate.
  function limitedUses(){
    var out=[];
    (S.techniques||[]).forEach(function(t){
      if(t.uses) out.push({name:t.name, key:t.name, per:t.uses.per});
      if(t.use && t.use.uses) out.push({name:t.name, key:t.use.usesKey||t.name, per:t.use.uses.per});
    });
    (S.titles||[]).concat(S.bonds||[]).forEach(function(x){
      if(!(x.use && x.use.uses)) return;
      var n=x.ability||x.name;
      out.push({name:n, key:x.use.usesKey||n, per:x.use.uses.per});
    });
    return out;
  }
  function sceneReset(){
    if(RO) return;
    if(!st.sceneVoidClaims) st.sceneVoidClaims={};
    var changes=[];
    var exhausted=(st.conditions||[]).indexOf("Exhausted")>=0;
    if(exhausted){
      changes.push("Exhausted — strife & fatigue not reduced");
    } else {
      var compHalf=Math.ceil((S.derived.composure||0)/2);
      var endHalf=Math.ceil((S.derived.endurance||0)/2);
      if((st.strife||0)>compHalf){ changes.push("Strife "+(st.strife||0)+" → "+compHalf); st.strife=compHalf; }
      if((st.fatigue||0)>endHalf){ changes.push("Fatigue "+(st.fatigue||0)+" → "+endHalf); st.fatigue=endHalf; }
    }
    var techReset=[], seenKey={};
    limitedUses().forEach(function(u){
      if(!/scene/i.test(u.per) || seenKey[u.key] || !(st.techUses[u.key]||0)) return;
      seenKey[u.key]=true; techReset.push(u.name); st.techUses[u.key]=0;
    });
    if(techReset.length) changes.push("Recharged: "+techReset.join(", "));
    var claimed=Object.keys(st.sceneVoidClaims);
    if(claimed.length) changes.push("Per-scene Void triggers reset ("+claimed.join(", ")+")");
    st.sceneVoidClaims={};
    if(st.inConflict){ changes.push("Conflict ended"); st.inConflict=false; st.conflictName=""; }
    save();
    logEvent("scene","Scene Reset — "+(changes.length?changes.join("; "):"nothing to reset"));
    syncTracker("strife"); syncTracker("fatigue"); syncTracker("void"); syncRoller();
    renderTechniques(); renderTitles();
    var cb=root.querySelector(".conflict-body"); if(cb) renderConflict(cb);
  }

  // ===================== CONDITIONS =====================
  function buildConditions(){
    var wrap=el("div","conditions-wrap");
    wrap.appendChild(el("h2",null,"Conditions"));
    var chips=el("div","cond-chips");
    var active = RO ? ((SNAP&&SNAP.conditions)||[]) : st.conditions;
    CONDITIONS.forEach(function(c){
      var b=el("button","cond-chip"+(active.indexOf(c)>=0?" on":""),c);
      if(RO) b.disabled=true;
      b.addEventListener("click",function(){
        if(RO) return;
        var i=st.conditions.indexOf(c);
        if(i>=0){ st.conditions.splice(i,1); logEvent("condition","Removed condition: "+c,{attr:c,delta:"removed"}); }
        else { st.conditions.push(c); logEvent("condition","Applied condition: "+c,{attr:c,delta:"applied"}); }
        save(); b.classList.toggle("on");
      });
      chips.appendChild(b);
    });
    wrap.appendChild(chips);
    return wrap;
  }

  // ===================== SOCIAL STANDING =====================
  function buildSocial(){
    var c=el("div","sh-card span2 social-card");
    c.appendChild(el("h2",null,"Social Standing"));
    var row=el("div","social-row");
    [["honor","Honor"],["glory","Glory"],["status","Status"]].forEach(function(p){ row.appendChild(socialAttr(p[0],p[1])); });
    c.appendChild(row);
    c.appendChild(el("p","trk-note","Adjust with − / +, or stake a set amount to wager it. Every change is written to the roll log."));
    return c;
  }
  function socialAttr(attr,label){
    var box=el("div","soc-attr"); box.setAttribute("data-attr",attr);
    box.innerHTML="<div class='soc-lab'>"+label+"</div>"
      +"<div class='soc-main'><button class='soc-adj' data-d='-1'>&minus;</button><span class='soc-val'>"+socialVal(attr)+"</span><button class='soc-adj' data-d='1'>+</button></div>"
      +"<div class='soc-stake'><input type='number' class='soc-stake-in' min='1' placeholder='stake'><button class='soc-stake-btn'>Stake</button></div>";
    if(RO){ box.querySelectorAll("button,input").forEach(function(x){ x.disabled=true; }); return box; }
    var valEl=box.querySelector(".soc-val");
    box.querySelectorAll(".soc-adj").forEach(function(b){
      b.addEventListener("click",function(){
        var d=parseInt(b.getAttribute("data-d"),10);
        var from=socialVal(attr), to=Math.max(0,from+d);
        if(to===from) return;
        st[attr]=to; save(); valEl.textContent=to;
        logEvent("social",label+" "+from+" → "+to+" ("+(d>0?"+":"")+d+")",{attr:attr,from:from,to:to,delta:d});
        // Glory/honor/status ranks scale several abilities, so refresh anything showing them.
        if(Math.floor(from/10)!==Math.floor(to/10)){ renderTechniques(); renderTitles(); }
      });
    });
    box.querySelector(".soc-stake-btn").addEventListener("click",function(){
      var inp=box.querySelector(".soc-stake-in"), amt=Math.max(0,parseInt(inp.value||"0",10));
      if(!amt) return;
      logEvent("stake","Staked "+amt+" "+label+" (holding "+socialVal(attr)+")",{attr:attr,amount:amt});
      inp.value="";
    });
    return box;
  }

  // ===================== EXPERIENCE =====================
  // Authored totals live in SHEET.xp; local adjustments override them the
  // same way the social attributes do, so Reset returns to the authored value.
  function xpVal(k){
    var authored=(S.xp&&S.xp[k])||0;
    if(RO) return authored;
    var key="xp"+k.charAt(0).toUpperCase()+k.slice(1);
    return st[key]!=null?st[key]:authored;
  }
  function buildXP(){
    var c=el("div","sh-card xp-card");
    c.appendChild(el("h2",null,"Experience"));
    var row=el("div","social-row xp-row");
    row.appendChild(xpAttr("earned","Earned"));
    row.appendChild(xpAttr("spent","Spent"));
    var av=el("div","soc-attr avail");
    av.innerHTML="<div class='soc-lab'>Available</div><div class='soc-main'><span class='soc-val' id='xpAvail'>"
      +(xpVal("earned")-xpVal("spent"))+"</span></div>";
    row.appendChild(av);
    c.appendChild(row);
    c.appendChild(el("p","trk-note","Every change is written to the roll log. Reset restores the authored totals."));
    return c;
  }
  function xpAttr(k,label){
    var box=el("div","soc-attr"); box.setAttribute("data-xp",k);
    box.innerHTML="<div class='soc-lab'>"+label+"</div>"
      +"<div class='soc-main'><button class='soc-adj' data-d='-1'>&minus;</button><span class='soc-val'>"+xpVal(k)+"</span><button class='soc-adj' data-d='1'>+</button></div>";
    if(RO){ box.querySelectorAll("button").forEach(function(x){ x.disabled=true; }); return box; }
    var valEl=box.querySelector(".soc-val");
    var key="xp"+k.charAt(0).toUpperCase()+k.slice(1);
    box.querySelectorAll(".soc-adj").forEach(function(b){
      b.addEventListener("click",function(){
        var d=parseInt(b.getAttribute("data-d"),10);
        var from=xpVal(k), to=Math.max(0,from+d);
        if(to===from) return;
        st[key]=to; save(); valEl.textContent=to;
        var av=document.getElementById("xpAvail");
        if(av) av.textContent=xpVal("earned")-xpVal("spent");
        logEvent("xp","XP "+label.toLowerCase()+" "+from+" \u2192 "+to+" ("+(d>0?"+":"")+d+")",
                 {field:k,from:from,to:to,delta:d});
      });
    });
    return box;
  }

  // ===================== TECHNIQUES =====================
  function renderTechniques(){
    var body=document.getElementById("techBody"); if(!body) return;
    body.innerHTML="";
    S.techniques.forEach(function(t){ body.appendChild(techEntry(t)); });
  }
  function wireMore(body,btn){ btn.addEventListener("click",function(){ var c=body.classList.toggle("collapsed"); btn.textContent=c?"Read more":"Show less"; }); }
  // Bold the L5R technique-block labels for readability.
  function boldLabels(t){
    return String(t).replace(/(Activation|Enhancement Effect|Burst Effect|Effects|New Opportunities)(\s*\([^)]*\))?:/g,function(m){ return "<b>"+m+"</b>"; });
  }
  function bloodCallout(t){
    return "<div class='tech-blood'>Empowered by <b>Blood of the Kami</b> (the spider tattoo): on a successful activation, add bonus successes equal to your school rank ("+(S.rank||1)+").</div>";
  }
  function techEntry(t){
    var e=el("div","entry tech-entry");
    if(t.kind==="school"){   // Blood of the Kami — special collapsed view
      e.innerHTML="<div class='et-head'><span class='et-name'>"+t.name+"</span><span class='et-tag'>"+t.tag+"</span>"+ringIcon(t.ring)+"</div>"
        +"<div class='tech-blood'>Active — empowers <b>"+t.linkedKiho+"</b> (the "+t.motif+" tattoo): on a successful activation, add bonus successes equal to your school rank ("+(S.rank||1)+").</div>"
        +"<p class='et-text collapsed'>"+syms(boldLabels(t.text))+"</p><button class='more'>Read more</button>";
      wireMore(e.querySelector(".et-text"), e.querySelector(".more"));
      return e;
    }
    // When a technique carries a Use control, that control owns the counter chip.
    var usage = (t.uses && !t.use) ? "<span class='tech-uses'>"+(st.techUses[t.name]||0)+"/"+t.uses.max+" per "+t.uses.per+"</span>" : "";
    // Kata are classified by rank and form rather than by ring, so t.ring is optional.
    e.innerHTML="<div class='et-head'><span class='et-name'>"+t.name+"</span><span class='et-tag'>"+t.tag+"</span>"+(t.ring?ringIcon(t.ring):"")+usage+"</div>";
    if(t.activation){
      var a=t.activation;
      var maxed = t.uses && (st.techUses[t.name]||0)>=t.uses.max;
      // Some techniques have a variable TN (e.g. "the target's vigilance"); those carry
      // a tnLabel instead of a number, and leave the roller's TN field for the player.
      var tnTxt=(a.tn!=null?a.tn:(a.tnLabel||"?"));
      var btn=el("button","tech-activate"+(maxed?" spent":""), a.actionType+a.punct+" TN "+tnTxt+" "+(SKILL_NAMES[a.skill]||cap(a.skill))+" "+ringIcon(a.ring));
      if(RO) btn.disabled=true;
      btn.addEventListener("click",function(){ if(RO) return; activateTechnique(t); });
      e.appendChild(btn);
    }
    if(t.use){ e.appendChild(abilityUse(t.name,t.use,null)); }
    if(t.bloodOfKami){ var bc=el("div"); bc.innerHTML=bloodCallout(t); e.appendChild(bc.firstChild); }
    var body=el("p","et-text collapsed"); body.innerHTML=syms(boldLabels(t.text)); e.appendChild(body);
    var more=el("button","more","Read more"); e.appendChild(more); wireMore(body,more);
    return e;
  }
  function activateTechnique(t){
    var a=t.activation; if(!a) return;
    st.ring=a.ring; st.skill=a.skill; save(); syncRing(); syncSkill();
    var rc=document.getElementById("rollerCard"); if(rc) rc.classList.remove("collapsed");
    var tn=document.getElementById("rTN"); if(tn && a.tn!=null) tn.value=a.tn;
    var note=document.getElementById("rNote"); if(note && !note.value) note.value=t.name;
    rollCtx={ source:t.name, activation:a.actionType+a.punct, bloodOfKami:!!t.bloodOfKami, schoolRank:(S.rank||1) };
    if(t.uses){ st.techUses[t.name]=(st.techUses[t.name]||0)+1; save(); renderTechniques(); }
    syncRoller(); doRoll();
    if(rc) rc.scrollIntoView({behavior:"smooth",block:"start"});
  }

  // ===================== CONFLICT =====================
  function buildConflict(){
    var c=el("div","sh-card span2 conflict-card");
    c.appendChild(el("h2",null,"Conflict"));
    var body=el("div","conflict-body");
    c.appendChild(body);
    setTimeout(function(){ renderConflict(body); },0);
    return c;
  }
  function confRow(label,node){
    var r=el("div","conf-row"); r.appendChild(el("div","conf-label",label)); r.appendChild(node); return r;
  }
  function renderConflict(body){
    body.innerHTML="";
    if(!st.inConflict){
      var enter=el("button","roll-btn conf-enter","⚔ Enter Conflict");
      enter.addEventListener("click",function(){ st.inConflict=true; st.conflictType=st.conflictType||"skirmish"; save(); renderConflict(body); syncRoller(); });
      body.appendChild(enter);
      body.appendChild(el("p","stance-note","Conflict type, stances, initiative, and available actions appear once a conflict begins."));
      return;
    }
    // optional conflict name
    var nameIn=el("input","conf-name-in"); nameIn.type="text"; nameIn.placeholder="Name this conflict (optional)"; nameIn.value=st.conflictName||"";
    nameIn.addEventListener("input",function(){ st.conflictName=nameIn.value; save(); });
    body.appendChild(confRow("Name",nameIn));
    // conflict type
    var typeWrap=el("div","conf-choices");
    Object.keys(L5RD.conflicts).forEach(function(k){
      var b=el("button","conf-choice"+(st.conflictType===k?" sel":""),L5RD.conflicts[k].name);
      b.addEventListener("click",function(){ st.conflictType=k; save(); renderConflict(body); });
      typeWrap.appendChild(b);
    });
    body.appendChild(confRow("Type",typeWrap));
    var conf=L5RD.conflicts[st.conflictType]||{actions:[],initSkill:"—"};
    // stance
    var stWrap=el("div","stances");
    RINGS.forEach(function(r){
      var b=el("button","stbtn"+(st.stance===r?" sel":""),cap(r));
      b.setAttribute("data-stance",r);
      b.addEventListener("click",function(){ st.stance=r; st.ring=r; save(); renderConflict(body); syncRing(); syncRoller(); });
      stWrap.appendChild(b);
    });
    body.appendChild(confRow("Stance",stWrap));
    if(st.stance && L5RD.stances[st.stance]){
      body.appendChild(el("div","stance-detail","<b>"+L5RD.stances[st.stance].name+".</b> "+syms(L5RD.stances[st.stance].text)));
    }
    // initiative
    var initWrap=el("div","conf-init");
    var initBtn=el("button","roll-btn ghost","Roll Initiative");
    initBtn.addEventListener("click",function(){ rollInitiative(conf); });
    initWrap.appendChild(initBtn);
    initWrap.appendChild(el("span","conf-note","TN 1 · "+conf.initSkill+" · any ring — order by bonus successes, ties: lowest honor first"));
    body.appendChild(confRow("Initiative",initWrap));
    // actions — each a button that declares the action to the log and, where the
    // action involves a check, tees up (but does not make) the appropriate roll.
    // The ⓘ affordance toggles the verbatim rules text without logging anything.
    var actWrap=el("div","conf-choices actions");
    var actDetail=el("div","conf-action-detail"); actDetail.hidden=true;
    (conf.actions||[]).forEach(function(a){
      var hc = a.check ? resolveCheck(a.check) : null;
      var hint = hc ? (hc.tn!=null?("TN "+hc.tn):"check")+(hc.skill?" · "+(SKILL_NAMES[hc.skill]||cap(hc.skill)):"")+(hc.opt?" (optional)":"") : "";
      var b=el("button","conf-action-btn");
      b.innerHTML="<span class='ca-name'>"+a.name+"</span>"
        +"<span class='ca-cats'>"+a.cats+"</span>"
        +(hint?"<span class='ca-hint'>"+(a.check?"⚄ tees up "+hint:hint)+"</span>":"")
        +"<span class='ca-info' title='Show rules text' aria-label='Show rules text'>ⓘ</span>";
      b.addEventListener("click",function(){ declareAction(conf,a); });
      b.querySelector(".ca-info").addEventListener("click",function(e){ e.stopPropagation(); toggleActionDetail(actDetail,a); });
      actWrap.appendChild(b);
    });
    body.appendChild(confRow("Actions",actWrap));
    body.appendChild(actDetail);
    // end
    var end=el("button","roll-btn ghost conf-end","End Conflict");
    end.addEventListener("click",function(){ st.inConflict=false; save(); renderConflict(body); syncRoller(); });
    body.appendChild(end);
  }
  // Initiative tees up the roll without making it, like every other conflict action.
  // In a conflict the ring is the one your stance dictates, so carry the stance across.
  function rollInitiative(conf){
    var key=conf.initSkill.toLowerCase();
    st.skill=key;
    if(st.inConflict && st.stance) st.ring=st.stance;
    save(); syncSkill(); syncRing();
    teeUpRoll({ tn:1 }, "Initiative — "+conf.initSkill);
    logEvent("action","Rolled Initiative — teed up check (TN 1, "+conf.initSkill
      +(st.inConflict&&st.stance?", "+cap(st.stance)+" stance":"")+")",
      {conflict:(conf.name||cap(st.conflictType)), stance:st.stance});
  }

  // Declare a conflict action: record it to the log, and if it involves a check,
  // tee up the roller (skill + TN where fixed) without rolling — the player rolls.
  function declareAction(conf,a){
    if(RO) return;
    var typeName=(conf.name||cap(st.conflictType));
    var teed="";
    if(a.check){
      var chk=resolveCheck(a.check);
      var parts=[];
      if(chk.tn!=null) parts.push("TN "+chk.tn);
      if(chk.skill) parts.push(SKILL_NAMES[chk.skill]||cap(chk.skill));
      else if(a.check.weapon) parts.push("no weapon readied — ready one to set the skill");
      teed = " — teed up "+(chk.opt?"optional ":"")+"check"+(parts.length?" ("+parts.join(", ")+")":"");
      teeUpRoll(chk, a.name);
    }
    logEvent("action", a.name+" ("+a.cats+")"+teed, {conflict:typeName, stance:st.stance});
  }
  function toggleActionDetail(host,a){
    if(host.getAttribute("data-for")===a.name && !host.hidden){ host.hidden=true; host.removeAttribute("data-for"); return; }
    host.setAttribute("data-for",a.name);
    host.innerHTML="<div class='cad-head'>"+a.name+" <span class='cad-cats'>"+a.cats+"</span></div>"
      +"<p class='cad-desc'>"+syms(a.desc)+"</p>"
      +"<p><b>Activation:</b> "+syms(a.activation)+"</p>"
      +"<p><b>Effects:</b> "+syms(a.effects)+"</p>"
      +(a.newOpp?"<p><b>New Opportunities:</b> "+syms(a.newOpp)+"</p>":"");
    host.hidden=false;
  }
  // "the appropriate skill for the weapon" — resolve a weapon check against the
  // readied weapon's own skill (Bō → Martial Arts [Melee]). Unreadied, the skill
  // is left alone rather than guessed at.
  function equippedWeapon(){
    if(!st.equipWeapon) return null;
    var g=(S.gear||[]).filter(function(x){ return x.name===st.equipWeapon; })[0];
    return g||null;
  }
  function resolveCheck(check){
    var c={ skill:check.skill, tn:check.tn, opt:check.opt };
    if(check.weapon){ var w=equippedWeapon(); if(w && w.skill) c.skill=w.skill; }
    return c;
  }
  // Open the roller and pre-fill skill/TN for an action or effect, WITHOUT rolling.
  function teeUpRoll(check,label){
    if(check.skill){ st.skill=check.skill; save(); syncSkill(); }
    var rc=document.getElementById("rollerCard"); if(rc) rc.classList.remove("collapsed");
    var tn=document.getElementById("rTN"); if(tn && check.tn!=null) tn.value=check.tn;
    var note=document.getElementById("rNote"); if(note && label && !note.value) note.value=label;
    syncRoller();
    if(rc) rc.scrollIntoView({behavior:"smooth",block:"start"});
  }

  // ===================== GEAR · EQUIP · COMBAT =====================
  // Kept dice keys that carry a strife (▲) result (for Fire Stance's bonus).
  var STRIFE_KEYS = { ring_ot:1, ring_st:1, ring_et:1, skill_st:1, skill_et:1 };
  function isWeaponKind(k){ return /weapon/i.test(k||""); }
  function isArmorKind(k){ return /armou?r/i.test(k||""); }
  function lastRollEntry(){ for(var i=0;i<rollLog.length;i++){ if(rollLog[i].kind!=="event") return rollLog[i]; } return null; }
  function keptStrifeCount(entry){ return (entry&&entry.kept)?entry.kept.filter(function(k){ return STRIFE_KEYS[k.key]; }).length:0; }
  function severityTier(n){
    var t=(L5RD.criticalStrike&&L5RD.criticalStrike.table)||[];
    for(var i=0;i<t.length;i++){ if(n>=t[i].min && (t[i].max==null || n<=t[i].max)) return t[i]; }
    return null;
  }

  function buildGearCard(){
    var cGear=el("div","sh-card gear");
    cGear.appendChild(el("h2",null,"Weapons, Armour &amp; Possessions"));
    (S.gear||[]).forEach(function(g){
      var weapon=isWeaponKind(g.kind), armor=isArmorKind(g.kind);
      var equipped = weapon ? (st.equipWeapon===g.name) : armor ? (st.equipArmor===g.name) : false;
      var e=el("div","entry gear-item"+(equipped?" equipped":""));
      var meta=[];
      if(g.category)meta.push(g.category);
      if(g.skill)meta.push(SKILL_NAMES[g.skill]||cap(g.skill));
      if(g.range!=null)meta.push("Range "+g.range);
      if(g.damage!=null)meta.push("Damage "+g.damage);
      if(g.deadliness!=null)meta.push("Deadliness "+g.deadliness);
      if(g.physical!=null)meta.push("Physical "+g.physical);
      if(g.supernatural)meta.push("Supernatural "+g.supernatural);
      if(g.grips)meta.push(g.grips);
      if(g.qualities&&g.qualities.length)meta.push(g.qualities.join(", "));
      if(g.rarity!=null)meta.push("Rarity "+g.rarity);
      e.innerHTML="<div class='et-head'><span class='et-name'>"+g.name+"</span>"
        +(g.kind?"<span class='et-tag ring'>"+g.kind+"</span>":"")
        +(equipped?"<span class='et-tag equip-badge'>&#9679; Active</span>":"")
        +"</div>"
        +(meta.length?"<div class='gearmeta'>"+meta.join(" · ")+"</div>":"")
        +(g.text?"<p class='et-text'>"+g.text+"</p>":"");
      if((weapon||armor) && !RO){
        var eq=el("button","equip-btn"+(equipped?" on":""), equipped?"Unequip":"Equip");
        eq.addEventListener("click",function(){ toggleEquip(g,weapon); });
        e.querySelector(".et-head").appendChild(eq);
      }
      cGear.appendChild(e);
      if(weapon && equipped && !RO) cGear.appendChild(combatPanel(g));
    });
    if (S.money) cGear.appendChild(el("p","gearmeta","Wealth: "+S.money));
    return cGear;
  }
  function toggleEquip(g,weapon){
    if(RO) return;
    var verb;
    if(weapon){ var was=st.equipWeapon===g.name; st.equipWeapon=was?null:g.name; verb=was?"Sheathed":"Readied"; }
    else { var wasA=st.equipArmor===g.name; st.equipArmor=wasA?null:g.name; verb=wasA?"Removed":"Donned"; }
    save();
    logEvent("gear",verb+" "+g.name,{attr:"equip"});
    var old=root.querySelector(".sh-card.gear");
    if(old){ var fresh=buildGearCard(); if(old.id) fresh.id=old.id; old.replaceWith(fresh); }
    // Strike's "appropriate skill for the weapon" depends on what is readied, so the
    // conflict action hints must be rebuilt whenever that changes.
    if(weapon){ var cb=root.querySelector(".conflict-body"); if(cb) renderConflict(cb); }
  }

  // Damage + Critical Strike calculators for the readied weapon. The player
  // rolls in the roller; these turn the result into damage / a critical strike.
  function combatPanel(w){
    var CS=L5RD.criticalStrike||{}, SK=L5RD.strike||{};
    var last=lastRollEntry();
    var baseBonus = last ? Math.max(0,(last.su||0)-(last.tn||0)) : 0;
    var fireOn = st.inConflict && st.stance==="fire";
    var fireBonus = fireOn ? keptStrifeCount(last) : 0;
    var wrap=el("div","combat-panel");
    wrap.innerHTML="<div class='cp-title'>&#9876; Strike with "+w.name+"<span class='cp-sub'>Damage "+w.damage+" &middot; Deadliness "+w.deadliness+(w.range?" &middot; Range "+w.range:"")+"</span></div>";

    var dmg=el("div","cp-block");
    dmg.innerHTML="<div class='cp-h'>Damage</div>"
      +"<p class='cp-rule'>"+syms(SK.effect||"")+"</p>"
      +"<div class='cp-row'>"
      +"<label class='cp-f'><span class='cp-cap'>Base</span><b>"+w.damage+"</b></label>"
      +"<label class='cp-f'><span class='cp-cap'>Bonus successes</span><input type='number' min='0' class='cp-in' id='cpBonus' value='"+baseBonus+"'></label>"
      +(fireOn?"<label class='cp-f cp-fire' title=\""+String(SK.fireStance||"").replace(/"/g,"&quot;")+"\"><span class='cp-cap'>Fire Stance (kept &#9650;)</span><input type='number' min='0' class='cp-in' id='cpFire' value='"+fireBonus+"'></label>":"")
      +"</div>"
      +"<div class='cp-actions'><button class='roll-btn' id='cpDealBtn'>Calculate Damage</button>"
      +(last?"<button class='roll-btn ghost cp-sync' id='cpSync' title='Pull bonus successes from your last kept roll'>&#8635; from last roll</button>":"")
      +"<span class='cp-out' id='cpDmgOut'></span></div>";
    wrap.appendChild(dmg);

    var crit=el("div","cp-block");
    crit.innerHTML="<div class='cp-h'>Critical Strike</div>"
      +"<p class='cp-rule'>"+syms(SK.critOpportunity||"")+"</p>"
      +"<div class='cp-row'>"
      +"<label class='cp-f'><span class='cp-cap'>Severity before reductions</span><input type='number' min='0' class='cp-in' id='cpSev' value='"+w.deadliness+"'><span class='cp-tag'>= deadliness</span></label>"
      +"<label class='cp-f'><span class='cp-cap'>Reduced by</span><input type='number' min='0' class='cp-in' id='cpRed' value='0'></label>"
      +"</div>"
      +"<p class='cp-rule cp-fine'>"+syms(CS.resist||"")+"</p>"
      +"<div class='cp-actions'><button class='roll-btn' id='cpCritBtn'>Resolve Critical Strike</button></div>"
      +"<div class='cp-crit-out' id='cpCritOut'></div>";
    wrap.appendChild(crit);

    setTimeout(function(){ wireCombat(wrap,w); },0);
    return wrap;
  }
  function wireCombat(wrap,w){
    function num(id){ var e=wrap.querySelector("#"+id); return e?Math.max(0,parseInt(e.value||"0",10)||0):0; }
    var out=wrap.querySelector("#cpDmgOut");
    function calcDamage(logIt){
      var bonus=num("cpBonus"), fire=wrap.querySelector("#cpFire")?num("cpFire"):0;
      var total=(w.damage||0)+bonus+fire;
      var breakdown=w.damage+" base"+(bonus?" + "+bonus+" bonus":"")+(fire?" + "+fire+" Fire Stance":"");
      out.innerHTML="<b>"+total+"</b> physical damage <span class='cp-break'>("+breakdown+")</span>";
      if(logIt) logEvent("damage","Strike with "+w.name+" — "+total+" physical damage ("+breakdown+")",{attr:"damage",total:total});
      return total;
    }
    wrap.querySelector("#cpDealBtn").addEventListener("click",function(){ calcDamage(true); });
    var sync=wrap.querySelector("#cpSync");
    if(sync) sync.addEventListener("click",function(){
      var last=lastRollEntry(); if(!last) return;
      wrap.querySelector("#cpBonus").value=Math.max(0,(last.su||0)-(last.tn||0));
      var f=wrap.querySelector("#cpFire"); if(f) f.value=keptStrifeCount(last);
      calcDamage(false);
    });
    var cout=wrap.querySelector("#cpCritOut");
    wrap.querySelector("#cpCritBtn").addEventListener("click",function(){
      var before=num("cpSev"), red=num("cpRed"), final=Math.max(0,before-red);
      var tier=severityTier(final);
      cout.innerHTML="<div class='cp-sev'>Severity <b>"+final+"</b> <span class='cp-break'>("+before+" before &minus; "+red+" reduced)</span></div>"
        +(tier?"<div class='cp-tier'><span class='cp-tier-name'>"+tier.label+" &middot; "+tier.min+(tier.max!=null?"&ndash;"+tier.max:"+")+"</span><p class='cp-tier-desc'>"+escapeHTML(tier.desc)+"</p><p class='cp-tier-eff'>"+syms(tier.effect)+"</p></div>":"");
      logEvent("critical","Critical Strike with "+w.name+" — severity "+final+" ("+before+" − "+red+" reduced): "+(tier?tier.label:"?"),{attr:"critical",severity:final});
    });
  }

  // ===================== ROLLER =====================
  // Roll & Keep, played by the rules: the player keeps dice (nothing is kept
  // automatically), chooses whether to explode kept (ex) dice, may reroll dice
  // for advantages/disadvantages, add Assistance dice, or spend a Void point.
  var pool=[];       // die objects: {type,key,su,ex,op,st,kept,bonus,explodedDone}
  var curKeep=0;     // keep limit locked in at roll time
  var rollLogged=false;
  var rollMeta=null; // full provenance of the current roll (for the log)
  var rollCtx=null;  // technique-activation context (source, Blood of the Kami, etc.)
  var rrMode=null;   // active reroll mode (advantage/disadvantage/free) while marking dice
  var cfg={ assistSkill:0, assistRing:0, voidSpend:false, unknownTN:false, unknownTNGranted:false };
  function voidMax(){ return (S.trackers&&S.trackers["void"]&&S.trackers["void"].max)||0; }
  // "Gain 1 when GM conceals TN of a check" — claim a Void point (capped at the
  // Void ring maximum) the moment the player marks a check's TN as unknown.
  function claimUnknownTN(chk){
    if(RO){ chk.checked=false; return; }
    if(!chk.checked){ cfg.unknownTN=false; return; }
    cfg.unknownTN=true;
    if(rollMeta){ rollMeta.unknownTN=true; if(pool.length) tally(); }   // reflect on an assembled roll
    if(cfg.unknownTNGranted) return;      // already claimed for this roll setup
    cfg.unknownTNGranted=true;
    chk.disabled=true;                    // lock so the point can't be re-claimed
    var from=st["void"]||0, max=voidMax();
    if(from<max){
      st["void"]=from+1; save(); syncTracker("void"); syncRoller();
      logEvent("void","Unknown TN — GM concealed the TN: Void "+from+" → "+(from+1)+" (gained)",{attr:"void",from:from,to:from+1,delta:1});
    } else {
      logEvent("void","Unknown TN — GM concealed the TN (already at maximum Void, no point gained)",{attr:"void",from:from,to:from,delta:0});
    }
  }
  var RRADV=(S.peculiarities||[]).filter(function(p){ return p.reroll; }).map(function(p){
    return { id:p.name, label:p.name, approach:p.reroll.approach, max:p.reroll.max||2, successOnly:!!p.reroll.successOnly, mustMax:!!p.reroll.mustMax };
  });

  function buildRoller(){
    var c=el("div","sh-card span2 roller collapsed"); c.id="rollerCard";
    c.innerHTML=""
      +"<button class='roller-toggle' id='rollerToggle' aria-expanded='false'>"
      +"  <span class='rt-title'>Roll &amp; Keep</span>"
      +"  <span class='rt-current' id='rtCurrent'></span>"
      +"  <span class='rt-chevron'>&#9656;</span>"
      +"</button>"
      +"<div class='roller-body' id='rollerBody'>"
      +"  <div class='roller-tabs'><button class='rtab sel' data-tab='roll'>Roll</button><button class='rtab' data-tab='log'>Log <span class='logcount' id='rLogCount'></span></button></div>"
      +"  <div class='roller-tab tp-roll' data-tab='roll'>"
      +"    <div class='r-controls'>"
      +"      <div class='r-field'><label>Ring</label><span class='r-pick' id='rRing'></span></div>"
      +"      <div class='r-field'><label>Skill</label><span class='r-pick' id='rSkill'></span></div>"
      +"      <div class='r-field r-tn'><label>TN</label><input id='rTN' type='number' min='0' value='2'></div>"
      +"      <div class='r-field r-unktn'><label>Difficulty</label><label class='vchk' title='If the GM does not reveal the TN, gain 1 Void point (to a maximum of your Void ring).'><input type='checkbox' id='rUnknownTN'> Unknown TN <span class='vgrant'>+1 Void</span></label></div>"
      +"      <div class='r-field'><label>Assist &mdash; skilled</label><span class='stepper' data-cfg='assistSkill'></span></div>"
      +"      <div class='r-field'><label>Assist &mdash; unskilled</label><span class='stepper' data-cfg='assistRing'></span></div>"
      +"      <div class='r-field'><label>Void <span id='rVoidHave' class='vhave'></span></label><label class='vchk'><input type='checkbox' id='rVoid'> Seize the Moment</label></div>"
      +"    </div>"
      +"    <div class='r-noterow'><label class='r-notelabel'>Concerning</label><input type='text' id='rNote' class='r-note' placeholder='What is this roll about? (optional — saved to the log)' maxlength='140'></div>"
      +"    <div class='r-actions'><button class='roll-btn' id='rRoll'>Assemble &amp; Roll</button><button class='roll-btn ghost' id='rClear'>Clear</button><span class='r-summary' id='rSummary'></span></div>"
      +"    <p class='r-hint'><b>Click dice to keep</b> &mdash; nothing is kept for you. <b>&#8635;</b> rerolls a die (for advantages or disadvantages). A kept <b>explosive</b> (&#10057;) die shows an explode button to roll a bonus die, which you may keep or drop.</p>"
      +"    <div class='dice-row' id='rDice'></div>"
      +"    <div class='reroll-bar' id='rRerollBar'></div>"
      +"    <div class='r-result' id='rResult'></div>"
      +"    <div class='opp-panel collapsed' id='oppPanel'>"
      +"      <button class='opp-toggle' id='oppToggle'><span>Opportunity spends (&#9672;)</span><span class='rt-chevron'>&#9656;</span></button>"
      +"      <div class='opp-body' id='oppBody'></div>"
      +"    </div>"
      +"    <p class='legend'><span>Dark <b>d6</b> = Ring die</span><span>Light <b>d12</b> = Skill die</span><span>Assist / Void add a die <em>and</em> a keep; Void spends a point.</span></p>"
      +"  </div>"
      +"  <div class='roller-tab tp-log' data-tab='log' id='rLog' hidden></div>"
      +"</div>";
    setTimeout(function(){
      c.querySelector("#rollerToggle").addEventListener("click",function(){
        var open=!c.classList.toggle("collapsed");
        this.setAttribute("aria-expanded", open?"true":"false");
      });
      c.querySelectorAll(".rtab").forEach(function(b){
        b.addEventListener("click",function(){
          var t=b.getAttribute("data-tab");
          c.querySelectorAll(".rtab").forEach(function(x){ x.classList.toggle("sel",x===b); });
          c.querySelector(".tp-roll").hidden=(t!=="roll");
          c.querySelector(".tp-log").hidden=(t!=="log");
          if(t==="log") renderLog();
        });
      });
      buildStepper(c.querySelector("[data-cfg='assistSkill']"),"assistSkill");
      buildStepper(c.querySelector("[data-cfg='assistRing']"),"assistRing");
      c.querySelector("#rRoll").addEventListener("click",function(){ rollCtx=null; doRoll(); });
      c.querySelector("#rClear").addEventListener("click",clearRoll);
      c.querySelector("#rVoid").addEventListener("change",function(){ cfg.voidSpend=this.checked; });
      c.querySelector("#rUnknownTN").addEventListener("change",function(){ claimUnknownTN(this); });
      c.querySelector("#rTN").addEventListener("input",function(){ if(pool.length) tally(); });
      c.querySelector("#oppToggle").addEventListener("click",function(){ document.getElementById("oppPanel").classList.toggle("collapsed"); });
      syncRoller();
      renderOpp();
      updateLogCount();
    },0);
    return c;
  }

  function renderOpp(){
    var body=document.getElementById("oppBody"); if(!body) return;
    if(!L5RD.oppTables.length){ body.innerHTML=""; return; }
    st.oppTable = st.oppTable || "general";
    body.innerHTML="";
    var chips=el("div","opp-chips");
    L5RD.oppTables.forEach(function(t){
      var b=el("button","opp-chip"+(st.oppTable===t[0]?" sel":""),t[1]);
      b.addEventListener("click",function(){ st.oppTable=t[0]; save(); renderOpp(); });
      chips.appendChild(b);
    });
    body.appendChild(chips);
    body.appendChild(el("div","opp-ringnote","Spends for your <b>"+cap(st.ring)+"</b> approach. Spend <span class='sym op'>◈</span> opportunity from your kept dice."));
    var table=L5RD.opportunities[st.oppTable]||{};
    var list=el("div","opp-list");
    if(table.any) list.appendChild(oppGroup("Any approach", table.any, false));
    if(table[st.ring]) list.appendChild(oppGroup(cap(st.ring)+" approach", table[st.ring], true));
    else if(!table.any) list.appendChild(el("div","opp-empty","No "+cap(st.ring)+" opportunities listed for this context."));
    var techs=(L5RD.techniqueOpportunities||[]).filter(function(t){ return t.ring===st.ring; });
    if(techs.length) list.appendChild(oppGroup("From your techniques", techs.map(function(t){ return "<b>"+t.name+":</b> "+t.text; }), true));
    body.appendChild(list);
  }
  function oppGroup(label,items,hi){
    var g=el("div","opp-group"+(hi?" hi":""));
    g.appendChild(el("div","opp-gl",label));
    items.forEach(function(s){ var e=el("div","opp-item"); e.innerHTML=syms(s); g.appendChild(e); });
    return g;
  }

  function buildStepper(host,key){
    host.innerHTML="<button class='st-btn' data-d='-1' aria-label='decrease'>&minus;</button><span class='st-val'>0</span><button class='st-btn' data-d='1' aria-label='increase'>+</button>";
    var val=host.querySelector(".st-val");
    host.querySelectorAll(".st-btn").forEach(function(b){
      b.addEventListener("click",function(){
        cfg[key]=Math.max(0,Math.min(6,(cfg[key]||0)+parseInt(b.getAttribute("data-d"),10)));
        val.textContent=cfg[key];
      });
    });
  }

  function ringN(){ return S.rings[st.ring]||0; }
  function skillN(){ return st.skill?(S.skills[st.skill]||0):0; }
  function skillLabel(){ return st.skill?((SKILL_NAMES[st.skill]||cap(st.skill))+" "+skillN()):"— none —"; }
  function syncRoller(){
    var rr=document.getElementById("rRing"); if(!rr) return;
    rr.textContent=cap(st.ring)+" "+ringN();
    document.getElementById("rSkill").textContent=skillLabel();
    var cur=document.getElementById("rtCurrent");
    if(cur) cur.textContent=cap(st.ring)+" "+ringN()+(st.skill?"  ·  "+skillLabel():"");
    var vh=document.getElementById("rVoidHave"); if(vh) vh.textContent="("+(st["void"]||0)+" held)";
    var sum=document.getElementById("rSummary");
    if(sum) sum.innerHTML="Base pool <b>"+(ringN()+skillN())+"</b> · keep <b>"+ringN()+"</b>";
    renderOpp();
  }

  function rollFace(type){
    var faces=type==="ring"?RING_FACES:SKILL_FACES;
    var f=faces[Math.floor(Math.random()*faces.length)];
    return { type:type, key:f.key, su:f.su||0, ex:f.ex||0, op:f.op||0, st:f.st||0, kept:false, bonus:false, explodedDone:false };
  }

  function doRoll(){
    rollLogged=false; rrMode=null;
    var spendVoid = cfg.voidSpend && (st["void"]||0)>=1;
    var extraRing = cfg.assistRing + (spendVoid?1:0);
    var extraSkill = cfg.assistSkill;
    pool=[]; var i;
    for(i=0;i<ringN()+extraRing;i++) pool.push(rollFace("ring"));
    for(i=0;i<skillN()+extraSkill;i++) pool.push(rollFace("skill"));
    curKeep = ringN() + cfg.assistRing + cfg.assistSkill + (spendVoid?1:0);
    rollMeta = {
      ring: st.ring, ringN: ringN(),
      skillLabel: st.skill ? (SKILL_NAMES[st.skill]||cap(st.skill)) : null, skillN: skillN(),
      assistSkill: cfg.assistSkill, assistRing: cfg.assistRing, voidSpent: spendVoid,
      unknownTN: !!cfg.unknownTN, disUsed: null, disClaimed: false,
      keepLimit: curKeep,
      initial: pool.map(function(d){ return { type:d.type, key:d.key }; }),
      events: [],
      source: rollCtx ? rollCtx.source : null,
      activation: rollCtx ? rollCtx.activation : null,
      bloodOfKami: rollCtx ? !!rollCtx.bloodOfKami : false,
      inConflict: !!st.inConflict, stance: st.inConflict ? st.stance : null,
      conflictType: st.inConflict ? st.conflictType : null,
      conflictName: st.inConflict ? (st.conflictName||null) : null
    };
    if(spendVoid){ st["void"]=Math.max(0,(st["void"]||0)-1); save(); syncTracker("void"); syncRoller(); }
    var vc=document.getElementById("rVoid"); if(vc) vc.checked=false; cfg.voidSpend=false;
    renderDice(); tally();
  }
  function clearRoll(){ pool=[]; renderDice(); document.getElementById("rResult").classList.remove("show"); }

  function keptBase(){ return pool.filter(function(d){ return d.kept && !d.bonus; }).length; }

  function renderDice(){
    var row=document.getElementById("rDice"); row.innerHTML="";
    if(!pool.length){ document.getElementById("rResult").classList.remove("show"); renderRerollBar(); return; }
    ["ring","skill"].forEach(function(type){
      var group=pool.filter(function(d){ return d.type===type; });
      if(!group.length) return;
      row.appendChild(el("div","dice-group-label",(type==="ring"?"Ring Dice (d6)":"Skill Dice (d12)")));
      group.forEach(function(d){ row.appendChild(makeDie(d)); });
    });
    renderRerollBar();
  }
  function makeDie(d){
    var die=el("div","die "+d.type+(d.kept?" kept":"")+(d.bonus?" bonus":"")+(d.markedReroll?" marked":""));
    die.title=faceTitle(d);
    var canExplode = d.kept && d.ex>0 && !d.explodedDone;
    die.innerHTML="<img class='face' src='../assets/dice/"+d.key+".svg' alt=''>"
      +"<span class='dtype'>"+(d.type==="ring"?"d6":"d12")+"</span>"
      +"<button class='die-op reroll"+(d.markedReroll?" active":"")+"' title='Mark for reroll'>&#8635;</button>"
      +(canExplode?"<button class='die-op explode' title='Explode: roll a bonus die'>&#10057;</button>":"");
    die.addEventListener("click",function(){ toggleKeep(d); });
    die.querySelector(".reroll").addEventListener("click",function(e){ e.stopPropagation(); toggleRerollMark(d); });
    var ex=die.querySelector(".explode"); if(ex) ex.addEventListener("click",function(e){ e.stopPropagation(); explodeDie(d); });
    return die;
  }
  function toggleKeep(d){
    if(!d.kept && !d.bonus && keptBase()>=curKeep) return; // base keep limit
    d.kept=!d.kept;
    renderDice(); tally();
  }

  // ---- reroll marking (advantages / disadvantages / free reroll) ----
  function successDie(d){ return ((d.su||0)+(d.ex||0))>0; }
  function markedDice(){ return pool.filter(function(d){ return d.markedReroll; }); }
  function setRerollMode(m){ rrMode=m; pool.forEach(function(d){ d.markedReroll=false; }); renderDice(); }
  function rerollNeed(){ if(!rrMode) return 0; if(rrMode.mustMax){ return Math.min(rrMode.max||2, pool.filter(successDie).length); } return rrMode.max||2; }
  function toggleRerollMark(d){
    if(RO || !rrMode) return;
    if(d.markedReroll){ d.markedReroll=false; renderDice(); return; }
    if(rrMode.successOnly && !successDie(d)) return;
    var max = rrMode.free ? Infinity : (rrMode.max||2);
    if(markedDice().length>=max) return;
    d.markedReroll=true; renderDice();
  }
  function executeReroll(){
    var marked=markedDice(); if(!marked.length) return;
    var via=rrMode?rrMode.label:"Reroll";
    // An Adversity (a "success-only" reroll, e.g. Elemental Deficiency) grants a
    // Void point if the check ultimately fails — offered to claim once resolved.
    if(rollMeta && rrMode && rrMode.successOnly) rollMeta.disUsed=rrMode.label;
    marked.forEach(function(d){
      var from=d.key, f=rollFace(d.type);
      d.key=f.key; d.su=f.su; d.ex=f.ex; d.op=f.op; d.st=f.st; d.explodedDone=false; d.markedReroll=false;
      if(rollMeta) rollMeta.events.push({ kind:"reroll", type:d.type, from:from, to:f.key, via:via });
    });
    rrMode=null;
    renderDice(); tally();
  }
  function labelWithIcon(name){ return name.replace(/\((Air|Earth|Fire|Water|Void)\)/g,function(m,r){ return ringIcon(r.toLowerCase()); }); }
  function renderRerollBar(){
    var bar=document.getElementById("rRerollBar"); if(!bar) return;
    bar.innerHTML="";
    if(!pool.length) return;
    var row=el("div","rr-modes");
    RRADV.forEach(function(a){
      var off = a.approach && a.approach!==st.ring;
      var b=el("button","rr-mode"+(a.successOnly?" dis":" adv")+(rrMode&&rrMode.id===a.id?" sel":"")+(off?" off":""));
      b.innerHTML=labelWithIcon(a.label);
      b.title=(a.successOnly?"Disadvantage":"Advantage")+(off?" — off-approach":"");
      b.addEventListener("click",function(){ if(RO) return; setRerollMode(rrMode&&rrMode.id===a.id?null:a); });
      row.appendChild(b);
    });
    var free={ id:"free", label:"Free Reroll", free:true };
    var fb=el("button","rr-mode free"+(rrMode&&rrMode.id==="free"?" sel":""),"Free Reroll");
    fb.title="GM-requested reroll — any number of dice";
    fb.addEventListener("click",function(){ if(RO) return; setRerollMode(rrMode&&rrMode.id==="free"?null:free); });
    row.appendChild(fb);
    bar.appendChild(row);
    if(rrMode){
      var need=rerollNeed(), marks=markedDice().length;
      var hint = rrMode.free ? "Click the ↻ on any dice to mark them, then reroll."
        : rrMode.successOnly ? ("Mark "+need+" success "+(need===1?"die":"dice")+" (↻) to reroll — the deficiency compels it.")
        : ("Mark up to "+(rrMode.max||2)+" dice (↻) to reroll.");
      bar.appendChild(el("div","rr-hint",hint));
      if(marks>=1){
        var canGo = rrMode.free ? true : (rrMode.mustMax ? (marks===need) : true);
        var go=el("button","roll-btn rr-go","Reroll "+marks+" "+(marks===1?"die":"dice"));
        if(canGo) go.addEventListener("click",executeReroll); else { go.disabled=true; go.title="Mark "+need+" dice"; }
        bar.appendChild(go);
      }
    }
  }
  function explodeDie(d){
    d.explodedDone=true;
    var nd=rollFace(d.type); nd.bonus=true; nd.kept=true;
    pool.splice(pool.indexOf(d)+1,0,nd);
    if(rollMeta) rollMeta.events.push({ kind:"explode", type:d.type, source:d.key, result:nd.key });
    renderDice(); tally();
  }

  function tally(){
    var kept=pool.filter(function(d){ return d.kept; });
    var su=0,op=0,stf=0,bonusKept=0;
    kept.forEach(function(d){ su+=d.su+d.ex; op+=d.op; stf+=d.st; if(d.bonus) bonusKept++; });
    var tn=parseInt(document.getElementById("rTN").value||"0",10);
    var res=document.getElementById("rResult");
    var pass=su>=tn;
    var bok = (rollCtx && rollCtx.bloodOfKami && pass) ? (rollCtx.schoolRank||0) : 0;
    var totalSu = su + bok;
    var voidStance = st.inConflict && st.stance==="void";
    var strifeApplied = voidStance ? 0 : stf;
    res.className="r-result show";
    var applyBar;
    if(rollLogged){
      applyBar="<div class='applybar'><span class='kept-tag'>✓ Results kept &amp; logged</span></div>";
    } else {
      applyBar="<div class='applybar'>"
        +"<label class='strife-sel'>Keep strife <input type='number' id='rStrife' min='0' max='"+stf+"' value='"+strifeApplied+"'></label>"
        +"<span class='of-max'>of "+stf+" rolled</span>"
        +"<button class='roll-btn' id='rKeep'>Keep Results</button>"
        +(voidStance&&stf>0?"<span class='r-summary'>Void stance: ▲ on kept dice give no strife</span>":"")
        +"</div>";
    }
    var m0=rollMeta||{};
    var disRow="";
    if(m0.disUsed && !pass){
      var scClaimed = st.sceneVoidClaims && st.sceneVoidClaims[m0.disUsed];
      disRow = "<div class='dis-void-row'>"
        +(m0.disClaimed
           ? "<span class='kept-tag'>✓ +1 Void claimed — "+escapeHTML(m0.disUsed)+"</span>"
           : scClaimed
             ? "<span class='of-max'>"+escapeHTML(m0.disUsed)+" — already claimed this scene</span>"
             : "<button class='roll-btn ghost dis-void' id='rDisVoid'>+1 Void — "+escapeHTML(m0.disUsed)+" (failed check)</button>")
        +(m0.disClaimed||scClaimed?"":"<span class='of-max'>once per scene, per disadvantage</span>")
        +"</div>";
    }
    res.innerHTML=""
      +"<div class='verdict "+(pass?"pass":"fail")+"'>"+(pass?"Success":"Failure")+" &mdash; "+totalSu+" vs TN "+tn+(m0.unknownTN?" <span class='unk-tn'>(TN was unknown)</span>":"")+"</div>"
      +disRow
      +(rollCtx&&rollCtx.source?"<div class='r-source'>via "+rollCtx.source+(rollCtx.activation?" — "+rollCtx.activation:"")+"</div>":"")
      +(bok?"<div class='r-bok'>+"+bok+" bonus success from <b>Blood of the Kami</b></div>":"")
      +"<div class='tallies'><span>Kept <b>"+keptBase()+"/"+curKeep+"</b>"+(bonusKept?" <em>+"+bonusKept+" bonus die</em>":"")+"</span><span>Successes <b class='sym su' style='color:#3f8f5a'>"+totalSu+"</b>"+(bok?" <em>(incl +"+bok+")</em>":"")+"</span><span>Opportunity <b class='sym op' style='color:#c08a1e'>"+op+"</b></span><span>Strife <b class='sym st' style='color:#b0642a'>"+stf+"</b></span></div>"
      +applyBar;
    if(!rollLogged){
      document.getElementById("rKeep").addEventListener("click",function(){
        var amt=Math.max(0,Math.min(stf,parseInt(document.getElementById("rStrife").value||"0",10)));
        keepResults(amt, totalSu, op, stf, tn, pass, bok);
      });
    }
    var dv=document.getElementById("rDisVoid");
    if(dv) dv.addEventListener("click",claimDisVoid);
  }
  // Claim the Void point an Adversity grants on a failed check (player-driven so the
  // "once per scene, per disadvantage" limit stays in the player's hands).
  function claimDisVoid(){
    if(RO || !rollMeta || rollMeta.disClaimed) return;
    if(!st.sceneVoidClaims) st.sceneVoidClaims={};
    if(st.sceneVoidClaims[rollMeta.disUsed]) return;   // already claimed this scene
    rollMeta.disClaimed=true;
    st.sceneVoidClaims[rollMeta.disUsed]=true;
    var from=st["void"]||0, max=voidMax();
    if(from<max){
      st["void"]=from+1; save(); syncTracker("void"); syncRoller();
      logEvent("void",escapeHTML(rollMeta.disUsed)+" — failed check: Void "+from+" → "+(from+1)+" (gained)",{attr:"void",from:from,to:from+1,delta:1});
    } else {
      save();
      logEvent("void",escapeHTML(rollMeta.disUsed)+" — failed check (already at maximum Void, no point gained)",{attr:"void",from:from,to:from,delta:0});
    }
    tally();
  }

  function keepResults(strifeAmt, su, op, stfRolled, tn, pass, bokBonus){
    if(RO) return;
    st.strife=(st.strife||0)+strifeAmt; save(); syncTracker("strife");   // no upper clamp — strife may exceed its maximum
    var kept=pool.filter(function(d){ return d.kept; });
    var keptBaseCount=kept.filter(function(d){ return !d.bonus; }).length;
    var bonusKept=kept.filter(function(d){ return d.bonus; }).length;
    var noteEl=document.getElementById("rNote");
    var note=noteEl && noteEl.value ? noteEl.value.trim() : "";
    var m=rollMeta||{};
    rollLog.unshift({
      n: rollLog.length+1,
      note: note,
      ring: m.ring||st.ring, ringN: (m.ringN!=null?m.ringN:ringN()),
      skillLabel: m.skillLabel!==undefined ? m.skillLabel : (st.skill?(SKILL_NAMES[st.skill]||cap(st.skill)):null),
      skillN: m.skillN,
      assistSkill: m.assistSkill||0, assistRing: m.assistRing||0, voidSpent: !!m.voidSpent,
      unknownTN: !!m.unknownTN,
      keepLimit: (m.keepLimit!=null?m.keepLimit:curKeep),
      keptBaseCount: keptBaseCount, bonusKept: bonusKept,
      keptFewer: keptBaseCount < (m.keepLimit!=null?m.keepLimit:curKeep),
      initial: m.initial||[], events: m.events||[],
      source: m.source||null, activation: m.activation||null, bokBonus: bokBonus||0, conflictName: m.conflictName||null,
      tn: tn, su: su, op: op, strifeRolled: stfRolled, strifeApplied: strifeAmt, pass: pass,
      inConflict: !!m.inConflict, stance: m.stance||null, conflictType: m.conflictType||null,
      kept: kept.map(function(d){ return { type:d.type, key:d.key, bonus:!!d.bonus }; }),
      when: nowStr()
    });
    saveLog();
    updateLogCount();
    renderLog();
    resetRoll();
  }

  // Clear the Roll & Keep interface for the next roll.
  function resetRoll(){
    pool=[]; rollMeta=null; rollCtx=null; rrMode=null; rollLogged=false;
    cfg={ assistSkill:0, assistRing:0, voidSpend:false, unknownTN:false, unknownTNGranted:false };
    var dice=document.getElementById("rDice"); if(dice) dice.innerHTML="";
    var res=document.getElementById("rResult"); if(res){ res.classList.remove("show"); res.innerHTML=""; }
    var note=document.getElementById("rNote"); if(note) note.value="";
    var vc=document.getElementById("rVoid"); if(vc) vc.checked=false;
    var utn=document.getElementById("rUnknownTN"); if(utn){ utn.checked=false; utn.disabled=false; }
    var tn=document.getElementById("rTN"); if(tn) tn.value="2";
    document.querySelectorAll(".roller .stepper .st-val").forEach(function(v){ v.textContent="0"; });
    syncRoller();
    var sum=document.getElementById("rSummary"); if(sum) sum.innerHTML="✓ Roll kept &amp; logged — ready for the next.";
  }

  function updateLogCount(){ var e=document.getElementById("rLogCount"); if(e) e.textContent=rollLog.length?("("+rollLog.length+")"):""; }
  function logDie(k){ return "<img class='logdie "+k.type+(k.bonus?" bonus":"")+"' src='../assets/dice/"+k.key+".svg' alt=''>"; }
  function diceRow(list){ return (list||[]).map(function(k){ return logDie(k); }).join(""); }
  function renderLog(){
    var host=document.getElementById("rLog"); if(!host) return;
    if(!rollLog.length){ host.innerHTML="<p class='r-hint'>No rolls kept yet. Roll, then <b>Keep Results</b> to record one here.</p>"; return; }
    host.innerHTML="<div class='log-actions'><span class='r-summary'>"+rollLog.length+" recorded</span><button class='link-btn' id='logClear'>Clear log</button></div>";
    var EVICON={condition:"☷",social:"❖",stake:"⚑",strife:"▲",fatigue:"✦",voidp:"◇","void":"◇",technique:"❁",action:"⚔",scene:"⟳",gear:"⚒",damage:"⚔",critical:"✖"};
    rollLog.forEach(function(e){
      if(e.kind==="event"){
        var ev=el("div","log-event cat-"+(e.cat||"misc"));
        ev.innerHTML="<span class='le-cat'>"+(EVICON[e.cat]||"·")+" "+cap(e.cat||"event")+"</span>"
          +"<span class='le-desc'>"+escapeHTML(e.desc||"")+"</span>"
          +(e.when?"<span class='log-when'>"+e.when+"</span>":"");
        host.appendChild(ev); return;
      }
      var d=el("div","log-entry "+(e.pass?"pass":"fail"));

      // config chips: keep, assist, void
      var chips=[];
      if(e.keepLimit!=null){
        var kc="Kept "+(e.keptBaseCount!=null?e.keptBaseCount:(e.kept?e.kept.length:0))+" of "+e.keepLimit;
        if(e.bonusKept) kc+=" +"+e.bonusKept+" bonus";
        chips.push("<span class='logchip"+(e.keptFewer?" warn":"")+"'>"+kc+(e.keptFewer?" — fewer than allowed":"")+"</span>");
      }
      if(e.assistSkill) chips.push("<span class='logchip'>Assist +"+e.assistSkill+" skilled</span>");
      if(e.assistRing) chips.push("<span class='logchip'>Assist +"+e.assistRing+" unskilled</span>");
      if(e.voidSpent) chips.push("<span class='logchip void'>Void point spent</span>");
      if(e.unknownTN) chips.push("<span class='logchip'>Unknown TN</span>");
      if(e.conflictType) chips.push("<span class='logchip'>"+cap(e.conflictType)+"</span>");

      // reroll / explode events
      var evRows="";
      (e.events||[]).forEach(function(ev){
        if(ev.kind==="reroll") evRows+="<div class='log-ev'><span class='ev-tag'>↻ reroll"+(ev.via?" · "+escapeHTML(ev.via):"")+"</span>"+logDie({type:ev.type,key:ev.from})+"<span class='ev-arrow'>→</span>"+logDie({type:ev.type,key:ev.to})+"</div>";
        else if(ev.kind==="explode") evRows+="<div class='log-ev'><span class='ev-tag'>✦ explode</span>"+logDie({type:ev.type,key:ev.source})+"<span class='ev-arrow'>→</span>"+logDie({type:ev.type,key:ev.result,bonus:true})+"</div>";
      });

      d.innerHTML=""
        +"<div class='log-head'><span class='log-verdict'>"+(e.pass?"Success":"Failure")+"</span>"
        +"<span class='log-approach'>"+cap(e.ring)+" "+e.ringN+(e.skillLabel?" · "+e.skillLabel+(e.skillN!=null?" "+e.skillN:""):"")+(e.stance?" · "+cap(e.stance)+" stance":"")+(e.conflictName?" · “"+escapeHTML(e.conflictName)+"”":"")+"</span>"
        +(e.when?"<span class='log-when'>"+e.when+"</span>":"")+"</div>"
        +(e.source?"<div class='log-source'>via "+e.source+(e.activation?" — "+e.activation:"")+(e.bokBonus?" · +"+e.bokBonus+" Blood of the Kami":"")+"</div>":"")
        +(e.note?"<div class='log-note'>"+escapeHTML(e.note)+"</div>":"")
        +(chips.length?"<div class='log-chips'>"+chips.join("")+"</div>":"")
        +(e.initial&&e.initial.length?"<div class='log-line'><span class='log-lbl'>Rolled</span><span class='log-dice'>"+diceRow(e.initial)+"</span></div>":"")
        +(evRows?"<div class='log-events'>"+evRows+"</div>":"")
        +"<div class='log-line'><span class='log-lbl'>Kept</span><span class='log-dice'>"+diceRow(e.kept)+"</span></div>"
        +"<div class='log-tally'>"+e.su+" vs TN "+e.tn+"  ·  <span class='sym op'>◈</span> "+e.op+"  ·  <span class='sym st'>▲</span> "+e.strifeApplied+" applied"+(e.strifeRolled!==e.strifeApplied?" (of "+e.strifeRolled+" rolled)":"")+"</div>";
      host.appendChild(d);
    });
    var c=document.getElementById("logClear");
    if(c) c.addEventListener("click",function(){ if(RO) return; rollLog=[]; saveLog(); updateLogCount(); renderLog(); });
  }

  // ---- version switching ----
  function switchVersion(id){
    var v=verById(id)||VERSIONS[0];
    curView=v.id; RO=!v.live; S=v.data; SNAP = v.live ? null : (v.data.state||{});
    buildVersionPicker();
    render();
  }
  function buildVersionPicker(){
    var host=document.getElementById("verPicker"); if(!host) return;
    var s="<label class='ver-label'>Sheet</label><select id='verSel'"+(VERSIONS.length<=1?" title='Prior sessions appear here once recorded'":"")+">";
    VERSIONS.forEach(function(v){ s+="<option value='"+v.id+"'"+(v.id===curView?" selected":"")+">"+v.label+(v.date?" · "+v.date:"")+"</option>"; });
    s+="</select>";
    host.innerHTML=s;
    document.getElementById("verSel").addEventListener("change",function(){ switchVersion(this.value); });
  }

  // ===================== SIDE RAILS =====================
  // Two optional fixed rails flanking the sheet: section nav on the left, live
  // trackers on the right. They sit outside #sheet so render() does not wipe them,
  // and CSS hides them when the viewport is too narrow to hold them beside the sheet.
  var RAILKEY="pf-rails-"+(CURRENT.id||"pc");
  var railsOn=true;
  try { var rp=localStorage.getItem(RAILKEY); if(rp!=null) railsOn=(rp==="1"); } catch(e){}
  var railL=null, railR=null, railBtn=null;
  var RAIL_SHORT={
    "Rings & Approach":"Rings", "Distinctions, Adversities, Passions & Anxieties":"Traits",
    "Weapons, Armour & Possessions":"Gear", "Bushidō & Motivation":"Motivation",
    "Titles & Bonds":"Titles", "Social Standing":"Standing"
  };

  function buildRailToggle(){
    var bar=document.querySelector(".play-bar"); if(!bar) return;
    var b=el("button","sh-rail-toggle"+(railsOn?" on":""),"&#9707; Rails");
    railBtn=b;
    b.setAttribute("aria-pressed", railsOn?"true":"false");
    b.addEventListener("click",function(){
      railsOn=!railsOn;
      try { localStorage.setItem(RAILKEY, railsOn?"1":"0"); } catch(e){}
      b.classList.toggle("on",railsOn);
      b.setAttribute("aria-pressed", railsOn?"true":"false");
      applyRails();
    });
    var sp=bar.querySelector(".spacer");
    if(sp) bar.insertBefore(b,sp); else bar.appendChild(b);
  }
  function applyRails(){
    if(!railL){
      railL=el("aside","sh-rail sh-rail-left");  railL.setAttribute("aria-label","Sheet sections");
      railR=el("aside","sh-rail sh-rail-right"); railR.setAttribute("aria-label","Trackers");
      document.body.appendChild(railL); document.body.appendChild(railR);
      window.addEventListener("scroll",spyRails,{passive:true});
      window.addEventListener("resize",function(){ spyRails(); railHint(); },{passive:true});
      // A media-query listener fires exactly on the threshold crossing, which is what
      // the toggle's hint cares about; resize alone can be missed or coalesced.
      try {
        var mq=window.matchMedia("(min-width:1280px)");
        var onMQ=function(){ railHint(); spyRails(); };
        if(mq.addEventListener) mq.addEventListener("change",onMQ);
        else if(mq.addListener) mq.addListener(onMQ);
      } catch(e){}
    }
    document.body.classList.toggle("sh-rails-on",railsOn);
    railHint();
    if(!railsOn) return;
    renderRailNav(); renderRailTrackers(); spyRails();
  }
  // The rails are suppressed on narrow windows. Say so on the toggle rather than
  // leaving it looking switched on with nothing to show for it.
  function railHint(){
    if(!railBtn) return;
    var hidden = railsOn && railL && getComputedStyle(railL).display==="none";
    railBtn.classList.toggle("cramped",!!hidden);
    railBtn.title = hidden
      ? "Rails are on, but this window is too narrow to show them — widen it past 1280px"
      : "Show or hide the side rails";
  }
  function renderRailNav(){
    railL.innerHTML="<div class='sh-rail-head'>Sections</div>";
    var list=el("nav","sh-rail-nav");
    root.querySelectorAll(".sh-card").forEach(function(c,i){
      var h=c.querySelector("h2");
      var label = h ? h.textContent.trim() : (c.classList.contains("roller") ? "Roll & Keep" : null);
      if(!label) return;
      if(!c.id) c.id="sec-"+i;
      var a=el("button","sh-rail-link",RAIL_SHORT[label]||label);
      a.setAttribute("data-sec",c.id);
      a.addEventListener("click",function(){
        var t=document.getElementById(c.id);
        if(t) t.scrollIntoView({behavior:"smooth",block:"start"});
      });
      list.appendChild(a);
    });
    railL.appendChild(list);
  }
  function railTrk(key,label,max){
    var v=trkVal(key);
    var pct=max?Math.min(100,Math.round(v/max*100)):0;
    return "<div class='rt-row' data-rt='"+key+"'>"
      +"<div class='rt-lab'>"+label+"<span class='rt-num'>"+v+"/"+max+"</span></div>"
      +"<div class='rt-bar'><i style='width:"+pct+"%'></i></div></div>";
  }
  function renderRailTrackers(){
    var over = (trkVal("strife")>=S.derived.composure) ? "Compromised"
             : (trkVal("fatigue")>=S.derived.endurance) ? "Incapacitated" : "";
    railR.innerHTML="<div class='sh-rail-head'>Condition</div>"
      +railTrk("strife","Strife",S.trackers.strife.max)
      +railTrk("fatigue","Fatigue",S.trackers.fatigue.max)
      +railTrk("void","Void",S.trackers["void"].max)
      +(over?"<div class='rt-warn'>"+over+"</div>":"")
      +"<div class='sh-rail-head'>Approach</div>"
      +"<div class='rt-approach'>"+ringIcon(st.ring)+"<span>"+cap(st.ring)
        +(st.skill?" · "+(SKILL_NAMES[st.skill]||cap(st.skill)):"")+"</span></div>"
      +"<div class='rt-stance'>Stance: <b>"+cap(st.stance||"—")+"</b></div>";
    if(!RO){
      var b=el("button","rt-roll","Roll &amp; Keep");
      b.addEventListener("click",function(){
        var rc=document.getElementById("rollerCard");
        if(rc){ rc.classList.remove("collapsed"); rc.scrollIntoView({behavior:"smooth",block:"start"}); }
      });
      railR.appendChild(b);
    }
  }
  // Keep the rails honest without re-rendering them on every scroll frame.
  function syncRails(){ if(railsOn && railR) renderRailTrackers(); }
  function spyRails(){
    if(!railsOn || !railL) return;
    var marker=window.innerHeight*0.3;
    var links=railL.querySelectorAll(".sh-rail-link");
    // The sheet is a two-column grid, so cards sit side by side and more than one can
    // cross the marker line at once. Both are equally "where you are", so light both;
    // fall back to the last card above the line when nothing crosses it.
    var live=[], lastAbove=null;
    links.forEach(function(a){
      var t=document.getElementById(a.getAttribute("data-sec")); if(!t) return;
      var r=t.getBoundingClientRect();
      if(r.top<=marker) lastAbove=a;
      if(r.top<=marker && r.bottom>marker) live.push(a);
    });
    if(!live.length && lastAbove) live=[lastAbove];
    links.forEach(function(a){ a.classList.toggle("on",live.indexOf(a)>=0); });
  }

  buildVersionPicker();
  buildRailToggle();
  render();
})();
