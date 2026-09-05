'use client';
/**
 * The shop's front page — a live demo of the public storefront, running inside
 * ICAPROC behind the existing login.
 *
 * Every count and every "mulai dari" on this page is COMPUTED from the
 * catalogue, never typed. A department that gains an item, or an item that
 * gains a price, changes this page with no edit — which is the whole argument
 * for the catalogue being the source the website reads.
 */
import React, { useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import {
  DEPARTMENTS, departmentOf, hasPrice, formatIdr, type ShopItem,
} from '@/lib/shopCatalog';
import { ShopShell, useCart } from '@/components/shop/shopUi';
import { useShopData, Thumb } from '@/components/shop/useShopData';
import ProductCard from '@/components/shop/ProductCard';

export default function ShopHome() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const { items, loading } = useShopData();
  const { add } = useCart();

  useEffect(() => { document.title = 'ICA Solar — Toko (demo)'; }, []);
  useEffect(() => {
    if (!authLoading && !user) router.replace(`/login?next=${encodeURIComponent('/shop')}`);
  }, [authLoading, user, router]);

  /** Per department: how many items, and the cheapest real price in it. */
  const stats = useMemo(() => {
    const m = new Map<string, { n: number; min: number | null }>();
    for (const d of DEPARTMENTS) m.set(d.key, { n: 0, min: null });
    for (const i of items) {
      const d = departmentOf(i.category);
      if (!d) continue;
      const s = m.get(d.key)!;
      s.n += 1;
      if (hasPrice(i)) {
        const p = Number(i.selling_price_idr);
        s.min = s.min == null ? p : Math.min(s.min, p);
      }
    }
    return m;
  }, [items]);

  /** The window: priced items with a capacity on file, biggest departments first. */
  const featured = useMemo(() => {
    const pick = (cat: string, n: number) => items
      .filter((i) => i.category === cat && hasPrice(i))
      .sort((a, b) => Number(b.norm_value ?? 0) - Number(a.norm_value ?? 0))
      .slice(0, n);
    return [...pick('pv_module', 2), ...pick('batteries', 1), ...pick('inverter_charger', 1)] as ShopItem[];
  }, [items]);

  const priced = items.filter(hasPrice).length;

  return (
    <ShopShell>
      <div style={{ background: 'var(--canvas)', borderBottom: '1px solid var(--line)' }}>
        <div className="wrap" style={{ padding: '52px 20px' }}>
          <div className="lab" style={{ color: 'var(--navy)' }}>KATALOG TEKNIS · HARGA TERBUKA</div>
          <h1 className="h1" style={{ marginTop: 16, maxWidth: 720 }}>
            Semua komponen PLTS, satu katalog dengan spesifikasi lengkap.
          </h1>
          <p style={{ fontSize: 17, color: 'var(--body)', marginTop: 18, maxWidth: 560, lineHeight: 1.6 }}>
            Panel, inverter, baterai, controller, mounting, dan proteksi dari TRINA, EPEVER,
            MIBET, SUNTREE, dan ICA SOLAR — dengan parameter teknis terukur, bukan sekadar nama.
          </p>
          <div style={{ display: 'flex', gap: 26, marginTop: 30, flexWrap: 'wrap' }}>
            <div><div className="num" style={{ fontSize: 24, fontWeight: 800, color: 'var(--ink)' }}>{items.length || '—'}</div><div className="lab" style={{ marginTop: 2 }}>ITEM DI TOKO</div></div>
            <div style={{ width: 1, background: 'var(--line)' }} />
            <div><div className="num" style={{ fontSize: 24, fontWeight: 800, color: 'var(--ink)' }}>{priced || '—'}</div><div className="lab" style={{ marginTop: 2 }}>BERHARGA TERBUKA</div></div>
            <div style={{ width: 1, background: 'var(--line)' }} />
            <div><div style={{ fontSize: 24, fontWeight: 800, color: 'var(--ink)' }}>PPN 11%</div><div className="lab" style={{ marginTop: 2 }}>FAKTUR PAJAK</div></div>
          </div>
        </div>
      </div>

      <div className="wrap" style={{ padding: '44px 20px 0' }}>
        <div className="lab" style={{ color: 'var(--navy)' }}>BELANJA PER KATEGORI</div>
        <h2 className="h2" style={{ marginTop: 8, marginBottom: 20 }}>Mulai dari komponen yang Anda cari</h2>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(230px,1fr))' }}>
          {DEPARTMENTS.map((d) => {
            const s = stats.get(d.key)!;
            return (
              <Link key={d.key} href={`/shop/c/${d.key}`} className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <Thumb dept={d.key} size={54} />
                <div>
                  <div className="h3">{d.label}</div>
                  <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 3 }}>
                    {loading ? '…' : `${s.n} item`} · {d.blurb}
                  </div>
                </div>
                <div className="num" style={{ fontSize: 13, color: 'var(--body)', marginTop: 'auto', paddingTop: 10, borderTop: '1px solid var(--hair)' }}>
                  {s.min != null
                    ? <>mulai <strong style={{ color: 'var(--ink)' }}>{formatIdr(s.min)}</strong></>
                    : <span style={{ color: 'var(--muted)' }}>harga via penawaran</span>}
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      <div className="wrap" style={{ padding: '44px 20px 0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 18, gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div className="lab" style={{ color: 'var(--navy)' }}>KAPASITAS TERBESAR</div>
            <h2 className="h2" style={{ marginTop: 8 }}>Modul, penyimpanan, dan inverter</h2>
          </div>
          <Link href="/shop/c/panel" style={{ fontSize: 14, fontWeight: 600, color: 'var(--navy)' }}>Lihat semua panel →</Link>
        </div>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))' }}>
          {featured.map((i) => <ProductCard key={i.component_id} item={i} onAdd={add} />)}
          {loading && [0, 1, 2, 3].map((k) => <div key={k} className="card" style={{ height: 330, background: 'var(--canvas)' }} />)}
        </div>
      </div>

      <div className="wrap" style={{ padding: '44px 20px 0' }}>
        <div className="card" style={{ background: 'var(--navy)', borderColor: 'var(--navy)', color: '#fff', padding: '36px 32px', display: 'flex', gap: 30, justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <div className="lab" style={{ color: '#8fb6e2' }}>SISI LAIN ICA</div>
            <h2 className="h2" style={{ color: '#fff', marginTop: 8 }}>Kami juga membangun sistemnya.</h2>
            <p style={{ color: '#cfe0f4', marginTop: 8, maxWidth: 560 }}>
              On-grid, hybrid + BESS, off-grid, pompa surya, dan EVCS — dari survei sampai commissioning.
            </p>
          </div>
          <Link href="/shop/cart" className="btn" style={{ background: '#fff', color: 'var(--navy)' }}>Minta Penawaran Proyek</Link>
        </div>
      </div>
    </ShopShell>
  );
}
