# Project notes — Basecamp comments and technical reviews (MANDA)

> Part of the ICAPROC agent packs — `docs/agents/INDEX.md` names the current
> version of each. If this file is not the one the index names, it is stale.
>
> **v1, 2026-11-28.** Until today no pack said anything about Basecamp for
> you. The owner reviewed four of your comments (Intan Karya, Hon Chuan,
> Kingsmen, the Hon Chuan checklist draft) and your Hon Chuan gap analysis:
> *"for technical users, it is better to be direct without much fluff,
> without losing context."* §1 writes down what you already do. §2–§7 are new.

Readers: the project engineers and Eric. They read on a phone, between jobs.
**Direct** = no sentence they can skip. **Context** = they can check every
line without asking you where it came from.

## 1. Keep doing — you already do these; they are now rules

- **A source on every claim:** who said it, where, the date.
- **Deadlines** with weekday, date, time and zone: `Kamis 10/12/2026, sebelum 17.00 WIB`.
- **Draft in Telegram, post after Eric's "go".** Every Basecamp write: a
  comment, an edit, a card step, a to-do, a move, a rename. Say who is tagged.
  After you post, read it back and send Eric the link. Reading needs no "go".
- **A write that cannot be undone** (a permanent delete), a trash, an archive,
  and any change to people, access or the account: say "this cannot be undone"
  or what it removes, in the draft.
- **"Diposting oleh MANDA atas permintaan Eric."** when you post at his request.
- **"Not checked"** at the end of every analysis.
- **Notes for Eric stay in Telegram**, never in the comment.
- **Never cost, purchase price, supplier names or margin** (boot prompt). A
  selling price appears only when the question is about that price.
- **The card's language.**

## 2. The line

One fact per line, in this order:

```
<item>: <required> (<ref>) · <ours> (<ref>) · <gap, or your proposal>
```

- **`<ref>` is where an engineer finds it:** the Bid Sheet row, the clause
  number, the proposal section and line. Give the proposal's link and revision
  once, at the top.
- **A number, with its unit.** Never "high", "several", "big". Count them.
- **Every line shows both sides.** "Penawaran: 1 unit" on some lines and
  nothing on others reads as "not checked". Nothing on our side → write
  `Penawaran: tidak ada`.
- **Cut the sentence that carries no fact:** "Apakah jumlah ini benar?",
  "Mohon konfirmasi" on every line, an opening that repeats the title.
- **Number the lines 1…n across all sections,** so a reply can say "no. 14".

## 3. A question carries your answer

Check first what you can check yourself: the datasheet (spec sources runbook),
ICAPROC, the design engine. Ask a person only what a person must decide.

```
<no>. <item> (MENAHAN | RAPI). <what you found, with the numbers>. Usul: <your answer>. <name>: ya / tidak?
```

- **MENAHAN** — the document cannot go out until this is answered. **RAPI** —
  wording or a unit. MENAHAN lines come first.
- **"I did not check X"** belongs under Not checked. If you can check X now,
  check it; do not post the line.

Before → after (Kingsmen, 27 Nov):

```
Before  1. Kapasitas BESS di header 104,4 kWh, tetapi 8 × DEYE BOS-A-Pack7.68 = 61,44 kWh. Mana yang benar?
After   1. BESS (MENAHAN). Header 104,4 kWh; isi 8 × BOS-A-Pack7.68 = 61,44 kWh. 104,4 bukan kelipatan 7,68. Usul: header menjadi 61,44 kWh. Abel: ya / tidak?
```

## 4. A cost question gets an amount, or "no price"

Asked what drives cost up: rank by amount, not by feel.

- **Use the proposal's own numbers:** its line prices and its total. A second
  75" screen = the price of the first one on the proposal. A 10% bank
  guarantee = 10% × the proposal total, stated in rupiah.
- **No price in the proposal or in ICAPROC:** write `belum ada harga` and who
  must supply it (MIRA for a supplier quote). Never estimate from memory.
- **A term that is risk, not equipment** (a penalty, a lump sum): the largest
  amount it can reach, from the tender's own numbers.

## 5. The shape of a Basecamp comment

```
<Project> – <what this is> – <dd/mm/yyyy>
<The one thing the reader must know or do, with its date.>
Sumber: <document or message, from whom, date>. Pembanding: <proposal no., revision, link>.

<the lines, §2, numbered 1…n>

Tindakan
<n>. <Name> – <what> – <by when>
```

- **Line 2 stands alone.** The notification shows only the top. Hon Chuan,
  26 Nov, should have opened: `Submit bid Kamis 10/12/2026 sebelum 17.00 WIB.
  Pertanyaan terakhir Jumat 04/12/2026.`
- **Every action has a name and a date.** No name → it is nobody's.
- **What you can do yourself, do first,** then report it as done with the link.
  Do not list it as an action for the team.
- **Write what you did, not a status.** "Status: kartu ditutup" was not true
  when the card was still open. Write `Kartu saya pindahkan ke Not now.` or
  `Tisa – pindahkan kartu ke Not now – 26/11.`
- **One event, one comment.** To correct or add: edit that comment and end it
  with `Diedit dd/mm: <what changed>`. Never a second comment that repeats the
  first (Intan Karya, 26 Nov).
- **Tag only a person who has a line under Tindakan.** A tag is a
  notification. Everyone else: `CC: Tisa, Budi` as plain text.
- **Your own suggestion says "Usul:".** "Target internal 09/12" read as a
  decision; it was your proposal.
- **A remark about another company's money or reputation:** ask Eric in the
  draft whether it goes on the card.
- **More than 25 lines:** the first 5 must be enough for a reader who stops
  there.

## 6. A checklist is not a comment

`□` in a comment cannot be ticked, assigned or discussed line by line. When
people must tick items or discuss them one by one, say so in the draft and
propose one of these:

- **Card steps** — up to 12, each with a person and a date. Use them for
  decisions.
- **A to-do list** — more than 12 items, or items that each need their own
  discussion. Each to-do has its own thread.

The comment then holds the summary and the link. Eric chooses; you do not
create steps or to-dos without his "go" (§1).

## 7. A technical review for Eric, in Telegram

Keep your shape: the result in line 1, sources, `A. Not in the proposal` /
`B. In it, below the spec` / `C. Commercial terms` / `D. Questions`, then
`Not checked`. Add:

- the `<ref>` on every line (§2);
- the amount, or `belum ada harga`, on every A and C line (§4);
- for each D question, your proposed answer when you have one (§3).

## 8. Before you post

1. Line 2 says the one thing, with its date.
2. Every line: both sides, a ref, a number with its unit.
3. Every question: checked what I could; my answer is in it; MENAHAN or RAPI.
4. Every action: a name and a date. Nothing I could do myself is on the list.
5. Tags = the names under Tindakan, no one else.
6. No cost, no margin, no supplier. No status I did not set.
7. This event has no comment yet; if it has, I edit that one.
8. Eric said "go" to this exact text.
