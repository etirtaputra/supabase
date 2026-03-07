export type Category = 'supplement' | 'medicine' | 'caffeine' | 'other';

export const CATEGORY_META: Record<Category, { label: string; icon: string; color: string; bg: string; border: string }> = {
  supplement: { label: 'Supplement', icon: '💊', color: 'text-violet-400', bg: 'bg-violet-500/20', border: 'border-violet-500/40' },
  medicine:   { label: 'Medicine',   icon: '💉', color: 'text-blue-400',   bg: 'bg-blue-500/20',   border: 'border-blue-500/40'   },
  caffeine:   { label: 'Caffeine',   icon: '☕', color: 'text-amber-400',  bg: 'bg-amber-500/20',  border: 'border-amber-500/40'  },
  other:      { label: 'Other',      icon: '⚡', color: 'text-slate-400',  bg: 'bg-slate-500/20',  border: 'border-slate-500/40'  },
};

export const COMMON_UNITS = ['mg', 'g', 'mcg', 'IU', 'ml', 'tablet', 'capsule', 'cup', 'serving', 'drop', 'oz', 'tsp', 'tbsp'];

export const SERVING_LABELS = ['capsule', 'tablet', 'pill', 'softgel', 'gummy', 'scoop', 'packet', 'drop', 'spray', 'piece'];

export const ITEM_COLORS = [
  '#8b5cf6', // violet
  '#3b82f6', // blue
  '#f59e0b', // amber
  '#10b981', // emerald
  '#f43f5e', // rose
  '#0ea5e9', // sky
  '#f97316', // orange
  '#14b8a6', // teal
  '#a855f7', // purple
  '#ec4899', // pink
];

export interface IntakeItem {
  id: string;
  user_id: string;
  name: string;
  category: Category;
  default_unit: string;
  default_amount: number;
  serving_count: number;   // how many serving_label units = default_amount (default: 1)
  serving_label: string;   // e.g. 'capsule', '' means use direct amount input
  color: string;
  created_at: string;
}

export interface IntakeLog {
  id: string;
  user_id: string;
  item_id: string;
  date: string;         // 'YYYY-MM-DD'
  amount: number;
  unit: string;
  notes: string;
  time_of_day: string;
  created_at: string;
  item?: IntakeItem;    // joined from DB
}

export type ViewType = 'today' | 'history' | 'stats' | 'settings';
