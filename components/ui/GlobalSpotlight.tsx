'use client';
import { usePathname } from 'next/navigation';
import CommandPalette from './CommandPalette';
import { useIsDesktop } from '@/hooks/useIsDesktop';

/**
 * The PHONE presentation of Spotlight (root layout): a full overlay, opened by
 * the magnifier in the nav bar. On wide screens the nav bar renders the inline
 * field instead and owns ⌘I, so this instance stands down — `hotkey` is what
 * hands the shortcut to exactly one of them.
 *
 * It still mounts on desktop (harmless: it renders nothing while closed and
 * never opens) so that resizing a window across the breakpoint doesn't need to
 * remount anything.
 *
 * Skipped on: login/unauthorized, and the customer-facing print surfaces
 * (quote/invoice/Surat Jalan).
 */
export default function GlobalSpotlight() {
  const pathname = usePathname();
  const isDesktop = useIsDesktop();
  if (
    pathname === '/login' ||
    pathname === '/unauthorized' ||
    pathname.endsWith('/print') ||
    pathname.endsWith('/do')
  ) return null;
  return <CommandPalette hotkey={!isDesktop} />;
}
