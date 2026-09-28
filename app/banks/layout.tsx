import type { Metadata } from 'next';
import { labelOf } from '@/constants/navigation';

export const metadata: Metadata = {
  title: labelOf('/banks'),
};

export default function BanksLayout({ children }: { children: React.ReactNode }) {
  return children;
}
