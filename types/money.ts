export type TransactionType = 'Inc' | 'Exp' | 'Trf';
export type ViewType = 'transactions' | 'stats' | 'accounts';

export interface Transaction {
  id: string;
  user_id: string;
  date: string;        // 'YYYY-MM-DD'
  time: string;        // 'HH:MM:SS'
  account: string;
  category: string;
  subcategory: string;
  note: string;
  description: string;
  amount: number;
  type: TransactionType;
  bookmarked: boolean;
  created_at: string;
}

export interface TransactionFormData {
  date: string;
  time: string;
  account: string;
  category: string;
  subcategory: string;
  note: string;
  description: string;
  amount: number;
  type: TransactionType;
}

export interface GroupedTransactions {
  date: string;            // 'YYYY-MM-DD'
  displayDate: string;     // e.g. 'Monday, 17 Feb'
  transactions: Transaction[];
  dailyIncome: number;
  dailyExpense: number;
}

export interface AccountBalance {
  account: string;
  income: number;
  expense: number;
  balance: number;
}

export interface CategoryStat {
  category: string;
  amount: number;
  percentage: number;
  color: string;
}

export interface NoteSuggestion {
  note: string;
  account: string;
  category: string;
  subcategory: string;
}
