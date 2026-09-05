'use client';
/**
 * The listing, as a table.
 *
 * Cards are for shoppers; tables are for people who know what they need. One
 * row per product, the category's highlighted spec fields as columns, price,
 * price per unit, how it ships, quantity, add. Twenty rows fit a screen.
 */
import React, { useState } from 'react';
import Link from 'next/link';
import {
  departmentOf, shopName, hasPrice, pricePerUnit, needsFreight, specsOf, categoryLabel,
  formatIdr, formatIdrUnit, type ShopItem,
} from '@/lib/shopCatalog';
import { fieldMeta, isAnswered, displaySpecValue } from '@/lib/specFields';
import { CATEGORY_UNITS } from '@/constants/categoryUnits';
import { Thumb } from './useShopData';

export default function ProductTable({ items, columns, showCategory = false, onAdd, empty }: {
  items: ShopItem[];
  /** Spec keys to show as columns — the category's highlighted fields. */
  columns: string[];
  showCategory?: boolean;
  onAdd: (id: string, qty: number) => void;
  empty?: string;
}) {
  const [qty, setQty] = useState<Record<string, number>>({});
  const q = (id: string) => qty[id] ?? 1;
  const bump = (id: string, d: number) => setQty((m) => ({ ...m, [id]: Math.max(1, (m[id] ?? 1) + d) }));
  const showCapacity = columns.length === 0;

  return (
    <div style={{ overflowX: 'auto' }}>
      <table>
        <thead>
          <tr>
            <th style={{ width: 52 }}></th>
            <th>Produk</th>
            {showCategory && <th className="hidesm">Kategori</th>}
            {showCapacity && <th className="r">Kapasitas</th>}
            {columns.map((k) => {
              const m = fieldMeta(k);
              return <th key={k} className="r">{m.label}{m.unit ? <span style={{ opacity: .6 }}> ({m.unit})</span> : null}</th>;
            })}
            <th className="r">Harga</th>
            <th className="r hidesm">per satuan</th>
            <th>Kirim</th>
            <th className="r" style={{ width: 170 }}></th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => {
            const dept = departmentOf(i.category);
            const s = specsOf(i);
            const per = pricePerUnit(i);
            const cu = i.category ? CATEGORY_UNITS[i.category] : undefined;
            return (
              <tr key={i.component_id}>
                <td style={{ padding: '4px 6px' }}>
                  <Link href={`/shop/p/${i.component_id}`} style={{ display: 'block', width: 40, height: 30, background: 'var(--canvas)', borderRadius: 3, overflow: 'hidden' }}>
                    <Thumb dept={dept?.key ?? null} size={40} />
                  </Link>
                </td>
                <td style={{ minWidth: 220 }}>
                  <Link href={`/shop/p/${i.component_id}`} className="lnk" style={{ fontWeight: 600, color: 'var(--ink)', display: 'block', lineHeight: 1.3 }}>{shopName(i)}</Link>
                  <span className="mono" style={{ color: 'var(--muted)' }}>{i.supplier_model}</span>
                  {i.brand && <span style={{ color: 'var(--label)', fontSize: 11 }}> · {i.brand.trim()}</span>}
                </td>
                {showCategory && <td className="hidesm" style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>{categoryLabel(i.category)}</td>}
                {showCapacity && (
                  <td className="r num" style={{ whiteSpace: 'nowrap', color: 'var(--ink)' }}>
                    {cu && Number(i.norm_value) > 0 ? `${Number(i.norm_value).toLocaleString('id-ID')} ${cu.unit}` : <span style={{ color: 'var(--label)' }}>—</span>}
                  </td>
                )}
                {columns.map((k) => (
                  <td key={k} className="r num" style={{ whiteSpace: 'nowrap', color: isAnswered(s[k]) ? 'var(--ink)' : 'var(--label)' }}>
                    {isAnswered(s[k]) ? displaySpecValue(s[k]) : '—'}
                  </td>
                ))}
                <td className="r num" style={{ whiteSpace: 'nowrap', fontWeight: 700, color: 'var(--ink)' }}>
                  {hasPrice(i) ? formatIdr(Number(i.selling_price_idr)) : <span style={{ color: 'var(--navy)', fontWeight: 600 }}>penawaran</span>}
                </td>
                <td className="r num hidesm" style={{ whiteSpace: 'nowrap', color: 'var(--muted)' }}>
                  {per ? `${formatIdrUnit(per.value)}/${per.unit}` : ''}
                </td>
                <td><span className={`chip ${needsFreight(i) ? 'fr' : 'ok'}`}>{needsFreight(i) ? 'Ekspedisi' : 'Kurir'}</span></td>
                <td className="r" style={{ whiteSpace: 'nowrap' }}>
                  <span className="qty" style={{ marginRight: 6 }}>
                    <button onClick={() => bump(i.component_id, -1)} aria-label="Kurangi">−</button>
                    <span className="num">{q(i.component_id)}</span>
                    <button onClick={() => bump(i.component_id, 1)} aria-label="Tambah">+</button>
                  </span>
                  <button className="btn btn-p" style={{ minHeight: 28, padding: '0 10px', fontSize: 12 }} onClick={() => onAdd(i.component_id, q(i.component_id))}>
                    Tambah
                  </button>
                </td>
              </tr>
            );
          })}
          {items.length === 0 && (
            <tr><td colSpan={20} style={{ padding: 20, color: 'var(--muted)' }}>{empty ?? 'Tidak ada item.'}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
