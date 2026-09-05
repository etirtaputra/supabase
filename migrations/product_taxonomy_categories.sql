-- Product taxonomy: three new categories, and the rows that belong in them.
-- Owner's decisions, 2026-09-05:
--   * "log ac cables like nyaf, nyy, nym, and other ac cables, as ac cables"
--   * "h1z2z2k as pv cables"
--   * "switchgears as it's own category, and monitoring & comms as its own category"
--
-- Run PART 1 first and let it commit. Postgres will not let a value added by
-- ALTER TYPE ... ADD VALUE be USED in the same transaction, so the data move
-- in PART 2 has to be a second statement batch.
--
-- Both parts are idempotent.

-- ── PART 1 — the enum values ────────────────────────────────────────────────
ALTER TYPE product_category ADD VALUE IF NOT EXISTS 'ac_cable';
ALTER TYPE product_category ADD VALUE IF NOT EXISTS 'switchgear';
ALTER TYPE product_category ADD VALUE IF NOT EXISTS 'monitoring';


-- ── PART 2 — the rows ───────────────────────────────────────────────────────
--
-- AC cables out of `non_stock`.
--
-- The rule is a CABLE TYPE CODE, never the word "kabel". 24 rows in non_stock
-- say "Kabel Ladder" or "Kabel Tray" and are cable MANAGEMENT, not cable; a
-- word match would have filed a galvanised tray as a conductor. Matching the
-- SPLN/IEC construction code instead classified all 440 cable-worded rows with
-- nothing left over.
--
--   NYA/NYAF/NYM/NYMHY/NYY/NYYHY  single- and multi-core PVC building wire
--   NYFGbY/NYRGbY/NYFGbF          armoured LV
--   N2XY/NA2XY                    XLPE LV power cable (Al core for NA2XY)
--   N2XSY/N2XSEBY/N2XSEFGbY       20 kV XLPE medium-voltage
--   NFA2X / NFA2X-T               twisted aerial bundled
UPDATE "3.0_components"
   SET category = 'ac_cable'
 WHERE category = 'non_stock'
   AND internal_description ~* '\y(nya|nyaf|nyaaf|nym|nymhy|nyy|nyyhy|nyfgby|nyrgby|nyfgbf|n2xy|na2xy|n2xsy|n2xseby|n2xsefgby|nfa2x|nfa2xt|nyxby)\y';

-- The one H1Z2Z2-K that was filed as a project one-off. Every other PV cable
-- was already in `pv_cable`, and every row in `pv_cable` is H1Z2Z2-K.
UPDATE "3.0_components"
   SET category = 'pv_cable'
 WHERE category = 'non_stock'
   AND internal_description ~* 'h1z2z2|hz1z2z2';

-- `accessories` was two unrelated aisles in one bag: protection devices, and
-- things that measure or talk. A logger and an MCB share no datasheet
-- question, which by this repo's rule makes them two categories, not two
-- sub-categories.
UPDATE "3.0_components"
   SET category = 'switchgear'
 WHERE category = 'accessories'
   AND (internal_description ~* '\y(mcb|mccb|rccb|rcbo|elcb|spd|fuse|isolator|disconnector)\y'
     OR internal_description ~* 'distribution box|combiner|panel box|fuse holder|fuse link');

UPDATE "3.0_components"
   SET category = 'monitoring'
 WHERE category = 'accessories'
   AND internal_description ~* 'logger|wifi|\yble\y|rj45|\ytcp\y|serial device|\y4g\y|\ygps\y|smart meter|\ymeter\y|com100|communication box|snmp|pal-adp|rc-01|\ygt\d00\y|dtsu|dtsd|\ysdm\d';
