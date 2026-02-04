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
    payments: [],
    landedCosts: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch foundation data (critical)
      const [compRows, sup, comp] = await Promise.all([
        supabase.from(TABLE_NAMES.COMPANIES).select('company_id, legal_name'),
        supabase.from(TABLE_NAMES.SUPPLIERS).select('*'),
        supabase.from(TABLE_NAMES.COMPONENTS).select('*'),
      ]);

      setData((prev) => ({
        ...prev,
        companies: compRows.data || [],
        suppliers: sup.data || [],
        components: comp.data || [],
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
        .from(TABLE_NAMES.PAYMENT_DETAILS)
        .select('*')
        .then(({ data: payments }) => {
          if (payments) setData((prev) => ({ ...prev, payments }));
        });

      supabase
        .from(TABLE_NAMES.LANDED_COSTS)
        .select('*')
        .then(({ data: landedCosts }) => {
          if (landedCosts) setData((prev) => ({ ...prev, landedCosts }));
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
    refetch: fetchData,
  };
}
