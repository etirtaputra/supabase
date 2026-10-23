/**
 * The scheduler's credential. A Vercel Cron job is not a person, so it cannot
 * pass `callerFromRequest`; instead Vercel sends `Authorization: Bearer
 * <CRON_SECRET>`, the secret set on the project. FAIL CLOSED: with no secret
 * configured, nobody gets in — an unset variable must never mean "open".
 * Sanctioned in lib/apiAuth.test.ts alongside callerFromRequest.
 */
export function verifyCronSecret(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return false;
  return request.headers.get('authorization') === `Bearer ${secret}`;
}
