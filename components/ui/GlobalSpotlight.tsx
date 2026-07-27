'use client';
import { usePathname } from 'next/navigation';
import CommandPalette from './CommandPalette';

/**
 * App-wide Spotlight mount (root layout): ⌘/Ctrl+I and the nav-bar search
 * trigger work on every module page. CommandPalette itself scopes the index to
 * the signed-in role and renders nothing while logged out — and nothing at all
 * when closed, since the affordance now lives in BrandMenu.
 *
 * Mounted on every signed-in page, the dashboard included — the dashboard's
 * inline hero is gone, so there is exactly one palette and one ⌘I handler.
 * Skipped on: login/unauthorized, and the customer-facing print surfaces
 * (quote/invoice/Surat Jalan).
 */
export default function GlobalSpotlight() {
  const pathname = usePathname();
  if (
    pathname === '/login' ||
    pathname === '/unauthorized' ||
    pathname.endsWith('/print') ||
    pathname.endsWith('/do')
  ) return null;
  return <CommandPalette />;
}
