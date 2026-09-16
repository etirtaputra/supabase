-- ICAPROC — make the tier-price tables explain themselves
--
-- Owner, 2026-09-16: *"do the mira tier-price correction next"*.
--
-- The document half is done: MIRA's own skill now carries the rule (verified
-- 2026-09-16 — §"Tier-2/Tier-3 prices are NOT stored", including the Dolibarr
-- sync warning), `lib/agentDocs.ts` registers it, and `/api/agent/onboarding`
-- serves it at the start of every session.
--
-- THIS FILE IS THE HALF THAT DOES NOT DEPEND ON ANYONE HAVING READ ANYTHING.
--
-- The original failure was not carelessness. An agent queried
-- `21.1_item_tier_prices` correctly, got nothing, and reported "T2/T3 are empty
-- in ICAPROC itself" — true of the table, false of the business. The query was
-- right; the table simply does not say what it is. Every mitigation so far has
-- been a rule in a document, and a rule in a document survives exactly as long
-- as the next reader's attention.
--
-- A COMMENT travels with the object. `\d+`, `information_schema`, Supabase
-- Studio, any introspecting agent, and every future reader who never saw the
-- pack all get it for free, at the moment they are looking at the wrong thing.
--
-- No behaviour changes here. Comments only.

-- ── The stored net, which is also Tier-1 ─────────────────────────────────────
COMMENT ON COLUMN public."3.0_components".selling_price_idr IS
  'The NET selling price, which IS Tier-1. Every higher tier is COMPUTED from it by the markup chain in lib/tierPricing.computeTierChain and is stored NOWHERE — see 21.1_item_tier_prices. NULL or 0 means unpriced, never free. Outside a browser, read tier prices from GET /api/agent/prices.';

-- ── The overrides table, and the sentence that stops the mistake ─────────────
COMMENT ON TABLE public."21.1_item_tier_prices" IS
  'HAND-PINNED TIER OVERRIDES ONLY — NOT the tier price list. A row exists exactly when somebody fixed one tier by hand. AN EMPTY RESULT MEANS *NO OVERRIDE*, IT NEVER MEANS NO PRICE: Tier-2 and Tier-3 are computed from the net (3.0_components.selling_price_idr) by the markup chain in the app, and are not stored in any table. Reading this table to answer "what do we charge?" will under-report every item nobody has pinned. Use GET /api/agent/prices, which runs the same computeTierChain the Selling Prices grid runs and labels each tier net | override | chain.';

COMMENT ON COLUMN public."21.1_item_tier_prices".override_price_idr IS
  'A price pinned by hand for this one tier. It replaces the computed price AND becomes the base the next tier chains from. An override stored against the FIRST (net) tier is inert — the net is whatever is on 3.0_components.selling_price_idr.';

-- ── The column whose name lies ───────────────────────────────────────────────
-- Worth its own comment: a reader who trusts the name SUBTRACTS, and the engine
-- divides. On a 5 step that is 4.76% of the answer, in the right direction, on
-- a number a customer is quoted — the kind of wrong that survives review.
COMMENT ON COLUMN public."21.0_price_tiers".default_discount_pct IS
  'MISNAMED, KEPT FOR COMPATIBILITY: this is a MARKUP step, not a discount. The engine computes tier[i] = tier[i-1] / (1 - step/100), rounded UP to the price step in Settings — it does not subtract. The first active tier is the net and its step is ignored. A step of 95 or more yields no price rather than a nonsensical one.';

-- ── The other two "looks empty / looks writable" traps in the same family ────
COMMENT ON COLUMN public."21.0_price_tiers".sort_order IS
  'Tier order, and it is load-bearing: the FIRST active tier by sort_order is the net, and every later tier chains off the one before it. Reordering these re-prices the catalogue.';
