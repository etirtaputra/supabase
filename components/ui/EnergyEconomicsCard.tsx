'use client';
import { useMemo, useState } from 'react';
import { computeEnergyEconomics, fmtPayback, ECON_DEFAULTS, PLN_TARIFF_OPTIONS, PLN_TARIFF_PERIOD, type EconAssumptions } from '@/lib/energyEconomics';

/**
 * "Energy Economics" card on the Project Quote editor (on-grid & hybrid).
 * CAPEX (subtotal excl. PPN) and DC kWp flow in live from the quote; the
 * owner/engineer tunes the assumptions (blue-cell equivalents of the LCOE
 * Google Sheet) and the card previews LCOE / NPV / IRR / payback. The same
 * engine renders the full year-by-year breakdown on the proposal PDF when
 * "Include in proposal PDF" is on.
 */

const fmtIdr = (v: number) => 'Rp' + Math.round(v).toLocaleString('en-US');
const fmtIdr2 = (v: number) => 'Rp' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Field({ label, unit, value, placeholder, onChange, disabled }: {
  label: string; unit: string; value: number | null | undefined;
  placeholder?: string; onChange: (v: number | null) => void; disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-[10px] text-slate-500 mb-0.5">{label}</span>
      <span className="flex items-center gap-1">
        <input
          value={value ?? ''}
          inputMode="decimal"
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => {
            const raw = e.target.value.trim();
            if (raw === '') { onChange(null); return; }
            const v = Number(raw);
            if (!isNaN(v)) onChange(v);
          }}
          className="w-full bg-slate-950/60 border border-slate-700 focus:border-emerald-500/60 rounded-lg px-2 py-1.5 text-xs text-white text-right tabular-nums outline-none transition-colors disabled:opacity-50 placeholder:text-slate-600"
        />
        <span className="text-[9px] text-slate-600 whitespace-nowrap">{unit}</span>
      </span>
    </label>
  );
}

function TariffRow({ label, hint, valueLabel, value, placeholder, onPick }: {
  label: string; hint: string;
  valueLabel: string; value: number | null | undefined; placeholder: string;
  onPick: (value: number | null, label: string) => void;
}) {
  return (
    <label className="block mb-2.5">
      <span className="block text-[10px] text-slate-500 mb-0.5">
        {label} <span className="text-slate-600">— {hint}</span>
      </span>
      <span className="flex items-center gap-1.5">
        <select
          value={valueLabel}
          onChange={(e) => {
            const opt = PLN_TARIFF_OPTIONS.find((o) => o.label === e.target.value);
            if (opt) onPick(opt.value, opt.label);
            else onPick(value ?? null, ''); // custom — keep the typed number
          }}
          className="flex-1 min-w-0 bg-slate-950/60 border border-slate-700 focus:border-emerald-500/60 rounded-lg px-2 py-1.5 text-xs text-white outline-none transition-colors"
        >
          <option value="">Custom rate…</option>
          {PLN_TARIFF_OPTIONS.map((o) => (
            <option key={o.label} value={o.label}>{o.label} — Rp{o.value.toLocaleString('en-US', { minimumFractionDigits: 2 })}</option>
          ))}
        </select>
        <input
          value={value ?? ''}
          inputMode="decimal"
          placeholder={placeholder}
          title="Override with any Rp/kWh (e.g. blended WBP/LWBP or PPA rate) — typing switches the picker to Custom"
          onChange={(e) => {
            const raw = e.target.value.trim();
            if (raw === '') { onPick(null, ''); return; }
            const v = Number(raw);
            if (!isNaN(v)) onPick(v, '');
          }}
          className="w-28 flex-shrink-0 bg-slate-950/60 border border-slate-700 focus:border-emerald-500/60 rounded-lg px-2 py-1.5 text-xs text-white text-right tabular-nums outline-none transition-colors placeholder:text-slate-600"
        />
        <span className="text-[9px] text-slate-600 whitespace-nowrap flex-shrink-0">Rp/kWh</span>
      </span>
    </label>
  );
}

export default function EnergyEconomicsCard({ econ, onChange, capexIdr, dcKwp, hybrid, locked }: {
  econ: EconAssumptions | null | undefined;
  onChange: (patch: Partial<EconAssumptions>) => void;
  capexIdr: number;      // quote subtotal excl. PPN — live
  dcKwp: number;         // system size from the quote — live
  hybrid: boolean;
  locked: boolean;
}) {
  const a = econ ?? {};
  const [showTable, setShowTable] = useState(false);
  const result = useMemo(
    () => computeEnergyEconomics(capexIdr, dcKwp, a, hybrid),
    [capexIdr, dcKwp, a, hybrid],
  );
  // Scenario 2 (e.g. without subsidy): same model, only the tariff differs
  const resultAlt = useMemo(
    () => (a.pln_tariff_alt ?? 0) > 0
      ? computeEnergyEconomics(capexIdr, dcKwp, { ...a, pln_tariff: a.pln_tariff_alt! }, hybrid)
      : null,
    [capexIdr, dcKwp, a, hybrid],
  );
  const included = a.enabled !== false;

  return (
    <div className={`bg-slate-900/50 border border-slate-800 rounded-2xl p-5 ${locked ? 'pointer-events-none opacity-70' : ''}`}>
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <label className="block text-[10px] uppercase tracking-widest text-slate-500">
          Energy Economics
          <span className="ml-2 normal-case tracking-normal text-slate-600">LCOE · NPV · IRR — CAPEX &amp; kWp flow live from this quote</span>
        </label>
        <label className="ml-auto flex items-center gap-1.5 text-[11px] text-slate-400 cursor-pointer">
          <input
            type="checkbox"
            checked={included}
            onChange={(e) => onChange({ enabled: e.target.checked })}
            className="accent-emerald-600"
          />
          Include in proposal PDF
        </label>
      </div>

      {!(capexIdr > 0) || !(dcKwp > 0) ? (
        <p className="text-xs text-slate-600">
          Needs line items with sell prices (CAPEX) and solar panels (system size) before the economics can be computed.
        </p>
      ) : (
        <>
          {/* Live inputs from the quote */}
          <div className="flex flex-wrap gap-x-5 gap-y-1 mb-3 text-[11px] text-slate-400">
            <span>CAPEX <span className="text-slate-200 font-semibold tabular-nums">{fmtIdr(capexIdr)}</span> <span className="text-slate-600">excl. PPN, live</span></span>
            <span>DC <span className="text-slate-200 font-semibold tabular-nums">{dcKwp.toLocaleString('en-US', { maximumFractionDigits: 2 })} kWp</span></span>
            {result && <span>Price/Wp <span className="text-slate-200 font-semibold tabular-nums">{fmtIdr2(result.pricePerWp)}</span></span>}
            {result && <span>Yr-1 gen <span className="text-slate-200 font-semibold tabular-nums">{Math.round(result.yr1GenKwh).toLocaleString('en-US')} kWh</span></span>}
          </div>

          {/* Assumptions — the blue cells. min-w-0 everywhere so long labels /
              the select's option text can never stretch a grid column past
              the container (that's what was clipping the right-edge fields). */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-2.5 [&>*]:min-w-0">
            <Field label="Specific production" unit="kWh/kWp·yr" value={a.specific_production}
              placeholder={String(ECON_DEFAULTS.specific_production)} onChange={(v) => onChange({ specific_production: v ?? undefined })} />
            <Field label="First-year degradation" unit="%" value={a.first_year_deg_pct}
              placeholder={String(ECON_DEFAULTS.first_year_deg_pct)} onChange={(v) => onChange({ first_year_deg_pct: v ?? undefined })} />
            <Field label="Yearly degradation" unit="%/yr" value={a.yearly_deg_pct}
              placeholder={String(ECON_DEFAULTS.yearly_deg_pct)} onChange={(v) => onChange({ yearly_deg_pct: v ?? undefined })} />
            <Field label="System lifetime" unit="years" value={a.lifetime_years}
              placeholder={String(ECON_DEFAULTS.lifetime_years)} onChange={(v) => onChange({ lifetime_years: v ?? undefined })} />
            <Field label="Tariff inflation" unit="%/yr" value={a.tariff_inflation_pct}
              placeholder={String(ECON_DEFAULTS.tariff_inflation_pct)} onChange={(v) => onChange({ tariff_inflation_pct: v ?? undefined })} />
            <Field label="Hurdle rate" unit="%" value={a.hurdle_rate_pct}
              placeholder={String(ECON_DEFAULTS.hurdle_rate_pct)} onChange={(v) => onChange({ hurdle_rate_pct: v ?? undefined })} />
            <Field label="Annual O&M" unit="Rp/MWp·yr" value={a.om_per_mwp_year}
              placeholder="0" onChange={(v) => onChange({ om_per_mwp_year: v ?? undefined })} />
          </div>

          {/* PLN tariff — one dropdown; full-width row so the golongan names
              have room. Picking a subsidized (billed) rate auto-fills the
              without-subsidy comparison from the option's tarif dasar — the
              engineer never chooses two tariffs by hand. */}
          <TariffRow
            label="PLN tariff"
            hint={`${PLN_TARIFF_PERIOD} · verify against the customer's bill`}
            valueLabel={a.pln_tariff_label ?? ''}
            value={a.pln_tariff}
            placeholder={String(ECON_DEFAULTS.pln_tariff)}
            onPick={(v, label) => {
              const opt = PLN_TARIFF_OPTIONS.find((o) => o.label === label);
              onChange({
                pln_tariff: v ?? undefined, pln_tariff_label: label,
                pln_tariff_alt: opt?.altValue ?? null, pln_tariff_alt_label: opt?.altLabel ?? '',
              });
            }}
          />

          {hybrid && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-2.5 pt-2 border-t border-slate-800/60 [&>*]:min-w-0">
              <p className="col-span-2 sm:col-span-4 -mb-1 text-[10px] text-sky-400/80">
                Battery contribution (from the LCOS calculator)
              </p>
              <Field label="Effective output" unit="kWh/day" value={a.battery_kwh_day}
                placeholder="0" onChange={(v) => onChange({ battery_kwh_day: v ?? undefined })} />
              <Field label="Battery lifetime" unit="years" value={a.battery_lifetime_years}
                placeholder="0" onChange={(v) => onChange({ battery_lifetime_years: v ?? undefined })} />
              <Field label="Annual degradation" unit="%/yr" value={a.battery_deg_pct}
                placeholder="0" onChange={(v) => onChange({ battery_deg_pct: v ?? undefined })} />
            </div>
          )}

          {/* Headline results */}
          {result && (() => {
            const life = a.lifetime_years ?? ECON_DEFAULTS.lifetime_years;
            return (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-2.5 border-t border-slate-800/60">
                <div>
                  <p className="text-[10px] text-slate-500">LCOE · over {life} years</p>
                  <p className={`text-sm font-bold tabular-nums ${result.economical ? 'text-emerald-400' : 'text-red-400'}`}>{fmtIdr2(result.lcoe)}<span className="text-[10px] font-normal text-slate-500">/kWh</span></p>
                  <p className="text-[9px] text-slate-600">vs PLN {fmtIdr2(a.pln_tariff ?? ECON_DEFAULTS.pln_tariff)} — {result.economical ? 'cheaper than grid ✓' : 'above grid ✗'}</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-500">NPV @ {(a.hurdle_rate_pct ?? ECON_DEFAULTS.hurdle_rate_pct)}% · over {life} years</p>
                  <p className={`text-sm font-bold tabular-nums ${result.npv >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmtIdr(result.npv)}</p>
                  <p className="text-[9px] text-slate-600">IRR {result.irr != null ? `${(result.irr * 100).toFixed(1)}%` : '—'} over {life} years</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-500">Payback</p>
                  <p className="text-sm font-bold text-white tabular-nums">{fmtPayback(result.paybackYears)}</p>
                  <p className="text-[9px] text-slate-600">cumulative cash flow turns positive</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-500">Savings · over {life} years</p>
                  <p className="text-sm font-bold text-white tabular-nums">{fmtIdr(result.costAvoided)}</p>
                  <p className="text-[9px] text-slate-600">{Math.round(result.lifetimeKwh).toLocaleString('en-US')} kWh generated over {life} years</p>
                </div>
              </div>
            );
          })()}

          {/* Scenario comparison — with vs without subsidy */}
          {result && resultAlt && (() => {
            const life = a.lifetime_years ?? ECON_DEFAULTS.lifetime_years;
            const rows: { k: string; s1: string; s2: string }[] = [
              { k: 'Tariff today', s1: fmtIdr2(a.pln_tariff ?? ECON_DEFAULTS.pln_tariff) + '/kWh', s2: fmtIdr2(a.pln_tariff_alt!) + '/kWh' },
              { k: `NPV @ ${(a.hurdle_rate_pct ?? ECON_DEFAULTS.hurdle_rate_pct)}% · ${life} yrs`, s1: fmtIdr(result.npv), s2: fmtIdr(resultAlt.npv) },
              { k: `IRR · ${life} yrs`, s1: result.irr != null ? `${(result.irr * 100).toFixed(1)}%` : '—', s2: resultAlt.irr != null ? `${(resultAlt.irr * 100).toFixed(1)}%` : '—' },
              { k: 'Payback', s1: fmtPayback(result.paybackYears), s2: fmtPayback(resultAlt.paybackYears) },
              { k: `Savings · ${life} yrs`, s1: fmtIdr(result.costAvoided), s2: fmtIdr(resultAlt.costAvoided) },
            ];
            return (
              <div className="mt-3 pt-2.5 border-t border-slate-800/60">
                <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">
                  Scenario comparison <span className="normal-case tracking-normal text-slate-600">— shown because the selected rate is subsidized; headline numbers use the billed rate</span>
                </p>
                <table className="w-full text-[11px] tabular-nums">
                  <thead>
                    <tr className="text-[10px] text-slate-500 border-b border-slate-800">
                      <th className="text-left py-1 pr-2 font-normal" />
                      <th className="text-right py-1 px-2 font-semibold text-emerald-400/90">Scenario 1 · with subsidy</th>
                      <th className="text-right py-1 pl-2 font-semibold text-slate-400">Scenario 2 · without subsidy</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-300">
                    {rows.map((r) => (
                      <tr key={r.k} className="border-b border-slate-800/40">
                        <td className="py-1 pr-2 text-slate-500">{r.k}</td>
                        <td className="py-1 px-2 text-right font-semibold text-slate-200">{r.s1}</td>
                        <td className="py-1 pl-2 text-right">{r.s2}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-1 text-[9px] text-slate-600">LCOE ({fmtIdr2(result.lcoe)}/kWh) is tariff-independent — identical in both scenarios.</p>
              </div>
            );
          })()}

          {/* Year-by-year table (collapsed by default in the editor; always full on the PDF) */}
          {result && (
            <div className="mt-3">
              <button
                onClick={() => setShowTable((v) => !v)}
                className="text-[11px] text-violet-400 hover:text-violet-300 transition-colors"
              >
                {showTable ? 'Hide' : 'Show'} year-by-year cash flows ({result.years.length - 1} years)
              </button>
              {showTable && (
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-[10px] tabular-nums">
                    <thead>
                      <tr className="text-slate-500 border-b border-slate-800">
                        <th className="text-left py-1 pr-2">Yr</th>
                        <th className="text-right py-1 px-2">Perf</th>
                        <th className="text-right py-1 px-2">PV kWh</th>
                        {hybrid && <th className="text-right py-1 px-2">Batt kWh</th>}
                        <th className="text-right py-1 px-2">Tariff</th>
                        <th className="text-right py-1 px-2">Savings</th>
                        <th className="text-right py-1 pl-2">Cumulative</th>
                      </tr>
                    </thead>
                    <tbody className="text-slate-300">
                      {result.years.map((r) => (
                        <tr key={r.year} className={`border-b border-slate-800/40 ${r.cumulative >= 0 && r.year > 0 ? '' : 'text-slate-400'}`}>
                          <td className="py-0.5 pr-2">{r.year}</td>
                          <td className="text-right py-0.5 px-2">{r.year === 0 ? '—' : `${r.pvPerfPct.toFixed(1)}%`}</td>
                          <td className="text-right py-0.5 px-2">{Math.round(r.pvGenKwh).toLocaleString('en-US')}</td>
                          {hybrid && <td className="text-right py-0.5 px-2">{Math.round(r.battOutKwh).toLocaleString('en-US')}</td>}
                          <td className="text-right py-0.5 px-2">{Math.round(r.tariff).toLocaleString('en-US')}</td>
                          <td className="text-right py-0.5 px-2">{Math.round(r.savings).toLocaleString('en-US')}</td>
                          <td className={`text-right py-0.5 pl-2 ${r.cumulative >= 0 ? 'text-emerald-400' : 'text-red-400/80'}`}>{Math.round(r.cumulative).toLocaleString('en-US')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
