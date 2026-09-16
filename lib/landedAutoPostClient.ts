/**
 * The browser half of auto-posting a landed-cost true-up.
 *
 * A screen that writes a payment row calls this with the PO it touched, and
 * the ledger catches up by itself. The decision — post or hold — is NOT made
 * here; it lives in `/api/landed/autopost`, which runs the same
 * `autoPostVerdict` the reconcile screen shows. One rule, one home.
 *
 * IT NEVER THROWS AND NEVER BLOCKS A SAVE. The payment is the user's actual
 * intent and it is already committed by the time this runs; a true-up that
 * cannot post is a thing to mention, never a reason to make a successful save
 * look failed. Anything unexpected resolves to `null` and the screen says
 * nothing — the reconcile board still holds the PO, so no correction is lost,
 * only deferred to where it always used to live.
 */
import { createSupabaseClient } from '@/lib/supabase';
import { fmtIdr } from '@/lib/formatters';

export interface AutoPostOutcome {
  posted: boolean;
  outcome: 'posted' | 'held' | 'already_current' | 'failed';
  poNumber?: string;
  holdLabel?: string;
  note?: string;
  inventoryDelta?: number;
  cogsDelta?: number;
}

/** Ask the server to true this PO up if its bills have gone final. */
export async function autoPostTrueUp(poId: string | number): Promise<AutoPostOutcome | null> {
  try {
    const supabase = createSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return null;

    const res = await fetch('/api/landed/autopost', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ po_id: String(poId) }),
    });
    const j = await res.json().catch(() => null);
    if (!j) return null;

    return {
      posted: !!j.posted,
      outcome: j.outcome ?? 'failed',
      poNumber: j.po_number,
      holdLabel: j.hold_label,
      note: j.note ?? j.error,
      inventoryDelta: j.inventory_delta_idr,
      cogsDelta: j.cogs_delta_idr,
    };
  } catch {
    return null;
  }
}

/**
 * What to tell the person who just entered the payment — or null when there is
 * nothing worth saying.
 *
 * `already_current` is deliberately silent. It is the outcome on almost every
 * payment (a down payment, a bank fee, a PO whose correction is immaterial),
 * and a toast reading "nothing to do" after every save would train the eye to
 * skip the toast that matters.
 */
export function autoPostMessage(r: AutoPostOutcome | null): { text: string; tone: 'success' | 'info' } | null {
  if (!r) return null;
  if (r.outcome === 'posted') {
    const sold = Math.abs(r.cogsDelta ?? 0) >= 1000
      ? `, ${fmtIdr(r.cogsDelta!)} relates to units already sold`
      : '';
    return {
      // Name the PO and the number: this happened without being asked for, so
      // it has to be legible after the fact.
      text: `Landed cost trued up · ${r.poNumber} · ${fmtIdr(r.inventoryDelta ?? 0)} into stock value${sold}`,
      tone: 'success',
    };
  }
  if (r.outcome === 'held') {
    return { text: `${r.poNumber} needs a look before truing up — ${r.holdLabel}. Open Landed Cost.`, tone: 'info' };
  }
  if (r.outcome === 'failed') {
    return { text: `Landed cost could not be trued up automatically — ${r.note ?? 'unknown error'}`, tone: 'info' };
  }
  return null;
}

/**
 * Clear whatever the trigger has queued — POs whose bills went final by ANY
 * path, including an agent writing `6.0_po_costs` straight over PostgREST.
 *
 * Called on load by the two buy-side screens. That is the deliberate design and
 * worth being plain about: there is no cron on this deployment (Vercel Hobby),
 * so "server-side" means the decision and the arithmetic moved off the screen —
 * into a database trigger and one endpoint — not that a daemon runs it. Any
 * buy-side visit drains the queue, and until someone visits, the debt is
 * RECORDED rather than lost, which is the part that was missing before.
 *
 * Silent unless something actually posted: a drain that finds an empty queue is
 * the normal case on almost every page load.
 */
export async function drainTrueUpQueue(): Promise<{ posted: number; held: number; postedIdr: number } | null> {
  try {
    const supabase = createSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return null;

    const res = await fetch('/api/landed/autopost', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({}),          // no po_id = drain
    });
    const j = await res.json().catch(() => null);
    if (!j || !j.posted) return null;
    return { posted: j.posted ?? 0, held: j.held ?? 0, postedIdr: j.posted_idr ?? 0 };
  } catch {
    return null;
  }
}

/** What to say after a drain — null when nothing posted. */
export function drainMessage(r: { posted: number; held: number; postedIdr: number } | null): string | null {
  if (!r || r.posted <= 0) return null;
  // Name the number: this happened without anyone asking, so it has to be
  // legible after the fact.
  return `Landed cost caught up — ${r.posted} PO${r.posted === 1 ? '' : 's'} trued up, ${fmtIdr(r.postedIdr)} into stock value`
    + (r.held > 0 ? ` · ${r.held} need a look` : '');
}
