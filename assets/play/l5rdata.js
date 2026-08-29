/* ============================================================
   l5rdata.js — L5R5e reference data for the sheet
   Stances, conflict types/actions, and the Opportunity (op) spend
   tables. Opportunity spend text is verbatim from the L5R5e core.
   ============================================================ */
window.L5R = {

  // --- Stances (chosen in conflict; the default ring for checks) ---
  stances: {
    air:   { name:"Air Stance",   text:"Increase the TN of Attack action checks targeting you at range 1–2 by 1 (by 2 at school rank 4+)." },
    earth: { name:"Earth Stance", text:"When other characters make Attack action checks and Scheme action checks that target you, they cannot spend (op) to inflict critical strikes or conditions on you." },
    fire:  { name:"Fire Stance",  text:"When you make an Attack or Scheme action check, gain a bonus success for each kept die showing a strife (▲) result." },
    water: { name:"Water Stance", text:"You may perform an additional action that does not require a check. The additional action cannot be the same type as an action you have already performed that turn." },
    void:  { name:"Void Stance",  text:"You do not receive strife from strife (▲) symbols on your kept dice. You can still receive strife from other sources." }
  },

  // --- Conflict types: initiative skill + available actions ---
  // Each action's desc / activation / effects / newOpp text is VERBATIM from the
  // L5R5e core rulebook. `check` (when present) tees up the appropriate Roll & Keep:
  //   skill  — the skill key to select (null = player chooses; e.g. Persuade's Social
  //            skill, an open Unique Action)
  //   weapon — true if the skill is "the appropriate skill for the weapon" (Strike):
  //            the readied weapon's own skill is selected, per its gear entry
  //   tn     — the TN to fill in (null = set by target/GM, left for the player)
  //   opt    — true if the check is optional to the action (e.g. Maneuver's Fitness check)
  // Actions with no `check` are declared to the log only.
  conflicts: {
    intrigue: { name:"Intrigue", initSkill:"Sentiment", actions:[
      { name:"Assist", cats:"Attack, Scheme, and Support action",
        desc:"You offer an ally an argument they might use, an insight about the opposition, or a novel idea.",
        activation:"As an Attack, Scheme, and Support action, describe how you are helping one other character at range 0–2 with their next action.",
        effects:"If the GM accepts your suggestion, you provide Assistance on the chosen character's next action check." },
      { name:"Calming Breath", cats:"Support action",
        desc:"During a conflict, you may inhale deeply before exhaling, drawing upon your inner strength.",
        activation:"As a Support action, you may take a deep breath to calm yourself and recover stamina.",
        effects:"If your strife is greater than half your Composure, you remove 1 strife. If your fatigue is greater than half your Endurance, you remove 1 fatigue." },
      { name:"Persuade", cats:"Scheme action",
        desc:"You attempt to foster or quell an idea, emotion, or desire in a person.",
        activation:"As a Scheme action, make a Social skill check targeting one or more characters who can hear you. The TN equals the highest Vigilance among your targets.",
        effects:"If you succeed, add one momentum point toward an appropriate social objective, plus one additional momentum point for every two bonus successes. Any narrative ramifications of the check also resolve.",
        check:{ skill:null, tn:null } },
      { name:"Unique Action", cats:"action",
        desc:"You make a check using a skill for a mechanical or narrative effect.",
        activation:"As an action, make a skill check to attempt a task you have described to the GM.",
        effects:"If you succeed, you may use the skill for its narrative effects, for implementing any sample use that can be completed in a single action, or for pursuing another task that the GM deems appropriate.",
        check:{ skill:null, tn:null } }
    ] },
    duel: { name:"Duel", initSkill:"Meditation", actions:[
      { name:"Calming Breath", cats:"Support action",
        desc:"During a conflict, you may inhale deeply before exhaling, drawing upon your inner strength.",
        activation:"As a Support action, you may take a deep breath to calm yourself and recover stamina.",
        effects:"If your strife is greater than half your Composure, you remove 1 strife. If your fatigue is greater than half your Endurance, you remove 1 fatigue." },
      { name:"Center", cats:"Support action (Void Stance)",
        desc:"You let the world around you slow as the Void overtakes your senses. Everything but the moment fades as you instinctively seek victory. Your mind weaves through infinite treacherous possibilities to the outcome you desire.",
        activation:"As a Support action in Void Stance, you may focus your energy inward, envisioning your action and seeking the perfect moment. You must name a skill when you use Center.",
        effects:"Roll a number of Skill dice up to your ranks in the chosen skill and reserve any number of those dice. The next time you make a check using the chosen skill (or use Center) this scene, after rolling dice, you may replace any number of rolled dice with the reserved dice (set to the results they were showing when reserved). You cannot reserve more dice than your ranks in the skill this way." },
      { name:"Predict", cats:"Attack and Scheme action",
        desc:"You shift subtly to draw a reaction out of your foe by repositioning or signaling a strike you never intend to throw. By predicting your foe's reaction, you aim to win the battle in the mind.",
        activation:"As an Attack and Scheme action, you may secretly select Air, Earth, Fire, or Water and record it.",
        effects:"The next time your opponent chooses their Stance, you may reveal your selection; if it matches the stance they chose, your opponent receives 4 strife and must choose a different stance. This effect persists until the end of your next turn." },
      { name:"Prepare Item", cats:"Support action",
        desc:"You prepare, ready, or stow one weapon or other item.",
        activation:"As a Support action, you may interact with one item.",
        effects:"Prepare one item for use, ready a weapon in a grip of your choice, or stow an item." },
      { name:"Strike", cats:"Attack action",
        desc:"You make an attack against a single foe.",
        activation:"As an Attack action using one readied weapon, make a TN 2 Martial Arts check using the appropriate skill for the weapon, targeting one character within the weapon's range.",
        effects:"If you succeed, deal physical damage to the target equal to the weapon's base damage plus your bonus successes.",
        newOpp:"(op): If you succeed, inflict a critical strike on your target with severity equal to your weapon's deadliness.",
        check:{ skill:null, weapon:true, tn:2 } }
    ] },
    skirmish: { name:"Skirmish", initSkill:"Tactics", actions:[
      { name:"Assist", cats:"Attack, Scheme, and Support action",
        desc:"You offer an ally a plan of attack, an insight about the foe, or an encouraging word.",
        activation:"As an Attack, Scheme, and Support action, describe how you are helping one other character at range 0–2 with their next action.",
        effects:"If the GM accepts your suggestion, you provide Assistance on the chosen character's next action check." },
      { name:"Calming Breath", cats:"Support action",
        desc:"During a conflict, you may inhale deeply before exhaling, drawing upon your inner strength.",
        activation:"As a Support action, you may take a deep breath to calm yourself and recover stamina.",
        effects:"If your strife is greater than half your Composure, you remove 1 strife. If your fatigue is greater than half your Endurance, you remove 1 fatigue." },
      { name:"Challenge", cats:"Scheme action",
        desc:"You issue a challenge to a foe, calling for them to face you in single combat.",
        activation:"As a Scheme action, make a TN 1 Command check targeting one character at range 0–5. You must stake 10 Honor and 5 Glory upon the challenge, which you forfeit if you sabotage the clash.",
        effects:"If you succeed, the target must choose whether to accept or decline. Accept: Target stakes 10 honor and 5 glory, which they forfeit if they take any Attack or Scheme action before the clash. At the end of the round, the clash begins. Decline: Target must forfeit glory equal to your ranks in Command plus your bonus successes. Each of their allies with lower glory than you suffers 2 strife. You gain 1 Void point. If you win the clash, each of your foe's allies in the skirmish suffers 3 strife. If you lose, each of your allies suffers 3 strife.",
        check:{ skill:"command", tn:1 } },
      { name:"Guard", cats:"Support action",
        desc:"You focus on warding off foes from yourself or an ally by positioning yourself defensively, taking cover, throwing strategically placed strikes, or firing shots menacingly close to the enemy.",
        activation:"As a Support action using a readied weapon, make a TN 1 Tactics check targeting yourself or one other character within the weapon's range.",
        effects:"If you succeed, you guard the target until the beginning of your next turn. Increase the TN of Attack checks against the guarded target by one, plus an additional one per two bonus successes.",
        check:{ skill:"tactics", tn:1 } },
      { name:"Maneuver", cats:"Movement action",
        desc:"You shift on the battlefield, moving to a more advantageous position.",
        activation:"As a Movement action, you may reposition for more distance. Optionally, you may make a TN 2 Fitness check as part of this action.",
        effects:"Move one Range Band. If you choose to make the Fitness check and succeed, you may instead move two range bands, plus one additional range band per two bonus successes.",
        check:{ skill:"fitness", tn:2, opt:true } },
      { name:"Prepare Item", cats:"Support action",
        desc:"You prepare, ready, or stow one weapon or other item.",
        activation:"As a Support action, you may interact with one item.",
        effects:"Prepare one item for use, ready a weapon in a grip of your choice, or stow an item." },
      { name:"Strike", cats:"Attack action",
        desc:"You make an attack against a single foe.",
        activation:"As an Attack action using one readied weapon, make a TN 2 Martial Arts check using the appropriate skill for the weapon, targeting one character within the weapon's range.",
        effects:"If you succeed, deal physical damage to the target equal to the weapon's base damage plus your bonus successes.",
        newOpp:"(op): If you succeed, you inflict a critical strike on your target with severity equal to your weapon's deadliness.",
        check:{ skill:null, weapon:true, tn:2 } },
      { name:"Unique Action", cats:"action",
        desc:"You make a check using a skill for a mechanical or narrative effect.",
        activation:"As an action, make a skill check to attempt a task you have described to the GM.",
        effects:"If you succeed, you may use the skill for its narrative effects, for implementing any sample use that can be completed in a single action, or for pursuing another task that the GM deems appropriate.",
        check:{ skill:null, tn:null } },
      { name:"Wait", cats:"Attack, Scheme, and Support action",
        desc:"You bide your time, waiting to spring into action.",
        activation:"As an Attack, Scheme, and Support action, declare a non-Movement action you will perform after the occurrence of a specified event before the end of the round.",
        effects:"After the specified event occurs before the end of the round, you may perform the action. You must still use the ring matching your Stance for this action. If the specified event does not occur this round, you may perform one action of your choice (other than Wait) at the end of the round." }
    ] },
    massbattle: { name:"Mass Battle", initSkill:"Command", actions:[
      { name:"Assault", cats:"Attack and Movement action",
        desc:"You move your cohort to a particular position, attacking the cohort of a chosen enemy leader.",
        activation:"As an Attack and Movement action, make a TN 2 Tactics check targeting one enemy leader's cohort.",
        effects:"If you succeed, deal attrition to the enemy army equal to your ranks in Command plus your bonus successes.",
        check:{ skill:"tactics", tn:2 } },
      { name:"Challenge", cats:"Movement and Scheme action",
        desc:"You stride to the forefront of your force, bellowing a challenge to the enemy leader.",
        activation:"As a Movement and Scheme action, make a TN 1 Command check targeting one enemy leader.",
        effects:"If you succeed, stake 10 Honor and 5 Glory (forfeit if you sabotage the clash). Target must accept or decline. Accept: Target stakes 10 honor and 5 glory (forfeit if they take Attack or Scheme before the clash). At end of round, enter a Clash. Decline: Target forfeits glory equal to your ranks in Command plus bonus successes. Their army suffers 3 panic. You gain 1 Void point. If you win the clash, enemy army suffers 5 panic. If you lose, your army suffers 5 panic.",
        check:{ skill:"command", tn:1 } },
      { name:"Rally", cats:"Support action",
        desc:"You command your troops to regroup and support an allied contingent.",
        activation:"As a Support action, make a TN 1 Command check targeting one friendly leader's cohort.",
        effects:"If you succeed, your army removes 1 panic, plus 1 additional panic per bonus success. Whether you succeed or fail, the target counts as having Assistance on their next check before end of scene.",
        check:{ skill:"command", tn:1 } },
      { name:"Reinforce", cats:"Movement and Support action",
        desc:"You call for your troops to dig in and hold a position at all costs.",
        activation:"As a Movement and Support action, make a TN 2 Tactics check to have your cohort dig in at one chosen position.",
        effects:"If you succeed, increase the TN of Attack action checks targeting your cohort by 1, plus an additional 1 per two bonus successes. Persists for one round. If you choose an unoccupied fortification or terrain, you are considered occupying it until you narratively leave or perform an action other than Challenge or Reinforce.",
        check:{ skill:"tactics", tn:2 } }
    ] }
  },

  // --- Opportunity spend tables (verbatim from the core rulebook) ---
  // Each context maps a ring (or "any") to its list of (op) spends.
  opportunities: {
    general: {
      any: [
        "(op): If you failed, determine the easiest way to accomplish the task you were attempting (skill and approach).",
        "(op)+: Remove 1 strife you gained from this check per (op) spent this way.",
        "(op)(op): Provide assistance to the next character to attempt a check to accomplish something similar."
      ],
      air: [
        "(op): Learn another character in the scene's demeanor (if an NPC) and current strife.",
        "(op)+: Act subtly to attract minimal attention in your efforts. Extra (op) makes the attempt even subtler.",
        "(op)(op): Notice an interesting detail about a character in the scene, such as an advantage or disadvantage. At the GM's discretion, you may establish a new detail for an NPC."
      ],
      earth: [
        "(op): Reassure another character in the scene with your presence, allowing them to remove 2 strife.",
        "(op)+: Act carefully to minimize consequences of failure or other dangers that could arise from the task. Extra (op) makes the attempt even safer.",
        "(op)(op): Suddenly recall an important piece of information not directly related to the task. At the GM's discretion, you may establish a small preparatory action you took earlier, such as bringing along a common useful item."
      ],
      fire: [
        "(op): Inflame another character in the scene with your presence, causing them to receive 2 strife.",
        "(op)+: Perform the task in a flashy way, drawing attention to yourself. Extra (op) attracts even more notice.",
        "(op)(op): Notice something missing or out of place in the vicinity that is not directly related to the task. At the GM's discretion, you may establish an absence, such as a lack of shoes outside indicating the occupant's absence."
      ],
      water: [
        "(op): Remove 2 strife from yourself.",
        "(op)+: Perform the task efficiently, completing it more quickly or saving supplies. Extra (op) further reduces the time or materials expended.",
        "(op)(op): Spot an interesting physical detail present in your environment not directly related to your check. At the GM's discretion, you may establish a piece of terrain or a mundane object nearby."
      ],
      void: [
        "(op): Choose a ring other than Void. Reduce the TN of your next check by 1 if it uses that ring.",
        "(op)+: Feel a chill down your spine, notice a sudden silence, or detect another sign of the supernatural if there is a spiritual disturbance in the scene. Extra (op) gives an increasingly precise location for the supernatural occurrence.",
        "(op)(op): Gain spiritual insight into the nature of the universe or your own heart. At the GM's discretion, you may establish a fact about your character that has not been previously revealed but relates to the situation."
      ]
    },
    conflict: {
      air: [
        "(op): Add a kept (ring) set to an (op) result to your next Martial skill check.",
        "(op)+: During a Movement action check, up to 1 range band of any distance you move per (op) spent this way may be along a vertical surface.",
        "(op)(op): Increase the TN of the next Martial Arts [Ranged] check targeting you before the start of your next turn by 2."
      ],
      earth: [
        "(op): During a Movement action, ignore one terrain quality of your choice.",
        "(op)+: Reduce the severity of the next critical strike you suffer before the start of your next turn by 1 per (op) spent this way.",
        "(op)(op): Do not apply one of your disadvantages to checks until the end of your next turn."
      ],
      fire: [
        "(op): Choose another character in the scene; increase the TN of the next check they make before the end of their next turn by 1 if it does not include you as a target.",
        "(op)+: During an Attack action check, increase the TN of the next check the target makes to resist a critical strike they suffer before the start of your next turn by 1 per (op) spent this way.",
        "(op)(op): Other characters must receive 2 strife to choose you as the target of their Attack and Scheme actions until the start of your next turn."
      ],
      water: [
        "(op): Remove 1 fatigue.",
        "(op)+: During an Attack action check, ignore 1 point of target's physical resistance per (op) spent this way.",
        "(op)(op): Move 1 range band."
      ],
      void: [
        "(op): During the next Attack action check you make before the end of your next turn, ignore one terrain quality of your choice.",
        "(op)+: During a Support action check, increase your Initiative value by 1 per (op) spent this way.",
        "(op)(op): Ignore the effects of one condition you are suffering until the end of your next turn."
      ]
    },
    initiative: {
      air:   ["(op): Assess one foe's weakness. Learn one of their disadvantages of that foe's choice."],
      earth: ["(op): Choose another character's disadvantage you know. They do not apply that disadvantage to their checks this scene."],
      fire:  ["(op): Use your focus instead of your vigilance for your initiative when surprised."],
      water: ["(op): Assess the qualities of all terrain in the scene."],
      void:  ["(op): Sense if there is an Otherworldly being in the scene."]
    },
    downtime: {
      air: [
        "(op)+: Learn a detail about one person in your company (such as an advantage or disadvantage of their choice) per (op) spent this way. You can learn only one detail about each person this way in a single downtime scene.",
        "(op)(op): Perform your downtime activity without letting one or more others of your choice know that you did."
      ],
      earth: [
        "(op)+: Another character in your company may remove 1 strife or fatigue per (op) spent this way.",
        "(op)(op): Memorize a small but vital detail from your activity; you can recall it later without a check."
      ],
      fire: [
        "(op)+: Assist one other character per (op) spent this way with their next downtime activity check this session.",
        "(op)(op): Energize another character in your company with your efforts; they may perform 1 additional downtime action this downtime (to a maximum of 2)."
      ],
      water: [
        "(op)+: Remove 1 strife or fatigue per (op) spent this way.",
        "(op)(op): Make a new friend while undertaking your downtime activity."
      ],
      void: [
        "(op)+: Reserve 1 dropped die from your check, to a maximum of your ranks in the skill you used. Add that die to your next check with the same skill as a kept die instead of rolling it.",
        "(op)(op): Have a brief premonition of a possible future event while undertaking your downtime activity."
      ]
    },
    // Skill-group opportunities (one line per ring per group)
    social: {
      air:   ["(op): Learn if the honor, glory, or status attribute of a character in the scene is higher, lower, or equal to yours."],
      earth: ["(op): Increase the TN of the next Social check another character makes before the end of the scene by 1."],
      fire:  ["(op): Reduce the TN of the next Social check another character makes before the end of the scene by 1."],
      water: ["(op): Add a kept (ring) set to an (op) result to your next Social check before the end of the scene."],
      void:  ["(op): Discern the objective of another character in the scene."]
    },
    scholar: {
      air:   ["(op): Learn something about a character who created or used the item you are studying (such as one of their advantages or disadvantages of the GM's choice that affected their creation or use of the item)."],
      earth: ["(op): Remember a place where you can research or study the topic you were attempting to recall."],
      fire:  ["(op): Extrapolate the motivations or desires of another character in the scene or wider situation."],
      water: ["(op): Spot a unique or identifying quality, aspect, or ability of something that you are identifying."],
      void:  ["(op): Intuit whether you can learn anything of value from your current course of inquiry."]
    },
    artisan: {
      air:   ["(op): If you succeed, add the Resplendent or Subtle quality to an item that you are refining."],
      earth: ["(op): If you succeed, add the Durable quality to an item that you are restoring."],
      fire:  ["(op): If you succeed, make one additional copy of the item you are creating."],
      water: ["(op): Add a kept (ring) set to an (op) result to the next Artisan skill check you make before the end of the game session."],
      void:  ["(op): Reduce the TN of the next check you make using the item you are attuning yourself to by 1."]
    },
    trade: {
      air:   ["(op): Convince a buyer to pay an additional 10% for an item you are selling."],
      earth: ["(op): Reduce the TN of the next check another character makes with the same skill before the end of the scene by 1."],
      fire:  ["(op): Unusual inspiration strikes; add a kept (ring) set to an (op) result to the next check you make with another skill."],
      water: ["(op): Convince a seller to give you an additional 10% discount for an item you are buying."],
      void:  ["(op): Reduce any effect you have on your environment (and physical traces of your efforts) to a minimum."]
    }
  },

  // The order chips appear in and their labels
  oppTables: [
    ["general","General"], ["conflict","Conflict"], ["initiative","Initiative"],
    ["social","Social"], ["scholar","Scholar"], ["artisan","Artisan"], ["trade","Trade"], ["downtime","Downtime"]
  ],

  // --- Strike / damage + Critical Strike (verbatim from the L5R5e core) ---
  strike: {
    activation: "As an Attack action using one readied weapon, make a TN 2 Martial Arts check using the appropriate skill for the weapon, targeting one character within the weapon's range.",
    effect: "If you succeed, deal physical damage to the target equal to the weapon's base damage plus your bonus successes.",
    critOpportunity: "(op): If you succeed, you inflict a Critical Strike on your target with severity equal to your weapon's deadliness.",
    fireStance: "Fire Stance: When you make an Attack or Scheme action check, gain a bonus success for each kept die showing a strife (st) result."
  },
  criticalStrike: {
    // How severity is inflicted, then mitigated by the target.
    inflict: "After failing to defend against damage: severity = deadliness of the source of damage. From a direct effect: severity is specified by the effect.",
    resist: "The target must make a TN 1 Fitness check (using a ring of their choice in narrative, or the ring their Stance dictates in conflict). If they succeed, reduce severity by 1 plus bonus successes (minimum 0). Then consult the severity table.",
    // Severity table — verbatim descriptions and effects.
    table: [
      { min:0,  max:2,    label:"Close Call",       desc:"The hit slices the character's hair or clothes but fails to draw blood.", effect:"If the character is wearing armor, the armor gains the Damaged quality." },
      { min:3,  max:4,    label:"Flesh Wound",      desc:"The hit sinks into the character's flesh, slicing shallowly or creating a vicious contusion.", effect:"The character suffers Lightly Wounded for the ring used for their check to resist. If the attack had the Razor-Edged quality, also suffers Bleeding." },
      { min:5,  max:6,    label:"Debilitating Gash", desc:"The hit is agonizing, cutting a deep furrow in the flesh or splitting muscle and fracturing bone. The character will likely need time to recover fully.", effect:"The character suffers Severely Wounded for the ring used for their check to resist. If the attack had the Razor-Edged quality, also suffers Bleeding." },
      { min:7,  max:8,    label:"Permanent Injury", desc:"The strike leaves the character permanently injured, bearing a scar that will impact them the rest of their life.", effect:"The character suffers Bleeding, then chooses one scar disadvantage for the ring used for their check to resist: Air (Maimed Visage or Nerve Damage), Earth (Damaged Organ or Fractured Spine), Fire (Lost Fingers or Maimed Arm), Water (Lost Eye or Lost Foot), Void (Lost Memories)." },
      { min:9,  max:11,   label:"Maiming Blow",     desc:"The character is gravely hurt by the strike and might never fully recover from it.", effect:"The character suffers Bleeding, then chooses one scar disadvantage for the ring used for their check to resist: Air (Deafness or Muteness), Earth (Damaged Heart or Damaged Organ), Fire (Lost Arm or Lost Hand), Water (Blindness or Lost Leg), Void (Cognitive Lapses)." },
      { min:12, max:13,   label:"Agonizing Death",  desc:"The blow is mortal, and the character knows it.", effect:"The character suffers Severely Wounded for the ring used for their check to resist, as well as Bleeding and Dying (3 rounds)." },
      { min:14, max:15,   label:"Swift Death",      desc:"The character lives just long enough to realize their demise.", effect:"The character suffers Severely Wounded for the ring used for their check to resist, as well as Bleeding and Dying (1 round)." },
      { min:16, max:null, label:"Instant Death",    desc:"The character dies without even a last word.", effect:"The character dies immediately." }
    ]
  },

  // Opportunities granted by this character's own techniques
  techniqueOpportunities: [
    { name:"Lord Togashi’s Insight", ring:"void", text:"(op): Reduce the TN of your first check to overcome the problem you are facing by your school rank (to a minimum of 1)." }
  ]
};
