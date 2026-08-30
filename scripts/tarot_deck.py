#!/usr/bin/env python3
"""The 78-card tarot deck, with upright and reversed readings, for the Creator.

Jordan builds characters from a three-card spread — the Slow Tide Harbor notes
are written that way — so the Begin step can draw one and drop it into the
concept box.

The readings are the standard Rider-Waite-Smith divinatory meanings, written
here in plain prose rather than copied from any one book: these meanings are
common property of the tradition, and Waite's own 1911 phrasing is archaic
enough to be less useful than a clear sentence. They are deliberately written
as character material — what this card says about a person — because that is
what they are being used for.

Nothing here weights the draw. The deck is a flat list; the shuffle lives in
the browser and uses crypto.getRandomValues with rejection sampling, so every
card and both orientations are equally likely. See assets/creator.js.

Writes data/chargen/tarot.js (window.L5R_TAROT).

    python3 scripts/tarot_deck.py
"""
import json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "chargen", "tarot.js")

# name: (upright, reversed)
MAJORS = {
    "The Fool": (
        "A beginning taken without a plan. The Fool steps off knowing less than they "
        "should and is not troubled by it; the openness is real, and so is the risk.\n\n"
        "In a person: innocence that has not yet been spent, a willingness to go where "
        "there is no road, and a blind spot about consequences that others can see plainly.",
        "The same leap, badly timed. Recklessness dressed as courage, or the opposite — "
        "a person frozen at the edge who calls their fear prudence.\n\n"
        "In a person: choices made to avoid deciding, a refusal to look at what the risk "
        "actually costs, or naivety that has started to do damage."),
    "The Magician": (
        "Will and means in the same hand. Everything needed is on the table; what remains "
        "is the decision to use it.\n\n"
        "In a person: capability, focus, and the confidence to act — someone who makes "
        "things happen rather than waiting, and who knows they can."),
    "The High Priestess": (
        "Knowledge held back. What she knows is not secret because it is shameful but "
        "because it is not yet time, or not yours.\n\n"
        "In a person: discretion, intuition trusted over evidence, and a interior life "
        "kept deliberately out of view."),
    "The Empress": (
        "Abundance, growth, and care that produces something. Fertility in the broad "
        "sense: what she attends to, thrives.\n\n"
        "In a person: generosity, sensuality, and a protective warmth that can become "
        "possessive when it is not returned."),
    "The Emperor": (
        "Structure imposed and held. Authority that comes from position and from the "
        "willingness to enforce it.\n\n"
        "In a person: discipline, command, and a preference for order — a rule-maker who "
        "is more comfortable with a system than with an exception."),
    "The Hierophant": (
        "Tradition, orthodoxy, and the institution that transmits them. The known road, "
        "walked because it is known.\n\n"
        "In a person: conformity by conviction, respect for lineage and precedent, and "
        "the authority of an office rather than of the self."),
    "The Lovers": (
        "A choice between two goods, made with the whole self. Union, but also the "
        "decision that union requires.\n\n"
        "In a person: a defining relationship, or a values decision that cannot be "
        "deferred any longer."),
    "The Chariot": (
        "Opposing forces held in harness and driven forward. Victory through control "
        "rather than through peace between the parts.\n\n"
        "In a person: drive, self-command, and a direction pursued hard — the tension is "
        "not resolved, it is steered."),
    "Strength": (
        "Force mastered by patience. The lion is not killed; it is quieted.\n\n"
        "In a person: courage that does not need to shout, and the particular strength of "
        "someone who can be gentle without being weak."),
    "The Hermit": (
        "Withdrawal for the sake of understanding, and the lamp carried back. Solitude "
        "with a purpose.\n\n"
        "In a person: a seeker, a teacher, or someone who has stepped out of the crowd on "
        "purpose and found it suits them."),
    "Wheel of Fortune": (
        "Change arriving from outside, neither earned nor deserved. The turn favours you "
        "now and will not always.\n\n"
        "In a person: luck as a live factor in their life, and an understanding — or a "
        "refusal to understand — that they do not control it."),
    "Justice": (
        "The true accounting. Cause and consequence, weighed without sentiment.\n\n"
        "In a person: fairness, clear sight, and the willingness to accept a verdict that "
        "goes against them because it is correct."),
    "The Hanged Man": (
        "Suspension accepted for the sake of a different view. Not defeat — a pause with "
        "meaning, and a sacrifice made willingly.\n\n"
        "In a person: patience others read as passivity, and a perspective bought by "
        "giving something up."),
    "Death": (
        "An ending that clears ground. Not usually literal; the transformation is real "
        "and it is not optional.\n\n"
        "In a person: a life sharply divided into before and after, and the particular "
        "clarity of someone who has already lost the thing they feared losing."),
    "Temperance": (
        "Two things combined in the right measure. Balance as a practice, maintained "
        "daily rather than achieved once.\n\n"
        "In a person: moderation, patience, and the steadiness of someone who is not "
        "rigid but is very hard to tip over."),
    "The Devil": (
        "Bondage that is chosen and could be left. The chains are loose; the figures stay.\n\n"
        "In a person: appetite, dependency, or an arrangement they profit from and will "
        "not examine — the trap they hold the key to."),
    "The Tower": (
        "Sudden collapse of something built wrong. Violent, unwelcome, and clarifying.\n\n"
        "In a person: a catastrophe in their history that took the false structure with "
        "it, and a wariness about anything that looks that solid again."),
    "The Star": (
        "Hope after damage. Quiet renewal, and the willingness to be open again.\n\n"
        "In a person: faith that survived a reason not to have it, and a calm that reads "
        "as serenity from outside and as recovery from inside."),
    "The Moon": (
        "Illusion, dream, and the things that only move at night. Not lies exactly — "
        "distortion, and the fear that comes with not seeing clearly.\n\n"
        "In a person: imagination, unease, and a relationship with the unseen that they "
        "may not be able to explain to anyone."),
    "The Sun": (
        "Plain daylight and nothing hidden. Vitality, clarity, and success that does not "
        "need to be justified.\n\n"
        "In a person: warmth, straightforwardness, and the kind of confidence that makes "
        "other people comfortable."),
    "Judgement": (
        "The call that requires an answer. Reckoning, but also absolution — the past "
        "reviewed and released.\n\n"
        "In a person: a vocation felt rather than chosen, or a decision to face something "
        "long avoided."),
    "The World": (
        "Completion. The circle closed, the work finished, the thing whole.\n\n"
        "In a person: arrival, integration, and the settled quality of someone who has "
        "finished a long piece of their life and knows it."),
}

# Reversed readings for the majors that have only an upright above.
MAJOR_REVERSED = {
    "The Magician": (
        "The same skill, turned or wasted. Manipulation, or talent that never gets used "
        "on anything.\n\n"
        "In a person: cleverness in service of nothing, a con, or the frustration of "
        "someone who could and does not."),
    "The High Priestess": (
        "What is withheld begins to cost. Secrets kept past their usefulness, or "
        "intuition ignored in favour of what is easier to defend.\n\n"
        "In a person: concealment as a habit, disconnection from their own judgement, or "
        "knowledge hoarded rather than held."),
    "The Empress": (
        "Care that smothers, or a barrenness where growth should be. Dependence in "
        "either direction.\n\n"
        "In a person: possessiveness, neglect of themselves in favour of others, or a "
        "creative life that has stopped producing."),
    "The Emperor": (
        "Authority overreaching or failing. Tyranny, or a structure nobody respects any "
        "more.\n\n"
        "In a person: rigidity, control exercised where it is not wanted, or the "
        "hollowness of a title without the substance."),
    "The Hierophant": (
        "The tradition questioned. Orthodoxy rejected, or an institution revealed as "
        "self-serving.\n\n"
        "In a person: heterodoxy, a break with how it has always been done, or "
        "conformity held to long after belief has gone."),
    "The Lovers": (
        "The choice avoided or made badly. Misalignment between what is wanted and what "
        "is chosen.\n\n"
        "In a person: a relationship out of balance, divided loyalties, or a decision "
        "made to please someone else."),
    "The Chariot": (
        "The harness slipping. Force without direction, or a will that has run out of "
        "road.\n\n"
        "In a person: aggression without a goal, loss of control, or a drive pointed "
        "somewhere it should not go."),
    "Strength": (
        "The lion loose. Self-command failing, or gentleness curdled into fear of "
        "one's own force.\n\n"
        "In a person: a temper, self-doubt, or strength they will not use even when they "
        "should."),
    "The Hermit": (
        "Solitude without the return. Isolation that has stopped being useful, or wisdom "
        "sought and never carried back.\n\n"
        "In a person: loneliness rather than chosen apartness, withdrawal as avoidance, "
        "or apartness imposed rather than elected."),
    "Wheel of Fortune": (
        "The turn going against you. Bad luck, or resistance to a change already under "
        "way.\n\n"
        "In a person: a run of misfortune they read as personal, or an insistence on "
        "controlling what is not theirs to control."),
    "Justice": (
        "The scales rigged or ignored. Unfairness, evasion, or consequence dodged.\n\n"
        "In a person: bias they cannot see, accountability refused, or a person on the "
        "wrong end of a judgement that was not just."),
    "The Hanged Man": (
        "Suspension with no meaning left in it. Stalling, martyrdom, or a sacrifice "
        "nobody asked for.\n\n"
        "In a person: delay dressed as patience, or a cost paid for a cause that has "
        "stopped mattering."),
    "Death": (
        "The ending refused. Change resisted, or a thing kept alive past its time.\n\n"
        "In a person: someone clinging to a former life, or stalled in the middle of a "
        "transformation they will not complete."),
    "Temperance": (
        "The measure lost. Excess, impatience, or two things combined that should not "
        "have been.\n\n"
        "In a person: extremity, a balance that has broken, or a practice abandoned and "
        "not yet missed."),
    "The Devil": (
        "The chain examined. Release beginning, or the grip tightening past deniability.\n\n"
        "In a person: an addiction confronted, an arrangement they are finally leaving, "
        "or a hold on them that has become undeniable."),
    "The Tower": (
        "The collapse delayed or survived. Disaster averted, or the same catastrophe "
        "happening slowly instead of all at once.\n\n"
        "In a person: a crisis postponed at a cost, or someone still standing in the "
        "rubble of one."),
    "The Star": (
        "Hope thin or lost. Discouragement, or faith kept up as a performance.\n\n"
        "In a person: disillusion, a well run dry, or optimism maintained because the "
        "alternative is unbearable."),
    "The Moon": (
        "The fog lifting, or thickening. Confusion resolving into fact, or a deception "
        "closing over completely.\n\n"
        "In a person: anxiety releasing, self-deception, or a truth about to surface that "
        "they have been circling."),
    "The Sun": (
        "The light dimmed. Success that does not satisfy, or a brightness put on for "
        "others.\n\n"
        "In a person: forced cheer, delayed vindication, or clarity that has been "
        "temporarily lost."),
    "Judgement": (
        "The call refused or misheard. Self-condemnation, or a reckoning avoided.\n\n"
        "In a person: harsh self-judgement, a summons ignored, or an old matter still "
        "unsettled because they will not look at it."),
    "The World": (
        "The circle not quite closed. Completion withheld, or an ending that did not "
        "deliver what it promised.\n\n"
        "In a person: a loose end that governs them, a journey abandoned near its end, or "
        "arrival without the satisfaction of it."),
    "The Fool": None,  # written above
}

# Minor arcana. name: (upright, reversed) — same two-paragraph shape as above.
MINORS = {
    # ---- Wands: will, drive, work, ambition ------------------------------
    "Ace of Wands": (
        "A first spark. Raw energy, an idea with heat in it, an opportunity that wants acting on.\n\nIn a person: an enthusiasm newly caught, and the restlessness that comes with it.",
        "The spark not caught. Delay, a false start, or energy with nowhere to go.\n\nIn a person: motivation stalled, or a beginning they keep postponing."),
    "Two of Wands": (
        "Standing at the edge of the known and planning past it. The world in hand, not yet travelled.\n\nIn a person: ambition at the stage where it is still a decision.",
        "Risk avoided. Planning that never becomes movement, or a horizon deliberately not looked at.\n\nIn a person: caution that has hardened into staying put."),
    "Three of Wands": (
        "Ships sent out and watched for. The work is done; the waiting is the discipline.\n\nIn a person: enterprise underway, and confidence in a result not yet in.",
        "The return delayed. Plans that do not arrive, or an overreach becoming visible.\n\nIn a person: frustration at a horizon that keeps receding."),
    "Four of Wands": (
        "Celebration on solid ground. Homecoming, a threshold crossed, a thing worth marking.\n\nIn a person: belonging, and a settled place they can return to.",
        "The celebration thin. Homecoming that disappoints, or stability that is only apparent.\n\nIn a person: a home they do not feel at home in."),
    "Five of Wands": (
        "Scrappy competition. Everyone striking at once, more noise than danger, but real friction.\n\nIn a person: someone who thrives on contest, or who cannot stop entering one.",
        "The fight avoided or settled. Conflict suppressed rather than resolved.\n\nIn a person: tension swallowed, or a rivalry gone underground."),
    "Six of Wands": (
        "The victor's return, publicly acknowledged. Success that others have confirmed.\n\nIn a person: earned recognition, and the appetite for more of it.",
        "Recognition withheld or hollow. Success unnoticed, or a reputation outrunning the deed.\n\nIn a person: pride that has become a liability, or a win nobody saw."),
    "Seven of Wands": (
        "Holding the high ground against many. Defence of a position, at cost, on principle.\n\nIn a person: conviction under pressure, and the stubbornness to keep standing.",
        "The ground given up. Overwhelmed, or defending something not worth it.\n\nIn a person: exhaustion, or a position held past the point of sense."),
    "Eight of Wands": (
        "Everything arriving at once and fast. Momentum, news, movement without obstruction.\n\nIn a person: swiftness, and a life currently in motion.",
        "Momentum lost. Delay, scattering, messages that do not land.\n\nIn a person: a plan losing speed, or haste that has caused a mess."),
    "Nine of Wands": (
        "Wounded and still on watch. Resilience bought with damage, guard kept up because it has been needed.\n\nIn a person: wariness earned the hard way, and the refusal to fall over.",
        "The guard failing. Paranoia, or defences finally spent.\n\nIn a person: someone braced against a threat that is over, or one they can no longer meet."),
    "Ten of Wands": (
        "Carrying more than one person should, nearly there. Burden accepted and not put down.\n\nIn a person: over-responsibility, and a load taken on rather than shared.",
        "The load dropped or refused. Collapse, delegation, or burdens shrugged onto others.\n\nIn a person: a breaking point reached, or duty quietly abandoned."),
    "Page of Wands": (
        "A messenger with an idea and no experience. Eager, unformed, genuinely enthusiastic.\n\nIn a person: potential and inexperience together, and big plans not yet tested.",
        "Enthusiasm without follow-through. Restlessness, or ambition that changes target weekly.\n\nIn a person: promise being wasted, or a beginner who will not be taught."),
    "Knight of Wands": (
        "Charging, charming, and not entirely in control. Action taken first.\n\nIn a person: daring, impatience, and a habit of arriving before the plan does.",
        "The charge gone wrong. Recklessness, temper, or energy spent on the wrong target.\n\nIn a person: haste that costs them, or a fire that burns whoever is nearest."),
    "Queen of Wands": (
        "Warmth with authority. Confident, magnetic, and unbothered by the opinion of the room.\n\nIn a person: presence, courage, and the ability to make others want to follow.",
        "The warmth turned. Jealousy, demanding attention, or confidence that has become brittle.\n\nIn a person: insecurity behind the display, or a pull toward something they know better than to want."),
    "King of Wands": (
        "Vision carried through by force of personality. A leader who sets direction and expects it followed.\n\nIn a person: command, boldness, and a long view held with certainty.",
        "Leadership overbearing or absent. Domineering, or a vision nobody has been told about.\n\nIn a person: high-handedness, or authority they have stopped exercising."),

    # ---- Cups: feeling, relationship, the inner life ----------------------
    "Ace of Cups": (
        "The cup overflowing. New feeling, offered rather than seized.\n\nIn a person: an opening of the heart, and the vulnerability that comes with it.",
        "The cup withheld or spilled. Feeling blocked, or love offered and refused.\n\nIn a person: emotion held back, or an openness that has closed."),
    "Two of Cups": (
        "Two people meeting as equals. Partnership, mutual regard, a bond freely made.\n\nIn a person: a defining relationship of two, and the balance it requires.",
        "The pairing out of balance. Rupture, or a bond one side is carrying.\n\nIn a person: a break, or a partnership that has become unequal."),
    "Three of Cups": (
        "Shared gladness. Friendship, community, and a good thing celebrated together.\n\nIn a person: belonging to a small group that matters.",
        "The circle gone sour. Exclusion, gossip, or celebration turned excess.\n\nIn a person: a falling-out, or a crowd they no longer belong in."),
    "Four of Cups": (
        "Three cups ignored and a fourth offered. Discontent in the presence of enough.\n\nIn a person: apathy, or a dissatisfaction they cannot account for.",
        "The offer noticed at last. Withdrawal ending, or apathy hardening into refusal.\n\nIn a person: someone coming out of it, or someone settling into it."),
    "Five of Cups": (
        "Three spilled, two standing, and the eyes on the spill. Grief that has not yet turned round.\n\nIn a person: a loss still governing them, and something behind them they have not counted.",
        "The turn beginning. Grief releasing, or regret finally set down.\n\nIn a person: recovery starting, or mourning that has become identity."),
    "Six of Cups": (
        "The past offered as a gift. Nostalgia, childhood, an old kindness returning.\n\nIn a person: sentiment, and a formative history they carry warmly.",
        "The past holding on. Living backwards, or a memory better than the thing it recalls.\n\nIn a person: someone stuck in a former life, or ready to leave it."),
    "Seven of Cups": (
        "Seven visions and one real choice. Possibility as a form of paralysis.\n\nIn a person: imagination, wishful thinking, and difficulty committing.",
        "The illusions clearing. A real option identified, or a fantasy finally abandoned.\n\nIn a person: focus arriving, or a dream given up."),
    "Eight of Cups": (
        "Walking away from what was built. Departure by choice, from something not obviously wrong.\n\nIn a person: the decision to leave, and the resolve to not look back.",
        "The departure refused. Staying in what is finished, or leaving and returning.\n\nIn a person: drift, or a leaving they cannot quite complete."),
    "Nine of Cups": (
        "Satisfaction, plainly. The wish granted and enjoyed.\n\nIn a person: contentment, indulgence, and a life that is currently good.",
        "Satisfaction that does not hold. The wish granted and found wanting.\n\nIn a person: smugness, or a pleasure that has stopped working."),
    "Ten of Cups": (
        "Fulfilment shared. Family, harmony, the good ending that lasts.\n\nIn a person: a home and people that are genuinely well.",
        "The picture cracked. Discord under an intact surface, or an ideal that does not match the life.\n\nIn a person: a family in trouble, or someone chasing a picture rather than a fact."),
    "Page of Cups": (
        "A fish in the cup — the unexpected offered gently. Sensitivity, and news of the heart.\n\nIn a person: openness, artistry, and a young feeling not yet tested.",
        "Feeling immature or misused. Moodiness, or sensitivity turned inward.\n\nIn a person: emotional immaturity, or creativity blocked."),
    "Knight of Cups": (
        "The romantic on a slow horse. Idealism, an offer made in earnest.\n\nIn a person: charm, devotion, and a life led by feeling.",
        "The romance unreliable. Moodiness, promises unkept, or feeling that is all display.\n\nIn a person: someone in love with the idea of it."),
    "Queen of Cups": (
        "Deep feeling under a calm surface. Compassion that comes with real perception.\n\nIn a person: empathy, intuition, and the ability to hold other people's trouble.",
        "The surface disturbed. Overwhelm, martyrdom, or feeling used as leverage.\n\nIn a person: someone drowning in others' needs, or manipulating through them."),
    "King of Cups": (
        "Emotion mastered without being denied. Steady in a crisis because the depth is governed.\n\nIn a person: wisdom, tolerance, and self-possession under strain.",
        "The mastery false. Suppression, volatility, or kindness with a cold centre.\n\nIn a person: control that has become coldness, or a calm about to break."),
}

MINORS.update({
    # ---- Swords: mind, conflict, truth, harm -----------------------------
    "Ace of Swords": (
        "The blade of clarity. A truth arrived at cleanly, and the power that comes with naming it.\n\nIn a person: incisiveness, and a breakthrough in understanding.",
        "The blade misused. Clarity turned cruel, or a truth that cuts without purpose.\n\nIn a person: confusion, or honesty wielded as a weapon."),
    "Two of Swords": (
        "Blindfolded, two blades held level. A decision refused because both options cost.\n\nIn a person: stalemate, and the effort it takes to keep not choosing.",
        "The blindfold off. The decision forced, or information arriving that ends the impasse.\n\nIn a person: a choice finally made, or a truth they can no longer avoid."),
    "Three of Swords": (
        "The heart pierced, plainly. Grief, betrayal, the pain that is not softened by understanding it.\n\nIn a person: a specific wound, and the clarity that came with it.",
        "The blades withdrawn. Recovery, or pain nursed past its season.\n\nIn a person: healing beginning, or a hurt they will not stop rehearsing."),
    "Four of Swords": (
        "Rest, deliberately taken. Recuperation before the next thing, not surrender.\n\nIn a person: withdrawal to recover, and the discipline to allow it.",
        "Rest refused or overrun. Exhaustion pushed through, or retreat that has become permanent.\n\nIn a person: burnout, or someone who cannot get up again."),
    "Five of Swords": (
        "A victory not worth having. The field won, the allies gone.\n\nIn a person: someone who wins arguments and loses people.",
        "The cost counted. Reconciliation attempted, or defeat finally accepted.\n\nIn a person: regret over a win, or a grudge being set down."),
    "Six of Swords": (
        "Passage to calmer water, carrying the blades. Transition away from harm, not free of it.\n\nIn a person: a move made for safety, and what they brought along.",
        "The crossing stalled. Unable to leave, or carrying the trouble to the new place.\n\nIn a person: an escape that did not work."),
    "Seven of Swords": (
        "Taking what is not yours and walking off. Stealth, cunning, a plan that depends on not being seen.\n\nIn a person: strategy, deception, and comfort with acting alone.",
        "The theft discovered, or abandoned. Conscience, exposure, or a scheme returned.\n\nIn a person: someone caught, or someone choosing to come clean."),
    "Eight of Swords": (
        "Bound and surrounded, with the way out unwatched. Restriction that is largely believed.\n\nIn a person: a trap they have not tested, and the belief that keeps them in it.",
        "The bindings loosening. Realisation of freedom, or a restriction becoming real.\n\nIn a person: someone waking up to their own options."),
    "Nine of Swords": (
        "Awake at night with the worst of it. Anguish, guilt, the fear that grows in the dark.\n\nIn a person: private torment out of proportion to the day.",
        "The night ending, or deepening. Fear faced, or despair settling in.\n\nIn a person: relief arriving, or a dread that has become the whole view."),
    "Ten of Swords": (
        "The worst has happened and is finished. Ruin, complete, with dawn behind it.\n\nIn a person: a definitive ending, and the strange freedom on its far side.",
        "The end not quite reached. Recovery beginning, or a decline still running.\n\nIn a person: someone getting up, or someone refusing to admit it is over."),
    "Page of Swords": (
        "A watcher with a new blade. Curiosity, vigilance, ideas held sharply and not yet wisely.\n\nIn a person: sharpness untempered, and a talent for noticing.",
        "Watching turned to spying. Suspicion, gossip, or cleverness used carelessly.\n\nIn a person: someone who cannot stop testing people."),
    "Knight of Swords": (
        "Charging with the point forward. Conviction at speed, argument as motion.\n\nIn a person: directness, impatience, and no interest in the diplomatic route.",
        "The charge without aim. Aggression, haste, or a mind that will not be turned.\n\nIn a person: someone who has run over people to be right."),
    "Queen of Swords": (
        "Clear sight bought with experience. Honest, unsentimental, and hard to deceive.\n\nIn a person: independence, precision, and a low tolerance for pretence.",
        "Clarity turned cold. Bitterness, cruelty in the name of honesty, or isolation.\n\nIn a person: someone whose defences have become the whole personality."),
    "King of Swords": (
        "Judgement and authority together. Intellect applied to the governing of others.\n\nIn a person: rigour, principle, and the expectation that reason will settle it.",
        "Judgement misapplied. Tyranny of logic, manipulation, or power without conscience.\n\nIn a person: someone who is right and ruinous."),

    # ---- Pentacles: body, work, money, the material ----------------------
    "Ace of Pentacles": (
        "A coin offered. Opportunity with substance — work, money, or a real foundation.\n\nIn a person: prosperity beginning, and a practical chance worth taking.",
        "The coin dropped. Opportunity missed, or a foundation that will not hold.\n\nIn a person: a false start, or scarcity where there should be plenty."),
    "Two of Pentacles": (
        "Two coins kept moving. Juggling, adaptability, obligations balanced by constant motion.\n\nIn a person: flexibility, and a life with no slack in it.",
        "The juggling failed. Overcommitment, or the balance dropped.\n\nIn a person: someone overwhelmed by what they took on."),
    "Three of Pentacles": (
        "The craftsman consulted by those who commissioned the work. Skill recognised and collaborating.\n\nIn a person: competence acknowledged, and a place in a team.",
        "The collaboration failing. Skill unrecognised, or work done without care.\n\nIn a person: someone whose contribution is not being counted."),
    "Four of Pentacles": (
        "Everything held tightly. Security through possession, and the rigidity that follows.\n\nIn a person: control over resources, and a fear of losing them.",
        "The grip loosening. Generosity, or loss that was resisted.\n\nIn a person: someone learning to let go, or clinging harder as it slips."),
    "Five of Pentacles": (
        "Out in the cold, past a lit window. Hardship, exclusion, and help nearby but unasked for.\n\nIn a person: poverty of some kind, and the pride or shame that keeps them outside.",
        "Coming in from the cold. Recovery, help accepted, or hardship deepening.\n\nIn a person: a turn for the better, or a fall further."),
    "Six of Pentacles": (
        "Coins weighed and given. Charity, patronage, and the imbalance of power inside generosity.\n\nIn a person: a giver or a receiver, and an awareness of which.",
        "The scales tipped. Strings attached, debt, or generosity with a price.\n\nIn a person: someone paying for what was called a gift."),
    "Seven of Pentacles": (
        "Leaning on the hoe, assessing the crop. Patience, and the question of whether to keep investing.\n\nIn a person: long-term work, and a moment of honest reckoning about it.",
        "The harvest poor. Effort wasted, or impatience with a slow return.\n\nIn a person: someone about to abandon something nearly ripe."),
    "Eight of Pentacles": (
        "The same coin struck again and again. Craft, apprenticeship, mastery through repetition.\n\nIn a person: diligence, and pride taken in the doing.",
        "The repetition without purpose. Perfectionism, drudgery, or skill going nowhere.\n\nIn a person: someone trapped at the bench by their own excellence."),
    "Nine of Pentacles": (
        "The walled garden, earned and enjoyed alone. Independence, refinement, self-sufficiency.\n\nIn a person: comfort they built themselves, and the solitude in it.",
        "The garden hollow. Comfort without meaning, or independence that is really isolation.\n\nIn a person: someone who has everything and no one."),
    "Ten of Pentacles": (
        "Wealth across generations. Legacy, family, and the security of an established house.\n\nIn a person: inheritance, tradition, and a place in a line that continues.",
        "The legacy broken. Debt inherited, family fortune lost, or a house that no longer holds.\n\nIn a person: where a legacy should be, a bill."),
    "Page of Pentacles": (
        "A student turning a coin over. Study, apprenticeship, an ambition that is still learning.\n\nIn a person: earnestness, and a long project just started.",
        "The study abandoned. Distraction, or a plan without the work behind it.\n\nIn a person: someone who wants the result and not the practice."),
    "Knight of Pentacles": (
        "The slowest knight, and the one who arrives. Method, reliability, and unglamorous persistence.\n\nIn a person: someone who finishes what they start and complains about nobody but themselves.",
        "Persistence gone inert. Stubbornness, tedium, or a rut mistaken for a road.\n\nIn a person: someone who will not stop and will not adapt."),
    "Queen of Pentacles": (
        "Practical care. A household run well, resources handled sensibly, warmth expressed as provision.\n\nIn a person: nurture that is competent as well as kind.",
        "The provision failing. Overwork, self-neglect, or care given only in material terms.\n\nIn a person: someone who feeds everyone and eats last."),
    "King of Pentacles": (
        "Wealth mastered and used. Enterprise, reliability, and generosity that costs him nothing.\n\nIn a person: security, and the confidence of a person who has never been short.",
        "Wealth as the whole measure. Greed, materialism, or a fortune protected at everyone's expense.\n\nIn a person: someone who prices what should not be priced."),
})


def build():
    deck = []
    for name, val in MAJORS.items():
        # A parenthesised single string is a string, not a 1-tuple, so the
        # majors whose reversed reading lives in MAJOR_REVERSED arrive here as
        # bare strings. Indexing those gives one character, which is what the
        # length check below caught.
        if isinstance(val, str):
            up, rev = val, MAJOR_REVERSED.get(name)
        else:
            up = val[0]
            rev = val[1] if len(val) > 1 and val[1] else MAJOR_REVERSED.get(name)
        if not rev:
            sys.exit(f"no reversed reading for {name}")
        deck.append({"name": name, "arcana": "major", "upright": up, "reversed": rev})

    suit_of = {"Wands": "wands", "Cups": "cups", "Swords": "swords",
               "Pentacles": "pentacles"}
    for name, (up, rev) in MINORS.items():
        suit = next((v for k, v in suit_of.items() if name.endswith(k)), None)
        if not suit:
            sys.exit(f"cannot place {name} in a suit")
        deck.append({"name": name, "arcana": "minor", "suit": suit,
                     "upright": up, "reversed": rev})
    return deck


def main():
    deck = build()
    names = [c["name"] for c in deck]
    if len(names) != len(set(names)):
        sys.exit("duplicate card names in the deck")
    if len(deck) != 78:
        sys.exit(f"deck has {len(deck)} cards, expected 78")
    majors = [c for c in deck if c["arcana"] == "major"]
    if len(majors) != 22:
        sys.exit(f"{len(majors)} majors, expected 22")
    for c in deck:
        for k in ("upright", "reversed"):
            if len(c[k]) < 80:
                sys.exit(f"{c['name']} {k} reading is too short to be useful")

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write("window.L5R_TAROT = ")
        json.dump(deck, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    print(f"tarot: {len(deck)} cards ({len(majors)} major, {len(deck)-len(majors)} minor), "
          f"each with an upright and a reversed reading -> "
          f"{os.path.relpath(OUT, ROOT)} ({os.path.getsize(OUT)/1024:.1f} KB)")


if __name__ == "__main__":
    main()
