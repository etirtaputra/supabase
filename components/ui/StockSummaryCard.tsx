'use client';
import { useState, useEffect } from 'react';
import { createSupabaseClient } from '@/lib/supabase';
import { COMMITTED_STATUSES as COMMITTED } from '@/lib/salesStatus';
import { fetchDeliveredByQuoteComp } from '@/lib/reservedStock';

/**
 * Compact per-item stock summary for the Component Editor's Inspect panel:
 * Physical / Reserved / Live + moving-avg landed cost and stock value.
 * Self-contained fetch; renders nothing until loaded (and a quiet dash row if
 * the inventory tables aren't installed).
 */
const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');

export default function StockSummaryCard({ componentId, unit }: { componentId: string; unit?: string | null }) {
  const supabase = createSupabaseClient();
  const [data, setData] = useState<{ physical: number; reserved: number; avgCost: number } | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [balRes, sqRes, sqiRes] = await Promise.all([
        supabase.from('30.1_stock_balances').select('qty_on_hand, avg_cost_idr').eq('component_id', componentId),
        supabase.from('22.0_sales_quotes').select('quote_id, status'),
        supabase.from('22.1_sales_quote_items').select('quote_id, quantity, is_section').eq('component_id', componentId),
      ]);
      if (cancelled) return;
      if (balRes.error) { setError(true); return; }
      let physical = 0, avgCost = 0;
      for (const b of (balRes.data ?? []) as { qty_on_hand: number; avg_cost_idr: number }[]) {
        physical += Number(b.qty_on_hand) || 0;
        avgCost = Number(b.avg_cost_idr) || avgCost;
      }
      const committed = new Set((((sqRes.data ?? []) as { quote_id: string; status: string }[])).filter((q) => COMMITTED.has(q.status)).map((q) => q.quote_id));
      let reserved = 0;
      for (const it of ((sqiRes.data ?? []) as { quote_id: string; quantity: number; is_section: boolean }[])) {
        if (!it.is_section && committed.has(it.quote_id)) reserved += Number(it.quantity) || 0;
      }
      // Split fulfillment: delivered DO qty on committed orders releases its reserve
      const deliveredSplit = await fetchDeliveredByQuoteComp(supabase);
      for (const [k, dq] of deliveredSplit) {
        const [qid, cid] = k.split('·');
        if (cid === componentId && committed.has(qid)) reserved = Math.max(0, reserved - dq);
      }
      setData({ physical, reserved, avgCost });
    }
    load();
    return () => { cancelled = true; };
  }, [componentId]);

  if (error) return null;

  const live = data ? data.physical - data.reserved : 0;

  return (
    <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
      <p className="text-[10px] font-bold uppercase tracking-wider text-amber-400/70 mb-2">Stock on hand</p>
      {!data ? (
        <div className="h-8 bg-slate-800/40 rounded-lg animate-pulse" />
      ) : (
        <div className="flex flex-wrap items-end gap-x-5 gap-y-1">
          <div>
            <p className="text-[10px] text-slate-500">Live / Physical</p>
            <p className="text-lg font-bold tabular-nums leading-tight">
              <span className={live < 0 ? 'text-red-400' : live === 0 ? 'text-slate-500' : 'text-emerald-300'}>{fmtInt(live)}</span>
              <span className="text-slate-600">/{fmtInt(data.physical)}</span>
              {unit && <span className="text-[11px] text-slate-600 font-normal"> {unit}</span>}
            </p>
          </div>
          {data.reserved > 0 && (
            <div>
              <p className="text-[10px] text-slate-500">Reserved on orders</p>
              <p className="text-sm font-semibold text-amber-300 tabular-nums">{fmtInt(data.reserved)}</p>
            </div>
          )}
          {data.avgCost > 0 && (
            <>
              <div>
                <p className="text-[10px] text-slate-500">Avg landed cost</p>
                <p className="text-sm font-semibold text-slate-300 tabular-nums">{fmtInt(data.avgCost)}</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-500">Stock value</p>
                <p className="text-sm font-semibold text-slate-200 tabular-nums">{fmtInt(data.physical * data.avgCost)}</p>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
