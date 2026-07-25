import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Banks',
};

export default function BanksLayout({ children }: { children: React.ReactNode }) {
  return children;
}
