'use client';
/**
 * Subscribe a component to the active theme.
 *
 * Returns the SSR default on the server and on the very first client render,
 * then corrects in an effect — reading localStorage during render would make
 * the markup differ from the server's and trip hydration. The paint itself
 * never waits for this: `THEME_BOOT_SCRIPT` has already set the attribute
 * before React runs, so the hook only keeps the toggle's icon honest.
 */
import { useEffect, useState } from 'react';
import { DEFAULT_THEME, getTheme, initTheme, setTheme, subscribeTheme, toggleTheme, type ThemeName } from '@/lib/theme';

export function useTheme(): { theme: ThemeName; setTheme: (t: ThemeName) => void; toggle: () => void } {
  const [theme, setLocal] = useState<ThemeName>(DEFAULT_THEME);

  useEffect(() => {
    setLocal(initTheme());
    return subscribeTheme(setLocal);
  }, []);

  return {
    theme,
    setTheme: (t: ThemeName) => { setTheme(t); },
    toggle: () => { toggleTheme(); },
  };
}

export { getTheme };
