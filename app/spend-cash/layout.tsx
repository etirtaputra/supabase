import type { Metadata } from 'next';
import { labelOf } from '@/constants/navigation';

export const metadata: Metadata = {
  title: labelOf('/spend-cash'),
};

export default function SpendCashLayout({ children }: { children: React.ReactNode }) {
  return children;
}
