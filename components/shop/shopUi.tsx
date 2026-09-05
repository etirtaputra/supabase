'use client';
/**
 * The storefront's shell and shared pieces.
 *
 * This whole folder, plus `app/shop/**` and `lib/shopCatalog.ts`, is the
 * portable part: it reads the catalogue through Supabase and the spec schema,
 * and nothing else of ICAPROC. Lifting the shop onto its own host is a folder
 * move, not a rewrite — which is why the styling lives in one CSS block here
 * rather than leaning on the ERP's Tailwind theme.
 *
 * The look extends what ICA's customers already receive: the steel blue,
 * Rubik, wide-tracked micro-labels and hairline rules of the quotes and
 * proposals — so the site and the PDF read as one company.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { DEPARTMENTS, formatIdr } from '@/lib/shopCatalog';

export const SHOP_CSS = `
.shop{--navy:#1f5aa8;--navy-dk:#17457f;--tint:#eef4fb;--ink:#0f172a;--body:#334155;
 --muted:#64748b;--label:#94a3b8;--hair:#e8edf3;--line:#e2e8f0;--canvas:#f6f8fb;
 --sun:#c87a22;--sun-tint:#fdf3e6;--ok:#16a34a;
 background:#fff;color:var(--body);min-height:100vh;font-size:15px;line-height:1.55;
 font-family:var(--font-app,Rubik),Rubik,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.shop *{box-sizing:border-box}
.shop a{color:inherit;text-decoration:none}
.shop .wrap{max-width:1280px;margin:0 auto;padding:0 20px}
.shop .lab{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:var(--label)}
.shop .num{font-variant-numeric:tabular-nums}
.shop .card{background:#fff;border:1px solid var(--line);border-radius:14px}
.shop .btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;
 padding:0 20px;border-radius:10px;font-size:15px;font-weight:600;border:1px solid transparent;cursor:pointer;
 font-family:inherit;transition:background .12s,border-color .12s,color .12s}
.shop .btn-p{background:var(--navy);color:#fff}
.shop .btn-p:hover{background:var(--navy-dk)}
.shop .btn-p:disabled{opacity:.45;cursor:not-allowed}
.shop .btn-s{background:#fff;color:var(--navy);border-color:var(--line)}
.shop .btn-s:hover{border-color:var(--navy)}
.shop .chip{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 9px;border-radius:6px;
 font-size:11px;font-weight:600}
.shop .h1{font-size:clamp(30px,4.6vw,50px);line-height:1.07;font-weight:800;letter-spacing:-1.3px;color:var(--ink);text-wrap:balance}
.shop .h2{font-size:clamp(22px,2.6vw,30px);line-height:1.15;font-weight:800;letter-spacing:-.7px;color:var(--ink)}
.shop .h3{font-size:18px;line-height:1.28;font-weight:700;letter-spacing:-.3px;color:var(--ink)}
.shop .grid{display:grid;gap:16px}
.shop .prod{display:flex;flex-direction:column;overflow:hidden;transition:border-color .12s,box-shadow .12s}
.shop .prod:hover{border-color:#bcd3ec;box-shadow:0 6px 20px rgba(15,23,42,.07)}
.shop .thumb{background:var(--canvas);border-bottom:1px solid var(--line);height:150px;
 display:flex;align-items:center;justify-content:center;position:relative}
.shop input,.shop select{font-family:inherit;font-size:14px;color:var(--ink);background:#fff;
 border:1px solid var(--line);border-radius:10px;height:44px;padding:0 12px;outline:none;width:100%}
.shop input:focus,.shop select:focus{border-color:var(--navy);box-shadow:0 0 0 3px rgba(31,90,168,.12)}
.shop .navlink{padding:10px 0;font-size:14px;font-weight:500;color:var(--body);white-space:nowrap}
.shop .navlink:hover{color:var(--navy)}
.shop .navlink.on{color:var(--navy);font-weight:600;box-shadow:inset 0 -2.5px 0 var(--navy)}
.shop table{width:100%;border-collapse:collapse}
.shop .demo{background:var(--sun-tint);border-bottom:1px solid #f0e0c6;color:#7a4d15;font-size:12.5px}
@media (max-width:820px){.shop .hidesm{display:none}}
`;

// ── Cart (localStorage; a demo has no server-side basket) ───────────────────
const CART_KEY = 'ica_shop_cart_v1';
const CART_EVENT = 'ica-shop-cart';

export type Cart = Record<string, number>;

export function readCart(): Cart {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(CART_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Cart = {};
    for (const [k, v] of Object.entries(parsed)) {
      const n = Math.floor(Number(v));
      if (Number.isFinite(n) && n > 0) out[k] = n;
    }
    return out;
  } catch { return {}; }
}

function writeCart(c: Cart) {
  try { window.localStorage.setItem(CART_KEY, JSON.stringify(c)); } catch { /* private mode */ }
  window.dispatchEvent(new Event(CART_EVENT));
}

/** One cart, shared by every shop screen through a window event. */
export function useCart() {
  const [cart, setCart] = useState<Cart>({});
  useEffect(() => {
    setCart(readCart());
    const sync = () => setCart(readCart());
    window.addEventListener(CART_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener(CART_EVENT, sync); window.removeEventListener('storage', sync); };
  }, []);
  const setQty = useCallback((id: string, qty: number) => {
    const next = { ...readCart() };
    if (qty > 0) next[id] = Math.floor(qty); else delete next[id];
    writeCart(next);
  }, []);
  const add = useCallback((id: string, qty = 1) => {
    const next = { ...readCart() };
    next[id] = (next[id] ?? 0) + qty;
    writeCart(next);
  }, []);
  const clear = useCallback(() => writeCart({}), []);
  const count = useMemo(() => Object.values(cart).reduce((s, n) => s + n, 0), [cart]);
  return { cart, add, setQty, clear, count };
}

// ── Chrome ─────────────────────────────────────────────────────────────────
export function CartIcon({ n }: { n: number }) {
  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 4h2.2l2.3 11.2a1.6 1.6 0 0 0 1.6 1.3h8.2a1.6 1.6 0 0 0 1.6-1.2L21 8H6.2" />
        <circle cx="9.5" cy="20" r="1.3" /><circle cx="17.5" cy="20" r="1.3" />
      </svg>
      {n > 0 && (
        <span className="num" style={{ position: 'absolute', top: -6, right: -9, background: '#1f5aa8', color: '#fff', borderRadius: 20, padding: '0 5px', fontSize: 10, fontWeight: 700, lineHeight: '15px' }}>{n}</span>
      )}
    </span>
  );
}

export function ShopShell({ dept, children }: { dept?: string; children: React.ReactNode }) {
  const { count } = useCart();
  return (
    <div className="shop">
      <style>{SHOP_CSS}</style>

      {/* This is a demo living inside ICAPROC — say so, always. */}
      <div className="demo">
        <div className="wrap" style={{ padding: '7px 20px', display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
          <span><strong>Demo toko</strong> — data langsung dari katalog ICAPROC. Belum ada pembayaran; keranjang tersimpan di browser ini saja.</span>
          <Link href="/" style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>← Kembali ke ICAPROC</Link>
        </div>
      </div>

      <div style={{ borderBottom: '1px solid var(--line)', position: 'sticky', top: 0, background: '#fff', zIndex: 20 }}>
        <div className="wrap" style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '14px 20px' }}>
          <Link href="/shop" style={{ display: 'flex', flexDirection: 'column', flex: 'none' }}>
            <span style={{ fontSize: 23, fontWeight: 800, letterSpacing: '-1px', color: 'var(--navy)', lineHeight: 1 }}>
              ICA<span style={{ color: 'var(--ink)' }}>SOLAR</span>
            </span>
            <span className="lab hidesm" style={{ fontSize: 8, letterSpacing: '2.4px', marginTop: 2 }}>PT INDODAYA SURYA LESTARI</span>
          </Link>
          <div style={{ flex: 1 }} />
          <Link href="/shop/compare" className="navlink hidesm" style={{ fontWeight: 600 }}>Bandingkan</Link>
          <Link href="/shop/cart" style={{ display: 'flex', alignItems: 'center', gap: 9, color: 'var(--body)', fontSize: 14, fontWeight: 500, minHeight: 44 }}>
            <CartIcon n={count} /><span className="hidesm">Keranjang</span>
          </Link>
        </div>
        <div className="wrap" style={{ padding: '0 20px' }}>
          <div style={{ display: 'flex', gap: 20, overflowX: 'auto' }}>
            {DEPARTMENTS.map((d) => (
              <Link key={d.key} href={`/shop/c/${d.key}`} className={`navlink${dept === d.key ? ' on' : ''}`}>{d.label}</Link>
            ))}
          </div>
        </div>
      </div>

      {children}

      <div style={{ background: 'var(--ink)', color: '#94a3b8', fontSize: 13.5, marginTop: 60 }}>
        <div className="wrap" style={{ padding: '36px 20px', display: 'flex', flexWrap: 'wrap', gap: 30, justifyContent: 'space-between' }}>
          <div>
            <span style={{ fontSize: 21, fontWeight: 800, letterSpacing: '-1px', color: '#fff' }}>ICA<span style={{ color: '#7aa8dd' }}>SOLAR</span></span>
            <p style={{ marginTop: 10, lineHeight: 1.6 }}>PT Indodaya Surya Lestari<br />[ALAMAT] · NPWP [NOMOR]</p>
          </div>
          <div style={{ textAlign: 'right', lineHeight: 1.7 }}>
            Harga belum termasuk PPN 11%<br />Faktur pajak untuk badan usaha
          </div>
        </div>
      </div>
    </div>
  );
}

/** Money, always in the shop's own format. */
export const Rp = ({ n }: { n: number }) => <span className="num">{formatIdr(n)}</span>;
