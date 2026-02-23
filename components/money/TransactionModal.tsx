'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { format } from 'date-fns';
import { useMoney, useDefaultModalType } from '@/context/MoneyContext';
import { fetchNoteSuggestions } from '@/lib/money-supabase';
import type { TransactionFormData, TransactionType, NoteSuggestion } from '@/types/money';

// ── Calculator ────────────────────────────────────────────────

function safeEval(expr: string): number | null {
  // Whitelist: digits, +, -, *, /, decimal, parentheses, spaces
  if (!/^[\d+\-*/().\s]+$/.test(expr)) return null;
  try {
    // eslint-disable-next-line no-new-func
    const result = new Function(`"use strict"; return (${expr})`)();
    if (typeof result === 'number' && isFinite(result)) return result;
  } catch { /* empty */ }
  return null;
}

function fmt(n: number) {
  return new Intl.NumberFormat('id-ID').format(Math.round(n));
}

const CALC_KEYS = [
  ['7', '8', '9', '÷'],
  ['4', '5', '6', '×'],
  ['1', '2', '3', '-'],
  ['.', '0', '⌫', '+'],
];

interface CalcProps {
  initialValue: number;
  onConfirm: (value: number) => void;
  onCancel: () => void;
}

function Calculator({ initialValue, onConfirm, onCancel }: CalcProps) {
  const [input, setInput] = useState(initialValue > 0 ? String(Math.round(initialValue)) : '');
  const [expression, setExpression] = useState('');

  const currentDisplay = expression + input;

  const evaluate = useCallback((expr: string): number | null => {
    const normalized = expr.replace(/×/g, '*').replace(/÷/g, '/');
    return safeEval(normalized);
  }, []);

  const evaluated = evaluate(currentDisplay);
  const displayValue = evaluated !== null ? fmt(evaluated) : currentDisplay || '0';

  const handleKey = useCallback((key: string) => {
    if (key === '⌫') {
      if (input.length > 0) {
        setInput(p => p.slice(0, -1));
      } else if (expression.length > 0) {
        // remove last char of expression
        const trimmed = expression.slice(0, -1);
        // if trimmed ends with operator, set expression and clear input
        const lastChar = trimmed.slice(-1);
        if (['+', '-', '*', '/', '×', '÷'].includes(lastChar)) {
          setExpression(trimmed);
        } else {
          // move back: last "number" part becomes input
          const match = trimmed.match(/(.*?)([\d.]*)$/);
          if (match) {
            setExpression(match[1]);
            setInput(match[2]);
          }
        }
      }
      return;
    }

    if (key === 'C') {
      setInput('');
      setExpression('');
      return;
    }

    if (['+', '-', '×', '÷'].includes(key)) {
      // fold current input into expression
      setExpression(prev => {
        const cur = prev + input;
        // if cur ends with operator, replace it
        if (cur && ['+', '-', '*', '/', '×', '÷'].includes(cur.slice(-1))) {
          return cur.slice(0, -1) + key;
        }
        return cur + key;
      });
      setInput('');
      return;
    }

    if (key === '=') {
      const result = evaluate(currentDisplay);
      if (result !== null) {
        setInput(String(Math.round(result * 100) / 100));
        setExpression('');
      }
      return;
    }

    // digit or '.'
    if (key === '.' && input.includes('.')) return;
    setInput(p => p + key);
  }, [input, expression, currentDisplay, evaluate]);

  const confirmed = evaluate(currentDisplay) ?? parseFloat(currentDisplay) ?? 0;

  return (
    <div className="flex flex-col gap-3">
      {/* Display */}
      <div className="bg-slate-950 rounded-xl p-4 min-h-[72px] flex flex-col items-end justify-center">
        {expression && (
          <p className="text-slate-500 text-sm mb-1">{expression}{input}</p>
        )}
        <p className="text-2xl font-bold text-white tracking-tight">
          {displayValue}
        </p>
      </div>

      {/* Keypad */}
      <div className="grid grid-cols-4 gap-2">
        {CALC_KEYS.map(row =>
          row.map(key => {
            const isOp = ['+', '-', '×', '÷'].includes(key);
            const isDel = key === '⌫';
            return (
              <button
                key={key}
                type="button"
                onClick={() => handleKey(key)}
                className={`h-12 rounded-xl text-sm font-semibold transition-colors active:scale-95
                  ${isOp ? 'bg-violet-600/30 text-violet-300 hover:bg-violet-600/50' :
                    isDel ? 'bg-slate-700 text-slate-300 hover:bg-slate-600' :
                    'bg-slate-800 text-white hover:bg-slate-700'}`}
              >
                {key}
              </button>
            );
          })
        )}

        {/* Bottom row: C, =, OK */}
        <button type="button" onClick={() => handleKey('C')}
          className="h-12 rounded-xl bg-slate-700 text-slate-300 hover:bg-slate-600 text-sm font-semibold transition-colors col-span-1">
          C
        </button>
        <button type="button" onClick={() => handleKey('=')}
          className="h-12 rounded-xl bg-slate-700 text-slate-300 hover:bg-slate-600 text-sm font-semibold transition-colors col-span-1">
          =
        </button>
        <button type="button" onClick={onCancel}
          className="h-12 rounded-xl bg-slate-700 text-slate-400 hover:bg-slate-600 text-sm font-semibold transition-colors col-span-1">
          ✕
        </button>
        <button
          type="button"
          onClick={() => onConfirm(Math.abs(confirmed))}
          className="h-12 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-bold transition-colors col-span-1"
        >
          OK
        </button>
      </div>
    </div>
  );
}

// ── Common categories ──────────────────────────────────────────

const EXPENSE_CATEGORIES = [
  'Food & Drink', 'Shopping', 'Transport', 'Housing', 'Health',
  'Entertainment', 'Education', 'Travel', 'Personal', 'Other',
];
const INCOME_CATEGORIES = [
  'Salary', 'Freelance', 'Business', 'Investment', 'Gift', 'Other',
];
const ACCOUNTS = ['Cash', 'Bank BCA', 'Bank BRI', 'Bank Mandiri', 'GoPay', 'OVO', 'ShopeePay', 'Credit Card'];

// ── Main Modal ─────────────────────────────────────────────────

export default function TransactionModal() {
  const {
    showModal,
    closeModal,
    editingTransaction,
    handleAddTransaction,
    handleUpdateTransaction,
  } = useMoney();

  const defaultType = useDefaultModalType();

  const today      = format(new Date(), 'yyyy-MM-dd');
  const currentTime = format(new Date(), 'HH:mm');

  const [type,        setType]        = useState<TransactionType>(defaultType);
  const [date,        setDate]        = useState(today);
  const [time,        setTime]        = useState(currentTime);
  const [account,     setAccount]     = useState('Cash');
  const [category,    setCategory]    = useState('');
  const [subcategory, setSubcategory] = useState('');
  const [note,        setNote]        = useState('');
  const [description, setDescription] = useState('');
  const [amount,      setAmount]      = useState(0);
  const [showCalc,    setShowCalc]    = useState(false);
  const [saving,      setSaving]      = useState(false);

  // Note autocomplete
  const [suggestions,     setSuggestions]    = useState<NoteSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const noteRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Populate form when editing
  useEffect(() => {
    if (!showModal) return;
    if (editingTransaction) {
      setType(editingTransaction.type);
      setDate(editingTransaction.date);
      setTime(editingTransaction.time.slice(0, 5));
      setAccount(editingTransaction.account);
      setCategory(editingTransaction.category);
      setSubcategory(editingTransaction.subcategory);
      setNote(editingTransaction.note);
      setDescription(editingTransaction.description);
      setAmount(editingTransaction.amount);
    } else {
      setType(defaultType);
      setDate(today);
      setTime(currentTime);
      setAccount('Cash');
      setCategory('');
      setSubcategory('');
      setNote('');
      setDescription('');
      setAmount(0);
    }
    setShowCalc(false);
    setSuggestions([]);
    setShowSuggestions(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showModal, editingTransaction]);

  // Autocomplete on note change
  const handleNoteChange = useCallback((value: string) => {
    setNote(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const s = await fetchNoteSuggestions(value);
      setSuggestions(s);
      setShowSuggestions(s.length > 0 && value.length > 0);
    }, 250);
  }, []);

  const applySuggestion = useCallback((s: NoteSuggestion) => {
    setNote(s.note);
    setCategory(s.category);
    setSubcategory(s.subcategory);
    setAccount(s.account);
    setShowSuggestions(false);
    setSuggestions([]);
  }, []);

  const handleSubmit = async () => {
    if (amount <= 0) { setShowCalc(true); return; }
    setSaving(true);
    try {
      const form: TransactionFormData = {
        date,
        time: time + ':00',
        account,
        category,
        subcategory,
        note,
        description,
        amount,
        type,
      };
      if (editingTransaction) {
        await handleUpdateTransaction(editingTransaction.id, form);
      } else {
        await handleAddTransaction(form);
      }
    } finally {
      setSaving(false);
    }
  };

  const categories = type === 'Inc' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;

  if (!showModal) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end lg:items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={closeModal}
      />

      {/* Modal panel */}
      <div className="relative w-full lg:max-w-md max-h-[92dvh] bg-slate-900 rounded-t-2xl lg:rounded-2xl flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700/50">
          <h2 className="text-white font-bold text-base">
            {editingTransaction ? 'Edit Transaction' : 'New Transaction'}
          </h2>
          <button onClick={closeModal}
            className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              className="w-5 h-5">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Type tabs */}
        <div className="flex gap-1 px-5 pt-4">
          {(['Exp', 'Inc', 'Trf'] as TransactionType[]).map(t => {
            const labels = { Exp: 'Expense', Inc: 'Income', Trf: 'Transfer' };
            const colors = {
              Exp: type === 'Exp' ? 'bg-rose-500 text-white' : 'text-slate-400 hover:text-white',
              Inc: type === 'Inc' ? 'bg-emerald-500 text-white' : 'text-slate-400 hover:text-white',
              Trf: type === 'Trf' ? 'bg-sky-500 text-white' : 'text-slate-400 hover:text-white',
            };
            return (
              <button key={t} type="button" onClick={() => setType(t)}
                className={`flex-1 py-2 rounded-xl text-sm font-semibold transition-colors ${colors[t]}`}>
                {labels[t]}
              </button>
            );
          })}
        </div>

        {/* Scrollable form body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Amount button */}
          <button
            type="button"
            onClick={() => setShowCalc(v => !v)}
            className={`w-full text-center py-4 rounded-xl border-2 transition-colors
              ${showCalc
                ? 'border-violet-500 bg-violet-500/10'
                : 'border-slate-700 bg-slate-800 hover:border-slate-600'}`}
          >
            <p className="text-xs text-slate-400 mb-0.5">Amount</p>
            <p className={`text-2xl font-bold ${amount > 0 ? 'text-white' : 'text-slate-600'}`}>
              {amount > 0 ? fmt(amount) : 'Tap to enter'}
            </p>
          </button>

          {/* Inline Calculator */}
          {showCalc && (
            <Calculator
              initialValue={amount}
              onConfirm={(v) => { setAmount(v); setShowCalc(false); }}
              onCancel={() => setShowCalc(false)}
            />
          )}

          {/* Date & Time */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 text-white text-sm rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Time</label>
              <input type="time" value={time} onChange={e => setTime(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 text-white text-sm rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent" />
            </div>
          </div>

          {/* Note with autocomplete */}
          <div className="relative">
            <label className="block text-xs text-slate-400 mb-1">Note</label>
            <input
              ref={noteRef}
              type="text"
              value={note}
              onChange={e => handleNoteChange(e.target.value)}
              onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true); }}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
              placeholder="What was this for?"
              className="w-full bg-slate-800 border border-slate-700 text-white text-sm rounded-xl px-3 py-2.5 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
            />
            {showSuggestions && (
              <div className="absolute z-20 top-full mt-1 w-full bg-slate-800 border border-slate-700 rounded-xl shadow-xl overflow-hidden">
                {suggestions.map((s, i) => (
                  <button key={i} type="button"
                    onMouseDown={() => applySuggestion(s)}
                    className="w-full text-left px-3 py-2.5 hover:bg-slate-700 transition-colors">
                    <p className="text-sm text-white">{s.note}</p>
                    <p className="text-xs text-slate-500">{s.category} · {s.account}</p>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Account */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">Account</label>
            <select value={account} onChange={e => setAccount(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 text-white text-sm rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent">
              {ACCOUNTS.map(a => <option key={a}>{a}</option>)}
            </select>
          </div>

          {/* Category */}
          <div>
            <label className="block text-xs text-slate-400 mb-2">Category</label>
            <div className="flex flex-wrap gap-2">
              {categories.map(c => (
                <button key={c} type="button" onClick={() => setCategory(c)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors
                    ${category === c
                      ? 'bg-violet-600 text-white'
                      : 'bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700'}`}>
                  {c}
                </button>
              ))}
            </div>
          </div>

          {/* Subcategory */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">Subcategory</label>
            <input type="text" value={subcategory} onChange={e => setSubcategory(e.target.value)}
              placeholder="Optional"
              className="w-full bg-slate-800 border border-slate-700 text-white text-sm rounded-xl px-3 py-2.5 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent" />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">
              {type === 'Trf' ? 'Transfer To' : 'Description'}
            </label>
            <input type="text" value={description} onChange={e => setDescription(e.target.value)}
              placeholder={type === 'Trf' ? 'Destination account…' : 'Additional notes…'}
              className="w-full bg-slate-800 border border-slate-700 text-white text-sm rounded-xl px-3 py-2.5 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent" />
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-slate-700/50">
          <button
            onClick={handleSubmit}
            disabled={saving}
            className={`w-full py-3.5 rounded-xl font-bold text-sm text-white transition-colors
              ${saving ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-90'}
              ${type === 'Exp' ? 'bg-rose-500' :
                type === 'Inc' ? 'bg-emerald-500' : 'bg-sky-500'}`}
          >
            {saving ? 'Saving…' : editingTransaction ? 'Update Transaction' : 'Save Transaction'}
          </button>
        </div>
      </div>
    </div>
  );
}
