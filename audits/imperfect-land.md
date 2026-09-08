# Imperfect Land — pack audit

Pass A closed 2026-09-07. Seven records (five wizard-built with owner-written public bios; two legacy —
Togashi Renshō and Tonbo Asahi — in the owner's own voice), seven portraits (older, square), the
adventure (`l5r5e-0.4-imperfect-land.arc/.lore/.codex`), the five concepts' "## Imperfect Land" sections
(GM-facing; verified **not** in `data/`), the map (29 nodes, 22 NPCs, two defined party lines:
Temur–Renshō, Renshō–Asahi). Lint: 15 blocks, 17 warnings, all placed below.

The adventure: the Brotherhood of Shinsei's conclave at the Mountain Song Temple in Dragon lands, hosted
by Mirumoto Masashige (he; adoptive father of Ichirō), votes whether to brand the Perfect Land Sect a
False Path. Hige leads the sect; the Kolat merchant Kanbei steers it toward rebellion; Senzai is the
reborn Shinsei; Yohori is the temple's abbot; Yogo Hiroue sent the shinobi "Yuki." The concepts already
place the party: Sayaka watches the sect for the Crane, Chisato is the Phoenix prosecution, Jinrai *is*
the sect, Temur was sent to the Dragon's affliction, Genzō is hired muscle, Renshō and Asahi are Dragon
and Dragonfly.

---

**State at 2026-09-08:** D1–D6, D8–D10, D12, D17 approved and applied (D6 as proposed: Hero of the Mountain Song Temple after D12; Shinjo Sarangerel). D9 texts under review. Open: D7 (leave), D11, D13–D16, D18–D23.

## A. Errors

**D1 — Doji Sayaka's answers are in the second person**, alone in the archive: "You must dismantle…",
"You hunger…", "You mastered…", and Q7 begins with a markdown heading (`# Clan Relationship: Doji`) and
"You find yourself…". Her standout also says "earning your Water ring's advancement" — mechanics in
prose. Rewrites, third person, plain:
> **Giri.** Sayaka serves Daidoji Ikki, who has set her to dismantle the Perfect Land Sect's influence before it unsettles the Crane, by words where others would use steel.
> **Ninjō.** Sayaka wants to be known truly by one other person, once, before the performance is all that is left of her.
> **Standout.** Sayaka can seem ordinary. She has walked through crowds as a laborer, a servant and a pilgrim, and been looked at by no one.
> **Q7.** Sayaka is drawn to a distant Doji cousin whose warmth makes the performance exhausting, and has not decided whether the Crane's demand for perfect grace lets her lower the mask, even a little, with one of her own blood.

**D2 — Gender fields.** Sayaka, Temur, Jinrai and Genzō carry `gender: any` while every line of prose is
she (Sayaka) or he (the three) → set. Asako Satoru (Chisato's people) marked female, text "he" → male
(and see D14). Asako Buncho (Temur's) marked male, text "brings *her*" → female. Michio is a false
positive (the he/him is Genzō).

**D3 — Three mentors with no text.** Legacy-free records, so the grant is known:
> **Temur / Ikoma Kawa** (path B, grants Lost Name; commerce). Ikoma Kawa kept the Unicorn garrison's accounts for the Lion and taught Temur to price a remedy so the Dragon would pay for it. She never used his given name in three years, and by the end neither did anyone else at the garrison.
> **Jinrai / Kakita Tanomo** (path B, Overconfidence in Spiritual Sensitivity; melee). Kakita Tanomo drilled the ashigaru at Beiden with a spear butt and a sutra, and told them the kami stood behind every man who held the line. Jinrai held the line. Three of his did not.
> **Genzō / Mirumoto Yoshitô** (path B, Animal Signs; ranged). Mirumoto Yoshitô taught Genzō to read a river by its birds before he taught him to draw, and never let him shoot at anything he had not first named.

**D4 — Duplicates.** Temur's Q12 (fear) repeats his Q10 (challenge) nearly word for word (the fever
"broke from the medicine or despite it"); Jinrai's `known_for` repeats his Q9 (the bandit and the
granaries); Temur's gear lists both "Horse" and "Unicorn warhorse".
> **Temur Q12.** Temur fears the day a Dragon officer asks him, in front of his own daimyō's courier, which of his compounds are Unicorn work.
> **Jinrai known-for.** In the villages below Beiden Jinrai is known as the monk who will teach a farmer's son to hold a spear, and will not say why.
Gear: drop "Horse", keep the Unicorn warhorse.

**D5 — Lords.** Sayaka: field Daidoji Ikki, prose "her daimyō" → named in the new giri (D1). Temur: field
Iuchi Kensaburô, prose "his Unicorn daimyō" → name him: *"Temur serves Iuchi Kensaburô by reporting on
the Dragon's affliction, but he treats every sick person he meets, so his reports arrive incomplete and
Kensaburô cannot trust them entirely."* Chisato: field empty, giri "the Elemental Master of Fire" — the
corpus does not name the 1123 holder in a form I trust; set the field to the title. Asahi (legacy): giri
names "Tonbo Unkei, her daimyō" → field. Renshō: no lord; the abbot who sent him wandering is the
nearest thing → field Mirumoto Kenshin (see D17 on the name).

**D6 — Unfilled subjects.** Asahi *Hero of [Village]* → **Hero of Still Water Temple** (her Q9), or of the
Mountain Song Temple if D16 merges them. Temur's *Karmic Tie* has no subject and his beloved has no
name anywhere → she needs one: propose **Shinjo Sarangerel**, or supply one.

**D7 — Legacy heritage fields hold stories, not table entries** (Renshō: the uncle's horse; Asahi: the
Elder's poetry and the unnamed father). They pass the heritage gate and the stories are yours. Recommend
leave; flagging only so it is a decision.

**D8 — Voice in the legacy prose.** Renshō's giri is first person ("without imposing *my* own
understanding") → *"Renshō is to guide seekers along the path for ten years of wandering without imposing
his own understanding on them."* His ninjō is an infinitive → *"Renshō wants one moment of certainty: to
know he has grasped true understanding and not another comforting illusion."* "exhilirates" →
"exhilarates". Asahi's Q11 is generic second person → *"Asahi rakes the temple's rock garden before
anyone is awake; it is the one hour her visions leave her alone."*

---

## B. Contradictions and decisions

**D9 — Ninjō that are not wants.** Chisato: *"Chisato wants her doubt about the Tao answered by someone
else before she has to speak it, so that her parents never learn what they raised."* Temur: *"Temur wants
to go home to Sarangerel before she stops waiting, and has not sent the letters that would ask her to."*
Jinrai: *"Jinrai wants to set the teaching down and hand it to someone who will not need him, and no one
has come."* Genzō's is already a want; Sayaka's and Renshō's are rewritten in D1/D8.

**D10 — Asako Satoru is in two packs.** Chisato's Phoenix who "listens to her theological arguments" and
Yukitsuna's lord in Mask of the Oni, "the Phoenix's chief inquisitor" (a name I put in her prose at D6
there). Recommend they are one person, male (Chisato's text): the chief inquisitor hearing a Tensai's
theology is exactly his job. Change Yukitsuna's lord_gender to male; nothing else moves. Trade: a
deliberate cross-pack tie; the alternative is renaming one of them.

**D11 — Michio, a nezumi with a Rokugani name.** Genzō's fixer belongs to the Nezumi Tattered Ear
Explorer Tradition. Nezumi names are descriptive (Nine Claws, Lucky Silver). Propose **Counts-Twice**
(she brings him paid work and he never asks questions). Ask.

**D12 — "Still Water Temple (monks)" is a person on the map.** Asahi's Q16 lists a place. Two options:
(a) rename the entry to a person — **Yohori, Abbot of the Mountain Song Temple**, the adventure's own
venue, and move her Q9 vision to that temple's negotiations, so the conclave's host temple already knows
her and her visions are "viewed with more certainty than she is comfortable with" by the people about to
vote; (b) keep Still Water Temple and change the entry to "the abbot of Still Water Temple". **Recommend
(a)**; trade: it puts a past mercenary attack at the Mountain Song Temple, which the book does not
mention.

**D13 — Mirumoto Kenshin, abbot of Renshō's monastery.** The Mirumoto are the Dragon's bushi family; a
Togashi monastery's abbot would be a Togashi. → **Togashi Kenshin**. Ask (owner-authored).

**D14 — Adventure wiring.** Asahi's "Dragon clan liaison, strictly business" Mirumoto Takeshi →
**Mirumoto Masashige**, the conclave's host (he). Recommend. Sayaka's Scorpion mentor Yogo Morishige →
**Yogo Hiroue**, the Scorpion who sent "Yuki" into the sect: her teacher in tracing lies is running the
other investigation of the same sect. Trade: hands a Crane spymaster a Scorpion handler who is in the
book; strong at the table, and the kind of thing to ask first. Offer, not recommend.

**D15 — Genzō's face.** Bio: "scarred, battle-hardened face"; portrait: unmarked, light stubble.
Portraits are canon → bio "scarred" → "weathered". Ask (the bio is yours).

**D16 — Sayaka's bio says "serving the Doji daimyō"**; her lord is Daidoji Ikki. → "serving Daidoji
Ikki". Ask (the bio is yours).

**D17 — Chisato's Dashing Scar** is on her shoulder (Q9) and covered in the portrait; Q14 does not show
it. The ruling puts visible wounds in Q14; this one is not visible. Leave; noted.

---

## C. Accoutrements (D18), gear (D19), party lines (D20)

| PC | accoutrement | from |
|---|---|---|
| Sayaka | **Jade comb.** Carved like layered water. | record (42 words → title); portrait hair ornaments |
| Chisato | **Gold hair ornaments.** | portrait — her current "accoutrement" is an activity, not an object |
| Temur | **Medicine pouch.** Dragon silk. | record |
| Renshō | **Zuni pendant.** A child's gift. | record + portrait |
| Asahi | **Dragonfly glass ornaments.** | gear + portrait |
| Jinrai, Genzō | none — Path of Waves set | ruling |

| PC | line | recommend | why |
|---|---|---|---|
| Temur | one weapon ≤6 | **Knife** | a healer's; portrait silent |
| Jinrai | one weapon ≤6 | **Yari** | he drills spearwork every morning |
| Jinrai | one item ≤4 | **prayer beads** (custom) | the mala in the portrait |
| Jinrai | one trinket | **kie tablet** (custom) | the sect's three words |
| Genzō | katana or yumi | **Katana** | "duelist"; sharpens his blade |
| Genzō | any one weapon ≤6 | **Yumi** | Kyūdō; the bow at the river in Q11 |
| Genzō | two items ≤4 | **Quiver of Arrow, Whetstone** | the bow; the sharpening ritual |

**D20 — party lines** (public, via `party_lines`; only two pairs are defined now):
> Chisato ↔ Jinrai — She is here to see his teaching branded a False Path. He knows, and has not stopped speaking to her.
> Sayaka ↔ Jinrai — She has sat among his listeners dressed as a laborer. He does not know it was her.
> Genzō ↔ Sayaka — She is paying him. He has not asked what for.
> Temur ↔ Chisato — He treats the sick; she judges the doctrine. They agree on almost nothing and share a table every night.
> Asahi ↔ Sayaka — Two courtiers who say little. Asahi cannot tell whether Sayaka's metaphors are a mask or a habit, and Sayaka has never been asked so quietly.

---

## D. Other

**D21 — Register.** The five wizard records carry the archive's tics (hands going still, "which means",
"each lesson a small wound he cannot stop reopening", "the strife drains from his chest like water
through cupped hands"). Recommend the widened pass as on Slow Tide Harbor for the five; leave the two
legacy records in your voice except D8. Ask.

**D22 — Portraits** are 400px squares from an earlier batch, not the 760-wide convention. Nothing to
decide; noted for the end-of-run passes.

**D23 — Bios are public and fine.** All five are your third-person write-ups; the "## Imperfect Land"
GM sections stayed in the concepts (grep over `data/` → nothing).
