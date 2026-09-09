/**
 * The agent document set, as data.
 *
 * WHY THIS EXISTS: the packs in `docs/agents/` carry a version and a date in
 * their filenames (owner's rule, 2026-09-06) so a copy in Google Drive can be
 * compared to the repo without opening it. That rule has one failure mode —
 * rename a pack, forget to update `INDEX.md`, and every agent prompt that says
 * "load the file the index names" now points at nothing. An agent that cannot
 * find its pack does not stop; it improvises, which is the exact failure the
 * packs exist to prevent.
 *
 * So the list lives here, `agentDocs.test.ts` fails the build if a named file
 * is missing or if `INDEX.md` does not name it, and `/api/agent/onboarding`
 * serves it. One list, three readers, no drift.
 */

export interface AgentDoc {
  /** Stable key an agent can ask for; never changes when the version bumps. */
  id: string;
  title: string;
  /** Path under `docs/agents/`. Carries the version and date. */
  file: string;
  /** Who needs it, and when. */
  audience: string;
  /** Read this before doing anything else. */
  first: boolean;
}

export const AGENT_DOCS: readonly AgentDoc[] = [
  {
    id: 'schema',
    title: 'ICAPROC schema map',
    file: 'ICAPROC-SCHEMA_v5_2026-09-09.md',
    audience: 'every agent, before its first query',
    first: true,
  },
  {
    id: 'purchasing-runbook',
    title: 'Purchasing runbook (buy side)',
    file: 'PURCHASING-RUNBOOK_v2_2026-09-07.md',
    audience: 'buy-side agents: quotes, POs, payments, landed cost',
    first: false,
  },
  {
    id: 'solar-design',
    title: 'Solar system and mounting design',
    file: 'MANDA-SOLAR-DESIGN_v3_2026-09-09.md',
    audience: 'engineering agents sizing arrays, strings and mounting',
    first: false,
  },
  {
    id: 'manda-boot',
    title: 'MANDA boot prompt',
    file: 'MANDA-BOOT-PROMPT_v2_2026-09-06.md',
    audience: "MANDA's own configuration",
    first: false,
  },
  {
    id: 'platform',
    title: 'Agent platform architecture',
    file: 'AGENT-PLATFORM_v3_2026-09-07.md',
    audience: 'the owner and whoever builds the next layer',
    first: false,
  },
] as const;

/** The endpoints an agent can call, and what each needs. */
export const AGENT_ENDPOINTS = [
  { method: 'GET', path: '/api/agent/onboarding', purpose: 'who am I, what may I see, what do I read' },
  { method: 'GET', path: '/api/agent/attention', purpose: 'every open signal, filtered to your role' },
  { method: 'GET', path: '/api/agent/attention/summary', purpose: 'counts and totals per signal, for a daily message' },
  { method: 'POST', path: '/api/agent/design/mounting', purpose: 'the v11 mounting engine, with catalogue and prices' },
  { method: 'POST', path: '/api/agent/design/system', purpose: 'the v9 system engine, with catalogue and prices' },
] as const;

/**
 * Rules that are true for every agent regardless of role. Served with the
 * onboarding payload because a rule an agent has to remember from a document
 * it read last week is a rule it will break.
 */
export const AGENT_RULES = [
  'There is one product table: 3.0_components. batteries, pv_modules, hybrid_inverters, on_grid_inverters and solar_charge_controllers are abandoned and will answer with a fraction of the rows.',
  'Never ask for or accept a service-role key. It makes auth.uid() NULL, so every row you write is stamped "system" and you lose the attribution your account exists to give.',
  'Exclude archived_at IS NOT NULL from anything describing what is available now.',
  'Never re-implement a sizing or pricing rule. Call /api/agent/design/*; a second implementation drifts from the first in silence.',
  'Never write 30.1_stock_balances, 21.3_item_price_history or 22.3_sales_activity_log. They are trigger-maintained.',
  'On the buy side, write line items BEFORE stating a total. See the purchasing runbook: the total trigger reads whatever the total exceeds the lines by as freight.',
  'Do not write sell-side documents (22.x-26.x) yet. Their totals are computed by the app, not by a trigger, so a direct write leaves a document whose stated total is wrong.',
  'Say which table a figure came from. A number without its source cannot be checked.',
] as const;
