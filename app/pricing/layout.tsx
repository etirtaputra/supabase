import type { Metadata } from 'next';
import { labelOf } from '@/constants/navigation';

export const metadata: Metadata = {
  title: labelOf('/pricing'),
};

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
