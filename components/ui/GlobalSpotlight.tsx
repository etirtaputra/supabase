'use client';
import { usePathname } from 'next/navigation';
import CommandPalette from './CommandPalette';

/**
 * App-wide Spotlight mount (root layout): ⌘/Ctrl+I and the search pill work on
 * every module page. CommandPalette itself scopes the index to the signed-in
 * role and renders nothing while logged out.
 * Skipped on: the dashboard (it embeds the inline hero variant — mounting the
 * modal too would double the ⌘I handler), login/unauthorized, and the
 * customer-facing print surfaces (quote/invoice/Surat Jalan).
 */
export default function GlobalSpotlight() {
  const pathname = usePathname();
  if (
    pathname === '/' ||
    pathname === '/login' ||
    pathname === '/unauthorized' ||
    pathname.endsWith('/print') ||
    pathname.endsWith('/do')
  ) return null;
  // The EPC editor has a fixed full-width bottom action bar (totals + save)
  // at z-40 that would cover the z-30 pill — lift the pill above it there.
  const raisedPill = /^\/proposals\/(?!library$)[^/]+$/.test(pathname);
  return <CommandPalette raisedPill={raisedPill} />;
}
