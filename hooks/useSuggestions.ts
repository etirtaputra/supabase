/**
 * Suggestions Hook
 * Generates autocomplete suggestions from database data
 * Memoized for performance
 */

'use client';

import { useMemo } from 'react';
import type { DatabaseData, Suggestions } from '../types/database';

export function useSuggestions(data: DatabaseData): Suggestions {
  return useMemo(() => {
    const getUniqueCombined = (key: string, ...arrays: any[][]) => {
      const allValues = arrays
        .flatMap((arr) => (arr || []).map((item) => item[key]))
        .filter(Boolean);
      return Array.from(new Set(allValues)).sort();
    };

    return {
      brands: getUniqueCombined('brand', data.components, data.poHistory, data.quoteHistory),
      locations: getUniqueCombined('location', data.suppliers),
      paymentTerms: Array.from(
        new Set([
          ...getUniqueCombined('payment_terms_default', data.suppliers),
          ...getUniqueCombined('payment_terms', data.pos),
        ])
      ).sort(),
      incoterms: getUniqueCombined('incoterms', data.pos),
      modelSkus: getUniqueCombined('model_sku', data.components),
      descriptions: getUniqueCombined('description', data.components, data.poHistory, data.quoteHistory),
      supplierNames: getUniqueCombined('supplier_name', data.suppliers),
      poNumbers: getUniqueCombined('po_number', data.pos, data.poHistory),
      quoteNumbers: Array.from(
        new Set([
          ...getUniqueCombined('pi_number', data.quotes),
          ...getUniqueCombined('quote_number', data.quoteHistory),
        ])
      ).sort(),
    };
  }, [data]);
}
