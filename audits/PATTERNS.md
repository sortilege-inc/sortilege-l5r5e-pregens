# Pack audits — patterns for the next pack

Running notes on how the owner has resolved things, so a later pack starts from
rulings rather than re-asking. Started on Blood of the Lioness, 2026-09-07. Add to it;
don't rewrite history out of it.

## Process shape that held

Three passes per pack. **A** — read everything: every record in full, every portrait, the
adventure's `.arc` and `.lore`, the pack's map, the pencilled rationale. **B** — one report
in `audits/<pack>.md`, decisions numbered D1… for answering by number, every rewrite in
full text with what it trades. **C** — apply approved items, rebuild, verify on the built
page, one commit per batch. The owner reads remotely and cannot open the file: reproduce
any decision block in chat on request, as a table.

Conservative on "errors": fix outright only where the record contradicts itself and one
reading is possible (a lord named six times in prose against once in the field; a gender
field against the pronoun the text uses; a duplicated gear line). Everything with a
direction to choose is a decision, even when it looks obvious. D6 on this pack was a flag
I raised that turned out to be my misreading — worth the extra question every time.

## Rulings

**Lords and superiors.** The `lord_name` field and the giri often name different people.
Three shapes, three answers: (1) the prose names one person many times and the field
another once → the field is wrong, fix it (Umi). (2) both are real — a family lord and the
commander the character is placed under → keep the field, and the giri names both (Chiaki:
"serves her lord Ikoma Motonobu, who has placed her under Akodo Tsukune"). (3) the giri
names a title only ("the chief physician", "the Miya daimyō") → it is the person in the
field; name them. A cross-clan lord can be right: Doji Hiroshige, a Crane, is a Unicorn
magistrate's superior because he is himself an Emerald Magistrate — middle management
between Agasha Sumiko and the PCs. Ask before "fixing" one.

**Adventure names.** An adventure persona's name used for a present-day NPC (Akodo
Heihachi, one of the 820 Advisors, as a living commander) is an error. The reverse is the
opportunity: wire the adventure's present-day cast into records deliberately — the
librarian, the bard, the claimants, the Champion who sends the PCs.

**NPC fields.** Gender field vs pronoun in the text: the text governs, fix outright. A
mentor text written about the lord: rewrite for the mentor actually named, since the
mentor's grant is mechanical and stays. Two NPCs (or an NPC and a PC) sharing a personal
name inside one pack: rename the NPC, flag the invented name.

**Giri / ninjō.** A giri is a duty the lord *sets* — not a want, and not a prohibition
("must keep his duelists from challenging her" is the lord forbidding, not tasking).
A ninjō is a *want* — not a situation or a suspicion ("suspects a blade was Scorpion-forged"
is a case file). The ninjō must not restate the giri. Give the want a face: a PC in the
pack, or an NPC already in the record. The owner's own reworks ran: the prohibition
becomes the lord's standing rule ("has forbidden duels among the College's staff"); the
want becomes something the lord *has* and won't give ("the family blade… will die holding
it before he sets it down for a Kakita's"); an offer on the table, wanted and not yet
refused (Kaede and Soshi Hayami).

**Tenets vs conduct.** When the paramount tenet contradicts what the character does
(Honor, and she sells poisons to the Scorpion), change the tenet, not the honour — attitude
A's +10 is mechanical and stands; the tenet has no mechanical effect.

**Sheet vs prose vs portrait.** A disadvantage the prose ignores (Lost Hand written as
two trembling hands): keep the mechanic, rewrite the prose, and let the portrait decide
the how (a black-gloved left hand). A mechanics error is upstream — flag, don't fix.

**Portraits are canon.** Every prop visible in the picture gets acknowledged once
somewhere; a visible wound belongs in Q14; small directional facts ("under her collar")
yield to the picture ("at her collar"). Facial variety across a batch is the owner's
standing request for prompts; check new prompts against the features already spent.

**Gear either-ors.** Settle from the portrait first (crossed blades = daishō; shoulder
plates = armour), then clan convention (Unicorn: scimitar), then role. An attendant slot
closes with an NPC already in the record (Chaaya). Unmatched outfit words that *are* a
catalog item ("Ceremonial robes", "two knives") resolve to it — the sheet gains the stats.

**Open subjects.** Karmic Tie → a person already written as a bond (the jade token).
Spiritual Protector → leave unnamed on purpose. A never-mentioned spouse (Blissful
Betrothal) → deferred by the owner; do not invent one unasked.

**Register.** Plain declaratives. The owner rejects the aphorism shape — "the first thing
anyone sees and the last thing they mention" — and the trailing meaning-clause. A rewrite
that keeps the image and drops the flourish is the right size.

**Accoutrements.** Object only, terse; a second fragment only for one concrete
particular. Owner's own: "Commander's insignia. Hangs on a braided cord." "Leather scroll
satchel." "Rice bowl. Repaired with kintsugi." "Brass compass." Structurally the gear line
is `{name: <object>, custom: true, text: <fragments>, accoutrement: true}` — the Creator now
has the object-name field and the export writes this shape; records built before it carry
the sentence as the title until backfilled. A broken keepsake can be re-read as repaired
(chipped → kintsugi) — offer that reading. The object is bound by the portrait: where the
picture shows the ledger, the wristband, the cuff, the token, offer wordings and
portrait-visible alternatives, not new objects.

## Counts to re-run on the next pack

- accoutrement-as-gear-title: 33 of 58 archive characters on 2026-09-07, before this
  pack's backfill
- NPCs shared by two records: 0 in this pack before the audit
