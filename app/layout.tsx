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
  // The default skin's page colour — what a phone paints around the app.
  themeColor: '#0a0b0d',
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

          /* ── The dropdown chevron (owner, 2026-08-26: "too close to the
                border, for all dropdown menus") ──────────────────────────────

             Chrome pins its own arrow FIVE pixels from the border and ignores
             padding-right entirely — measured at px-3, pr-7, pr-8 and pr-9,
             the arrow ended 5px from the edge in all four. Padding moves the
             text, never the arrow. So the only way to give it room is to take
             the arrow off the browser and draw it ourselves.

             Done HERE rather than in 141 places: there are 141 select
             elements across ~20 locally-defined class constants, with no
             shared select class to edit. One rule covers every one of them,
             every screen that gets added later, and Safari/iOS too — where
             the native arrow was a different shape from Chrome's anyway.

             ":not(.appearance-none)" leaves alone the handful that already
             opt out and arrange their own (the EPC status pill is
             "appearance-none text-center" and wants NO chevron at all). The
             specificity — element + class — beats Tailwind's px-* utilities,
             which is what lets one rule override every authored padding.

             The colour is a variable so the chevron follows the skin; a
             data-URI cannot interpolate a var(), so the whole url() is the
             variable. */
          :root { --select-chevron: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M19 9l-7 7-7-7'/%3E%3C/svg%3E"); }
          :root[data-theme="light"], :root[data-theme="paper"], :root[data-theme="terminal-light"] {
            --select-chevron: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23475569' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M19 9l-7 7-7-7'/%3E%3C/svg%3E");
          }
          select:not([multiple]):not([size]):not(.appearance-none) {
            -webkit-appearance: none;
            appearance: none;
            background-image: var(--select-chevron);
            background-repeat: no-repeat;
            /* The chevron path fills only the middle 14/24 of its own box, so
               the BOX is 15px to draw a glyph ~8.8px wide — the same visual
               weight as the 8.5px arrow Chrome was drawing. Offsetting the box
               by 9px lands the glyph's right edge 12px from the border, which
               is the inset the text gets on the other side. */
            background-position: right 9px center;
            background-size: 15px 15px;
            /* The glyph's LEFT edge lands 21px in; 28px keeps 7px of air
               between it and the longest option text. */
            padding-right: 1.75rem;
          }
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
