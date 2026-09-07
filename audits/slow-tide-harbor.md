# Slow Tide Harbor — pack audit

Pass A closed 2026-09-07. Seven records, seven portraits, `l5r5e-0.4-gm-kit-dark-tides.arc/.lore/.codex`,
the pack map (30 nodes, 23 NPCs, **seven defined party lines**), the seven concepts in
`src/foundry_sources.json` (tarot readings; GM-facing). No pencilled rationale — this is the first pack,
built by hand around **Kitsuki Nagiko, Emerald Magistrate**, and her retinue: Nergüi and Ryōsei her
yoriki, Sanpei hired by the week, Chiyo assigned by Governor Kasuga Mugatsu as the party's "guide" and
centrally implicated in the plot, Ichirō Chiyo's own muscle, Hisano a dormant Scorpion asset on loan.

**Six of seven are legacy records** — no `wizard` block; their answers live only in the Foundry-shaped
step store, there is no `people[]`, mentors are a name string, lord fields mostly absent. The lint now
reads the step store for them (extended today) and found 19 blocks / 18 warnings; Nergüi and Chiyo
have **no answers to questions 9–12 at all**. Edits to these records go into the step store directly.

The adventure: *Dark Tides* (Game Master's Kit). The PCs — at least one Emerald Magistrate assumed —
are sent to Slow Tide Harbor to find Otomo Hiroshige, and uncover Gaku and Kitsu Sokori behind the
kidnappings. One of three interchangeable local villains: Kasuga Yumiko, Boss Yaguro, Azif the Smooth.
Officials Kasuga Mugatsu (governor) and Kasuga Mikoto (magistrate); crime lords Hana and Kizo.

---

## A. Errors

**D1 — GM-facing concept text is in public data.** All seven `bio` fields hold the tarot concept
verbatim — "she is centrally implicated in the adventure's plot", "Nagiko has miscategorised it… the
clock is driven by the creditors", "a long-dormant Scorpion asset" — and the sheet renders `bio` on
the public page (`renderBio` in sheet.js). The map's seven party-line texts are the concepts'
Cross-character prep notes ("Her Nine of Swords says she knows hers is terminal"). The standing rule is
that GM concept material never reaches `data/`. **Recommend:** blank the seven bios now (the concepts
stay where they are, in the manifest); rewrite the seven map lines as in-world sentences (D15). Public
bios, if you want them, are a later content decision.

**D2 — Four unfilled subjects.** Ichirō *Blackmailed by* — · Chiyo *Blackmail on* — · Chiyo *Fear of*
— · Sanpei *Debt to* —. Proposals:
| PC | peculiarity | fill | why |
|---|---|---|---|
| Ichirō | Blackmailed by | **Boss Hana** ("the Flower", adventure crime lord) | his Q10: "someone who knows [he threw bouts] is using it to bind him into errands"; the concept: the party's blind spot, cheap to turn. Alt: Kasuga Sanjiro (his people; knows the stable) |
| Chiyo | Blackmail on | **Junichi** (her people: the Mantis captain whose false manifest she certified) | she holds the paper on him |
| Chiyo | Fear of [Common Creature] | **rats** | a harbor office |
| Sanpei | Debt to | **Boss Yaguro** (adventure: declining crime lord) | the concept: protection money to criminal lenders who operate in Slow Tide; Yaguro's shrinking territory needs the coin |

**D3 — Four mentors with no text**: Chiyo (Soshi Masaharu), Ryōsei (Katsuhito), Sanpei (Matsu
Tekkan), Hisano (Kaiu Michio). Legacy records carry no grant, so the line is free:
> **Chiyo.** Soshi Masaharu taught Chiyo to keep two ledgers and let the magistrates see the one they expected.
> **Ryōsei.** Katsuhito, a rōnin who had served three Kuni, taught Ryōsei to catalog a confiscation before touching any of it, and to touch none of it alone.
> **Sanpei.** Matsu Tekkan drilled Sanpei in the polearm at a Lion way-station for one winter in exchange for firewood, and told him on the last day that he would never serve a lord who mattered.
> **Hisano.** Kaiu Michio built the stage machinery for the company Hisano performs with and taught them where every trapdoor and counterweight is; Hisano has used it twice for the Scorpion and forty times for the play.
(Ichirō's "mentor not in text" is a false positive — "Ichirō's mother Namiyo".)

**D4 — Sanpei's record is damaged.** `known_for` is a verbatim copy of the ninjō; the ninjō is not a
want; Q(past) reads "they have been enemies of jealousy ever since"; the giri is empty (the concept:
hired by Nagiko, status undefined).
> **Giri.** Sanpei is hired by Kitsuki Nagiko by the week to stand at her door and carry what she points at, and he has not asked what the arrangement is called.
> **Ninjō.** Sanpei wants a lord who will take him on with his debts, and a roof that is his by right. A weekly wage from a magistrate is the nearest he has come.
> **Known for.** On the docks Sanpei is known as the man who pays on time.
> **Past.** Sanpei's closest friend from the geisha house was adopted into the Kasuga family. Sanpei was not, and they have not spoken since.

**D5 — Sanpei: Uncleanliness on the sheet, compulsive cleaning in Q16 and the stress line.** Keep the
mechanic (the ruling), reconcile the prose: he cleans everything but himself.
> **Q16.** Sanpei cannot sit still in the magistrate's office without finding something to clean—the desk, the floor, the scroll racks—and has not washed his own clothes since the spring.

**D6 — Nergüi and Chiyo have no Q9–Q12.** Drafts, all past or standing:
> **Nergüi Q9.** Nergüi read the bones for a Unicorn caravan master at the Tortoise docks and told him not to sail; the ship that left in his place went down off the peninsula with all hands.
> **Nergüi Q10.** Nergüi has been blind since a fever in his twelfth year and reads the bones by touch; Rokugani who watch him work assume the blindness is the trick.
> **Nergüi Q11.** Nergüi warms mare's milk over the brazier at night, pours a cup for the spirit that travels with him, and sits until it is cold.
> **Nergüi Q12.** Nergüi fears the day the bones answer a question Nagiko has not asked yet, and he has to decide whether to tell her.
> **Chiyo Q9.** Chiyo talked a Mantis captain out of unloading a hold of untaxed steel at the public wharf and had it moved to a warehouse the governor's men never inspect; the harbor fund gained a fee.
> **Chiyo Q10.** Chiyo entered a trading partnership two years ago on her own judgment. The partner's cargo, money and name are gone, and she has not found out where.
> **Chiyo Q11.** Chiyo walks the wharves at dawn before the harbor office opens and counts the hulls against yesterday's list.
> **Chiyo Q12.** Chiyo fears the day a magistrate asks her to read the harbor ledgers aloud, line by line.

**D7 — Lords.** Ryōsei's field says Kuni Isei; her prose serves "Magistrate Sekihara" ×5 (→ D8).
Hisano's field says Shosuro Masuko; the prose says "their Scorpion handlers" — name Masuko once in the
giri. Nergüi, Chiyo, Nagiko, Ichirō, Sanpei have no lord field. Recommend: Chiyo → **Kasuga Mugatsu**
(the governor who assigned her; adventure NPC); Nergüi and Sanpei → **Kitsuki Nagiko** (whom they
serve; a PC as lord is what the concept says); Nagiko → "the Emerald Champion", unnamed (1123 is the
year the office changes hands in canon — naming him is a trap); Ichirō → **Kasuga Chiyo**.

**D8 — "Magistrate Sekihara" is Nagiko.** Ryōsei's concept: yoriki to Nagiko. Her record invents a
magistrate she catalogs confiscations for. Ruling shape (2): serves Kuni Isei, placed under Nagiko.
> **Giri.** Ryōsei serves Kuni Isei, who has placed her as yoriki under the Emerald Magistrate Kitsuki Nagiko; she catalogs the ritual components confiscated from mahō-tsukai cells, cross-referencing their uses against Kuni doctrine so that none are ever used twice.
Q11, Q16, Q20: Sekihara → Nagiko.

**D9 — Chiyo's giri is not her assignment.** Record: certifies the harbor fund. Concept: assigned by
Governor Mugatsu as the magistrates' guide, carrying her ruin into their presence.
> **Giri.** Kasuga Chiyo is assigned by Governor Kasuga Mugatsu to guide the Emerald Magistrate's party through Slow Tide Harbor, and still certifies the harbor fund's ledgers as she has for three years, accounting for money she knows went missing on her watch.

**D10 — Hisano's kintsugi object is the mask.** Record: a cracked teacup with gold lacquer (Q15,
accoutrement, Q20). Portrait: Hisano holding the cracked mask of their role, the break filled with
gold. Portraits are canon; the mask is also the better object (the concept: "a clan mask by custom, a
second mask by profession").
> **Q15.** Hisano sits alone in the dressing room after the final curtain with the cracked mask of their role, painting gold lacquer into the break.
> **Accoutrement.** Cracked mask. Gold in the seams.
> **Q20.** Hisano collapses in the wings during the final act, the mask still in their hand, and the understudy goes on for the curtain call.

**D11 — Two disadvantages the portraits show and Q14 doesn't.** Nergüi is blind (white eyes in the
portrait); Nagiko has a scar from the left brow across the cheek. Minimal additions:
> **Nergüi Q14.** Nergüi's eyes are white and do not track. His Rokugani catches on certain words and he knows it, so he speaks slowly in order to speak clearly.
> **Nagiko Q14.** A scar runs from Nagiko's left brow across the cheek. She stops mid-sentence to reread something in a ledger, leaving whoever was speaking to wait while she traces a line with her finger.

**D12 — Cards and bones.** Nergüi's giri, standout and Q7 say "the cards"; his ninjō and Q17 say "the
bones"; his gear is scrying tools with bone and mare's milk. The cards are the design method leaking
into the fiction. → bones throughout:
> **Giri.** Nergüi reads the bones for Nagiko's investigations even when what they show him yields nightmares.
> **Standout.** When Nergüi read the Kitsuki's fortune before accepting her service, the bones showed him a debt she would collect, and he accepted anyway.
> **Q7.** … because the debt shown in the bones admitted no refusal …
> **Ninjō.** He wants to read the bones without hearing Nagiko's questions underneath, but he accepted what they showed him and he will not break that debt.

---

## B. Accoutrements (D13) and gear (D14)

| PC | accoutrement | from |
|---|---|---|
| Ichirō | **Small drum.** | gear |
| Nergüi | **Brass sun-disc.** Worn on the chest. | portrait; also closes "one trinket" |
| Chiyo | **Abacus.** At the belt. | portrait; also closes the either-or |
| Nagiko | **Journal of observations.** | gear |
| Ryōsei | **Leather glove.** Right hand, palm patched with canvas. | record (38 words → title) |
| Hisano | **Cracked mask.** Gold in the seams. | D10 |
| Sanpei | none — Path of Waves set | D36 ruling |

| PC | line | recommend | why |
|---|---|---|---|
| Nergüi | one weapon ≤6 | **Knife** | hilt at his belt in the portrait |
| Nergüi | one trinket | the brass sun-disc (custom) | portrait |
| Chiyo | any one weapon ≤6 | **Bō** | a harbor official's walking staff; portrait silent |
| Chiyo | abacus or gaijin compass | **abacus** | portrait |
| Nagiko | bō or jian | **jian** | a second, straight hilt beside the wakizashi in the portrait |
| Sanpei | signature weapon ≤8 | **Bisentō** (already listed — close the line) | portrait |
| Sanpei | two items ≤4 | **Traveling pack, Whetstone** | he owns no pack |
| Sanpei | one trinket | stone pendant (custom) | portrait |

---

## C. Map, register, follow-ups

**D15 — The seven party lines, in-world** (replacing the prep notes; these are public):
> Nagiko ↔ Nergüi — Both finish what they start. She is contemptuous of everyone equally, and he is the only one who takes that as fairness.
> Nagiko ↔ Ryōsei — Neither will break: Nagiko by rigidity, Ryōsei by balance. They will find out which holds the first time they disagree about the investigation.
> Nagiko ↔ Chiyo — Nagiko is tactless with everyone; Chiyo cannot bear condescension. Neither has to try.
> Ryōsei ↔ Nergüi — The party's two specialists in what cannot be seen. He reads; she builds.
> Chiyo ↔ Sanpei — Two debts. She believes hers is past saving; he believes his is not.
> Chiyo ↔ Ichirō — Employer and hired muscle. She hired protection while believing she had no future, and he does not know that.
> Sanpei ↔ Ichirō — Two bodies for hire. One auditioning for permanence, one taking wages and asking for nothing more.
Tooling: the map reads these from the concepts' Cross-character sections; I would add a public
`party_lines` block to the manifest that the map prefers when present, so the concepts stay GM-facing.

**D16 — Register.** The legacy prose carries the tics the Creator's AVOID block quotes — Hisano's Q14
*is* the block's example ("not fidgeting, but the precise small adjustments a puppeteer makes… do not
seem aware"); Nagiko's Seppun line runs "which means… which means"; Ryōsei's Q11 "not for the work,
but because". Optional pass; recommend limiting it to lines already being touched plus the three
quoted here, and ask before widening.

**D17 — Honor differs from the concepts** (Nagiko 55/45, Ryōsei 45/35, Sanpei 45/35, Ichirō 48/45).
Concept numbers predate the build; the sheet's are computed. No action.

**D18 — Ichirō's ninjō is not a want.**
> Ichirō wants the sumai stable in the interior kept open, and pays for it out of Chiyo's wages. Chiyo has not asked why.

**D19 — Follow-ups the extended lint found in closed packs:** Agasha Kohana (Mask of the Oni) carries
*Passion for* — unfilled → propose **Passion for Cartography** (she believed the Shadowlands could be
studied and mapped). Asako Shuichi (Blood of the Lioness): mentor Moshi Kuniko has no text → I'll draft
after re-reading his record, if you approve the class of fix.

**D20 — GM-side note, no public change.** The concept's open question "who was Chiyo's partner?" has an
obvious answer in the adventure: **Kasuga Yumiko**, the Tortoise culprit-candidate. It belongs in the
concept, not the record.

**D21 — Legacy shape.** These six records cannot be reopened cleanly in the Creator (no wizard state;
apply_edit.py reconstructs). Not fixable by hand; noted.
