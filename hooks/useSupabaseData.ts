/**
 * Supabase Data Hook — Optimized for responsiveness
 * Critical data loads first (companies, suppliers, components, quotes, POs)
 * Non-critical data (history, intel, links) loads async on-demand
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { createSupabaseClient } from '@/lib/supabase';
import { TABLE_NAMES } from '../constants/tableNames';
import type { DatabaseData } from '../types/database';

export function useSupabaseData() {
  const supabase = createSupabaseClient();
  const [data, setData] = useState<DatabaseData>({
    companies: [],
    suppliers: [],
    components: [],
    quotes: [],
    quoteItems: [],
    pis: [],
    pos: [],
    poItems: [],
    poCosts: [],
    poHistory: [],
    quoteHistory: [],
    competitorPrices: [],
    componentHistory: [],
    componentLinks: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch all components with range pagination
  const fetchAllComponents = useCallback(async () => {
    const PAGE = 1000;
    let all: any[] = [];
    let from = 0;
    while (true) {
      const { data: page, error } = await supabase
        .from(TABLE_NAMES.COMPONENTS)
        .select('*')
        .order('supplier_model', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error || !page || page.length === 0) break;
      all = all.concat(page);
      if (page.length < PAGE) break;
      from += PAGE;
    }
    return all;
  }, [supabase]);

  // Fetch critical data (companies, suppliers, components, quotes, POs, costs)
  const fetchCriticalData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [compRows, sup, allComponents, quotes, quoteItems, pis, pos, poItems, poCosts] = await Promise.all([
        supabase.from(TABLE_NAMES.COMPANIES).select('company_id, legal_name'),
        supabase.from(TABLE_NAMES.SUPPLIERS).select('*'),
        fetchAllComponents(),
        supabase.from(TABLE_NAMES.PRICE_QUOTES).select('*').order('quote_date', { ascending: false }),
        supabase.from(TABLE_NAMES.PRICE_QUOTE_LINE_ITEMS).select('*'),
        supabase.from(TABLE_NAMES.PROFORMA_INVOICES).select('*').order('pi_date', { ascending: false }),
        supabase.from(TABLE_NAMES.PURCHASES).select('*').order('po_date', { ascending: false }),
        supabase.from(TABLE_NAMES.PURCHASE_LINE_ITEMS).select('*'),
        supabase.from(TABLE_NAMES.PO_COSTS).select('*').order('payment_date', { ascending: false, nullsFirst: false }),
      ]);

      setData((prev) => ({
        ...prev,
        companies: compRows.data || [],
        suppliers: sup.data || [],
        components: allComponents,
        quotes: quotes.data || [],
        quoteItems: quoteItems.data || [],
        pis: pis.data || [],
        pos: pos.data || [],
        poItems: poItems.data || [],
        poCosts: poCosts.data || [],
      }));
      setLoading(false);
    } catch (err: any) {
      setError(err.message || 'Failed to load data');
      setLoading(false);
    }
  }, [supabase, fetchAllComponents]);

  // Fetch non-critical data (history, intel, links) async
  const fetchNonCriticalData = useCallback(async () => {
    Promise.all([
      supabase.from(TABLE_NAMES.PURCHASE_HISTORY).select('*').order('po_date', { ascending: false }),
      supabase.from(TABLE_NAMES.QUOTE_HISTORY).select('*').order('quote_date', { ascending: false }),
      supabase.from(TABLE_NAMES.COMPETITOR_PRICES).select('*').order('observed_at', { ascending: false }),
      supabase.from(TABLE_NAMES.COMPONENT_HISTORY).select('*').order('changed_at', { ascending: false }).limit(2000),
      supabase.from(TABLE_NAMES.COMPONENT_LINKS).select('*'),
    ]).then(([poHist, qHist, intel, compHist, links]) => {
      setData((prev) => ({
        ...prev,
        poHistory: poHist.data || [],
        quoteHistory: qHist.data || [],
        competitorPrices: intel.data || [],
        componentHistory: compHist.data || [],
        componentLinks: links.data || [],
      }));
    });
  }, [supabase]);

  // Load critical data on mount
  useEffect(() => {
    fetchCriticalData();
  }, [fetchCriticalData]);

  // Load non-critical data after critical data is ready (async)
  useEffect(() => {
    if (!loading && data.companies.length > 0) {
      fetchNonCriticalData();
    }
  }, [loading, data.companies.length, fetchNonCriticalData]);

  // Selective refetch — only critical data (used after save)
  const refetch = useCallback(async () => {
    await fetchCriticalData();
  }, [fetchCriticalData]);

  // Full refetch including non-critical (used rarely, e.g., explicit refresh)
  const refetchAll = useCallback(async () => {
    await fetchCriticalData();
    fetchNonCriticalData();
  }, [fetchCriticalData, fetchNonCriticalData]);

  return {
    data,
    loading,
    error,
    refetch,           // Fast: only quotes/POs/components (use after save)
    refetchAll,        // Slow: everything including history/intel
  };
}
