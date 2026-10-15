'use client';
/**
 * BOM Calculator — the Civil & O&M tab: walkway, lifeline and water-cleaning
 * metres per area with their per-metre recipes, grounding pits and inverter
 * stations, and the O&M years with escalation (lib/bomCalc/civil.ts).
 */
import React from 'react';
import { useT } from '@/hooks/useT';
import { fmtRp } from '@/lib/formatters';
import { civilOf, type BomCalcDoc, type BomCalcResult, type BomRow } from '@/lib/bomCalc';
import type { CivilArea, CivilDoc, CivilSettings, OmItem, OmSettings } from '@/lib/bomCalc/civil';
import { linkedRow } from '@/lib/bomCalc/template';
import type { Explanation } from '@/lib/bomCalc/links';
import { NumField, TextField, Labeled, Card, CELL, SMALL_BTN, DEL_BTN } from './Fields';
import { fmtN, LinkLines } from './LinkBits';

let uid = 0;
const newId = (p: string) => `${p}${Date.now().toString(36)}${(uid++).toString(36)}`;

export function CivilTab({ doc, res, edit, explain, usage, onGo }: {
  doc: BomCalcDoc; res: BomCalcResult; edit: (fn: (d: BomCalcDoc) => BomCalcDoc) => void;
  explain: (key: string) => Explanation | null; usage: Map<string, BomRow[]>; onGo: (rowId: string) => void;
}) {
  const { t, tf } = useT();
  const cv = civilOf(doc);
  const cr = res.civil;
  const st = cv.settings;
  const os = cv.om.settings;

  const setCv = (fn: (c: CivilDoc) => CivilDoc) => edit((d) => ({ ...d, civil: fn(civilOf(d)) }));
  const setSt = (p: Partial<CivilSettings>) => setCv((c) => ({ ...c, settings: { ...c.settings, ...p } }));
  const setArea = (id: string, p: Partial<CivilArea>) => setCv((c) => ({ ...c, areas: c.areas.map((a) => (a.id === id ? { ...a, ...p } : a)) }));
  const setOs = (p: Partial<OmSettings>) => setCv((c) => ({ ...c, om: { ...c.om, settings: { ...c.om.settings, ...p } } }));
  const setItem = (id: string, p: Partial<OmItem>) => setCv((c) => ({ ...c, om: { ...c.om, items: c.om.items.map((i) => (i.id === id ? { ...i, ...p } : i)) } }));

  /** One area per DC roof that has none yet — the roofs are already named on the DC tab. */
  const missingRoofs = doc.roofs.filter((r) => r.label && !cv.areas.some((a) => a.label === r.label));
  /** A new O&M item comes with its BOM row, linked both ways, so it cannot be offered and left unpriced. */
  const addItem = () => {
    const id = newId('o');
    edit((d) => {
      const c = civilOf(d);
      return {
        ...d,
        civil: { ...c, om: { ...c.om, items: [...c.om.items, { id, label: '', basis: 'year', rate: null, visitsPerYear: 0 }] } },
        rows: [...d.rows, { ...linkedRow('om', '', 'year', 'om.years'), costKey: `om.${id}.perYear` }],
      };
    });
  };
  const removeItem = (id: string) => edit((d) => {
    const c = civilOf(d);
    return {
      ...d,
      civil: { ...c, om: { ...c.om, items: c.om.items.filter((i) => i.id !== id) } },
      rows: d.rows.filter((r) => r.costKey !== `om.${id}.perYear`),
    };
  });

  const civilKeys = ['civil.walkway.m', 'civil.walkway.panels', 'civil.walkway.supports', 'civil.walkway.costPerM',
    'civil.lifeline.m', 'civil.lifeline.endAnchors', 'civil.lifeline.intAnchors', 'civil.lifeline.costPerM', 'civil.pipe.m', 'civil.pump'];
  const omKeys = ['om.years', ...cr.om.items.flatMap((i) => [`om.${i.id}.visits`, `om.${i.id}.perYear`])];

  return (
    <div className="space-y-4">
      {/* ── Walkway, lifeline, water cleaning ── */}
      <Card title={t('Walkway, lifeline and water cleaning')} action={
        <div className="flex flex-wrap gap-1.5">
          {missingRoofs.length > 0 && (
            <button className={SMALL_BTN} onClick={() => setCv((c) => ({ ...c, areas: [...c.areas, ...missingRoofs.map((r) => ({ id: newId('a'), label: r.label, walkwayM: 0, lifelineM: 0, pipeM: 0 }))] }))}>
              {tf('+ One area per roof ({n})', { n: missingRoofs.length })}
            </button>
          )}
          <button className={SMALL_BTN} onClick={() => setCv((c) => ({ ...c, areas: [...c.areas, { id: newId('a'), label: '', walkwayM: 0, lifelineM: 0, pipeM: 0 }] }))}>{t('+ Area')}</button>
        </div>}>
        <p className="text-[11px] text-slate-500">{t('Metres per area off the layout; the calculator adds the waste factor. Walkway panels = ROUNDUP(metres ÷ panel length). Lifeline anchors: end = ROUNDUP(length ÷ end spacing), intermediate = ROUNDUP(length ÷ intermediate spacing) − end. The parts turn into one cost per metre that the BOM row reads, over the same metres it buys.')}</p>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <Labeled label={t('Waste factor')}><NumField value={st.wasteFactor} onChange={(v) => setSt({ wasteFactor: v ?? 1 })} /></Labeled>
          <Labeled label={t('Panel length (m)')}><NumField value={st.walkwayPanelM} onChange={(v) => setSt({ walkwayPanelM: v ?? 2.4 })} /></Labeled>
          <Labeled label={t('Supports per panel')}><NumField value={st.supportsPerPanel} onChange={(v) => setSt({ supportsPerPanel: v ?? 0 })} /></Labeled>
          <Labeled label={t('End anchor every (m)')}><NumField value={st.lifelineEndEveryM} onChange={(v) => setSt({ lifelineEndEveryM: v ?? 30 })} /></Labeled>
          <Labeled label={t('Intermediate anchor every (m)')}><NumField value={st.lifelineIntEveryM} onChange={(v) => setSt({ lifelineIntEveryM: v ?? 6 })} /></Labeled>
          <Labeled label={t('Pump and tank sets')}><NumField value={st.pumpSets} onChange={(v) => setSt({ pumpSets: v ?? 0 })} /></Labeled>
        </div>
        {cv.areas.length === 0 ? <p className="text-xs text-slate-500 italic">{t('No areas yet.')}</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[760px]">
              <thead><tr className="text-[10px] uppercase tracking-wider text-slate-500">
                <th className="text-left py-1 pr-2">{t('Area')}</th>
                <th className="text-right px-1 w-28">{t('Walkway (m)')}</th><th className="text-right px-1 w-28">{t('Lifeline (m)')}</th><th className="text-right px-1 w-28">{t('Water pipe (m)')}</th>
                <th className="text-left px-2">{t('Result')}</th><th className="w-6" />
              </tr></thead>
              <tbody>
                {cv.areas.map((a) => {
                  const ar = cr.areas.find((x) => x.id === a.id);
                  return (
                    <tr key={a.id}>
                      <td className="py-1 pr-2"><TextField value={a.label} onChange={(v) => setArea(a.id, { label: v })} /></td>
                      <td className="px-1"><NumField value={a.walkwayM} onChange={(v) => setArea(a.id, { walkwayM: v ?? 0 })} /></td>
                      <td className="px-1"><NumField value={a.lifelineM} onChange={(v) => setArea(a.id, { lifelineM: v ?? 0 })} /></td>
                      <td className="px-1"><NumField value={a.pipeM} onChange={(v) => setArea(a.id, { pipeM: v ?? 0 })} /></td>
                      <td className="px-2 text-[11px] text-slate-400">
                        {ar && [
                          ar.walkwayM > 0 && tf('walkway {m} m · {p} panels', { m: fmtN(ar.walkwayM, ar.walkwayM % 1 ? 2 : 0), p: ar.walkwayPanels }),
                          ar.lifelineM > 0 && tf('lifeline {m} m · {e} end + {i} intermediate anchors', { m: fmtN(ar.lifelineM, ar.lifelineM % 1 ? 2 : 0), e: ar.endAnchors, i: ar.intAnchors }),
                          ar.pipeM > 0 && tf('pipe {m} m', { m: fmtN(ar.pipeM, ar.pipeM % 1 ? 2 : 0) }),
                        ].filter(Boolean).join(' · ')}
                      </td>
                      <td><button className={DEL_BTN} title={t('Remove')} onClick={() => setCv((c) => ({ ...c, areas: c.areas.filter((x) => x.id !== a.id) }))}>×</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Labeled label={t('Walkway panel cost')}><NumField value={st.walkwayPanelCost} onChange={(v) => setSt({ walkwayPanelCost: v })} /></Labeled>
          <Labeled label={t('Walkway support cost')}><NumField value={st.walkwaySupportCost} onChange={(v) => setSt({ walkwaySupportCost: v })} /></Labeled>
          <Labeled label={t('Lifeline wire cost per m')}><NumField value={st.lifelineWireCostPerM} onChange={(v) => setSt({ lifelineWireCostPerM: v })} /></Labeled>
          <Labeled label={t('End anchor cost')}><NumField value={st.lifelineEndAnchorCost} onChange={(v) => setSt({ lifelineEndAnchorCost: v })} /></Labeled>
          <Labeled label={t('Intermediate anchor cost')}><NumField value={st.lifelineIntAnchorCost} onChange={(v) => setSt({ lifelineIntAnchorCost: v })} /></Labeled>
        </div>
        <LinkLines keys={civilKeys} explain={explain} usage={usage} onGo={onGo}
          mustUse={['civil.walkway.m', 'civil.lifeline.m', 'civil.pipe.m', 'civil.pump']} />
      </Card>

      {/* ── Grounding pits and inverter stations ── */}
      <Card title={t('Grounding pits and inverter stations')}>
        <p className="text-[11px] text-slate-500">{tf('Counted from the {n} inverters. The factors are starting figures — set them to your own practice.', { n: fmtN(cr.inputs.inverters) })}</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 max-w-3xl">
          <Labeled label={t('Pits per inverter')}><NumField value={st.pitsPerInverter} onChange={(v) => setSt({ pitsPerInverter: v ?? 0 })} /></Labeled>
          <Labeled label={t('Extra pits')} hint={t('Panels, lightning protection, the transformer')}><NumField value={st.pitsExtra} onChange={(v) => setSt({ pitsExtra: v ?? 0 })} /></Labeled>
          <Labeled label={t('Inverters per station')}><NumField value={st.invertersPerStation} onChange={(v) => setSt({ invertersPerStation: v ?? 1 })} /></Labeled>
        </div>
        <LinkLines keys={['civil.pits', 'civil.stations']} explain={explain} usage={usage} onGo={onGo} mustUse={['civil.pits']} />
      </Card>

      {/* ── O&M ── */}
      <Card title={t('Operation & maintenance')} action={<button className={SMALL_BTN} onClick={addItem}>{t('+ O&M item')}</button>}>
        <p className="text-[11px] text-slate-500">{t('Each item costs a year — per visit (Rp/Wp × plant Wp × visits a year) or a lump per year — and rises by the escalation every year. The years included in this price go into the Bill of Material; a separate long-term O&M contract starts the year after them, so no year is sold twice. One visits figure drives both what is sold and what is costed.')}</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 max-w-2xl">
          <Labeled label={t('Years in this price')}><NumField value={os.includedYears} onChange={(v) => setOs({ includedYears: v ?? 0 })} /></Labeled>
          <Labeled label={t('Escalation % a year')}><NumField value={os.escalationPct} onChange={(v) => setOs({ escalationPct: v ?? 0 })} /></Labeled>
          <Labeled label={t('Separate contract (years)')} hint={t('Optional. Priced here for reference only — it is not in this Bill of Material.')}><NumField value={os.contractYears} onChange={(v) => setOs({ contractYears: v ?? 0 })} /></Labeled>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[820px]">
            <thead><tr className="text-[10px] uppercase tracking-wider text-slate-500">
              <th className="text-left py-1 pr-2">{t('Item')}</th><th className="text-left px-1 w-44">{t('Priced')}</th>
              <th className="text-right px-1 w-28">{t('Rate')}</th><th className="text-right px-1 w-24">{t('Visits a year')}</th>
              <th className="text-right px-1 w-32">{t('Year 1')}</th><th className="text-right px-1 w-32">{t('Average year')}</th><th className="w-6" />
            </tr></thead>
            <tbody>
              {cv.om.items.map((it) => {
                const ir = cr.om.items.find((x) => x.id === it.id);
                return (
                  <tr key={it.id}>
                    <td className="py-1 pr-2"><TextField value={it.label} onChange={(v) => setItem(it.id, { label: v })} /></td>
                    <td className="px-1">
                      <select value={it.basis} className={CELL} onChange={(e) => setItem(it.id, { basis: e.target.value === 'wpVisit' ? 'wpVisit' : 'year', visitsPerYear: e.target.value === 'wpVisit' ? it.visitsPerYear || 1 : it.visitsPerYear })}>
                        <option value="wpVisit">{t('Rp/Wp per visit')}</option>
                        <option value="year">{t('Rp per year')}</option>
                      </select>
                    </td>
                    <td className="px-1"><NumField value={it.rate} onChange={(v) => setItem(it.id, { rate: v })} /></td>
                    <td className="px-1">{it.basis === 'wpVisit' ? <NumField value={it.visitsPerYear} onChange={(v) => setItem(it.id, { visitsPerYear: v ?? 0 })} /> : <div className="text-right text-slate-600 pt-1.5">—</div>}</td>
                    <td className="px-1 text-right tabular-nums text-slate-300 pt-1.5">{ir?.firstYear != null ? fmtN(ir.firstYear) : '—'}</td>
                    <td className="px-1 text-right tabular-nums text-white pt-1.5">{ir && ir.perYear ? fmtN(ir.perYear) : '—'}</td>
                    <td><button className={DEL_BTN} title={t('Remove the item and its Bill of Material row')} onClick={() => removeItem(it.id)}>×</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
          {cr.om.includedYears > 0 && <span className="text-slate-300">{tf('O&M in this price: {total} over {n} years (cost)', { total: fmtRp(cr.om.total), n: cr.om.includedYears })}</span>}
          {cr.om.contract && (
            <span className="text-slate-400">{tf('Separate contract, years {a}–{b}: {first} in year {a}, {total} in all (cost, not in this Bill of Material)', {
              a: cr.om.contract.fromYear, b: cr.om.contract.toYear, first: fmtRp(cr.om.contract.firstYear), total: fmtRp(cr.om.contract.total),
            })}</span>
          )}
        </div>
        <LinkLines keys={omKeys} explain={explain} usage={usage} onGo={onGo} mustUse={cr.om.items.map((i) => `om.${i.id}.perYear`)} />
      </Card>
    </div>
  );
}
