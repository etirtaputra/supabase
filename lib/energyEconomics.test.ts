/**
 * The energy simulation on EPC proposals (editor card + PDF annex).
 *
 * Golden case: Q-20261004-DCRU, PT Hon Chuan Indonesia, 2026-10-05 —
 * 3,523.5 kWp (4,860 × 725 Wp), CAPEX Rp 20,293,530,230 excl. PPN, PLN
 * I-3/TM Rp 1,035.78, 1,392 kWh/kWp·yr, 20 years. The team entered
 * Annual O&M Rp 50,816,745 per MWp·yr and reported it "not in the
 * projections": the cash flows did carry it, but the LCOE did not and no
 * screen showed an O&M line.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeEnergyEconomics, type EconAssumptions } from './energyEconomics.ts';

const A: EconAssumptions = {
  pln_tariff: 1035.78, lifetime_years: 20, yearly_deg_pct: 0.7, hurdle_rate_pct: 10,
  first_year_deg_pct: 2.5, specific_production: 1392, tariff_inflation_pct: 2.5,
};
const CAPEX = 20_293_530_230;
const KWP = 3523.5;
const round = (n: number) => Math.round(n);

test('O&M is per MWp per year, and is a cost in every year from year 1', () => {
  const r = computeEnergyEconomics(CAPEX, KWP, { ...A, om_per_mwp_year: 50_816_745 }, false)!;
  assert.equal(round(r.omYear), 179_052_801, '50,816,745 × 3.5235 MWp');
  assert.equal(r.years[0].om, 0, 'no O&M in year 0 — that row is the investment');
  for (const y of r.years.slice(1)) {
    assert.equal(round(y.om), 179_052_801);
    assert.equal(round(y.net), round(y.savings - y.om));
  }
  assert.equal(round(r.omLifetime), round(50_816_745 * 3.5235 * 20));
  assert.equal(round(r.netSavings), round(r.costAvoided - r.omLifetime));
});

test('O&M moves every result — NPV, IRR, payback AND the LCOE', () => {
  const none = computeEnergyEconomics(CAPEX, KWP, A, false)!;
  const om = computeEnergyEconomics(CAPEX, KWP, { ...A, om_per_mwp_year: 50_816_745 }, false)!;
  assert.ok(om.npv < none.npv);
  assert.ok(om.irr! < none.irr!);
  assert.ok(om.paybackYears! > none.paybackYears!);
  assert.ok(om.lcoe > none.lcoe, 'the LCOE used to ignore O&M');
  assert.equal(om.lcoe.toFixed(2), ((CAPEX + om.omLifetime) / om.lifetimeKwh).toFixed(2));
  assert.equal(om.costAvoided, none.costAvoided, 'gross savings are the electricity bill avoided — O&M does not change them');
});

test('without O&M the numbers are exactly what the sheet produced', () => {
  const r = computeEnergyEconomics(CAPEX, KWP, A, false)!;
  assert.equal(r.omLifetime, 0);
  assert.equal(r.lcoe.toFixed(2), (CAPEX / r.lifetimeKwh).toFixed(2));
  assert.equal(round(r.yr1GenKwh), round(3523.5 * 1392));
  assert.equal(round(r.years[1].pvGenKwh), round(3523.5 * 1392 * 0.975));
  assert.equal(round(r.years[2].pvGenKwh), round(3523.5 * 1392 * 0.975 * 0.993));
  assert.equal(r.years[1].tariff.toFixed(4), (1035.78 * 1.025).toFixed(4));
  assert.equal((r.irr! * 100).toFixed(2), '26.48');
  assert.equal(r.paybackYears!.toFixed(2), '3.89');
});
