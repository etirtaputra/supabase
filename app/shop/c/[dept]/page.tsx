'use client';
/**
 * A department listing: search, brand filter, sort, and the products.
 *
 * The filters are built FROM the data — brands are whatever the department
 * actually stocks, with real counts. A facet that promises a brand and returns
 * nothing is worse than no facet at all.
 */
import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import {
  departmentByKey, departmentOf, shopName, hasPrice, pricePerUnit, needsFreight,
  type ShopItem,
} from '@/lib/shopCatalog';
import { ShopShell, useCart } from '@/components/shop/shopUi';
import { useShopData } from '@/components/shop/useShopData';
import ProductCard from '@/components/shop/ProductCard';

type Sort = 'capacity' | 'price_asc' | 'price_desc' | 'per_unit' | 'name';

const SORTS: [Sort, string][] = [
  ['capacity', 'Kapasitas terbesar'],
  ['per_unit', 'Termurah per satuan'],
  ['price_asc', 'Harga terendah'],
  ['price_desc', 'Harga tertinggi'],
  ['name', 'Nama A–Z'],
];

export default function DepartmentPage() {
  const { dept: deptKey } = useParams<{ dept: string }>();
  const dept = departmentByKey(String(deptKey));
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const { items, loading } = useShopData();
  const { add } = useCart();

  const [q, setQ] = useState('');
  const [brands, setBrands] = useState<string[]>([]);
  const [pricedOnly, setPricedOnly] = useState(false);
  const [sort, setSort] = useState<Sort>('capacity');

  useEffect(() => { document.title = `${dept?.label ?? 'Katalog'} — ICA Solar (demo)`; }, [dept]);
  useEffect(() => {
    if (!authLoading && !user) router.replace(`/login?next=${encodeURIComponent(`/shop/c/${deptKey}`)}`);
  }, [authLoading, user, router, deptKey]);
  useEffect(() => { setBrands([]); setQ(''); setPricedOnly(false); }, [deptKey]);

  const inDept = useMemo(
    () => items.filter((i) => departmentOf(i.category)?.key === dept?.key),
    [items, dept]);

  /** Brands this department really stocks, with counts, biggest first. */
  const brandFacet = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of inDept) {
      const b = (i.brand ?? '').trim();
      if (b) m.set(b, (m.get(b) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [inDept]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out = inDept.filter((i) => {
      if (pricedOnly && !hasPrice(i)) return false;
      if (brands.length && !brands.includes((i.brand ?? '').trim())) return false;
      if (!needle) return true;
      return `${shopName(i)} ${i.brand ?? ''} ${i.supplier_model}`.toLowerCase().includes(needle);
    });
    const price = (i: ShopItem) => (hasPrice(i) ? Number(i.selling_price_idr) : Number.POSITIVE_INFINITY);
    const per = (i: ShopItem) => pricePerUnit(i)?.value ?? Number.POSITIVE_INFINITY;
    const cap = (i: ShopItem) => Number(i.norm_value ?? 0);
    return [...out].sort((a, b) => {
      if (sort === 'name') return shopName(a).localeCompare(shopName(b));
      if (sort === 'price_asc') return price(a) - price(b);
      if (sort === 'price_desc') return price(b) - price(a);
      if (sort === 'per_unit') return per(a) - per(b);
      return cap(b) - cap(a) || shopName(a).localeCompare(shopName(b));
    });
  }, [inDept, q, brands, pricedOnly, sort]);

  const toggleBrand = (b: string) =>
    setBrands((prev) => (prev.includes(b) ? prev.filter((x) => x !== b) : [...prev, b]));

  if (!dept) {
    return (
      <ShopShell>
        <div className="wrap" style={{ padding: '60px 20px' }}>
          <h1 className="h2">Kategori tidak ditemukan</h1>
          <Link href="/shop" className="btn btn-s" style={{ marginTop: 18 }}>Kembali ke toko</Link>
        </div>
      </ShopShell>
    );
  }

  return (
    <ShopShell dept={dept.key}>
      <div className="wrap" style={{ padding: '24px 20px 0' }}>
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>
          <Link href="/shop">Toko</Link> <span style={{ color: '#cbd5e1' }}>/</span> <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{dept.label}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap', marginTop: 10, paddingBottom: 14, borderBottom: '3px solid var(--navy)' }}>
          <div>
            <h1 style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-1px', color: 'var(--ink)', lineHeight: 1.1 }}>{dept.label}</h1>
            <p style={{ fontSize: 14.5, color: 'var(--muted)', marginTop: 6 }}>
              {loading ? 'Memuat…' : `${inDept.length} item · ${dept.blurb}`}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <span className="num hidesm" style={{ fontSize: 13, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
              {shown.length} ditampilkan
            </span>
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} style={{ width: 'auto', minWidth: 190 }}>
              {SORTS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="wrap" style={{ padding: '20px 20px 0', display: 'grid', gridTemplateColumns: 'minmax(0,1fr)', gap: 20 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Cari di ${dept.label} — model, merek, spesifikasi…`} style={{ flex: '1 1 280px', maxWidth: 420 }} />
          {brandFacet.map(([b, n]) => (
            <button key={b} onClick={() => toggleBrand(b)} className="chip"
              style={{ height: 34, padding: '0 13px', cursor: 'pointer', fontSize: 12.5, border: '1px solid',
                ...(brands.includes(b)
                  ? { background: 'var(--navy)', color: '#fff', borderColor: 'var(--navy)' }
                  : { background: '#fff', color: 'var(--body)', borderColor: 'var(--line)' }) }}>
              {b} <span className="num" style={{ opacity: .6 }}>{n}</span>
            </button>
          ))}
          <button onClick={() => setPricedOnly((v) => !v)} className="chip"
            style={{ height: 34, padding: '0 13px', cursor: 'pointer', fontSize: 12.5, border: '1px solid',
              ...(pricedOnly
                ? { background: 'var(--navy)', color: '#fff', borderColor: 'var(--navy)' }
                : { background: '#fff', color: 'var(--body)', borderColor: 'var(--line)' }) }}>
            Hanya yang berharga
          </button>
          {(q || brands.length || pricedOnly) && (
            <button onClick={() => { setQ(''); setBrands([]); setPricedOnly(false); }}
              style={{ background: 'none', border: 0, color: 'var(--navy)', fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', minHeight: 34 }}>
              Reset
            </button>
          )}
        </div>

        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', paddingBottom: 20 }}>
          {loading
            ? [0, 1, 2, 3, 4, 5].map((k) => <div key={k} className="card" style={{ height: 330, background: 'var(--canvas)' }} />)
            : shown.map((i) => <ProductCard key={i.component_id} item={i} onAdd={add} />)}
          {!loading && shown.length === 0 && (
            <div className="card" style={{ padding: 28, gridColumn: '1/-1', color: 'var(--muted)' }}>
              Tidak ada item yang cocok dengan filter ini.
            </div>
          )}
        </div>

        {!loading && shown.some(needsFreight) && (
          <p style={{ fontSize: 12.5, color: 'var(--muted)', paddingBottom: 10 }}>
            Item bertanda <strong style={{ color: 'var(--sun)' }}>Ekspedisi</strong> tidak masuk kurir reguler —
            ongkirnya dihitung berdasarkan alamat dan dikirim sebagai penawaran.
          </p>
        )}
      </div>
    </ShopShell>
  );
}
