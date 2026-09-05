'use client';
/**
 * Search results — the primary way into the catalogue, across departments.
 * Model number first, then name, then a spec value; every token must match.
 */
import React, { Suspense, useEffect, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { searchItems } from '@/lib/shopCatalog';
import { ShopShell, useCart } from '@/components/shop/shopUi';
import { useShopData } from '@/components/shop/useShopData';
import ProductTable from '@/components/shop/ProductTable';

function Results() {
  const params = useSearchParams();
  const q = params.get('q') ?? '';
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const { items, loading } = useShopData();
  const { add } = useCart();

  useEffect(() => { document.title = `${q || 'Cari'} — ICA Solar (demo)`; }, [q]);
  useEffect(() => {
    if (!authLoading && !user) router.replace(`/login?next=${encodeURIComponent(`/shop/search?q=${q}`)}`);
  }, [authLoading, user, router, q]);

  const results = useMemo(() => searchItems(items, q), [items, q]);

  return (
    <ShopShell q={q}>
      <div className="wrap" style={{ padding: '12px 16px 0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, paddingBottom: 8, borderBottom: '2px solid var(--navy)' }}>
          <h1 className="h1">Hasil untuk <span style={{ color: 'var(--navy)' }}>“{q}”</span></h1>
          <span className="num" style={{ fontSize: 12, color: 'var(--muted)' }}>{loading ? '…' : `${results.length} item`}</span>
        </div>
        {loading
          ? <div style={{ padding: 24, color: 'var(--muted)' }}>Memuat…</div>
          : <ProductTable items={results} columns={[]} showCategory onAdd={add}
              empty={q ? 'Tidak ada yang cocok. Coba nomor model, atau angka dengan satuannya: 620wp, 40a, 48v.' : 'Ketik sesuatu untuk mencari.'} />}
      </div>
    </ShopShell>
  );
}

export default function SearchPage() {
  return <Suspense fallback={null}><Results /></Suspense>;
}
