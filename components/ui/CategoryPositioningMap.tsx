/**
 * Category Positioning Map
 * 4-quadrant dot-plot of price/unit vs. capacity for a selected product category.
 * X-axis: norm_value (capacity in canonical unit, e.g. Wp, W, Ah, m)
 * Y-axis: price per unit (last TUC in IDR / norm_value, or last quote/PO price in IDR / norm_value)
 * Quadrant lines at median X and median Y.
 */
'use client';

import React, { useState, useMemo, useRef } from 'react';
import type { Component, PriceQuoteLineItem, PriceQuote, PurchaseOrder, PurchaseLineItem, POCost } from '../../types/database';
import { CATEGORY_UNITS, CATEGORY_LABELS, hasCategoryUnit } from '../../constants/categoryUnits';
import { ENUMS } from '../../constants/enums';

interface Props {
  components: Component[];
  quoteItems: PriceQuoteLineItem[];
  quotes: PriceQuote[];
  pos: PurchaseOrder[];
  poItems: PurchaseLineItem[];
  poCosts: POCost[];
  isLoading?: boolean;
}

interface DotData {
  component_id: string;
  label: string;
  brand: string;
  normValue: number;
  pricePerUnit: number; // IDR per norm_value unit
  priceSource: 'tuc' | 'quote' | 'po';
  rawPrice: number;
  rawCurrency: string;
}

// Stable color palette per brand
const BRAND_COLORS = [
  '#38bdf8', '#a78bfa', '#fb923c', '#34d399', '#f472b6',
  '#facc15', '#60a5fa', '#f87171', '#4ade80', '#e879f9',
];
function brandColor(brand: string, idx: number) { return BRAND_COLORS[idx % BRAND_COLORS.length]; }

// Rough USD→IDR and RMB→IDR for normalizing to IDR
const FX: Record<string, number> = { USD: 16000, RMB: 2200, IDR: 1 };
function toIdr(amount: number, currency: string) { return amount * (FX[currency] ?? 16000); }

function median(vals: number[]): number {
  if (!vals.length) return 0;
  const s = [...vals].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}

export default function CategoryPositioningMap({
  components, quoteItems, quotes, pos, poItems, poCosts, isLoading,
}: Props) {
  const [category, setCategory] = useState<string>('pv_module');
  const svgRef = useRef<SVGSVGElement>(null);
  const [tooltip, setTooltip] = useState<{ dot: DotData; x: number; y: number } | null>(null);

  const unitInfo = CATEGORY_UNITS[category];

  // Categorized components with norm_value
  const catComponents = useMemo(() =>
    components.filter((c) => c.category === category && c.norm_value != null && c.norm_value > 0),
    [components, category]
  );

  // Build TUC lookup per component (IDR, post all costs)
  const tucByComponent = useMemo(() => {
    const result = new Map<string, number>(); // component_id → IDR per piece

    // Group PO items by component
    const itemsByComp = new Map<string, PurchaseLineItem[]>();
    for (const item of poItems) {
      const arr = itemsByComp.get(item.component_id) ?? [];
      arr.push(item);
      itemsByComp.set(item.component_id, arr);
    }

    for (const comp of catComponents) {
      const items = itemsByComp.get(comp.component_id) ?? [];
      if (!items.length) continue;

      // Use most recent PO item
      const sortedItems = [...items].sort((a, b) => {
        const poA = pos.find((p) => p.po_id === a.po_id);
        const poB = pos.find((p) => p.po_id === b.po_id);
        return (poB?.po_date ?? '') > (poA?.po_date ?? '') ? 1 : -1;
      });
      const latestItem = sortedItems[0];
      const thePo = pos.find((p) => p.po_id === latestItem.po_id);
      if (!thePo) continue;

      // PO total value for share computation
      const poLineItems = poItems.filter((pi) => pi.po_id === thePo.po_id);
      const poTotalInPoFx = poLineItems.reduce((s, li) => s + li.unit_cost * li.quantity, 0);
      if (poTotalInPoFx === 0) continue;

      const lineValueInPoFx = latestItem.unit_cost * latestItem.quantity;
      const lineShare = lineValueInPoFx / poTotalInPoFx;

      // PO costs for this PO
      const thisPoCosts = poCosts.filter((c) => c.po_id === thePo.po_id);
      const exRate = thePo.exchange_rate ?? FX[thePo.currency] ?? 16000;

      const toIdrCost = (c: POCost) => {
        const rate = c.exchange_rate ?? (c.currency === 'IDR' ? 1 : exRate);
        return c.amount * rate;
      };

      // Exclude tax for TUC (net of tax)
      const taxCatSet = new Set<string>(['local_vat', 'local_income_tax', 'local_import_tax']);
      const nonTaxCosts = thisPoCosts.filter((c) => !taxCatSet.has(c.cost_category));
      const totalNonTaxIdr = nonTaxCosts.reduce((s, c) => s + toIdrCost(c), 0);
      const lineShareIdr = totalNonTaxIdr * lineShare;
      const tucIdr = latestItem.quantity > 0 ? lineShareIdr / latestItem.quantity : 0;

      if (tucIdr > 0) result.set(comp.component_id, tucIdr);
    }
    return result;
  }, [catComponents, poItems, poCosts, pos]);

  // Last quoted price per component (IDR)
  const lastQuoteByComponent = useMemo(() => {
    const result = new Map<string, { priceIdr: number; currency: string; price: number }>();
    const sortedQuotes = [...quotes].sort((a, b) => b.quote_date.localeCompare(a.quote_date));
    for (const q of sortedQuotes) {
      for (const item of quoteItems.filter((qi) => qi.quote_id === q.quote_id)) {
        if (!result.has(item.component_id)) {
          result.set(item.component_id, {
            priceIdr: toIdr(item.unit_price, item.currency),
            currency: item.currency,
            price: item.unit_price,
          });
        }
      }
    }
    return result;
  }, [quotes, quoteItems]);

  // Last PO unit cost per component (IDR)
  const lastPoByComponent = useMemo(() => {
    const result = new Map<string, { priceIdr: number; currency: string; price: number }>();
    const sortedPos = [...pos].sort((a, b) => b.po_date.localeCompare(a.po_date));
    for (const p of sortedPos) {
      for (const item of poItems.filter((pi) => pi.po_id === p.po_id)) {
        if (!result.has(item.component_id)) {
          const exRate = p.exchange_rate ?? FX[p.currency] ?? 16000;
          result.set(item.component_id, {
            priceIdr: toIdr(item.unit_cost, p.currency),
            currency: p.currency,
            price: item.unit_cost,
          });
        }
      }
    }
    return result;
  }, [pos, poItems]);

  // Build dot data
  const dots = useMemo((): DotData[] => {
    return catComponents.flatMap((c) => {
      const normValue = c.norm_value!;
      const tuc = tucByComponent.get(c.component_id);
      const quote = lastQuoteByComponent.get(c.component_id);
      const poCost = lastPoByComponent.get(c.component_id);

      let priceIdr = 0;
      let priceSource: 'tuc' | 'quote' | 'po' = 'tuc';
      let rawPrice = 0;
      let rawCurrency = 'IDR';

      if (tuc && tuc > 0) {
        priceIdr = tuc;
        priceSource = 'tuc';
        rawPrice = tuc;
        rawCurrency = 'IDR';
      } else if (quote) {
        priceIdr = quote.priceIdr;
        priceSource = 'quote';
        rawPrice = quote.price;
        rawCurrency = quote.currency;
      } else if (poCost) {
        priceIdr = poCost.priceIdr;
        priceSource = 'po';
        rawPrice = poCost.price;
        rawCurrency = poCost.currency;
      } else {
        return [];
      }

      // For categories where unit price IS the Y-value (e.g. cables priced per meter),
      // don't divide by norm_value — norm_value is only the X-axis spec (e.g. mm²).
      const pricePerUnit = unitInfo?.priceIsPerUnit ? priceIdr : priceIdr / normValue;
      if (pricePerUnit <= 0 || !isFinite(pricePerUnit)) return [];

      return [{
        component_id: c.component_id,
        label: c.supplier_model,
        brand: c.brand ?? 'Unknown',
        normValue,
        pricePerUnit,
        priceSource,
        rawPrice,
        rawCurrency,
      }];
    });
  }, [catComponents, tucByComponent, lastQuoteByComponent, lastPoByComponent, category]);

  // Brands with stable color indices
  const brandColorMap = useMemo(() => {
    const brands = [...new Set(dots.map((d) => d.brand))].sort();
    return new Map(brands.map((b, i) => [b, i]));
  }, [dots]);

  // Layout constants
  const W = 720, H = 460;
  const PAD = { top: 32, right: 32, bottom: 60, left: 80 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const xVals = dots.map((d) => d.normValue);
  const yVals = dots.map((d) => d.pricePerUnit);
  const xMin = xVals.length ? Math.min(...xVals) : 0;
  const xMax = xVals.length ? Math.max(...xVals) : 1;
  const yMin = yVals.length ? Math.min(...yVals) : 0;
  const yMax = yVals.length ? Math.max(...yVals) : 1;

  const xPad = (xMax - xMin) * 0.1 || 1;
  const yPad = (yMax - yMin) * 0.1 || 1;
  const xL = xMin - xPad, xR = xMax + xPad;
  const yB = yMin - yPad, yT = yMax + yPad;

  const xMed = median(xVals);
  const yMed = median(yVals);

  const toSvgX = (v: number) => PAD.left + ((v - xL) / (xR - xL)) * plotW;
  const toSvgY = (v: number) => PAD.top + plotH - ((v - yB) / (yT - yB)) * plotH;

  const xMedSvg = toSvgX(xMed);
  const yMedSvg = toSvgY(yMed);

  function fmtIdr(v: number) {
    if (v >= 1_000_000) return `Rp ${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `Rp ${(v / 1_000).toFixed(0)}k`;
    return `Rp ${Math.round(v).toLocaleString('en-US')}`;
  }

  function fmtYAxis(v: number) {
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `${Math.round(v / 1_000)}k`;
    return Math.round(v).toString();
  }

  // Y-axis tick values
  const yTicks = useMemo(() => {
    if (!dots.length) return [];
    const range = yT - yB;
    const step = Math.pow(10, Math.floor(Math.log10(range / 5)));
    const rawStep = range / 5;
    const niceStep = [1, 2, 5].map((m) => m * step).find((s) => s >= rawStep) ?? step;
    const ticks: number[] = [];
    let t = Math.ceil(yB / niceStep) * niceStep;
    while (t <= yT) { ticks.push(t); t += niceStep; }
    return ticks;
  }, [yB, yT, dots.length]);

  // X-axis tick values
  const xTicks = useMemo(() => {
    if (!dots.length) return [];
    const range = xR - xL;
    const step = Math.pow(10, Math.floor(Math.log10(range / 5)));
    const rawStep = range / 5;
    const niceStep = [1, 2, 5].map((m) => m * step).find((s) => s >= rawStep) ?? step;
    const ticks: number[] = [];
    let t = Math.ceil(xL / niceStep) * niceStep;
    while (t <= xR) { ticks.push(t); t += niceStep; }
    return ticks;
  }, [xL, xR, dots.length]);

  const categoriesWithUnits = ENUMS.product_category.filter(hasCategoryUnit);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-500 text-sm">Loading…</div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <label className="block text-[10px] text-slate-500 mb-1 uppercase tracking-wider">Category</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-violet-500 min-w-[200px]"
          >
            {categoriesWithUnits.map((cat) => (
              <option key={cat} value={cat}>{CATEGORY_LABELS[cat] ?? cat}</option>
            ))}
          </select>
        </div>
        {unitInfo && (
          <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-4">
            <span className="px-2 py-1 bg-slate-800 rounded-md text-slate-400">
              X: {unitInfo.axis}
            </span>
            <span className="px-2 py-1 bg-slate-800 rounded-md text-slate-400">
              Y: {unitInfo.priceLabel} (IDR)
            </span>
          </div>
        )}
      </div>

      {dots.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-slate-500 text-sm gap-2">
          <svg className="w-10 h-10 opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <circle cx="11" cy="11" r="8" strokeWidth="1.5" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M21 21l-4.35-4.35" />
          </svg>
          <p className="font-medium text-slate-400">No data for this category</p>
          <p className="text-[11px] text-slate-600 max-w-xs text-center">
            Set a <span className="text-slate-400">{unitInfo?.priceIsPerUnit ? `Cross-section (${unitInfo?.unit})` : `Capacity (${unitInfo?.unit})`}</span> on components in this category to place them on the map.
          </p>
        </div>
      ) : (
        <div className="relative">
          {/* SVG Chart */}
          <div className="overflow-x-auto">
            <svg
              ref={svgRef}
              width={W}
              height={H}
              className="block"
              style={{ minWidth: W }}
              onMouseLeave={() => setTooltip(null)}
            >
              {/* Background */}
              <rect x={PAD.left} y={PAD.top} width={plotW} height={plotH} fill="rgba(15,23,42,0.6)" rx="4" />

              {/* Quadrant fills */}
              {xMed > xL && xMed < xR && yMed > yB && yMed < yT && (
                <>
                  {/* Top-left: High price, Low capacity → "Premium Small" */}
                  <rect x={PAD.left} y={PAD.top} width={xMedSvg - PAD.left} height={yMedSvg - PAD.top} fill="rgba(251,146,60,0.04)" />
                  {/* Top-right: High price, High capacity → "Premium" */}
                  <rect x={xMedSvg} y={PAD.top} width={PAD.left + plotW - xMedSvg} height={yMedSvg - PAD.top} fill="rgba(168,85,247,0.04)" />
                  {/* Bottom-left: Low price, Low capacity → "Budget" */}
                  <rect x={PAD.left} y={yMedSvg} width={xMedSvg - PAD.left} height={PAD.top + plotH - yMedSvg} fill="rgba(148,163,184,0.04)" />
                  {/* Bottom-right: Low price, High capacity → "Best Value" */}
                  <rect x={xMedSvg} y={yMedSvg} width={PAD.left + plotW - xMedSvg} height={PAD.top + plotH - yMedSvg} fill="rgba(52,211,153,0.06)" />
                </>
              )}

              {/* Grid lines */}
              {yTicks.map((t) => {
                const sy = toSvgY(t);
                if (sy < PAD.top || sy > PAD.top + plotH) return null;
                return (
                  <g key={`yt-${t}`}>
                    <line x1={PAD.left} y1={sy} x2={PAD.left + plotW} y2={sy} stroke="rgba(148,163,184,0.08)" strokeWidth="1" />
                    <text x={PAD.left - 6} y={sy + 4} textAnchor="end" fill="rgba(148,163,184,0.5)" fontSize="10">{fmtYAxis(t)}</text>
                  </g>
                );
              })}
              {xTicks.map((t) => {
                const sx = toSvgX(t);
                if (sx < PAD.left || sx > PAD.left + plotW) return null;
                return (
                  <g key={`xt-${t}`}>
                    <line x1={sx} y1={PAD.top} x2={sx} y2={PAD.top + plotH} stroke="rgba(148,163,184,0.08)" strokeWidth="1" />
                    <text x={sx} y={PAD.top + plotH + 16} textAnchor="middle" fill="rgba(148,163,184,0.5)" fontSize="10">{t}</text>
                  </g>
                );
              })}

              {/* Median quadrant lines */}
              {xMed > 0 && (
                <line x1={xMedSvg} y1={PAD.top} x2={xMedSvg} y2={PAD.top + plotH} stroke="rgba(148,163,184,0.25)" strokeWidth="1" strokeDasharray="4 3" />
              )}
              {yMed > 0 && (
                <line x1={PAD.left} y1={yMedSvg} x2={PAD.left + plotW} y2={yMedSvg} stroke="rgba(148,163,184,0.25)" strokeWidth="1" strokeDasharray="4 3" />
              )}

              {/* Quadrant labels */}
              {xMed > xL && xMed < xR && yMed > yB && yMed < yT && (
                <>
                  <text x={PAD.left + 8} y={PAD.top + 16} fill="rgba(251,146,60,0.5)" fontSize="9" fontWeight="600" letterSpacing="0.05em">PREMIUM SMALL</text>
                  <text x={xMedSvg + 8} y={PAD.top + 16} fill="rgba(168,85,247,0.5)" fontSize="9" fontWeight="600" letterSpacing="0.05em">PREMIUM</text>
                  <text x={PAD.left + 8} y={PAD.top + plotH - 8} fill="rgba(148,163,184,0.4)" fontSize="9" fontWeight="600" letterSpacing="0.05em">BUDGET</text>
                  <text x={xMedSvg + 8} y={PAD.top + plotH - 8} fill="rgba(52,211,153,0.55)" fontSize="9" fontWeight="600" letterSpacing="0.05em">BEST VALUE</text>
                </>
              )}

              {/* Axes borders */}
              <rect x={PAD.left} y={PAD.top} width={plotW} height={plotH} fill="none" stroke="rgba(148,163,184,0.15)" strokeWidth="1" rx="4" />

              {/* Axis labels */}
              <text x={PAD.left + plotW / 2} y={H - 8} textAnchor="middle" fill="rgba(148,163,184,0.5)" fontSize="11">
                {unitInfo?.axis ?? 'Capacity'}
              </text>
              <text
                x={16}
                y={PAD.top + plotH / 2}
                textAnchor="middle"
                fill="rgba(148,163,184,0.5)"
                fontSize="11"
                transform={`rotate(-90, 16, ${PAD.top + plotH / 2})`}
              >
                {unitInfo?.priceLabel ?? 'Price / unit'} (IDR)
              </text>

              {/* Dots */}
              {dots.map((d) => {
                const sx = toSvgX(d.normValue);
                const sy = toSvgY(d.pricePerUnit);
                const colorIdx = brandColorMap.get(d.brand) ?? 0;
                const color = brandColor(d.brand, colorIdx);
                const isHovered = tooltip?.dot.component_id === d.component_id;
                return (
                  <g key={d.component_id}>
                    <circle
                      cx={sx}
                      cy={sy}
                      r={isHovered ? 9 : 7}
                      fill={color}
                      fillOpacity={isHovered ? 0.95 : 0.75}
                      stroke={isHovered ? '#fff' : color}
                      strokeWidth={isHovered ? 2 : 1}
                      strokeOpacity={0.8}
                      style={{ cursor: 'pointer', transition: 'r 0.1s, fill-opacity 0.1s' }}
                      onMouseEnter={(e) => {
                        const svgRect = svgRef.current?.getBoundingClientRect();
                        setTooltip({ dot: d, x: e.clientX - (svgRect?.left ?? 0), y: e.clientY - (svgRect?.top ?? 0) });
                      }}
                      onMouseLeave={() => setTooltip(null)}
                    />
                    {/* Label for hovered dot */}
                    {isHovered && (
                      <text
                        x={sx}
                        y={sy - 12}
                        textAnchor="middle"
                        fill="#fff"
                        fontSize="10"
                        fontWeight="600"
                        stroke="#0B1120"
                        strokeWidth="3"
                        paintOrder="stroke"
                      >
                        {d.label.length > 20 ? d.label.slice(0, 20) + '…' : d.label}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>

          {/* Tooltip */}
          {tooltip && (
            <div
              className="absolute pointer-events-none z-50 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-3 text-xs w-64"
              style={{
                left: Math.min(tooltip.x + 14, W - 280),
                top: Math.max(tooltip.y - 80, 4),
              }}
            >
              <p className="font-semibold text-white leading-tight mb-1">{tooltip.dot.label}</p>
              <p className="text-slate-400 mb-2">{tooltip.dot.brand}</p>
              <div className="space-y-1">
                <div className="flex justify-between">
                  <span className="text-slate-500">{unitInfo?.priceIsPerUnit ? 'Cross-section' : 'Capacity'}</span>
                  <span className="tabular-nums text-slate-200">{tooltip.dot.normValue.toLocaleString('en-US')} {unitInfo?.unit}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">{unitInfo?.priceLabel}</span>
                  <span className="tabular-nums text-slate-200">{fmtIdr(tooltip.dot.pricePerUnit)}</span>
                </div>
                {!unitInfo?.priceIsPerUnit && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Unit price</span>
                  <span className="tabular-nums text-slate-200">
                    {tooltip.dot.rawCurrency} {tooltip.dot.rawPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
                )}
                <div className="flex justify-between">
                  <span className="text-slate-500">Source</span>
                  <span className={`font-medium ${tooltip.dot.priceSource === 'tuc' ? 'text-amber-400' : tooltip.dot.priceSource === 'quote' ? 'text-sky-400' : 'text-slate-400'}`}>
                    {tooltip.dot.priceSource === 'tuc' ? 'TUC' : tooltip.dot.priceSource === 'quote' ? 'Last quote' : 'Last PO'}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Legend */}
          {brandColorMap.size > 0 && (
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
              {[...brandColorMap.entries()].map(([brand, idx]) => (
                <div key={brand} className="flex items-center gap-1.5 text-[11px] text-slate-400">
                  <span
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ background: brandColor(brand, idx) }}
                  />
                  {brand}
                </div>
              ))}
            </div>
          )}

          {/* Stats row */}
          <div className="mt-3 flex flex-wrap gap-4 text-[11px] text-slate-500">
            <span>{dots.length} component{dots.length !== 1 ? 's' : ''} plotted</span>
            {xMed > 0 && <span>Median {unitInfo?.priceIsPerUnit ? 'cross-section' : 'capacity'}: <span className="text-slate-400">{xMed.toLocaleString('en-US')} {unitInfo?.unit}</span></span>}
            {yMed > 0 && <span>Median {unitInfo?.priceLabel}: <span className="text-slate-400">{fmtIdr(yMed)}</span></span>}
          </div>
        </div>
      )}
    </div>
  );
}
