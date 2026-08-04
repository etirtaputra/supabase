import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Sales Orders',
};

export default function SalesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
