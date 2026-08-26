/**
 * The language switch has to move the WHOLE app.
 *
 * On 2026-08-25 it moved exactly one thing: itself. `useLanguage()` kept the
 * personal pick in a `useState`, so every caller of the hook held a private
 * copy — and `useT()` is a caller, as is the EN/ID switch in `BrandMenu`.
 * Pressing EN updated the switch's copy, lit the button, and left every
 * translated string on the page reading the other language.
 *
 * These tests are about the thing that failed: not "does the value change",
 * but "does EVERYONE ELSE hear that it changed".
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  subscribeLang, getPersonalLang, getHouseLangCache, hydrateLangFromStorage,
  setPersonalLang, cacheHouseLang, resetLangStore,
  LANG_STORAGE_KEY, LANG_DEFAULT_KEY,
} from './language.ts';

/** A localStorage that behaves, or one that throws like a locked-down browser. */
const fakeWindow = (seed: Record<string, string> = {}, throws = false) => {
  const store = new Map(Object.entries(seed));
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (k: string) => { if (throws) throw new Error('denied'); return store.get(k) ?? null; },
      setItem: (k: string, v: string) => { if (throws) throw new Error('denied'); store.set(k, v); },
      removeItem: (k: string) => { if (throws) throw new Error('denied'); store.delete(k); },
    },
  };
  return store;
};

beforeEach(() => { resetLangStore(); fakeWindow(); });

test('every subscriber hears a switch, not just the one that flipped it', () => {
  // Two subscribers stand in for the two independent `useLanguage()` callers
  // that made this bug: the EN/ID switch, and a screen rendering through t().
  const heard: string[] = [];
  subscribeLang(() => heard.push(`switch:${getPersonalLang()}`));
  subscribeLang(() => heard.push(`screen:${getPersonalLang()}`));

  setPersonalLang('id');

  assert.deepEqual(heard, ['switch:id', 'screen:id'],
    'a language switch that only reaches its own component has not switched the app');
  assert.equal(getPersonalLang(), 'id');
});

test('the pick survives as one value, whoever asks', () => {
  setPersonalLang('id');
  assert.equal(getPersonalLang(), 'id');
  setPersonalLang('en');
  assert.equal(getPersonalLang(), 'en');
  // null = "this browser has never chosen", which hands the answer back to the
  // company default rather than pinning English.
  setPersonalLang(null);
  assert.equal(getPersonalLang(), null);
});

test('choosing the language you are already reading wakes nobody', () => {
  setPersonalLang('id');
  let woken = 0;
  subscribeLang(() => { woken += 1; });
  setPersonalLang('id');
  cacheHouseLang('en');
  cacheHouseLang('en');
  assert.equal(woken, 1, 'only the house-cache change was real; a no-op must not re-render the app');
});

test('the stored pick is read once, and read from storage', () => {
  fakeWindow({ [LANG_STORAGE_KEY]: 'id', [LANG_DEFAULT_KEY]: 'en' });
  let woken = 0;
  subscribeLang(() => { woken += 1; });

  hydrateLangFromStorage();
  assert.equal(getPersonalLang(), 'id');
  assert.equal(getHouseLangCache(), 'en');
  assert.equal(woken, 1);

  // Every consumer calls this from its own layout effect; it must cost nothing.
  hydrateLangFromStorage();
  hydrateLangFromStorage();
  assert.equal(woken, 1);
});

test('a browser that has never chosen reports no pick, not English', () => {
  hydrateLangFromStorage();
  assert.equal(getPersonalLang(), null,
    'null is what lets the company default answer; a defaulted "en" would silently outrank it');
});

test('rubbish in storage is ignored rather than rendered', () => {
  fakeWindow({ [LANG_STORAGE_KEY]: 'klingon' });
  hydrateLangFromStorage();
  assert.equal(getPersonalLang(), null);
});

test('a browser that refuses storage still switches — it just forgets', () => {
  fakeWindow({}, true);
  const heard: string[] = [];
  subscribeLang(() => heard.push(String(getPersonalLang())));
  setPersonalLang('id');
  assert.equal(getPersonalLang(), 'id', 'private mode must not break the switch, only its memory');
  assert.deepEqual(heard, ['id']);
});

test('unsubscribing stops the notifications', () => {
  let woken = 0;
  const off = subscribeLang(() => { woken += 1; });
  setPersonalLang('id');
  off();
  setPersonalLang('en');
  assert.equal(woken, 1);
});
