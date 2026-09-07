# Mask of the Oni — pack audit

Pass A closed 2026-09-07. Thirteen archive records (twelve with portraits; Kaito Kohana has none),
`l5r5e-0.4-mask-of-the-oni.arc/.lore/.codex`, `l5r5e-0.4-knotted-tails.arc/.lore/.codex`, the pack's
relationship map (59 nodes, 46 NPCs, **no defined party lines**), and the pencilled rationale in
`src/foundry_sources.json`. The deterministic half ran first as `scripts/audit_lints.py "Mask of the
Oni"` → 22 blocks, 40 warnings; every one is placed below.

The adventure: 1123. The PCs are drawn in by the theft of **Yasuki Keiji's maps**, cross the Kaiu Wall
(Yasuki Ippei the crooked quartermaster; Kaiu Riko the gruff engineer-historian; Bayushi Tsubasa the
Scorpion fixer with leverage on Ippei; Hida Hachirō grants passage; gunsō Hida Nagahide — a scarred
woman — leads the escort), three days through the Shadowlands (The Knotted Tails plays here), to Shiro
Hiruma, where Kitsu Sokori is unmaking Hiruma Masami's ritual. **Masami's name is a GM secret** — the
book says it must reach the PCs only through the scroll in the library.

Decisions are numbered for answering by number. Rewrites are full text. "Trade" says what is lost.

**State at 2026-09-07:** approved and applied — D1–D9, D12, D14–D17, D33–D35 (commit below). Under review: D10, D13. Clarifying: D36–D38. Open (not yet answered): D11, D18–D32. D2's mentor text is written for the field's name (Kaiu Mabuchi); D18 would swap it to Riko. D5's Rikona line waits on D13.

---

## A. Errors (fix outright unless marked *ask*)

**D1 — NPC gender fields against the pronoun the text uses** (text governs, per the ruling):
Takuma (Emon) → male · Asahina Kano (Emon) → male · Hida Tatsukichi (Anzu) → male · Kakita Den
(Namiko) → male · Kitsu Tokuhei (Rikona) → male · Takatora (Teruyo) → male · Hida Mayo (Yasu) →
female · Moto Sakuro (Yoshiteru) → female ("recognized in her the same fracture").
*Ask:* Tonbo Katai (Agasha Kohana) is marked **nonbinary** but the line says "admit to him" — the
Genjo ruling was they/them for nonbinary; recommend the text → "to them", keep the field.

**D2 — Kaiu Anzu's mentor text is empty.** Kaiu Mabuchi, path B, grants Overconfidence in
Toughness, text `""`. Must be written; D18 proposes who the mentor is.

**D3 — Bayushi Hirofumi's mentor text is about the wrong person.** Field: Soshi Ujimasa (grants
Urbane and Worldly). Text: "Bayushi Yojiro taught Hirofumi…" Rewrite for Ujimasa:
> Soshi Ujimasa taught Hirofumi to pass a season in another clan's castle without anyone remembering
> his face, and to hear what a mess hall says about a man who has just come back from the Wall;
> Hirofumi uses it now to sit among returning Deathdealers unremarked and listen for the one who
> answers a half-beat late.

**D4 — Sloppy words.** Yoshiteru Q11 "a *Phoenician* shugenja" → Phoenix. Hirofumi Q5 "Deathealers"
→ Deathdealers. Yoshiteru Q16 "costs him three strife" — game terms in prose; rewrite:
> When Yoshiteru reports to Tamiko on a shugenja's fraying concentration, the woman's face goes still,
> and he is certain he has just condemned someone to die by his own hand instead of saving them.

**D5 — A GM secret and the villain in public data.** Yukitsuna's Q15 names **Masami** ("finds the
moment when Masami chose to stop running") — the one name the book says the PCs must not have — and
Q15/Q16 name **Sokori** and **Keiji's stolen maps** as things she has already handled. Rikona's Kitsu
Tokuhei line has her "studied under the mahō-tsukai **Sokori**." Both must go from `data/`. The Q10
regrounding in D14 and the villain question in D13 carry the rewrites.

**D6 — Lord field vs the name in the prose: ten of thirteen.** Only Yoshiteru (Shiba Tamiko), Nara
and Teruyo (no lord) agree. Applying the standing rulings — (1) prose names one person many times and
the field another once → the field is wrong; (3) title only → it is the person in the field; a broken
name in the prose → the field wins:

| PC | field | prose | ruling | recommend |
|---|---|---|---|---|
| Hiruma Namiko | Hiruma Kaneie | Hiruma Kaiten ×7 | (1) | **field → Kaiten** |
| Kaiu Anzu | Kaiu Yushiro | Kaiu Haruka ×7, "chief engineer" | (1), but see D17 | **field → Haruka** |
| Daidoji Emon | Daidoji Watanabe | Daidoji Kenshin ×6 | (1) | **field → Kenshin** |
| Asako Yukitsuna | Asako Tamaki | Asako Satoru ×3, "chief inquisitor" | (1) | **field → Satoru** |
| Moto Azumamaro | Moto Shigeaki | Moto Chagatai ×9, "his daimyō" | canon: in this corpus Chagatai is *the khan's son and heir* (Moto Ogödei is khan) — not a daimyō in 1123 | **prose → Shigeaki** |
| Bayushi Hirofumi | Bayushi Kiku | Bayushi Yojiro ×7, "master of the Deathdealer School" | canon: Yojiro is an Emerald Magistrate | **prose → Kiku** |
| Matsu Rikona | Matsu Kadiri | "Matsu Vorantis" ×5 | not a Rokugani name | **prose → Kadiri** |
| Kaito Kohana | Kaito Buzen | "Kaiu Yotsubei, the Wall's chief architect" ×3 | cross-clan lord, see D17 | **prose → Buzen** (Buzen *sends* her to the Wall) |
| Yogo Yasu | Yogo Shingorô | "Kaiu Sozen, the Kaiu Wall's chief architect" ×4 | cross-clan lord, see D11/D17 | **prose → Shingorô** |
| Agasha Kohana | Agasha Hachijûrô | "the garrison commander" (title) | (3) | **name Hachijûrô** |

Rikona's Kitsu Tokuhei line ("does not report them to Vorantis") and Azumamaro's Moto Daichi
("Chagatai's closest advisor") follow their rows.

---

## B. Contradictions

**D7 — Namiko's "castle."** She "lies on the castle's outer wall at midnight," charts "the castle's
perimeter" weekly, and the scouts trade sketches of "its original architecture" — but Shiro Hiruma is
three days into the Shadowlands and no Hiruma has stood on its wall in four centuries. Two readings:
(a) "the castle" is a Hiruma watch-fort on the Wall — coherent, but her ninjō ("walk inside the
castle's walls") loses the pull the pencil gave her: *going home to that ruin*. (b) "The castle" is
Shiro Hiruma, watched and charted **from the forward scout posts**; the wall she lies on is the Kaiu
Wall's parapet. **Recommend (b).** Rewrites (with Kaiten per D6):
> **Giri.** Namiko reports daily to her lord Hiruma Kaiten on what the scouts have seen of the
> approaches to Shiro Hiruma, and he has not yet ordered her inside.
> **Q11.** Namiko sorted a forward post's provisions by weight and spoilage while Kaiten slept, asked
> him nothing when he woke, and he put her on the next run toward the ruin because he had seen what
> she already knew. *(the old line had him "order her inside the castle the next morning," against the
> giri's "has not yet asked")*
> **Q7.** Namiko checks the approach charts against the previous week's and finds herself marking the
> same collapse in the same sections of the ruin, which means either nothing has changed or she has
> stopped seeing what is there.
> **Q15.** She lies on the Wall's parapet at midnight with the charts spread beside her and checks each
> star against the positions she marked the week before, because the heavens have not moved while
> everything else falls in.
> **Q16.** Namiko marks the same three sections of the ruin collapsing week after week on the approach
> charts and cannot tell whether the castle is crumbling or she has stopped noticing what changes.
> **Kakita Den.** Namiko trades Kakita Den her observations of the ruin's collapse for his sketches of
> Shiro Hiruma as it stood, then spends the next morning comparing what he drew to what the scouts
> report still standing, trying to decide whether she is watching it fall or forgetting how to see.
> **Q20.** Namiko dies on the Wall at dawn, having checked the same three sections of chart against the
> stars one final time and found nothing changed, and she does not regret it because she was finally
> certain she had seen everything there was to see.

**D8 — Emon holds "the Kaiu Barrier" for a Crane lord.** The Crab hold the Wall. Reading: Emon is in
the **Crane detachment lent to the Wall** (the pencil: "the Crane's field-army school going into the
Shadowlands with everyone else"), and "the Kaiu survey" he alone believes is **Anzu's certification**
— the pencil's own design: "the Daidoji is the only one who has read the Kaiu's report and believes
it, and the Kaiu is privately certain the castle cannot be held." Trade: he stops being the lone map
genius and becomes the man who believes a report its author doesn't; D26 makes it a party line.
> **Giri.** Emon serves Daidoji Kenshin in the Crane detachment lent to the Kaiu Wall, and Kenshin has
> made it plain that the Crane hold their section until written orders from the Crane Champion say
> otherwise, whatever the surveys say.
> **Ninjō.** Emon wants the Kaiu certification proven right in stone—the section Kaiu Anzu signed for
> holding where her report says it will—because he is the only Crane on the Wall who has read it and
> believed it, and he has begun to suspect she does not.
> **Q7.** Emon defers to Kenshin's orders with perfect courtesy while privately convinced that every
> disposition Kenshin approves is drawn from surveys a season out of date.
> **Q11.** Emon convinced the Kaiu engineers on the Crane section to redraw a fortification to the
> survey he carried, though they resisted until he showed them the page that contradicted their own.
> **Q10** *(past; grounds Nerve Damage, which the record never shows — lint).* At the dōjō Emon's right
> hand stiffened in the cold and would not close on the spear shaft; he learned to bind the grip and
> finish the drill, and no instructor was ever told why he was slow to the draw.
> **Q16.** Emon fears that somewhere in the survey's margins or the engineers' corrections or his own
> careful rewrites there is the one line that mattered, and that he will have spent weeks arguing about
> the rest while people died.
> **Q14.** Emon listens to someone describe a fortification and begins nodding along, then stops
> mid-nod and says "that's not what the Kaiu survey shows," and the strain shows in his face as he
> realises he has contradicted someone of higher rank without being asked; his right hand stays curled
> at his side, the fingers slow to open.
> **Takuma.** Takuma runs the Mazoku's Enforcer house in the province, and Emon brings him the Kaiu
> survey to check against—not for permission, but to prove that someone else has read it carefully
> enough to catch what Kenshin and the engineers will not.
Q15 keeps, "Kenshin's formal script" as written.

**D9 — Anzu's record is written at the gate.** "Haruka is waiting for her to swear to the report *on
her way out through the gates*"; Tatsukichi "is now somewhere *beyond the gates* with orders to hold
[a Wall section]" — the Wall is on the Rokugan side; nothing is held beyond it. Reground on the past
and on standing conditions (Q10 ruling). Her ninjō — "walk back through the Wall with a report that
the castle can be held" — is a want about the expedition and stays.
> **Giri.** Anzu serves Kaiu Haruka and certifies which sections of the Wall can hold before Haruka
> decides what to reinforce and what to give up—a judgment she makes from the stones upward, never
> looking at what made them weak.
> **Q10.** Anzu has not told Haruka that the section she certified is already failing, because saying
> so means saying she lied about the stones, and every week Haruka does not ask her to swear to the
> report the lie costs more to take back.
> **Q16.** Anzu certifies sections of the Wall by the strength of their stone alone, and fears the day
> Haruka asks her to swear to a report she has already signed.
> **Hida Tatsukichi.** Hida Tatsukichi certified the same section of Wall that Anzu did, signed his
> name under hers, and now commands the watch that stands on it.
Q7, Q11, Q15, Q14, Q20 keep.

**D10 — Agasha Kohana's "Dragon's Shadowlands garrison."** The Dragon keep no Shadowlands garrison;
read it as the Dragon detachment at the Wall. Her giri is also self-reporting, not a set duty.
> **Giri.** Kohana brews and rations the jade wards for the Dragon detachment at the Kaiu Wall, and
> accounts for every vial to Agasha Hachijûrô each month, knowing the numbers show she has burned
> through reserves meant to last three seasons.
> **Q7.** Kohana reports to Hachijûrô consumption figures higher than they should be, which the Dragon
> read as diligence, when she is documenting her own failure to ration.
*Ask:* her gear carries a **Norimono (palanquin)** — a custom pick outside the Alchemist outfit. Into
the Shadowlands on a wooden leg it is either a joke or a statement; recommend **drop**.

**D11 — Yasu's "Shadowlands curse in the Yogo crypts beneath the Wall."** The Yogo curse is the
Scorpion family's own (betray the one you love most); the Preservers keep sealed things in Yogo lands,
not under the Kaiu Wall, and a Yogo does not serve a Kaiu architect. Reading: the seals are beneath
**Yogo Shiro**; Shingorô has sent her to the Wall with orders she is not to explain (the pencil: "a
warder who will not say what he was sent to seal"). Her ninjō — a family the curse cannot reach — is
the best in the pack and stays untouched.
> **Giri.** Yogo Yasu serves Yogo Shingorô and reports to him monthly on the integrity of the seals
> beneath Yogo Shiro that bind what the Preservers have put away, and she has come to the Wall under
> orders she is not to explain.
> **Q11.** When Shingorô asked her to verify the seals beneath Yogo Shiro, Yasu spent three months in
> the vaults reading the original binding-work so carefully that she found the fracture-point the
> senior preservers had missed, and reported it to Shingorô alone before the flaw could widen.
> **Q16.** Every month when she climbs back down to the seals, Yasu carries the certainty that this
> time the fracture will have widened beyond what three months of careful work could have found, and
> that Shingorô will learn of it only after what is behind it has begun to move.
> **Q20.** Yasu will die in the vaults because she miscounts the knots on her cord and descends one
> month too late, finding the fracture already open.
Q7 "crypts" → "vaults". Hida Mayo → D21.

**D12 — Nara's father "was a Crab mason."** A nezumi's father is a nezumi. (a) She grew up at the
foot of the Wall scavenging the masons' spoil and a Crab mason let her watch his gang set stone —
keeps the stone-reading, the Craftsperson upbringing and the Crab tie, drops the paternity. (b) Her
father was a nezumi who worked stone for the burrows — cleaner, loses the Crab. **Recommend (a):**
> Nara grew up at the foot of the Kaiu Wall scavenging the masons' spoil, and a Crab mason named Ishibe
> let her watch his gang set stone until she could read a wall the way scouts read ground; she has
> never stopped expecting people to follow her the way his apprentices followed him.

**D13 — Rikona "studied under the mahō-tsukai Sokori."** This puts the villain's name in public data
and gives Sokori a student the book never gave her. (a) An unnamed mahō-tsukai — the GM can make it
Sokori at the table, and Rikona's Reformed Mahō-Tsukai keeps its teeth. (b) Keep. **Recommend (a):**
> Kitsu Tokuhei sat across from her at the war table in the Lion compound three winters ago, before she
> took the scout's work, and asked her straight if the blood magic she had studied under a mahō-tsukai
> in the years she does not name still had hold of her fingers, and she lied and said no, and he has
> not asked again, but he watches the passages she chooses to map and does not report them to Kadiri.
Soft flag, no action proposed: the record is scout-shaped end to end for a **Berserker** the pencil
chose as "the weight." If you want the school to show, say so and I will propose.

**D14 — Yukitsuna is written inside the adventure.** Q10 is "the climb up to Shiro Hiruma"; Q15 has
Sokori's stolen maps, Keiji's notations and Masami's name; Q16 has her questioning Keiji; Mirumoto
Gina "made the climb to Shiro Hiruma easier." Reground on Inquisitor work already done (Satoru per D6):
> **Giri.** Asako Yukitsuna serves Asako Satoru of the Inquisitors, and must report what she finds
> where the Taint has been at work even when it implicates someone she travelled with to find it.
> **Q10.** On the Inquisitors' winter circuit through the Dragon foothills Yukitsuna fell behind on the
> steep passages, breathing hard while the others moved steadily on, and she did not ask them to slow
> down; the report of that circuit is the only one she has ever filed late.
> **Q15.** Yukitsuna spreads a case's papers across the archive floor and traces the order of events in
> charcoal, checking each witness against the Asako records, and finds the moment when someone chose
> to stop telling the truth.
> **Q16.** She stops asking the moment a suspect offers an explanation, then spends the ride home
> certain she has missed something and too impatient to turn back and verify it.
> **Mirumoto Gina.** Mirumoto Gina taught Yukitsuna to move through difficult terrain without stopping,
> which made the mountain circuits shorter and made it impossible to admit she was struggling.
Q7 keeps with Satoru. Q11 (the Hiruma widow at Shiro Kaiu) is past and stays.

**D15 — Azumamaro's giri is self-assigned** ("though Chagatai has never explicitly ordered him to do
this"). A giri is set. With Shigeaki per D6:
> **Giri.** Moto Azumamaro serves Moto Shigeaki, who has him ride the borderlands alone watching for
> the Taint before it spreads into the herds and camps, and who grows impatient with reports that
> arrive too slowly to act on.
Q7, Q11 ("Shigeaki's closest advisor"), Q10, Q15, Q16, stress: name swap only.

**D16 — Emon's Q16 and Q10 were future/present scenes** ("when Emon finally receives word that the
Barrier has fallen"; "by then Kenshin's written orders are still weeks away") — covered by D8.

**D17 — Three heads of one Wall.** Kaito Kohana's "Kaiu Yotsubei, the Wall's chief architect," Yasu's
"Kaiu Sozen, the Kaiu Wall's chief architect," Anzu's "Kaiu Haruka, the Wall's chief engineer." D6
removes two; Haruka stays as Anzu's lord and the Wall's engineer. If you would rather the pack know
**one** Kaiu of rank, the adventure supplies Kaiu Riko (D18/D19).

---

## C. Consolidation (recommendations; each names its trade)

**D18 — Kaiu Riko as Anzu's mentor** (fills D2). Riko is the adventure's "gruff engineer, expert in
ancient Crab fortifications," won over with a Command check. Trade: if Anzu already knows her the check
loses bite; the GM gains a reason Riko talks at all. Text (Overconfidence in Toughness is the grant):
> Kaiu Riko taught Anzu that the old Crab fortifications were built to hold and will hold, and that an
> engineer who doubts the stone has already lost it; Anzu learned to certify from the stone up and to
> keep her doubts where Riko kept hers.

**D19 — Kaiu Jirôzaemon (Rikona) → Kaiu Riko.** "The Crab engineer who maps the Wall's structural
weaknesses on paper while Rikona maps them in her body" is Riko's expertise. Trade: two PCs on one
adventure NPC; fewer invented Kaiu. Line: name swap, plus Q11 "Riko changed the Wall's reinforcement
schedule."

**D20 — Soshi Machi (Namiko) → Bayushi Tsubasa.** The Scorpion who reports on a Crab scout to Scorpion
command is the adventure's Scorpion fixer who already gathers leverage at the Wall. Trade: none I can
see; Tsubasa gains a PC who knows to be careful.
> Bayushi Tsubasa sends Namiko's weekly reports on the ruin's approaches to Scorpion command sealed
> inside Tsubasa's own, and Namiko has learned not to ask what those reports say about her, because
> the answer would force her to choose between her duty to the Crab and letting someone else carry
> half the weight.

**D21 — Hida Mayo (Yasu) → Hida Nagahide**, the gunsō who leads the escort (a scarred veteran, she/
her). Trade: the escort leader arrives already knowing one PC. Text:
> Hida Nagahide watched Yasu check the same joints in the Wall twice on the day she arrived, and did
> not ask why, because she has learned that the Yogo do not answer questions about what they are
> afraid of.
Keep Hida Tatsukichi (Anzu) as written in D9.

**D22 — Yasuki Ippei into Agasha Kohana's jade.** She can taste adulteration; the adventure's
quartermaster is crooked. Kuni Soichiro line:
> Kuni Soichiro taught Kohana to test jade purity by taste, a method the Crab consider crude, but she
> has gotten so precise at it that she can identify adulteration he misses—and the last two issues from
> Yasuki Ippei's stores failed her tongue.
Trade: names a Part Two NPC in a record; gives her a reason to lean on him in the supply scene.

**D23 — Names.** Two PCs named **Kohana** in one pack (Agasha, Kaito) — your end-of-run pass #3.
Kaito Kohana has no portrait yet, so renaming her costs nothing: **Kaito Yayoi**, Kaito Chiharu, Kaito
Sumire. Two NPCs named **Noriko** (Kitsune Noriko, Toritaka Noriko): rename Kitsune Noriko → **Kitsune
Sayuri**. *Ask* — you chose "Kaito Kohana" by name.

**D24 — Nara and Teruyo are the same asking.** Teruyo went in ten years ago "when a nezumi elder asked
her to find his kin," and "said yes when the nezumi asked again"; Nara's pack "will not take the Hiruma
route with her anymore." Make the elder a Tattered Ear and the second asking Nara's — the pencil's
"pair rather than a coincidence." Trade: none; a defined party line.
> **Teruyo Q(past).** Teruyo led three hunters into the Shadowlands ten years ago when a Tattered Ear
> elder asked her to find his kin, and only she came back, which is why she teaches now instead of
> ranging, and why she said yes when the Tattered Ear asked again.
> **Teruyo ninjō.** Teruyo wants to teach someone who will survive long enough to teach others, and
> the Tattered Ear's second asking has already cost her the answer to whether she can.
> **Teruyo Q11.** Teruyo brought a hunter back from the Shadowlands when the Tattered Ear elder's
> second asking sent her in after the kin she had failed to recover, and the younger woman is still
> alive to doubt her own survival choices.
> **Nara ninjō.** Nara wants the pack to come back out on a route with her, just once, so she can stop
> being the only one who knows what she knows; the tengu the elder sent for is the first outsider who
> has agreed to walk it.

**D25 — Nara's maps are Keiji's maps.** Miya Akazome "holds the maps Nara needs to prove the route is
still passable" — the adventure opens with Yasuki Keiji's Shadowlands maps stolen. Trade: puts a Miya
in Keiji's chain of custody the book doesn't have; gives a nezumi a reason to walk in with samurai.
> Miya Akazome of the Imperial court held Yasuki Keiji's maps of the Shadowlands routes for the
> Imperial survey, and would not let Nara see them while Nara contradicted the official account of what
> happened to the Tattered Ear in the deep dark; the maps are gone now, and Nara means to be there when
> they are found.

**D26 — Emon ↔ Anzu defined party line** (from D8/D9): he has read her certification and believes
it; she knows the section is failing. Emon's ninjō above names her; add to Anzu's Q10 the clause "…and
the Crane who quotes her report back to her has never once asked."

**D27 — Yoshiteru ↔ Azumamaro.** The pencil: the Moto heals by taking the wound himself, "the one the
Shiba cannot protect him from." Yoshiteru's ninjō is a stance, not a want (lint). Rewrite with a face:
> Yoshiteru wants Tamiko to tell him which shugenja he is to die for, so the choosing is no longer his;
> she has never answered, and he has gone on choosing, and the Moto healer who takes wounds by choice
> is the first he has not been able to place on either list.
Trade: the ninjō touches a PC; if the table swaps the Moto out, the last clause goes.

**D28 — Hirofumi ↔ Yukitsuna** *(optional; ask)*. Isawa Machiko saw Hirofumi kill a returner and
"has never told." She could be Yukitsuna's fellow inquisitor — then Yukitsuna knows what Hirofumi did
and her ninjō ("wants to believe the people she travels with are good") has a face. Trade: hands one
PC a secret about another before play; strong at the table, and exactly the kind of thing to ask
before doing.

Not proposed: Namiko ↔ Hozumi (his fate is the plot); anything touching Sokori's history.

---

## D. Portraits are canon

**D29 — Rikona's nails.** Q14: "fingernails bitten past the quick, the skin scarred white." Portrait:
intact nails painted white, and a pale scar from the left brow across the cheek that no line mentions.
(a) The scar takes Q14; the nails go: *"A pale scar runs from Rikona's left brow to the corner of her
mouth, and she does not seem to know she is touching it even while talking to you."* (b) Keep the habit
under the paint: *"Rikona paints her nails white over quicks bitten to the scar, and a pale scar runs
from her left brow to the corner of her mouth; she does not seem to know she is touching either."*
**Recommend (a).**

**D30 — Agasha Kohana's leg.** Q14: crutch and visible stump. Portrait: a wooden leg below the left
knee and a staff in the left hand. → *"Kohana walks the garrison on a wooden leg strapped below the
left knee, a staff in her left hand, and stops to shift her weight before every step down."*

**D31 — Settled by portrait:** Emon's spear → **yari** (either-or closed); Anzu holds the **chalk**;
Hirofumi's **vial** on its cord; Rikona's **sake bottle**; Azumamaro's **map tube**, horse and fur;
Teruyo's **bō, herb bundle, journal**; Nara's **folding half-bow** and a **bone knife** (→ one of the
"two items of rarity 2 or lower," D34); Namiko's **bowl** and **jade pendant** (Finger of Jade);
Yasu's **hammer**. Nothing in any picture contradicts a record except D29/D30.

**D32 — Kaito Kohana has no portrait.** A Midjourney prompt after D23 decides her name.

---

## E. Accoutrements (all eleven in the old shape; two missing)

| PC | now (words) | proposed title · fragment |
|---|---|---|
| Agasha Kohana | 36 | **Vial bandolier.** Each slot dated in her hand. |
| Asako Yukitsuna | 24 | **Charcoal stub.** Kept in the breast fold. |
| Bayushi Hirofumi | 39 | **Vial of Shadowlands soil.** Sealed in wax; one per patrol. |
| Daidoji Emon | 40 | **Kaiu survey.** Spine patched with silk. |
| Hiruma Namiko | 33 (boot oil — not an object) | **Tasting bowl.** Never her own portion. |
| Kaito Kohana | 41 | **Prayer-bead cord.** Worn against the ribs. |
| Kaiu Anzu | 25 | **Chalk.** The numbers stop at forty-seven. |
| Matsu Rikona | 29 | **Sake flask.** Unwatered. |
| Moto Azumamaro | 32 | **Map case.** Leather worn from checking. |
| Shiba Yoshiteru | 27 | **Saya cord.** Retied a fraction tighter. |
| Yogo Yasu | 49 | **Knotted silk cord.** Seven knots, under the sleeve. |
| Nara | — | **Memory stick.** *(already in her gear)* |
| Teruyo | — | **Journal of insights.** *(already in her gear)* |

**D33** — approve the table or amend rows.

---

## F. Gear either-ors (eleven open lines)

| PC | line | recommend | why |
|---|---|---|---|
| Agasha Kohana | one weapon ≤7 | ~~Shinobigatana~~ → **Bō** *(corrected at apply: the open "Shinobigatana" is her Glorious Sacrifice heirloom, marked lost — not an outfit pick; my misread. The slot was truly open; the portrait's staff settles it)* | portrait |
| Asako Yukitsuna | daishō (any sword ≤7 + wakizashi) · *and* a stray "Nodachi" | **Nodachi + Wakizashi**; delete the duplicate | same |
| Bayushi Hirofumi | shinobigatana or folding half bow | **shinobigatana** | Deathdealer; no bow in the portrait |
| Daidoji Emon | yari or naginata | **yari** | portrait |
| Hiruma Namiko | yari, or yumi + quiver | **yumi + quiver** | scout; portrait silent |
| Kaito Kohana | bowyer's kit or divination kit | **bowyer's kit** | she carries a yumi; the Kaito are archer-priests |
| Matsu Rikona | nodachi or tessen | **nodachi** | "the weight"; portrait shows the katana only |
| Nara | two weapons ≤6 | **Yari + Knife** | the Crab-forged spear she strips rust from (Q15); the bone knife in the portrait |
| Nara | two scavenged items ≤2 | **whetstone + waterskin** | the whetstone is in Q15 |
| Shiba Yoshiteru | naginata or yari | **naginata** | Guardian reach; portrait silent |

**D34** — approve or amend.

---

## G. Other

**D35 — "Felines" is a person on the relationship map.** Rikona's Affinity with Felines subject leaks
into the pack map as an NPC node. Tooling fix in `relationship_map.py` (skip Affinity subjects). Will do
unasked unless you object.

**D36 — Nara and Teruyo have no accoutrement field** (the Path of Waves question set has no Q14). The
lint flags them; E gives them objects from their gear. Tooling: let `accoutrement_name` exist for
non-samurai too.

**D37 — Timeline checks pass.** Rikona's "1063 collapse… sixty years apart" = 1123; Azumamaro's
"summer gathering in 1119… three years of trust" = 1122. Nothing to change.

**D38 — Duplicate peculiarities across the pack:** Impatience (Yukitsuna, Kaito Kohana). No action.

---

## What Pass A says about the pack

Fifty-nine nodes and not one defined party line: thirteen characters written in thirteen rooms. Ten
of thirteen lord fields disagree with the prose. Six records are written *at the gate* or *on the
climb* — an expedition adventure pulls Q10/Q15/Q16 into the present tense far more than a court
adventure did. Three PCs each invented a different head of the Kaiu Wall. And the adventure's own
five interaction NPCs were used by nobody, where they fit four records without force (Riko, Tsubasa,
Nagahide, Ippei).
