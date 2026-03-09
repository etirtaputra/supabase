import { createClient } from '@supabase/supabase-js';
import type { IntakeItem, IntakeLog, Category } from '@/types/intake';

function getClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

// ── Auth ──────────────────────────────────────────────────────

export async function getUser() {
  const { data: { user } } = await getClient().auth.getUser();
  return user;
}

export async function signInWithEmail(email: string, password: string) {
  return getClient().auth.signInWithPassword({ email, password });
}

export async function signUpWithEmail(email: string, password: string) {
  return getClient().auth.signUp({ email, password });
}

export async function signOut() {
  return getClient().auth.signOut();
}

// ── Items CRUD ────────────────────────────────────────────────

export async function fetchItems(): Promise<IntakeItem[]> {
  const { data, error } = await getClient()
    .from('intake_items')
    .select('*')
    .order('name', { ascending: true });
  if (error) throw error;
  return (data ?? []) as IntakeItem[];
}

export async function addItem(item: {
  name: string;
  category: Category;
  default_unit: string;
  default_amount: number;
  serving_count: number;
  serving_label: string;
  serving_ml: number;
  color: string;
}): Promise<IntakeItem> {
  const user = await getUser();
  if (!user) throw new Error('Not authenticated');
  const { data, error } = await getClient()
    .from('intake_items')
    .insert({ ...item, user_id: user.id })
    .select()
    .single();
  if (error) throw error;
  return data as IntakeItem;
}

export async function updateItem(
  id: string,
  patch: Partial<Omit<IntakeItem, 'id' | 'user_id' | 'created_at'>>
): Promise<IntakeItem> {
  const { data, error } = await getClient()
    .from('intake_items')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as IntakeItem;
}

export async function deleteItem(id: string): Promise<void> {
  const { error } = await getClient().from('intake_items').delete().eq('id', id);
  if (error) throw error;
}

// ── Logs CRUD ─────────────────────────────────────────────────

export async function fetchLogs(): Promise<IntakeLog[]> {
  const { data, error } = await getClient()
    .from('intake_logs')
    .select('*')
    .order('date', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as IntakeLog[];
}

export async function addLog(log: {
  item_id: string;
  date: string;
  amount: number;
  unit: string;
  notes?: string;
  time_of_day?: string;
}): Promise<IntakeLog> {
  const user = await getUser();
  if (!user) throw new Error('Not authenticated');
  const { data, error } = await getClient()
    .from('intake_logs')
    .insert({
      ...log,
      user_id: user.id,
      notes: log.notes ?? '',
      time_of_day: log.time_of_day ?? '',
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as IntakeLog;
}

export async function updateLog(
  id: string,
  patch: { date?: string; amount?: number; unit?: string; notes?: string; time_of_day?: string }
): Promise<IntakeLog> {
  const { data, error } = await getClient()
    .from('intake_logs')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data as IntakeLog;
}

export async function deleteLog(id: string): Promise<void> {
  const { error } = await getClient().from('intake_logs').delete().eq('id', id);
  if (error) throw error;
}
