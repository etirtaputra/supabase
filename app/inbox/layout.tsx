import type { Metadata } from 'next';
import { labelOf } from '@/constants/navigation';

export const metadata: Metadata = {
  title: labelOf('/inbox'),
};

export default function InboxLayout({ children }: { children: React.ReactNode }) {
  return children;
}
