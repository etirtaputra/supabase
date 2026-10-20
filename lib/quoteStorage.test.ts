/**
 * quoteStorage — the BESS kWh and PCS kW a hybrid proposal states, read off
 * its own lines. The first case is the real one that prompted it: AYANA BALI,
 * Q-20260724-R4-PV+BESS_SBO, three "SUNGROW ST255C2-2h Powerstack Battery
 * 255 kWh / 125 kW" — typed by hand as 765 kWh and 375 kW.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { bessWhPerUnit, pcsWattsPerUnit, storageSize } from './quoteStorage.ts';

const comps = [
  { component_id: 'bat', category: 'batteries', norm_value: 5120 },
  { component_id: 'bat0', category: 'batteries', norm_value: null },
  { component_id: 'ic', category: 'inverter_charger', norm_value: 5000 },
  { component_id: 'mon', category: 'monitoring', norm_value: null },
  { component_id: 'deye', category: 'inverter_charger', norm_value: 100000 },
  { component_id: 'bos16', category: 'batteries', norm_value: 16076.8 },
];
const line = (description: string, quantity = 1, component_id: string | null = null) => ({ component_id, description, quantity });

test('AYANA: a storage cabinet gives both its energy and the PCS inside it', () => {
  const items = [
    line('SUNGROW SG125CX-P2 C&I Three Phase On-grid Inverter 125 kW', 3),
    line('SUNGROW COM100D Smart Communication Box 4G+ WLAN', 1, 'mon'),
    line('SUNGROW DTSD1352/6A Three Phase Smart Energy Meter', 4),
    line('SUNGROW ST255C2-2h Powerstack Battery 255 kWh / 125 kW', 3),
    line('SUNGROW EMS300CP EMS C&I Inside BESS Cabinet', 1),
    line('', 3),
  ];
  assert.deepEqual(storageSize(comps, items), { kwh_bess: 765, kw_pcs: 375 });
});

test('the on-grid inverter is kW AC, never PCS', () => {
  assert.equal(pcsWattsPerUnit(comps, null, 'SUNGROW SG125CX-P2 On-grid Inverter 125 kW'), 0);
  assert.equal(pcsWattsPerUnit(comps, 'ic', 'Hybrid inverter 5 kW'), 0, 'a hybrid inverter is already the kW AC');
});

test('a separate converter that names itself PCS counts, at its own kW', () => {
  assert.equal(pcsWattsPerUnit(comps, null, 'PCS 100 kW bidirectional'), 100000);
  assert.equal(pcsWattsPerUnit(comps, null, 'Power Conversion System 250kW'), 250000);
  assert.equal(bessWhPerUnit(comps, null, 'PCS 100 kW bidirectional'), 0, 'a PCS stores nothing');
});

test('energy from the catalog in Wh, else from the text: kWh, MWh, V × Ah', () => {
  assert.equal(bessWhPerUnit(comps, 'bat', 'anything'), 5120);
  assert.equal(bessWhPerUnit(comps, 'bat0', 'LiFePO4 Battery 51.2V 100Ah'), 5120);
  assert.equal(bessWhPerUnit(comps, null, 'BESS container 1.2 MWh'), 1_200_000);
  assert.equal(bessWhPerUnit(comps, null, 'Lithium battery 14,3 kWh'), 14_300);
});

test('DEYE (Q-20260724-RVSP): a catalog PCS gives its own kW, the battery packs their Wh', () => {
  const items = [
    line('DEYE PCS SUN-100K-PCS01HP3 Battery Input 630-1000Vdc, Max Charge/Discharge 175A, 220/380V', 3, 'deye'),
    line('DEYE BOS-B-Pack16-A3', 15, 'bos16'),
  ];
  assert.deepEqual(storageSize(comps, items), { kwh_bess: 241.15, kw_pcs: 300 });
  assert.equal(bessWhPerUnit(comps, 'deye', 'DEYE PCS … Battery Input'), 0, 'a PCS that mentions its battery input stores nothing');
});

test('accessories that say battery are not storage (real lines)', () => {
  for (const d of ['DC MCCB 2P 65A, 1000V (Battery)', 'Cable Jumper Battery', 'Box Battery BSP2002', 'Kabel BESS HV 1 x 16mm',
    'BESS Energy Meter DTSD 1352', 'Canopy Outdoor with Concrete Ground for Inverter & BESS & Transformer (20M x 12M)']) {
    assert.equal(bessWhPerUnit(comps, null, d), 0, d);
    assert.equal(pcsWattsPerUnit(comps, null, d), 0, d);
  }
});

test('a battery that states only its energy has no PCS in it', () => {
  assert.equal(pcsWattsPerUnit(comps, 'bat', 'LiFePO4 5.12 kWh'), 0);
  assert.equal(pcsWattsPerUnit(comps, null, 'Lithium battery 14.3 kWh'), 0);
});

test('what must not count as storage: meters, inverters, cables, labour', () => {
  assert.equal(bessWhPerUnit(comps, null, 'kWh Meter 3 phase 100 kWh class'), 0);
  assert.equal(bessWhPerUnit(comps, null, 'Smart Energy Meter'), 0);
  assert.equal(bessWhPerUnit(comps, 'ic', 'Hybrid inverter with 10 kWh battery'), 0, 'the catalog says inverter');
  assert.equal(bessWhPerUnit(comps, null, 'Installation of 765 kWh system'), 0, 'labour does not call itself a battery');
  assert.equal(bessWhPerUnit(comps, null, 'Hybrid inverter 10 kW, battery input 48V'), 0, 'a free-typed inverter is the kW AC');
  assert.deepEqual(storageSize(comps, [line('KMI Kabel NYY 1 x 240 mm²', 400)]), { kwh_bess: 0, kw_pcs: 0 });
});
