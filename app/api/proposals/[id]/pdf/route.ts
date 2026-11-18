/**
 * POST /api/proposals/:id/pdf — the proposal as a PDF file, made on the
 * server by the same engine as desktop Chrome, so every phone and computer
 * downloads the identical document under the desktop's file name (owner,
 * 2026-11-18). See lib/pdfRender.ts for how the page is rendered as the
 * caller.
 *
 * Request:  Authorization: Bearer <access_token>
 *           { session: { access_token, expires_at, expires_in, token_type, user },
 *             cols?: ExportCols, econ?: boolean }
 * Response: application/pdf, Content-Disposition attachment with the name.
 *
 * Only roles that may open the EPC proposals (the menu's own rule,
 * canOpenPath) get one; the page itself checks again, and RLS decides what
 * it can read.
 */
import { NextResponse } from 'next/server';
import { callerFromRequest, AgentAuthError } from '@/lib/agentApi';
import { ROLE_PERMISSIONS, type UserRole } from '@/constants/roles';
import { canOpenPath } from '@/constants/navigation';
import { launchBrowser, renderPdf, RenderError } from '@/lib/pdfRender';
import { pdfDisposition, supabaseStorageKey } from '@/lib/pdfFileName';
import { EXPORT_COL_KEYS } from '@/lib/exportCols';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (status: number, error: string) => NextResponse.json({ error }, { status });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return fail(400, 'Not a proposal id');

  let caller;
  try { caller = await callerFromRequest(request); }
  catch (e) { return e instanceof AgentAuthError ? fail(e.status, e.message) : fail(500, 'Sign-in check failed'); }
  const perms = ROLE_PERMISSIONS[caller.role as UserRole];
  if (!perms || !canOpenPath(perms, '/proposals')) return fail(403, 'Your role cannot open EPC proposals');

  const body = await request.json().catch(() => null) as {
    session?: { access_token?: string; expires_at?: number; expires_in?: number; token_type?: string; user?: unknown };
    cols?: Record<string, unknown>; econ?: unknown;
  } | null;
  const s = body?.session;
  const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!s?.access_token || s.access_token !== token || !s.user) return fail(400, 'Send the session that goes with the token');
  // The headless page must not refresh (see lib/pdfRender.ts), so the token
  // has to outlive the render with room to spare.
  if (!s.expires_at || s.expires_at * 1000 - Date.now() < 3 * 60_000) return fail(401, 'Your sign-in is about to expire — try again');

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return fail(500, 'Supabase is not configured on this deployment');
  const storage: Record<string, string> = {
    [supabaseStorageKey(url)]: JSON.stringify({
      access_token: s.access_token, token_type: s.token_type ?? 'bearer',
      expires_at: s.expires_at, expires_in: s.expires_in ?? 3600,
      refresh_token: 'pdf-render-no-refresh', user: s.user,
    }),
  };
  if (body?.cols && typeof body.cols === 'object') {
    const cols = Object.fromEntries(EXPORT_COL_KEYS.filter((k) => typeof body.cols![k] === 'boolean').map((k) => [k, body.cols![k]]));
    storage.quote_export_cols = JSON.stringify(cols);
  }

  const origin = new URL(request.url).origin;
  const page = `${origin}/proposals/${id}/print?pdf=1${typeof body?.econ === 'boolean' ? `&econ=${body.econ ? 1 : 0}` : ''}`;

  let browser;
  try {
    browser = await launchBrowser();
    const { pdf, title } = await renderPdf(browser, page, storage);
    return new Response(Buffer.from(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': pdfDisposition(title),
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    if (e instanceof RenderError) return fail(e.status, e.message);
    console.error('[proposal pdf]', e);
    return fail(500, 'The PDF could not be made. Try again, or use Print.');
  } finally {
    await browser?.close().catch(() => {});
  }
}
