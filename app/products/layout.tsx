import type { Metadata } from 'next';
import { labelOf } from '@/constants/navigation';

export const metadata: Metadata = {
  title: labelOf('/products'),
};

export default function ProductsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
