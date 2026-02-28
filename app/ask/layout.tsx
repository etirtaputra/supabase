import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'AI Assistant',
};

export default function AskLayout({ children }: { children: React.ReactNode }) {
  return children;
}
