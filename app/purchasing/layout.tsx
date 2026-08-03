import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Purchasing',
};

export default function PurchasingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
