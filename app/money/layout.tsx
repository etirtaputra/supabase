export const dynamic = 'force-dynamic';
import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: 'Money Manager',
  description: 'Personal finance tracker – track income, expenses, and accounts',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Money Manager',
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: '#0f172a',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default function MoneyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
