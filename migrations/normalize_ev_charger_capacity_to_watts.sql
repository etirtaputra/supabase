-- ============================================================================
-- ICAPROC — Capacity units: EV chargers stored in kW → W (universal Watts)
--
-- Every power category normalizes capacity in WATTS (on_grid_inverter,
-- power_inverter, inverter_charger, solar_pump_inverter all store e.g. 150000
-- for 150 kW), but ev_charger was configured in kW and its rows held 60 / 160.
-- That made the Capacity column read "160 kW" beside "150,000 W" and broke
-- like-for-like Price/W comparisons on the positioning map.
--
-- constants/categoryUnits.ts now declares ev_charger in W; this converts the
-- stored values to match. Guarded so re-running cannot multiply twice: only
-- rows still small enough to be kW (< 1000) are scaled.
-- ============================================================================

UPDATE "3.0_components"
SET norm_value = norm_value * 1000
WHERE category = 'ev_charger'
  AND norm_value IS NOT NULL
  AND norm_value > 0
  AND norm_value < 1000;   -- already-converted rows (>= 1000 W) are left alone
