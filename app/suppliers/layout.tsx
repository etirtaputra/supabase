import type { Metadata } from 'next';
import { labelOf } from '@/constants/navigation';

export const metadata: Metadata = {
  title: labelOf('/suppliers'),
};

export default function SuppliersLayout({ children }: { children: React.ReactNode }) {
  return children;
}
