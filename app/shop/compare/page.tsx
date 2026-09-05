'use client';
/**
 * Side-by-side comparison, public side.
 *
 * The same argument as the Tech Specs comparison: two products can only be
 * compared honestly when both answer the SAME questions, which is what a
 * declared per-category field set buys. Rows whose values differ are marked;
 * everything else is agreement and can be skipped.
 */
import React, { useEffect, useMemo, useState, Fragment } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { CATEGORY_SPEC_FIELDS, conformSpecs } from '@/lib/specSchema';
import { groupsFor, fieldsInGroup, fieldMeta, isAnswered, displaySpecValue } from '@/lib/specFields';
import {
  DEPARTMENTS, departmentOf, shopName, hasPrice, pricePerUnit, formatIdr,
  formatIdrUnit, type ShopItem,
} from '@/lib/shopCatalog';
import { ShopShell } from '@/components/shop/shopUi';
import { useShopData, Thumb } from '@/components/shop/useShopData';

const MAX = 4;

export default function ComparePage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const { items, byId, loading } = useShopData();

  const [picked, setPicked] = useState<string[]>([]);
  const [deptKey, setDeptKey] = useState<string>('panel');
  const [q, setQ] = useState('');
  const [onlyDiff, setOnlyDiff] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(true);

  useEffect(() => { document.title = 'Bandingkan — ICA Solar (demo)'; }, []);
  useEffect(() => {
    if (!authLoading && !user) router.replace(`/login?next=${encodeURIComponent('/shop/compare')}`);
  }, [authLoading, user, router]);

  // ?add= arrives from a product page; adopt its department so the picker is useful.
  const seed = params.get('add');
  useEffect(() => {
    if (!seed || loading) return;
    const it = byId.get(seed);
    if (!it) return;
    setPicked((p) => (p.includes(seed) || p.length >= MAX ? p : [...p, seed]));
    const d = departmentOf(it.category);
    if (d) setDeptKey(d.key);
  }, [seed, loading, byId]);

  const inDept = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items
      .filter((i) => departmentOf(i.category)?.key === deptKey)
      .filter((i) => !needle || `${shopName(i)} ${i.brand ?? ''}`.toLowerCase().includes(needle))
      .sort((a, b) => Number(b.norm_value ?? 0) - Number(a.norm_value ?? 0) || shopName(a).localeCompare(shopName(b)));
  }, [items, deptKey, q]);

  const cols = useMemo(
    () => picked.map((id) => byId.get(id)).filter((i): i is ShopItem => !!i),
    [picked, byId]);

  /**
   * Comparable rows: the declared field set of the category the columns share.
   * Columns from different categories have no common field set, and pretending
   * otherwise is exactly the dishonest comparison this page exists to avoid.
   */
  const fields = useMemo(() => {
    const cats = new Set(cols.map((c) => c.category));
    if (cats.size !== 1) return [] as readonly string[];
    const cat = [...cats][0] as keyof typeof CATEGORY_SPEC_FIELDS;
    return (CATEGORY_SPEC_FIELDS[cat] ?? []) as readonly string[];
  }, [cols]);

  const values = useMemo(
    () => cols.map((c) => conformSpecs(c.category, c.specifications ?? {}) as Record<string, unknown>),
    [cols]);

  const differs = (key: string) =>
    new Set(values.map((v) => displaySpecValue(v[key]))).size > 1;

  const toggle = (id: string) => setPicked((p) =>
    p.includes(id) ? p.filter((x) => x !== id) : p.length >= MAX ? p : [...p, id]);

  return (
    <ShopShell>
      <div className="wrap" style={{ padding: '26px 20px 0' }}>
        <div className="lab" style={{ color: 'var(--navy)' }}>PERBANDINGAN</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 14, flexWrap: 'wrap', marginTop: 8 }}>
          <h1 className="h1">Bandingkan berdampingan</h1>
          {cols.length >= 2 && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13.5, color: 'var(--body)', minHeight: 44, cursor: 'pointer' }}>
              <input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} style={{ width: 17, height: 17, accentColor: '#1f5aa8' }} />
              Hanya baris yang berbeda
            </label>
          )}
        </div>
      </div>

      {/* slots — the columns, before there is a table to put them in */}
      <div className="wrap" style={{ padding: '18px 20px 0' }}>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))' }}>
          {Array.from({ length: MAX }).map((_, i) => {
            const c = cols[i];
            if (!c) {
              return (
                <button key={`slot-${i}`} onClick={() => setPickerOpen(true)}
                  style={{ minHeight: 76, borderRadius: 14, border: '1px dashed var(--line)', background: 'none', color: 'var(--muted)', fontSize: 13.5, cursor: 'pointer', fontFamily: 'inherit' }}>
                  + Tambah produk
                </button>
              );
            }
            return (
              <div key={c.component_id} className="card" style={{ padding: '12px 12px 12px 14px', display: 'flex', gap: 8, alignItems: 'flex-start', minHeight: 76 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="lab" style={{ fontSize: 9 }}>{(c.brand ?? '').trim()}</div>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.3, marginTop: 3 }}>{shopName(c)}</div>
                </div>
                <button onClick={() => toggle(c.component_id)} aria-label="Hapus"
                  style={{ width: 26, height: 26, borderRadius: 6, border: 0, background: 'none', color: 'var(--label)', fontSize: 16, cursor: 'pointer', flex: 'none' }}>×</button>
              </div>
            );
          })}
        </div>
      </div>

      {pickerOpen ? (
        <div className="wrap" style={{ padding: '16px 20px 0' }}>
          <div className="card">
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: 14, borderBottom: '1px solid var(--hair)', flexWrap: 'wrap' }}>
              <select value={deptKey} onChange={(e) => { setDeptKey(e.target.value); }} style={{ width: 'auto', minWidth: 190 }}>
                {DEPARTMENTS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
              </select>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari model atau merek…" style={{ flex: '1 1 220px', maxWidth: 340 }} />
              <span className="num" style={{ fontSize: 12.5, color: 'var(--muted)', marginLeft: 'auto' }}>
                {picked.length} dari {MAX} dipilih · {inDept.length} pilihan
              </span>
              <button className="btn btn-p" style={{ minHeight: 38, padding: '0 15px', fontSize: 13.5 }}
                disabled={cols.length < 2} onClick={() => setPickerOpen(false)}>Bandingkan</button>
            </div>
            <div style={{ maxHeight: 260, overflowY: 'auto', padding: 8, display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 4 }}>
              {inDept.map((i) => {
                const on = picked.includes(i.component_id);
                const full = !on && picked.length >= MAX;
                return (
                  <button key={i.component_id} disabled={full}
                    onClick={() => { toggle(i.component_id); if (!on && picked.length === MAX - 1) setPickerOpen(false); }}
                    style={{ display: 'flex', gap: 10, alignItems: 'center', textAlign: 'left', padding: '9px 10px', borderRadius: 9,
                      border: `1px solid ${on ? 'rgba(31,90,168,.4)' : 'transparent'}`, background: on ? 'rgba(31,90,168,.07)' : 'transparent',
                      cursor: full ? 'not-allowed' : 'pointer', opacity: full ? .35 : 1, fontFamily: 'inherit', minHeight: 44 }}>
                    <span style={{ width: 16, height: 16, borderRadius: 4, flex: 'none', display: 'grid', placeItems: 'center',
                      border: on ? 'none' : '1.5px solid #cbd5e1', background: on ? '#1f5aa8' : 'transparent', color: '#fff', fontSize: 10, fontWeight: 800 }}>
                      {on ? '✓' : ''}
                    </span>
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ display: 'block', fontSize: 13, color: on ? 'var(--navy)' : 'var(--body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {shopName(i)}
                      </span>
                      <span className="num" style={{ display: 'block', fontSize: 11, color: 'var(--label)' }}>
                        {hasPrice(i) ? formatIdr(Number(i.selling_price_idr)) : 'via penawaran'}
                      </span>
                    </span>
                  </button>
                );
              })}
              {!loading && inDept.length === 0 && <p style={{ padding: 16, fontSize: 13, color: 'var(--muted)' }}>Tidak ada yang cocok.</p>}
            </div>
          </div>
        </div>
      ) : (
        <div className="wrap" style={{ padding: '14px 20px 0' }}>
          <button className="btn btn-s" style={{ minHeight: 38, fontSize: 13.5 }} onClick={() => setPickerOpen(true)}>Ganti produk</button>
        </div>
      )}

      <div className="wrap" style={{ padding: '20px 20px 0' }}>
        {cols.length < 2 ? (
          <div className="card" style={{ padding: 28, color: 'var(--muted)' }}>Pilih minimal dua produk untuk dibandingkan.</div>
        ) : fields.length === 0 ? (
          <div className="card" style={{ padding: 28, color: 'var(--muted)' }}>
            Produk yang dipilih berasal dari kategori berbeda, jadi tidak ada daftar parameter yang sama —
            perbandingannya tidak akan sebanding. Pilih produk dari satu kategori.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }} className="card">
            <table style={{ minWidth: 620 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '14px 16px', width: 210 }} className="lab">PARAMETER</th>
                  {cols.map((c) => (
                    <th key={c.component_id} style={{ textAlign: 'left', padding: '14px 16px', minWidth: 150 }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <Thumb dept={departmentOf(c.category)?.key ?? null} size={64} />
                        <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.25 }}>{shopName(c)}</span>
                        <span className="num" style={{ fontSize: 12.5, color: 'var(--body)' }}>
                          {hasPrice(c) ? formatIdr(Number(c.selling_price_idr)) : 'via penawaran'}
                          {pricePerUnit(c) ? ` · ${formatIdrUnit(pricePerUnit(c)!.value)}/${pricePerUnit(c)!.unit}` : ''}
                        </span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groupsFor(fields).map((group) => {
                  const rows = fieldsInGroup(fields, group)
                    .filter((k) => values.some((v) => isAnswered(v[k])))
                    .filter((k) => !onlyDiff || differs(k));
                  if (rows.length === 0) return null;
                  return (
                    <Fragment key={group}>
                      <tr>
                        <td colSpan={cols.length + 1} className="lab"
                          style={{ padding: '16px 16px 7px', color: 'var(--navy)', background: 'var(--canvas)', borderTop: '1px solid var(--line)' }}>
                          {group.toUpperCase()}
                        </td>
                      </tr>
                      {rows.map((k) => {
                        const meta = fieldMeta(k);
                        const d = differs(k);
                        return (
                          <tr key={k} style={{ borderTop: '1px solid var(--hair)', background: d ? 'rgba(200,122,34,.055)' : undefined }}>
                            <td style={{ padding: '10px 16px', color: 'var(--muted)', fontSize: 13.5, verticalAlign: 'top' }}>
                              {meta.label}{meta.unit ? <span style={{ color: 'var(--label)' }}> ({meta.unit})</span> : null}
                            </td>
                            {cols.map((c, ci) => (
                              <td key={c.component_id} className="num"
                                style={{ padding: '10px 16px', fontSize: 13.5, verticalAlign: 'top',
                                  color: !isAnswered(values[ci][k]) ? 'var(--label)' : d ? 'var(--ink)' : 'var(--body)',
                                  fontWeight: d && isAnswered(values[ci][k]) ? 600 : 400 }}>
                                {displaySpecValue(values[ci][k])}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {cols.length >= 2 && fields.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 12.5, color: 'var(--muted)' }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: 'rgba(200,122,34,.13)', border: '1px solid #eeddc2' }} />
            ditandai bila nilainya berbeda
            <Link href="/shop" style={{ marginLeft: 'auto', fontWeight: 600, color: 'var(--navy)' }}>Kembali ke toko →</Link>
          </div>
        )}
      </div>
    </ShopShell>
  );
}
