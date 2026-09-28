import type { Metadata } from 'next';
import { labelOf } from '@/constants/navigation';

export const metadata: Metadata = {
  title: labelOf('/sales'),
};

export default function SalesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
