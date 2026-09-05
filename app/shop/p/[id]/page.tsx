'use client';
/**
 * A product page, spec first.
 *
 * The specification table is rendered from `CATEGORY_SPEC_FIELDS` and
 * `SPEC_FIELD_META`: the SAME declared field set, in the same order, under the
 * same group headings and with the same labels and units as the Tech Specs
 * screen the staff enter it on. Not a copy of that list — the list itself.
 *
 * Layout follows the intention: what it is, what it costs, add — in a narrow
 * column on the left; the full spec sheet takes the rest of the screen. No
 * copy, no related-products carousel; alternatives are a table below.
 */
import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { groupsFor, fieldsInGroup, fieldMeta, isAnswered, displaySpecValue } from '@/lib/specFields';
import {
  departmentOf, shopName, hasPrice, pricePerUnit, needsFreight, weightKg, warrantyLine,
  declaredFields, specsOf, columnsFor, categoryLabel, formatIdr, formatIdrUnit, withPpn, PPN_PCT,
} from '@/lib/shopCatalog';
import { ShopShell, useCart } from '@/components/shop/shopUi';
import { useShopData, Thumb } from '@/components/shop/useShopData';
import ProductTable from '@/components/shop/ProductTable';

export default function ProductPage() {
  const { id } = useParams<{ id: string }>();
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const { items, byId, loading } = useShopData();
  const { add, cart } = useCart();
  const [qty, setQty] = useState(1);

  const item = byId.get(String(id)) ?? null;
  const dept = departmentOf(item?.category);

  useEffect(() => {
    document.title = item ? `${shopName(item)} — ICA Solar (demo)` : 'Produk — ICA Solar (demo)';
  }, [item]);
  useEffect(() => {
    if (!authLoading && !user) router.replace(`/login?next=${encodeURIComponent(`/shop/p/${id}`)}`);
  }, [authLoading, user, router, id]);

  const spec = useMemo(() => {
    if (!item) return { fields: [] as readonly string[], values: {} as Record<string, unknown>, answered: 0 };
    const fields = declaredFields(item.category);
    const values = specsOf(item);
    return { fields, values, answered: fields.filter((k) => isAnswered(values[k])).length };
  }, [item]);

  const alike = useMemo(() => {
    if (!item) return [];
    const cap = Number(item.norm_value ?? 0);
    return items
      .filter((i) => i.component_id !== item.component_id && i.category === item.category)
      .sort((a, b) => Math.abs(Number(a.norm_value ?? 0) - cap) - Math.abs(Number(b.norm_value ?? 0) - cap))
      .slice(0, 8);
  }, [items, item]);

  if (loading || authLoading) {
    return <ShopShell><div className="wrap" style={{ padding: '40px 16px', color: 'var(--muted)' }}>Memuat…</div></ShopShell>;
  }
  if (!item) {
    return <ShopShell><div className="wrap" style={{ padding: '40px 16px' }}><h1 className="h1">Produk tidak ditemukan</h1><Link href="/shop" className="btn btn-s" style={{ marginTop: 14 }}>Ke katalog</Link></div></ShopShell>;
  }

  const per = pricePerUnit(item);
  const kg = weightKg(item);
  const price = hasPrice(item) ? Number(item.selling_price_idr) : null;
  const inCart = cart[item.component_id] ?? 0;
  const warranty = warrantyLine(item);

  return (
    <ShopShell dept={dept?.key}>
      <div className="wrap" style={{ padding: '12px 16px 0', fontSize: 11.5, color: 'var(--muted)' }}>
        <Link href="/shop" className="lnk">Katalog</Link>
        {dept && <> / <Link href={`/shop/c/${dept.key}`} className="lnk">{dept.label}</Link></>}
        {item.category && dept && dept.categories.length > 1 && <> / <Link href={`/shop/c/${dept.key}?cat=${item.category}`} className="lnk">{categoryLabel(item.category)}</Link></>}
        {' / '}<span style={{ color: 'var(--ink)' }} className="mono">{item.supplier_model}</span>
      </div>

      <div className="wrap" style={{ padding: '8px 16px 0' }}>
        <div style={{ paddingBottom: 8, borderBottom: '2px solid var(--navy)' }}>
          <h1 className="h1" style={{ fontSize: 22 }}>{shopName(item)}</h1>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>
            <span className="mono" style={{ color: 'var(--body)' }}>{item.supplier_model}</span>
            {item.brand && <> · {item.brand.trim()}</>}
            {item.category && <> · {categoryLabel(item.category)}</>}
            {warranty && <> · Garansi {warranty}</>}
          </div>
        </div>
      </div>

      <div className="wrap" style={{ padding: '14px 16px 0', display: 'grid', gridTemplateColumns: 'minmax(280px,340px) minmax(0,1fr)', gap: 28, alignItems: 'start' }}>
        {/* buy column */}
        <div>
          <div className="card" style={{ background: 'var(--canvas)', height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
            <Thumb dept={dept?.key ?? null} size={220} />
            <span style={{ position: 'absolute', bottom: 8, left: 0, right: 0, textAlign: 'center', fontSize: 10.5, color: 'var(--label)' }}>Gambar teknis — foto belum ada di katalog</span>
          </div>

          <div className="card" style={{ padding: 14, marginTop: 10 }}>
            {price != null ? (
              <>
                <div className="num" style={{ fontSize: 24, fontWeight: 800, color: 'var(--ink)', letterSpacing: '-.6px', lineHeight: 1 }}>{formatIdr(price)}</div>
                <div className="num" style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 5 }}>
                  per {item.unit || 'unit'}, exc. PPN{per ? ` · ${formatIdrUnit(per.value)}/${per.unit}` : ''}
                </div>
                <div className="num" style={{ fontSize: 11.5, color: 'var(--body)' }}>{formatIdr(withPpn(price))} inc. PPN {PPN_PCT}%</div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--navy)' }}>Harga via penawaran</div>
                <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 4 }}>Belum berharga terbuka di katalog — harga datang bersama penawaran.</div>
              </>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
              <span className="qty" style={{ height: 32 }}>
                <button onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Kurangi" style={{ width: 30, height: 30 }}>−</button>
                <span className="num" style={{ minWidth: 34 }}>{qty}</span>
                <button onClick={() => setQty((q) => q + 1)} aria-label="Tambah" style={{ width: 30, height: 30 }}>+</button>
              </span>
              <button className="btn btn-p" style={{ flex: 1 }} onClick={() => add(item.component_id, qty)}>
                {price != null ? 'Tambah ke keranjang' : 'Tambah ke penawaran'}
              </button>
            </div>
            {price != null && qty > 1 && (
              <div className="num" style={{ fontSize: 12, color: 'var(--body)', marginTop: 8, display: 'flex', justifyContent: 'space-between' }}>
                <span>{qty} {item.unit || 'unit'}</span><strong style={{ color: 'var(--ink)' }}>{formatIdr(price * qty)}</strong>
              </div>
            )}
            {inCart > 0 && <div style={{ fontSize: 11.5, color: 'var(--ok)', marginTop: 6 }}>{inCart} di keranjang · <Link href="/shop/cart" className="lnk">lihat</Link></div>}

            <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--hair)', fontSize: 12, color: 'var(--body)', lineHeight: 1.5 }}>
              <span className={`chip ${needsFreight(item) ? 'fr' : 'ok'}`} style={{ marginRight: 6 }}>{needsFreight(item) ? 'Ekspedisi' : 'Kurir reguler'}</span>
              {needsFreight(item)
                ? <>{kg ? `${kg} kg per ${item.unit || 'unit'}. ` : ''}Ongkir dihitung dari alamat dan dikirim bersama penawaran.</>
                : <>Bisa dikirim kurir reguler; ongkir dihitung saat checkout.</>}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            {item.datasheet_url
              ? <a className="btn btn-s" href={item.datasheet_url} target="_blank" rel="noopener noreferrer" style={{ flex: 1 }}>Datasheet (PDF)</a>
              : <span className="btn btn-s" style={{ flex: 1, opacity: .5, cursor: 'default' }}>Datasheet belum ada</span>}
            <Link className="btn btn-s" href={`/shop/compare?add=${item.component_id}`} style={{ flex: 1 }}>Bandingkan</Link>
          </div>
        </div>

        {/* spec sheet */}
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingBottom: 6, borderBottom: '2px solid var(--navy)' }}>
            <span className="h2">Spesifikasi</span>
            <span className="num" style={{ fontSize: 11.5, color: 'var(--muted)' }}>
              {spec.fields.length > 0 ? `${spec.answered} dari ${spec.fields.length} parameter` : 'belum ada daftar parameter baku untuk kategori ini'}
            </span>
          </div>
          {spec.fields.length === 0 ? (
            <p style={{ color: 'var(--muted)', padding: '14px 0', fontSize: 12.5 }}>
              Kategori ini belum punya daftar parameter di Tech Specs. Kapasitas: <strong className="num" style={{ color: 'var(--ink)' }}>
                {Number(item.norm_value) > 0 ? Number(item.norm_value).toLocaleString('id-ID') : '—'}</strong>
            </p>
          ) : (
            <div style={{ columns: '2 300px', columnGap: 32, paddingTop: 4 }}>
              {groupsFor(spec.fields).map((group) => {
                const rows = fieldsInGroup(spec.fields, group).filter((k) => isAnswered(spec.values[k]));
                if (rows.length === 0) return null;
                return (
                  <div key={group} style={{ breakInside: 'avoid', paddingTop: 12 }}>
                    <div className="lab" style={{ color: 'var(--navy)', paddingBottom: 4, borderBottom: '1px solid var(--navy)' }}>{group.toUpperCase()}</div>
                    {rows.map((k) => {
                      const m = fieldMeta(k);
                      return (
                        <div key={k} className="kv">
                          <span>{m.label}{m.unit ? <span style={{ color: 'var(--label)' }}> ({m.unit})</span> : null}</span>
                          <span className="num">{displaySpecValue(spec.values[k])}</span>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
          {spec.fields.length > spec.answered && (
            <p style={{ fontSize: 11, color: 'var(--label)', marginTop: 10 }}>{spec.fields.length - spec.answered} parameter belum diisi di katalog dan tidak ditampilkan.</p>
          )}
        </div>
      </div>

      {alike.length > 0 && (
        <div className="wrap" style={{ padding: '28px 16px 0' }}>
          <div style={{ paddingBottom: 6, borderBottom: '2px solid var(--navy)' }}>
            <span className="h2">Kapasitas terdekat di {categoryLabel(item.category)}</span>
          </div>
          <ProductTable items={alike} columns={columnsFor(item.category)} onAdd={add} />
        </div>
      )}
    </ShopShell>
  );
}
