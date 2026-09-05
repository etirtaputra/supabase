'use client';
/**
 * Loading the catalogue for the shop, and drawing what it has no photo of.
 *
 * ONE read of the columns a storefront may see. Cost, supplier, TUC and margin
 * are not in the select — a page cannot leak a column it never asked for, and
 * when this moves to a public host the same list becomes the public view.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { createSupabaseClient } from '@/lib/supabase';
import { fetchAllComponents } from '@/lib/fetchAllRows';
import { isShoppable, type ShopItem } from '@/lib/shopCatalog';

const SHOP_COLUMNS = [
  'component_id', 'internal_description', 'supplier_model', 'brand', 'category',
  'unit', 'norm_value', 'selling_price_idr', 'datasheet_url',
  'warranty_value', 'warranty_unit', 'perf_warranty_value', 'perf_warranty_unit',
  'specifications',
].join(', ');

export function useShopData() {
  const supabase = useMemo(() => createSupabaseClient(), []);
  const [items, setItems] = useState<ShopItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    (async () => {
      // activeOnly: an archived item is off the shop for the same reason it is
      // off the Products list — it is not something we sell any more.
      const rows = await fetchAllComponents<ShopItem>(supabase, SHOP_COLUMNS, { activeOnly: true });
      if (!live) return;
      setItems((rows ?? []).filter(isShoppable));
      setLoading(false);
    })();
    return () => { live = false; };
  }, [supabase]);

  const byId = useMemo(() => new Map(items.map((i) => [i.component_id, i])), [items]);
  return { items, byId, loading };
}

/**
 * A technical line drawing per department.
 *
 * Not a placeholder grey box and not a stock photo: 0 of 1,002 catalogue rows
 * carries an image today, and a drawn outline is both honest about that and in
 * keeping with a catalogue that sells on numbers. Small parts may well keep
 * these once real photography exists.
 */
export function Thumb({ dept, size = 120 }: { dept: string | null; size?: number }) {
  const s = { width: size, height: Math.round(size * 0.72), fill: 'none' as const };
  const stroke = '#1f5aa8', faint = '#c3d6ec';
  switch (dept) {
    case 'panel':
      return (<svg {...s} viewBox="0 0 132 96" aria-hidden="true"><rect x="4" y="6" width="124" height="84" rx="3" stroke={stroke} strokeWidth="2" /><path d="M4 34h124M4 62h124M35 6v84M66 6v84M97 6v84" stroke={faint} strokeWidth="1.4" /></svg>);
    case 'battery':
      return (<svg {...s} viewBox="0 0 140 96" aria-hidden="true"><rect x="6" y="18" width="112" height="60" rx="4" stroke={stroke} strokeWidth="2" /><path d="M118 36v24h9V36z" stroke={stroke} strokeWidth="2" /><path d="M24 30v36M42 30v36M60 30v36" stroke={faint} strokeWidth="1.4" /></svg>);
    case 'inverter':
      return (<svg {...s} viewBox="0 0 132 96" aria-hidden="true"><rect x="26" y="6" width="80" height="84" rx="6" stroke={stroke} strokeWidth="2" /><path d="M40 22h52M40 32h34" stroke={faint} strokeWidth="1.4" /><path d="M60 46l-9 18h15l-7.5 16" stroke={stroke} strokeWidth="2" /></svg>);
    case 'controller':
      return (<svg {...s} viewBox="0 0 132 96" aria-hidden="true"><rect x="34" y="4" width="64" height="88" rx="6" stroke={stroke} strokeWidth="2" /><rect x="46" y="18" width="40" height="22" rx="3" stroke={faint} strokeWidth="1.6" /><path d="M48 56h36M48 68h20" stroke={stroke} strokeWidth="2" /></svg>);
    case 'mounting':
      return (<svg {...s} viewBox="0 0 132 96" aria-hidden="true"><path d="M8 62h116M8 74h116M8 62v12M124 62v12" stroke={stroke} strokeWidth="2" /><path d="M20 62V34M112 62V34" stroke={faint} strokeWidth="1.6" /><path d="M12 30h108" stroke={stroke} strokeWidth="2" /></svg>);
    case 'protection':
      return (<svg {...s} viewBox="0 0 132 96" aria-hidden="true"><rect x="44" y="10" width="44" height="76" rx="5" stroke={stroke} strokeWidth="2" /><path d="M66 24v16" stroke={stroke} strokeWidth="2" /><path d="M54 50h24" stroke={faint} strokeWidth="1.6" /><path d="M66 58v18" stroke={stroke} strokeWidth="2" /></svg>);
    case 'pump':
      return (<svg {...s} viewBox="0 0 132 96" aria-hidden="true"><circle cx="66" cy="40" r="26" stroke={stroke} strokeWidth="2" /><path d="M66 66v22M46 88h40" stroke={stroke} strokeWidth="2" /><path d="M56 40h20M66 30v20" stroke={faint} strokeWidth="1.6" /></svg>);
    case 'ev':
      return (<svg {...s} viewBox="0 0 132 96" aria-hidden="true"><rect x="34" y="8" width="46" height="80" rx="6" stroke={stroke} strokeWidth="2" /><path d="M80 34h12a6 6 0 0 1 6 6v16a5 5 0 0 0 10 0V36" stroke={stroke} strokeWidth="2" /><path d="M48 26h18" stroke={faint} strokeWidth="1.6" /></svg>);
    case 'enclosure':
      return (<svg {...s} viewBox="0 0 132 96" aria-hidden="true"><rect x="26" y="8" width="80" height="80" rx="4" stroke={stroke} strokeWidth="2" /><path d="M66 8v80" stroke={faint} strokeWidth="1.4" /><path d="M58 48h-4M74 48h4" stroke={stroke} strokeWidth="2" /></svg>);
    default:
      return (<svg {...s} viewBox="0 0 132 96" aria-hidden="true"><rect x="26" y="14" width="80" height="68" rx="5" stroke={stroke} strokeWidth="2" /><path d="M26 40h80" stroke={faint} strokeWidth="1.4" /></svg>);
  }
}
