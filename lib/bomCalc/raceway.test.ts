/**
 * Cable raceway — tests of the method recorded from the 2026-10 workbooks
 * (docs/epc-bom/WORKBOOK_STUDY.md §2–3: Hon Chuan 'Tray DCAC', DMST 'DC Tray'
 * / 'Tray AC'). The counts use the Hon Chuan plant as the study records it —
 * 180 strings, 9 inverters, 4,860 modules, 1,159 m + 40 m of DC tray.
 *
 * The workbooks themselves were not available to the thread that wrote
 * these, so the numbers below are the recorded rules applied to the recorded
 * quantities, not cells read off the tray sheets. When the sheets are back,
 * check each one against them — and never change a number here to make a
 * build pass.
 *
 * Cable outer diameters in these tests are test inputs, not catalogue claims.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateRaceway, cableCount, newRacewayDoc, type RacewayDoc, type TrayRun } from './raceway.ts';
import { computeBomCalc, newBomCalcDoc, linkOptions, type BomCalcDoc } from './index.ts';
import { explainKey, unusedKeys } from './links.ts';
import type { RoofRun, InverterGroup, ModuleSpec } from './dc.ts';

const HC = { strings: 180, inverters: 9, modules: 4860, roofs: [] as RoofRun[], acSegments: [] };
const run = (id: string, lengthM: number, over: Partial<TrayRun> = {}): TrayRun =>
  ({ id, label: id, lengthM, size: '300x100', cables: [], ...over });

test('Hon Chuan counts read the 180 strings, not the inverter list typed twice (360)', () => {
  const r = calculateRaceway(newRacewayDoc(), HC);
  assert.equal(r.conduitM, 378, '180 × 2 m + 9 × 2 m — the doubled list gave 738 m');
  assert.equal(r.glands, 270, 'ROUNDUP(180 × 1.2) + 9 × 6 — the doubled list gave 486');
  assert.equal(r.clips, 5832, 'ROUNDUP(4,860 × 1.2)');
  // 14 per string on THIS plant's 180 strings (the sheet used another job's 96)
  // + 10 per inverter + 2 per AC circuit (none here) + 50.
  assert.equal(r.labels, 180 * 14 + 9 * 10 + 50);
  assert.equal(r.ties, 9720);
});

test('Hon Chuan DC tray 1,159 m + 40 m: pieces, covers, clamps, joints, bolts', () => {
  const rw: RacewayDoc = { ...newRacewayDoc(), trays: [run('DC main', 1159), run('DC branch', 40)] };
  const r = calculateRaceway(rw, HC);
  assert.equal(r.trayM, 1199);
  assert.deepEqual(r.trays.map((t) => t.pieces), [387, 14], 'ROUNDUP(1,159 ÷ 3), ROUNDUP(40 ÷ 3)');
  assert.equal(r.pieces, 401);
  assert.equal(r.covers, 401);
  assert.equal(r.clamps, 802);
  assert.equal(r.joints, 802);
  assert.equal(r.bolts, 6416);
  assert.deepEqual(r.bySize['300x100'], { m: 1199, pieces: 401 });
});

test('Fill ratio picks the smallest tray within 40 %, and says when a size is overfilled', () => {
  // 180 strings = 360 PV conductors at an assumed 7.0 mm OD:
  // 360 × π × 3.5² = 13,854 mm² → ÷ 0.40 = 34,636 mm² → 300 × 100 (30,000) is too small, 400 × 100 fits.
  const pv = { id: 'pv', label: 'PV 6 mm²', source: { kind: 'typed' as const, count: 360 }, odMm: 7 };
  const rw: RacewayDoc = { ...newRacewayDoc(), trays: [run('DC', 100, { size: 'auto', cables: [pv] })] };
  const r = calculateRaceway(rw, HC);
  assert.equal(r.trays[0].size, '400x100');
  assert.equal(r.trays[0].fillPct, 34.64);
  assert.equal(r.trays[0].cableAreaMm2, 13854.42);

  const fixed = calculateRaceway({ ...rw, trays: [run('DC', 100, { size: '300x100', cables: [pv] })] }, HC);
  assert.equal(fixed.trays[0].fillPct, 46.18);
  assert.ok(fixed.checks.some((c) => c.level === 'error' && /above 40 %/.test(c.message)));

  const none = calculateRaceway({ ...rw, trays: [run('DC', 100, { size: 'auto', cables: [{ ...pv, source: { kind: 'typed', count: 4000 } }] })] }, HC);
  assert.equal(none.trays[0].size, null);
  assert.ok(none.checks.some((c) => c.level === 'error' && /No tray in the size table/.test(c.message)));
});

test('A missing outer diameter is said out loud — the run is neither checked nor sized', () => {
  const rw: RacewayDoc = { ...newRacewayDoc(), trays: [run('AC', 50, { size: 'auto', cables: [{ id: 'c', label: 'NYY 185', source: { kind: 'typed', count: 15 }, odMm: null }] })] };
  const r = calculateRaceway(rw, HC);
  assert.equal(r.trays[0].size, null);
  assert.equal(r.trays[0].fillPct, null);
  assert.ok(r.checks.some((c) => c.level === 'warn' && /No outer diameter for NYY 185/.test(c.message)));
  assert.equal(r.trayCost, null, 'an unsized run has no price');
});

test('Tray cables read their count from the roofs and AC segments', () => {
  const roofs: RoofRun[] = [{ id: 'f1', label: 'Roof A', strings: 13, modulesPerString: null, distanceM: 340, runM: 56, size: 6 }];
  const doc = newBomCalcDoc();
  const inp = { roofs, acSegments: doc.acSegments.map((s) => (s.id === 'inv' ? { ...s, circuits: 5, runs: 1, neutrals: 0 } : s)) };
  assert.equal(cableCount({ kind: 'roof', roofId: 'f1' }, inp).count, 26, '+ and − per string');
  assert.equal(cableCount({ kind: 'seg', segId: 'inv', part: 'phase' }, inp).count, 15, '5 circuits × 3 phases');
  assert.equal(cableCount({ kind: 'seg', segId: 'inv', part: 'pe' }, inp).count, 5);
  assert.match(cableCount({ kind: 'roof', roofId: 'gone' }, inp).error ?? '', /no longer exists/);
});

test('The blended tray cost per metre comes from the stick-price table', () => {
  const rw = newRacewayDoc();
  rw.sizes = rw.sizes.map((s) => (s.widthMm === 300 && s.heightMm === 100 ? { ...s, stickCost: 600_000, coverCost: 300_000 } : s));
  rw.settings = { ...rw.settings, clampCost: 2_000, jointCost: 10_000, boltCost: 1_000 };
  rw.trays = [run('DC', 30)];
  const r = calculateRaceway(rw, HC);
  // 10 pieces × 900,000 + 20 clamps × 2,000 + 20 joints × 10,000 + 160 bolts × 1,000
  assert.equal(r.trayCost, 9_400_000);
  assert.equal(r.costPerM, 313_333.33);

  const unpriced = calculateRaceway({ ...rw, sizes: newRacewayDoc().sizes }, HC);
  assert.equal(unpriced.costPerM, null);
  assert.ok(unpriced.checks.some((c) => c.where === 'Tray 300 × 100' && /No stick cost/.test(c.message)));
});

// ── Through the whole document ───────────────────────────────────────────────
const TRINA_725: ModuleSpec = { model: 'TRINA TSM-725NEG21C.20', wp: 725, vocV: 49.6, vmpV: 41.5, iscA: 18.54, impA: 17.47, tempCoeffVocPct: -0.24, maxSystemV: 1500 };
const HUAWEI_330 = { model: 'SUN2000-330KTL-H1', acKw: 330, acVoltageV: 800, acCurrentA: 238.2, maxDcV: 1500, mpptMinV: 500, mpptMaxV: 1500, mppts: 6, stringsPerMppt: 5, maxIscPerMpptA: 120 };
const groups: (InverterGroup & { componentId: null })[] = [{ id: 'g1', label: 'INV 1–9', inverter: HUAWEI_330, count: 9, stringsEach: 20, modulesPerString: 27, componentId: null }];
const hcDoc = (): BomCalcDoc => {
  const doc = newBomCalcDoc();
  doc.module = { ...TRINA_725, componentId: null };
  doc.inverterGroups = groups;
  return doc;
};

test('The standard layout links its raceway rows, and every raceway key explains itself', () => {
  const doc = hcDoc();
  doc.raceway!.trays = [run('DC main', 1159), run('DC branch', 40)];
  const res = computeBomCalc(doc);
  const qty = (desc: RegExp) => res.rows.find((r) => desc.test(doc.rows.find((x) => x.id === r.id)!.description))!.qty;
  assert.equal(qty(/^HDG cable tray/), 1199);
  assert.equal(qty(/^Flexible metal conduit/), 378);
  assert.equal(qty(/^Cable gland/), 270);
  assert.equal(qty(/^Solar cable hangers/), 5832);
  assert.deepEqual(unusedKeys(doc, res.values).filter((k) => k.startsWith('rw.')), []);

  const keys = linkOptions(doc, res).filter((l) => l.tab === 'raceway').map((l) => l.key);
  assert.ok(keys.includes('rw.tray.300x100.m') && keys.includes('rw.labels'));
  for (const k of keys) {
    const e = explainKey(doc, res.values, res.dc, res.ac, k, res.raceway)!;
    assert.ok(e.rule, `${k} has a rule`);
    assert.equal(Math.round(e.parts.reduce((a, p) => a + p.value, 0) * 100) / 100, e.value, `${k}: the parts add up to the value`);
  }
});

test('Tray metres no row takes are flagged; a calculation saved before the raceway still opens', () => {
  const doc = hcDoc();
  doc.raceway!.trays = [run('DC main', 1159)];
  doc.rows = doc.rows.filter((r) => !(r.qty.mode === 'link' && r.qty.key === 'rw.tray.m'));
  const res = computeBomCalc(doc);
  assert.ok(res.checks.some((c) => c.where === 'Cable tray (all sizes)' && /no BOM row takes it/.test(c.message)));

  const old = hcDoc();
  delete old.raceway;
  const r2 = computeBomCalc(old);
  assert.equal(r2.values['rw.tray.m'], 0);
  assert.equal(r2.values['rw.glands'], 270);
});
