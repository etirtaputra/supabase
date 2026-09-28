import type { Metadata } from 'next';
import { labelOf } from '@/constants/navigation';

export const metadata: Metadata = {
  title: labelOf('/aftersales'),
};

export default function AftersalesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
