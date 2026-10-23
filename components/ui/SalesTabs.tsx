'use client';
import Link from 'next/link';
import { useT } from '@/hooks/useT';
import { useAuth } from '@/hooks/useAuth';
import { ROLE_PERMISSIONS } from '@/constants/roles';
import { canOpenPath } from '@/constants/navigation';

/**
 * Sales Orders · Invoices · Delivery · Serial Numbers · After Sales — one menu
 * entry, five views (owner, 2026-10-23: the Sales menu cut to four entries).
 * Each tab is the screen it always was, one click from the orders.
 *
 * A role sees only the tabs it may open, and no tab row at all when that is a
 * single screen — the warehouse on Delivery has nowhere to switch to.
 */
export type SalesTab = 'orders' | 'invoices' | 'delivery' | 'serials' | 'aftersales';
const TABS: { key: SalesTab; href: string; label: string }[] = [
  { key: 'orders', href: '/sales', label: 'Sales Orders' },
  { key: 'invoices', href: '/invoices', label: 'Invoices' },
  { key: 'delivery', href: '/delivery', label: 'Delivery' },
  { key: 'serials', href: '/serials', label: 'Serial Numbers' },
  { key: 'aftersales', href: '/aftersales', label: 'After Sales' },
];

export default function SalesTabs({ active }: { active: SalesTab }) {
  const { t } = useT();
  const { profile } = useAuth();
  const perms = profile ? ROLE_PERMISSIONS[profile.role] : null;
  const shown = perms ? TABS.filter((x) => canOpenPath(perms, x.href)) : [];
  if (shown.length < 2) return null;
  return (
    <nav className="flex items-center gap-5 border-b border-slate-800/80 overflow-x-auto" aria-label={t('Sales')}>
      {shown.map((x) => (
        <Link key={x.key} href={x.href} aria-current={active === x.key ? 'page' : undefined}
          className={`pb-2.5 -mb-px text-[13px] whitespace-nowrap border-b-2 transition-colors ${active === x.key
            ? 'border-emerald-400 text-white font-bold'
            : 'border-transparent text-slate-500 hover:text-slate-300 font-medium'}`}>
          {t(x.label)}
        </Link>
      ))}
    </nav>
  );
}
