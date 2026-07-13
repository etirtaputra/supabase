import type { Metadata } from "next";

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: {
    template: '%s | ICAPROC',
    default: 'ICAPROC',
  },
  description: "ICAPROC Supply Chain Management",
};

/**
 * Theme: kaspa.stream-inspired dark — neutral graphite surfaces, hairline
 * borders, Kaspa teal (#49EACB) as the primary accent, Rubik type with
 * Roboto Mono for identifiers. The palettes below REMAP Tailwind's stock
 * scales so every existing slate/emerald/violet class site re-skins at once.
 * (The client-facing print/PDF keeps its own corporate navy styling.)
 */
const TAILWIND_THEME = `
tailwind.config = {
  theme: {
    extend: {
      fontFamily: {
        sans: ['Rubik', 'Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['Roboto Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      colors: {
        slate: {
          50:'#f7f7f8',100:'#f0f0f2',200:'#e1e2e5',300:'#c3c5ca',400:'#9a9da4',
          500:'#6e7178',600:'#4a4c52',700:'#333539',800:'#26272b',900:'#1b1c1f',950:'#0e0f11',
        },
        emerald: {
          50:'#effdf9',100:'#d7faf0',200:'#aff5e2',300:'#7defd3',400:'#49eacb',
          500:'#2bd4b4',600:'#1cb497',700:'#17937c',800:'#187463',900:'#175d51',950:'#0b332c',
        },
        violet: {
          50:'#f4f4fe',100:'#e9eafd',200:'#d6d8fa',300:'#b3b8f5',400:'#9297ec',
          500:'#7a7fe0',600:'#6366d9',700:'#5052c4',800:'#4244a0',900:'#3a3c80',950:'#23234d',
        },
      },
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
        <link href="https://fonts.googleapis.com/css2?family=Rubik:wght@300;400;500;600;700;800&family=Roboto+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
        <script src="https://cdn.tailwindcss.com"></script>
        <script dangerouslySetInnerHTML={{ __html: TAILWIND_THEME }} />
        <style dangerouslySetInnerHTML={{ __html: `
          body { background: #141518; font-family: Rubik, Inter, system-ui, -apple-system, 'Segoe UI', sans-serif; }
        ` }} />
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}
