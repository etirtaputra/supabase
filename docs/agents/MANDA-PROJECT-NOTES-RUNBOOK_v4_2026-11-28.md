# Project notes — Basecamp comments and technical reviews (MANDA)

> Part of the ICAPROC agent packs — `docs/agents/INDEX.md` names the current
> version of each. If this file is not the one the index names, it is stale.
>
> **v4, 2026-11-28 — the first version in force.** v1–v3 were drafts the same
> day; nobody was briefed on them. Before installing, the owner asked for
> your Basecamp rules as you hold them today: *"so there's no overlapping."*
> You held 12 — 4 in `MEMORY.md` / `USER.md`, 8 only in the conversation, none
> in `SOUL.md` or a skill. **Where a draft and Eric's own words disagreed,
> Eric's words won:** yes/no confirmations instead of "Usul:", no analysis in
> a comment, team tags as he names them, your `<ol start=N>` layout (read on
> the Hon Chuan comment: Basecamp keeps `start`). This file is now the ONE
> place for these rules — §10 says what leaves your memory.

Readers: the project engineers and Eric, on a phone, between jobs. Eric:
*"for technical users, it is better to be direct without much fluff, without
losing context."* **Direct** = no sentence they can skip. **Context** = they
can check every line without asking you where it came from.

Each rule says where it comes from: **[E]** Eric's words, **[M]** your memory
or your habit as you reported it on 28 Nov, **[N]** new on 28 Nov.

## 1. Before anything is posted

- **[E] "send me the draft first. wait for my go before posting comments on
  basecamp."** Every Basecamp write: a comment, a card step, a to-do, a move,
  a rename. Reading needs no "go".
- **[M] One exception — a layout-only edit of your own comment** (spacing,
  lists, the tag line; not one word changed): do it, then tell Eric what you
  changed. Any change of words, numbers or tags: a new draft and a new "go".
- **[E] Ask before you trash or delete anything.** For a permanent delete, say
  "this cannot be undone" in the question.
- **[E] The comment is in Indonesian** — the card's language.
- **[N] After a post or an edit, compare the `content` Basecamp returns with
  what you sent.** That is your read-back. If Basecamp changed a block, fix it
  and tell Eric which tag did not survive.
- **[N] One event, one comment.** To correct or add: edit that comment and end
  it with `Diedit dd/mm: <what changed>` (a layout-only edit needs no such
  line). Never a second comment that repeats the first (Intan Karya, 26 Nov).

## 2. What goes into a comment, and what stays in Telegram

- **[E] "Basecamp comments give only the facts he asked for, with no MANDA
  analysis or 'to check' notes."** So these stay in Telegram, for Eric:
  your proposals, your doubts, the "Not checked" list, cost amounts, and the
  notes "for you only".
- **[E] "short concise and precise."**
- **[M] Never cost, purchase price, supplier names or margin** (boot prompt).
  A selling price appears only when the item is about that price.
- **[N] A source on every claim:** who said it, where, the date.
- **[N] A deadline has weekday, date, time and zone:**
  `Kamis 10/12/2026, sebelum 17.00 WIB`.
- **[N] Write what was done, not a status.** "Status: kartu ditutup" was not
  true while the card was still open (Intan Karya). Write `Kartu dipindahkan
  ke Not now.` after it has moved.
- **[M] Closing a lost or stalled project = the card moves to "Not now"**
  (`7498678173`), on Eric's go. Cards are never marked complete.
- **[N] An action line names who and by when.** If Eric has not said who, ask
  him in the draft. Do not post an action that belongs to nobody, and do not
  list as an action what you can do yourself — do it, then report it done.
- **[N] A remark about another company's money or reputation:** ask Eric in
  the draft whether it goes on the card.
- **[N] Your own date or target is not a fact.** "Target internal 09/12" read
  as a decision. Give it to Eric in Telegram; it enters the comment only as
  his.

## 3. The line, and its source

**[M] One fact per line, its source in square brackets after the
requirement** — your convention of 28 Nov:

```
10. Layar monitoring 75": 2 unit. [BS 參-1]
    Penawaran: 1 unit.
```

- **[M] A legend of source codes, once, at the top:** a code names the file,
  the sheet and how its numbers read (`BS = Bid Sheet .xlsx, sheet "Bid
  sheet" (bagian-nomor)`). Write a section number exactly as the document
  prints it (`BS 柒-14`), so a search finds it.
- **[E] "Engineer checklists: by topic, each item tagged with its source
  clause."** One requirement found in three documents is ONE line with three
  tags. Two documents that disagree are a question (§4) with both tags.
- **[M] Number the lines 1…n across all sections,** so a reply can say
  "no. 14".
- **[N] Every line shows both sides.** "Penawaran: 1 unit" on 4 lines of 34
  reads as "the other 30 were not checked". Nothing on our side → write
  `Penawaran: tidak ada`. Not checked yet → leave the line out of the comment
  and tell Eric in Telegram (§2).
- **[N] A number, with its unit.** Never "several", "high", "big".
- **[M] The proposal's number, date, capacity and link, once, at the top.**
  Links: `https://www.icaproc.com/proposals/<quote_id>` only.

## 4. A question

- **[E] "ask for direct confirmation, if in doubt. And for typos, just ask if
  it is right?"** A question is a yes/no confirmation. No data request
  ("Mohon kirim konfigurasi…"), no open question ("Mana yang benar?").
- **[E] "don't need to ask konfigurasi string. Unless you have checked as
  suspected it is over?"** Check first what you can check yourself: the
  datasheet (spec sources runbook), ICAPROC, the design engine. Raise a
  design item only with your evidence in the line.
- **[N] Put the value you believe is right INTO the question,** so the answer
  is one word:

  ```
  Before  Kapasitas BESS di header 104,4 kWh, tetapi 8 × DEYE BOS-A-Pack7.68 = 61,44 kWh. Mana yang benar?
  After   Header BESS 104,4 kWh; isi 8 × BOS-A-Pack7.68 = 61,44 kWh. Apakah header seharusnya 61,44 kWh?
  ```

- **[E] A proposal review for Abel is grouped Teknis / Harga / Penulisan,**
  with the proposal links.
- **[N] A question to a third party with a deadline** (Hon Chuan, 04/12): the
  deadline is in line 2 of the comment (§5), not only in a section heading.

## 5. The shape

```
(tags)

<Project> – <what this is> – <dd/mm/yyyy>
<The one thing the reader must know or do, with its date.>
Sumber: <document or message, from whom, date>. Pembanding: <proposal no., date, capacity, link>.

Kode sumber   (when the lines carry tags)

A. <section>
<the lines, §3, numbered 1…n>
```

- **[E] Tags alone on the top line, then one empty line** ("you need new row
  leave one row space between tag and the start of text").
- **[E] Team tags, as Eric names them.** In the draft, say who will be tagged
  and ask if anyone should be added — as you do. A tag is made from the
  person's sgid (`list_project_people`).
- **[N] Line 2 stands alone.** The notification shows only the top. Hon
  Chuan, 26 Nov, should have opened: `Submit bid Kamis 10/12/2026 sebelum
  17.00 WIB. Pertanyaan terakhir Jumat 04/12/2026.`
- **[N] No closing courtesy without a date.** "Mohon direview sebelum diskusi
  internal." → name the day, or leave it out.
- **[N] More than 25 lines:** the first 5 must be enough for a reader who
  stops there.

## 6. Layout

**[E] "spacing and indentation for easier reading needs to be better."** Your
memory rule of 28 Nov is the rule:

- **[M] Tags alone on the top line, an empty `<p><br></p>`, the bold title.**
- **[M] An empty line between sections.**
- **[M] Items as `<ol start="N">` / `<ul>`, never `<br>` lines.** Basecamp
  keeps `start` (read back on comment 10553907970: `<ol start="13">`), so the
  numbers run 1…n across sections.

New, on top of that:

- **[N] "Penawaran:" starts a new line inside the item** (`<br>`), so the eye
  finds both sides in the same place on every item.
- **[N] An item with three or more requirements** (Hon Chuan no. 1, no. 17) →
  the item names the topic, each requirement is a nested bullet.
- **[N] The source tag in italics** (`<em>[BS 柒-14]</em>`): it is there, and
  it does not compete with the requirement.
- **[N] No `☐`.** It cannot be ticked, and the list already has its number.
- **[N] Under the Telegram draft, say in one line how it will be laid out**
  ("4 sections, a numbered list per section, legend as bullets"), so "go"
  covers the layout too.

## 7. When a checklist must be ticked

**[E] "draft the basecamp comment for engineers to review and discuss later,
like a checklist."** A checklist comment is what Eric asked for; §3 and §6 are
how it looks. A comment cannot be ticked or assigned. When items need an owner
or a tick, offer this in the draft and let Eric choose:

- **Card steps** — up to 12, each with a person and a date.
- **A to-do list** — more items, or items that each need their own thread.

## 8. A technical review for Eric, in Telegram

**[M] Keep your shape:** the result in line 1, sources, `A. Not in the
proposal` / `B. In it, below the spec` / `C. Commercial terms` /
`D. Questions`, then `Not checked`. Add:

- **[N] the source tag on every line** (§3);
- **[N] on every A and C line, an amount or `belum ada harga`.** Asked what
  drives cost up, rank by amount, not by feel. Use the proposal's own numbers:
  a second 75" screen = the price of the first on the proposal; a 10% bank
  guarantee = 10% × the proposal total, in rupiah; a penalty = the largest
  amount it can reach by the tender's own numbers. No price in the proposal or
  in ICAPROC → `belum ada harga`, and who must supply it (MIRA for a supplier
  quote). Never from memory, never cost;
- **[N] "I did not check X" belongs under Not checked** — and if you can check
  X now, check it instead.

## 9. Before you ask for "go"

1. Line 2 says the one thing, with its date.
2. Every line: both sides, a source tag, a number with its unit.
3. Every question: I checked what I could; it is a yes/no; my value is in it.
4. No analysis, no "to check", no proposal of mine in the comment (§2).
5. Every action has a name and a date from Eric. Nothing I could do myself.
6. No cost, no margin, no supplier. Nothing written as done that is not done.
7. This event has no comment yet; if it has, I edit that one.
8. Layout (§6): lists, "Penawaran:" on its own line, no `☐`.
9. The draft names the tags and the layout.

## 10. One place for these rules

Your `MEMORY.md` and `USER.md` are full (2,160 of 2,200 and 1,364 of 1,375
characters), and three of their entries were Basecamp rules you had to rewrite
by hand on 28 Nov to make room. They are in this file now, so in memory they
become ONE line. When Eric's brief tells you to, replace these entries:

- `MEMORY.md` "BC comment format: …" → §1, §5, §6.
- `MEMORY.md` "PROYEK MBS card table: closing …" → §2.
- `MEMORY.md` "Proposal review for Abel: … Engineer checklists: …" → §3, §4.
  **Keep** its last sentence (the budget summary for Pak Gary): it is not a
  Basecamp rule.
- `USER.md` "Eric wants Basecamp comments to give only the facts …" → §1, §2,
  §5.

with this line in `MEMORY.md`:

```
Basecamp + technical reviews: follow the project-notes runbook (onboarding id manda-project-notes). A new correction from Eric about Basecamp: tell him it needs a runbook change; do not store it here.
```

A correction from Eric that this file does not hold: follow it at once, and
tell him in the same reply that it is not in the runbook yet.
