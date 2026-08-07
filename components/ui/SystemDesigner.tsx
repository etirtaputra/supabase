'use client';
/**
 * System Designer — the full solar system wizard inside the sales quote.
 *
 * Three steps, one engine:
 *  1. CONTEXT   — what kind of system, which panel, how it sits on the roof.
 *  2. DEMAND    — on-grid: the PLN connection; off-grid/hybrid: the load table.
 *  3. REVIEW    — the v7 engine's picks (inverter, battery bank, array) and the
 *                 balance of system, each resolved to real catalog items at
 *                 this customer's tier, with live stock and every engineering
 *                 warning visible BEFORE anything lands on the quotation.
 *
 * Nothing here writes to the database: it hands finished lines back to the
 * quote editor, which owns saving. Every generated line is stamped with a
 * `design_role`, so REGENERATE replaces exactly what the engine owns and never
 * a hand-typed line. The wizard's answers persist on `22.0.system_design`, and
 * reopening the designer starts from them.
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { createSupabaseClient } from '@/lib/supabase';
import { fmtInt, fmtRupiah } from '@/lib/formatters';
import { specNumber, specReadiness } from '@/lib/specSchema';
import { isHiddenItem } from '@/lib/itemVisibility';
import { RAIL_LENGTHS_MM, type MountType, type Orientation } from '@/lib/systemDesign/mounting';
import { resolveBom, summarise, type DesignCandidate } from '@/lib/systemDesign/resolve';
import { mountingSystems, shortlist, RAIL_PROFILE_LABEL, type RailProfile } from '@/lib/systemDesign/mountingSystem';
import { designRoleOf, type SystemDesign } from '@/lib/systemDesign/types';
import {
  calculateSystem, type SystemType, type BatteryPreference, type LoadRow,
  type PanelSpec, type OnGridInverterSpec, type HybridInverterSpec, type BatterySpec,
} from '@/lib/systemDesign/system';
import type { DesignedLine } from './MountingDesigner';

/** Both designers quote from the same mounting family — one remembered choice. */
const SYSTEM_KEY = 'icaproc.mountingDesigner.system';

/** The PLN connections a customer actually has. VA, as printed on the meter. */
const PLN_CAPACITIES = [1300, 2200, 3500, 4400, 5500, 7700, 11000, 13200, 16500, 23000, 33000, 41500, 53000];

interface EditableLoad { name: string; watts: string; hours: string; qty: string; inductive: boolean; }
const blankLoad = (): EditableLoad => ({ name: '', watts: '', hours: '', qty: '1', inductive: false });

export default function SystemDesigner({ open, onClose, priceOf, stockOf, onApply, hasExisting, initial }: {
  open: boolean;
  onClose: () => void;
  /** The customer's tier price for a component — owned by the quote editor. */
  priceOf: (componentId: string) => number | null;
  stockOf: (componentId: string) => number | null;
  onApply: (lines: DesignedLine[], design: SystemDesign) => void;
  /** Are there already generated lines on this quote? Then this is a REGENERATE. */
  hasExisting: boolean;
  /** The stored design of a previous run — the wizard reopens on its answers. */
  initial?: SystemDesign | null;
}) {
  const supabase = createSupabaseClient();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const [step, setStep] = useState(0);
  const [rows, setRows] = useState<DesignCandidate[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Step 1 · Context ──────────────────────────────────────────────────────
  const [systemType, setSystemType] = useState<SystemType>('on-grid');
  const [panelId, setPanelId] = useState('');
  const [batteryPref, setBatteryPref] = useState<BatteryPreference>('LiFePO4');
  const [psh, setPsh] = useState('4');
  const [autonomy, setAutonomy] = useState('1');
  // Array layout — feeds the mounting engine exactly like the mounting designer
  const [numberOfRows, setNumberOfRows] = useState('1');
  const [railKey, setRailKey] = useState(String(RAIL_LENGTHS_MM[0]));
  const [railCustom, setRailCustom] = useState('');
  const [panelSpacing, setPanelSpacing] = useState('20');
  const [mountType, setMountType] = useState<MountType>('roof');
  const [orientation, setOrientation] = useState<Orientation>('portrait');
  // The mounting family, shared with the mounting designer
  const [series, setSeries] = useState('');
  const [profile, setProfile] = useState<RailProfile | ''>('t_slot');
  const storedChoice = useRef(false);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SYSTEM_KEY);
      if (raw) { const v = JSON.parse(raw); storedChoice.current = true; setSeries(v.series ?? ''); setProfile(v.profile ?? 't_slot'); }
    } catch {}
  }, []);
  useEffect(() => {
    try { window.localStorage.setItem(SYSTEM_KEY, JSON.stringify({ series, profile })); } catch {}
  }, [series, profile]);

  // ── Step 2 · Demand ───────────────────────────────────────────────────────
  const [plnKey, setPlnKey] = useState('5500');
  const [plnCustom, setPlnCustom] = useState('');
  const [gridPhase, setGridPhase] = useState<1 | 3>(1);
  const [dcAcRatio, setDcAcRatio] = useState('1.2');
  const [loads, setLoads] = useState<EditableLoad[]>([blankLoad()]);

  // A previous run's answers are the starting point — regenerate means
  // "same questions, current catalog", not "start over".
  const applied = useRef(false);
  useEffect(() => {
    if (!open || applied.current) return;
    const inp = initial?.engine === 'system' ? (initial.input as Record<string, unknown>) : null;
    if (!inp) return;
    applied.current = true;
    if (inp.systemType) setSystemType(inp.systemType as SystemType);
    if (inp.panelId) setPanelId(String(inp.panelId));
    if (inp.batteryPreference) setBatteryPref(inp.batteryPreference as BatteryPreference);
    if (inp.pshHours != null) setPsh(String(inp.pshHours));
    if (inp.autonomyDays != null) setAutonomy(String(inp.autonomyDays));
    if (inp.rows != null) setNumberOfRows(String(inp.rows));
    if (inp.railKey) setRailKey(String(inp.railKey));
    if (inp.railCustom) setRailCustom(String(inp.railCustom));
    if (inp.panelSpacingMm != null) setPanelSpacing(String(inp.panelSpacingMm));
    if (inp.mountType) setMountType(inp.mountType as MountType);
    if (inp.orientation) setOrientation(inp.orientation as Orientation);
    if (inp.series != null) { storedChoice.current = true; setSeries(String(inp.series)); }
    if (inp.profile != null) setProfile(inp.profile as RailProfile | '');
    if (inp.plnKey) setPlnKey(String(inp.plnKey));
    if (inp.plnCustom) setPlnCustom(String(inp.plnCustom));
    if (inp.gridPhase) setGridPhase(Number(inp.gridPhase) === 3 ? 3 : 1);
    if (inp.dcAcRatio != null) setDcAcRatio(String(inp.dcAcRatio));
    if (Array.isArray(inp.loads) && inp.loads.length) {
      setLoads((inp.loads as LoadRow[]).map((l) => ({
        name: l.name ?? '', watts: String(l.watts ?? ''), hours: String(l.hoursPerDay ?? ''),
        qty: String(l.qty ?? '1'), inductive: !!l.inductive,
      })));
    }
  }, [open, initial]);

  // Every design candidate in one fetch: the electrical picks, the structure,
  // and the balance-of-system roles (cable, connectors, protection).
  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('3.0_components')
      .select('component_id, supplier_model, internal_description, category, unit, specifications, quote_cost_mode, show_tuc_in_quotes')
      .in('category', ['pv_module', 'on_grid_inverter', 'inverter_charger', 'batteries', 'mounting', 'accessories', 'pv_cable'])
      .limit(3000);
    setRows((data as DesignCandidate[]) ?? []);
    setLoading(false);
  }, [supabase]);
  useEffect(() => { if (open) load(); }, [open, load]);

  const byId = useMemo(() => new Map(rows.map((r) => [r.component_id, r])), [rows]);
  const nameOf = (c: DesignCandidate) => (c.internal_description ?? '').trim() || c.supplier_model;

  // Only calculator-ready, visible items may be design candidates — the same
  // two gates as every other customer-facing picker.
  const readyOf = useCallback((category: string) => rows.filter((c) =>
    c.category === category && !isHiddenItem(c) && specReadiness(c.category, c.specifications).ready), [rows]);

  /** In stock beats not, priced beats unpriced, then cheapest — the resolver's rule. */
  const preferOrder = useCallback((a: DesignCandidate, b: DesignCandidate) => {
    const sa = (stockOf(a.component_id) ?? 0) > 0 ? 1 : 0;
    const sb = (stockOf(b.component_id) ?? 0) > 0 ? 1 : 0;
    if (sa !== sb) return sb - sa;
    const pa = priceOf(a.component_id), pb = priceOf(b.component_id);
    const ha = pa != null && pa > 0 ? 1 : 0, hb = pb != null && pb > 0 ? 1 : 0;
    if (ha !== hb) return hb - ha;
    if (ha && hb) return (pa as number) - (pb as number);
    return a.component_id.localeCompare(b.component_id);
  }, [priceOf, stockOf]);

  const panelOptions = useMemo(() => readyOf('pv_module').sort((a, b) => nameOf(a).localeCompare(nameOf(b))), [readyOf]);

  const panelSpec = useMemo((): PanelSpec | null => {
    const c = byId.get(panelId);
    if (!c) return null;
    const s = c.specifications ?? {};
    return {
      component_id: c.component_id, model: nameOf(c),
      power_stc_w: specNumber(s.power_stc_w) ?? 0,
      voc_stc_v: specNumber(s.voc_stc_v) ?? 0,
      dimensions_l_w_h_mm: String(s.dimensions_l_w_h_mm ?? ''),
    };
  }, [byId, panelId]);

  const onGridCandidates = useMemo((): OnGridInverterSpec[] =>
    readyOf('on_grid_inverter').sort(preferOrder).map((c) => {
      const s = c.specifications ?? {};
      return {
        component_id: c.component_id, model: nameOf(c),
        rated_output_power_kw: specNumber(s.rated_output_power_kw) ?? 0,
        nominal_ac_voltage_vac: String(s.nominal_ac_voltage_vac ?? ''),
        pv_max_voltage_vdc: specNumber(s.pv_max_voltage_vdc),
        no_of_mppts: specNumber(s.no_of_mppts),
        strings_per_mppt: specNumber(s.strings_per_mppt),
      };
    }), [readyOf, preferOrder]);

  const hybridCandidates = useMemo((): HybridInverterSpec[] =>
    readyOf('inverter_charger').sort(preferOrder).map((c) => {
      const s = c.specifications ?? {};
      return {
        component_id: c.component_id, model: nameOf(c),
        rated_output_power_w: specNumber(s.rated_output_power_w) ?? 0,
        battery_nominal_voltage_vdc: specNumber(s.battery_nominal_voltage_vdc),
        surge_power_va: specNumber(s.surge_power_va),
        pv_max_open_circuit_voltage_vdc: specNumber(s.pv_max_open_circuit_voltage_vdc),
        no_of_mpp_trackers: specNumber(s.no_of_mpp_trackers),
        phase: s.phase != null ? String(s.phase) : null,
      };
    }), [readyOf, preferOrder]);

  const batteryCandidates = useMemo((): BatterySpec[] =>
    readyOf('batteries').sort(preferOrder).map((c) => {
      const s = c.specifications ?? {};
      return {
        component_id: c.component_id, model: nameOf(c),
        battery_type: String(s.battery_type ?? ''),
        nominal_voltage_v: specNumber(s.nominal_voltage_v) ?? 0,
        energy_wh: specNumber(s.energy_wh) ?? 0,
        rated_capacity_ah: specNumber(s.rated_capacity_ah),
      };
    }), [readyOf, preferOrder]);

  // The BoS resolves against the chosen mounting family plus everything that
  // carries a bom_role outside the structure (cable, MC4, protection).
  const mountingCands = useMemo(() => rows.filter((c) => c.category === 'mounting'), [rows]);
  const systems = useMemo(() => mountingSystems(mountingCands, profile || undefined), [mountingCands, profile]);
  const chosen = useMemo(() => systems.find((x) => x.series === series) ?? null, [systems, series]);
  useEffect(() => {
    if (storedChoice.current || series || !systems.length) return;
    const preferred = systems.find((x) => /\bMD\b/.test(x.series)) ?? systems[0];
    if (preferred) setSeries(preferred.series);
  }, [systems]);   // eslint-disable-line react-hooks/exhaustive-deps
  const railChoices = useMemo(
    () => (chosen?.railLengths.length ? chosen.railLengths : [...RAIL_LENGTHS_MM]), [chosen]);
  useEffect(() => {
    if (railKey === 'custom') return;
    if (!railChoices.includes(Number(railKey))) setRailKey(String(railChoices[railChoices.length - 1] ?? ''));
  }, [railChoices]);   // eslint-disable-line react-hooks/exhaustive-deps
  const resolveCands = useMemo(() => [
    ...shortlist(mountingCands, series, profile || undefined),
    ...rows.filter((c) => c.category === 'accessories' || c.category === 'pv_cable'),
  ], [mountingCands, series, profile, rows]);

  const railLengthMm = railKey === 'custom' ? Number(railCustom) || 0 : Number(railKey);
  const gridVA = plnKey === 'custom' ? Number(plnCustom) || 0 : Number(plnKey);

  const loadRows = useMemo((): LoadRow[] => loads
    .filter((l) => Number(l.watts) > 0 && Number(l.qty) > 0)
    .map((l) => ({ name: l.name, watts: Number(l.watts), hoursPerDay: Number(l.hours) || 0, qty: Number(l.qty), inductive: l.inductive })), [loads]);

  // ── The engine run — recomputed live on the review step ───────────────────
  const result = useMemo(() => {
    if (!panelSpec || !panelSpec.power_stc_w) return null;
    return calculateSystem({
      systemType, panel: panelSpec,
      gridVA, gridPhase, dcAcRatio: Number(dcAcRatio) || 1,
      loads: loadRows, autonomyDays: Number(autonomy) || 1, pshHours: Number(psh) || 1,
      batteryPreference: batteryPref,
      rows: Number(numberOfRows) || 1, railLengthMm, panelSpacingMm: Number(panelSpacing) || 0,
      mountType, orientation,
    }, {
      onGridInverters: onGridCandidates,
      hybridInverters: hybridCandidates,
      batteries: batteryCandidates,
    });
  }, [panelSpec, systemType, gridVA, gridPhase, dcAcRatio, loadRows, autonomy, psh, batteryPref,
    numberOfRows, railLengthMm, panelSpacing, mountType, orientation,
    onGridCandidates, hybridCandidates, batteryCandidates]);

  const resolved = useMemo(
    () => (result?.ok ? resolveBom(result.lines, { candidates: resolveCands, priceOf, stockOf }) : []),
    [result, resolveCands, priceOf, stockOf]);
  const bosTotals = useMemo(() => summarise(resolved), [resolved]);

  const pickTotal = useMemo(() => (result?.ok ? result.picks.reduce((sum, p) => {
    const price = p.component_id ? priceOf(p.component_id) : null;
    return sum + (price != null && price > 0 ? price * p.qty : 0);
  }, 0) : 0), [result, priceOf]);

  if (!open || !mounted) return null;

  const canNext = step === 0
    ? !!panelSpec
    : systemType === 'on-grid' ? gridVA > 0 : loadRows.length > 0;

  const apply = () => {
    if (!result?.ok) return;
    const pickLines: DesignedLine[] = result.picks.map((p, i) => {
      const c = p.component_id ? byId.get(p.component_id) : undefined;
      const price = p.component_id ? priceOf(p.component_id) : null;
      return {
        component_id: p.component_id,
        description: c ? nameOf(c) : p.label,
        unit: c?.unit ?? 'unit',
        quantity: String(p.qty),
        unit_price: price != null ? String(Math.round(price)) : '',
        note: p.note ?? '',
        design_role: `system_pick_${i}`,
      };
    });
    const bosLines: DesignedLine[] = resolved.map((l) => ({
      component_id: l.component_id,
      description: l.description,
      unit: l.unit,
      quantity: String(l.qty),
      unit_price: l.unitPrice != null ? String(Math.round(l.unitPrice)) : '',
      note: [l.note, l.resolved ? '' : 'not in catalog — price by hand'].filter(Boolean).join(' · '),
      design_role: designRoleOf(l),
    }));
    const design: SystemDesign = {
      engine: 'system',
      version: 7,
      input: {
        systemType, panelId, panelLabel: panelSpec?.model ?? '',
        batteryPreference: batteryPref, pshHours: Number(psh) || 0, autonomyDays: Number(autonomy) || 0,
        gridVA, gridPhase, dcAcRatio: Number(dcAcRatio) || 1, plnKey, plnCustom,
        loads: loadRows,
        rows: Number(numberOfRows) || 1, railKey, railCustom, railLengthMm,
        panelSpacingMm: Number(panelSpacing) || 0, mountType, orientation, series, profile,
      },
      warnings: [...(result.errors), ...(result.warnings)],
      generated_at: new Date().toISOString(),
    };
    onApply([...pickLines, ...bosLines], design);
    onClose();
  };

  const inp = 'w-full h-9 px-3 rounded-lg bg-slate-950 border border-slate-600 focus:border-emerald-500 outline-none text-white text-sm transition-colors';
  const inpNeeded = 'w-full h-9 px-3 rounded-lg bg-amber-500/[0.07] border border-amber-500/60 focus:border-amber-400 outline-none text-white text-sm transition-colors placeholder:text-amber-200/40';
  const lbl = 'block text-[10px] uppercase tracking-widest text-slate-500 mb-1';
  const stepTitles = ['Context', systemType === 'on-grid' ? 'PLN connection' : 'Loads', 'Review'];

  return createPortal(
    <div className="fixed inset-0 z-[130] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-slate-900 border border-slate-700 sm:rounded-2xl rounded-t-2xl w-full max-w-5xl max-h-[92vh] overflow-y-auto p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold text-white">Design the solar system</h3>
            <p className="text-[10px] text-slate-600 mt-0.5">
              Smart Solar BoM v7 · sized here, priced at this customer&apos;s tier
            </p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white p-1 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* The three steps, walkable in both directions */}
        <div className="flex items-center gap-2">
          {stepTitles.map((t, i) => (
            <button key={t} onClick={() => { if (i < step || (i <= step + 1 && canNext)) setStep(i); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold transition-colors ${
                i === step ? 'bg-emerald-600 text-white'
                : i < step ? 'bg-slate-800 text-emerald-300 hover:bg-slate-700'
                : 'bg-slate-800/50 text-slate-500'}`}>
              <span className="tabular-nums">{i + 1}</span> {t}
            </button>
          ))}
          {loading && <span className="text-[10px] text-slate-600 ml-2">loading catalog…</span>}
        </div>

        {/* ── Step 1 · Context ── */}
        {step === 0 && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              {(['on-grid', 'off-grid', 'hybrid'] as SystemType[]).map((t) => (
                <button key={t} onClick={() => setSystemType(t)}
                  className={`px-3 py-2.5 rounded-xl border text-sm font-semibold transition-colors ${
                    systemType === t ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300' : 'border-slate-700 text-slate-400 hover:border-slate-500'}`}>
                  {t === 'on-grid' ? 'On-grid (PLN)' : t === 'off-grid' ? 'Off-grid' : 'Hybrid'}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-500">
              {systemType === 'on-grid'
                ? 'The PLN connection caps the inverter; the DC/AC ratio sets the array. No battery.'
                : 'The load table sets the inverter, the autonomy sets the battery bank, the sun hours set the array.'}
            </p>

            <div className="grid sm:grid-cols-2 gap-3">
              <label className="block sm:col-span-2">
                <span className={lbl}>PV module</span>
                <select className={panelId ? inp : inpNeeded} value={panelId} onChange={(e) => setPanelId(e.target.value)}>
                  <option value="">— pick a calculator-ready panel —</option>
                  {panelOptions.map((c) => {
                    const s = c.specifications ?? {};
                    return <option key={c.component_id} value={c.component_id}>{nameOf(c)} ({specNumber(s.power_stc_w)} W)</option>;
                  })}
                </select>
                <span className="text-[10px] text-slate-600">
                  Only panels with power, Voc and dimensions on file can be sized. Missing one? Fill it on Spec Readiness.
                </span>
              </label>

              {systemType !== 'on-grid' && (
                <>
                  <label className="block">
                    <span className={lbl}>Battery chemistry</span>
                    <select className={inp} value={batteryPref} onChange={(e) => setBatteryPref(e.target.value as BatteryPreference)}>
                      <option value="LiFePO4">LiFePO4 (DoD 80%)</option>
                      <option value="Lead-Acid">Lead-Acid (DoD 50%)</option>
                    </select>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className={lbl}>Sun hours / day</span>
                      <input className={inp} inputMode="decimal" value={psh} onChange={(e) => setPsh(e.target.value)} />
                    </label>
                    <label className="block">
                      <span className={lbl}>Autonomy days</span>
                      <input className={inp} inputMode="decimal" value={autonomy} onChange={(e) => setAutonomy(e.target.value)} />
                    </label>
                  </div>
                </>
              )}
            </div>

            {/* The structure — same questions as the mounting designer */}
            <div className="rounded-xl border border-sky-500/25 bg-sky-500/[0.04] p-3 space-y-2.5">
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className={lbl}>Mounting system</span>
                  <select className={inp} value={series} onChange={(e) => setSeries(e.target.value)}>
                    <option value="">Any system</option>
                    {systems.map((sy) => <option key={sy.series} value={sy.series}>{sy.series} ({sy.items})</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className={lbl}>Rail profile</span>
                  <select className={inp} value={profile} onChange={(e) => setProfile(e.target.value as RailProfile | '')}>
                    <option value="">Any profile</option>
                    {(['t_slot', 'symmetric', 'other'] as RailProfile[]).map((p) => (
                      <option key={p} value={p}>{RAIL_PROFILE_LABEL[p]}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                <label className="block">
                  <span className={lbl}>Rows</span>
                  <input className={inp} inputMode="numeric" value={numberOfRows} onChange={(e) => setNumberOfRows(e.target.value)} />
                </label>
                <label className="block">
                  <span className={lbl}>Rail length</span>
                  <select className={inp} value={railKey} onChange={(e) => setRailKey(e.target.value)}>
                    {railChoices.map((r) => <option key={r} value={r}>{r} mm</option>)}
                    <option value="custom">Custom…</option>
                  </select>
                </label>
                {railKey === 'custom' && (
                  <label className="block">
                    <span className={lbl}>Rail mm</span>
                    <input className={Number(railCustom) ? inp : inpNeeded} inputMode="numeric" value={railCustom}
                      placeholder="needed" onChange={(e) => setRailCustom(e.target.value)} />
                  </label>
                )}
                <label className="block">
                  <span className={lbl}>Panel gap mm</span>
                  <input className={inp} inputMode="numeric" value={panelSpacing} onChange={(e) => setPanelSpacing(e.target.value)} />
                </label>
                <label className="block">
                  <span className={lbl}>Mount type</span>
                  <select className={inp} value={mountType} onChange={(e) => setMountType(e.target.value as MountType)}>
                    <option value="roof">Roof</option>
                    <option value="ground">Ground</option>
                    <option value="flat">Flat roof</option>
                  </select>
                </label>
                <label className="block">
                  <span className={lbl}>Orientation</span>
                  <select className={inp} value={orientation} onChange={(e) => setOrientation(e.target.value as Orientation)}>
                    <option value="portrait">Portrait</option>
                    <option value="landscape">Landscape</option>
                  </select>
                </label>
              </div>
            </div>
          </div>
        )}

        {/* ── Step 2 · Demand ── */}
        {step === 1 && systemType === 'on-grid' && (
          <div className="grid sm:grid-cols-3 gap-3 max-w-2xl">
            <label className="block">
              <span className={lbl}>PLN connection</span>
              <select className={inp} value={plnKey} onChange={(e) => {
                setPlnKey(e.target.value);
                const va = Number(e.target.value);
                if (va) setGridPhase(va >= 13200 ? 3 : 1);
              }}>
                {PLN_CAPACITIES.map((va) => <option key={va} value={va}>{fmtInt(va)} VA</option>)}
                <option value="custom">Custom…</option>
              </select>
            </label>
            {plnKey === 'custom' && (
              <label className="block">
                <span className={lbl}>Capacity VA</span>
                <input className={Number(plnCustom) ? inp : inpNeeded} inputMode="numeric" value={plnCustom}
                  placeholder="needed" onChange={(e) => setPlnCustom(e.target.value)} />
              </label>
            )}
            <label className="block">
              <span className={lbl}>Phase</span>
              <select className={inp} value={gridPhase} onChange={(e) => setGridPhase(Number(e.target.value) === 3 ? 3 : 1)}>
                <option value={1}>Single-phase</option>
                <option value={3}>Three-phase</option>
              </select>
            </label>
            <label className="block">
              <span className={lbl}>DC/AC ratio</span>
              <input className={inp} inputMode="decimal" value={dcAcRatio} onChange={(e) => setDcAcRatio(e.target.value)} />
              <span className="text-[10px] text-slate-600">Array oversize over the inverter — 1.2 is the usual.</span>
            </label>
          </div>
        )}
        {step === 1 && systemType !== 'on-grid' && (
          <div className="space-y-2">
            <div className="rounded-xl border border-slate-800 overflow-hidden">
              <div className="grid grid-cols-[1fr_80px_80px_60px_70px_32px] gap-2 px-3 py-2 bg-slate-950/60 text-[9px] font-bold uppercase tracking-wider text-slate-500">
                <span>Load</span><span className="text-right">Watts</span><span className="text-right">Hours/day</span><span className="text-right">Qty</span><span>Motor?</span><span />
              </div>
              <div className="divide-y divide-slate-800/60">
                {loads.map((l, i) => (
                  <div key={i} className="grid grid-cols-[1fr_80px_80px_60px_70px_32px] gap-2 px-3 py-1.5 items-center">
                    <input className={inpSmall} placeholder="e.g. Refrigerator" value={l.name}
                      onChange={(e) => setLoads((ls) => ls.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                    <input className={`${Number(l.watts) ? inpSmall : inpSmallNeeded} text-right`} inputMode="numeric" placeholder="W" value={l.watts}
                      onChange={(e) => setLoads((ls) => ls.map((x, j) => (j === i ? { ...x, watts: e.target.value } : x)))} />
                    <input className={`${inpSmall} text-right`} inputMode="decimal" placeholder="h" value={l.hours}
                      onChange={(e) => setLoads((ls) => ls.map((x, j) => (j === i ? { ...x, hours: e.target.value } : x)))} />
                    <input className={`${inpSmall} text-right`} inputMode="numeric" value={l.qty}
                      onChange={(e) => setLoads((ls) => ls.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} />
                    <label className="flex items-center gap-1.5 text-[10px] text-slate-400 cursor-pointer" title="Motors, pumps, compressors surge at twice their running watts">
                      <input type="checkbox" checked={l.inductive} className="accent-emerald-500"
                        onChange={(e) => setLoads((ls) => ls.map((x, j) => (j === i ? { ...x, inductive: e.target.checked } : x)))} />
                      ×2
                    </label>
                    <button onClick={() => setLoads((ls) => ls.filter((_, j) => j !== i))}
                      className="text-slate-600 hover:text-red-300 text-sm transition-colors" title="Remove">✕</button>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-4">
              <button onClick={() => setLoads((ls) => [...ls, blankLoad()])}
                className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700 text-xs font-semibold transition-colors">+ Add load</button>
              {loadRows.length > 0 && (
                <span className="text-[11px] text-slate-500">
                  {fmtInt(loadRows.reduce((s, l) => s + l.watts * l.qty, 0))} W running ·{' '}
                  {fmtInt(loadRows.reduce((s, l) => s + l.watts * l.hoursPerDay * l.qty, 0))} Wh/day
                </span>
              )}
            </div>
          </div>
        )}

        {/* ── Step 3 · Review ── */}
        {step === 2 && (
          <div className="space-y-3">
            {result && result.errors.length > 0 && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/[0.06] px-3 py-2 space-y-1">
                {result.errors.map((w, i) => <p key={i} className="text-[11px] text-red-300">✕ {w}</p>)}
              </div>
            )}
            {result && result.warnings.length > 0 && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2 space-y-1">
                {result.warnings.map((w, i) => <p key={i} className="text-[11px] text-amber-200">⚠ {w}</p>)}
              </div>
            )}

            {result?.ok && (
              <>
                {/* The engine's read-outs */}
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-slate-400">
                  <span>Array <b className="text-slate-200">{result.numPanels} × {panelSpec?.power_stc_w} W = {result.arrayKwp.toFixed(2)} kWp</b></span>
                  {result.strings && <span>Strings <b className="text-slate-200">{result.strings.numStrings} × up to {result.strings.maxSeriesLength}</b></span>}
                  {result.totalWh != null && systemType !== 'on-grid' && (
                    <>
                      <span>Demand <b className="text-slate-200">{fmtInt(result.totalWh)} Wh/day</b></span>
                      <span>Continuous req. <b className="text-slate-200">{fmtInt(result.requiredContinuousW ?? 0)} W</b></span>
                      <span>Surge <b className="text-slate-200">{fmtInt(result.surgeW ?? 0)} W</b></span>
                    </>
                  )}
                  {result.battery && <span>Bank usable <b className="text-slate-200">{result.battery.usableKwh.toFixed(1)} kWh</b></span>}
                </div>

                {/* The picks — identity lines, resolved by component */}
                <div className="rounded-xl border border-slate-800 overflow-hidden">
                  <div className="grid grid-cols-[1fr_60px_100px_100px] gap-2 px-3 py-2 bg-slate-950/60 text-[9px] font-bold uppercase tracking-wider text-slate-500">
                    <span>System</span><span className="text-right">Qty</span><span className="text-right">Unit price</span><span className="text-right">Amount</span>
                  </div>
                  <div className="divide-y divide-slate-800/60">
                    {result.picks.map((p, i) => {
                      const price = p.component_id ? priceOf(p.component_id) : null;
                      const stock = p.component_id ? stockOf(p.component_id) : null;
                      return (
                        <div key={i} className="grid grid-cols-[1fr_60px_100px_100px] gap-2 px-3 py-2 items-center">
                          <span className="min-w-0">
                            <span className="block text-xs truncate text-slate-100">{p.label}</span>
                            <span className="block text-[10px] text-slate-600 truncate">
                              {p.note ?? ''}{stock != null ? ` · ${fmtInt(stock)} in stock` : ''}
                              {price == null || price <= 0 ? ' · no sell price set' : ''}
                            </span>
                          </span>
                          <span className="text-right text-xs tabular-nums text-slate-200">{fmtInt(p.qty)}</span>
                          <span className="text-right text-xs tabular-nums text-slate-400">{price != null ? fmtInt(price) : '—'}</span>
                          <span className="text-right text-xs tabular-nums text-slate-100 font-semibold">{price != null ? fmtInt(price * p.qty) : '—'}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* The balance of system — role lines, resolved by bom_role */}
                <div className="rounded-xl border border-slate-800 overflow-hidden">
                  <div className="grid grid-cols-[1fr_60px_100px_100px] gap-2 px-3 py-2 bg-slate-950/60 text-[9px] font-bold uppercase tracking-wider text-slate-500">
                    <span>Structure & balance of system</span><span className="text-right">Qty</span><span className="text-right">Unit price</span><span className="text-right">Amount</span>
                  </div>
                  <div className="divide-y divide-slate-800/60">
                    {resolved.map((l) => (
                      <div key={designRoleOf(l)} className="grid grid-cols-[1fr_60px_100px_100px] gap-2 px-3 py-2 items-center">
                        <span className="min-w-0">
                          <span className={`block text-xs truncate ${l.resolved ? 'text-slate-100' : 'text-amber-300'}`}>{l.description}</span>
                          <span className="block text-[10px] text-slate-600 truncate">
                            {l.role.replace(/_/g, ' ')}{l.param ? ` · ${l.param}` : ''}
                            {l.resolved && l.available != null ? ` · ${fmtInt(l.available)} in stock` : ''}
                            {l.warning ? ` · ${l.warning}` : ''}
                          </span>
                        </span>
                        <span className="text-right text-xs tabular-nums text-slate-200">{fmtInt(l.qty)}</span>
                        <span className="text-right text-xs tabular-nums text-slate-400">{l.unitPrice != null ? fmtInt(l.unitPrice) : '—'}</span>
                        <span className="text-right text-xs tabular-nums text-slate-100 font-semibold">
                          {l.unitPrice != null ? fmtInt(l.unitPrice * l.qty) : '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
                  <span className="text-slate-500">{result.picks.length + bosTotals.lines} lines</span>
                  {bosTotals.unresolved > 0 && <span className="text-amber-300">{bosTotals.unresolved} not in catalog</span>}
                  {bosTotals.unpriced > 0 && <span className="text-amber-300">{bosTotals.unpriced} without a price</span>}
                  {bosTotals.short > 0 && <span className="text-red-300">{bosTotals.short} short of stock</span>}
                  <span className="ml-auto text-slate-400">
                    System total <span className="text-emerald-300 font-bold tabular-nums">{fmtRupiah(pickTotal + bosTotals.total)}</span>
                  </span>
                </div>
              </>
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-3 pt-2 border-t border-slate-800">
          <p className="text-[10px] text-slate-600 max-w-md">
            {step === 2
              ? (hasExisting
                ? 'Applying replaces the lines a designer created last time. Lines you typed yourself are never touched.'
                : 'The lines land on the quotation, where you can edit them like any other line.')
              : 'Nothing is written until the review step — walk back and forth freely.'}
          </p>
          <div className="flex gap-3">
            {step > 0 && (
              <button onClick={() => setStep((s) => s - 1)}
                className="px-4 py-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 text-sm transition-colors">← Back</button>
            )}
            {step < 2 ? (
              <button onClick={() => setStep((s) => s + 1)} disabled={!canNext}
                className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition-colors disabled:opacity-40">
                Next →
              </button>
            ) : (
              <button onClick={apply} disabled={!result?.ok}
                className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition-colors disabled:opacity-40">
                {hasExisting ? 'Regenerate lines' : 'Add to quotation'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

const inpSmall = 'w-full h-8 px-2 rounded-lg bg-slate-950 border border-slate-700 focus:border-emerald-500 outline-none text-white text-xs transition-colors';
const inpSmallNeeded = 'w-full h-8 px-2 rounded-lg bg-amber-500/[0.07] border border-amber-500/60 focus:border-amber-400 outline-none text-white text-xs transition-colors placeholder:text-amber-200/40';
