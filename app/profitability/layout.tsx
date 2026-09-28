import type { Metadata } from 'next';
import { labelOf } from '@/constants/navigation';

export const metadata: Metadata = {
  title: labelOf('/profitability'),
};

export default function ProfitabilityLayout({ children }: { children: React.ReactNode }) {
  return children;
}
