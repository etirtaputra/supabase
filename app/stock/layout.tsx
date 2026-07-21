import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Stock',
};

export default function StockLayout({ children }: { children: React.ReactNode }) {
  return children;
}
