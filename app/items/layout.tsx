import type { Metadata } from 'next';
import { labelOf } from '@/constants/navigation';

export const metadata: Metadata = {
  title: labelOf('/items'),
};

export default function ItemsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
