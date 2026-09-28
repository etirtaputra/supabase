import type { Metadata } from 'next';
import { labelOf } from '@/constants/navigation';

export const metadata: Metadata = {
  title: labelOf('/purchasing'),
};

export default function PurchasingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
