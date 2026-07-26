'use client';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { buildQuoteMessage, shareOrCopy, type QuoteLine } from '@/lib/whatsappQuote';
import { fmtRupiah } from '@/lib/formatters';

/**
 * The WhatsApp quote basket: pick products while scrolling, then send them in
 * ONE message instead of copying a price, pasting, going back, copying the
 * next.
 *
 * Two pieces: a bar that only exists while something is picked, and a sheet
 * that shows what will be sent — quantities adjustable, live preview of the
 * exact text, then Share (the phone's share sheet, which is the direct path
 * into WhatsApp) or Copy.
 *
 * Both are portaled to <body>: page headers use backdrop-blur, which WebKit
 * treats as a containing block for fixed descendants, so a fixed bar rendered
 * in place would pin to the header instead of the viewport.
 */

export interface BasketItem extends QuoteLine { id: string }

export function useQuoteBasket(storeKey = 'icaproc.quotebasket') {
  const [items, setItems] = useState<BasketItem[]>([]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storeKey);
      const arr = raw ? JSON.parse(raw) : [];
      if (Array.isArray(arr)) setItems(arr.filter((i) => i && typeof i.id === 'string'));
    } catch { /* private mode */ }
  }, [storeKey]);

  const persist = (next: BasketItem[]) => {
    setItems(next);
    try { window.localStorage.setItem(storeKey, JSON.stringify(next)); } catch { /* private mode */ }
  };

  return {
    items,
    has: (id: string) => items.some((i) => i.id === id),
    /** Adding the same product twice bumps its quantity rather than duplicating. */
    toggle: (item: BasketItem) => {
      const at = items.findIndex((i) => i.id === item.id);
      persist(at >= 0 ? items.filter((i) => i.id !== item.id) : [...items, item]);
    },
    setQty: (id: string, qty: number) =>
      persist(items.map((i) => (i.id === id ? { ...i, qty: Math.max(1, Math.round(qty) || 1) } : i))),
    remove: (id: string) => persist(items.filter((i) => i.id !== id)),
    clear: () => persist([]),
  };
}

export default function QuoteBasket({
  items, onSetQty, onRemove, onClear, flash,
}: {
  items: BasketItem[];
  onSetQty: (id: string, qty: number) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  flash: (m: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [withTotal, setWithTotal] = useState(true);
  const [mounted, setMounted] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const message = useMemo(() => buildQuoteMessage(items, { withTotal }), [items, withTotal]);
  const total = useMemo(() => items.reduce((s, i) => s + i.price * Math.max(1, i.qty), 0), [items]);

  const send = async () => {
    setBusy(true);
    const how = await shareOrCopy(message);
    setBusy(false);
    if (how === 'failed') { flash('Could not copy — long-press the preview to select it'); return; }
    flash(how === 'shared' ? 'Shared' : `Copied ${items.length} item${items.length !== 1 ? 's' : ''} — paste into WhatsApp`);
    setOpen(false);
  };

  if (!mounted || items.length === 0) return null;

  // Clears the mobile bottom tab bar; sits at the normal margin on desktop
  const bar = (
    <div className="fixed inset-x-0 z-[115] px-3 pointer-events-none bottom-[calc(env(safe-area-inset-bottom)+66px)] md:bottom-6">
      <div className="mx-auto max-w-md pointer-events-auto flex items-center gap-2 rounded-2xl bg-emerald-600 shadow-2xl shadow-black/40 px-3 py-2">
        <button onClick={() => setOpen(true)} className="flex-1 text-left min-w-0">
          <span className="block text-white text-sm font-bold truncate">
            {items.length} item{items.length !== 1 ? 's' : ''} · {fmtRupiah(total)}
          </span>
          <span className="block text-emerald-100/80 text-[11px]">Tap to review the WhatsApp quote</span>
        </button>
        <button onClick={send} disabled={busy}
          className="flex-shrink-0 px-3 py-2 rounded-xl bg-white/15 hover:bg-white/25 text-white text-xs font-bold transition-colors disabled:opacity-50">
          {busy ? '…' : 'Send'}
        </button>
        <button onClick={onClear} title="Clear the list"
          className="flex-shrink-0 w-8 h-8 rounded-xl text-white/70 hover:text-white hover:bg-white/15 transition-colors">×</button>
      </div>
    </div>
  );

  const sheet = open && (
    <div className="fixed inset-0 z-[140] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
      <div className="relative w-full sm:max-w-lg bg-slate-900 border-t sm:border border-slate-700 sm:rounded-2xl rounded-t-2xl shadow-2xl max-h-[88vh] flex flex-col"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-white">WhatsApp quote</h2>
            <p className="text-[11px] text-slate-500">{items.length} item{items.length !== 1 ? 's' : ''} · {fmtRupiah(total)}</p>
          </div>
          <button onClick={() => setOpen(false)} className="text-slate-500 hover:text-white text-lg leading-none px-2">×</button>
        </div>

        <div className="overflow-y-auto divide-y divide-slate-800/60">
          {items.map((i) => (
            <div key={i.id} className="px-4 py-2.5 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-slate-100 truncate">{i.name}</p>
                <p className="text-[11px] text-slate-500 tabular-nums">
                  {fmtRupiah(i.price)}{i.tier ? ` · ${i.tier}` : ''}
                  {i.qty > 1 && <span className="text-slate-400"> → {fmtRupiah(i.price * i.qty)}</span>}
                </p>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button onClick={() => onSetQty(i.id, i.qty - 1)} disabled={i.qty <= 1}
                  className="w-7 h-7 rounded-lg bg-slate-800 text-slate-300 disabled:opacity-30 hover:bg-slate-700 transition-colors">−</button>
                <input value={i.qty} inputMode="numeric"
                  onChange={(e) => onSetQty(i.id, Number(e.target.value.replace(/\D/g, '')) || 1)}
                  className="w-10 h-7 text-center bg-slate-950 border border-slate-700 rounded-lg text-xs text-white tabular-nums focus:outline-none focus:border-emerald-500/60" />
                <button onClick={() => onSetQty(i.id, i.qty + 1)}
                  className="w-7 h-7 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors">+</button>
              </div>
              <button onClick={() => onRemove(i.id)} title="Remove"
                className="flex-shrink-0 text-slate-600 hover:text-rose-400 transition-colors px-1">×</button>
            </div>
          ))}
        </div>

        <div className="px-4 py-3 border-t border-slate-800 space-y-2.5">
          <label className="flex items-center gap-2 text-[11px] text-slate-400 cursor-pointer select-none">
            <input type="checkbox" checked={withTotal} onChange={(e) => setWithTotal(e.target.checked)} className="accent-emerald-500 w-3.5 h-3.5" />
            Include the total and the PPN note
          </label>
          {/* Exactly what will be sent — no surprises after pasting */}
          <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-[11px] text-slate-300 leading-relaxed font-sans">{message}</pre>
          <div className="flex items-center gap-2">
            <button onClick={onClear} className="text-[11px] text-slate-500 hover:text-white px-2 py-2 transition-colors">Clear all</button>
            <button onClick={send} disabled={busy}
              className="ml-auto px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold transition-colors disabled:opacity-50">
              {busy ? 'Preparing…' : 'Share / Copy'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(<>{bar}{sheet}</>, document.body);
}
