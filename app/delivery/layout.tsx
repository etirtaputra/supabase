import type { Metadata } from 'next';
import { labelOf } from '@/constants/navigation';

export const metadata: Metadata = {
  title: labelOf('/delivery'),
};

export default function DeliveryLayout({ children }: { children: React.ReactNode }) {
  return children;
}
