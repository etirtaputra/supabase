'use client';
/**
 * A product page — and the point of the whole exercise.
 *
 * The specification table is rendered from `CATEGORY_SPEC_FIELDS` and
 * `SPEC_FIELD_META`: the SAME declared field set, in the same order, under the
 * same group headings and with the same labels and units as the Tech Specs
 * screen the staff enter it on. Not a copy of that list — the list itself. A
 * parameter added there appears here in the same commit, and the two can never
 * disagree about what "Max PV Voc" is called or what unit it is in.
 */
import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { CATEGORY_SPEC_FIELDS, conformSpecs } from '@/lib/specSchema';
import { groupsFor, fieldsInGroup, fieldMeta, isAnswered, displaySpecValue } from '@/lib/specFields';
import {
  departmentOf, shopName, hasPrice, pricePerUnit, needsFreight, weightKg,
  warrantyLine, formatIdr, formatIdrUnit, withPpn, PPN_PCT,
} from '@/lib/shopCatalog';
import { ShopShell, useCart } from '@/components/shop/shopUi';
import { useShopData, Thumb } from '@/components/shop/useShopData';
import ProductCard from '@/components/shop/ProductCard';

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

  /** Declared field set for this category, conformed so gaps read as gaps. */
  const spec = useMemo(() => {
    if (!item) return { fields: [] as readonly string[], values: {} as Record<string, unknown>, answered: 0 };
    const fields = (CATEGORY_SPEC_FIELDS[item.category as keyof typeof CATEGORY_SPEC_FIELDS] ?? []) as readonly string[];
    const values = conformSpecs(item.category, item.specifications ?? {}) as Record<string, unknown>;
    const answered = fields.filter((k) => isAnswered(values[k])).length;
    return { fields, values, answered };
  }, [item]);

  const alike = useMemo(() => {
    if (!item) return [];
    return items
      .filter((i) => i.component_id !== item.component_id && i.category === item.category && hasPrice(i))
      .sort((a, b) => Math.abs(Number(a.norm_value ?? 0) - Number(item.norm_value ?? 0))
                    - Math.abs(Number(b.norm_value ?? 0) - Number(item.norm_value ?? 0)))
      .slice(0, 4);
  }, [items, item]);

  if (loading || authLoading) {
    return <ShopShell><div className="wrap" style={{ padding: '60px 20px', color: 'var(--muted)' }}>Memuat produk…</div></ShopShell>;
  }
  if (!item) {
    return (
      <ShopShell>
        <div className="wrap" style={{ padding: '60px 20px' }}>
          <h1 className="h2">Produk tidak ditemukan</h1>
          <Link href="/shop" className="btn btn-s" style={{ marginTop: 18 }}>Kembali ke toko</Link>
        </div>
      </ShopShell>
    );
  }

  const per = pricePerUnit(item);
  const kg = weightKg(item);
  const price = hasPrice(item) ? Number(item.selling_price_idr) : null;
  const inCart = cart[item.component_id] ?? 0;

  return (
    <ShopShell dept={dept?.key}>
      <div className="wrap" style={{ padding: '20px 20px 0', fontSize: 13, color: 'var(--muted)' }}>
        <Link href="/shop">Toko</Link> <span style={{ color: '#cbd5e1' }}>/</span>{' '}
        {dept && <><Link href={`/shop/c/${dept.key}`}>{dept.label}</Link> <span style={{ color: '#cbd5e1' }}>/</span> </>}
        <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{item.supplier_model}</span>
      </div>

      <div className="wrap" style={{ padding: '18px 20px 0', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(330px,1fr))', gap: 40, alignItems: 'start' }}>
        <div className="card" style={{ background: 'var(--canvas)', minHeight: 340, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
          <Thumb dept={dept?.key ?? null} size={300} />
          <span style={{ position: 'absolute', bottom: 14, left: 0, right: 0, textAlign: 'center', fontSize: 11.5, color: 'var(--label)' }}>
            Gambar teknis — foto produk belum ada di katalog
          </span>
        </div>

        <div>
          <div className="lab" style={{ color: 'var(--navy)' }}>
            {[item.brand?.trim(), dept?.label].filter(Boolean).join(' · ')}
          </div>
          <h1 style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-.9px', color: 'var(--ink)', lineHeight: 1.18, marginTop: 8 }}>
            {shopName(item)}
          </h1>
          <div style={{ fontFamily: 'ui-monospace,SFMono-Regular,monospace', fontSize: 12.5, color: 'var(--muted)', marginTop: 6 }}>
            {item.supplier_model}
          </div>

          {spec.fields.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(110px,1fr))', marginTop: 20, borderTop: '3px solid var(--navy)', borderBottom: '1px solid var(--line)' }}>
              {spec.fields.filter((k) => fieldMeta(k).highlight && isAnswered(spec.values[k])).slice(0, 4).map((k) => (
                <div key={k} style={{ padding: '13px 0' }}>
                  <div className="lab" style={{ fontSize: 9 }}>{fieldMeta(k).label.toUpperCase()}</div>
                  <div className="num" style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)', marginTop: 2 }}>
                    {displaySpecValue(spec.values[k])}{fieldMeta(k).unit ? ` ${fieldMeta(k).unit}` : ''}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="card" style={{ padding: 22, marginTop: 20, background: 'var(--canvas)' }}>
            {price != null ? (
              <>
                <div className="num" style={{ fontSize: 32, fontWeight: 800, color: 'var(--ink)', letterSpacing: '-1px', lineHeight: 1 }}>{formatIdr(price)}</div>
                <div className="num" style={{ fontSize: 13, color: 'var(--muted)', marginTop: 6 }}>
                  {per ? `${formatIdrUnit(per.value)} / ${per.unit} · ` : ''}per {item.unit || 'unit'}, belum termasuk PPN
                </div>
                <div className="num" style={{ fontSize: 13, color: 'var(--body)' }}>{formatIdr(withPpn(price))} termasuk PPN {PPN_PCT}%</div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--navy)' }}>Harga via penawaran</div>
                <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 6 }}>
                  Item ini belum berharga terbuka di katalog — tambahkan ke permintaan penawaran dan kami balas dengan harga.
                </div>
              </>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 20, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--line)', borderRadius: 10, background: '#fff', height: 48 }}>
                <button onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Kurangi"
                  style={{ width: 44, height: 46, border: 0, background: 'none', fontSize: 20, color: 'var(--muted)', cursor: 'pointer' }}>−</button>
                <span className="num" style={{ width: 52, textAlign: 'center', fontWeight: 700, color: 'var(--ink)', fontSize: 16 }}>{qty}</span>
                <button onClick={() => setQty((q) => q + 1)} aria-label="Tambah"
                  style={{ width: 44, height: 46, border: 0, background: 'none', fontSize: 20, color: 'var(--muted)', cursor: 'pointer' }}>+</button>
              </div>
              <button className="btn btn-p" style={{ flex: '1 1 200px' }} onClick={() => add(item.component_id, qty)}>
                {price != null ? 'Tambah ke Keranjang' : 'Tambah ke Penawaran'}
              </button>
            </div>
            {price != null && (
              <div className="num" style={{ fontSize: 13, color: 'var(--body)', marginTop: 12, display: 'flex', justifyContent: 'space-between' }}>
                <span>Subtotal {qty} {item.unit || 'unit'}</span>
                <strong style={{ color: 'var(--ink)' }}>{formatIdr(price * qty)}</strong>
              </div>
            )}
            {inCart > 0 && (
              <div style={{ fontSize: 12.5, color: 'var(--ok)', marginTop: 8 }}>
                {inCart} sudah di keranjang — <Link href="/shop/cart" style={{ fontWeight: 600, color: 'var(--navy)' }}>lihat keranjang</Link>
              </div>
            )}

            {needsFreight(item) && (
              <div style={{ marginTop: 16, paddingTop: 15, borderTop: '1px dashed #cbd5e1', display: 'flex', gap: 12, fontSize: 13, color: 'var(--body)', lineHeight: 1.5 }}>
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#c87a22" strokeWidth="1.8" strokeLinecap="round" style={{ flex: 'none', marginTop: 1 }}>
                  <path d="M2 8h11v9H2zM13 11h5l3 3v3h-8z" /><circle cx="6" cy="19" r="1.6" /><circle cx="17" cy="19" r="1.6" />
                </svg>
                <div>
                  <strong style={{ color: 'var(--ink)' }}>Dikirim via ekspedisi{kg ? ` — ${kg} kg per ${item.unit || 'unit'}` : ''}.</strong>{' '}
                  Ongkir dihitung setelah alamat diisi dan dikirim bersama penawaran.
                </div>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
            {item.datasheet_url
              ? <a className="btn btn-s" href={item.datasheet_url} target="_blank" rel="noopener noreferrer" style={{ flex: '1 1 180px' }}>Unduh Datasheet</a>
              : <span className="btn btn-s" style={{ flex: '1 1 180px', opacity: .5, cursor: 'default' }}>Datasheet belum tersedia</span>}
            <Link className="btn btn-s" href={`/shop/compare?add=${item.component_id}`} style={{ flex: '1 1 180px' }}>Bandingkan</Link>
          </div>

          {warrantyLine(item) && (
            <div style={{ fontSize: 13.5, color: 'var(--body)', marginTop: 14 }}>
              <span className="lab">GARANSI</span> <span style={{ marginLeft: 8 }}>{warrantyLine(item)}</span>
            </div>
          )}
        </div>
      </div>

      {/* The spec sheet — the ERP's own field set, group for group */}
      <div className="wrap" style={{ padding: '44px 20px 0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', paddingBottom: 12, borderBottom: '3px solid var(--navy)' }}>
          <h2 className="h2">Spesifikasi Teknis</h2>
          <span className="num" style={{ fontSize: 13.5, color: 'var(--muted)' }}>
            {spec.fields.length > 0
              ? <><strong style={{ color: 'var(--ink)' }}>{spec.answered} dari {spec.fields.length}</strong> parameter terisi</>
              : 'Kategori ini belum punya daftar parameter baku'}
          </span>
        </div>

        {spec.fields.length === 0 ? (
          <p style={{ color: 'var(--muted)', padding: '20px 0' }}>
            Belum ada daftar parameter untuk kategori ini — kategori berikutnya ditentukan di Tech Specs.
          </p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(340px,1fr))', gap: '0 48px' }}>
            {groupsFor(spec.fields).map((group) => {
              const rows = fieldsInGroup(spec.fields, group).filter((k) => isAnswered(spec.values[k]));
              if (rows.length === 0) return null;
              return (
                <div key={group} style={{ breakInside: 'avoid' }}>
                  <div className="lab" style={{ color: 'var(--navy)', padding: '22px 0 8px', borderBottom: '1.5px solid var(--navy)' }}>
                    {group.toUpperCase()}
                  </div>
                  {rows.map((k) => {
                    const meta = fieldMeta(k);
                    return (
                      <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 20, padding: '9px 0', borderBottom: '1px solid var(--hair)' }}>
                        <span style={{ color: 'var(--muted)', fontSize: 13.5 }}>
                          {meta.label}{meta.unit ? <span style={{ color: 'var(--label)' }}> ({meta.unit})</span> : null}
                        </span>
                        <span className="num" style={{ fontWeight: 600, color: 'var(--ink)', fontSize: 13.5, textAlign: 'right' }}>
                          {displaySpecValue(spec.values[k])}
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}

        {spec.fields.length > spec.answered && (
          <p style={{ fontSize: 12.5, color: 'var(--label)', marginTop: 14 }}>
            {spec.fields.length - spec.answered} parameter belum diisi di katalog dan tidak ditampilkan.
          </p>
        )}
      </div>

      {alike.length > 0 && (
        <div className="wrap" style={{ padding: '44px 20px 0' }}>
          <div className="lab" style={{ color: 'var(--navy)' }}>KAPASITAS TERDEKAT</div>
          <h2 className="h2" style={{ marginTop: 8, marginBottom: 18 }}>Alternatif di kategori yang sama</h2>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))' }}>
            {alike.map((i) => <ProductCard key={i.component_id} item={i} onAdd={add} />)}
          </div>
        </div>
      )}
    </ShopShell>
  );
}
