import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Data Entry',
};

export default function InsertLayout({ children }: { children: React.ReactNode }) {
  return children;
}
