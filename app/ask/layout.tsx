import type { Metadata } from 'next';
import { labelOf } from '@/constants/navigation';

export const metadata: Metadata = {
  title: labelOf('/ask'),
};

export default function AskLayout({ children }: { children: React.ReactNode }) {
  return children;
}
