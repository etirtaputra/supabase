import type { Metadata } from 'next';
import { labelOf } from '@/constants/navigation';

export const metadata: Metadata = {
  title: labelOf('/settings'),
};

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
