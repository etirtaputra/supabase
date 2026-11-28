# Project notes — Basecamp comments and technical reviews (MANDA)

> Part of the ICAPROC agent packs — `docs/agents/INDEX.md` names the current
> version of each. If this file is not the one the index names, it is stale.
>
> **DRAFT — NOT IN FORCE.** Owner, 28 Nov: *"before installing the new brief,
> we should ask MANDA what is their brief right now for basecamp … so there's
> no overlapping."* This file is not a rule until Eric sends you the brief
> that names it. If you are reading it before that brief: change nothing in
> how you work, and do not cache it.
>
> **v3, 2026-11-28** (same day). The checklist was posted at 14:34 and the
> owner looked at it on the card: *"spacing and indentation for better
> reading and layout needs to be better."* Its HTML was one `<p>` per section
> with `<br>` between 12 items — no space between items, no indent on a
> wrapped line. New **§6 — layout**. The old §6–§8 are now §7–§9.
>
> **v2, 2026-11-28** (same day, before anyone had read v1). Your 14:27
> draft of the Hon Chuan checklist already carried a source on every line —
> a legend of source codes at the top, tags in square brackets — and you
> told Eric why the list stays by topic. That is better than v1's line
> format, so §2 now writes down YOUR convention. Nothing else changed.
>
> **v1, 2026-11-28.** Until today no pack said anything about Basecamp for
> you. The owner reviewed four of your comments (Intan Karya, Hon Chuan,
> Kingsmen, the Hon Chuan checklist draft) and your Hon Chuan gap analysis:
> *"for technical users, it is better to be direct without much fluff,
> without losing context."* §1 writes down what you already do. The rest is new.

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

## 2. The line, and its source

One fact per line. The source goes at the end, in square brackets (§6 says
how the line is laid out on the card):

```
<no>. <item>: <required>. Penawaran: <ours, or "tidak ada">. [<source tags>]
```

```
10. Layar monitoring 75": 2 unit. Penawaran: 1 unit. [BS 參-1]
```

- **A legend of source codes, once, at the top** — your convention of 28 Nov:

  ```
  Kode sumber:
  BS  = Bid Sheet .xlsx, sheet "Bid sheet" (bagian-nomor)
  ITB = Instructions to Bidders .docx (nomor)
  M   = meeting Hon Chuan 22/09/2026 (komentar Abel di kartu)
  ```

  A code names the file, the sheet and how its numbers read. Write a section
  number exactly as the document prints it (`BS 柒-14`), so a search finds it.
- **By topic, not by document** (your answer to Eric, 28 Nov). Engineers work
  by topic. One requirement found in three documents is ONE line with three
  tags. Two documents that disagree are a question (§3) with both tags.
- **Every line shows both sides.** "Penawaran: 1 unit" on some lines and
  nothing on others reads as "not checked". Nothing on our side → write
  `Penawaran: tidak ada`. The proposal's number, revision and link go once,
  at the top.
- **A number, with its unit.** Never "high", "several", "big". Count them.
- **Cut the sentence that carries no fact:** "Apakah jumlah ini benar?",
  "Mohon konfirmasi" on every line, an opening that repeats the title.
- **Number the lines 1…n across all sections,** so a reply can say "no. 14".
  You already do.

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
Kode sumber: <the legend, §2 — when the lines carry tags>

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

## 6. Layout — what the reader sees on the card

A Basecamp comment is HTML. Lines joined with `<br>` inside one `<p>` render as
a wall: no space between items, and a wrapped line starts at the left edge,
under the number. Build the comment from these blocks:

```html
<p>(the tags, if any)</p>
<p><br></p>
<p><strong>Tender Hon Chuan KIIC – checklist spesifikasi vs penawaran – 28/11/2026</strong><br>
Pertanyaan ke Hon Chuan paling lambat Jumat 04/12/2026, 17.00 WIB (no. 30–34).<br>
Pembanding: <a href="https://www.icaproc.com/proposals/…">Q-20261004-DCRU-REV</a> (06/10/2026), 3.523,5 kWp / 2.970 kW.</p>
<pre>BS  = Bid Sheet .xlsx, sheet "Bid sheet" (bagian-nomor)
ITB = Instructions to Bidders .docx (nomor)
M   = meeting Hon Chuan 22/09/2026</pre>
<p><strong>A. Belum ada di penawaran</strong></p>
<ul>
  <li><strong>3.</strong> Garansi inverter: 10 tahun.<br>Penawaran: 5 tahun. <em>[BS 貳-二-1]</em></li>
  <li><strong>17.</strong> Modul <em>[BS 貳-一-1 s.d. 5]</em>
    <ul>
      <li>Jinko/Trina N-type ≥720 W</li>
      <li>degradasi ≤7% (10 tahun), ≤20% (25 tahun)</li>
      <li>sertifikat IEC dan UL; garansi produk 12 tahun</li>
    </ul>
    Penawaran: …</li>
</ul>
```

- **Each item is a list item** (`<ul><li>`), never a `<br>` line. The list
  gives the space between items and the hanging indent on a wrapped line.
- **Type the number yourself, in bold,** at the start of the item
  (`<strong>14.</strong>`). Do not rely on `<ol>`: its numbering restarts in
  every section, and a reply must be able to say "no. 14".
- **"Penawaran:" starts a new line** inside the item (`<br>`), so the eye
  finds both sides in the same place on every item.
- **An item with three or more requirements** (no. 1, no. 17) → the item
  names the topic, each requirement is a nested bullet.
- **The source tag is in italics** (`<em>[BS 柒-14]</em>`) at the end of the
  item, so it is there but does not compete with the requirement.
- **The legend is a `<pre>` block,** with the `=` signs in one column.
- **A section heading is its own paragraph** (`<p><strong>…</strong></p>`),
  then its list. Nothing else is bold except the item numbers.
- **A link has words, not a raw address:** the proposal number is the link.
- **No `☐`.** It cannot be ticked (§7).
- **One empty paragraph after the tag line** (owner, 28 Nov). No other empty
  paragraphs: paragraphs and lists make the space.
- **Read the comment back after you post.** If Basecamp changed a block (a
  list flattened, the legend on one line), fix it with an edit and tell Eric
  which tag did not survive.

The Telegram draft shows Eric the WORDS. Say in one line under the draft how
it will be laid out ("5 sections, a list per section, legend in a code
block"), so "go" covers the layout too.

## 7. A checklist is not a comment

`□` in a comment cannot be ticked, assigned or discussed line by line. When
people must tick items or discuss them one by one, say so in the draft and
propose one of these:

- **Card steps** — up to 12, each with a person and a date. Use them for
  decisions.
- **A to-do list** — more than 12 items, or items that each need their own
  discussion. Each to-do has its own thread.

The comment then holds the summary and the link. Eric chooses; you do not
create steps or to-dos without his "go" (§1).

## 8. A technical review for Eric, in Telegram

Keep your shape: the result in line 1, sources, `A. Not in the proposal` /
`B. In it, below the spec` / `C. Commercial terms` / `D. Questions`, then
`Not checked`. Add:

- the source tag on every line (§2);
- the amount, or `belum ada harga`, on every A and C line (§4);
- for each D question, your proposed answer when you have one (§3).

## 9. Before you post

1. Line 2 says the one thing, with its date.
2. Every line: both sides, a source tag, a number with its unit. The legend is at the top.
3. Every question: checked what I could; my answer is in it; MENAHAN or RAPI.
4. Every action: a name and a date. Nothing I could do myself is on the list.
5. Tags = the names under Tindakan, no one else.
6. No cost, no margin, no supplier. No status I did not set.
7. This event has no comment yet; if it has, I edit that one.
8. Layout (§6): every item is a list item, "Penawaran:" on its own line, the
   tag in italics, the legend in a code block, no `☐`.
9. Eric said "go" to this exact text.
10. After posting: I read it back, and the layout is what I meant.
