export const LS_DISPLAY = 'money_display_v1';

export interface DisplaySettings {
  currencySymbol: string;   // e.g. 'Rp', 'IDR', '$'
  locale: string;           // e.g. 'id-ID', 'en-US'
  useFullNumbers: boolean;  // true = full digits, false = K/M/B abbreviations
}

export const DISPLAY_DEFAULTS: DisplaySettings = {
  currencySymbol: 'Rp',
  locale: 'id-ID',
  useFullNumbers: true,
};

function lsGet<T>(key: string, fb: T): T {
  try {
    if (typeof window === 'undefined') return fb;
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fb;
  } catch { return fb; }
}

export function loadDisplay(): DisplaySettings {
  return { ...DISPLAY_DEFAULTS, ...lsGet<Partial<DisplaySettings>>(LS_DISPLAY, {}) };
}

export function saveDisplay(s: DisplaySettings): void {
  try { localStorage.setItem(LS_DISPLAY, JSON.stringify(s)); } catch { /* ignore */ }
}

export function fmtAmount(n: number, settings: DisplaySettings, forceShow = false): string {
  if (n === 0) return forceShow ? `${settings.currencySymbol} 0` : '—';
  const abs = Math.abs(n);
  let s: string;
  if (settings.useFullNumbers) {
    s = new Intl.NumberFormat(settings.locale).format(abs);
  } else {
    if      (abs >= 1e9) s = `${(abs / 1e9).toFixed(1)}B`;
    else if (abs >= 1e6) s = `${(abs / 1e6).toFixed(1)}M`;
    else if (abs >= 1e3) s = `${(abs / 1e3).toFixed(1)}K`;
    else                 s = abs.toFixed(0);
  }
  const formatted = `${settings.currencySymbol} ${s}`;
  return n < 0 ? `(${formatted})` : formatted;
}
