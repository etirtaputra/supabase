-- Supplied by owner (SBO) on EPC proposals (owner, 2026-10-22: "a faster and
-- more consistent way to say that items is not supplied by us so automatically
-- the cost and selling price is 0 and that section has a different color").
--
-- A switch on a sub-section (every line in it) and on a single line. The
-- editor writes cost_price = sell_price = 0 for an SBO line, so every total,
-- margin and dashboard that reads the prices is already right; the flag is
-- what the editor colours and what the printed proposal says instead of a
-- price ("Supplied by owner"). Quantities stay — owner-supplied modules still
-- make up the system size.
--
-- Columns only: no new table, so no GRANT is needed (lib/migrationGrants.test.ts).
ALTER TABLE public."10.1_quote_sections" ADD COLUMN IF NOT EXISTS supplied_by_owner boolean NOT NULL DEFAULT false;
ALTER TABLE public."10.2_quote_items"    ADD COLUMN IF NOT EXISTS supplied_by_owner boolean NOT NULL DEFAULT false;

-- Until now SBO was typed into the sub-section name ("Solar panels - SBO").
-- Those sections become switched on; their names are left as typed.
UPDATE public."10.1_quote_sections"
   SET supplied_by_owner = true
 WHERE title ~* '(^|[^a-z])sbo([^a-z]|$)|supplied by owner';
