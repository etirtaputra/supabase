'use client';
/**
 * The cart, and the fork that makes this shop work in Indonesia.
 *
 * One basket, two lanes: what a parcel courier can carry, and what needs an
 * ekspedisi quote. A pallet of 620 Wp modules cannot be priced by a courier
 * API, so the honest checkout for a mixed basket is a QUOTE — which is also
 * the document ICAPROC already knows how to produce.
 *
 * Nothing here writes to the database: this is a demo, and sending the request
 * for real means creating a sales quote, which is the owner's call to make.
 */
import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import {
  departmentOf, shopName, hasPrice, needsFreight, weightKg, cartSubtotal,
  formatIdr, withPpn, PPN_PCT, type ShopItem,
} from '@/lib/shopCatalog';
import { copyOnly } from '@/lib/whatsappQuote';
import { ShopShell, useCart } from '@/components/shop/shopUi';
import { useShopData, Thumb } from '@/components/shop/useShopData';

export default function CartPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const { byId, loading } = useShopData();
  const { cart, setQty, clear, count } = useCart();
  const [copied, setCopied] = useState(false);

  useEffect(() => { document.title = 'Keranjang — ICA Solar (demo)'; }, []);
  useEffect(() => {
    if (!authLoading && !user) router.replace(`/login?next=${encodeURIComponent('/shop/cart')}`);
  }, [authLoading, user, router]);

  const lines = useMemo(
    () => Object.entries(cart)
      .map(([id, qty]) => ({ item: byId.get(id), qty }))
      .filter((l): l is { item: ShopItem; qty: number } => !!l.item),
    [cart, byId]);

  const priced = lines.filter((l) => hasPrice(l.item));
  const unpriced = lines.filter((l) => !hasPrice(l.item));
  const freight = lines.filter((l) => needsFreight(l.item));
  const courier = lines.filter((l) => !needsFreight(l.item));
  const subtotal = cartSubtotal(priced);
  const ppn = subtotal * PPN_PCT / 100;
  const courierSubtotal = cartSubtotal(courier.filter((l) => hasPrice(l.item)));
  const freightKg = freight.reduce((s, l) => s + (weightKg(l.item) ?? 0) * l.qty, 0);

  const summaryText = useMemo(() => {
    const rows = lines.map((l) => {
      const price = hasPrice(l.item) ? formatIdr(Number(l.item.selling_price_idr)) : 'minta harga';
      return `• ${l.qty} × ${shopName(l.item)} — ${price}`;
    });
    return [
      'Permintaan penawaran — ICA Solar',
      '',
      ...rows,
      '',
      `Subtotal (yang berharga): ${formatIdr(subtotal)}`,
      `PPN ${PPN_PCT}%: ${formatIdr(ppn)}`,
      freight.length ? `${freight.length} item dikirim via ekspedisi — mohon hitungkan ongkir.` : '',
    ].filter(Boolean).join('\n');
  }, [lines, subtotal, ppn, freight.length]);

  const doCopy = async () => {
    if (await copyOnly(summaryText) === 'copied') {
      setCopied(true);
      setTimeout(() => setCopied(false), 4000);
    }
  };

  return (
    <ShopShell>
      <div className="wrap" style={{ padding: '26px 20px 0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', paddingBottom: 14, borderBottom: '3px solid var(--navy)' }}>
          <h1 className="h1">
            Keranjang <span className="num" style={{ color: 'var(--muted)', fontWeight: 600 }}>{count} item</span>
          </h1>
          {lines.length > 0 && (
            <button onClick={clear} style={{ background: 'none', border: 0, color: 'var(--muted)', fontWeight: 600, fontSize: 13.5, cursor: 'pointer', fontFamily: 'inherit', minHeight: 44 }}>
              Kosongkan
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="wrap" style={{ padding: '40px 20px', color: 'var(--muted)' }}>Memuat…</div>
      ) : lines.length === 0 ? (
        <div className="wrap" style={{ padding: '40px 20px' }}>
          <div className="card" style={{ padding: 36, textAlign: 'center' }}>
            <p style={{ color: 'var(--muted)' }}>Keranjang masih kosong.</p>
            <Link href="/shop" className="btn btn-p" style={{ marginTop: 18 }}>Mulai belanja</Link>
          </div>
        </div>
      ) : (
        <div className="wrap" style={{ padding: '20px 20px 0', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 24, alignItems: 'start' }}>
          <div style={{ minWidth: 0 }}>
            <div className="card" style={{ overflow: 'hidden' }}>
              {lines.map((l, idx) => {
                const dept = departmentOf(l.item.category);
                const price = hasPrice(l.item) ? Number(l.item.selling_price_idr) : null;
                return (
                  <div key={l.item.component_id} style={{ display: 'flex', gap: 14, padding: 16, alignItems: 'center', flexWrap: 'wrap', borderBottom: idx < lines.length - 1 ? '1px solid var(--hair)' : 'none' }}>
                    <div style={{ width: 72, height: 56, background: 'var(--canvas)', borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
                      <Thumb dept={dept?.key ?? null} size={52} />
                    </div>
                    <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                      <Link href={`/shop/p/${l.item.component_id}`} style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--ink)' }}>
                        {shopName(l.item)}
                      </Link>
                      <div className="num" style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 3 }}>
                        {price != null ? `${formatIdr(price)} / ${l.item.unit || 'unit'}` : 'harga via penawaran'}
                      </div>
                      <span className="chip" style={{ marginTop: 7, ...(needsFreight(l.item)
                        ? { background: 'var(--sun-tint)', color: 'var(--sun)' }
                        : { background: '#eaf7ee', color: 'var(--ok)' }) }}>
                        {needsFreight(l.item)
                          ? `Ekspedisi${weightKg(l.item) ? ` · ${(weightKg(l.item)! * l.qty).toLocaleString('id-ID')} kg` : ''}`
                          : 'Kurir reguler'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--line)', borderRadius: 9, height: 44, flex: 'none' }}>
                      <button onClick={() => setQty(l.item.component_id, l.qty - 1)} aria-label="Kurangi"
                        style={{ width: 40, height: 42, border: 0, background: 'none', fontSize: 18, color: 'var(--muted)', cursor: 'pointer' }}>−</button>
                      <span className="num" style={{ width: 38, textAlign: 'center', fontWeight: 700, color: 'var(--ink)' }}>{l.qty}</span>
                      <button onClick={() => setQty(l.item.component_id, l.qty + 1)} aria-label="Tambah"
                        style={{ width: 40, height: 42, border: 0, background: 'none', fontSize: 18, color: 'var(--muted)', cursor: 'pointer' }}>+</button>
                    </div>
                    <div className="num" style={{ width: 130, textAlign: 'right', fontSize: 16, fontWeight: 700, color: price != null ? 'var(--ink)' : 'var(--muted)' }}>
                      {price != null ? formatIdr(price * l.qty) : '—'}
                    </div>
                  </div>
                );
              })}
            </div>

            {freight.length > 0 && (
              <div className="card" style={{ background: 'var(--tint)', borderColor: '#cddef2', padding: '18px 20px', marginTop: 16, display: 'flex', gap: 13 }}>
                <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#1f5aa8" strokeWidth="1.8" strokeLinecap="round" style={{ flex: 'none', marginTop: 1 }}>
                  <circle cx="12" cy="12" r="9" /><path d="M12 8h.01M11 12h1v4h1" />
                </svg>
                <div style={{ fontSize: 13.5, color: 'var(--body)', lineHeight: 1.55 }}>
                  <strong style={{ color: 'var(--ink)' }}>
                    {freight.length} item dikirim via ekspedisi{freightKg > 0 ? ` — total ${freightKg.toLocaleString('id-ID')} kg` : ''}.
                  </strong>{' '}
                  Panel, baterai rak, dan rail panjang tidak masuk kurir reguler. Ongkirnya dihitung
                  dari alamat dan volume, lalu dikirim sebagai penawaran resmi.
                </div>
              </div>
            )}

            {unpriced.length > 0 && (
              <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 14 }}>
                {unpriced.length} item belum berharga terbuka di katalog dan tidak masuk subtotal —
                harganya datang bersama penawaran.
              </p>
            )}
          </div>

          <div className="card" style={{ padding: 22, position: 'sticky', top: 96 }}>
            <div className="lab" style={{ color: 'var(--navy)', paddingBottom: 12, borderBottom: '3px solid var(--navy)' }}>RINGKASAN</div>
            <Row label="Subtotal barang berharga" value={formatIdr(subtotal)} />
            <Row label={`PPN ${PPN_PCT}%`} value={formatIdr(ppn)} />
            <Row label={`Ongkir kurir (${courier.length} item)`} value="dihitung dari alamat" muted />
            {freight.length > 0 && <Row label={`Ongkir ekspedisi (${freight.length} item)`} value="dikirim dalam penawaran" sun />}

            <div style={{ background: 'var(--navy)', color: '#fff', borderRadius: 10, padding: '15px 17px', marginTop: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
                <span style={{ fontSize: 13.5, color: '#cfe0f4' }}>Estimasi total</span>
                <span className="num" style={{ fontSize: 21, fontWeight: 800, letterSpacing: '-.5px' }}>{formatIdr(withPpn(subtotal))}</span>
              </div>
              <div style={{ fontSize: 11.5, color: '#a8c8e8', marginTop: 4 }}>belum termasuk ongkir</div>
            </div>

            <button className="btn btn-p" style={{ width: '100%', marginTop: 16 }} onClick={doCopy}>
              {copied ? '✓ Ringkasan disalin' : 'Salin ringkasan untuk WhatsApp'}
            </button>
            <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 11, lineHeight: 1.5 }}>
              Di versi sebenarnya tombol ini mengirim permintaan penawaran dan membuat draft
              Sales Quote di ICAPROC. Di demo ini belum ada yang ditulis ke database — ringkasannya
              disalin supaya bisa dikirim manual.
            </p>

            {courier.length > 0 && courierSubtotal > 0 && (
              <div style={{ borderTop: '1px solid var(--hair)', marginTop: 18, paddingTop: 16 }}>
                <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 8 }}>Hanya butuh barang kurir?</div>
                <div className="num" style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>
                  {courier.length} item · {formatIdr(courierSubtotal)}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </ShopShell>
  );
}

function Row({ label, value, muted, sun }: { label: string; value: string; muted?: boolean; sun?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--hair)', fontSize: 14 }}>
      <span style={{ color: 'var(--muted)' }}>{label}</span>
      <span className="num" style={{ fontWeight: 600, textAlign: 'right', color: sun ? 'var(--sun)' : muted ? 'var(--muted)' : 'var(--ink)', fontSize: muted || sun ? 12.5 : 14 }}>
        {value}
      </span>
    </div>
  );
}
