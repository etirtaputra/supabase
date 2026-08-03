import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: "Items",
};

export default function ItemsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
