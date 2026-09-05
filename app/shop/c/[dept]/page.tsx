'use client';
/**
 * A department, as a table with generated filters.
 *
 * The sidebar is not designed; it is the category's declared spec fields
 * (lib/shopCatalog.ts › facetsFor), so it is exactly as complete as the
 * catalogue is. Filters only make sense within ONE category — a module's
 * fields are not an inverter's — so a department with several shows category
 * tabs, and the facets appear once one is chosen.
 */
import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import {
  departmentByKey, departmentOf, shopName, hasPrice, pricePerUnit, categoryLabel,
  facetsFor, applyFacets, columnsFor, type FacetState, type ShopItem,
} from '@/lib/shopCatalog';
import { ShopShell, useCart } from '@/components/shop/shopUi';
import { useShopData } from '@/components/shop/useShopData';
import ProductTable from '@/components/shop/ProductTable';

type Sort = 'capacity' | 'per_unit' | 'price_asc' | 'price_desc' | 'name';
const SORTS: [Sort, string][] = [
  ['capacity', 'Kapasitas terbesar'], ['per_unit', 'Termurah per satuan'],
  ['price_asc', 'Harga terendah'], ['price_desc', 'Harga tertinggi'], ['name', 'Nama A–Z'],
];

export default function DepartmentPage() {
  const { dept: deptKey } = useParams<{ dept: string }>();
  const params = useSearchParams();
  const dept = departmentByKey(String(deptKey));
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const { items, loading } = useShopData();
  const { add } = useCart();

  const catParam = params.get('cat') ?? '';
  const [cat, setCat] = useState<string>('');
  const [brands, setBrands] = useState<string[]>([]);
  const [pricedOnly, setPricedOnly] = useState(false);
  const [facet, setFacet] = useState<FacetState>({});
  const [sort, setSort] = useState<Sort>('capacity');

  useEffect(() => { document.title = `${dept?.label ?? 'Katalog'} — ICA Solar (demo)`; }, [dept]);
  useEffect(() => {
    if (!authLoading && !user) router.replace(`/login?next=${encodeURIComponent(`/shop/c/${deptKey}`)}`);
  }, [authLoading, user, router, deptKey]);
  // A single-category department has nothing to choose; ?cat= deep-links one.
  useEffect(() => {
    setBrands([]); setFacet({}); setPricedOnly(false);
    setCat(dept && dept.categories.length === 1 ? dept.categories[0] : (catParam || ''));
  }, [deptKey, catParam, dept]);
  useEffect(() => { setFacet({}); }, [cat]);

  const inDept = useMemo(() => items.filter((i) => departmentOf(i.category)?.key === dept?.key), [items, dept]);
  const inCat = useMemo(() => (cat ? inDept.filter((i) => i.category === cat) : inDept), [inDept, cat]);
  const catCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of inDept) m.set(i.category ?? '', (m.get(i.category ?? '') ?? 0) + 1);
    return m;
  }, [inDept]);

  const brandFacet = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of inCat) { const b = (i.brand ?? '').trim(); if (b) m.set(b, (m.get(b) ?? 0) + 1); }
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [inCat]);

  const facets = useMemo(() => (cat ? facetsFor(cat, inCat) : []), [cat, inCat]);
  const columns = useMemo(() => (cat ? columnsFor(cat) : []), [cat]);

  const shown = useMemo(() => {
    let out = inCat.filter((i) => (!pricedOnly || hasPrice(i)) && (!brands.length || brands.includes((i.brand ?? '').trim())));
    out = applyFacets(out, facet);
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
  }, [inCat, brands, pricedOnly, facet, sort]);

  const toggleOpt = (key: string, value: string) => setFacet((f) => {
    const cur = Array.isArray(f[key]) ? (f[key] as string[]) : [];
    const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
    return { ...f, [key]: next };
  });
  const setRange = (key: string, part: 'min' | 'max', raw: string) => setFacet((f) => {
    const cur = !Array.isArray(f[key]) && f[key] ? (f[key] as { min?: number; max?: number }) : {};
    const n = raw.trim() === '' ? undefined : Number(raw);
    return { ...f, [key]: { ...cur, [part]: Number.isFinite(n as number) ? n : undefined } };
  });
  const activeCount = brands.length + (pricedOnly ? 1 : 0) +
    Object.values(facet).filter((v) => (Array.isArray(v) ? v.length > 0 : v.min != null || v.max != null)).length;

  if (!dept) {
    return <ShopShell><div className="wrap" style={{ padding: '40px 16px' }}><h1 className="h1">Kategori tidak ditemukan</h1><Link href="/shop" className="btn btn-s" style={{ marginTop: 14 }}>Ke katalog</Link></div></ShopShell>;
  }

  return (
    <ShopShell dept={dept.key}>
      <div className="wrap" style={{ padding: '12px 16px 0' }}>
        <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
          <Link href="/shop" className="lnk">Katalog</Link> / <span style={{ color: 'var(--ink)' }}>{dept.label}</span>
          {cat && dept.categories.length > 1 && <> / <span style={{ color: 'var(--ink)' }}>{categoryLabel(cat)}</span></>}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginTop: 6, paddingBottom: 8, borderBottom: '2px solid var(--navy)' }}>
          <h1 className="h1">{cat && dept.categories.length > 1 ? categoryLabel(cat) : dept.label}
            <span className="num" style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted)', marginLeft: 10 }}>{loading ? '…' : `${shown.length} dari ${inCat.length}`}</span>
          </h1>
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} style={{ width: 'auto', minWidth: 180 }}>
            {SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>

        {dept.categories.length > 1 && (
          <div style={{ display: 'flex', gap: 16, borderBottom: '1px solid var(--line)', overflowX: 'auto' }}>
            {[['', 'Semua'], ...dept.categories.map((c) => [c, categoryLabel(c)])].map(([c, label]) => (
              <button key={c} onClick={() => router.replace(c ? `/shop/c/${dept.key}?cat=${c}` : `/shop/c/${dept.key}`)}
                className={`navlink${cat === c ? ' on' : ''}`} style={{ background: 'none', border: 0, cursor: 'pointer', fontFamily: 'inherit' }}>
                {label} <span className="num" style={{ color: 'var(--label)', fontSize: 11 }}>{c ? catCounts.get(c) ?? 0 : inDept.length}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="wrap" style={{ padding: '12px 16px 0', display: 'grid', gridTemplateColumns: '220px minmax(0,1fr)', gap: 24, alignItems: 'start' }}>
        <aside style={{ position: 'sticky', top: 92 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 6, borderBottom: '2px solid var(--navy)' }}>
            <span className="lab">FILTER{activeCount ? ` · ${activeCount}` : ''}</span>
            {activeCount > 0 && <button onClick={() => { setBrands([]); setPricedOnly(false); setFacet({}); }} style={{ background: 'none', border: 0, color: 'var(--navy)', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Reset</button>}
          </div>

          <div className="facet">
            <label><input type="checkbox" checked={pricedOnly} onChange={(e) => setPricedOnly(e.target.checked)} />Hanya harga terbuka<span className="c num">{inCat.filter(hasPrice).length}</span></label>
          </div>

          {brandFacet.length > 1 && (
            <div className="facet"><div className="t">Merek</div>
              {brandFacet.map(([b, n]) => (
                <label key={b}><input type="checkbox" checked={brands.includes(b)} onChange={() => setBrands((p) => (p.includes(b) ? p.filter((x) => x !== b) : [...p, b]))} />{b}<span className="c num">{n}</span></label>
              ))}
            </div>
          )}

          {!cat && dept.categories.length > 1 && (
            <p style={{ fontSize: 11.5, color: 'var(--muted)', padding: '10px 0' }}>Pilih satu jenis di atas untuk filter spesifikasi.</p>
          )}
          {facets.map((f) => (
            <div key={f.key} className="facet">
              <div className="t">{f.label}{f.unit ? <span style={{ color: 'var(--label)', fontWeight: 500 }}> ({f.unit})</span> : null}</div>
              {f.kind === 'options' ? f.options.map((o) => {
                const sel = Array.isArray(facet[f.key]) ? (facet[f.key] as string[]) : [];
                return (
                  <label key={o.value}><input type="checkbox" checked={sel.includes(o.value)} onChange={() => toggleOpt(f.key, o.value)} />
                    <span className="num">{o.value}</span><span className="c num">{o.count}</span>
                  </label>
                );
              }) : (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input type="number" placeholder={String(f.min)} onChange={(e) => setRange(f.key, 'min', e.target.value)} style={{ height: 28, fontSize: 12 }} />
                  <span style={{ color: 'var(--label)' }}>–</span>
                  <input type="number" placeholder={String(f.max)} onChange={(e) => setRange(f.key, 'max', e.target.value)} style={{ height: 28, fontSize: 12 }} />
                </div>
              )}
            </div>
          ))}
          {cat && !loading && facets.length === 0 && (
            <p style={{ fontSize: 11.5, color: 'var(--muted)', padding: '10px 0' }}>Kategori ini belum punya parameter baku di katalog.</p>
          )}
        </aside>

        <div style={{ minWidth: 0 }}>
          {loading
            ? <div style={{ padding: 24, color: 'var(--muted)' }}>Memuat…</div>
            : <ProductTable items={shown} columns={columns} showCategory={!cat && dept.categories.length > 1} onAdd={add} empty="Tidak ada item yang cocok dengan filter ini." />}
        </div>
      </div>
    </ShopShell>
  );
}
