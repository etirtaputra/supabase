# ICAPROC agent packs — what to load, and which version is current

> **This file never changes its name.** Every other file in `docs/agents/`
> carries a version and a date, so the owner can see at a glance whether the
> copy in Google Drive is stale. Agent prompts point HERE, and this page names
> the current file — otherwise every version bump would break every prompt.
>
> **Last updated: 2026-09-09** (v5: the landed-cost alarm; the schema pack
> gains the eighth attention signal).

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
| **Schema map** | `ICAPROC-SCHEMA_v5_2026-09-09.md` | every agent, first | v5: the landed\_cost\_open signal — imports received with no PIB/OPS |
| **Purchasing runbook** | `PURCHASING-RUNBOOK_v2_2026-09-07.md` | Hermes, buy side | v2: versioned and moved here; the mechanism behind lines-before-totals; the price-quote exception |
| **Solar design** | `MANDA-SOLAR-DESIGN_v2_2026-09-06.md` | MANDA, engineering | v2: engine v8, temperature-corrected strings |
| **MANDA boot prompt** | `MANDA-BOOT-PROMPT_v2_2026-09-06.md` | MANDA's config | v2: string-reporting rule |
| **Agent platform** | `AGENT-PLATFORM_v3_2026-09-07.md` | the owner and me | v3: onboarding endpoint and the enforced registry |

## What each agent loads

**Any agent, before its first query:** `GET /api/agent/onboarding`, then the
schema map. It is the difference between reading `3.0_components` and reading
an abandoned table with a fifth of the rows.

**MANDA (Project Engineer):** schema map → solar design pack. Her config
carries the boot prompt. She calls `/api/agent/design/*` rather than running an
engine of her own.

**Hermes (buy side):** schema map → purchasing runbook.

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
