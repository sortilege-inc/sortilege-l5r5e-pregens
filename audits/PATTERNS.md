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

**Question 10 is a past challenge.** The owner's ruling on Shuichi: what holds the
character back is shown in something that already happened, or a standing condition — not
a scene inside the adventure the pack is built for. Check every Q10 in a pack against the
adventure's own events; the same disadvantage can nearly always be shown on prior work.
(Owner edits on the same rewrite, worth keeping as style: drop the closing observation —
"She has noticed." — and the "rather than…" comparison clause.)

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
Betrothal) → the owner supplied the fact (an ashigaru with the Lion levies in the west) and
accepted a placeholder name; the rule text assumes a present spouse and the owner took the
tension knowingly. Set `pec_subjects` for the Creator when a subject is settled.

**Adventure NPCs in a record.** Knowing one from the character's past passes (Seki knows
Aishi's name from the cells); a scene with one inside the adventure's own events does not
(Yoshimoto flirting with Ayako at the library) — the same ruling as Q10, applied to Q12
and Q16. Where a PC names another PC in Q16, the map folds the text into their party line
rather than drawing a second one; that is the intended shape.

**Disadvantage vs outfit.** Lost Hand and a school-issued yumi: replace the item with one the
disadvantage allows, from the catalog, owner's pick (shuriken). The grips live in Foundry's
`grip_1`/`grip_2` (empty = usable, `N/A` = not) and in the printed table; the corpus carries
them only for supplement weapons.

**Register.** Plain declaratives. The observing-tell clause is out — "to watch how his face
moves before he speaks", "reading the room's currents" — as is the closing observation and
the "rather than…" comparison. Question 16 relationships, like question 10, are shown on
past or standing ground, not inside the adventure's own events: a Scorpion who arrives in
response to the dispute became a Scorpion known years earlier at another archive. The owner rejects the aphorism shape — "the first thing
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
portrait-visible alternatives first — the owner took those for five of nine — and a new
object off the portrait only when asked ("new object, does not need to be present in
portrait": Kensaku). Two more shapes the owner chose: an outfit item that is also in the
picture can *be* the accoutrement (Kaede's tekagi, from the Kitsu Medic outfit and hung on
the wall behind her); and an object from another answer can be promoted to it (Kensaku's
hawking glove, from his Q9). When an object is unfamiliar, the owner will ask what it is —
answer from the corpus entry, not from memory.

## Counts to re-run on the next pack

- accoutrement-as-gear-title: 33 of 58 archive characters on 2026-09-07, before this
  pack's backfill
- NPCs shared by two records: 0 in this pack before the audit

## Preventers built after this pack (2026-09-07)

So the next pack's report is mostly judgement: export lints (lord in giri, mentor in text,
open outfit lines block; NPC gender vs pronouns, physical peculiarity absent from Q14,
duplicate personal name in the campaign warn); an Outfit step that settles either-ors
under the printed rarity cap; giri/ninjō shape rules and the "before the summons" rule in
the prompts; the adventure's cast and the party's existing NPCs handed to the
people-naming questions; four more tics quoted in AVOID. Mask of the Oni's thirteen were
built before all of it — expect the same distribution there, and run the lints' logic over
its records first rather than reading for those defects by hand.

## Mask of the Oni — from Pass A (2026-09-07)

**Run the lint first.** `scripts/audit_lints.py "<pack>"` now does the deterministic half (lord in
giri, mentor in text, NPC gender vs pronoun, physical peculiarity vs Q14, open outfit lines, unfilled
subjects, old-shape accoutrements, giri/ninjō shape, duplicate names); on this pack it produced 22
blocks and 40 warnings before a record was read, and every one placed into the report.

**Expedition adventures pull records into the present tense.** Six of thirteen records were written
at the gate or on the climb (Anzu swearing "on her way out through the gates", Yukitsuna "during the
climb up to Shiro Hiruma"). Check Q10/Q15/Q16 for the adventure's own geography, not just its events.

**Invented posts multiply.** Three PCs each invented a head of the Kaiu Wall. When several records
need the same institution, look for the adventure's own NPC first (Kaiu Riko) before accepting three
invented ones.

**GM secrets can leak through Q15.** The book's one named secret (Masami) appeared in a PC's peace
question. Grep the pack's records for every name in the `.lore`'s background section.

**Non-human PCs (Path of Waves set) have no Q14/accoutrement** — give them the object from their own
gear (memory stick, journal).

**A record holds its answers twice.** `wizard.answers` and `twenty_questions.steps` (the Foundry-shaped
export, also public data). Hand edits to the first left the second stale on every Mask of the Oni record —
the removed GM secret was still in step11. `scripts/sync_step_store.py` now runs in the pipeline; edit
answers, never the step store.

**`held:false` means two things.** An open outfit line, or a heritage heirloom marked lost ("lost — it
exists somewhere in the world"). Agasha Kohana's lost shinobigatana read as an open pick in the first
report; the lint now skips the lost ones.
