import type { Metadata } from 'next';
import { labelOf } from '@/constants/navigation';

export const metadata: Metadata = {
  title: labelOf('/invoices'),
};

export default function InvoicesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
