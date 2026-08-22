import type { Metadata, Viewport } from "next";
import GlobalSpotlight from "@/components/ui/GlobalSpotlight";
import SettingsLoader from "@/components/ui/SettingsLoader";
import { THEME_VARS_CSS, TAILWIND_COLORS_JS } from "@/constants/palette";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: {
    template: '%s — ICAPROC',
    default: 'ICAPROC',
  },
  description: "ICAPROC Supply Chain Management",
};

// Without this, mobile browsers assume a desktop-width canvas and zoom the
// whole app out. device-width lets the responsive Tailwind breakpoints work;
// user scaling stays enabled for accessibility.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0f1012',
};

/**
 * Theme: kaspa.stream-inspired dark — neutral graphite surfaces, hairline
 * borders, Kaspa teal (#49EACB) as the primary accent, Rubik type with
 * Roboto Mono for identifiers. Every colour scale the app uses is REMAPPED to
 * CSS variables (see constants/palette.ts), so the whole skin — all ~4,200
 * class sites — follows one `data-theme` attribute on <html>. Dark is the
 * default and is exactly what it always was; light reads the same ramps from
 * the other end. (The client-facing print/PDF keeps its own corporate navy
 * styling in raw CSS and is untouched by either.)
 */
const TAILWIND_THEME = `
tailwind.config = {
  theme: {
    extend: {
      // The typeface is a THEME token, not a constant: the house skins keep
      // Rubik, the terminal pair switches to Inter with monospaced figures.
      // Both resolve through one variable set per theme in the palette.
      fontFamily: {
        sans: ['var(--font-app)', 'Rubik', 'Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['var(--font-mono-app)', 'Roboto Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      colors: ${TAILWIND_COLORS_JS},
    },
  },
};
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Rubik:wght@300;400;500;600;700;800&family=Roboto+Mono:wght@400;500;600&family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
        {/* The palette must exist before Tailwind's utilities reference it, and
            the stored choice must be applied before the first paint — a flash
            of the wrong theme on every load is worse than no theme at all. */}
        <style dangerouslySetInnerHTML={{ __html: THEME_VARS_CSS }} />
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        <script src="https://cdn.tailwindcss.com"></script>
        <script dangerouslySetInnerHTML={{ __html: TAILWIND_THEME }} />
        <style dangerouslySetInnerHTML={{ __html: `
          body { background: rgb(var(--c-app-bg)); font-family: var(--font-app, Rubik), Rubik, Inter, system-ui, -apple-system, 'Segoe UI', sans-serif; }
          /* Form controls and scrollbars are painted by the browser, not by a
             utility class, so they need telling which skin is in play. */
          :root { color-scheme: dark; }
          :root[data-theme="light"], :root[data-theme="paper"], :root[data-theme="terminal-light"] { color-scheme: light; }
          :root[data-theme="terminal"] { color-scheme: dark; }
          /* iOS zooms into any focused field whose text is under 16px. Force
             16px on phones so tapping a search bar / input never zooms. The
             !important is needed to beat Tailwind's text-xs/text-sm utilities. */
          @media (max-width: 767px) {
            input:not([type=checkbox]):not([type=radio]):not([type=range]),
            textarea, select { font-size: 16px !important; }
          }
          /* iOS/WebKit centers the value of date inputs and gives them their
             own height, which mis-aligns them next to text inputs (Quote/PO
             headers on mobile). Left-align and normalize the appearance. */
          input[type="date"] {
            -webkit-appearance: none;
            appearance: none;
            text-align: left;
            min-height: 1.5em;
          }
          input[type="date"]::-webkit-date-and-time-value {
            text-align: left;
            margin: 0;
          }
          /* Compact list density for tables — one class instead of touching
             every cell, so a table can switch density without markup churn. */
          table.dense-rows td { padding-top: 0.25rem; padding-bottom: 0.25rem; }
          table.dense-rows th { padding-top: 0.35rem; padding-bottom: 0.35rem; }
          /* Horizontally scrollable tab strips: keep the gesture, drop the bar */
          .scrollbar-none { -ms-overflow-style: none; scrollbar-width: none; }
          .scrollbar-none::-webkit-scrollbar { display: none; }
          /* Room for the fixed mobile bottom nav (BrandMenu adds this class) */
          @media (max-width: 767px) {
            body.has-bottom-nav { padding-bottom: calc(58px + env(safe-area-inset-bottom)); }
          }
        ` }} />
      </head>
      <body>
        {children}
        <SettingsLoader />
        <GlobalSpotlight />
      </body>
    </html>
  );
}
