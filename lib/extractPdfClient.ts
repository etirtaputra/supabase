/**
 * Send a supplier PDF to `/api/extract-pdf` — with the caller's identity.
 *
 * One home, because there are two call sites (the purchasing PDF upload and
 * the batch line-items form) and the route now refuses a request that does not
 * say who is asking. A second call site that forgot the header would look like
 * a broken upload, and the obvious "fix" under time pressure is to reopen the
 * endpoint.
 */
import { createSupabaseClient } from '@/lib/supabase';

export class ExtractPdfError extends Error {}

/** Parse a supplier quote / PI / PO. Throws with a readable message. */
export async function extractPdf(file: File): Promise<Record<string, unknown>> {
  const supabase = createSupabaseClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new ExtractPdfError('Your session has expired — sign in again to read a PDF.');
  }

  const formData = new FormData();
  formData.append('pdf', file);

  const res = await fetch('/api/extract-pdf', {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}` },
    body: formData,
  });

  if (!res.ok) {
    // Surface the route's own sentence (role refusal, file too large) rather
    // than a generic failure — those two are things the user can act on.
    const j = await res.json().catch(() => null);
    throw new ExtractPdfError(j?.error || 'Failed to extract PDF data');
  }
  return res.json();
}
