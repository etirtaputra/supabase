import type { Metadata } from 'next';
import { labelOf } from '@/constants/navigation';

export const metadata: Metadata = {
  title: labelOf('/customers'),
};

export default function CustomersLayout({ children }: { children: React.ReactNode }) {
  return children;
}
