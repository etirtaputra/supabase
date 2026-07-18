'use client';
import { useEffect, useState } from 'react';
import { createSupabaseClient } from '@/lib/supabase';

/**
 * Probes the sell-side (22.x) and inventory (30.x) tables. Renders an amber
 * banner pointing to the migration file when the database is behind the app.
 * The full SQL lives in migrations/create_sales_and_inventory.sql.
 */
export default function SalesMigrationBanner() {
  const supabase = createSupabaseClient();
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      const probes = await Promise.all([
        supabase.from('22.0_sales_quotes').select('quote_id, status, grand_total').limit(1),
        supabase.from('22.1_sales_quote_items').select('item_id').limit(1),
        supabase.from('30.0_stock_movements').select('movement_id').limit(1),
        supabase.from('30.1_stock_balances').select('component_id, qty_on_hand').limit(1),
      ]);
      if (!cancelled && probes.some((p) => p.error)) setMissing(true);
    }
    check();
    return () => { cancelled = true; };
  }, []);

  if (!missing) return null;

  return (
    <div className="bg-amber-500/10 border border-amber-500/40 rounded-2xl p-4 text-sm">
      <span className="text-amber-300 font-semibold">Sales &amp; inventory tables are not set up yet.</span>
      <span className="text-amber-200/80 text-xs ml-2">
        Run <span className="font-mono">migrations/create_sales_and_inventory.sql</span> in Supabase → SQL Editor → New query.
      </span>
    </div>
  );
}
