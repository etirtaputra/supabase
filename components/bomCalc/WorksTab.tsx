'use client';
/**
 * BOM Calculator — the Project works & manpower tab: the project-works items
 * the BOM rows read (lump, per month, per Wp or a percentage of the other
 * rows), and the crew costed bottom-up as the cross-check on the
 * installation the BOM sells (lib/bomCalc/works.ts).
 */
import React from 'react';
import { useT } from '@/hooks/useT';
import { fmtRp } from '@/lib/formatters';
import { worksOf, type BomCalcDoc, type BomCalcResult, type BomRow } from '@/lib/bomCalc';
import type { CrewRole, WorksBasis, WorksDoc, WorksItem, WorksSettings } from '@/lib/bomCalc/works';
import { STANDARD_CATEGORIES, typedRow } from '@/lib/bomCalc/template';
import type { Explanation } from '@/lib/bomCalc/links';
import { NumField, TextField, Labeled, Card, CELL, SMALL_BTN, DEL_BTN } from './Fields';
import { fmtN, LinkLines } from './LinkBits';

let uid = 0;
const newId = (p: string) => `${p}${Date.now().toString(36)}${(uid++).toString(36)}`;

/** What the rate means for each basis — English, translated where shown. */
const RATE_UNIT: Record<WorksBasis, string> = { lump: 'Rp', month: 'Rp a month', wp: 'Rp/Wp', percent: '%' };

export function WorksTab({ doc, res, edit, explain, usage, onGo }: {
  doc: BomCalcDoc; res: BomCalcResult; edit: (fn: (d: BomCalcDoc) => BomCalcDoc) => void;
  explain: (key: string) => Explanation | null; usage: Map<string, BomRow[]>; onGo: (rowId: string) => void;
}) {
  const { t, tf } = useT();
  const w = worksOf(doc);
  const wr = res.works;
  const st = w.settings;
  const cc = wr.crossCheck;

  const setW = (fn: (x: WorksDoc) => WorksDoc) => edit((d) => ({ ...d, works: fn(worksOf(d)) }));
  const setSt = (p: Partial<WorksSettings>) => setW((x) => ({ ...x, settings: { ...x.settings, ...p } }));
  const setItem = (id: string, p: Partial<WorksItem>) => setW((x) => ({ ...x, items: x.items.map((i) => (i.id === id ? { ...i, ...p } : i)) }));
  const setRole = (id: string, p: Partial<CrewRole>) => setW((x) => ({ ...x, crew: x.crew.map((c) => (c.id === id ? { ...c, ...p } : c)) }));

  /** A new item comes with its BOM row, cost-linked, so it cannot be costed and never sold. */
  const addItem = () => {
    const id = newId('w');
    edit((d) => {
      const x = worksOf(d);
      return {
        ...d,
        works: { ...x, items: [...x.items, { id, label: '', basis: 'lump', rate: null }] },
        rows: [...d.rows, { ...typedRow('project', '', 'overall', 1), costKey: `works.${id}.cost` }],
      };
    });
  };
  const removeItem = (id: string) => edit((d) => {
    const x = worksOf(d);
    return { ...d, works: { ...x, items: x.items.filter((i) => i.id !== id) }, rows: d.rows.filter((r) => r.costKey !== `works.${id}.cost`) };
  });

  const catLabel = (k: string) => STANDARD_CATEGORIES.find((c) => c.key === k)?.label ?? k;

  return (
    <div className="space-y-4">
      {/* ── Project works ── */}
      <Card title={t('Project works')} action={<button className={SMALL_BTN} onClick={addItem}>{t('+ Item')}</button>}>
        <p className="text-[11px] text-slate-500">{t('Each item is a lump sum, a rate a month × the project months, a rate per Wp × the plant, or a percentage of every other row (insurance) — never of itself. The matching Bill of Material row reads the cost; a new item brings its own row.')}</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 max-w-2xl">
          <Labeled label={t('Project duration (months)')}><NumField value={st.durationMonths} onChange={(v) => setSt({ durationMonths: v ?? 0 })} /></Labeled>
          <Labeled label={t('Working days a month')}><NumField value={st.workingDaysPerMonth} onChange={(v) => setSt({ workingDaysPerMonth: v ?? 0 })} /></Labeled>
          <div className="self-end text-[11px] text-slate-400 pb-1.5">{tf('{d} working days on site', { d: fmtN(wr.projectDays) })}</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[720px]">
            <thead><tr className="text-[10px] uppercase tracking-wider text-slate-500">
              <th className="text-left py-1 pr-2">{t('Item')}</th><th className="text-left px-1 w-40">{t('Priced')}</th>
              <th className="text-right px-1 w-36">{t('Rate')}</th><th className="text-right px-1 w-36">{t('Cost')}</th><th className="w-6" />
            </tr></thead>
            <tbody>
              {w.items.map((it) => {
                const ir = wr.items.find((x) => x.id === it.id);
                return (
                  <tr key={it.id}>
                    <td className="py-1 pr-2"><TextField value={it.label} onChange={(v) => setItem(it.id, { label: v })} /></td>
                    <td className="px-1">
                      <select value={it.basis} className={CELL} onChange={(e) => setItem(it.id, { basis: e.target.value as WorksBasis })}>
                        <option value="lump">{t('Lump sum')}</option>
                        <option value="month">{t('Per month')}</option>
                        <option value="wp">{t('Per Wp')}</option>
                        <option value="percent">{t('% of the other rows')}</option>
                      </select>
                    </td>
                    <td className="px-1"><NumField value={it.rate} placeholder={t(RATE_UNIT[it.basis])} onChange={(v) => setItem(it.id, { rate: v })} /></td>
                    <td className="px-1 text-right tabular-nums text-white pt-1.5">{ir && ir.cost ? fmtN(ir.cost) : '—'}</td>
                    <td><button className={DEL_BTN} title={t('Remove the item and its Bill of Material row')} onClick={() => removeItem(it.id)}>×</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <LinkLines keys={wr.items.map((i) => `works.${i.id}.cost`)} explain={explain} usage={usage} onGo={onGo} mustUse={wr.items.map((i) => `works.${i.id}.cost`)} />
      </Card>

      {/* ── Manpower ── */}
      <Card title={t('Manpower')} action={
        <button className={SMALL_BTN} onClick={() => setW((x) => ({ ...x, crew: [...x.crew, { id: newId('m'), label: '', category: '', people: 1, days: null, dayRate: null }] }))}>{t('+ Role')}</button>}>
        <p className="text-[11px] text-slate-500">{t('The crew, costed bottom-up: people × days × day rate. Leave the days empty for the whole project. This does not add to the price — it is the check on the installation the Bill of Material sells. Give a role a category to compare that category on its own.')}</p>
        {w.crew.length === 0 ? <p className="text-xs text-slate-500 italic">{t('No crew yet.')}</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[860px]">
              <thead><tr className="text-[10px] uppercase tracking-wider text-slate-500">
                <th className="text-left py-1 pr-2">{t('Role')}</th><th className="text-left px-1 w-48">{t('Category')}</th>
                <th className="text-right px-1 w-20">{t('People')}</th><th className="text-right px-1 w-24">{t('Days')}</th>
                <th className="text-right px-1 w-32">{t('Day rate')}</th><th className="text-right px-1 w-24">{t('Man-days')}</th>
                <th className="text-right px-1 w-36">{t('Cost')}</th><th className="w-6" />
              </tr></thead>
              <tbody>
                {w.crew.map((c) => {
                  const cr = wr.crew.find((x) => x.id === c.id);
                  return (
                    <tr key={c.id}>
                      <td className="py-1 pr-2"><TextField value={c.label} placeholder={t('e.g. Installers')} onChange={(v) => setRole(c.id, { label: v })} /></td>
                      <td className="px-1">
                        <select value={c.category} className={CELL} onChange={(e) => setRole(c.id, { category: e.target.value })}>
                          <option value="">{t('Whole project')}</option>
                          {STANDARD_CATEGORIES.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
                        </select>
                      </td>
                      <td className="px-1"><NumField value={c.people} onChange={(v) => setRole(c.id, { people: v ?? 0 })} /></td>
                      <td className="px-1"><NumField value={c.days} placeholder={fmtN(wr.projectDays)} onChange={(v) => setRole(c.id, { days: v })} /></td>
                      <td className="px-1"><NumField value={c.dayRate} onChange={(v) => setRole(c.id, { dayRate: v })} /></td>
                      <td className="px-1 text-right tabular-nums text-slate-300 pt-1.5">{cr ? fmtN(cr.manDays, cr.manDays % 1 ? 1 : 0) : '—'}</td>
                      <td className="px-1 text-right tabular-nums text-white pt-1.5">{cr?.cost != null ? fmtN(cr.cost) : '—'}</td>
                      <td><button className={DEL_BTN} title={t('Remove')} onClick={() => setW((x) => ({ ...x, crew: x.crew.filter((y) => y.id !== c.id) }))}>×</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {w.crew.length > 0 && <div className="text-xs text-slate-300">{tf('{d} man-days · crew cost {c}', { d: fmtN(wr.manDays, wr.manDays % 1 ? 1 : 0), c: fmtRp(wr.labourCost) })}</div>}
      </Card>

      {/* ── The cross-check ── */}
      {cc && cc.labourCost > 0 && (
        <Card title={t('Installation sold against the crew cost')}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
            <div><div className="text-[10px] uppercase tracking-wider text-slate-500">{t('Installation sold')}</div><div className="tabular-nums text-white">{fmtRp(cc.installSold)}</div></div>
            <div><div className="text-[10px] uppercase tracking-wider text-slate-500">{t('Crew cost')}</div><div className="tabular-nums text-white">{fmtRp(cc.labourCost)}</div></div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-500">{t('Difference')}</div>
              <div className={`tabular-nums font-semibold ${cc.installSold < cc.labourCost ? 'text-red-300' : 'text-emerald-300'}`}>
                {fmtRp(cc.installSold - cc.labourCost)}{cc.marginPct != null && ` · ${cc.marginPct} %`}
              </div>
            </div>
          </div>
          {cc.installSold < cc.labourCost && <p className="text-xs text-red-300">{t('The installation is sold below what the crew costs. Raise the installation prices in the Bill of Material, or check the crew.')}</p>}
          {cc.byCategory.length > 0 && (
            <div className="overflow-x-auto"><table className="text-xs min-w-[520px]">
              <thead><tr className="text-[10px] uppercase tracking-wider text-slate-500">
                <th className="text-left py-1 pr-3">{t('Category')}</th><th className="text-right px-3">{t('Installation sold')}</th><th className="text-right px-3">{t('Crew cost')}</th>
              </tr></thead>
              <tbody>
                {cc.byCategory.map((b) => (
                  <tr key={b.category}>
                    <td className="py-1 pr-3 text-slate-300">{catLabel(b.category)}</td>
                    <td className="px-3 text-right tabular-nums text-slate-200">{fmtN(b.installSold)}</td>
                    <td className={`px-3 text-right tabular-nums ${b.installSold < b.labourCost ? 'text-red-300' : 'text-slate-200'}`}>{fmtN(b.labourCost)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </Card>
      )}
    </div>
  );
}
