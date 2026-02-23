'use client';

import { useState } from 'react';
import { useMoney } from '@/context/MoneyContext';
import type { AccountCategory, UserAccount } from '@/types/money';

const CATEGORIES: { id: AccountCategory; label: string; icon: string; desc: string }[] = [
  { id: 'cash',       label: 'Cash',       icon: '💵', desc: 'Physical cash on hand' },
  { id: 'debit',      label: 'Debit',      icon: '🏦', desc: 'Bank / savings accounts' },
  { id: 'credit',     label: 'Credit',     icon: '💳', desc: 'Credit card accounts' },
  { id: 'investment', label: 'Investment', icon: '📈', desc: 'Stocks, funds, crypto' },
  { id: 'ewallet',    label: 'E-Wallet',   icon: '📱', desc: 'GoPay, OVO, ShopeePay…' },
];

const CAT_COLORS: Record<AccountCategory, string> = {
  cash:       'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  debit:      'bg-sky-500/20 text-sky-400 border-sky-500/30',
  credit:     'bg-rose-500/20 text-rose-400 border-rose-500/30',
  investment: 'bg-violet-500/20 text-violet-400 border-violet-500/30',
  ewallet:    'bg-orange-500/20 text-orange-400 border-orange-500/30',
};

interface EditState {
  id: string;
  name: string;
  category: AccountCategory;
}

export default function SettingsView() {
  const { userAccounts, handleAddUserAccount, handleUpdateUserAccount, handleDeleteUserAccount } = useMoney();

  const [newName,     setNewName]     = useState('');
  const [newCategory, setNewCategory] = useState<AccountCategory>('debit');
  const [adding,      setAdding]      = useState(false);
  const [editState,   setEditState]   = useState<EditState | null>(null);
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState('');

  // Group accounts by category
  const grouped = CATEGORIES.map(cat => ({
    ...cat,
    accounts: userAccounts.filter(a => a.category === cat.id),
  })).filter(g => g.accounts.length > 0 || true); // show all sections

  const handleAdd = async () => {
    const name = newName.trim();
    if (!name) { setError('Account name is required.'); return; }
    if (userAccounts.some(a => a.name.toLowerCase() === name.toLowerCase())) {
      setError('An account with this name already exists.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await handleAddUserAccount(name, newCategory);
      setNewName('');
      setAdding(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to add account');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async () => {
    if (!editState) return;
    const name = editState.name.trim();
    if (!name) { setError('Account name is required.'); return; }
    setSaving(true);
    setError('');
    try {
      await handleUpdateUserAccount(editState.id, name, editState.category);
      setEditState(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to update account');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (acc: UserAccount) => {
    if (!confirm(`Delete "${acc.name}"? This won't delete transactions using this account.`)) return;
    try {
      await handleDeleteUserAccount(acc.id);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to delete account');
    }
  };

  return (
    <div className="px-4 pb-24 lg:pb-4 space-y-6 mt-2">
      {/* Account Management */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-white font-bold text-base">Accounts</h2>
          <button
            onClick={() => { setAdding(v => !v); setError(''); }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 hover:bg-violet-500 text-white rounded-xl text-xs font-semibold transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
              className="w-3.5 h-3.5">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Add Account
          </button>
        </div>

        {/* Add form */}
        {adding && (
          <div className="bg-slate-800 rounded-2xl p-4 mb-4 space-y-3">
            <p className="text-sm font-semibold text-white">New Account</p>

            <div>
              <label className="block text-xs text-slate-400 mb-1">Name</label>
              <input
                type="text"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAdd()}
                placeholder="e.g. BCA Savings"
                autoFocus
                className="w-full bg-slate-900 border border-slate-700 text-white text-sm rounded-xl px-3 py-2.5 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-2">Category</label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {CATEGORIES.map(c => (
                  <button key={c.id} type="button"
                    onClick={() => setNewCategory(c.id)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium transition-colors
                      ${newCategory === c.id
                        ? CAT_COLORS[c.id]
                        : 'border-slate-700 text-slate-400 hover:text-white hover:border-slate-600'}`}>
                    <span>{c.icon}</span>
                    <div className="text-left">
                      <p>{c.label}</p>
                      <p className="text-[10px] opacity-60">{c.desc}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {error && <p className="text-xs text-rose-400">{error}</p>}

            <div className="flex gap-2">
              <button onClick={() => { setAdding(false); setNewName(''); setError(''); }}
                className="flex-1 py-2.5 border border-slate-600 hover:border-slate-500 text-slate-300 rounded-xl text-sm font-semibold transition-colors">
                Cancel
              </button>
              <button onClick={handleAdd} disabled={saving}
                className="flex-1 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-colors">
                {saving ? 'Saving…' : 'Add'}
              </button>
            </div>
          </div>
        )}

        {/* Grouped account list */}
        {grouped.map(group => (
          <div key={group.id} className="mb-4">
            {/* Section header */}
            <div className="flex items-center gap-2 mb-2 px-1">
              <span className="text-base">{group.icon}</span>
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{group.label}</span>
              <span className="text-xs text-slate-600">· {group.desc}</span>
            </div>

            {group.accounts.length === 0 ? (
              <p className="text-xs text-slate-600 px-2 mb-2">No accounts yet.</p>
            ) : (
              <div className="space-y-2">
                {group.accounts.map(acc => (
                  <div key={acc.id}>
                    {editState?.id === acc.id ? (
                      /* Inline edit form */
                      <div className="bg-slate-800 rounded-2xl p-4 space-y-3">
                        <input
                          type="text"
                          value={editState.name}
                          onChange={e => setEditState(s => s ? { ...s, name: e.target.value } : s)}
                          onKeyDown={e => e.key === 'Enter' && handleUpdate()}
                          autoFocus
                          className="w-full bg-slate-900 border border-slate-700 text-white text-sm rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                        />
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                          {CATEGORIES.map(c => (
                            <button key={c.id} type="button"
                              onClick={() => setEditState(s => s ? { ...s, category: c.id } : s)}
                              className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium transition-colors
                                ${editState.category === c.id
                                  ? CAT_COLORS[c.id]
                                  : 'border-slate-700 text-slate-400 hover:text-white'}`}>
                              <span>{c.icon}</span>
                              <span>{c.label}</span>
                            </button>
                          ))}
                        </div>
                        {error && <p className="text-xs text-rose-400">{error}</p>}
                        <div className="flex gap-2">
                          <button onClick={() => { setEditState(null); setError(''); }}
                            className="flex-1 py-2 border border-slate-600 text-slate-300 rounded-xl text-sm font-semibold">
                            Cancel
                          </button>
                          <button onClick={handleUpdate} disabled={saving}
                            className="flex-1 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-xl text-sm font-semibold">
                            {saving ? 'Saving…' : 'Save'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* Account row */
                      <div className="bg-slate-800 rounded-2xl px-4 py-3 flex items-center gap-3">
                        <span className={`px-2 py-0.5 rounded-lg border text-[10px] font-semibold ${CAT_COLORS[acc.category]}`}>
                          {CATEGORIES.find(c => c.id === acc.category)?.icon}
                        </span>
                        <span className="flex-1 text-sm text-white font-medium">{acc.name}</span>
                        <button
                          onClick={() => { setEditState({ id: acc.id, name: acc.name, category: acc.category }); setError(''); }}
                          className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-500 hover:text-white transition-colors"
                          aria-label="Edit">
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
                            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                            className="w-3.5 h-3.5">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                          </svg>
                        </button>
                        <button
                          onClick={() => handleDelete(acc)}
                          className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-500 hover:text-rose-400 transition-colors"
                          aria-label="Delete">
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
                            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                            className="w-3.5 h-3.5">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                            <path d="M10 11v6"/><path d="M14 11v6"/>
                            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                          </svg>
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        {userAccounts.length === 0 && !adding && (
          <div className="bg-slate-800/50 rounded-2xl p-6 text-center">
            <p className="text-slate-400 text-sm mb-1">No accounts configured yet.</p>
            <p className="text-slate-600 text-xs">Add accounts to use them in transactions instead of the default &ldquo;Cash&rdquo;.</p>
          </div>
        )}
      </section>

      {/* Transaction type reference */}
      <section>
        <h2 className="text-white font-bold text-base mb-3">Transaction Types</h2>
        <div className="space-y-2">
          {[
            { badge: 'EXP',     color: 'bg-rose-500/20 text-rose-400',    label: 'Expense',       desc: 'Regular spending that reduces account balance.' },
            { badge: 'INC',     color: 'bg-emerald-500/20 text-emerald-400', label: 'Income',     desc: 'Regular income that increases account balance.' },
            { badge: 'EXP BAL', color: 'bg-orange-500/20 text-orange-400', label: 'Exp Balance',  desc: 'Balance correction — actual account has less than the app shows.' },
            { badge: 'INC BAL', color: 'bg-teal-500/20 text-teal-400',     label: 'Inc Balance',  desc: 'Balance correction — actual account has more than the app shows.' },
            { badge: 'TRF OUT', color: 'bg-sky-500/20 text-sky-400',       label: 'Transfer Out', desc: 'Nominal outgoing transfer to another account. Not counted as expense.' },
            { badge: 'TRF IN',  color: 'bg-indigo-500/20 text-indigo-400', label: 'Transfer In',  desc: 'Nominal incoming transfer from another account. Not counted as income.' },
          ].map(({ badge, color, label, desc }) => (
            <div key={badge} className="bg-slate-800 rounded-xl px-4 py-3 flex items-start gap-3">
              <span className={`shrink-0 mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold ${color}`}>{badge}</span>
              <div>
                <p className="text-sm text-white font-medium">{label}</p>
                <p className="text-xs text-slate-400 mt-0.5">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
