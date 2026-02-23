'use client';

import ImportPage from '@/components/money/ImportPage';
import AuthGate from '@/components/money/AuthGate';

export default function MoneyImportPage() {
  return (
    <AuthGate>
      <ImportPage />
    </AuthGate>
  );
}
