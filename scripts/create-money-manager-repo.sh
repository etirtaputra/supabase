#!/usr/bin/env bash
# ============================================================
# create-money-manager-repo.sh
#
# Run this on your Mac (after fixing git — see instructions
# at the bottom of this file) to create a clean, standalone
# money-manager repo from the files already on GitHub.
#
# Usage:
#   chmod +x create-money-manager-repo.sh
#   ./create-money-manager-repo.sh
# ============================================================

set -e

WORK_REPO="https://github.com/etirtaputra/supabase.git"
BRANCH="claude/build-pwa-money-manager-N51Io"
TARGET="$HOME/money-manager"

echo ""
echo "==> Cloning money manager branch from GitHub..."
git clone --branch "$BRANCH" --single-branch --depth 1 \
  "$WORK_REPO" "$TARGET"
cd "$TARGET"

echo ""
echo "==> Restructuring: moving /money routes to root..."

# Move app/money/* to app/* (money manager becomes the root app)
cp -r app/money/login   app/
cp    app/money/import/page.tsx   app/import/page.tsx   2>/dev/null || true
cp    app/money/import/layout.tsx app/import/layout.tsx 2>/dev/null || true
mkdir -p app/import

# Overwrite app/page.tsx with the standalone version (routes at /)
cat > app/page.tsx << 'ENDOFPAGE'
'use client';
export const dynamic = 'force-dynamic';

import { MoneyProvider, useMoney } from '@/context/MoneyContext';
import AuthGate from '@/components/money/AuthGate';
import Sidebar from '@/components/money/Sidebar';
import BottomNav from '@/components/money/BottomNav';
import MonthNavigator from '@/components/money/MonthNavigator';
import SummaryCards from '@/components/money/SummaryCards';
import TransactionList from '@/components/money/TransactionList';
import TransactionModal from '@/components/money/TransactionModal';
import TransactionActionMenu from '@/components/money/TransactionActionMenu';
import StatsView from '@/components/money/StatsView';
import AccountsView from '@/components/money/AccountsView';
import Link from 'next/link';
import { signOut } from '@/lib/money-supabase';

function MoneyApp() {
  const { activeView, refreshTransactions } = useMoney();
  const viewTitles: Record<string,string> = {
    transactions:'Transactions', stats:'Statistics', accounts:'Accounts',
  };
  return (
    <div className="flex h-dvh bg-slate-950 text-white overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="flex items-center justify-between px-4 py-3 border-b border-slate-700/50 bg-slate-900/80 backdrop-blur-sm shrink-0">
          <div className="flex items-center gap-3">
            <div className="lg:hidden w-7 h-7 rounded-lg bg-violet-600 flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
                stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                <circle cx="12" cy="12" r="10"/>
                <path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/>
                <line x1="12" y1="6" x2="12" y2="8"/>
                <line x1="12" y1="16" x2="12" y2="18"/>
              </svg>
            </div>
            <h1 className="text-white font-bold text-base lg:text-lg">{viewTitles[activeView]}</h1>
          </div>
          <div className="flex items-center gap-2">
            {(activeView==='transactions'||activeView==='stats') && <MonthNavigator />}
            <Link href="/import" className="lg:hidden p-2 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="12" y1="18" x2="12" y2="12"/>
                <polyline points="9 15 12 12 15 15"/>
              </svg>
            </Link>
            <button onClick={refreshTransactions} className="p-2 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                <polyline points="23 4 23 10 17 10"/>
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
              </svg>
            </button>
            <button onClick={async()=>{await signOut();window.location.reload();}}
              className="p-2 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                <polyline points="16 17 21 12 16 7"/>
                <line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
            </button>
          </div>
        </header>
        {activeView==='transactions' && <SummaryCards />}
        <main className="flex-1 overflow-y-auto">
          {activeView==='transactions' && <TransactionList />}
          {activeView==='stats'        && <StatsView />}
          {activeView==='accounts'     && <AccountsView />}
        </main>
      </div>
      <BottomNav />
      <TransactionModal />
      <TransactionActionMenu />
    </div>
  );
}

export default function HomePage() {
  return (
    <AuthGate>
      <MoneyProvider>
        <MoneyApp />
      </MoneyProvider>
    </AuthGate>
  );
}
ENDOFPAGE

# Fix import/layout.tsx and import/page.tsx
cat > app/import/layout.tsx << 'EOF'
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Import Transactions | Money Manager' };
export default function ImportLayout({ children }: { children: React.ReactNode }) {
  return children;
}
EOF

cat > app/import/page.tsx << 'EOF'
'use client';
import ImportPage from '@/components/money/ImportPage';
import AuthGate from '@/components/money/AuthGate';
export default function MoneyImportPage() {
  return <AuthGate><ImportPage /></AuthGate>;
}
EOF

# Root layout (PWA, no /money prefix)
cat > app/layout.tsx << 'EOF'
import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Money Manager',
  description: 'Personal finance tracker',
  manifest: '/manifest.json',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Money Manager' },
  other: { 'mobile-web-app-capable': 'yes' },
};

export const viewport: Viewport = {
  themeColor: '#0f172a', width: 'device-width',
  initialScale: 1, maximumScale: 1, userScalable: false, viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="apple-touch-icon" href="/icon-192.svg" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <script dangerouslySetInnerHTML={{ __html: `
          if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
              navigator.serviceWorker.register('/sw.js').catch(() => {});
            });
          }
        ` }} />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
EOF

# Fix component URLs: /money/import → /import, /money → /
sed -i '' 's|href="/money/import"|href="/import"|g' components/money/Sidebar.tsx
sed -i '' 's|router\.push.*"/money".*|router.push("/");|g' components/money/ImportPage.tsx
sed -i '' 's|@/app/money/login/LoginPage|@/app/login/LoginPage|g' components/money/AuthGate.tsx

# Fix manifest.json
sed -i '' 's|"start_url": "/money"|"start_url": "/"|g' public/manifest.json

# Fix sw.js
sed -i '' "s|OFFLINE_URL = '/money'|OFFLINE_URL = '/'|g" public/sw.js

# Remove work-app routes (keep only money manager)
rm -rf app/ask app/database app/insert app/upload-pdf app/api
rm -rf components/forms components/layout components/ui
rm -f lib/supabase.ts hooks/useSupabaseData.ts hooks/useToast.ts 2>/dev/null || true
rm -rf constants queries docs 2>/dev/null || true
rm -f BEFORE_AFTER_COMPARISON.md PDF_UPLOAD_GUIDE.md QUICK_START.md \
       REFACTORING_SUMMARY.md SUPABASE_OPTIMIZATION_REPORT.md 2>/dev/null || true
rm -rf migrations/*.sql 2>/dev/null || true
mv migrations/004_money_manager.sql migrations/ 2>/dev/null || true

# Update package.json (remove work-app deps)
cat > package.json << 'PKGJSON'
{
  "name": "money-manager",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.86.2",
    "chart.js": "^4.5.1",
    "date-fns": "^4.1.0",
    "next": "15.3.1",
    "react": "^19.0.0",
    "react-chartjs-2": "^5.3.0",
    "react-dom": "^19.0.0",
    "xlsx": "^0.18.5"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4",
    "@types/node": "^20",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "eslint": "^9",
    "eslint-config-next": "15.3.1",
    "tailwindcss": "^4",
    "typescript": "^5"
  }
}
PKGJSON

# Copy eslint config with underscore-ignore rule
cat > eslint.config.mjs << 'EOF'
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { FlatCompat } from '@eslint/eslintrc';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const compat = new FlatCompat({ baseDirectory: __dirname });
const eslintConfig = [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', {
        varsIgnorePattern: '^_', argsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_',
      }],
    },
  },
];
export default eslintConfig;
EOF

# Remove old git history and re-init as a clean private repo
rm -rf .git
git init
git branch -m main
git add -A
git commit -m "Initial commit: Money Manager PWA"

echo ""
echo "============================================================"
echo "  Done!  Your standalone project is at: $TARGET"
echo "============================================================"
echo ""
echo "Next steps:"
echo ""
echo "1. Create a new PRIVATE repo on GitHub:"
echo "   https://github.com/new  →  name: money-manager  →  Private  →  Create"
echo ""
echo "2. Set up environment variables:"
echo "   cp .env.local.example .env.local"
echo "   # then open .env.local and paste your Supabase anon key"
echo ""
echo "3. Push to your new private repo:"
echo "   git remote add origin git@github.com:YOUR_USERNAME/money-manager.git"
echo "   git push -u origin main"
echo ""
echo "4. Deploy on Vercel:"
echo "   - vercel.com → New Project → import money-manager repo"
echo "   - Add env vars: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY"
echo "   - Deploy!"
echo ""

# ============================================================
# HOW TO FIX GIT ON YOUR MAC FIRST (xcrun architecture error)
# ============================================================
# The error you saw:
#   xcrun: error: unable to load libxcrun ... (have 'x86_64', need 'arm64e')
# means your Command Line Tools are an Intel (x86_64) build but
# your Mac Mini M2 needs arm64. Fix:
#
#   sudo rm -rf /Library/Developer/CommandLineTools
#   xcode-select --install
#
# Then re-run this script.
# ============================================================
