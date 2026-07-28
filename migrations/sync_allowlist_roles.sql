-- ── Sync allowlist roles with the accounts that exist ────────────────────────
--
-- Settings › Users used to change user_profiles.role WITHOUT writing the same
-- role back to allowed_emails, so an allowlist row kept its invite-time role
-- forever and the two panels on the Users tab disagreed (e.g. an account
-- promoted to Project Engineer still showed "Data Entry (legacy)" below).
-- The allowlist role only matters at first sign-up, so access was never
-- wrong — but a screen that contradicts itself cannot be trusted.
--
-- The UI now keeps both rows in step on every role change (both directions);
-- this one-time heal aligns the rows that had already drifted. The ACCOUNT is
-- the truth: it is what the app enforces today.
--
-- Idempotent: re-running updates nothing once the rows agree.

UPDATE allowed_emails a
SET role = p.role
FROM user_profiles p
WHERE lower(p.email) = lower(a.email)
  AND a.role IS DISTINCT FROM p.role;
