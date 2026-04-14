/**
 * Supabase Data Hook
 * Centralized data fetching with loading states and error handling
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
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      setError(null);

      // Fetch all components with range pagination (PostgREST caps at 1000/page)
      const fetchAllComponents = async () => {
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
      };

      // Fetch foundation data (critical)
      const [compRows, sup, allComponents] = await Promise.all([
        supabase.from(TABLE_NAMES.COMPANIES).select('company_id, legal_name'),
        supabase.from(TABLE_NAMES.SUPPLIERS).select('*'),
        fetchAllComponents(),
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

      supabase
        .from(TABLE_NAMES.PRICE_QUOTE_LINE_ITEMS)
        .select('*')
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

      setLoading(false);
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
    refetch: () => fetchData(true),
  };
}
