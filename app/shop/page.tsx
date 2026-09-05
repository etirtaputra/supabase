'use client';
/**
 * The front page is the index.
 *
 * No hero, no message: every department and every category under it, with a
 * count and the lowest open price, on one screen. A person who knows what they
 * need clicks once; a person who does not can see the whole shape of the
 * catalogue without scrolling. Every number here is computed from the data.
 */
import React, { useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { DEPARTMENTS, departmentOf, hasPrice, categoryLabel, formatIdr } from '@/lib/shopCatalog';
import { ShopShell } from '@/components/shop/shopUi';
import { useShopData, Thumb } from '@/components/shop/useShopData';

export default function ShopIndex() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const { items, loading } = useShopData();

  useEffect(() => { document.title = 'Katalog — ICA Solar (demo)'; }, []);
  useEffect(() => {
    if (!authLoading && !user) router.replace(`/login?next=${encodeURIComponent('/shop')}`);
  }, [authLoading, user, router]);

  /** Per department, per category: count and lowest open price. */
  const index = useMemo(() => {
    const m = new Map<string, Map<string, { n: number; min: number | null }>>();
    for (const d of DEPARTMENTS) m.set(d.key, new Map(d.categories.map((c) => [c, { n: 0, min: null }])));
    for (const i of items) {
      const d = departmentOf(i.category);
      if (!d || !i.category) continue;
      const s = m.get(d.key)!.get(i.category)!;
      s.n += 1;
      if (hasPrice(i)) { const p = Number(i.selling_price_idr); s.min = s.min == null ? p : Math.min(s.min, p); }
    }
    return m;
  }, [items]);

  const priced = items.filter(hasPrice).length;

  return (
    <ShopShell>
      <div className="wrap" style={{ padding: '16px 16px 0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', paddingBottom: 8, borderBottom: '2px solid var(--navy)' }}>
          <h1 className="h1">Katalog komponen PLTS</h1>
          <span className="num" style={{ fontSize: 12, color: 'var(--muted)' }}>
            {loading ? 'memuat…' : <>{items.length} item · {priced} dengan harga terbuka · sisanya via penawaran</>}
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(250px,1fr))', gap: '18px 28px', padding: '18px 0 0' }}>
          {DEPARTMENTS.map((d) => {
            const cats = index.get(d.key)!;
            const total = [...cats.values()].reduce((s, c) => s + c.n, 0);
            return (
              <div key={d.key}>
                <Link href={`/shop/c/${d.key}`} style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 6, borderBottom: '1px solid var(--line)' }}>
                  <span style={{ width: 44, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--canvas)', borderRadius: 3 }}>
                    <Thumb dept={d.key} size={42} />
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span className="h2" style={{ display: 'block' }}>{d.label}</span>
                    <span className="num" style={{ fontSize: 11, color: 'var(--muted)' }}>{loading ? '…' : `${total} item`}</span>
                  </span>
                </Link>
                <div style={{ paddingTop: 6 }}>
                  {[...cats.entries()].map(([cat, s]) => (
                    <Link key={cat} href={`/shop/c/${d.key}?cat=${cat}`}
                      style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '3px 0', fontSize: 12.5 }}>
                      <span className="lnk" style={{ color: 'var(--navy)' }}>{categoryLabel(cat)}</span>
                      <span className="num" style={{ color: 'var(--label)', fontSize: 11.5, whiteSpace: 'nowrap' }}>
                        {s.n}{s.min != null ? ` · dari ${formatIdr(s.min)}` : ''}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="wrap" style={{ padding: '28px 16px 0' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: '12px 28px', borderTop: '1px solid var(--line)', paddingTop: 14, fontSize: 12.5, color: 'var(--body)' }}>
          <div><span className="lab">CARA PESAN</span><p style={{ marginTop: 4 }}>Tambah ke keranjang, isi alamat, kirim sebagai permintaan penawaran. Penawaran resmi ber-PPN dibalas dalam 1 hari kerja.</p></div>
          <div><span className="lab">PENGIRIMAN</span><p style={{ marginTop: 4 }}>Barang bertanda <span className="chip ok">Kurir</span> via kurir reguler; <span className="chip fr">Ekspedisi</span> (panel, baterai rak, rail) ongkirnya dihitung dari alamat.</p></div>
          <div><span className="lab">BUTUH SISTEM, BUKAN BARANG?</span><p style={{ marginTop: 4 }}>ICA juga merancang dan memasang PLTS on-grid, hybrid + BESS, off-grid, pompa surya, dan EVCS. <Link href="/shop/cart" className="lnk">Minta penawaran proyek →</Link></p></div>
        </div>
      </div>
    </ShopShell>
  );
}
