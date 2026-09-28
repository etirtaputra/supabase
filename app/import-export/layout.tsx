import type { Metadata } from 'next';
import { labelOf } from '@/constants/navigation';

export const metadata: Metadata = {
  title: labelOf('/import-export'),
};

export default function ImportExportLayout({ children }: { children: React.ReactNode }) {
  return children;
}
