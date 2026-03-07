export const dynamic = 'force-dynamic';
import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: 'Intake Tracker',
  description: 'Track your daily supplements, medicine, and caffeine intake',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Intake Tracker',
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

export default function IntakeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
