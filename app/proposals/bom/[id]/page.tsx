'use client';
/**
 * BOM Calculator (beta) — one calculation.
 *
 * Every input lives in one document (lib/bomCalc BomCalcDoc); every quantity,
 * price, total and check is recomputed from it on each keystroke. The tabs
 * follow the workbook the engineers know — strings, DC cable, AC cable, the
 * priced BOM — but nothing is linked by hand: a BOM row that reads "PV cable
 * 6 mm²" reads the calculation, not a cell someone remembered to point at.
 *
 * Saves only to 10.6_bom_calcs. The EPC proposals are not touched.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { createSupabaseClient } from '@/lib/supabase';
import { selectAll } from '@/lib/fetchAllRows';
import { useQuotesGate } from '@/hooks/useQuotesGate';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useT } from '@/hooks/useT';
import { useSupabaseData } from '@/hooks/useSupabaseData';
import { useSettings } from '@/hooks/useSettings';
import { fmtRp } from '@/lib/formatters';
import { isOfferable } from '@/lib/itemVisibility';
import { catalogMatches } from '@/lib/catalogSearch';
import { computeTUCMap, getComponentCost, fxFromHistory } from '@/lib/computeTUC';
import { deriveExchangeRates } from '@/lib/exchangeRates';
import { BAR_BTN, BAR_BTN_OFF, BAR_BTN_ON } from '@/constants/controls';
import { computeBomCalc, linkOptions, type BomCalcDoc, type BomRow, type AcSegment, type RoofRun, type InverterGroup } from '@/lib/bomCalc';
import { moduleFromSpecs, inverterFromSpecs } from '@/lib/bomCalc/specs';
import { STANDARD_CATEGORIES, typedRow } from '@/lib/bomCalc/template';
import { CABLE_TYPES, AC_SIZES_MM2, type CableType } from '@/lib/bomCalc/cables';
import { bomExportHtml } from '@/lib/bomCalc/exportHtml';
import { explainKey, usageByKey, type Explanation } from '@/lib/bomCalc/links';
import { NumField, TextField, Labeled, Card, CELL, SMALL_BTN, DEL_BTN } from '@/components/bomCalc/Fields';
import { TAB_LABEL, fmtN, UsedBy, LinkLines, LinkSelect } from '@/components/bomCalc/LinkBits';
import { RacewayTab } from '@/components/bomCalc/RacewayTab';
import { DeleteCalc } from '@/components/bomCalc/DeleteCalc';
import type { Component } from '@/types/database';

type Tab = 'strings' | 'dc' | 'ac' | 'raceway' | 'bom' | 'links' | 'checks';
interface SpecItem { component_id: string; supplier_model: string; internal_description: string | null; category: string; specifications: Record<string, unknown> | null }

/** Results that must land in a BOM row (the same list unusedKeys checks). */
const MUST_USE = /^(pv\.modules|dc\.(cable|connectors)\.\d+|ac\.seg\.[^.]+\.(phase|pe)|rw\.(tray\.m|conduit|glands|labels|ties|clips))$/;

let uid = 0;
const newId = (p: string) => `${p}${Date.now().toString(36)}${(uid++).toString(36)}`;

export default function BomCalcEditorPage() {
  const { id } = useParams<{ id: string }>();
  const { ready, user } = useQuotesGate(false, '/proposals/bom');
  const { t, tf } = useT();
  const supabase = createSupabaseClient();
  const router = useRouter();

  const [title, setTitle] = useState('');
  usePageTitle(title || undefined);
  const [doc, setDoc] = useState<BomCalcDoc | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [tab, setTab] = useState<Tab>('strings');

  // ── Load ──
  useEffect(() => {
    if (!ready || !id) return;
    let alive = true;
    supabase.from('10.6_bom_calcs').select('title, doc, updated_at').eq('calc_id', id).maybeSingle()
      .then(({ data, error: e }) => {
        if (!alive) return;
        if (e) { setError(e.message); return; }
        if (!data) { setNotFound(true); return; }
        setTitle(data.title ?? ''); setDoc(data.doc as BomCalcDoc); setSavedAt(data.updated_at);
      });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, id]);

  // Catalogue modules and inverters with their electrical specs.
  const [specItems, setSpecItems] = useState<SpecItem[]>([]);
  useEffect(() => {
    if (!ready) return;
    selectAll<SpecItem>((f, to) => supabase.from('3.0_components')
      .select('component_id, supplier_model, internal_description, category, specifications')
      .in('category', ['pv_module', 'on_grid_inverter']).is('archived_at', null).order('component_id').range(f, to))
      .then(({ data }) => setSpecItems(data ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // Catalogue + cost history for pricing rows — the same cost rule as the EPC proposals.
  const { data: catalog } = useSupabaseData();
  const { epcCostBufferPct } = useSettings();
  const tucMap = useMemo(() => computeTUCMap(catalog.pos, catalog.poItems, catalog.poCosts), [catalog.pos, catalog.poItems, catalog.poCosts]);
  const fx = useMemo(() => fxFromHistory(catalog.pos, deriveExchangeRates(catalog.pos, catalog.poItems, catalog.poCosts, catalog.quotes)),
    [catalog.pos, catalog.poItems, catalog.poCosts, catalog.quotes]);
  const offerable = useMemo(() => (catalog.components as Component[]).filter(isOfferable), [catalog.components]);
  const compById = useMemo(() => new Map((catalog.components as Component[]).map((c) => [String(c.component_id), c])), [catalog.components]);
  const costFor = useCallback((componentId: string) => {
    const c = compById.get(componentId);
    const mode = (c?.quote_cost_mode ?? (c?.show_tuc_in_quotes === false ? 'hidden' : 'buffered'));
    return getComponentCost(componentId, tucMap, catalog.quotes, catalog.quoteItems, [], { mode, bufferPct: c?.quote_cost_buffer_pct ?? epcCostBufferPct }, fx);
  }, [compById, tucMap, catalog.quotes, catalog.quoteItems, epcCostBufferPct, fx]);

  const res = useMemo(() => (doc ? computeBomCalc(doc) : null), [doc]);
  const links = useMemo(() => (doc && res ? linkOptions(doc, res) : []), [doc, res]);
  // Both directions of every link: a key's explanation, and the BOM rows that read it.
  const usage = useMemo(() => usageByKey(doc?.rows ?? []), [doc]);
  const explain = useCallback((key: string) => (doc && res ? explainKey(doc, res.values, res.dc, res.ac, key, res.raceway) : null), [doc, res]);
  const [focusRow, setFocusRow] = useState<string | null>(null);
  const goToRow = (rowId: string) => {
    setTab('bom'); setFocusRow(rowId);
    setTimeout(() => document.getElementById(`row-${rowId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
  };
  /** BOM rows that take a segment's cable, directly or through the per-cable total. */
  const segUsage = (segId: string, part: 'phase' | 'pe', cable: string | null) =>
    [...(usage.get(`ac.seg.${segId}.${part}`) ?? []), ...(cable ? usage.get(`ac.cable.${cable}`) ?? [] : [])];

  // ── Edit helpers ──
  const edit = (fn: (d: BomCalcDoc) => BomCalcDoc) => { setDoc((d) => (d ? fn(d) : d)); setDirty(true); };
  const setProject = (p: Partial<BomCalcDoc['project']>) => edit((d) => ({ ...d, project: { ...d.project, ...p } }));
  const setModule = (m: Partial<BomCalcDoc['module']>) => edit((d) => ({ ...d, module: { ...d.module, ...m } }));
  const setGroup = (gid: string, p: Partial<BomCalcDoc['inverterGroups'][number]>) =>
    edit((d) => ({ ...d, inverterGroups: d.inverterGroups.map((g) => (g.id === gid ? { ...g, ...p } : g)) }));
  const setInv = (gid: string, p: Partial<InverterGroup['inverter']>) =>
    edit((d) => ({ ...d, inverterGroups: d.inverterGroups.map((g) => (g.id === gid ? { ...g, inverter: { ...g.inverter, ...p } } : g)) }));
  const setRoof = (rid: string, p: Partial<RoofRun>) => edit((d) => ({ ...d, roofs: d.roofs.map((r) => (r.id === rid ? { ...r, ...p } : r)) }));
  const setSeg = (sid: string, p: Partial<AcSegment>) => edit((d) => ({ ...d, acSegments: d.acSegments.map((s) => (s.id === sid ? { ...s, ...p } : s)) }));
  const setRow = (rid: string, p: Partial<BomRow>) => edit((d) => ({ ...d, rows: d.rows.map((r) => (r.id === rid ? { ...r, ...p } : r)) }));

  // ── Save ──
  const save = useCallback(async () => {
    if (!doc || saving) return;
    setSaving(true); setError(null);
    const now = new Date().toISOString();
    const { error: e } = await supabase.from('10.6_bom_calcs')
      .update({ title, doc, updated_at: now, updated_by_email: user?.email ?? null }).eq('calc_id', id);
    setSaving(false);
    if (e) { setError(e.message); return; }
    setSavedAt(now); setDirty(false);
  }, [doc, saving, supabase, title, user, id]);

  const saveRef = useRef(save);
  saveRef.current = save;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveRef.current(); } };
    const onUnload = (e: BeforeUnloadEvent) => { if (dirtyRef.current) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', onUnload);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('beforeunload', onUnload); };
  }, []);

  const exportXls = () => {
    if (!doc || !res) return;
    const blob = new Blob([bomExportHtml(doc, res, title)], { type: 'application/vnd.ms-excel' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `BOM ${(doc.project.customer || title || 'calculation').replace(/[\\/:*?"<>|]/g, '')} ${fmtN(res.plantWp / 1000, 1)}kWp.xls`;
    a.click();
  };

  if (!ready) return null;
  if (notFound) return <div className="max-w-3xl mx-auto px-4 py-10 text-sm text-slate-400">{t('This calculation does not exist or was deleted.')} <Link href="/proposals/bom" className="text-emerald-300">{t('Back to the list')}</Link></div>;
  if (!doc || !res) return <div className="max-w-3xl mx-auto px-4 py-10 text-xs text-slate-500">{error ?? t('Loading…')}</div>;

  const errors = res.checks.filter((c) => c.level === 'error').length;
  const unpriced = res.checks.filter((c) => c.tag === 'unpriced').length;
  const warns = res.checks.filter((c) => c.level === 'warn' && !c.tag).length;
  const TABS: { key: Tab; label: string }[] = [
    { key: 'strings', label: t('Strings & inverters') },
    { key: 'dc', label: t('DC cable') },
    { key: 'ac', label: t('AC cable') },
    { key: 'raceway', label: t('Cable raceway') },
    { key: 'bom', label: 'Bill of Material' },
    { key: 'links', label: t('Links') },
    { key: 'checks', label: errors ? tf('Checks ({n})', { n: errors }) : t('Checks') },
  ];
  const modules = specItems.filter((s) => s.category === 'pv_module');
  const inverters = specItems.filter((s) => s.category === 'on_grid_inverter');

  return (
    <div className="max-w-7xl mx-auto px-4 py-5 space-y-4">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/proposals/bom" className="text-xs text-slate-500 hover:text-slate-300">← {t('BOM Calculator')}</Link>
        <input value={title} onChange={(e) => { setTitle(e.target.value); setDirty(true); }} placeholder={t('Calculation title')}
          className="flex-1 min-w-[200px] bg-transparent text-lg font-bold text-white border-b border-transparent focus:border-slate-600 outline-none" />
        <span className="text-[11px] text-slate-500">{dirty ? t('Unsaved changes') : savedAt ? tf('Saved {when}', { when: new Date(savedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) }) : ''}</span>
        <DeleteCalc bar calcId={id} name={title} onError={setError}
          onDeleted={() => { dirtyRef.current = false; router.push('/proposals/bom'); }} />
        <button onClick={exportXls} className={`${BAR_BTN} ${BAR_BTN_OFF} px-3`}>{t('Export Excel')}</button>
        <button onClick={save} disabled={!dirty || saving} className={`${BAR_BTN} ${BAR_BTN_ON} px-3 disabled:opacity-40`}>{saving ? t('Saving…') : t('Save')}</button>
      </div>
      {error && <div className="px-3 py-2 bg-red-500/10 border border-red-500/25 rounded-lg text-xs text-red-300">{error}</div>}

      {/* ── Summary — always in view ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {[
          [t('Plant size'), `${fmtN(res.plantWp / 1000, 2)} kWp`],
          [t('Modules · strings'), `${fmtN(res.dc.modules)} · ${fmtN(res.dc.strings)}`],
          [t('Inverters · DC/AC'), `${fmtN(res.dc.inverters)} · ${res.dc.dcAcRatio ?? '—'}`],
          [t('Total (excl. PPN)'), fmtRp(res.totals.total)],
          ['Rp/Wp', res.totals.perWp == null ? '—' : fmtN(res.totals.perWp)],
          [t('Checks'), errors || warns || unpriced ? tf('{e} problems · {w} warnings · {u} not priced', { e: errors, w: warns, u: unpriced }) : t('All clear')],
        ].map(([k, v], i) => (
          <button key={k} onClick={i === 5 ? () => setTab('checks') : undefined}
            className={`text-left rounded-xl border px-3 py-2 ${i === 5 && errors ? 'border-red-500/40 bg-red-500/5' : 'border-slate-800 bg-slate-900/40'}`}>
            <div className="text-[10px] uppercase tracking-wider text-slate-500">{k}</div>
            <div className={`text-sm font-semibold tabular-nums ${i === 5 && errors ? 'text-red-300' : 'text-white'}`}>{v}</div>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {TABS.map((x) => (
          <button key={x.key} onClick={() => setTab(x.key)} className={`${BAR_BTN} px-3 ${tab === x.key ? BAR_BTN_ON : BAR_BTN_OFF}`}>{x.label}</button>
        ))}
      </div>

      {/* ── Strings & inverters ── */}
      {tab === 'strings' && (
        <div className="space-y-4">
          <Card title={t('Project')}>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <Labeled label={t('Customer')}><TextField value={doc.project.customer} onChange={(v) => setProject({ customer: v })} /></Labeled>
              <Labeled label={t('Location')}><TextField value={doc.project.location} onChange={(v) => setProject({ location: v })} /></Labeled>
              <Labeled label={t('Default margin %')} hint={t('Used on every row without its own margin. Selling price = cost ÷ (1 − margin).')}>
                <NumField value={Math.round(doc.project.defaultMargin * 10000) / 100} onChange={(v) => setProject({ defaultMargin: (v ?? 0) / 100 })} />
              </Labeled>
              <Labeled label="PPN %"><NumField value={doc.project.ppnPct} onChange={(v) => setProject({ ppnPct: v ?? 0 })} /></Labeled>
              <Labeled label={t('Target price Rp/Wp')} hint={t('Optional. The checks say how far the total is from it.')}>
                <NumField value={doc.project.targetPerWp} onChange={(v) => setProject({ targetPerWp: v })} />
              </Labeled>
            </div>
          </Card>

          <Card title={t('PV module')} action={
            <select value={doc.module.componentId ?? ''} className={`${CELL} !w-auto max-w-[320px]`}
              onChange={(e) => { const it = modules.find((m) => m.component_id === e.target.value); if (it) setModule({ ...moduleFromSpecs(it.supplier_model, it.specifications), componentId: it.component_id }); }}>
              <option value="">{t('Fill from the catalogue…')}</option>
              {modules.map((m) => <option key={m.component_id} value={m.component_id}>{m.supplier_model}</option>)}
            </select>}>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
              <Labeled label={t('Module type')} className="col-span-2"><TextField value={doc.module.model} onChange={(v) => setModule({ model: v })} /></Labeled>
              <Labeled label="Wp"><NumField value={doc.module.wp || null} onChange={(v) => setModule({ wp: v ?? 0 })} /></Labeled>
              <Labeled label="Voc (V)"><NumField value={doc.module.vocV || null} onChange={(v) => setModule({ vocV: v ?? 0 })} /></Labeled>
              <Labeled label="Vmp (V)"><NumField value={doc.module.vmpV || null} onChange={(v) => setModule({ vmpV: v ?? 0 })} /></Labeled>
              <Labeled label="Isc (A)"><NumField value={doc.module.iscA || null} onChange={(v) => setModule({ iscA: v ?? 0 })} /></Labeled>
              <Labeled label="Imp (A)"><NumField value={doc.module.impA || null} onChange={(v) => setModule({ impA: v ?? 0 })} /></Labeled>
              <Labeled label="Voc %/°C"><NumField value={doc.module.tempCoeffVocPct} onChange={(v) => setModule({ tempCoeffVocPct: v })} /></Labeled>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Labeled label={t('Module max system V')}><NumField value={doc.module.maxSystemV} onChange={(v) => setModule({ maxSystemV: v })} /></Labeled>
              <Labeled label={t('Coldest cell °C')} hint={t('Sets the highest string voltage.')}><NumField value={doc.dc.minCellTempC} onChange={(v) => edit((d) => ({ ...d, dc: { ...d.dc, minCellTempC: v ?? 18 } }))} /></Labeled>
              <Labeled label={t('Hottest cell °C')} hint={t('Sets the lowest working voltage against the MPPT window.')}><NumField value={doc.dc.maxCellTempC} onChange={(v) => edit((d) => ({ ...d, dc: { ...d.dc, maxCellTempC: v ?? 70 } }))} /></Labeled>
              {res.dc.vocColdV != null && <div className="self-end text-[11px] text-slate-400 pb-1.5">{tf('Highest string voltage: {v} V', { v: fmtN(res.dc.vocColdV, 0) })}</div>}
            </div>
          </Card>

          <Card title={t('Inverters and strings')} action={
            <button className={SMALL_BTN} onClick={() => edit((d) => ({ ...d, inverterGroups: [...d.inverterGroups, {
              id: newId('g'), label: '', count: 1, stringsEach: 1, modulesPerString: d.inverterGroups[0]?.modulesPerString ?? 18, componentId: null,
              inverter: { model: '', acKw: 0, acVoltageV: 800, acCurrentA: null, maxDcV: 1500, mpptMinV: null, mpptMaxV: null, mppts: null, stringsPerMppt: null, maxIscPerMpptA: null },
            }] }))}>{t('+ Inverter group')}</button>}>
            <p className="text-[11px] text-slate-500">{t('One group per identical set of inverters. The strings here are the only string count in the calculation — the roofs on the DC tab must add up to them.')}</p>
            {doc.inverterGroups.length === 0 && <p className="text-xs text-slate-500 italic">{t('No inverters yet.')}</p>}
            {doc.inverterGroups.map((g) => (
              <div key={g.id} className="rounded-xl border border-slate-800 p-3 space-y-2">
                <div className="flex flex-wrap items-end gap-2">
                  <Labeled label={t('Group name')} className="w-40"><TextField value={g.label} placeholder="INV 1–9" onChange={(v) => setGroup(g.id, { label: v })} /></Labeled>
                  <Labeled label={t('Inverter type')} className="flex-1 min-w-[200px]">
                    <div className="flex gap-1.5">
                      <TextField value={g.inverter.model} onChange={(v) => setInv(g.id, { model: v })} />
                      <select value={g.componentId ?? ''} className={`${CELL} !w-28`}
                        onChange={(e) => { const it = inverters.find((m) => m.component_id === e.target.value); if (it) { setGroup(g.id, { componentId: it.component_id }); setInv(g.id, inverterFromSpecs(it.supplier_model, it.specifications)); } }}>
                        <option value="">{t('Catalogue…')}</option>
                        {inverters.map((m) => <option key={m.component_id} value={m.component_id}>{m.supplier_model}</option>)}
                      </select>
                    </div>
                  </Labeled>
                  <Labeled label={t('Count')} className="w-20"><NumField value={g.count} onChange={(v) => setGroup(g.id, { count: v ?? 0 })} /></Labeled>
                  <Labeled label={t('Strings each')} className="w-24"><NumField value={g.stringsEach} onChange={(v) => setGroup(g.id, { stringsEach: v ?? 0 })} /></Labeled>
                  <Labeled label={t('Modules per string')} className="w-28"><NumField value={g.modulesPerString} onChange={(v) => setGroup(g.id, { modulesPerString: v ?? 0 })} /></Labeled>
                  <button className={DEL_BTN} title={t('Remove')} onClick={() => edit((d) => ({ ...d, inverterGroups: d.inverterGroups.filter((x) => x.id !== g.id) }))}>×</button>
                </div>
                <div className="grid grid-cols-3 md:grid-cols-9 gap-2">
                  <Labeled label="kW AC"><NumField value={g.inverter.acKw || null} onChange={(v) => setInv(g.id, { acKw: v ?? 0 })} /></Labeled>
                  <Labeled label="V AC"><NumField value={g.inverter.acVoltageV} onChange={(v) => setInv(g.id, { acVoltageV: v })} /></Labeled>
                  <Labeled label="I AC max (A)"><NumField value={g.inverter.acCurrentA} onChange={(v) => setInv(g.id, { acCurrentA: v })} /></Labeled>
                  <Labeled label="V DC max"><NumField value={g.inverter.maxDcV} onChange={(v) => setInv(g.id, { maxDcV: v })} /></Labeled>
                  <Labeled label="MPPT min V"><NumField value={g.inverter.mpptMinV} onChange={(v) => setInv(g.id, { mpptMinV: v })} /></Labeled>
                  <Labeled label="MPPT max V"><NumField value={g.inverter.mpptMaxV} onChange={(v) => setInv(g.id, { mpptMaxV: v })} /></Labeled>
                  <Labeled label="MPPT"><NumField value={g.inverter.mppts} onChange={(v) => setInv(g.id, { mppts: v })} /></Labeled>
                  <Labeled label={t('Strings / MPPT')}><NumField value={g.inverter.stringsPerMppt} onChange={(v) => setInv(g.id, { stringsPerMppt: v })} /></Labeled>
                  <Labeled label="Isc / MPPT (A)"><NumField value={g.inverter.maxIscPerMpptA} onChange={(v) => setInv(g.id, { maxIscPerMpptA: v })} /></Labeled>
                </div>
                <div className="text-[11px] text-slate-400">
                  {tf('{s} strings · {m} modules · {kwp} kWp', { s: fmtN(g.count * g.stringsEach), m: fmtN(g.count * g.stringsEach * g.modulesPerString), kwp: fmtN(g.count * g.stringsEach * g.modulesPerString * (doc.module.wp || 0) / 1000, 2) })}
                </div>
              </div>
            ))}
            <LinkLines keys={['pv.modules', 'pv.wp', 'pv.strings', 'inv.count']} explain={explain} usage={usage} onGo={goToRow} mustUse={['pv.modules']} />
          </Card>
        </div>
      )}

      {/* ── DC cable ── */}
      {tab === 'dc' && (
        <Card title={t('String cable per roof')} action={
          <button className={SMALL_BTN} onClick={() => edit((d) => ({ ...d, roofs: [...d.roofs, { id: newId('f'), label: '', strings: 0, modulesPerString: null, distanceM: 0, runM: 0, size: 'auto' }] }))}>{t('+ Roof')}</button>}>
          <p className="text-[11px] text-slate-500">{t('Cable to buy per roof = (distance to the first string + average string run) × 2 × strings — the workbook rule. The voltage drop is taken over the electrical path, 2 × distance + run. Size "auto" picks the smallest cable within the limit.')}</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 max-w-2xl">
            <Labeled label={t('Max voltage drop %')}><NumField value={doc.dc.maxVdPct} onChange={(v) => edit((d) => ({ ...d, dc: { ...d.dc, maxVdPct: v ?? 4 } }))} /></Labeled>
            <Labeled label={t('Extra cable %')}><NumField value={doc.dc.slackPct} onChange={(v) => edit((d) => ({ ...d, dc: { ...d.dc, slackPct: v ?? 0 } }))} /></Labeled>
            <Labeled label={t('Jumpers per string')} hint={t('Connector pairs per string besides its own end pair.')}><NumField value={doc.dc.jumpersPerString} onChange={(v) => edit((d) => ({ ...d, dc: { ...d.dc, jumpersPerString: v ?? 0 } }))} /></Labeled>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[760px]">
              <thead><tr className="text-[10px] uppercase tracking-wider text-slate-500">
                <th className="text-left py-1 pr-2">{t('Roof')}</th><th className="text-right px-1">{t('Strings')}</th><th className="text-right px-1">{t('Modules / string')}</th>
                <th className="text-right px-1">{t('Distance (m)')}</th><th className="text-right px-1">{t('String run (m)')}</th><th className="px-1">{t('Size')}</th>
                <th className="text-right px-1">{t('Cable (m)')}</th><th className="text-right px-1">{t('Voltage drop %')}</th><th />
              </tr></thead>
              <tbody>
                {doc.roofs.map((r) => {
                  const rr = res.dc.roofs.find((x) => x.id === r.id);
                  return (
                    <tr key={r.id}>
                      <td className="py-1 pr-2"><TextField value={r.label} onChange={(v) => setRoof(r.id, { label: v })} /></td>
                      <td className="px-1 w-20"><NumField value={r.strings} onChange={(v) => setRoof(r.id, { strings: v ?? 0 })} /></td>
                      <td className="px-1 w-24"><NumField value={r.modulesPerString} placeholder={String(doc.inverterGroups[0]?.modulesPerString ?? '')} onChange={(v) => setRoof(r.id, { modulesPerString: v })} /></td>
                      <td className="px-1 w-24"><NumField value={r.distanceM} onChange={(v) => setRoof(r.id, { distanceM: v ?? 0 })} /></td>
                      <td className="px-1 w-24"><NumField value={r.runM} onChange={(v) => setRoof(r.id, { runM: v ?? 0 })} /></td>
                      <td className="px-1 w-24">
                        <select value={String(r.size)} className={CELL} onChange={(e) => setRoof(r.id, { size: e.target.value === 'auto' ? 'auto' : (Number(e.target.value) as 4 | 6 | 10 | 16) })}>
                          <option value="auto">{tf('auto ({s} mm²)', { s: rr?.size ?? '—' })}</option>
                          {[4, 6, 10, 16].map((s) => <option key={s} value={s}>{s} mm²</option>)}
                        </select>
                      </td>
                      <td className="px-1 text-right tabular-nums text-slate-200">{fmtN(rr?.cableM ?? 0)}</td>
                      <td className={`px-1 text-right tabular-nums ${rr?.vdPct != null && rr.vdPct > doc.dc.maxVdPct ? 'text-red-300' : 'text-slate-400'}`}>{rr?.vdPct ?? '—'}</td>
                      <td><button className={DEL_BTN} title={t('Remove')} onClick={() => edit((d) => ({ ...d, roofs: d.roofs.filter((x) => x.id !== r.id) }))}>×</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-slate-400">
            <span>{tf('Roofs: {a} strings — inverters: {b}', { a: fmtN(doc.roofs.reduce((x, r) => x + r.strings, 0)), b: fmtN(res.dc.strings) })}</span>
          </div>
          <LinkLines keys={Object.keys(res.dc.cableBySize).flatMap((z) => [`dc.cable.${z}`, `dc.connectors.${z}`])} explain={explain} usage={usage} onGo={goToRow}
            mustUse={Object.keys(res.dc.cableBySize).flatMap((z) => [`dc.cable.${z}`, `dc.connectors.${z}`])} />
        </Card>
      )}

      {/* ── AC cable ── */}
      {tab === 'ac' && (
        <Card title={t('AC cable segments')} action={
          <button className={SMALL_BTN} onClick={() => edit((d) => ({ ...d, acSegments: [...d.acSegments, { ...d.acSegments[0], id: newId('s'), label: '' }] }))}>{t('+ Segment')}</button>}>
          <p className="text-[11px] text-slate-500">{t('A segment is a set of identical circuits — e.g. 5 inverters at 18 m each. The rating is the catalogue figure for ONE conductor as laid; the calculator applies the derating and the 125 % factor and checks it. Voltage drop uses √3·I·(R·cosφ + X·sinφ)·L.')}</p>
          {doc.acSegments.map((s) => {
            const sr = res.ac.segments.find((x) => x.id === s.id);
            const sumInv = doc.inverterGroups.reduce((a, g) => a + g.count * (g.inverter.acCurrentA ?? 0), 0);
            return (
              <div key={s.id} className="rounded-xl border border-slate-800 p-3 space-y-2">
                <div className="flex flex-wrap items-end gap-2">
                  <Labeled label={t('Segment')} className="flex-1 min-w-[200px]"><TextField value={s.label} onChange={(v) => setSeg(s.id, { label: v })} /></Labeled>
                  <Labeled label={t('Circuits')} className="w-20"><NumField value={s.circuits} onChange={(v) => setSeg(s.id, { circuits: v ?? 0 })} /></Labeled>
                  <Labeled label={t('Route length (m)')} className="w-28"><NumField value={s.lengthM} onChange={(v) => setSeg(s.id, { lengthM: v ?? 0 })} /></Labeled>
                  <Labeled label={t('Extra per conductor (m)')} className="w-32"><NumField value={s.tailM} onChange={(v) => setSeg(s.id, { tailM: v ?? 0 })} /></Labeled>
                  <Labeled label={t('Current per circuit (A)')} className="w-36">
                    <div className="flex gap-1">
                      <NumField value={s.currentA} onChange={(v) => setSeg(s.id, { currentA: v ?? 0 })} />
                      {sumInv > 0 && <button className={SMALL_BTN} title={t('Use the sum of all inverter currents')} onClick={() => setSeg(s.id, { currentA: Math.round(sumInv * 100) / 100 })}>Σ</button>}
                    </div>
                  </Labeled>
                  <Labeled label="V" className="w-20"><NumField value={s.voltageV} onChange={(v) => setSeg(s.id, { voltageV: v ?? 0 })} /></Labeled>
                  <Labeled label="cos φ" className="w-16"><NumField value={s.powerFactor} onChange={(v) => setSeg(s.id, { powerFactor: v ?? 0.9 })} /></Labeled>
                  {!['inv', 'feeder', 'mv'].includes(s.id) && <button className={DEL_BTN} title={t('Remove')} onClick={() => edit((d) => ({ ...d, acSegments: d.acSegments.filter((x) => x.id !== s.id) }))}>×</button>}
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <Labeled label={t('Cable')} className="w-40">
                    <select value={s.cableType} className={CELL} onChange={(e) => setSeg(s.id, { cableType: e.target.value as CableType })}>
                      {(Object.keys(CABLE_TYPES) as CableType[]).map((k) => <option key={k} value={k}>{CABLE_TYPES[k].label}</option>)}
                    </select>
                  </Labeled>
                  <Labeled label="mm²" className="w-20">
                    <select value={s.sizeMm2} className={CELL} onChange={(e) => setSeg(s.id, { sizeMm2: Number(e.target.value) })}>
                      {AC_SIZES_MM2.map((z) => <option key={z} value={z}>{z}</option>)}
                    </select>
                  </Labeled>
                  <Labeled label={t('Runs per phase')} className="w-24"><NumField value={s.runs} onChange={(v) => setSeg(s.id, { runs: v ?? 1 })} /></Labeled>
                  <Labeled label={t('Neutrals')} className="w-20"><NumField value={s.neutrals} onChange={(v) => setSeg(s.id, { neutrals: v ?? 0 })} /></Labeled>
                  <Labeled label={t('Rating per conductor (A)')} className="w-36"><NumField value={s.ampacityA} placeholder={t('from catalogue')} onChange={(v) => setSeg(s.id, { ampacityA: v })} /></Labeled>
                  <Labeled label="k1" className="w-16"><NumField value={s.k1} onChange={(v) => setSeg(s.id, { k1: v ?? 1 })} /></Labeled>
                  <Labeled label="k2" className="w-16"><NumField value={s.k2} onChange={(v) => setSeg(s.id, { k2: v ?? 1 })} /></Labeled>
                  <Labeled label="k3" className="w-16"><NumField value={s.k3} onChange={(v) => setSeg(s.id, { k3: v ?? 1 })} /></Labeled>
                  <Labeled label="X Ω/km" className="w-20"><NumField value={s.reactanceOhmKm} onChange={(v) => setSeg(s.id, { reactanceOhmKm: v ?? 0.08 })} /></Labeled>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <Labeled label={t('Earth conductor')} className="w-40">
                    <select value={s.pe?.cableType ?? ''} className={CELL} onChange={(e) => setSeg(s.id, { pe: e.target.value ? { cableType: e.target.value as CableType, sizeMm2: s.pe?.sizeMm2 ?? 95, count: s.pe?.count ?? 1 } : null })}>
                      <option value="">{t('None')}</option>
                      {(Object.keys(CABLE_TYPES) as CableType[]).map((k) => <option key={k} value={k}>{CABLE_TYPES[k].label}</option>)}
                    </select>
                  </Labeled>
                  {s.pe && <>
                    <Labeled label="mm²" className="w-20">
                      <select value={s.pe.sizeMm2} className={CELL} onChange={(e) => setSeg(s.id, { pe: { ...s.pe!, sizeMm2: Number(e.target.value) } })}>
                        {AC_SIZES_MM2.map((z) => <option key={z} value={z}>{z}</option>)}
                      </select>
                    </Labeled>
                    <Labeled label={t('Per circuit')} className="w-20"><NumField value={s.pe.count} onChange={(v) => setSeg(s.id, { pe: { ...s.pe!, count: v ?? 1 } })} /></Labeled>
                  </>}
                  {sr && (
                    <div className="text-[11px] text-slate-400 pb-1.5 flex flex-wrap gap-x-4">
                      <span>{`${sr.cable}: ${fmtN(sr.phaseM + sr.neutralM, 1)} m`} {sr.phaseM + sr.neutralM > 0 && <UsedBy rows={segUsage(s.id, 'phase', sr.cable)} onGo={goToRow} />}</span>
                      {sr.peCable && <span>{`${sr.peCable}: ${fmtN(sr.peM, 1)} m`} {sr.peM > 0 && <UsedBy rows={segUsage(s.id, 'pe', sr.peCable)} onGo={goToRow} />}</span>}
                      <span>{tf('{a} A needed', { a: fmtN(sr.designCurrentA, 1) })}{sr.capacityA != null && <> · <span className={sr.capacityA < sr.designCurrentA ? 'text-red-300' : 'text-emerald-300'}>{tf('{a} A available', { a: fmtN(sr.capacityA, 1) })}</span></>}</span>
                      {sr.vdPct != null && <span className={sr.vdPct > doc.ac.maxVdPct ? 'text-red-300' : ''}>{tf('voltage drop {v} %', { v: sr.vdPct })}</span>}
                      <span>{tf('{n} lugs', { n: sr.lugs })}</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </Card>
      )}

      {/* ── Cable raceway ── */}
      {tab === 'raceway' && <RacewayTab doc={doc} res={res} edit={edit} explain={explain} usage={usage} onGo={goToRow} />}

      {/* ── Bill of Material ── */}
      {tab === 'bom' && (
        <BomTable doc={doc} res={res} links={links} setRow={setRow} edit={edit}
          offerable={offerable} costFor={costFor} explain={explain} onGoTab={setTab} focusRow={focusRow} />
      )}

      {/* ── Links: what is linked to what, and how ── */}
      {tab === 'links' && (
        <Card title={t('What is linked to what')}>
          <p className="text-[11px] text-slate-500">{t('Every result the calculation produces: the tab it is calculated on, the rule, the value now, and the Bill of Material rows that use it. Click a tab or a row to go there.')}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[900px]">
              <thead><tr className="text-[10px] uppercase tracking-wider text-slate-500">
                <th className="text-left py-1 pr-2">{t('Result')}</th><th className="text-left px-2">{t('Source tab')}</th><th className="text-left px-2">{t('Rule')}</th>
                <th className="text-right px-2">{t('Value')}</th><th className="text-left px-2">{t('Used in BOM rows')}</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-800/60">
                {links.filter((l) => l.value > 0 || usage.has(l.key)).map((l) => {
                  const ex = explain(l.key);
                  return (
                    <tr key={l.key} className="align-top">
                      <td className="py-1.5 pr-2 text-slate-200">{l.label}</td>
                      <td className="px-2 whitespace-nowrap"><button onClick={() => setTab(l.tab)} className="text-sky-300 hover:text-sky-200">{t(TAB_LABEL[l.tab])}</button></td>
                      <td className="px-2 text-slate-400">{ex ? t(ex.rule) : ''}</td>
                      <td className="px-2 text-right tabular-nums text-white whitespace-nowrap">{fmtN(l.value, l.value % 1 ? 2 : 0)} {l.unit}</td>
                      <td className="px-2"><UsedBy rows={usage.get(l.key) ?? []} onGo={goToRow} quiet={!MUST_USE.test(l.key)} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {(() => {
            const typed = doc.rows.filter((r) => r.qty.mode === 'typed' && (r.qty.value ?? 0) > 0);
            return typed.length > 0 && (
              <div className="space-y-1">
                <h4 className="text-xs font-bold text-white">{tf('Rows with a typed quantity ({n})', { n: typed.length })}</h4>
                <p className="text-[11px] text-slate-500">{t('These quantities are typed by hand, not calculated — check them against the drawings.')}</p>
                <div className="flex flex-wrap gap-1.5">
                  {typed.map((r) => (
                    <button key={r.id} onClick={() => goToRow(r.id)} className="px-2 py-0.5 rounded-md border border-slate-700 text-[11px] text-slate-300 hover:text-white hover:border-slate-500">
                      {r.description || t('Untitled')} · {fmtN(r.qty.mode === 'typed' ? r.qty.value ?? 0 : 0)} {r.unit}
                    </button>
                  ))}
                </div>
              </div>
            );
          })()}
        </Card>
      )}

      {/* ── Checks ── */}
      {tab === 'checks' && (
        <Card title={t('Checks')}>
          {res.checks.filter((c) => c.level !== 'ok').length === 0 && <p className="text-xs text-emerald-300">{t('Nothing to fix.')}</p>}
          <ul className="space-y-1.5">
            {res.checks.map((c, i) => (
              <li key={i} className={`text-xs rounded-lg px-3 py-1.5 border ${c.level === 'error' ? 'border-red-500/30 bg-red-500/5 text-red-200' : c.level === 'warn' ? 'border-amber-500/30 bg-amber-500/5 text-amber-200' : 'border-slate-800 text-slate-400'}`}>
                <span className="font-semibold">{c.where}</span> — {c.message}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

// ── The priced BOM ───────────────────────────────────────────────────────────
function BomTable({ doc, res, links, setRow, edit, offerable, costFor, explain, onGoTab, focusRow }: {
  doc: BomCalcDoc; res: ReturnType<typeof computeBomCalc>; links: ReturnType<typeof linkOptions>;
  setRow: (id: string, p: Partial<BomRow>) => void; edit: (fn: (d: BomCalcDoc) => BomCalcDoc) => void;
  offerable: Component[]; costFor: (componentId: string) => { cost: number } | null;
  explain: (key: string) => Explanation | null; onGoTab: (tab: Tab) => void; focusRow: string | null;
}) {
  const { t, tf } = useT();
  const [howOpen, setHowOpen] = useState<Set<string>>(new Set());
  const toggleHow = (id: string) => setHowOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const priced = new Map(res.rows.map((r) => [r.id, r]));
  const rowChecks = new Map<string, string>();
  for (const c of res.checks) if (c.level !== 'ok') { const r = doc.rows.find((x) => x.description === c.where); if (r && !rowChecks.has(r.id)) rowChecks.set(r.id, c.message); }
  const [pickFor, setPickFor] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const matches = useMemo(() => (pickFor && query.trim().length >= 2 ? catalogMatches(offerable, query, { limit: 8 }).shown : []), [pickFor, query, offerable]);

  const pick = (rowId: string, c: Component) => {
    const cost = costFor(String(c.component_id));
    setRow(rowId, { componentId: String(c.component_id), description: c.internal_description || c.supplier_model, brand: c.brand ?? '', cost: cost ? Math.round(cost.cost) : null });
    setPickFor(null); setQuery('');
  };

  return (
    <div className="space-y-4">
      {STANDARD_CATEGORIES.map((cat) => {
        const rows = doc.rows.filter((r) => r.category === cat.key);
        const tot = res.totals.byCategory[cat.key];
        return (
          <Card key={cat.key} title={cat.label} action={
            <div className="flex items-center gap-3">
              {tot && <span className="text-xs tabular-nums text-slate-300">{fmtRp(tot.total)}{tot.perWp != null && <span className="text-slate-500"> · {fmtN(tot.perWp)} Rp/Wp</span>}</span>}
              <button className={SMALL_BTN} onClick={() => edit((d) => ({ ...d, rows: [...d.rows, typedRow(cat.key, '', 'pcs')] }))}>{t('+ Row')}</button>
            </div>}>
            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[1100px]">
                <thead><tr className="text-[10px] uppercase tracking-wider text-slate-500">
                  <th className="text-left py-1 pr-2">{t('Description')}</th><th className="text-right px-1 w-36">{t('Qty')}</th><th className="px-1 w-16">{t('Unit')}</th>
                  <th className="text-right px-1 w-28">{t('Cost / unit')}</th><th className="text-right px-1 w-16">{t('Margin (%)')}</th>
                  <th className="text-right px-1 w-28">{t('Material price / unit')}</th><th className="text-right px-1 w-24">{t('Install / unit')}</th>
                  <th className="text-right px-1 w-32">{t('Total')}</th><th className="text-right px-1 w-16">Rp/Wp</th><th className="w-6" />
                </tr></thead>
                <tbody>
                  {rows.map((r) => {
                    const p = priced.get(r.id);
                    const problem = rowChecks.get(r.id);
                    return (
                      <React.Fragment key={r.id}>
                        <tr id={`row-${r.id}`} className={`align-top ${focusRow === r.id ? 'bg-sky-500/10' : ''}`}>
                          <td className="py-1 pr-2 relative">
                            <TextField value={r.description} title={r.componentId ? t('Linked to a catalogue item') : undefined}
                              onChange={(v) => { setRow(r.id, { description: v }); setPickFor(r.id); setQuery(v); }} />
                            {pickFor === r.id && matches.length > 0 && (
                              <div className="absolute z-20 left-0 right-2 mt-1 bg-slate-900 border border-slate-700 rounded-lg shadow-2xl overflow-hidden">
                                {matches.map((c) => (
                                  <button key={c.component_id} onMouseDown={(e) => { e.preventDefault(); pick(r.id, c); }}
                                    className="w-full text-left px-2.5 py-1.5 text-[11px] text-slate-300 hover:bg-white/10 border-b border-white/[0.04] last:border-0">
                                    {c.internal_description || c.supplier_model} <span className="text-slate-500">· {c.supplier_model}</span>
                                  </button>
                                ))}
                                <button onMouseDown={(e) => { e.preventDefault(); setPickFor(null); }} className="w-full text-left px-2.5 py-1 text-[10px] text-slate-500 hover:text-slate-300">{t('Keep as typed')}</button>
                              </div>
                            )}
                            {problem && <div className="text-[10px] text-amber-300 mt-0.5">{problem}</div>}
                          </td>
                          <td className="px-1">
                            {r.qty.mode === 'typed' ? (
                              <div className="flex gap-1">
                                <NumField value={r.qty.value} onChange={(v) => setRow(r.id, { qty: { mode: 'typed', value: v } })} />
                                <LinkSelect links={links} value="" placeholder="↔" title={t('Link the quantity to the calculation')} className="!w-8 !px-0.5 text-slate-500"
                                  onChange={(k) => k && setRow(r.id, { qty: { mode: 'link', key: k, factor: 1, add: 0, roundUp: false } })} />
                              </div>
                            ) : (() => {
                              const ex = explain(r.qty.key);
                              return (
                                <div className="space-y-0.5 text-right">
                                  <div className="flex items-center gap-1 justify-end">
                                    <span className="tabular-nums text-sky-300 font-semibold">{fmtN(p?.qty ?? 0, (p?.qty ?? 0) % 1 ? 2 : 0)}</span>
                                    <button className="text-[10px] text-slate-500 hover:text-white" title={t('Type the quantity instead')} onClick={() => setRow(r.id, { qty: { mode: 'typed', value: p?.qty ?? null } })}>✎</button>
                                  </div>
                                  {ex ? (
                                    <button onClick={() => onGoTab(ex.tab)} title={tf('Calculated on the {tab} tab', { tab: t(TAB_LABEL[ex.tab]) })}
                                      className="block w-full text-right text-[10px] text-sky-400/90 hover:text-sky-300 truncate">← {ex.label}</button>
                                  ) : <span className="block text-[10px] text-red-300">{r.qty.key}</span>}
                                  <button onClick={() => toggleHow(r.id)} className="text-[10px] text-slate-500 hover:text-white">{howOpen.has(r.id) ? t('Hide') : t('How?')}</button>
                                </div>
                              );
                            })()}
                          </td>
                          <td className="px-1"><TextField value={r.unit} onChange={(v) => setRow(r.id, { unit: v })} /></td>
                          <td className="px-1">
                            <NumField value={r.cost} onChange={(v) => setRow(r.id, { cost: v })} />
                            {r.componentId && (
                              <button className="text-[10px] text-slate-500 hover:text-emerald-300" title={t('Take the cost from the catalogue again (paid POs first, then the latest supplier quote)')}
                                onClick={() => { const c = costFor(r.componentId!); if (c) setRow(r.id, { cost: Math.round(c.cost) }); }}>
                                {t('↻ catalogue')}
                              </button>
                            )}
                          </td>
                          <td className="px-1"><NumField value={r.margin == null ? null : Math.round(r.margin * 10000) / 100} placeholder={String(Math.round(doc.project.defaultMargin * 10000) / 100)} onChange={(v) => setRow(r.id, { margin: v == null ? null : v / 100 })} /></td>
                          <td className="px-1 text-right tabular-nums text-slate-300 pt-1.5">{p && p.materialUnit ? fmtN(p.materialUnit) : '—'}</td>
                          <td className="px-1"><NumField value={r.install} onChange={(v) => setRow(r.id, { install: v })} /></td>
                          <td className="px-1 text-right tabular-nums text-white font-semibold pt-1.5">{p && p.total ? fmtN(p.total) : '—'}</td>
                          <td className="px-1 text-right tabular-nums text-slate-400 pt-1.5">{p?.perWp ? fmtN(p.perWp, 1) : ''}</td>
                          <td><button className={DEL_BTN} title={t('Remove')} onClick={() => edit((d) => ({ ...d, rows: d.rows.filter((x) => x.id !== r.id) }))}>×</button></td>
                        </tr>
                        {r.qty.mode === 'link' && howOpen.has(r.id) && (() => {
                          const q = r.qty;
                          const ex = explain(q.key);
                          return (
                            <tr><td colSpan={10} className="pb-2">
                              <div className="rounded-lg border border-sky-500/25 bg-sky-500/5 p-3 space-y-2 text-[11px]">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-slate-400">{t('Source of the quantity')}</span>
                                  <LinkSelect links={links} value={q.key} className="!w-auto max-w-[360px] text-sky-300" onChange={(k) => k && setRow(r.id, { qty: { ...q, key: k } })} />
                                  <span className="text-slate-500">×</span>
                                  <NumField value={q.factor} className="!w-16" onChange={(v) => setRow(r.id, { qty: { ...q, factor: v ?? 1 } })} />
                                  <span className="text-slate-500">+</span>
                                  <NumField value={q.add} className="!w-16" onChange={(v) => setRow(r.id, { qty: { ...q, add: v ?? 0 } })} />
                                  <label className="flex items-center gap-1 text-slate-400">
                                    <input type="checkbox" checked={q.roundUp} onChange={(e) => setRow(r.id, { qty: { ...q, roundUp: e.target.checked } })} className="accent-sky-500" />
                                    {t('Round up')}
                                  </label>
                                </div>
                                {ex && <>
                                  <div className="text-slate-300">
                                    {tf('Calculated on the {tab} tab: {rule}', { tab: t(TAB_LABEL[ex.tab]), rule: t(ex.rule) })}{' '}
                                    <button onClick={() => onGoTab(ex.tab)} className="text-sky-300 hover:text-sky-200">{t('Open it')} →</button>
                                  </div>
                                  {ex.parts.length > 0 && (
                                    <table className="text-[11px]">
                                      <tbody>
                                        {ex.parts.map((pt, i) => (
                                          <tr key={i}>
                                            <td className="pr-3 text-slate-400">{pt.label}</td>
                                            <td className="pr-3 text-slate-500 tabular-nums">{pt.detail}</td>
                                            <td className="text-right tabular-nums text-slate-200">{fmtN(pt.value, pt.value % 1 ? 2 : 0)}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  )}
                                  <div className="tabular-nums text-slate-200">
                                    {`${fmtN(ex.value, ex.value % 1 ? 2 : 0)} ${ex.unit} × ${q.factor} + ${q.add}${q.roundUp ? ' ↑' : ''} = `}
                                    <b className="text-sky-300">{fmtN(p?.qty ?? 0, (p?.qty ?? 0) % 1 ? 2 : 0)} {r.unit}</b>
                                  </div>
                                </>}
                              </div>
                            </td></tr>
                          );
                        })()}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        );
      })}
      <Card>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div><div className="text-[10px] uppercase tracking-wider text-slate-500">{t('Material total')}</div><div className="tabular-nums text-white">{fmtRp(res.totals.material)}</div></div>
          <div><div className="text-[10px] uppercase tracking-wider text-slate-500">{t('Installation')}</div><div className="tabular-nums text-white">{fmtRp(res.totals.install)}</div></div>
          <div><div className="text-[10px] uppercase tracking-wider text-slate-500">{t('Total (excl. PPN)')}</div><div className="tabular-nums text-white font-bold">{fmtRp(res.totals.total)}</div></div>
          <div><div className="text-[10px] uppercase tracking-wider text-slate-500">{tf('Incl. PPN {p}%', { p: doc.project.ppnPct })}</div><div className="tabular-nums text-white">{fmtRp(res.totals.totalInclPpn)}</div></div>
          <div><div className="text-[10px] uppercase tracking-wider text-slate-500">{t('Material cost')}</div><div className="tabular-nums text-slate-300">{fmtRp(res.totals.cost)}</div></div>
          <div><div className="text-[10px] uppercase tracking-wider text-slate-500">{t('Margin share of total')}</div><div className="tabular-nums text-slate-300">{res.totals.grossMarginPct == null ? '—' : `${res.totals.grossMarginPct} %`}</div></div>
          <div><div className="text-[10px] uppercase tracking-wider text-slate-500">Rp/Wp</div><div className="tabular-nums text-white">{res.totals.perWp == null ? '—' : fmtN(res.totals.perWp)}</div></div>
          <div><div className="text-[10px] uppercase tracking-wider text-slate-500">{t('Rp/Wp incl. PPN')}</div><div className="tabular-nums text-slate-300">{res.totals.perWpInclPpn == null ? '—' : fmtN(res.totals.perWpInclPpn)}</div></div>
        </div>
      </Card>
    </div>
  );
}
