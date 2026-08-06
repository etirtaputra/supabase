'use client';
/**
 * Mounting Designer — the calculator inside the sales quote.
 *
 * Answer the array questions (panel, count, rows, rail, spacing, mount type,
 * orientation) and the v11 engine sizes the structure; every generic line is
 * then resolved against the catalog at this customer's tier, so what lands on
 * the quotation is real items at real prices, with live stock and the
 * engineering warnings visible BEFORE anything is inserted.
 *
 * The panel list comes from the catalog first — an item whose specs carry its
 * dimensions can be picked by name, and the numbers fill themselves. The v11
 * presets remain for modules not yet specced.
 *
 * Nothing here writes to the database: it hands finished lines back to the
 * quote editor, which owns saving (and stamps `design_role` so REGENERATE can
 * replace only these lines and never a hand-typed one).
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { createSupabaseClient } from '@/lib/supabase';
import { fmtInt, fmtRupiah } from '@/lib/formatters';
import { specNumber } from '@/lib/specSchema';
import {
  calculateMounting, RAIL_LENGTHS_MM, V11_PANEL_PRESETS,
  type MountingInput, type MountType, type Orientation,
} from '@/lib/systemDesign/mounting';
import { resolveBom, summarise, type DesignCandidate } from '@/lib/systemDesign/resolve';
import { designRoleOf, type SystemDesign } from '@/lib/systemDesign/types';

/** One finished quote line, in the editor's own shape. */
export interface DesignedLine {
  component_id: string | null;
  description: string;
  unit: string;
  quantity: string;
  unit_price: string;
  note: string;
  design_role: string;
}

interface PanelOption {
  key: string;
  label: string;
  lengthMm: number;
  widthMm: number;
  thicknessMm: number;
  component_id: string | null;
  source: 'catalog' | 'preset';
}

/** "2278 x 1134 x 35" (mm) → the three numbers, in any of the usual spellings. */
function parseDims(v: unknown): { l: number; w: number; t: number } | null {
  if (typeof v !== 'string') return null;
  const nums = v.split(/[x×*]/i).map((s) => specNumber(s.trim())).filter((n): n is number => n !== null);
  if (nums.length < 2) return null;
  return { l: Math.max(nums[0], nums[1]), w: Math.min(nums[0], nums[1]), t: nums[2] ?? 0 };
}

export default function MountingDesigner({ open, onClose, priceOf, stockOf, onApply, hasExisting }: {
  open: boolean;
  onClose: () => void;
  /** The customer's tier price for a component — owned by the quote editor. */
  priceOf: (componentId: string) => number | null;
  stockOf: (componentId: string) => number | null;
  onApply: (lines: DesignedLine[], design: SystemDesign) => void;
  /** Are there already generated lines on this quote? Then this is a REGENERATE. */
  hasExisting: boolean;
}) {
  const supabase = createSupabaseClient();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const [candidates, setCandidates] = useState<DesignCandidate[]>([]);
  const [panels, setPanels] = useState<PanelOption[]>([]);
  const [loading, setLoading] = useState(true);

  const [panelKey, setPanelKey] = useState('');
  const [panelCount, setPanelCount] = useState('4');
  const [numberOfRows, setNumberOfRows] = useState('1');
  const [railKey, setRailKey] = useState(String(RAIL_LENGTHS_MM[0]));
  const [railCustom, setRailCustom] = useState('');
  const [panelSpacing, setPanelSpacing] = useState('20');
  const [mountType, setMountType] = useState<MountType>('roof');
  const [orientation, setOrientation] = useState<Orientation>('portrait');
  // Hand overrides, used when a panel carries no dimensions
  const [dimL, setDimL] = useState('');
  const [dimW, setDimW] = useState('');
  const [dimT, setDimT] = useState('');

  // The design candidates: mounting/accessories to build from, PV modules to
  // read dimensions off. Fetched when the designer opens, not on every quote.
  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('3.0_components')
      .select('component_id, supplier_model, internal_description, category, unit, specifications, quote_cost_mode, show_tuc_in_quotes')
      .in('category', ['mounting', 'accessories', 'pv_module']).limit(2000);
    const rows = (data as DesignCandidate[]) ?? [];
    setCandidates(rows.filter((c) => c.category === 'mounting' || c.category === 'accessories'));

    const fromCatalog: PanelOption[] = rows
      .filter((c) => c.category === 'pv_module')
      .flatMap((c): PanelOption[] => {
        const dims = parseDims((c.specifications ?? {}).dimensions_l_w_h_mm);
        if (!dims || !dims.l || !dims.w) return [];
        return [{
          key: `cat:${c.component_id}`,
          label: (c.internal_description ?? '').trim() || c.supplier_model,
          lengthMm: dims.l, widthMm: dims.w, thicknessMm: dims.t,
          component_id: c.component_id, source: 'catalog',
        }];
      })
      .sort((a, b) => a.label.localeCompare(b.label));

    const presets: PanelOption[] = V11_PANEL_PRESETS.map((p) => ({
      key: `preset:${p.model}`, label: `${p.model} (${p.lengthMm}×${p.widthMm}×${p.thicknessMm})`,
      lengthMm: p.lengthMm, widthMm: p.widthMm, thicknessMm: p.thicknessMm,
      component_id: null, source: 'preset' as const,
    }));
    setPanels([...fromCatalog, ...presets]);
    setLoading(false);
  }, [supabase]);
  useEffect(() => { if (open) load(); }, [open, load]);

  const panel = useMemo(() => panels.find((p) => p.key === panelKey) ?? null, [panels, panelKey]);
  // A panel without usable dimensions falls back to the typed ones
  const dims = useMemo(() => ({
    l: panel?.lengthMm || Number(dimL) || 0,
    w: panel?.widthMm || Number(dimW) || 0,
    t: (panel?.thicknessMm || Number(dimT) || 0),
  }), [panel, dimL, dimW, dimT]);
  // A catalog panel with no thickness on file still needs a clamp size
  const thickness = panel && !panel.thicknessMm ? Number(dimT) || 0 : dims.t;

  const railLengthMm = railKey === 'custom' ? Number(railCustom) || 0 : Number(railKey);

  const input: MountingInput = useMemo(() => ({
    panelCount: Number(panelCount) || 0,
    numberOfRows: Number(numberOfRows) || 1,
    panelLengthMm: dims.l, panelWidthMm: dims.w, panelThicknessMm: thickness,
    railLengthMm, panelSpacingMm: Number(panelSpacing) || 0,
    mountType, orientation,
  }), [panelCount, numberOfRows, dims.l, dims.w, thickness, railLengthMm, panelSpacing, mountType, orientation]);

  const result = useMemo(() => calculateMounting(input), [input]);
  const resolved = useMemo(
    () => (result.ok ? resolveBom(result.lines, { candidates, priceOf, stockOf }) : []),
    [result, candidates, priceOf, stockOf]);
  const totals = useMemo(() => summarise(resolved), [resolved]);

  if (!open || !mounted) return null;

  const apply = () => {
    const lines: DesignedLine[] = resolved.map((l) => ({
      component_id: l.component_id,
      description: l.description,
      unit: l.unit,
      quantity: String(l.qty),
      unit_price: l.unitPrice != null ? String(Math.round(l.unitPrice)) : '',
      note: [l.note, l.resolved ? '' : 'not in catalog — price by hand'].filter(Boolean).join(' · '),
      design_role: designRoleOf(l),
    }));
    const design: SystemDesign = {
      engine: 'mounting',
      version: 11,
      input: { ...input, panelKey, panelLabel: panel?.label ?? '', railKey },
      warnings: result.warnings,
      generated_at: new Date().toISOString(),
    };
    onApply(lines, design);
    onClose();
  };

  const inp = 'w-full h-9 px-3 rounded-lg bg-slate-900 border border-slate-700 focus:border-emerald-500/60 outline-none text-white text-sm transition-colors';
  const lbl = 'block text-[10px] uppercase tracking-widest text-slate-500 mb-1';

  return createPortal(
    <div className="fixed inset-0 z-[130] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-slate-900 border border-slate-700 sm:rounded-2xl rounded-t-2xl w-full max-w-5xl max-h-[92vh] overflow-y-auto p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold text-white">Design the mounting structure</h3>
            <p className="text-[10px] text-slate-600 mt-0.5">
              ICA mounting calculator v11 · sized here, priced at this customer&apos;s tier
            </p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white p-1 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="grid lg:grid-cols-[minmax(0,340px)_1fr] gap-5">
          {/* ── Inputs ── */}
          <div className="space-y-3">
            <label className="block">
              <span className={lbl}>Panel</span>
              <select className={inp} value={panelKey} onChange={(e) => setPanelKey(e.target.value)}>
                <option value="">— type the dimensions —</option>
                {panels.some((p) => p.source === 'catalog') && (
                  <optgroup label="From the catalog">
                    {panels.filter((p) => p.source === 'catalog').map((p) => (
                      <option key={p.key} value={p.key}>{p.label} ({p.lengthMm}×{p.widthMm}{p.thicknessMm ? `×${p.thicknessMm}` : ''})</option>
                    ))}
                  </optgroup>
                )}
                <optgroup label="Calculator presets">
                  {panels.filter((p) => p.source === 'preset').map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                </optgroup>
              </select>
              {loading && <span className="text-[10px] text-slate-600">loading catalog…</span>}
            </label>

            {/* Dimensions: read-only when the panel supplies them */}
            <div className="grid grid-cols-3 gap-2">
              <label className="block">
                <span className={lbl}>Length mm</span>
                <input className={inp} inputMode="numeric" value={panel?.lengthMm || dimL}
                  disabled={!!panel?.lengthMm} onChange={(e) => setDimL(e.target.value)} />
              </label>
              <label className="block">
                <span className={lbl}>Width mm</span>
                <input className={inp} inputMode="numeric" value={panel?.widthMm || dimW}
                  disabled={!!panel?.widthMm} onChange={(e) => setDimW(e.target.value)} />
              </label>
              <label className="block">
                <span className={lbl}>Frame mm</span>
                <input className={inp} inputMode="numeric" value={panel?.thicknessMm || dimT}
                  disabled={!!panel?.thicknessMm} onChange={(e) => setDimT(e.target.value)}
                  title="Frame thickness — this is the clamp size" />
              </label>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <label className="block">
                <span className={lbl}>Panels</span>
                <input className={inp} inputMode="numeric" value={panelCount} onChange={(e) => setPanelCount(e.target.value)} />
              </label>
              <label className="block">
                <span className={lbl}>Rows</span>
                <input className={inp} inputMode="numeric" value={numberOfRows} onChange={(e) => setNumberOfRows(e.target.value)} />
              </label>
              <label className="block">
                <span className={lbl}>Per row</span>
                <div className="h-9 px-3 rounded-lg bg-slate-950 border border-dashed border-slate-700 text-slate-300 text-sm flex items-center tabular-nums">
                  {result.panelsPerRow || '—'}
                </div>
              </label>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className={lbl}>Rail length</span>
                <select className={inp} value={railKey} onChange={(e) => setRailKey(e.target.value)}>
                  {RAIL_LENGTHS_MM.map((r) => <option key={r} value={r}>{r} mm</option>)}
                  <option value="custom">Custom…</option>
                </select>
              </label>
              <label className="block">
                <span className={lbl}>{railKey === 'custom' ? 'Rail mm' : 'Panel gap mm'}</span>
                {railKey === 'custom'
                  ? <input className={inp} inputMode="numeric" value={railCustom} onChange={(e) => setRailCustom(e.target.value)} />
                  : <input className={inp} inputMode="numeric" value={panelSpacing} onChange={(e) => setPanelSpacing(e.target.value)} />}
              </label>
            </div>
            {railKey === 'custom' && (
              <label className="block">
                <span className={lbl}>Panel gap mm</span>
                <input className={inp} inputMode="numeric" value={panelSpacing} onChange={(e) => setPanelSpacing(e.target.value)} />
              </label>
            )}

            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className={lbl}>Mount type</span>
                <select className={inp} value={mountType} onChange={(e) => setMountType(e.target.value as MountType)}>
                  <option value="roof">Roof mount</option>
                  <option value="ground">Ground mount</option>
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

            {/* The engine's own read-outs — the numbers behind the BoM */}
            {result.ok && (
              <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3 space-y-1.5 text-[11px]">
                <p className="flex justify-between"><span className="text-slate-500">Array width</span>
                  <span className="text-slate-200 tabular-nums">{(result.arrayWidthMm / 1000).toFixed(2)} m</span></p>
                <p className="flex justify-between"><span className="text-slate-500">Rails per line</span>
                  <span className="text-slate-200 tabular-nums">{result.railsPerLine}</span></p>
                <p className="flex justify-between"><span className="text-slate-500">Edge spacing (each end)</span>
                  <span className={`tabular-nums ${result.edgeSpacingMm < 25 ? 'text-red-300' : 'text-slate-200'}`}>{result.edgeSpacingMm.toFixed(1)} mm</span></p>
                <p className="flex justify-between"><span className="text-slate-500">Total rail</span>
                  <span className="text-slate-200 tabular-nums">{result.totalRailLengthM.toFixed(2)} m</span></p>
                <div>
                  <div className="flex justify-between text-slate-500 mb-1"><span>Rail used per line</span><span className="tabular-nums">{result.railUtilPercent.toFixed(0)}%</span></div>
                  <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                    <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${result.railUtilPercent}%` }} />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ── Bill of materials ── */}
          <div className="space-y-2.5">
            {result.warnings.length > 0 && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2 space-y-1">
                {result.warnings.map((w, i) => <p key={i} className="text-[11px] text-amber-200">⚠ {w}</p>)}
              </div>
            )}

            {!result.ok ? (
              <p className="text-xs text-slate-500 italic py-10 text-center">
                Pick a panel (or type its dimensions) and a rail length — the bill of materials appears here.
              </p>
            ) : (
              <>
                <div className="rounded-xl border border-slate-800 overflow-hidden">
                  <div className="grid grid-cols-[1fr_60px_100px_100px] gap-2 px-3 py-2 bg-slate-950/60 text-[9px] font-bold uppercase tracking-wider text-slate-500">
                    <span>Item</span><span className="text-right">Qty</span><span className="text-right">Unit price</span><span className="text-right">Amount</span>
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
                  <span className="text-slate-500">{totals.lines} lines</span>
                  {totals.unresolved > 0 && <span className="text-amber-300">{totals.unresolved} not in catalog</span>}
                  {totals.unpriced > 0 && <span className="text-amber-300">{totals.unpriced} without a price</span>}
                  {totals.short > 0 && <span className="text-red-300">{totals.short} short of stock</span>}
                  <span className="ml-auto text-slate-400">
                    Materials total <span className="text-emerald-300 font-bold tabular-nums">{fmtRupiah(totals.total)}</span>
                  </span>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 pt-2 border-t border-slate-800">
          <p className="text-[10px] text-slate-600 max-w-md">
            {hasExisting
              ? 'Applying replaces the lines this designer created last time. Lines you typed yourself are never touched.'
              : 'The lines land on the quotation, where you can edit them like any other line.'}
          </p>
          <div className="flex gap-3">
            <button onClick={onClose} className="px-4 py-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 text-sm transition-colors">Cancel</button>
            <button onClick={apply} disabled={!result.ok}
              className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition-colors disabled:opacity-40">
              {hasExisting ? 'Regenerate lines' : 'Add to quotation'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
