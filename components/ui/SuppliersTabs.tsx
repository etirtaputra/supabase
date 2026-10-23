'use client';
import Link from 'next/link';
import { useT } from '@/hooks/useT';

/**
 * Suppliers · Lead times — one menu entry, two views (owner, 2026-10-23: Purchasing
 * cut to four entries). Lead time is a fact about a supplier, so it lives with the
 * suppliers instead of taking a menu line of its own.
 */
export default function SuppliersTabs({ active }: { active: 'suppliers' | 'lead-times' }) {
  const { t } = useT();
  const tab = (key: 'suppliers' | 'lead-times', href: string, label: string) => (
    <Link href={href} aria-current={active === key ? 'page' : undefined}
      className={`pb-2.5 -mb-px text-[13px] whitespace-nowrap border-b-2 transition-colors ${active === key
        ? 'border-sky-400 text-white font-bold'
        : 'border-transparent text-slate-500 hover:text-slate-300 font-medium'}`}>
      {label}
    </Link>
  );
  return (
    <nav className="flex items-center gap-5 border-b border-slate-800/80" aria-label={t('Suppliers')}>
      {tab('suppliers', '/suppliers', t('Suppliers'))}
      {tab('lead-times', '/suppliers/lead-times', t('Lead Times'))}
    </nav>
  );
}
