import type { Metadata } from 'next';
import { labelOf } from '@/constants/navigation';

export const metadata: Metadata = {
  title: labelOf('/support-letters'),
};

export default function SupportLettersLayout({ children }: { children: React.ReactNode }) {
  return children;
}
