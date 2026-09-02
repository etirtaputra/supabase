/**
 * Supabase Data Hook
 * Centralized data fetching with loading states and error handling
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { createSupabaseClient } from '@/lib/supabase';
import { fetchAllComponents } from '@/lib/fetchAllRows';
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
    exchangeRates: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);

  const fetchData = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      setError(null);


      // Fetch foundation data (critical)
      const [compRows, sup, allComponents] = await Promise.all([
        supabase.from(TABLE_NAMES.COMPANIES).select('company_id, legal_name'),
        supabase.from(TABLE_NAMES.SUPPLIERS).select('*'),
        // Every component, past the API row cap — lib/fetchAllRows.ts.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        fetchAllComponents<any>(supabase, '*'),
      ]);

      setData((prev) => ({
        ...prev,
        companies: compRows.data || [],
        suppliers: sup.data || [],
        components: allComponents,
      }));

      // Fetch transactional data (independent, non-blocking)
      supabase
        .from(TABLE_NAMES.PRICE_QUOTES)
        .select('*')
        .order('quote_date', { ascending: false })
        .then(({ data: quotes }) => {
          if (quotes) setData((prev) => ({ ...prev, quotes }));
        });

      // Line items carry a hand-set `sort_order` (dragged in Deal Lookup) so a
      // quote reads in the order the supplier's PI presents it. NULL means
      // never ordered and sorts last; `updated_at` then `quote_line_id` make
      // the rest deterministic — without them Postgres returns physical order,
      // which reshuffles silently whenever a row is written.
      supabase
        .from(TABLE_NAMES.PRICE_QUOTE_LINE_ITEMS)
        .select('*')
        .order('sort_order', { ascending: true, nullsFirst: false })
        .order('updated_at', { ascending: true })
        .order('quote_line_id', { ascending: true })
        .then(({ data: quoteItems }) => {
          if (quoteItems) setData((prev) => ({ ...prev, quoteItems }));
        });

      supabase
        .from(TABLE_NAMES.PROFORMA_INVOICES)
        .select('*')
        .order('pi_date', { ascending: false })
        .then(({ data: pis }) => {
          if (pis) setData((prev) => ({ ...prev, pis }));
        });

      supabase
        .from(TABLE_NAMES.PURCHASES)
        .select('*')
        .order('po_date', { ascending: false })
        .then(({ data: pos }) => {
          if (pos) setData((prev) => ({ ...prev, pos }));
        });

      supabase
        .from(TABLE_NAMES.PURCHASE_LINE_ITEMS)
        .select('*')
        .order('sort_order', { ascending: true, nullsFirst: false })
        .order('updated_at', { ascending: true })
        .order('po_line_item_id', { ascending: true })
        .then(({ data: poItems }) => {
          if (poItems) setData((prev) => ({ ...prev, poItems }));
        });

      supabase
        .from(TABLE_NAMES.PO_COSTS)
        .select('*')
        .order('payment_date', { ascending: false, nullsFirst: false })
        .then(({ data: poCosts }) => {
          if (poCosts) setData((prev) => ({ ...prev, poCosts }));
        });

      supabase
        .from(TABLE_NAMES.PURCHASE_HISTORY)
        .select('*')
        .order('po_date', { ascending: false })
        .then(({ data: poHistory }) => {
          if (poHistory) setData((prev) => ({ ...prev, poHistory }));
        });

      supabase
        .from(TABLE_NAMES.QUOTE_HISTORY)
        .select('*')
        .order('quote_date', { ascending: false })
        .then(({ data: quoteHistory }) => {
          if (quoteHistory) setData((prev) => ({ ...prev, quoteHistory }));
        });

      supabase
        .from(TABLE_NAMES.COMPETITOR_PRICES)
        .select('*')
        .order('observed_at', { ascending: false })
        .then(({ data: competitorPrices }) => {
          if (competitorPrices) setData((prev) => ({ ...prev, competitorPrices }));
        });

      supabase
        .from(TABLE_NAMES.COMPONENT_HISTORY)
        .select('*')
        .order('changed_at', { ascending: false })
        .limit(2000)
        .then(({ data: componentHistory }) => {
          if (componentHistory) setData((prev) => ({ ...prev, componentHistory }));
        });

      supabase
        .from(TABLE_NAMES.COMPONENT_LINKS)
        .select('*')
        .then(({ data: componentLinks }) => {
          if (componentLinks) setData((prev) => ({ ...prev, componentLinks }));
        });

      supabase
        .from(TABLE_NAMES.EXCHANGE_RATE_HISTORY)
        .select('*')
        .order('payment_date', { ascending: false })
        .then(({ data: exchangeRates }) => {
          if (exchangeRates) setData((prev) => ({ ...prev, exchangeRates }));
        });

      setLoading(false);
      setLastFetched(new Date());
    } catch (err: any) {
      setError(err.message || 'Failed to load data');
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return {
    data,
    loading,
    error,
    lastFetched,
    refetch: () => fetchData(true),
  };
}
