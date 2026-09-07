# ICAPROC agent packs — what to load, and which version is current

> **This file never changes its name.** Every other file in `docs/agents/`
> carries a version and a date, so the owner can see at a glance whether the
> copy in Google Drive is stale. Agent prompts point HERE, and this page names
> the current file — otherwise every version bump would break every prompt.
>
> **Last updated: 2026-09-06** (third revision today: the design API).

## Current packs

| Pack | Current file | For | Changed |
|---|---|---|---|
| **Schema map** | `ICAPROC-SCHEMA_v3_2026-09-06.md` | every agent, first | v3: the design API |
| **Solar design** | `MANDA-SOLAR-DESIGN_v2_2026-09-06.md` | MANDA, engineering | v2: engine v8, temperature-corrected strings |
| **MANDA boot prompt** | `MANDA-BOOT-PROMPT_v2_2026-09-06.md` | MANDA's config | v2: string-reporting rule |
| **Agent platform** | `AGENT-PLATFORM_v2_2026-09-06.md` | the owner and me | v2: attention + design APIs marked built |
| **Purchasing runbook** | `../PURCHASING_RUNBOOK.md` | Hermes, buy side | unversioned, predates this rule |

## What each agent loads

**Any agent, before its first query:** the schema map. It is the difference
between reading `3.0_components` and reading an abandoned table with a fifth of
the rows.

**MANDA (Project Engineer):** schema map → solar design pack. Her config
carries the boot prompt.

**Hermes (buy side):** schema map → purchasing runbook.

## The versioning rule (owner's, 2026-09-06)

Filenames carry `_v<N>_YYYY-MM-DD` so the Drive copy can be compared to this
one without opening it. When a pack changes:

1. **Rename** to the new version and date — do not leave the old file beside
   it. Git history holds the previous versions; two files in the folder means
   two answers to the same question, which is the failure this whole set of
   documents exists to prevent.
2. **Update the row above**, including what changed, in one line.
3. **Bump the "Last updated" line** at the top.
4. **Re-upload to Drive**, and delete the superseded file there too.

A pack is a TRANSCRIPTION of code (`CLAUDE.md`), so the thread that changes the
code regenerates the pack in the same commit. A stale pack is worse than none:
an agent will follow it confidently.
