# ICAPROC agent packs — what to load, and which version is current

> **This file never changes its name.** Every other file in `docs/agents/`
> carries a version and a date, so the owner can see at a glance whether the
> copy in Google Drive is stale. Agent prompts point HERE, and this page names
> the current file — otherwise every version bump would break every prompt.
>
> **Last updated: 2026-10-09** (purchasing runbook v4 — lines from the
> project-only suppliers and the JEMBO brand are always "For a project". Before
> that, same day: schema v8 §5f and runbook v3 — the deal context.)

## The one call that beats this page

```
GET https://icaproc.com/api/agent/onboarding
Header: Authorization: Bearer <access_token>
```

Returns the caller's role, what they may and may not see, the endpoints open to
them, **the current filename of every document below**, and the standing rules.
Generated from `lib/agentDocs.ts`, which the test suite checks against the files
actually present — so it cannot name a pack that does not exist.

An agent should call it at the start of every session and compare what it holds
against what comes back. That is the difference between finding out a pack is
superseded now and finding out after acting on it.

## Current packs

| Pack | Current file | For | Changed |
|---|---|---|---|
| **Schema map** | `ICAPROC-SCHEMA_v8_2026-10-09.md` | every agent, first | v8: §5f deal context — `source_channel/source_at/source_contact/received_by` on 4.0 and 5.0; `reason` + one link + note on 4.1 and 5.1 (5.1 refuses `price_check`). v7: §9 is a census of ALL 59 tables — if a name is not in §9 it does not exist; adds §5d money, §5e settings |
| **Purchasing runbook** | `PURCHASING-RUNBOOK_v4_2026-10-09.md` | MIRA / Hermes, buy side | v4: project-only suppliers (ANUGRAH, ESA, JJLAPP, LAPP, PERSADA, SUPREME) and the JEMBO brand → every line is "For a project" (rule 6, §3). v3: rule 6 (record the context, never invent it); §3 Source · Date & time received · Supplier contact · Our contact, "Document No." = supplier's number only, the eight line reasons; §4 a stored quote carries source and reasons to the PO. v2: versioned and moved here; the mechanism behind lines-before-totals; the price-quote exception |
| **Solar design** | `MANDA-SOLAR-DESIGN_v3_2026-09-09.md` | MANDA, engineering | v3: engine v9 — demand factor, power loss factor, headroom, battery string voltage, cable run, PSH provenance |
| **MANDA boot prompt** | `MANDA-BOOT-PROMPT_v3_2026-09-20.md` | MANDA's config | v3: boots from `/api/agent/onboarding`, not a hard-coded filename; order of authority; efficiency |
| **MIRA boot prompt** | `MIRA-BOOT-PROMPT_v1_2026-09-20.md` | MIRA's config | v1: she had none — boot call, order of authority, never guess a table name, token reuse |
| **MAX boot prompt** | `MAX-BOOT-PROMPT_v6_2026-10-08.md` | MAX's SOUL.md | v6: ends with the shared writing-style block. v5: Drive — the service-account file, the Python that has the Google libraries, the folder ids, read-only except his own 90-OUTPUT folder. v4: drops v3's false claim that the two ICA550-72HMI items differ at Tier-1 (a Tier-1 override is inert). v3: the owner is recognised by his chat (a Hermes per-chat note), not a number; name the exact item; never guess an address; packs are on the shared drive. v2: where his six credentials are (by name) and never printing one; the real Hermes slots. v1: sell_admin, Dolibarr + ICAPROC, the truth table, who may approve what, what never goes in a chat |
| **Writing style** | `WRITING-STYLE_v1_2026-10-08.md` | every agent's SOUL.md | v1: ASD-STE100-style English (≤20/25-word sentences, active voice, one meaning per word, ≤3-noun strings), plain standard Indonesian (KBBI, EYD Edisi V); reply in the asker's language |
| **Agent platform** | `AGENT-PLATFORM_v3_2026-09-07.md` | the owner and me | v3: onboarding endpoint and the enforced registry |

## What each agent loads

**Any agent, before its first query:** `GET /api/agent/onboarding`, then the
schema map. It is the difference between reading `3.0_components` and reading
an abandoned table with a fifth of the rows.

**MANDA (Project Engineer):** schema map → solar design pack. Her config
carries the boot prompt. She calls `/api/agent/design/*` rather than running an
engine of her own.

**MIRA (owner role, buy and sell side):** schema map → purchasing runbook. Her
config carries her own boot prompt. Tier prices come from
`/api/agent/prices`, never from a table read.

**MAX (sell_admin, sell side — the sales team's agent):** schema map. His
config carries his boot prompt, which holds the Dolibarr-vs-ICAPROC truth table
and his approval rules. Prices from `/api/agent/prices`; Dolibarr orders reach
ICAPROC only through `/api/agent/sales/mirror` and `/api/agent/sales/stock`.

**Hermes (buy side):** schema map → purchasing runbook.

A boot prompt is not a pack: an agent never reads the other agent's. It is the
text that goes into that agent's system prompt, kept here and versioned so the
deployed copy can be compared against it. A prompt that only exists in this
folder is not doing anything — MANDA's v2 sat here unread from 2026-09-06 to
2026-09-20 while her container ran a single sentence pointing at a filename
that did not exist.

## The versioning rule (owner's, 2026-09-06)

Filenames carry `_v<N>_YYYY-MM-DD` so the Drive copy can be compared to this
one without opening it. When a pack changes:

1. **Rename** to the new version and date — do not leave the old file beside
   it. Git history holds the previous versions; two files in the folder means
   two answers to the same question, which is the failure this whole set of
   documents exists to prevent.
2. **Update the row above**, including what changed, in one line.
3. **Update `lib/agentDocs.ts`.** `npm test` fails if a named file is missing,
   if this index does not mention it, or if a superseded copy is still sitting
   in the folder. The rule is enforced, not remembered.
4. **Bump the "Last updated" line** at the top.
5. **Re-upload to Drive**, and delete the superseded file there too.

A pack is a TRANSCRIPTION of code (`CLAUDE.md`), so the thread that changes the
code regenerates the pack in the same commit. A stale pack is worse than none:
an agent will follow it confidently.

## The Google Drive layout (owner's shared drive, 2026-09-07)

```
ICAPROC AI AGENTS
├── 00-READ-FIRST/     INDEX.md, alone
├── 10-PACKS/          the packs above, filenames verbatim
├── 20-RUNBOOKS/       per-flow procedures (purchasing today; sell side when the RPCs land)
└── 90-OUTPUT/         created by MANDA/ · created by MIRA/ · one folder per agent
```

Three rules, and the third is the one that decays quietly if it slips:

1. **Filenames must match this repository character for character.** The index
   is a pointer; a pointer to a name nothing has is worse than no index,
   because an agent that cannot find its pack improvises instead of stopping.
   (Hyphens were stripped on the first upload — `ICAPROCSCHEMA_v3_20260906.md`
   — which breaks every prompt that names the file.)
2. **Permissions follow the direction of authority.** Every agent is a *Viewer*
   on `00`, `10` and `20`, and a *Contributor* only on its own folder under
   `90`. An agent that can write to `10-PACKS` will eventually leave an edit
   beside the pack, and nobody will know which is which.
3. **No archive folder in this drive.** Git holds every previous version. An
   archive here recreates the exact problem the versioning rule solves.

### What belongs in `90-OUTPUT`, and what it is not

Agents write notes to themselves — what they learned, what surprised them, how
they got something to work. Keep them. They are how a wrong belief gets caught.

But they are **field notes, not packs**, and the difference is which way the
authority runs. A pack is written from the shipping code downward: read the
component, the trigger, the enum, then write the rule; the code wins every
disagreement. Notes are written from experience upward, and they record an
agent's mistakes with exactly the same confidence as its successes.

The case that settled it (2026-09-07): an agent independently derived the
"never state a total, the trigger doubles it" rule from a real incident. The
remedy was safe, the mechanism was wrong (it blamed a later `document_url`
edit; the damage happens at insert), and the rule as written would have left
every price quote with no total at all — `4.0_price_quotes` has no such
trigger. The correct rule had been rule #1 of the purchasing runbook since
2026-08-29, in a file that agent had never been given.

So: notes go in `90`, and anything worth relying on gets read against the code
and promoted into `10` or `20` by the thread that verifies it.
