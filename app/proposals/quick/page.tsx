'use client';
/**
 * Residential quick quote (owner, 2026-11-22: "the engineering will survey,
 * check, input variables and a quote immediately comes out").
 *
 * A phone screen for the site visit: the customer, the PLN bill, the system
 * wanted, the roof and two cable runs. lib/quickQuote sizes it (from the bill,
 * one inverter, rounding DOWN) and lays out the residential template; this
 * screen prices every line exactly as the proposal editor would (the same
 * cost base: useEpcCostBase + pickCost) at the quick-quote margin, and
 * "Create proposal" writes a normal draft EPC proposal (10.0 / 10.1 / 10.2),
 * opened in the editor to check and send. Lines a person must price — a
 * concrete or flat roof, a site outside Jabodetabek, an item with no cost on
 * record — go in without a price and with a "waiting for price" flag
 * (10.7_quote_item_flags), which the PDF warns about before it is saved.
 *
 * The answers are kept on the proposal (system_specs.quick) and on this
 * device until the proposal is created.
 */
import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useT } from '@/hooks/useT';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useProposalsGate } from '@/hooks/useProposalsGate';
import { useSupabaseData } from '@/hooks/useSupabaseData';
import { useSettings } from '@/hooks/useSettings';
import { useEpcCostBase } from '@/hooks/useEpcCostBase';
import { createSupabaseClient } from '@/lib/supabase';
import { computeTUCMap, pickCost, fxFromHistory, type CostEntry } from '@/lib/computeTUC';
import { deriveExchangeRates } from '@/lib/exchangeRates';
import { fetchUsedEntries } from '@/lib/usedPrices';
import { isOfferable } from '@/lib/itemVisibility';
import { fmtRupiah } from '@/lib/formatters';
import { TAGGABLE_ROLES } from '@/lib/quoteFlags';
import {
  sizeSystem, buildTemplate, sellAt, projectDescription, inverterSpec, batteryKwh, tariffForVa, matchesWords,
  type QqSurvey, type QqPanel, type QqInverter, type QqBattery, type QqLine, type QqNote,
} from '@/lib/quickQuote';
import BrandMenu from '@/components/ui/BrandMenu';
import { BAR_H } from '@/constants/controls';
import type { Component } from '@/types/database';

const DRAFT_KEY = 'icaproc.quickQuote.draft';
const PLN_VA = [900, 1300, 2200, 3500, 4400, 5500, 6600, 7700, 10600, 11000, 13200, 16500, 23000, 33000, 41500, 53000];

const blank: QqSurvey = {
  customerName: '', location: '', jabodetabek: true, system: 'on_grid',
  plnVa: 5500, plnPhase: 1, billRp: null, kwhMonth: null, tariff: tariffForVa(5500), sharePct: null,
  backupKw: 1.5, backupHours: 4, roof: 'metal', storeys: 2, maxPanels: null, dcRunM: 30, acRunM: 20,
};

const nameOf = (c?: Component | null) => (c?.internal_description?.trim() || c?.supplier_model || '');
const specsOf = (c: Component) => (c.specifications ?? null) as Record<string, unknown> | null;

interface PricedLine extends QqLine { componentId?: string; cost: number | null; sell: number | null; flag: string | null }

export default function QuickQuotePage() {
  const { t, tf } = useT();
  const router = useRouter();
  const supabase = createSupabaseClient();
  const gate = useProposalsGate('/proposals/quick');
  usePageTitle();
  const settings = useSettings();
  const cfg = settings.quickQuote;
  const { data: catalog, loading: catalogLoading } = useSupabaseData();

  // ── The survey, kept on this device until the proposal exists ─────────────
  const [s, setS] = useState<QqSurvey>(blank);
  const [panelId, setPanelId] = useState('');
  useEffect(() => {
    try { const raw = localStorage.getItem(DRAFT_KEY); if (raw) { const d = JSON.parse(raw); setS({ ...blank, ...d.s }); setPanelId(d.panelId ?? ''); } } catch { /* none */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ s, panelId })); } catch { /* private mode */ }
  }, [s, panelId]);
  const put = (patch: Partial<QqSurvey>) => setS((x) => ({ ...x, ...patch }));

  // ── Costs: the same base the proposal editor prices from ──────────────────
  const tucMap = useMemo(() => computeTUCMap(catalog.pos, catalog.poItems, catalog.poCosts), [catalog.pos, catalog.poItems, catalog.poCosts]);
  const fx = useMemo(
    () => fxFromHistory(catalog.pos, deriveExchangeRates(catalog.pos, catalog.poItems, catalog.poCosts, catalog.quotes), catalog.fxBenchmarks),
    [catalog.pos, catalog.poItems, catalog.poCosts, catalog.quotes, catalog.fxBenchmarks]);
  const { baseFor, loading: costLoading, error: costError } = useEpcCostBase({
    role: gate.profile?.role, components: catalog.components, tucMap,
    quotes: catalog.quotes, quoteItems: catalog.quoteItems, fx, globalBufferPct: settings.epcCostBufferPct,
  });
  const [used, setUsed] = useState<Map<string, CostEntry[]> | null>(null);
  useEffect(() => { if (gate.ready) fetchUsedEntries(supabase).then(setUsed).catch(() => setUsed(new Map())); }, [gate.ready]);   // eslint-disable-line react-hooks/exhaustive-deps
  const costFor = (id: string): number | null => {
    const cc = pickCost(baseFor(id), used?.get(id) ?? []);
    return cc ? Math.round(cc.cost) : null;
  };

  // ── The house range, read from the catalogue ──────────────────────────────
  const offer = useMemo(() => (catalog.components as Component[]).filter((c) => isOfferable(c)), [catalog.components]);
  const panels = useMemo<QqPanel[]>(() => offer
    .filter((c) => c.category === 'pv_module' && /ica solar/i.test(c.brand ?? '') && Number(specsOf(c)?.power_stc_w) >= 300)
    .map((c) => ({ componentId: c.component_id, name: nameOf(c), brand: c.brand ?? '', wp: Number(specsOf(c)?.power_stc_w) }))
    .sort((a, b) => a.wp - b.wp), [offer]);
  const panel = panels.find((p) => p.componentId === panelId) ?? panels.find((p) => p.wp === 450) ?? panels[0] ?? null;
  const inverters = useMemo<QqInverter[]>(() => offer.flatMap((c): QqInverter[] => {
    if (!/ica solar/i.test(c.brand ?? '')) return [];
    const sp = inverterSpec(specsOf(c));
    if (!sp) return [];
    if (c.category === 'on_grid_inverter') return [{ componentId: c.component_id, name: nameOf(c), brand: c.brand ?? '', ...sp, kind: 'on_grid', cost: costFor(c.component_id) }];
    // A residential hybrid runs a 48 V battery bank.
    if (c.category === 'inverter_charger' && Number(specsOf(c)?.battery_nominal_voltage_vdc) === 48)
      return [{ componentId: c.component_id, name: nameOf(c), brand: c.brand ?? '', ...sp, kind: 'hybrid', cost: costFor(c.component_id) }];
    return [];
  }), [offer, baseFor, used]);   // eslint-disable-line react-hooks/exhaustive-deps
  const battery = useMemo<QqBattery | null>(() => {
    const b = offer.find((c) => c.category === 'batteries' && /ical/i.test(c.brand ?? '') && batteryKwh(specsOf(c)) && Number(specsOf(c)?.nominal_voltage_v) === 48);
    return b ? { componentId: b.component_id, name: nameOf(b), brand: b.brand ?? '', kwh: batteryKwh(specsOf(b)) as number } : null;
  }, [offer]);

  // ── Size, lay out, price ──────────────────────────────────────────────────
  const size = useMemo(() => (panel ? sizeSystem(s, { panel, inverters, battery }, cfg) : null), [s, panel, inverters, battery, cfg]);
  const sections = useMemo(() => {
    if (!size) return [];
    const findMatch = (words: string[]) => offer.find((c) => matchesWords(nameOf(c), words) && costFor(c.component_id) != null)
      ?? offer.find((c) => matchesWords(nameOf(c), words));
    return buildTemplate(s, size, cfg).map((sec) => ({
      ...sec,
      lines: sec.lines.map((l): PricedLine => {
        const comp = l.componentId ? offer.find((c) => c.component_id === l.componentId) : l.match ? findMatch(l.match) : undefined;
        const catalogCost = comp ? costFor(comp.component_id) : null;
        const cost = l.needsPricing ? null : (catalogCost ?? l.cost);
        const flag = l.needsPricing ?? (cost == null ? 'No cost on record for this item: price it by hand.' : null);
        return {
          ...l, componentId: comp?.component_id, description: comp ? nameOf(comp) : l.description, brand: comp?.brand ?? l.brand ?? '',
          cost, sell: cost == null ? null : sellAt(cost, cfg.marginPct), flag,
        };
      }),
    }));
  }, [s, size, cfg, offer, baseFor, used]);   // eslint-disable-line react-hooks/exhaustive-deps
  const lines = sections.flatMap((x) => x.lines);
  const total = lines.reduce((a, l) => a + (l.sell ?? 0) * l.qty, 0);
  const flagged = lines.filter((l) => l.flag);
  const ready = gate.ready && !catalogLoading && !costLoading && used != null;

  // ── Create the proposal ───────────────────────────────────────────────────
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState('');
  async function create() {
    if (!size || !size.panels || !s.customerName.trim()) return;
    setCreating(true); setErr('');
    try {
      const today = new Date().toISOString().slice(0, 10);
      const quoteId = crypto.randomUUID();
      const { error: qErr } = await supabase.from('10.0_project_quotes').insert({
        quote_id: quoteId,
        quote_number: `Q-${today.replace(/-/g, '')}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
        quote_date: today,
        customer_name: s.customerName.trim(),
        location: s.location.trim() || null,
        project_type: s.system === 'hybrid' ? 'hybrid_bess' : 'on_grid',
        project_description: projectDescription(s, size),
        system_specs: {
          kwp_dc: size.kwp, kw_ac: size.inverter?.kw ?? null, ...(s.system === 'hybrid' ? { kwh_bess: size.kwh } : {}),
          quick: { survey: s, panelId: panel?.componentId, monthlyKwh: Math.round(size.monthlyKwh), sharePct: size.sharePct, made: new Date().toISOString() },
        },
        group_margins: { solar_panels: cfg.marginPct, bos: cfg.marginPct, services: cfg.marginPct },
      });
      if (qErr) throw qErr;
      const secRows = sections.map((sec, i) => ({ section_id: crypto.randomUUID(), quote_id: quoteId, title: sec.title, group_key: sec.group, lead_time: 'Ready', sort_order: i }));
      const { error: sErr } = await supabase.from('10.1_quote_sections').insert(secRows);
      if (sErr) throw sErr;
      const itemRows = sections.flatMap((sec, i) => sec.lines.map((l, j) => ({
        item_id: crypto.randomUUID(), section_id: secRows[i].section_id, quote_id: quoteId,
        component_id: l.componentId ?? null, description: l.description, brand: l.brand ?? '',
        quantity: l.qty, unit: l.unit, cost_price: l.cost, sell_price: l.sell, sort_order: j,
        eng_note: l.flag ?? '',
      })));
      const { error: iErr } = await supabase.from('10.2_quote_items').insert(itemRows);
      if (iErr) throw iErr;
      // Lines waiting for a price: flagged to the engineer who made the survey.
      const me = gate.profile?.email;
      const flagRows = itemRows.filter((r) => r.eng_note).map((r) => ({ quote_id: quoteId, item_id: r.item_id, kind: 'price', assignee_email: me, note: r.eng_note }));
      if (flagRows.length && me && (TAGGABLE_ROLES as readonly string[]).includes(gate.profile?.role ?? '')) {
        await supabase.from('10.7_quote_item_flags').insert(flagRows);
      }
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* fine */ }
      router.push(`/proposals/${quoteId}`);
    } catch (e) {
      setErr((e as { message?: string })?.message || String(e));
      setCreating(false);
    }
  }

  const noteText = (n: QqNote) => (n.vars ? tf(n.text, n.vars) : t(n.text));
  const field = `w-full ${BAR_H} px-3 rounded-lg bg-slate-800 border border-slate-700 text-white text-base sm:text-[13px] outline-none focus:ring-1 focus:ring-emerald-500/40`;
  const label = 'block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1';
  const numIn = (v: number | null, onChange: (n: number | null) => void, extra: Record<string, string | number> = {}) => (
    <input type="number" inputMode="decimal" className={field} value={v ?? ''} {...extra}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} />
  );
  const choice = <T extends string | number>(value: T, options: [T, string][], onPick: (v: T) => void) => (
    <div className="flex gap-1.5 flex-wrap">
      {options.map(([v, l]) => (
        <button key={String(v)} type="button" onClick={() => onPick(v)} aria-pressed={value === v}
          className={`${BAR_H} px-3 rounded-lg border text-[13px] font-medium ${value === v ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300' : 'bg-slate-800 border-slate-700 text-slate-300'}`}>{l}</button>
      ))}
    </div>
  );
  const card = 'rounded-2xl border border-slate-800 bg-slate-900/40 p-4 space-y-3';

  if (!gate.ready) return null;
  return (
    <div className="min-h-screen bg-chrome text-slate-200 font-sans text-sm pb-28">
      <div className="border-b border-slate-800/60 bg-chrome/80 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-3xl mx-auto px-3 sm:px-4 py-2.5 flex items-center justify-between gap-2">
          <BrandMenu wordmarkClass="text-xl md:text-2xl font-extrabold" subtitle={t('Residential quick quote')} />
          <Link href="/proposals" className="text-[12px] text-slate-400 hover:text-slate-200">← {t('Proposals')}</Link>
        </div>
      </div>

      <main className="max-w-3xl mx-auto px-3 sm:px-4 py-4 space-y-4">
        <section className={card}>
          <h2 className="text-slate-100 font-semibold">1. {t('Customer')}</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            <div><label className={label}>{t('Customer name')}</label><input className={field} value={s.customerName} onChange={(e) => put({ customerName: e.target.value })} /></div>
            <div><label className={label}>{t('Location')}</label><input className={field} value={s.location} onChange={(e) => put({ location: e.target.value })} placeholder="Petojo Utara, Gambir, Jakarta Pusat" /></div>
          </div>
          <div><label className={label}>{t('Area')}</label>{choice(s.jabodetabek ? 'in' : 'out', [['in', t('Jabodetabek')], ['out', t('Outside Jabodetabek')]], (v) => put({ jabodetabek: v === 'in' }))}</div>
        </section>

        <section className={card}>
          <h2 className="text-slate-100 font-semibold">2. {t('PLN and usage')}</h2>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={label}>{t('PLN connection (VA)')}</label>
              <select className={field} value={s.plnVa} onChange={(e) => { const va = Number(e.target.value); put({ plnVa: va, tariff: tariffForVa(va), plnPhase: va >= 6600 && s.plnPhase === 1 && va > 7700 ? 3 : s.plnPhase }); }}>
                {PLN_VA.map((v) => <option key={v} value={v}>{v.toLocaleString('id-ID')} VA</option>)}
              </select></div>
            <div><label className={label}>{t('Phase')}</label>{choice(s.plnPhase, [[1, t('1-phase')], [3, t('3-phase')]], (v) => put({ plnPhase: v }))}</div>
            <div><label className={label}>{t('Monthly bill (Rp)')}</label>{numIn(s.billRp, (n) => put({ billRp: n }), { step: 50000 })}</div>
            <div><label className={label}>{t('or kWh per month')}</label>{numIn(s.kwhMonth, (n) => put({ kwhMonth: n }))}</div>
          </div>
          <p className="text-[11px] text-slate-500">{tf('Tariff {rate} Rp/kWh for this connection. kWh from the bill wins when both are filled.', { rate: s.tariff.toLocaleString('id-ID') })}</p>
        </section>

        <section className={card}>
          <h2 className="text-slate-100 font-semibold">3. {t('System')}</h2>
          {choice(s.system, [['on_grid', t('On-grid')], ['hybrid', t('Hybrid with battery')]], (v) => put({ system: v, sharePct: null }))}
          <div className="grid grid-cols-2 gap-3">
            <div><label className={label}>{t('Cover (% of usage)')}</label>{numIn(s.sharePct ?? (s.system === 'hybrid' ? cfg.sharePctHybrid : cfg.sharePctOnGrid), (n) => put({ sharePct: n }))}</div>
            <div><label className={label}>{t('Panel')}</label>
              <select className={field} value={panel?.componentId ?? ''} onChange={(e) => setPanelId(e.target.value)}>
                {panels.map((p) => <option key={p.componentId} value={p.componentId}>{p.wp} Wp · {p.name}</option>)}
              </select></div>
            {s.system === 'hybrid' && (<>
              <div><label className={label}>{t('Backup load (kW)')}</label>{numIn(s.backupKw, (n) => put({ backupKw: n ?? 0 }), { step: 0.5 })}</div>
              <div><label className={label}>{t('Backup hours')}</label>{numIn(s.backupHours, (n) => put({ backupHours: n ?? 0 }))}</div>
            </>)}
          </div>
        </section>

        <section className={card}>
          <h2 className="text-slate-100 font-semibold">4. {t('Roof and cable runs')}</h2>
          <div><label className={label}>{t('Roof')}</label>{choice(s.roof, [['metal', t('Metal')], ['tile', t('Tile')], ['concrete', t('Concrete')], ['flat', t('Flat')]], (v) => put({ roof: v }))}</div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={label}>{t('Storeys')}</label>{numIn(s.storeys, (n) => put({ storeys: Math.max(1, Math.round(n ?? 1)) }))}</div>
            <div><label className={label}>{t('Panels that fit (empty = no limit)')}</label>{numIn(s.maxPanels, (n) => put({ maxPanels: n == null ? null : Math.max(0, Math.round(n)) }))}</div>
            <div><label className={label}>{t('Panels → inverter (m)')}</label>{numIn(s.dcRunM, (n) => put({ dcRunM: n ?? 0 }))}</div>
            <div><label className={label}>{t('Inverter → PLN panel (m)')}</label>{numIn(s.acRunM, (n) => put({ acRunM: n ?? 0 }))}</div>
          </div>
        </section>

        {/* The answer */}
        <section className="rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.05] p-4 space-y-3">
          <h2 className="text-slate-100 font-semibold">{t('Quick quote')}</h2>
          {!ready ? <p className="text-slate-400">{t('Loading the catalogue and costs…')}</p>
            : costError ? <p className="text-rose-300">{tf('Costs could not be read: {error}', { error: costError })}</p>
            : !panel ? <p className="text-rose-300">{t('No house panel in the catalogue.')}</p>
            : size && (<>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Stat k={t('Usage')} v={`${Math.round(size.monthlyKwh).toLocaleString('id-ID')} kWh/${t('month')}`} />
                <Stat k={t('Array')} v={`${size.panels} × ${panel.wp} Wp = ${size.kwp.toLocaleString('id-ID')} kWp`} />
                <Stat k={t('Inverter')} v={size.inverter ? `${size.inverter.kw} kW · ${size.inverter.phase}P` : '—'} />
                <Stat k={s.system === 'hybrid' ? t('Battery') : t('Total')} v={s.system === 'hybrid' ? `${size.batteries} × ${battery?.kwh ?? 0} = ${size.kwh} kWh` : fmtRupiah(total)} />
              </div>
              {s.system === 'hybrid' && <p className="text-slate-100 font-semibold">{t('Total')} {fmtRupiah(total)} <span className="text-[11px] font-normal text-slate-400">{t('excl. PPN')}</span></p>}
              {size.notes.length > 0 && <ul className="text-[12px] text-slate-400 space-y-0.5">{size.notes.map((n, i) => <li key={i}>· {noteText(n)}</li>)}</ul>}
              {flagged.length > 0 && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-[12px] text-amber-200 space-y-1">
                  <p className="font-semibold">{tf('{n} line(s) go in without a price, flagged for you:', { n: flagged.length })}</p>
                  {flagged.map((l, i) => <p key={i}>⚠ {l.description}: {t(l.flag as string)}</p>)}
                </div>
              )}
              <details className="text-[12px]">
                <summary className="cursor-pointer text-slate-300">{tf('All {n} lines', { n: lines.length })}</summary>
                <div className="mt-2 space-y-3">
                  {sections.map((sec) => (
                    <div key={sec.title}>
                      <p className="text-slate-400 font-semibold uppercase tracking-wider text-[10px]">{sec.title}</p>
                      {sec.lines.map((l, i) => (
                        <div key={i} className="flex gap-2 py-0.5 border-b border-slate-800/60">
                          <span className="flex-1 min-w-0 truncate text-slate-200">{l.description}</span>
                          <span className="text-slate-400 tabular-nums whitespace-nowrap">{l.qty.toLocaleString('id-ID')} {l.unit}</span>
                          <span className={`tabular-nums whitespace-nowrap w-28 text-right ${l.sell == null ? 'text-amber-300' : 'text-slate-200'}`}>{l.sell == null ? t('to price') : fmtRupiah(l.sell * l.qty)}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </details>
            </>)}
          {err && <p className="text-rose-300 text-[12px]">{err}</p>}
        </section>
      </main>

      {/* Always one tap away */}
      {/* Above the phone's bottom menu (58 px, BrandMenu), as QuoteBasket does; at the bottom on desktop. */}
      <div className="fixed inset-x-0 z-30 bottom-[calc(env(safe-area-inset-bottom)+58px)] md:bottom-0 border-t border-slate-800 bg-chrome/95 backdrop-blur-md">
        <div className="max-w-3xl mx-auto px-3 sm:px-4 py-3 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-slate-100 font-semibold tabular-nums">{ready && size ? fmtRupiah(total) : '—'}</p>
            <p className="text-[11px] text-slate-500 truncate">{size ? `${size.kwp.toLocaleString('id-ID')} kWp${size.inverter ? ` · ${size.inverter.kw} kW` : ''}${size.kwh ? ` · ${size.kwh} kWh` : ''}` : ''}</p>
          </div>
          <button type="button" onClick={() => void create()}
            disabled={!ready || creating || !size?.panels || !s.customerName.trim()}
            title={!s.customerName.trim() ? t('Enter the customer name first') : undefined}
            className="h-11 px-5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold disabled:opacity-40">
            {creating ? t('Creating…') : t('Create proposal')}
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-slate-500">{k}</p>
      <p className="text-slate-100 font-semibold text-[13px]">{v}</p>
    </div>
  );
}
