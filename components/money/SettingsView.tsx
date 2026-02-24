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

// ── Inline edit state ─────────────────────────────────────────
interface EditGroupState { id: string; name: string; category: AccountCategory; }
interface EditSubState   { id: string; name: string; }

// ── Sub-form for adding a subaccount under a group ────────────
function AddSubAccountForm({
  parentId,
  onClose,
  existingNames,
}: {
  parentId: string;
  onClose: () => void;
  existingNames: string[];
}) {
  const { handleAddSubAccount } = useMoney() as ReturnType<typeof useMoney> & {
    handleAddSubAccount: (name: string, parentId: string) => Promise<void>;
  };
  const [name,   setName]   = useState('');
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  const handleAdd = async () => {
    const n = name.trim();
    if (!n) { setError('Name is required.'); return; }
    if (existingNames.some(e => e.toLowerCase() === n.toLowerCase())) {
      setError('Name already exists.'); return;
    }
    setSaving(true); setError('');
    try {
      await handleAddSubAccount(n, parentId);
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to add subaccount');
    } finally { setSaving(false); }
  };

  return (
    <div className="ml-6 mt-1 bg-slate-700/50 rounded-xl p-3 space-y-2">
      <p className="text-xs font-semibold text-slate-300">New Subaccount</p>
      <input
        type="text" value={name} onChange={e => setName(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && handleAdd()}
        placeholder="e.g. BCA Savings"
        autoFocus
        className="w-full bg-slate-900 border border-slate-600 text-white text-sm rounded-xl px-3 py-2 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
      />
      {error && <p className="text-xs text-rose-400">{error}</p>}
      <div className="flex gap-2">
        <button onClick={onClose}
          className="flex-1 py-1.5 border border-slate-600 text-slate-400 rounded-xl text-xs font-semibold hover:text-white transition-colors">
          Cancel
        </button>
        <button onClick={handleAdd} disabled={saving}
          className="flex-1 py-1.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold transition-colors">
          {saving ? 'Saving…' : 'Add'}
        </button>
      </div>
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────
export default function SettingsView() {
  const {
    userAccounts,
    handleAddUserAccount,
    handleUpdateUserAccount,
    handleDeleteUserAccount,
  } = useMoney();

  // "handleAddSubAccount" is on the context; cast to access it
  const moneyCtx = useMoney() as ReturnType<typeof useMoney> & {
    handleAddSubAccount: (name: string, parentId: string) => Promise<void>;
  };

  // Top-level groups (parent_id === null)
  const groups    = userAccounts.filter(a => a.parent_id === null);
  // All subaccounts indexed by parent
  const subOf     = (parentId: string) => userAccounts.filter(a => a.parent_id === parentId);

  // ── Add-group form state
  const [addingGroup,  setAddingGroup]  = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupCat,  setNewGroupCat]  = useState<AccountCategory>('debit');
  const [groupSaving,  setGroupSaving]  = useState(false);
  const [groupError,   setGroupError]   = useState('');

  // ── Edit-group state
  const [editGroup, setEditGroup] = useState<EditGroupState | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError,  setEditError]  = useState('');

  // ── Edit-subaccount state
  const [editSub,      setEditSub]      = useState<EditSubState | null>(null);
  const [editSubSaving, setEditSubSaving] = useState(false);
  const [editSubError,  setEditSubError]  = useState('');

  // ── Which group is showing the "add subaccount" form
  const [addingSubFor, setAddingSubFor] = useState<string | null>(null);

  // ── Handlers ────────────────────────────────────────────────
  const handleAddGroup = async () => {
    const name = newGroupName.trim();
    if (!name) { setGroupError('Name is required.'); return; }
    if (groups.some(g => g.name.toLowerCase() === name.toLowerCase())) {
      setGroupError('Group name already exists.'); return;
    }
    setGroupSaving(true); setGroupError('');
    try {
      await handleAddUserAccount(name, newGroupCat);
      setNewGroupName(''); setAddingGroup(false);
    } catch (e: unknown) {
      setGroupError(e instanceof Error ? e.message : 'Failed to add account group');
    } finally { setGroupSaving(false); }
  };

  const handleUpdateGroup = async () => {
    if (!editGroup) return;
    const name = editGroup.name.trim();
    if (!name) { setEditError('Name is required.'); return; }
    setEditSaving(true); setEditError('');
    try {
      await handleUpdateUserAccount(editGroup.id, name, editGroup.category);
      setEditGroup(null);
    } catch (e: unknown) {
      setEditError(e instanceof Error ? e.message : 'Failed to update account');
    } finally { setEditSaving(false); }
  };

  const handleDeleteAcc = async (acc: UserAccount) => {
    const hasChildren = subOf(acc.id).length > 0;
    const confirmMsg = hasChildren
      ? `Delete "${acc.name}" and all its subaccounts? Transactions are NOT deleted.`
      : `Delete "${acc.name}"? Transactions using this account are NOT deleted.`;
    if (!confirm(confirmMsg)) return;
    try {
      await handleDeleteUserAccount(acc.id);
    } catch { /* ignore */ }
  };

  const handleUpdateSub = async () => {
    if (!editSub) return;
    const name = editSub.name.trim();
    if (!name) { setEditSubError('Name is required.'); return; }
    const acc = userAccounts.find(a => a.id === editSub.id)!;
    setEditSubSaving(true); setEditSubError('');
    try {
      await handleUpdateUserAccount(editSub.id, name, acc.category);
      setEditSub(null);
    } catch (e: unknown) {
      setEditSubError(e instanceof Error ? e.message : 'Failed to update subaccount');
    } finally { setEditSubSaving(false); }
  };

  // ── Render ───────────────────────────────────────────────────
  return (
    <div className="px-4 pb-24 lg:pb-4 space-y-6 mt-2">

      {/* ── Account Groups & Subaccounts ── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-white font-bold text-base">Account Groups</h2>
          <button
            onClick={() => { setAddingGroup(v => !v); setGroupError(''); }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 hover:bg-violet-500 text-white rounded-xl text-xs font-semibold transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
              className="w-3.5 h-3.5">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Add Group
          </button>
        </div>

        {/* Add-group form */}
        {addingGroup && (
          <div className="bg-slate-800 rounded-2xl p-4 mb-4 space-y-3">
            <p className="text-sm font-semibold text-white">New Account Group</p>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Name</label>
              <input
                type="text" value={newGroupName}
                onChange={e => setNewGroupName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddGroup()}
                placeholder="e.g. Debit Accounts"
                autoFocus
                className="w-full bg-slate-900 border border-slate-700 text-white text-sm rounded-xl px-3 py-2.5 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-2">Category</label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {CATEGORIES.map(c => (
                  <button key={c.id} type="button"
                    onClick={() => setNewGroupCat(c.id)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium transition-colors
                      ${newGroupCat === c.id
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
            {groupError && <p className="text-xs text-rose-400">{groupError}</p>}
            <div className="flex gap-2">
              <button onClick={() => { setAddingGroup(false); setNewGroupName(''); setGroupError(''); }}
                className="flex-1 py-2.5 border border-slate-600 hover:border-slate-500 text-slate-300 rounded-xl text-sm font-semibold transition-colors">
                Cancel
              </button>
              <button onClick={handleAddGroup} disabled={groupSaving}
                className="flex-1 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-colors">
                {groupSaving ? 'Saving…' : 'Add Group'}
              </button>
            </div>
          </div>
        )}

        {/* Empty state */}
        {groups.length === 0 && !addingGroup && (
          <div className="bg-slate-800/50 rounded-2xl p-6 text-center">
            <p className="text-slate-400 text-sm mb-1">No account groups yet.</p>
            <p className="text-slate-600 text-xs">Add a group (e.g. "Debit Accounts"), then add subaccounts under it.</p>
          </div>
        )}

        {/* Group list */}
        <div className="space-y-3">
          {groups.map(group => {
            const cat     = CATEGORIES.find(c => c.id === group.category)!;
            const subs    = subOf(group.id);
            const isEdit  = editGroup?.id === group.id;

            return (
              <div key={group.id} className="bg-slate-800 rounded-2xl overflow-hidden">

                {/* Group header row */}
                {isEdit ? (
                  <div className="p-4 space-y-3">
                    <input type="text" value={editGroup.name}
                      onChange={e => setEditGroup(s => s ? { ...s, name: e.target.value } : s)}
                      onKeyDown={e => e.key === 'Enter' && handleUpdateGroup()}
                      autoFocus
                      className="w-full bg-slate-900 border border-slate-700 text-white text-sm rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                    />
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {CATEGORIES.map(c => (
                        <button key={c.id} type="button"
                          onClick={() => setEditGroup(s => s ? { ...s, category: c.id } : s)}
                          className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium transition-colors
                            ${editGroup.category === c.id
                              ? CAT_COLORS[c.id]
                              : 'border-slate-700 text-slate-400 hover:text-white'}`}>
                          <span>{c.icon}</span>
                          <span>{c.label}</span>
                        </button>
                      ))}
                    </div>
                    {editError && <p className="text-xs text-rose-400">{editError}</p>}
                    <div className="flex gap-2">
                      <button onClick={() => { setEditGroup(null); setEditError(''); }}
                        className="flex-1 py-2 border border-slate-600 text-slate-300 rounded-xl text-sm font-semibold">Cancel</button>
                      <button onClick={handleUpdateGroup} disabled={editSaving}
                        className="flex-1 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-xl text-sm font-semibold">
                        {editSaving ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-700/50">
                    <span className={`shrink-0 px-1.5 py-0.5 rounded-lg border text-xs font-semibold ${CAT_COLORS[group.category]}`}>
                      {cat?.icon}
                    </span>
                    <span className="flex-1 text-sm font-bold text-white">{group.name}</span>
                    <span className="text-xs text-slate-500">{cat?.label}</span>

                    {/* Add subaccount button */}
                    <button
                      onClick={() => setAddingSubFor(v => v === group.id ? null : group.id)}
                      title="Add subaccount"
                      className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-500 hover:text-violet-400 transition-colors">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
                        stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                        className="w-3.5 h-3.5">
                        <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                      </svg>
                    </button>

                    {/* Edit group */}
                    <button
                      onClick={() => { setEditGroup({ id: group.id, name: group.name, category: group.category }); setEditError(''); }}
                      className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-500 hover:text-white transition-colors">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
                        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                        className="w-3.5 h-3.5">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                      </svg>
                    </button>

                    {/* Delete group */}
                    <button
                      onClick={() => handleDeleteAcc(group)}
                      className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-500 hover:text-rose-400 transition-colors">
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

                {/* Subaccounts */}
                <div className="px-4 py-2 space-y-1">
                  {subs.length === 0 && addingSubFor !== group.id && (
                    <p className="text-xs text-slate-600 py-1 pl-2">No subaccounts — press + to add one.</p>
                  )}

                  {subs.map(sub => {
                    const isEditSub = editSub?.id === sub.id;
                    return (
                      <div key={sub.id}>
                        {isEditSub ? (
                          <div className="bg-slate-700/50 rounded-xl p-3 space-y-2 my-1">
                            <input type="text" value={editSub.name}
                              onChange={e => setEditSub(s => s ? { ...s, name: e.target.value } : s)}
                              onKeyDown={e => e.key === 'Enter' && handleUpdateSub()}
                              autoFocus
                              className="w-full bg-slate-900 border border-slate-600 text-white text-sm rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                            />
                            {editSubError && <p className="text-xs text-rose-400">{editSubError}</p>}
                            <div className="flex gap-2">
                              <button onClick={() => { setEditSub(null); setEditSubError(''); }}
                                className="flex-1 py-1.5 border border-slate-600 text-slate-300 rounded-xl text-xs font-semibold">Cancel</button>
                              <button onClick={handleUpdateSub} disabled={editSubSaving}
                                className="flex-1 py-1.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold">
                                {editSubSaving ? 'Saving…' : 'Save'}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 py-1.5 pl-3 pr-1">
                            <span className="text-slate-600 text-xs select-none">└</span>
                            <span className="flex-1 text-sm text-slate-200">{sub.name}</span>
                            <button
                              onClick={() => { setEditSub({ id: sub.id, name: sub.name }); setEditSubError(''); }}
                              className="p-1 rounded-lg hover:bg-slate-700 text-slate-600 hover:text-white transition-colors">
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
                                stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                                className="w-3 h-3">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                              </svg>
                            </button>
                            <button
                              onClick={() => handleDeleteAcc(sub)}
                              className="p-1 rounded-lg hover:bg-slate-700 text-slate-600 hover:text-rose-400 transition-colors">
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
                                stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                                className="w-3 h-3">
                                <polyline points="3 6 5 6 21 6"/>
                                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                                <path d="M10 11v6"/><path d="M14 11v6"/>
                                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                              </svg>
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Inline add-subaccount form */}
                  {addingSubFor === group.id && (
                    <AddSubAccountForm
                      parentId={group.id}
                      onClose={() => setAddingSubFor(null)}
                      existingNames={userAccounts.map(a => a.name)}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Transaction type reference ── */}
      <section>
        <h2 className="text-white font-bold text-base mb-3">Transaction Types</h2>
        <div className="space-y-2">
          {[
            { badge: 'EXP',     color: 'bg-rose-500/20 text-rose-400',       label: 'Expense',       desc: 'Regular spending that reduces account balance.' },
            { badge: 'INC',     color: 'bg-emerald-500/20 text-emerald-400', label: 'Income',        desc: 'Regular income that increases account balance.' },
            { badge: 'EXP BAL', color: 'bg-orange-500/20 text-orange-400',   label: 'Exp Balance',   desc: 'Balance correction — actual account has less than the app shows.' },
            { badge: 'INC BAL', color: 'bg-teal-500/20 text-teal-400',       label: 'Inc Balance',   desc: 'Balance correction — actual account has more than the app shows.' },
            { badge: 'TRF OUT', color: 'bg-sky-500/20 text-sky-400',         label: 'Transfer Out',  desc: 'Nominal outgoing transfer. Not counted as expense.' },
            { badge: 'TRF IN',  color: 'bg-indigo-500/20 text-indigo-400',   label: 'Transfer In',   desc: 'Nominal incoming transfer. Not counted as income.' },
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
