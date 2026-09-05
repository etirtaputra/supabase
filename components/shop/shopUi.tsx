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
 * The design intention (owner, 2026-09-05, McMaster-Carr as the reference): a
 * CATALOGUE with a cart attached, for a technical person who wants what is
 * available, its specs, and its price, now. So: no hero, no messaging, an
 * index instead of a landing page, tables instead of cards, filters that are
 * the spec fields, small type and hairlines. What stays ICA's is the skin —
 * the steel blue and Rubik of the documents customers already receive.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  DEPARTMENTS, departmentOf, shopName, hasPrice, pricePerUnit, categoryLabel, familyOf,
  searchItems, formatIdr, formatIdrUnit,
} from '@/lib/shopCatalog';
import { useShopData, Thumb } from './useShopData';

export const SHOP_CSS = `
.shop{--navy:#1f5aa8;--navy-dk:#17457f;--tint:#eef4fb;--ink:#0f172a;--body:#334155;
 --muted:#64748b;--label:#94a3b8;--hair:#e8edf3;--line:#d9e0ea;--canvas:#f6f8fb;
 --sun:#c87a22;--sun-tint:#fdf3e6;--ok:#16a34a;
 background:#fff;color:var(--body);min-height:100vh;font-size:13px;line-height:1.45;
 font-family:var(--font-app,Rubik),Rubik,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.shop *{box-sizing:border-box}
.shop a{color:inherit;text-decoration:none}
.shop a.lnk{color:var(--navy)} .shop a.lnk:hover{text-decoration:underline}
.shop .wrap{max-width:1360px;margin:0 auto;padding:0 16px}
.shop .lab{font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:1.6px;color:var(--label)}
.shop .num{font-variant-numeric:tabular-nums}
.shop .mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px}
.shop .card{background:#fff;border:1px solid var(--line);border-radius:4px}
.shop .btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:32px;
 padding:0 12px;border-radius:4px;font-size:12.5px;font-weight:600;border:1px solid transparent;cursor:pointer;
 font-family:inherit;white-space:nowrap;transition:background .1s,border-color .1s}
.shop .btn-p{background:var(--navy);color:#fff}
.shop .btn-p:hover{background:var(--navy-dk)}
.shop .btn-p:disabled{opacity:.45;cursor:not-allowed}
.shop .btn-s{background:#fff;color:var(--navy);border-color:var(--line)}
.shop .btn-s:hover{border-color:var(--navy)}
.shop .chip{display:inline-flex;align-items:center;gap:5px;height:20px;padding:0 6px;border-radius:3px;
 font-size:10.5px;font-weight:600;white-space:nowrap}
.shop .ok{background:#eaf7ee;color:var(--ok)} .shop .fr{background:var(--sun-tint);color:var(--sun)}
.shop .h1{font-size:20px;line-height:1.2;font-weight:800;letter-spacing:-.4px;color:var(--ink)}
.shop .h2{font-size:15px;line-height:1.25;font-weight:700;color:var(--ink)}
.shop input,.shop select{font-family:inherit;font-size:13px;color:var(--ink);background:#fff;
 border:1px solid var(--line);border-radius:4px;height:32px;padding:0 9px;outline:none;width:100%}
.shop input:focus,.shop select:focus{border-color:var(--navy);box-shadow:0 0 0 2px rgba(31,90,168,.15)}
.shop input[type=checkbox]{width:14px;height:14px;accent-color:#1f5aa8;margin:0}
.shop .search{height:40px;font-size:14px;padding-left:36px}
.shop .navlink{font-size:12.5px;font-weight:500;color:var(--body);padding:7px 0;white-space:nowrap}
.shop .navlink:hover{color:var(--navy)}
.shop .navlink.on{color:var(--navy);font-weight:700;box-shadow:inset 0 -2px 0 var(--navy)}
.shop table{width:100%;border-collapse:collapse;font-size:12.5px}
.shop th{font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:1.4px;color:var(--label);
 text-align:left;padding:7px 8px;border-bottom:2px solid var(--navy);white-space:nowrap;background:#fff;
 position:sticky;top:0;z-index:1}
.shop th.r,.shop td.r{text-align:right}
.shop td{padding:6px 8px;border-bottom:1px solid var(--hair);vertical-align:middle;color:var(--body)}
.shop tbody tr:hover td{background:#fafcfe}
.shop .qty{display:inline-flex;align-items:center;border:1px solid var(--line);border-radius:4px;height:28px;background:#fff}
.shop .qty button{width:26px;height:26px;border:0;background:none;color:var(--muted);font-size:15px;cursor:pointer;font-family:inherit;line-height:1}
.shop .qty span{min-width:28px;text-align:center;font-weight:700;color:var(--ink);font-size:12.5px}
.shop .facet{padding:9px 0;border-bottom:1px solid var(--hair)}
.shop .facet .t{font-size:11.5px;font-weight:700;color:var(--ink);margin-bottom:5px}
.shop .facet label{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--body);padding:3px 0;cursor:pointer}
.shop .facet label .c{margin-left:auto;color:var(--label);font-size:11px}
.shop .demo{background:var(--sun-tint);border-bottom:1px solid #f0e0c6;color:#7a4d15;font-size:11px}
.shop .kv{display:flex;justify-content:space-between;gap:14px;padding:4px 0;border-bottom:1px solid var(--hair);font-size:12.5px}
.shop .kv span:first-child{color:var(--muted)}
.shop .kv span:last-child{color:var(--ink);font-weight:600;text-align:right}
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
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 4h2.2l2.3 11.2a1.6 1.6 0 0 0 1.6 1.3h8.2a1.6 1.6 0 0 0 1.6-1.2L21 8H6.2" />
        <circle cx="9.5" cy="20" r="1.3" /><circle cx="17.5" cy="20" r="1.3" />
      </svg>
      {n > 0 && (
        <span className="num" style={{ position: 'absolute', top: -7, right: -9, background: '#1f5aa8', color: '#fff', borderRadius: 20, padding: '0 5px', fontSize: 10, fontWeight: 700, lineHeight: '15px' }}>{n}</span>
      )}
    </span>
  );
}

/**
 * The search box: the primary way in.
 *
 * Suggestions come from the same `searchItems` the results page uses, over
 * the catalogue already in memory, so they are instant and never disagree
 * with the page Enter lands on. Arrow keys move, Enter opens the highlighted
 * item or, with none highlighted, the full results.
 */
export function SearchBox({ initial = '' }: { initial?: string }) {
  const router = useRouter();
  const { items } = useShopData();
  const [q, setQ] = useState(initial);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1);
  useEffect(() => { setQ(initial); }, [initial]);

  const hits = useMemo(() => (q.trim().length >= 2 ? searchItems(items, q).slice(0, 8) : []), [items, q]);

  const go = (i: number) => {
    const v = q.trim();
    if (i >= 0 && hits[i]) router.push(`/shop/p/${hits[i].component_id}`);
    else if (v) router.push(`/shop/search?q=${encodeURIComponent(v)}`);
    setOpen(false);
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); go(hi); }} style={{ position: 'relative', flex: 1, minWidth: 0 }}>
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.2" strokeLinecap="round"
        style={{ position: 'absolute', left: 11, top: 12, pointerEvents: 'none' }}>
        <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
      </svg>
      <input className="search" value={q} aria-label="Cari" autoComplete="off"
        placeholder="Cari nomor model, merek, atau spesifikasi — mis. 620wp, mppt 40a, 5kw 48v"
        onChange={(e) => { setQ(e.target.value); setOpen(true); setHi(-1); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHi((h) => Math.min(hits.length - 1, h + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(-1, h - 1)); }
          else if (e.key === 'Escape') { setOpen(false); }
        }} />
      {open && hits.length > 0 && (
        <div role="listbox" style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, background: '#fff', border: '1px solid var(--line)', borderRadius: 4, boxShadow: '0 10px 30px rgba(15,23,42,.14)', zIndex: 40, overflow: 'hidden' }}>
          {hits.map((h, i) => {
            const per = pricePerUnit(h);
            return (
              <div key={h.component_id} role="option" aria-selected={i === hi}
                onMouseDown={(e) => { e.preventDefault(); go(i); }} onMouseEnter={() => setHi(i)}
                style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '7px 12px', cursor: 'pointer', background: i === hi ? 'var(--tint)' : '#fff', borderTop: i ? '1px solid var(--hair)' : 'none' }}>
                <span style={{ width: 34, height: 26, background: 'var(--canvas)', borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
                  <Thumb dept={departmentOf(h.category)?.key ?? null} size={32} />
                </span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{shopName(h)}</span>
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>{categoryLabel(h.category)}{familyOf(h) ? ` · ${familyOf(h)!.label}` : ''}</span>
                </span>
                <span className="num" style={{ fontSize: 12.5, fontWeight: 700, color: hasPrice(h) ? 'var(--ink)' : 'var(--navy)', whiteSpace: 'nowrap', textAlign: 'right' }}>
                  {hasPrice(h) ? formatIdr(Number(h.selling_price_idr)) : 'penawaran'}
                  {per && <span style={{ display: 'block', fontWeight: 400, color: 'var(--muted)', fontSize: 11 }}>{formatIdrUnit(per.value)}/{per.unit}</span>}
                </span>
              </div>
            );
          })}
          <div onMouseDown={(e) => { e.preventDefault(); go(-1); }}
            style={{ padding: '7px 12px', fontSize: 12, color: 'var(--navy)', fontWeight: 600, borderTop: '1px solid var(--line)', background: 'var(--canvas)', cursor: 'pointer' }}>
            Semua hasil untuk “{q.trim()}” →
          </div>
        </div>
      )}
    </form>
  );
}

export function ShopShell({ dept, children, q }: { dept?: string; children: React.ReactNode; q?: string }) {
  const { count } = useCart();
  return (
    <div className="shop">
      <style>{SHOP_CSS}</style>

      <div className="demo">
        <div className="wrap" style={{ padding: '4px 16px', display: 'flex', gap: 10, justifyContent: 'space-between' }}>
          <span><strong>Demo</strong> — data langsung dari katalog ICAPROC; keranjang hanya di browser ini, belum ada pembayaran.</span>
          <Link href="/" style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>← ICAPROC</Link>
        </div>
      </div>

      <div style={{ borderBottom: '1px solid var(--line)', background: '#fff', position: 'sticky', top: 0, zIndex: 20 }}>
        <div className="wrap" style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '10px 16px' }}>
          <Link href="/shop" style={{ flex: 'none', lineHeight: 1 }}>
            <span style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-.8px', color: 'var(--navy)' }}>ICA<span style={{ color: 'var(--ink)' }}>SOLAR</span></span>
          </Link>
          <SearchBox initial={q} />
          <Link href="/shop/compare" className="navlink hidesm" style={{ fontWeight: 600, padding: 0 }}>Bandingkan</Link>
          <Link href="/shop/cart" style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--body)', fontSize: 12.5, fontWeight: 600, minHeight: 32 }}>
            <CartIcon n={count} /><span className="hidesm">Keranjang</span>
          </Link>
        </div>
        <div className="wrap" style={{ padding: '0 16px' }}>
          <div style={{ display: 'flex', gap: 18, overflowX: 'auto' }}>
            {DEPARTMENTS.map((d) => (
              <Link key={d.key} href={`/shop/c/${d.key}`} className={`navlink${dept === d.key ? ' on' : ''}`}>{d.label}</Link>
            ))}
          </div>
        </div>
      </div>

      {children}

      <div style={{ borderTop: '1px solid var(--line)', marginTop: 40, fontSize: 11.5, color: 'var(--muted)' }}>
        <div className="wrap" style={{ padding: '14px 16px', display: 'flex', flexWrap: 'wrap', gap: '6px 24px', justifyContent: 'space-between' }}>
          <span>PT Indodaya Surya Lestari · [ALAMAT] · NPWP [NOMOR]</span>
          <span>Harga belum termasuk PPN 11% · faktur pajak untuk badan usaha · <Link href="/shop/cart" className="lnk">penawaran proyek / EPC</Link></span>
        </div>
      </div>
    </div>
  );
}

/** Money, always in the shop's own format. */
export const Rp = ({ n }: { n: number }) => <span className="num">{formatIdr(n)}</span>;
