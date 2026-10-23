import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { parseBcaKurs, decideFollow, BCA_CODES } from '@/lib/bcaRate';
import { currentBenchmarks, type FxBenchmark } from '@/lib/fxBenchmark';
import { verifyCronSecret } from '@/lib/cronAuth';

/**
 * GET /api/cron/fx-benchmark — the morning check against KlikBCA e-Rate.
 *
 * Owner, 2026-10-24: "use BCA e-Rate, warn above 1.5% … round up to the
 * nearest hundreds digit … Check daily every morning. and update itself."
 * Run by Vercel Cron (vercel.json) every morning, Jakarta time.
 *
 *   1. Read the KlikBCA rate page and take the e-Rate SELL for USD and CNH
 *      (lib/bcaRate.ts parseBcaKurs). A figure outside a sane band is
 *      refused — a misread page must never become the company rate.
 *   2. Record it in 9.2_fx_reference_rates — one row per currency per day.
 *   3. Where the rounded-up e-Rate is more than 1.5% from the company rate in
 *      force (or there is none yet), add a new company rate to
 *      9.1_fx_benchmark_rates, marked source 'bca-erate'. It is a new row
 *      like any other: the log shows it, and it only affects new POs.
 *
 * Runs once per Jakarta day: a second call the same day changes nothing.
 * Only the scheduler may call it: Vercel Cron sends CRON_SECRET as a Bearer
 * token (lib/cronAuth.ts), and with no secret configured the route refuses
 * everyone. `?dry=1` reads the page and answers what it found, writing nothing.
 */
export const dynamic = 'force-dynamic';

const BCA_URL = 'https://www.bca.co.id/id/informasi/kurs';
const SOURCE = 'KlikBCA e-Rate';
const AUTHOR = 'KlikBCA e-Rate (otomatis)';
const id = (n: number) => n.toLocaleString('id-ID');
const jakartaDay = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);

export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const dry = new URL(request.url).searchParams.get('dry') === '1';

  let html: string;
  try {
    const res = await fetch(BCA_URL, {
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'accept-language': 'id-ID,id;q=0.9,en;q=0.8',
        accept: 'text/html',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return NextResponse.json({ error: `KlikBCA answered ${res.status}` }, { status: 502 });
    html = await res.text();
  } catch (e) {
    return NextResponse.json({ error: `KlikBCA could not be read: ${(e as Error).message}` }, { status: 502 });
  }

  const page = parseBcaKurs(html);
  const found = Object.keys(BCA_CODES).filter((c) => page.rates[c]);
  if (dry) {
    return NextResponse.json({
      source: SOURCE, quoted_at: page.quotedAt, page_bytes: html.length,
      rates: Object.fromEntries(found.map((c) => [c, { ...page.rates[c], rounded_up: decideFollow(c, page.rates[c].sell, null).target }])),
      missing: Object.keys(BCA_CODES).filter((c) => !page.rates[c]),
    });
  }
  if (!found.length) return NextResponse.json({ error: 'No e-Rate found on the KlikBCA page.' }, { status: 502 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Server is not configured.' }, { status: 500 });
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const day = jakartaDay();
  const { data: done, error: doneErr } = await db.from('9.2_fx_reference_rates')
    .select('reference_id').eq('rate_date', day).eq('source', SOURCE).limit(1);
  if (doneErr) return NextResponse.json({ error: doneErr.message }, { status: 500 });
  if (done?.length) return NextResponse.json({ day, checked: false, reason: 'already checked today' });

  const { error: refErr } = await db.from('9.2_fx_reference_rates').insert(found.map((c) => ({
    rate_date: day, currency: c, source: SOURCE, buy: page.rates[c].buy, sell: page.rates[c].sell, quoted_at: page.quotedAt,
  })));
  if (refErr) return NextResponse.json({ error: refErr.message }, { status: 500 });

  const { data: rows, error: bmErr } = await db.from('9.1_fx_benchmark_rates').select('benchmark_id, currency, rate, set_at');
  if (bmErr) return NextResponse.json({ error: bmErr.message }, { status: 500 });
  const current = currentBenchmarks((rows ?? []) as FxBenchmark[]);

  const updated: string[] = [];
  for (const c of found) {
    const now = current.get(c);
    const d = decideFollow(c, page.rates[c].sell, now ? Number(now.rate) : null);
    if (!d.update) continue;
    const was = d.current != null
      ? `; sebelumnya ${id(d.current)} (${d.changePct! > 0 ? '+' : ''}${d.changePct!.toFixed(1).replace('.', ',')}%)` : '';
    const { error } = await db.from('9.1_fx_benchmark_rates').insert({
      currency: c, rate: d.target, source: 'bca-erate', set_by_email: AUTHOR,
      note: `Otomatis: ${SOURCE} jual ${id(d.sell)}${page.quotedAt ? ` (${page.quotedAt})` : ''}, dibulatkan ke atas ${id(d.target)}${was}`,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    updated.push(c);
  }
  return NextResponse.json({ day, checked: true, updated });
}
