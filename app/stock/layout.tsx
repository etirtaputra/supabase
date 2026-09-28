import type { Metadata } from 'next';
import { labelOf } from '@/constants/navigation';

export const metadata: Metadata = {
  title: labelOf('/stock'),
};

export default function StockLayout({ children }: { children: React.ReactNode }) {
  return children;
}
