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

export type SourceTab = 'strings' | 'dc' | 'ac';

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
  return null;
}

/** The rule and the parts behind one key, with today's value. */
export function explainKey(doc: BomCalcDoc, values: Record<string, number>, dc: DcResult, ac: AcResult, key: string): Explanation | null {
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
  return out('');
}

/** key → the BOM rows that read it. */
export function usageByKey(rows: BomRow[]): Map<string, BomRow[]> {
  const map = new Map<string, BomRow[]>();
  for (const r of rows) {
    if (r.qty.mode !== 'link') continue;
    const list = map.get(r.qty.key) ?? [];
    list.push(r);
    map.set(r.qty.key, list);
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
    ...doc.acSegments.flatMap((s) => [`ac.seg.${s.id}.phase`, `ac.seg.${s.id}.pe`])];
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
    out.push(k);
  }
  return out;
}
