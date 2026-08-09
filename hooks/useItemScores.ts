'use client';
/**
 * useItemScores — the Item Score, computed once and reusable on any owner
 * screen that lists items (the Items master list, Profitability…).
 *
 * The score is a percentile RANK within each item's category, so it can only be
 * computed over the whole catalog at once — not per row. This hook does that:
 * it self-fetches the facts every factor needs (delivered sales for revenue /
 * margin / momentum / position / DIO, PO timing for lead time, receipt costs
 * for stability, links for lifecycle), assembles one ItemScoreInput per item,
 * and returns the scores keyed by component id. Weights come from Settings, so
 * a re-weight re-scores without re-fetching.
 *
 * It mirrors the Profitability dashboard's own basis exactly (revenue = DO
 * lines at SO price ex-PPN; COGS = the ledger's stamped moving-average landed
 * cost) so the same item reads the same score on both screens.
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { computeItemScores, type ItemScoreInput, type ItemScoreResult } from '@/lib/itemScore';
import { useSettings } from './useSettings';

/** Trading-activity numbers per item, for a Binance-style "volume / trending"
 *  sort — recent sales value, units, and demand momentum. */
export interface ItemMetrics {
  revenue90d: number;          // sales value in the last 90 days (the "volume")
  units90d: number;            // units shipped in the last 90 days
  momentumPct: number | null;  // demand growth vs the prior 90 days; null = no baseline
  /** A single sortable "trending" number: rising volume ranks highest. */
  trend: number;
}

const daysBetween = (a: string, b: string) => (new Date(a).getTime() - new Date(b).getTime()) / 86400000;

interface Raw {
  comps: { component_id: string; category: string | null }[];
  bals: Map<string, { qty: number; avg: number }>;
  moves: { component_id: string | null; direction: string; quantity: number | null; unit_cost_idr: number | null; source_type: string | null; source_id: string | null }[];
  dos: { do_id: string; quote_id: string; status: string; delivered_at: string | null }[];
  doItems: { do_id: string; so_item_id: string | null; component_id: string | null; qty: number | null }[];
  soPrice: Map<string, number>;                        // so_item_id → unit_price
  poDate: Map<string, string>;
  poReceived: Map<string, string>;
  poComps: { po_id: string; component_id: string }[];
  superseded: Set<string>;
}

export function useItemScores(supabase: SupabaseClient, enabled: boolean): { scores: Map<string, ItemScoreResult>; metrics: Map<string, ItemMetrics>; loading: boolean } {
  const weights = useSettings().itemScoreWeights;
  const [raw, setRaw] = useState<Raw | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const fetchAllComps = async () => {
      const PAGE = 1000; let all: { component_id: string; category: string | null }[] = []; let from = 0;
      for (;;) {
        const { data } = await supabase.from('3.0_components').select('component_id, category').range(from, from + PAGE - 1);
        if (!data || data.length === 0) break;
        all = all.concat(data as { component_id: string; category: string | null }[]);
        if (data.length < PAGE) break;
        from += PAGE;
      }
      return all;
    };
    const [comps, balRes, movRes, doRes, doiRes, soiRes, poRes, poiRes, linkRes] = await Promise.all([
      fetchAllComps(),
      supabase.from('30.1_stock_balances').select('component_id, qty_on_hand, avg_cost_idr'),
      supabase.from('30.0_stock_movements').select('component_id, direction, quantity, unit_cost_idr, source_type, source_id').limit(20000),
      supabase.from('24.0_delivery_orders').select('do_id, quote_id, status, delivered_at'),
      supabase.from('24.1_delivery_order_items').select('do_id, so_item_id, component_id, qty'),
      supabase.from('22.1_sales_quote_items').select('item_id, unit_price'),
      supabase.from('5.0_purchases').select('po_id, po_date, actual_received_date'),
      supabase.from('5.1_purchase_line_items').select('po_id, component_id'),
      supabase.from('8.0_component_links').select('component_id_a, component_id_b, link_type'),
    ]);
    const bals = new Map<string, { qty: number; avg: number }>();
    for (const b of (balRes.data as { component_id: string; qty_on_hand: number | null; avg_cost_idr: number | null }[]) ?? []) {
      const prev = bals.get(b.component_id) ?? { qty: 0, avg: 0 };
      bals.set(b.component_id, { qty: prev.qty + (Number(b.qty_on_hand) || 0), avg: (Number(b.avg_cost_idr) || 0) > 0 ? Number(b.avg_cost_idr) : prev.avg });
    }
    const soPrice = new Map<string, number>();
    for (const s of (soiRes.data as { item_id: string; unit_price: number | null }[]) ?? []) soPrice.set(s.item_id, Number(s.unit_price) || 0);
    const poDate = new Map<string, string>(), poReceived = new Map<string, string>();
    for (const p of (poRes.data as { po_id: unknown; po_date: string | null; actual_received_date: string | null }[]) ?? []) {
      if (p.po_date) poDate.set(String(p.po_id), p.po_date);
      if (p.actual_received_date) poReceived.set(String(p.po_id), p.actual_received_date);
    }
    const superseded = new Set<string>();
    for (const l of (linkRes.data as { component_id_a: string; component_id_b: string; link_type: string }[]) ?? []) {
      if (l.link_type === 'successor' && l.component_id_a) superseded.add(String(l.component_id_a));
    }
    setRaw({
      comps,
      bals,
      moves: (movRes.data as Raw['moves']) ?? [],
      dos: (doRes.data as Raw['dos']) ?? [],
      doItems: (doiRes.data as Raw['doItems']) ?? [],
      soPrice,
      poDate,
      poReceived,
      poComps: (((poiRes.data as { po_id: unknown; component_id: string | null }[]) ?? []).filter((r) => r.component_id).map((r) => ({ po_id: String(r.po_id), component_id: r.component_id! }))),
      superseded,
    });
    setLoading(false);
  }, [supabase]);

  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  const { scores, metrics } = useMemo(() => {
    if (!raw) return { scores: new Map<string, ItemScoreResult>(), metrics: new Map<string, ItemMetrics>() };

    // Delivered facts: one per delivered DO × component — revenue at SO price,
    // COGS from the ledger's net out cost (fallback to current avg).
    const ledger = new Map<string, { qty: number; cost: number }>();
    for (const m of raw.moves) {
      if (m.source_type !== 'delivery' || !m.source_id || !m.component_id) continue;
      const k = `${m.source_id}·${m.component_id}`;
      const e = ledger.get(k) ?? { qty: 0, cost: 0 };
      const sign = m.direction === 'out' ? 1 : -1;
      e.qty += sign * (Number(m.quantity) || 0);
      e.cost += sign * (Number(m.quantity) || 0) * (Number(m.unit_cost_idr) || 0);
      ledger.set(k, e);
    }
    interface Fact { component_id: string; date: string; qty: number; revenue: number; cogs: number; }
    const facts: Fact[] = [];
    for (const d of raw.dos) {
      if (d.status !== 'delivered') continue;
      const byComp = new Map<string, { qty: number; revenue: number }>();
      for (const li of raw.doItems) {
        if (li.do_id !== d.do_id || !li.component_id) continue;
        const price = li.so_item_id ? (raw.soPrice.get(li.so_item_id) ?? 0) : 0;
        const e = byComp.get(li.component_id) ?? { qty: 0, revenue: 0 };
        e.qty += Number(li.qty) || 0;
        e.revenue += (Number(li.qty) || 0) * price;
        byComp.set(li.component_id, e);
      }
      for (const [cid, e] of byComp) {
        const led = ledger.get(`${d.do_id}·${cid}`);
        const cogs = led && led.qty > 0 && led.cost > 0 ? led.cost * (e.qty / led.qty) : e.qty * (raw.bals.get(cid)?.avg ?? 0);
        facts.push({ component_id: cid, date: d.delivered_at ?? '', qty: e.qty, revenue: e.revenue, cogs });
      }
    }

    // Per-item rollups.
    const rev = new Map<string, number>(), cogsAll = new Map<string, number>(), gpAll = new Map<string, number>();
    const recent = new Map<string, number>(), prior = new Map<string, number>(), events = new Map<string, number>();
    const rev90 = new Map<string, number>();
    let firstDate = '';
    const d90 = new Date(Date.now() - 90 * 86400000).toISOString();
    const d180 = new Date(Date.now() - 180 * 86400000).toISOString();
    for (const f of facts) {
      rev.set(f.component_id, (rev.get(f.component_id) ?? 0) + f.revenue);
      cogsAll.set(f.component_id, (cogsAll.get(f.component_id) ?? 0) + f.cogs);
      gpAll.set(f.component_id, (gpAll.get(f.component_id) ?? 0) + (f.revenue - f.cogs));
      events.set(f.component_id, (events.get(f.component_id) ?? 0) + 1);
      if (f.date) {
        if (!firstDate || f.date < firstDate) firstDate = f.date;
        if (f.date >= d90) {
          recent.set(f.component_id, (recent.get(f.component_id) ?? 0) + f.qty);
          rev90.set(f.component_id, (rev90.get(f.component_id) ?? 0) + f.revenue);
        } else if (f.date >= d180) prior.set(f.component_id, (prior.get(f.component_id) ?? 0) + f.qty);
      }
    }
    const spanDays = firstDate ? Math.max(30, Math.ceil(daysBetween(new Date().toISOString(), firstDate))) : 365;

    // Lead time (PO → receipt) per item, with the catalog-wide average fallback.
    const leadAgg = new Map<string, { sum: number; n: number }>(); let gSum = 0, gN = 0;
    for (const pc of raw.poComps) {
      const r = raw.poReceived.get(pc.po_id), o = raw.poDate.get(pc.po_id);
      if (!r || !o) continue;
      const d = daysBetween(r, o);
      if (!(d >= 0)) continue;
      const e = leadAgg.get(pc.component_id) ?? { sum: 0, n: 0 }; e.sum += d; e.n += 1; leadAgg.set(pc.component_id, e);
      gSum += d; gN += 1;
    }
    const leadGlobal = gN > 0 ? gSum / gN : null;

    // Purchase-cost stability (CoV of landed receipt costs).
    const costs = new Map<string, number[]>();
    for (const m of raw.moves) {
      if (m.direction !== 'in' || !m.component_id) continue;
      const c = Number(m.unit_cost_idr) || 0; if (c <= 0) continue;
      (costs.get(m.component_id) ?? costs.set(m.component_id, []).get(m.component_id)!).push(c);
    }

    const inputs: ItemScoreInput[] = raw.comps.map((c) => {
      const bal = raw.bals.get(c.component_id);
      const stockValue = Math.max(0, bal?.qty ?? 0) * (bal?.avg ?? 0);
      const cogsPeriod = cogsAll.get(c.component_id) ?? 0;
      const revenue = rev.get(c.component_id) ?? 0;
      const lead = leadAgg.get(c.component_id);
      const cs = costs.get(c.component_id);
      let cov: number | null = null;
      if (cs && cs.length >= 2) {
        const mean = cs.reduce((s, x) => s + x, 0) / cs.length;
        if (mean > 0) cov = Math.sqrt(cs.reduce((s, x) => s + (x - mean) ** 2, 0) / cs.length) / mean;
      }
      return {
        id: c.component_id,
        category: c.category,
        revenue,
        marginPct: revenue > 0 ? ((revenue - cogsPeriod) / revenue) * 100 : null,
        demandRecent: recent.get(c.component_id) ?? 0,
        demandPrior: prior.get(c.component_id) ?? 0,
        leadDays: lead && lead.n > 0 ? lead.sum / lead.n : leadGlobal,
        recoveryRatio: stockValue > 0 ? (gpAll.get(c.component_id) ?? 0) / stockValue : null,
        superseded: raw.superseded.has(c.component_id),
        saleEvents: events.get(c.component_id) ?? 0,
        costCoV: cov,
        dioDays: stockValue > 0 && cogsPeriod > 0 ? stockValue / (cogsPeriod / spanDays) : null,
      };
    });

    // Trading metrics for the volume / trending sort.
    const metrics = new Map<string, ItemMetrics>();
    for (const c of raw.comps) {
      const r90 = rev90.get(c.component_id) ?? 0;
      const u90 = recent.get(c.component_id) ?? 0;
      const u0 = prior.get(c.component_id) ?? 0;
      const momentumPct = u0 > 0 ? ((u90 - u0) / u0) * 100 : null;
      // Trending = recent volume amplified by whether it's rising. A first
      // sale with no baseline gets a modest lift; a dead item sinks below zero.
      const factor = momentumPct === null ? (u90 > 0 ? 1.5 : 0) : 1 + Math.max(-1, Math.min(3, momentumPct / 100));
      metrics.set(c.component_id, { revenue90d: r90, units90d: u90, momentumPct, trend: r90 * factor });
    }
    return { scores: computeItemScores(inputs, weights), metrics };
  }, [raw, weights]);

  return { scores, metrics, loading };
}
