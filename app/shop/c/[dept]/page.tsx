'use client';
/**
 * A department: first the buyer's question, then the table.
 *
 * Clicking "Mounting" does not dump 72 rows. It asks "rail, clamp, foot, or
 * walkway?" (lib/shopCatalog.ts › FAMILIES) — the way a McMaster category page
 * opens — and the table appears once that is answered, with the filter sidebar
 * generated from the category's declared spec fields. A department with several
 * categories asks that first; a category without families lists directly.
 *
 * URL: /shop/c/<dept>?cat=<category>&fam=<family|all>
 */
import React, { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import {
  departmentByKey, departmentOf, shopName, hasPrice, pricePerUnit, categoryLabel,
  familiesOf, familyOf, familyIndex, OTHER_FAMILY,
  facetsFor, applyFacets, columnsFor, formatIdr, type FacetState, type ShopItem,
} from '@/lib/shopCatalog';
import { ShopShell, useCart } from '@/components/shop/shopUi';
import { useShopData, Thumb } from '@/components/shop/useShopData';
import ProductTable from '@/components/shop/ProductTable';

type Sort = 'capacity' | 'per_unit' | 'price_asc' | 'price_desc' | 'name';
const SORTS: [Sort, string][] = [
  ['capacity', 'Kapasitas terbesar'], ['per_unit', 'Termurah per satuan'],
  ['price_asc', 'Harga terendah'], ['price_desc', 'Harga tertinggi'], ['name', 'Nama A–Z'],
];

function FamilyTiles({ deptKey, category, items }: { deptKey: string; category: string; items: ShopItem[] }) {
  const idx = familyIndex(category, items);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 8 }}>
      {idx.map(({ family, n, min }) => (
        <Link key={family.key} href={`/shop/c/${deptKey}?cat=${category}&fam=${family.key}`} className="card"
          style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 10px', minHeight: 56 }}>
          <span style={{ width: 44, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--canvas)', borderRadius: 3, flex: 'none' }}>
            <Thumb dept={deptKey} size={40} />
          </span>
          <span style={{ minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--navy)', lineHeight: 1.25 }}>{family.label}</span>
            <span className="num" style={{ fontSize: 11, color: 'var(--muted)' }}>{n} item{min != null ? ` · dari ${formatIdr(min)}` : ''}</span>
          </span>
        </Link>
      ))}
      <Link href={`/shop/c/${deptKey}?cat=${category}&fam=all`} className="card"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px 10px', minHeight: 56, fontSize: 12.5, fontWeight: 600, color: 'var(--body)', borderStyle: 'dashed' }}>
        Semua {items.length} item →
      </Link>
    </div>
  );
}

function DepartmentBody() {
  const { dept: deptKey } = useParams<{ dept: string }>();
  const params = useSearchParams();
  const dept = departmentByKey(String(deptKey));
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const { items, loading } = useShopData();
  const { add } = useCart();

  const cat = dept && dept.categories.length === 1 ? dept.categories[0] : (params.get('cat') ?? '');
  const fam = params.get('fam') ?? '';
  const [brands, setBrands] = useState<string[]>([]);
  const [pricedOnly, setPricedOnly] = useState(false);
  const [facet, setFacet] = useState<FacetState>({});
  const [sort, setSort] = useState<Sort>('capacity');

  useEffect(() => { document.title = `${dept?.label ?? 'Katalog'} — ICA Solar (demo)`; }, [dept]);
  useEffect(() => {
    if (!authLoading && !user) router.replace(`/login?next=${encodeURIComponent(`/shop/c/${deptKey}`)}`);
  }, [authLoading, user, router, deptKey]);
  useEffect(() => { setBrands([]); setFacet({}); setPricedOnly(false); }, [deptKey, cat, fam]);

  const inDept = useMemo(() => items.filter((i) => departmentOf(i.category)?.key === dept?.key), [items, dept]);
  const inCat = useMemo(() => (cat ? inDept.filter((i) => i.category === cat) : inDept), [inDept, cat]);
  const families = familiesOf(cat);
  const famObj = fam && fam !== 'all' ? [...families, OTHER_FAMILY].find((f) => f.key === fam) ?? null : null;
  const scoped = useMemo(() => (famObj ? inCat.filter((i) => familyOf(i)?.key === famObj.key) : inCat), [inCat, famObj]);

  // What this URL shows: the department's category index, a category's
  // family index, or the table.
  const view: 'dept-index' | 'family-index' | 'table' =
    !cat ? 'dept-index' : (families.length > 0 && !fam ? 'family-index' : 'table');

  const brandFacet = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of scoped) { const b = (i.brand ?? '').trim(); if (b) m.set(b, (m.get(b) ?? 0) + 1); }
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [scoped]);
  const facets = useMemo(() => (cat ? facetsFor(cat, scoped) : []), [cat, scoped]);
  const columns = useMemo(() => (cat ? columnsFor(cat) : []), [cat]);

  const shown = useMemo(() => {
    let out = scoped.filter((i) => (!pricedOnly || hasPrice(i)) && (!brands.length || brands.includes((i.brand ?? '').trim())));
    out = applyFacets(out, facet);
    const price = (i: ShopItem) => (hasPrice(i) ? Number(i.selling_price_idr) : Number.POSITIVE_INFINITY);
    const per = (i: ShopItem) => pricePerUnit(i)?.value ?? Number.POSITIVE_INFINITY;
    const capv = (i: ShopItem) => Number(i.norm_value ?? 0);
    return [...out].sort((a, b) => {
      if (sort === 'name') return shopName(a).localeCompare(shopName(b));
      if (sort === 'price_asc') return price(a) - price(b);
      if (sort === 'price_desc') return price(b) - price(a);
      if (sort === 'per_unit') return per(a) - per(b);
      return capv(b) - capv(a) || shopName(a).localeCompare(shopName(b));
    });
  }, [scoped, brands, pricedOnly, facet, sort]);

  const toggleOpt = (key: string, value: string) => setFacet((f) => {
    const cur = Array.isArray(f[key]) ? (f[key] as string[]) : [];
    return { ...f, [key]: cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value] };
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

  const crumbs = [
    <Link key="k" href="/shop" className="lnk">Katalog</Link>,
    cat && dept.categories.length > 1 ? <Link key="d" href={`/shop/c/${dept.key}`} className="lnk">{dept.label}</Link> : <span key="d" style={{ color: 'var(--ink)' }}>{dept.label}</span>,
    ...(cat && dept.categories.length > 1 ? [fam ? <Link key="c" href={`/shop/c/${dept.key}?cat=${cat}`} className="lnk">{categoryLabel(cat)}</Link> : <span key="c" style={{ color: 'var(--ink)' }}>{categoryLabel(cat)}</span>] : []),
    ...(cat && families.length > 0 && fam ? [<span key="f" style={{ color: 'var(--ink)' }}>{famObj ? famObj.label : 'Semua'}</span>] : []),
  ];
  const title = famObj ? famObj.label : cat && dept.categories.length > 1 ? categoryLabel(cat) : dept.label;

  return (
    <ShopShell dept={dept.key}>
      <div className="wrap" style={{ padding: '12px 16px 0' }}>
        <div style={{ fontSize: 11.5, color: 'var(--muted)', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {crumbs.map((c, i) => <React.Fragment key={i}>{i > 0 && <span>/</span>}{c}</React.Fragment>)}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginTop: 6, paddingBottom: 8, borderBottom: '2px solid var(--navy)' }}>
          <h1 className="h1">{title}
            <span className="num" style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted)', marginLeft: 10 }}>
              {loading ? '…' : view === 'table' ? `${shown.length} dari ${scoped.length}` : `${(view === 'dept-index' ? inDept : inCat).length} item`}
            </span>
          </h1>
          {view === 'table' && (
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} style={{ width: 'auto', minWidth: 180 }}>
              {SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          )}
        </div>
      </div>

      {loading ? (
        <div className="wrap" style={{ padding: 24, color: 'var(--muted)' }}>Memuat…</div>
      ) : view === 'dept-index' ? (
        /* several categories: each with its families, or a direct link */
        <div className="wrap" style={{ padding: '14px 16px 0', display: 'flex', flexDirection: 'column', gap: 18 }}>
          {dept.categories.map((c) => {
            const rows = inDept.filter((i) => i.category === c);
            if (rows.length === 0) return null;
            const fams = familiesOf(c);
            return (
              <div key={c}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingBottom: 5, borderBottom: '1px solid var(--line)', marginBottom: 8 }}>
                  <Link href={`/shop/c/${dept.key}?cat=${c}${fams.length ? '' : '&fam=all'}`} className="h2 lnk" style={{ color: 'var(--navy)' }}>{categoryLabel(c)}</Link>
                  <span className="num" style={{ fontSize: 11.5, color: 'var(--muted)' }}>{rows.length} item</span>
                </div>
                {fams.length > 0
                  ? <FamilyTiles deptKey={dept.key} category={c} items={rows} />
                  : <Link href={`/shop/c/${dept.key}?cat=${c}&fam=all`} className="lnk" style={{ fontSize: 12.5 }}>Lihat semua {rows.length} item →</Link>}
              </div>
            );
          })}
        </div>
      ) : view === 'family-index' ? (
        <div className="wrap" style={{ padding: '14px 16px 0' }}>
          <FamilyTiles deptKey={dept.key} category={cat} items={inCat} />
        </div>
      ) : (
        <div className="wrap" style={{ padding: '12px 16px 0', display: 'grid', gridTemplateColumns: '220px minmax(0,1fr)', gap: 24, alignItems: 'start' }}>
          <aside style={{ position: 'sticky', top: 92 }}>
            {families.length > 0 && (
              <div className="facet" style={{ paddingTop: 0 }}>
                <div className="t">{categoryLabel(cat)}</div>
                {familyIndex(cat, inCat).map(({ family, n }) => (
                  <Link key={family.key} href={`/shop/c/${dept.key}?cat=${cat}&fam=${family.key}`}
                    style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '3px 0', fontSize: 12, color: famObj?.key === family.key ? 'var(--navy)' : 'var(--body)', fontWeight: famObj?.key === family.key ? 700 : 400 }}>
                    <span>{family.label}</span><span className="num" style={{ color: 'var(--label)', fontSize: 11 }}>{n}</span>
                  </Link>
                ))}
                <Link href={`/shop/c/${dept.key}?cat=${cat}&fam=all`} style={{ display: 'block', padding: '3px 0', fontSize: 12, color: !famObj ? 'var(--navy)' : 'var(--body)', fontWeight: !famObj ? 700 : 400 }}>Semua</Link>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0 6px', borderBottom: '2px solid var(--navy)' }}>
              <span className="lab">FILTER{activeCount ? ` · ${activeCount}` : ''}</span>
              {activeCount > 0 && <button onClick={() => { setBrands([]); setPricedOnly(false); setFacet({}); }} style={{ background: 'none', border: 0, color: 'var(--navy)', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Reset</button>}
            </div>
            <div className="facet">
              <label><input type="checkbox" checked={pricedOnly} onChange={(e) => setPricedOnly(e.target.checked)} />Hanya harga terbuka<span className="c num">{scoped.filter(hasPrice).length}</span></label>
            </div>
            {brandFacet.length > 1 && (
              <div className="facet"><div className="t">Merek</div>
                {brandFacet.map(([b, n]) => (
                  <label key={b}><input type="checkbox" checked={brands.includes(b)} onChange={() => setBrands((p) => (p.includes(b) ? p.filter((x) => x !== b) : [...p, b]))} />{b}<span className="c num">{n}</span></label>
                ))}
              </div>
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
            {facets.length === 0 && (
              <p style={{ fontSize: 11.5, color: 'var(--muted)', padding: '10px 0' }}>Kategori ini belum punya parameter baku di katalog.</p>
            )}
          </aside>

          <div style={{ minWidth: 0 }}>
            <ProductTable items={shown} columns={columns} onAdd={add} empty="Tidak ada item yang cocok dengan filter ini." />
          </div>
        </div>
      )}
    </ShopShell>
  );
}

export default function DepartmentPage() {
  return <Suspense fallback={null}><DepartmentBody /></Suspense>;
}
