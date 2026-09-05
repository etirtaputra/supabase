'use client';
/** One product as the grid shows it: what it is, what it costs, per what. */
import React from 'react';
import Link from 'next/link';
import {
  departmentOf, shopName, hasPrice, pricePerUnit, needsFreight, warrantyLine,
  formatIdr, formatIdrUnit, type ShopItem,
} from '@/lib/shopCatalog';
import { Thumb } from './useShopData';

export default function ProductCard({ item, onAdd }: { item: ShopItem; onAdd: (id: string) => void }) {
  const dept = departmentOf(item.category);
  const per = pricePerUnit(item);
  const warranty = warrantyLine(item);
  return (
    <div className="card prod">
      <Link href={`/shop/p/${item.component_id}`} className="thumb">
        {item.brand && (
          <span className="chip" style={{ position: 'absolute', top: 12, left: 12, background: '#fff', border: '1px solid var(--line)', color: 'var(--muted)' }}>
            {item.brand.trim()}
          </span>
        )}
        <Thumb dept={dept?.key ?? null} size={124} />
      </Link>
      <div style={{ padding: '14px 16px 16px', display: 'flex', flexDirection: 'column', flex: 1 }}>
        <Link href={`/shop/p/${item.component_id}`} style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.35 }}>
          {shopName(item)}
        </Link>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 4, minHeight: 18 }}>
          {warranty ?? dept?.label ?? ''}
        </div>

        <div style={{ marginTop: 12, paddingTop: 11, borderTop: '1px solid var(--hair)' }}>
          {hasPrice(item) ? (
            <>
              <div className="num" style={{ fontSize: 20, fontWeight: 800, color: 'var(--ink)', letterSpacing: '-.4px' }}>
                {formatIdr(Number(item.selling_price_idr))}
              </div>
              <div className="num" style={{ fontSize: 12, color: 'var(--muted)' }}>
                {per ? `${formatIdrUnit(per.value)} / ${per.unit} · ` : ''}exc. PPN
              </div>
            </>
          ) : (
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--navy)' }}>Harga via penawaran</div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 13, gap: 8 }}>
          <span className="chip" style={needsFreight(item)
            ? { background: 'var(--sun-tint)', color: 'var(--sun)' }
            : { background: '#eaf7ee', color: 'var(--ok)' }}>
            {needsFreight(item) ? 'Ekspedisi' : 'Kurir reguler'}
          </span>
          <button className="btn btn-p" style={{ minHeight: 36, padding: '0 14px', fontSize: 13.5 }}
            onClick={() => onAdd(item.component_id)}>
            {hasPrice(item) ? '+ Keranjang' : '+ Penawaran'}
          </button>
        </div>
      </div>
    </div>
  );
}
