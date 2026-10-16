/**
 * Project works and manpower — tests of the method recorded from the 2026-10
 * workbooks (docs/epc-bom/WORKBOOK_STUDY.md §1–3): the 3,523.5 kWp rooftop's
 * 'Jasa' cross-check (Rp 1,841 m installation against Rp 1,762 m manpower),
 * its CAR insurance left at Rp 0, and the circular "percent of the grand
 * total" of another job.
 *
 * The workbooks were not available to the thread that wrote these: the crew
 * below is a test crew built to cost the recorded Rp 1,762 m, and every rate
 * is a test input. Never change a number to make a build pass.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateWorks, crossCheckLabour, newWorksDoc, type WorksDoc } from './works.ts';
import { computeBomCalc, newBomCalcDoc, linkOptions } from './index.ts';
import { explainKey, unusedKeys } from './links.ts';

const crew1762 = (): WorksDoc => ({
  ...newWorksDoc(),
  settings: { durationMonths: 4, workingDaysPerMonth: 26 },
  crew: [
    { id: 'inst', label: 'Installers', category: '', people: 30, days: null, dayRate: 500_000 },   // 30 × 104 × 500,000
    { id: 'sup', label: 'Supervisors', category: '', people: 2, days: 101, dayRate: 1_000_000 },  // 2 × 101 × 1,000,000
  ],
});

test("The 'Jasa' cross-check: Rp 1,841 m installation against a Rp 1,762 m crew — 4.29 % above, side by side", () => {
  const r = calculateWorks(crew1762(), { plantWp: 3_523_500 });
  assert.equal(r.projectDays, 104, '4 months × 26 working days');
  assert.equal(r.manDays, 3322);
  assert.equal(r.labourCost, 1_762_000_000);
  const cc = crossCheckLabour(r, { total: 1_841_000_000, byCategory: {} }, (k) => k);
  assert.equal(cc.marginPct, 4.29);
  assert.ok(r.checks.some((c) => c.level === 'ok' && c.where === 'Manpower'));

  const low = calculateWorks(crew1762(), { plantWp: 3_523_500 });
  crossCheckLabour(low, { total: 1_700_000_000, byCategory: {} }, (k) => k);
  assert.ok(low.checks.some((c) => c.level === 'error' && /sold below its labour cost/.test(c.message)));
});

test('Per category: a category whose installation is sold below its own crew is flagged', () => {
  const w = crew1762();
  w.crew = [{ id: 'm', label: 'Mounting crew', category: 'mounting', people: 10, days: 50, dayRate: 400_000 }];
  const r = calculateWorks(w, { plantWp: 1 });
  const cc = crossCheckLabour(r, { total: 900_000_000, byCategory: { mounting: 150_000_000 } }, () => '3. Mounting system');
  assert.deepEqual(cc.byCategory, [{ category: 'mounting', installSold: 150_000_000, labourCost: 200_000_000 }]);
  assert.ok(r.checks.some((c) => c.level === 'warn' && c.where === '3. Mounting system'));
});

test('A role with no day rate is said out loud and left out of the crew cost', () => {
  const w = crew1762();
  w.crew.push({ id: 'x', label: 'Electricians', category: '', people: 4, days: 20, dayRate: null });
  const r = calculateWorks(w, { plantWp: 1 });
  assert.equal(r.labourCost, 1_762_000_000);
  assert.equal(r.manDays, 3402);
  assert.ok(r.checks.some((c) => c.where === 'Electricians' && /no day rate/.test(c.message)));
});

test('Project works: per month × months, per Wp × plant, lump', () => {
  const w = newWorksDoc();
  w.items = w.items.map((i) => (i.id === 'office' ? { ...i, rate: 15_000_000 } : i.id === 'cleaning' ? { ...i, rate: 1 } : i.id === 'survey' ? { ...i, rate: 25_000_000 } : i));
  const r = calculateWorks(w, { plantWp: 3_523_500 });
  const cost = (id: string) => r.items.find((i) => i.id === id)!.cost;
  assert.equal(cost('office'), 60_000_000, 'Rp 15 m × 4 months');
  assert.equal(cost('cleaning'), 3_523_500, 'Rp 1/Wp × 3,523,500 Wp');
  assert.equal(cost('survey'), 25_000_000);
});

test('CAR insurance: a share of every OTHER row, never of itself; at Rp 0 it reads "not priced"', () => {
  const doc = newBomCalcDoc();
  doc.module = { model: 'M', wp: 725, vocV: 49.6, vmpV: 41.5, iscA: 18.54, impA: 17.47, tempCoeffVocPct: -0.24, maxSystemV: 1500, componentId: null };
  doc.inverterGroups = [{ id: 'g', label: 'INV', count: 9, stringsEach: 20, modulesPerString: 27, componentId: null,
    inverter: { model: 'I', acKw: 330, acVoltageV: 800, acCurrentA: 238.2, maxDcV: 1500, mpptMinV: 500, mpptMaxV: 1500, mppts: 6, stringsPerMppt: 5, maxIscPerMpptA: 120 } }];
  // Hon Chuan row 6: 4,860 modules at Rp 1,600,000, 12 % margin, Rp 85,000 installation = Rp 9,249,463,645.20.
  doc.rows[0] = { ...doc.rows[0], cost: 1_600_000, margin: 0.12, install: 85_000 };
  const ins = doc.rows.find((r) => r.costKey === 'works.insurance.cost')!;

  const unpriced = computeBomCalc(doc);
  assert.ok(unpriced.checks.some((c) => c.tag === 'unpriced' && c.where === ins.description), 'insurance at 0 is not a quiet zero');

  doc.works!.items = doc.works!.items.map((i) => (i.id === 'insurance' ? { ...i, rate: 0.2 } : i));
  const res = computeBomCalc(doc);
  assert.equal(res.values['works.insurance.cost'], 18_498_927.29, '0.2 % × 9,249,463,645.20 — the other rows only');
  const p = res.rows.find((r) => r.id === ins.id)!;
  assert.equal(p.total, 20_785_311.56, 'sold at cost ÷ (1 − 11 %)');
  assert.equal(res.totals.total, 9_249_463_645.2 + 20_785_311.56);

  // Doubling the rate doubles the insurance and nothing else: it does not feed on itself.
  doc.works!.items = doc.works!.items.map((i) => (i.id === 'insurance' ? { ...i, rate: 0.4 } : i));
  assert.equal(computeBomCalc(doc).values['works.insurance.cost'], 36_997_854.58);
});

test('Every works key explains itself; a priced item with no row is flagged; an older calculation still opens', () => {
  const doc = newBomCalcDoc();
  doc.works = { ...crew1762(), items: newWorksDoc().items.map((i) => ({ ...i, rate: i.basis === 'percent' ? 0.2 : i.basis === 'wp' ? 1 : 10_000_000 })) };
  doc.rows[0] = { ...doc.rows[0], qty: { mode: 'typed', value: 100 }, cost: 1_000_000 };
  const res = computeBomCalc(doc);
  const keys = linkOptions(doc, res).filter((l) => l.tab === 'works');
  assert.ok(keys.some((l) => l.key === 'works.office.cost' && l.cost) && keys.some((l) => l.key === 'mp.mandays' && !l.cost));
  for (const { key } of keys) {
    const e = explainKey(doc, res.values, res.dc, res.ac, key, res.raceway, res.civil, res.works)!;
    assert.ok(e.rule, `${key} has a rule`);
    assert.ok(Math.abs(e.parts.reduce((a, p) => a + p.value, 0) - e.value) < 0.01, `${key}: the parts add up to the value`);
  }
  assert.deepEqual(unusedKeys(doc, res.values).filter((k) => k.startsWith('works.')), [], 'the standard layout reads every project-works item');

  doc.rows = doc.rows.filter((r) => r.costKey !== 'works.office.cost');
  assert.ok(computeBomCalc(doc).checks.some((c) => /Temporary site office/.test(c.where) && /no BOM row takes it/.test(c.message)));

  const old = newBomCalcDoc();
  delete old.works;
  const r2 = computeBomCalc(old);
  assert.equal(r2.values['works.months'], 4);
  assert.equal(r2.works.crossCheck?.labourCost, 0);
});
