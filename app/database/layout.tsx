// Force dynamic rendering – this page fetches from Supabase at runtime
export const dynamic = 'force-dynamic';

export default function DatabaseLayout({ children }: { children: React.ReactNode }) {
  return children;
}
