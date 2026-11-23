import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sizeSystem, buildTemplate, permitCost, crewDays, coerceQuickQuote, inverterSpec, batteryKwh, projectDescription,
  QUICK_QUOTE_DEFAULTS as cfg, type QqSurvey, type QqInverter,
} from './quickQuote.ts';

const panel = { componentId: 'p450', name: 'ICA SOLAR ICA450-72HMG 450Wp Mono', brand: 'ICA SOLAR', wp: 450 };
const battery = { componentId: 'b48', name: 'ICAL LIP48100LF 48V/100Ah', brand: 'ICAL', kwh: 4.8 };
const inv = (id: string, kw: number, phase: 1 | 3, kind: 'on_grid' | 'hybrid', cost: number | null = null): QqInverter =>
  ({ componentId: id, name: id, brand: 'ICA SOLAR', kw, phase, kind, cost });
const inverters = [
  inv('gt3', 3, 1, 'on_grid'), inv('gt5', 5, 1, 'on_grid', 4_000_000), inv('gt5b', 5, 1, 'on_grid', 3_500_000),
  inv('gt10', 10, 3, 'on_grid'), inv('gt15', 15, 3, 'on_grid'), inv('gt20', 20, 3, 'on_grid'),
  inv('gh3', 3, 1, 'hybrid'), inv('gh5', 5, 1, 'hybrid'), inv('gh10', 10, 3, 'hybrid'),
];
const cat = { panel, inverters, battery };
const survey = (o: Partial<QqSurvey> = {}): QqSurvey => ({
  customerName: 'X', location: 'Petojo Utara, Gambir, Jakarta Pusat', jabodetabek: true, system: 'hybrid',
  plnVa: 5500, plnPhase: 1, billRp: 2_000_000, kwhMonth: null, tariff: 1699.53, sharePct: null,
  backupKw: 1.5, backupHours: 4, roof: 'metal', storeys: 2, maxPanels: null, dcRunM: 45, acRunM: 20, ...o,
});

test('golden: the Petojo hybrid comes out as quoted — 6.3 kWp / 5 kW / 9.6 kWh', () => {
  const z = sizeSystem(survey(), cat, cfg);
  assert.equal(Math.round(z.monthlyKwh), 1177);
  assert.equal(z.panels, 14);
  assert.equal(z.kwp, 6.3);
  assert.equal(z.inverter?.componentId, 'gh5');
  assert.equal(z.batteries, 2);
  assert.equal(z.kwh, 9.6);
  assert.equal(projectDescription(survey(), z), 'EPC for PV Hybrid 6,3 kWp DC / 5 kW AC / 9,6 kWh BESS, at Petojo Utara, Gambir, Jakarta Pusat');
  // It wanted more than one inverter carries: capped, and said so.
  assert.ok(z.notes.some((n) => n.text.startsWith('One inverter only')));
});

test('on-grid: 60 % of usage, panels round DOWN, the cheapest of equal inverters', () => {
  const z = sizeSystem(survey({ system: 'on_grid' }), cat, cfg);
  assert.equal(z.sharePct, 60);
  assert.equal(z.panels, 13);            // 5.88 kWp wanted → 13 × 450 = 5.85, never 14
  assert.equal(z.inverter?.componentId, 'gt5b');
  assert.equal(z.batteries, 0);
});

test('never above the PLN connection, on its phase', () => {
  const z = sizeSystem(survey({ system: 'on_grid', plnVa: 4400, billRp: 5_000_000 }), cat, cfg);
  assert.equal(z.inverter?.kw, 3);
  assert.equal(z.panels, Math.floor(3 * 1.3 * 1000 / 450));
  const t = sizeSystem(survey({ system: 'on_grid', plnVa: 23000, plnPhase: 3, billRp: 8_000_000 }), cat, cfg);
  assert.equal(t.inverter?.phase, 3);
  assert.ok(t.inverter!.kw <= 23);
});

test('the roof caps the panels; kWh on the bill wins over the bill amount', () => {
  assert.equal(sizeSystem(survey({ maxPanels: 8 }), cat, cfg).panels, 8);
  assert.equal(sizeSystem(survey({ kwhMonth: 600, billRp: 99_000_000, system: 'on_grid' }), cat, cfg).monthlyKwh, 600);
});

test('template: every section of a residential proposal, quantities that scale', () => {
  const s = survey();
  const z = sizeSystem(s, cat, cfg);
  const t = buildTemplate(s, z, cfg);
  assert.deepEqual(t.map((x) => x.title), [
    'Solar panels', 'Inverters', 'Array mounting kits', 'DC cables, conduits and terminators',
    'AC cables, conduits and terminators', 'AC switchgears and protection devices',
    'Battery Energy Storage Systems (BESS)', 'Design, engineering and test commissioning',
    'Installation', 'Logistics and misc.', 'Perizinan',
  ]);
  const line = (d: string) => t.flatMap((x) => x.lines).find((l) => l.description.startsWith(d))!;
  assert.equal(line('Kabel H1Z2Z2').qty, Math.ceil(2 * 2 * 45 * 1.1));   // 2 strings × 45 m, both poles, +10 %
  assert.equal(line('Technician').qty, 4);                               // max(3, 6.3 ÷ 3 → 2) + battery
  assert.equal(line('Installers').qty, 12);
  assert.equal(line('AC MCB').description, 'AC MCB 1P 32A');            // 5 kW ÷ 230 V × 1.25 = 27 A → 32 A
  assert.equal(line('Biaya NIDI').cost, 15_000_000);
  assert.ok(line('Scaffolding'));
  assert.ok(t.flatMap((x) => x.lines).every((l) => !l.needsPricing), 'a metal roof in Jakarta needs no hand pricing');
});

test('concrete roof and a far site: created without a price, flagged for a person', () => {
  const s = survey({ roof: 'concrete', jabodetabek: false, storeys: 1 });
  const t = buildTemplate(s, sizeSystem(s, cat, cfg), cfg).flatMap((x) => x.lines);
  const flagged = t.filter((l) => l.needsPricing);
  assert.deepEqual(flagged.map((l) => l.description), [
    'Triangle Mounting Kit with Cement Pedestal',
    'Transport and accommodation (outside Jabodetabek)',
    'Equipment transport (Jakarta - site)',
  ]);
  assert.ok(flagged.every((l) => l.cost === null));
  assert.ok(!t.some((l) => l.description === 'Scaffolding'), 'one storey: no scaffolding');
});

test('NIDI + SLO by size band; crew days', () => {
  assert.equal(permitCost(6.2, cfg.permitBands), 15_000_000);
  assert.equal(permitCost(14.3, cfg.permitBands), 20_000_000);
  assert.equal(permitCost(24.8, cfg.permitBands), 30_000_000);
  assert.equal(permitCost(40, cfg.permitBands), 30_000_000);
  // Against the Jakarta-area quotes: 6.2 → 3, 12.1 → 4, 24.8 → 8 days.
  assert.deepEqual([6.2, 12.1, 24.8].map((k) => crewDays(k, false)), [3, 4, 8]);
});

test('settings: stored values coerced, missing ones default', () => {
  const s = coerceQuickQuote({ sharePctOnGrid: 70, cost: { panelBox: 2_500_000 }, permitBands: [{ upToKwp: 10, cost: 9 }] });
  assert.equal(s.sharePctOnGrid, 70);
  assert.equal(s.sharePctHybrid, cfg.sharePctHybrid);
  assert.equal(s.cost.panelBox, 2_500_000);
  assert.equal(s.cost.survey, cfg.cost.survey);
  assert.deepEqual(s.permitBands, [{ upToKwp: 10, cost: 9 }]);
  assert.deepEqual(coerceQuickQuote(null), cfg);
});

test('catalogue specs: inverter kW and phase, battery kWh', () => {
  assert.deepEqual(inverterSpec({ rated_output_power_kw: 5, nominal_ac_voltage_vac: '230 L-N' }), { kw: 5, phase: 1 });
  assert.deepEqual(inverterSpec({ rated_output_power_kw: 10, nominal_ac_voltage_vac: '400 3L+N' }), { kw: 10, phase: 3 });
  assert.deepEqual(inverterSpec({ rated_output_power_w: 5000, phase: '1-phase in / 1-phase out' }), { kw: 5, phase: 1 });
  assert.deepEqual(inverterSpec({ rated_output_power_w: 10000, phase: '3-phase in / 3-phase out' }), { kw: 10, phase: 3 });
  assert.equal(batteryKwh({ nominal_voltage_v: 48, rated_capacity_ah: 100 }), 4.8);
});

test('the tariff follows the PLN connection (the savings page list)', async () => {
  const { tariffForVa } = await import('./quickQuote.ts');
  assert.equal(tariffForVa(900), 1352);
  assert.equal(tariffForVa(2200), 1444.70);
  assert.equal(tariffForVa(5500), 1699.53);
  assert.equal(tariffForVa(11000), 1699.53);
});

test('catalogue matching is by whole words: 6 mm is not 16 mm, NYA is not NYAF', async () => {
  const { matchesWords } = await import('./quickQuote.ts');
  assert.equal(matchesWords('KMI Kabel NYA 6 mm²', ['nya', '6mm']), true);
  assert.equal(matchesWords('KMI Kabel NYA 16 mm² (Kuning Hijau)', ['nya', '6mm']), false);
  assert.equal(matchesWords('KMI Kabel NYAF 6 mm²', ['nya', '6mm']), false);
  assert.equal(matchesWords('SLOCABLE Kabel H1Z2Z2-K 1 x 6mm', ['h1z2z2', '1x6mm']), true);
  assert.equal(matchesWords('JEMBO Kabel H1Z2Z2-K 1 x 4mm', ['h1z2z2', '1x6mm']), false);
  assert.equal(matchesWords('JEMBO Kabel NYY 3 x 4 mm²', ['nyy', '3x4mm']), true);
  assert.equal(matchesWords('JEMBO Kabel NYY 4 x 6 mm²', ['nyy', '3x4mm']), false);
  assert.equal(matchesWords('SUNTREE AC SPD SUP1H-40 2P 20-40KA T2 275V', ['ac spd', '2p']), true);
});

test('mounting: the engineer\'s layout replaces the per-Wp line on metal and tile roofs only', async () => {
  const { parseDims, defaultRows } = await import('./quickQuote.ts');
  assert.deepEqual(parseDims('2278 x 1134 x 30'), { l: 2278, w: 1134, t: 30 });
  assert.deepEqual(parseDims('1134×2278'), { l: 2278, w: 1134, t: 0 });
  assert.equal(parseDims('n/a'), null);
  assert.deepEqual([4, 6, 7, 12, 20].map(defaultRows), [1, 1, 2, 2, 3]);
  const parts = [{ description: 'MIBET MD T-slot Rail L4850mm', qty: 6, unit: 'pcs', componentId: 'r', cost: 300_000 }];
  const s = survey();
  const z = sizeSystem(s, cat, cfg);
  const mount = (x: QqSurvey) => buildTemplate(x, z, cfg, parts).find((t) => t.title === 'Array mounting kits')!.lines;
  assert.deepEqual(mount(s).map((l) => l.description), ['MIBET MD T-slot Rail L4850mm']);
  assert.equal(mount(survey({ roof: 'concrete' }))[0].description, 'Triangle Mounting Kit with Cement Pedestal');
  assert.equal(buildTemplate(s, z, cfg).find((t) => t.title === 'Array mounting kits')!.lines[0].unit, 'Wp', 'no layout: the per-Wp line');
});
