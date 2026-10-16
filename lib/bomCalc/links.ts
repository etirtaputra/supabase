/**
 * What is linked to what, and how — so an engineer reviewing a calculation
 * can follow every number to where it came from (owner, 2026-10-12: "it is
 * important that the engineers knows what linked to what and how for easier
 * review").
 *
 * For every value a BOM row can read (a "key"):
 *   describeKey  — its name, the tab it is calculated on, its unit
 *   explainKey   — the rule in words and the parts that add up to it
 *                  (each roof, each segment, each inverter group)
 *   usageByKey   — the BOM rows that read it (the reverse direction)
 *   unusedKeys   — results that were calculated but no BOM row takes:
 *                  the "missing row" the Excel files never noticed
 *
 * Words are English here and translated where they are shown (useT), like
 * every other label in the app; roof and segment names are data and stay
 * as typed.
 */
import type { BomCalcDoc } from './index.ts';
import type { DcResult } from './dc.ts';
import type { AcResult } from './ac.ts';
import type { BomRow } from './bom.ts';
import { sizeLabel, type RacewayResult } from './raceway.ts';
import { STANDARD_OM_ITEMS, type CivilResult } from './civil.ts';
import { STANDARD_WORKS_ITEMS, type WorksResult } from './works.ts';

export type SourceTab = 'strings' | 'dc' | 'ac' | 'raceway' | 'civil' | 'works';

/** Keys that are a cost per unit (a BOM row's costKey), not a quantity. */
export const isCostKey = (key: string) => /^(rw\.tray\.costPerM|civil\.(walkway|lifeline)\.costPerM|om\.[^.]+\.perYear|works\.[^.]+\.cost)$/.test(key);

export interface KeyInfo {
  key: string;
  label: string;
  tab: SourceTab;
  unit: string;
}

export interface Explanation extends KeyInfo {
  value: number;
  /** The rule in words (translate it where it is shown). */
  rule: string;
  /** What adds up to the value — one line per roof / segment / group. */
  parts: { label: string; detail: string; value: number }[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Name, tab and unit of a key; null for a key this calculation cannot produce. */
export function describeKey(doc: BomCalcDoc, key: string): KeyInfo | null {
  const k = (label: string, tab: SourceTab, unit: string): KeyInfo => ({ key, label, tab, unit });
  if (key === 'pv.modules') return k('Modules', 'strings', 'pcs');
  if (key === 'pv.wp') return k('Plant size', 'strings', 'Wp');
  if (key === 'pv.kwp') return k('Plant size', 'strings', 'kWp');
  if (key === 'pv.strings') return k('Strings', 'strings', 'strings');
  if (key === 'inv.count') return k('Inverters (all)', 'strings', 'pcs');
  if (key === 'inv.kw') return k('Inverter AC power', 'strings', 'kW');
  let m = /^inv\.(.+)$/.exec(key);
  if (m) { const g = doc.inverterGroups.find((x) => x.id === m![1]); return g ? k(`Inverters: ${g.label || g.inverter.model}`, 'strings', 'pcs') : null; }
  m = /^dc\.cable\.(\d+)$/.exec(key);
  if (m) return k(`PV cable ${m[1]} mm²`, 'dc', 'm');
  m = /^dc\.connectors\.(\d+)$/.exec(key);
  if (m) return k(`PV connectors ${m[1]} mm`, 'dc', 'pairs');
  m = /^ac\.seg\.([^.]+)\.(phase|pe|lugs)$/.exec(key);
  if (m) {
    const s = doc.acSegments.find((x) => x.id === m![1]);
    if (!s) return null;
    if (m[2] === 'phase') return k(`${s.label}: ${s.cableType} ${s.sizeMm2}`, 'ac', 'm');
    if (m[2] === 'pe') return s.pe ? k(`${s.label}: earth ${s.pe.cableType} ${s.pe.sizeMm2}`, 'ac', 'm') : null;
    return k(`${s.label}: cable lugs`, 'ac', 'pcs');
  }
  m = /^ac\.cable\.(.+)$/.exec(key);
  if (m) return k(`${m[1]} (all AC segments)`, 'ac', 'm');
  m = /^ac\.lugs\.(\d+)$/.exec(key);
  if (m) return k(`Cable lugs ${m[1]} mm² incl. spares`, 'ac', 'pcs');
  const rw: Record<string, [string, string]> = {
    'rw.tray.m': ['Cable tray (all sizes)', 'm'], 'rw.tray.pieces': ['Tray pieces (all sizes)', 'pcs'],
    'rw.tray.covers': ['Tray covers', 'pcs'], 'rw.tray.clamps': ['Tray cover clamps', 'pcs'],
    'rw.tray.joints': ['Tray joints', 'pcs'], 'rw.tray.bolts': ['Tray joint bolts', 'pcs'],
    'rw.conduit': ['Flexible conduit', 'm'], 'rw.glands': ['Cable glands', 'pcs'], 'rw.labels': ['Labels', 'pcs'],
    'rw.ties': ['Cable ties', 'pcs'], 'rw.clips': ['Cable clips', 'pcs'],
  };
  if (rw[key]) return k(rw[key][0], 'raceway', rw[key][1]);
  m = /^rw\.tray\.(\d+x\d+)\.(m|pieces)$/.exec(key);
  if (m) return m[2] === 'm' ? k(`Cable tray ${sizeLabel(m[1])}`, 'raceway', 'm') : k(`Tray pieces ${sizeLabel(m[1])}`, 'raceway', 'pcs');
  if (key === 'rw.tray.costPerM') return k('Cable tray cost per metre', 'raceway', 'Rp/m');
  const cv: Record<string, [string, string]> = {
    'civil.walkway.m': ['Walkway', 'm'], 'civil.walkway.panels': ['Walkway panels', 'pcs'], 'civil.walkway.supports': ['Walkway supports', 'pcs'],
    'civil.walkway.costPerM': ['Walkway cost per metre', 'Rp/m'],
    'civil.lifeline.m': ['Lifeline', 'm'], 'civil.lifeline.endAnchors': ['Lifeline end anchors', 'pcs'], 'civil.lifeline.intAnchors': ['Lifeline intermediate anchors', 'pcs'],
    'civil.lifeline.costPerM': ['Lifeline cost per metre', 'Rp/m'],
    'civil.pipe.m': ['Water cleaning pipe', 'm'], 'civil.pump': ['Water pump and tank', 'sets'],
    'civil.pits': ['Grounding pits', 'pcs'], 'civil.stations': ['Inverter stations', 'sets'], 'om.years': ['O&M years in the price', 'years'],
  };
  if (cv[key]) return k(cv[key][0], 'civil', cv[key][1]);
  m = /^om\.([^.]+)\.(perYear|visits)$/.exec(key);
  if (m) {
    const it = (doc.civil?.om.items ?? STANDARD_OM_ITEMS).find((x) => x.id === m![1]);
    const name = it?.label || 'new item';
    return m[2] === 'perYear' ? k(`O&M: ${name}, cost per year`, 'civil', 'Rp/year') : k(`O&M: ${name}, visits`, 'civil', 'visits');
  }
  if (key === 'works.months') return k('Project duration', 'works', 'months');
  if (key === 'mp.mandays') return k('Crew man-days', 'works', 'man-days');
  m = /^works\.([^.]+)\.cost$/.exec(key);
  if (m) {
    const it = (doc.works?.items ?? STANDARD_WORKS_ITEMS).find((x) => x.id === m![1]);
    return k(`Project works: ${it?.label || 'new item'}`, 'works', 'Rp');
  }
  return null;
}

/** The rule and the parts behind one key, with today's value. */
export function explainKey(doc: BomCalcDoc, values: Record<string, number>, dc: DcResult, ac: AcResult, key: string, rw?: RacewayResult, cv?: CivilResult, wk?: WorksResult): Explanation | null {
  const info = describeKey(doc, key);
  if (!info) return null;
  const value = values[key] ?? 0;
  const out = (rule: string, parts: Explanation['parts'] = []): Explanation => ({ ...info, value, rule, parts });
  const groups = doc.inverterGroups;

  if (key === 'pv.modules') return out('Σ inverter groups: inverters × strings each × modules per string',
    groups.map((g) => ({ label: g.label || g.inverter.model, detail: `${g.count} × ${g.stringsEach} × ${g.modulesPerString}`, value: g.count * g.stringsEach * g.modulesPerString })));
  if (key === 'pv.strings') return out('Σ inverter groups: inverters × strings each',
    groups.map((g) => ({ label: g.label || g.inverter.model, detail: `${g.count} × ${g.stringsEach}`, value: g.count * g.stringsEach })));
  if (key === 'pv.wp' || key === 'pv.kwp') return out('Modules × module Wp',
    [{ label: doc.module.model || 'Module', detail: `${dc.modules} × ${doc.module.wp} Wp`, value: key === 'pv.wp' ? dc.wp : dc.wp / 1000 }]);
  if (key === 'inv.count' || key === 'inv.kw') return out(key === 'inv.count' ? 'Σ inverter groups: count' : 'Σ inverter groups: count × kW AC',
    groups.map((g) => ({ label: g.label || g.inverter.model, detail: key === 'inv.count' ? `${g.count}` : `${g.count} × ${g.inverter.acKw} kW`, value: key === 'inv.count' ? g.count : g.count * g.inverter.acKw })));
  if (/^inv\./.test(key)) { const g = groups.find((x) => `inv.${x.id}` === key); return out('Inverters in this group', g ? [{ label: g.label || g.inverter.model, detail: `${g.count}`, value: g.count }] : []); }

  let m = /^dc\.(cable|connectors)\.(\d+)$/.exec(key);
  if (m) {
    const size = Number(m[2]);
    const slack = doc.dc.slackPct;
    const parts = dc.roofs.filter((r) => r.size === size).map((r) => {
      const roof = doc.roofs.find((x) => x.id === r.id);
      const n = roof?.strings ?? 0;
      return m![1] === 'cable'
        ? { label: r.label || 'Roof', detail: `(${roof?.distanceM ?? 0} + ${roof?.runM ?? 0}) × 2 × ${n}${slack ? ` × ${1 + slack / 100}` : ''}`, value: r.cableM }
        : { label: r.label || 'Roof', detail: `${n} × (1 + ${doc.dc.jumpersPerString})`, value: r.connectorPairs };
    });
    return m[1] === 'cable'
      ? out(slack ? 'Σ roofs on this size: (distance + string run) × 2 × strings × (1 + extra %)' : 'Σ roofs on this size: (distance + string run) × 2 × strings', parts)
      : out('Σ roofs on this size: strings × (1 end pair + jumpers per string)', parts);
  }

  m = /^ac\.seg\.([^.]+)\.(phase|pe|lugs)$/.exec(key);
  if (m) {
    const s = doc.acSegments.find((x) => x.id === m![1])!;
    const per = `${s.lengthM} + ${s.tailM}`;
    if (m[2] === 'phase') return out('Circuits × (route length + extra per conductor) × (3 phases × runs + neutrals)',
      [{ label: s.label, detail: `${s.circuits} × (${per}) × (3 × ${s.runs} + ${s.neutrals})`, value }]);
    if (m[2] === 'pe') return out('Circuits × (route length + extra per conductor) × earth conductors per circuit',
      [{ label: s.label, detail: `${s.circuits} × (${per}) × ${s.pe?.count ?? 0}`, value }]);
    return out('Conductors × 2 ends', [{ label: s.label, detail: `${s.circuits} × (3 × ${s.runs} + ${s.neutrals}) × 2`, value }]);
  }
  m = /^ac\.cable\.(\S+) (\d+)$/.exec(key);
  if (m) {
    const parts = ac.segments.flatMap((r) => {
      const seg = doc.acSegments.find((x) => x.id === r.id);
      const out2: Explanation['parts'] = [];
      if (r.cable === `${m![1]} ${m![2]}`) out2.push({ label: r.label, detail: 'phase + neutral', value: r2(r.phaseM + r.neutralM) });
      if (r.peCable === `${m![1]} ${m![2]}`) out2.push({ label: r.label, detail: `earth${seg?.pe ? ` × ${seg.pe.count}` : ''}`, value: r.peM });
      return out2;
    });
    return out('Σ every AC segment that uses this cable', parts);
  }
  m = /^ac\.lugs\.(\d+)$/.exec(key);
  if (m) {
    const size = Number(m[1]);
    const parts: Explanation['parts'] = [];
    for (const s of doc.acSegments) {
      if (s.sizeMm2 === size) parts.push({ label: s.label, detail: `${s.circuits} × (3 × ${s.runs} + ${s.neutrals}) × 2`, value: s.circuits * (3 * Math.max(1, s.runs) + s.neutrals) * 2 });
      if (s.pe && s.pe.sizeMm2 === size) parts.push({ label: `${s.label} (earth)`, detail: `${s.circuits} × ${s.pe.count} × 2`, value: s.circuits * s.pe.count * 2 });
    }
    parts.push({ label: 'Spares', detail: `+${doc.ac.spareLugs}`, value: doc.ac.spareLugs });
    return out('Σ conductors of this size × 2 ends, plus spares', parts);
  }
  if (key.startsWith('rw.') && rw) return explainRaceway(rw, key, out);
  if ((key.startsWith('civil.') || key.startsWith('om.')) && cv) return explainCivil(cv, key, out);
  if ((key.startsWith('works.') || key.startsWith('mp.')) && wk) return explainWorks(doc, wk, values, key, out);
  return out('');
}

/** The raceway keys: the rule, and one part per tray run or per count. */
function explainRaceway(rw: RacewayResult, key: string, out: (rule: string, parts?: Explanation['parts']) => Explanation): Explanation {
  const st = rw.settings;
  const stick = st.stickM;
  const label = (r: { label: string }) => r.label || 'Tray run';
  const bySize = /^rw\.tray\.(\d+x\d+)\.(m|pieces)$/.exec(key);
  const runs = rw.trays.filter((r) => r.lengthM > 0 && (!bySize || r.size === bySize[1]));
  if (key === 'rw.tray.m' || bySize?.[2] === 'm') {
    return out(bySize ? 'Σ tray runs of this size: route length' : 'Σ tray runs: route length',
      runs.map((r) => ({ label: label(r), detail: r.size ? sizeLabel(r.size) : '—', value: r.lengthM })));
  }
  if (key === 'rw.tray.pieces' || bySize?.[2] === 'pieces') {
    return out(bySize ? 'Σ tray runs of this size: ROUNDUP(length ÷ stick length)' : 'Σ tray runs: ROUNDUP(length ÷ stick length)',
      runs.map((r) => ({ label: label(r), detail: `ROUNDUP(${r.lengthM} ÷ ${stick})`, value: r.pieces })));
  }
  if (key === 'rw.tray.covers') return out('One cover per tray piece', runs.map((r) => ({ label: label(r), detail: `${r.pieces}`, value: r.covers })));
  if (key === 'rw.tray.clamps') return out('Covers × clamps per cover', runs.map((r) => ({ label: label(r), detail: `${r.covers} × ${st.clampsPerCover}`, value: r.clamps })));
  if (key === 'rw.tray.joints') return out('Tray pieces × joints per piece', runs.map((r) => ({ label: label(r), detail: `${r.pieces} × ${st.jointsPerPiece}`, value: r.joints })));
  if (key === 'rw.tray.bolts') return out('Joints × bolts per joint', runs.map((r) => ({ label: label(r), detail: `${r.joints} × ${st.boltsPerJoint}`, value: r.bolts })));
  if (key === 'rw.tray.costPerM') return out('Σ tray runs: pieces × (stick + cover) + clamps, joints and bolts × their cost, ÷ tray metres',
    runs.map((r) => ({ label: label(r), detail: r.size ? `${r.pieces} × ${sizeLabel(r.size)}` : '—', value: rw.trayM > 0 && r.cost != null ? r2(r.cost / rw.trayM) : 0 })));
  const strings = rw.counts.strings, inverters = rw.counts.inverters, modules = rw.counts.modules;
  if (key === 'rw.conduit') return out('Strings × metres per string + inverters × metres per inverter', [
    { label: 'Strings', detail: `${strings} × ${st.conduitPerStringM} m`, value: r2(strings * st.conduitPerStringM) },
    { label: 'Inverters', detail: `${inverters} × ${st.conduitPerInverterM} m`, value: r2(inverters * st.conduitPerInverterM) },
  ]);
  if (key === 'rw.glands') return out('ROUNDUP(strings × glands per string) + inverters × glands per inverter', [
    { label: 'Strings', detail: `ROUNDUP(${strings} × ${st.glandsPerString})`, value: Math.ceil(strings * st.glandsPerString - 1e-9) },
    { label: 'Inverters', detail: `${inverters} × ${st.glandsPerInverter}`, value: Math.ceil(inverters * st.glandsPerInverter - 1e-9) },
  ]);
  if (key === 'rw.labels') return out('Strings × labels per string + inverters × labels per inverter + AC circuits × labels per circuit + extra', [
    { label: 'Strings', detail: `${strings} × ${st.labelsPerString}`, value: r2(strings * st.labelsPerString) },
    { label: 'Inverters', detail: `${inverters} × ${st.labelsPerInverter}`, value: r2(inverters * st.labelsPerInverter) },
    { label: 'AC circuits', detail: `${rw.acCircuits} × ${st.labelsPerAcCircuit}`, value: r2(rw.acCircuits * st.labelsPerAcCircuit) },
    { label: 'Extra', detail: `+${st.labelsExtra}`, value: st.labelsExtra },
  ]);
  if (key === 'rw.ties') return out('ROUNDUP(modules × ties per module)', [{ label: 'Modules', detail: `${modules} × ${st.tiesPerModule}`, value: rw.ties }]);
  if (key === 'rw.clips') return out('ROUNDUP(modules × clips per module)', [{ label: 'Modules', detail: `${modules} × ${st.clipsPerModule}`, value: rw.clips }]);
  return out('');
}

/** The civil and O&M keys: the recipe, and one part per area, per part or per year. */
function explainCivil(cv: CivilResult, key: string, out: (rule: string, parts?: Explanation['parts']) => Explanation): Explanation {
  const st = cv.settings;
  const areas = cv.areas;
  const name = (a: { label: string }) => a.label || 'Area';
  const w = st.wasteFactor;
  if (key === 'civil.walkway.m') return out('Σ areas: walkway metres off the layout × waste factor',
    areas.filter((a) => a.walkwayM > 0).map((a) => ({ label: name(a), detail: `× ${w}`, value: a.walkwayM })));
  if (key === 'civil.walkway.panels') return out('Σ areas: ROUNDUP(walkway metres ÷ panel length)',
    areas.filter((a) => a.walkwayM > 0).map((a) => ({ label: name(a), detail: `ROUNDUP(${a.walkwayM} ÷ ${st.walkwayPanelM})`, value: a.walkwayPanels })));
  if (key === 'civil.walkway.supports') return out('Walkway panels × supports per panel', [{ label: 'Panels', detail: `${cv.walkwayPanels} × ${st.supportsPerPanel}`, value: cv.walkwaySupports }]);
  if (key === 'civil.walkway.costPerM') {
    const m = cv.walkwayM || 1;
    return out('(Panels × panel cost + supports × support cost) ÷ walkway metres', [
      { label: 'Panels', detail: `${cv.walkwayPanels} × ${st.walkwayPanelCost ?? '—'} ÷ ${cv.walkwayM}`, value: r2(cv.walkwayPanels * (st.walkwayPanelCost ?? 0) / m) },
      { label: 'Supports', detail: `${cv.walkwaySupports} × ${st.walkwaySupportCost ?? '—'} ÷ ${cv.walkwayM}`, value: r2(cv.walkwaySupports * (st.walkwaySupportCost ?? 0) / m) },
    ]);
  }
  if (key === 'civil.lifeline.m') return out('Σ areas: lifeline metres off the layout × waste factor',
    areas.filter((a) => a.lifelineM > 0).map((a) => ({ label: name(a), detail: `× ${w}`, value: a.lifelineM })));
  if (key === 'civil.lifeline.endAnchors') return out('Σ areas: ROUNDUP(layout metres ÷ end-anchor spacing)',
    areas.filter((a) => a.endAnchors > 0).map((a) => ({ label: name(a), detail: `ROUNDUP(L ÷ ${st.lifelineEndEveryM})`, value: a.endAnchors })));
  if (key === 'civil.lifeline.intAnchors') return out('Σ areas: ROUNDUP(layout metres ÷ intermediate spacing) − end anchors',
    areas.filter((a) => a.intAnchors > 0).map((a) => ({ label: name(a), detail: `ROUNDUP(L ÷ ${st.lifelineIntEveryM}) − ${a.endAnchors}`, value: a.intAnchors })));
  if (key === 'civil.lifeline.costPerM') {
    const m = cv.lifelineM || 1;
    return out('(Wire metres × wire cost + anchors × anchor cost) ÷ lifeline metres', [
      { label: 'Wire', detail: `${cv.lifelineM} × ${st.lifelineWireCostPerM ?? '—'} ÷ ${cv.lifelineM}`, value: r2(cv.lifelineM * (st.lifelineWireCostPerM ?? 0) / m) },
      { label: 'End anchors', detail: `${cv.endAnchors} × ${st.lifelineEndAnchorCost ?? '—'} ÷ ${cv.lifelineM}`, value: r2(cv.endAnchors * (st.lifelineEndAnchorCost ?? 0) / m) },
      { label: 'Intermediate anchors', detail: `${cv.intAnchors} × ${st.lifelineIntAnchorCost ?? '—'} ÷ ${cv.lifelineM}`, value: r2(cv.intAnchors * (st.lifelineIntAnchorCost ?? 0) / m) },
    ]);
  }
  if (key === 'civil.pipe.m') return out('Σ areas: pipe metres off the layout × waste factor',
    areas.filter((a) => a.pipeM > 0).map((a) => ({ label: name(a), detail: `× ${w}`, value: a.pipeM })));
  if (key === 'civil.pump') return out('Pump and tank sets where there is water pipe', [{ label: 'Sets', detail: cv.pipeM > 0 ? `${st.pumpSets}` : '0 (no pipe)', value: cv.pumps }]);
  if (key === 'civil.pits') return out('Inverters × pits per inverter + extra pits', [
    { label: 'Inverters', detail: `${cv.inputs.inverters} × ${st.pitsPerInverter}`, value: r2(cv.inputs.inverters * st.pitsPerInverter) },
    { label: 'Extra', detail: `+${st.pitsExtra}`, value: st.pitsExtra },
  ]);
  if (key === 'civil.stations') return out('ROUNDUP(inverters ÷ inverters per station)', [{ label: 'Inverters', detail: `ROUNDUP(${cv.inputs.inverters} ÷ ${st.invertersPerStation})`, value: cv.stations }]);
  if (key === 'om.years') return out('Years of O&M included in the price', [{ label: 'Years', detail: `${cv.om.includedYears}`, value: cv.om.includedYears }]);
  const m = /^om\.([^.]+)\.(perYear|visits)$/.exec(key);
  const it = m ? cv.om.items.find((x) => x.id === m[1]) : null;
  if (m && it) {
    const esc = cv.omSettings.escalationPct;
    if (m[2] === 'visits') return out('Visits a year × included years', [{ label: it.label, detail: `${it.visits / Math.max(1, cv.om.includedYears)} × ${cv.om.includedYears}`, value: it.visits }]);
    // The average year: the parts are each year's share, so they add up to it.
    const n = Math.max(1, it.years.length);
    return out(esc ? 'Average of the included years, each a year-1 cost raised by the escalation' : 'Average of the included years', it.years.map((y, i) => ({
      label: `Year ${i + 1}`, detail: `${y.toLocaleString('en-US')} ÷ ${n}`, value: r2(y / n),
    })));
  }
  return out('');
}

/** The project-works and crew keys: the basis of each item, the roles behind the man-days. */
function explainWorks(doc: BomCalcDoc, wk: WorksResult, values: Record<string, number>, key: string, out: (rule: string, parts?: Explanation['parts']) => Explanation): Explanation {
  if (key === 'works.months') return out('Project duration in months', [{ label: 'Months', detail: `${wk.months}`, value: wk.months }]);
  if (key === 'mp.mandays') return out('Σ crew roles: people × days', wk.crew.filter((c) => c.manDays > 0).map((c) => ({
    label: c.label || 'Role', detail: `× ${c.days} days`, value: c.manDays,
  })));
  const m = /^works\.([^.]+)\.cost$/.exec(key);
  const it = m ? (doc.works?.items ?? STANDARD_WORKS_ITEMS).find((x) => x.id === m[1]) : null;
  if (!it) return out('');
  const r = it.rate ?? 0;
  const v = values[key] ?? 0;
  const label = it.label || 'Item';
  if (it.basis === 'month') return out('Rate a month × project months', [{ label, detail: `${r.toLocaleString('en-US')} × ${wk.months}`, value: v }]);
  if (it.basis === 'wp') return out('Rate per Wp × plant Wp', [{ label, detail: `${r} × ${wk.inputs.plantWp.toLocaleString('en-US')}`, value: v }]);
  if (it.basis === 'percent') return out('Rate % × the total of every row that is not itself a percentage', [{ label, detail: `${r} %`, value: v }]);
  return out('Lump sum', [{ label, detail: '', value: v }]);
}

/** key → the BOM rows that read it, for their quantity or their cost. */
export function usageByKey(rows: BomRow[]): Map<string, BomRow[]> {
  const map = new Map<string, BomRow[]>();
  const add = (key: string, r: BomRow) => { const list = map.get(key) ?? []; if (!list.includes(r)) list.push(r); map.set(key, list); };
  for (const r of rows) {
    if (r.qty.mode === 'link') add(r.qty.key, r);
    if (r.costKey) add(r.costKey, r);
  }
  return map;
}

/**
 * Results that were calculated (non-zero) but that no BOM row reads — cable
 * designed and never priced. The material totals are what a quote is made
 * of, so these are the keys that must land somewhere. Lugs and the aggregate
 * per-cable keys are left out: they are usually priced inside a lump row.
 */
export function unusedKeys(doc: BomCalcDoc, values: Record<string, number>): string[] {
  const used = usageByKey(doc.rows);
  const out: string[] = [];
  const wanted = ['pv.modules', ...[4, 6, 10, 16].flatMap((s) => [`dc.cable.${s}`, `dc.connectors.${s}`]),
    ...doc.acSegments.flatMap((s) => [`ac.seg.${s.id}.phase`, `ac.seg.${s.id}.pe`]),
    'rw.tray.m', 'rw.conduit', 'rw.glands', 'rw.labels', 'rw.ties', 'rw.clips',
    'civil.walkway.m', 'civil.lifeline.m', 'civil.pipe.m', 'civil.pump', 'civil.pits',
    // A priced O&M item must reach a row's cost, or it is offered and never charged.
    ...(doc.civil?.om.items ?? STANDARD_OM_ITEMS).map((i) => `om.${i.id}.perYear`),
    // A priced project-works item must reach a row, or it is costed and never sold.
    ...(doc.works?.items ?? STANDARD_WORKS_ITEMS).map((i) => `works.${i.id}.cost`)];
  for (const k of wanted) {
    if ((values[k] ?? 0) <= 0) continue;
    if (used.has(k)) continue;
    // A segment's cable is also covered when a row reads the per-cable total it belongs to.
    const seg = /^ac\.seg\.([^.]+)\.(phase|pe)$/.exec(k);
    if (seg) {
      const s = doc.acSegments.find((x) => x.id === seg[1]);
      const cable = seg[2] === 'pe' ? (s?.pe ? `${s.pe.cableType} ${s.pe.sizeMm2}` : '') : (s ? `${s.cableType} ${s.sizeMm2}` : '');
      if (cable && used.has(`ac.cable.${cable}`)) continue;
    }
    // Tray metres are also covered when every size in use is read by a per-size row.
    if (k === 'rw.tray.m') {
      const sized = Object.keys(values).filter((v) => /^rw\.tray\.\d+x\d+\.m$/.test(v) && values[v] > 0);
      const sizedM = sized.reduce((a, v) => a + values[v], 0);
      if (sized.length && sized.every((v) => used.has(v)) && Math.abs(sizedM - values[k]) < 0.01) continue;
    }
    out.push(k);
  }
  return out;
}
