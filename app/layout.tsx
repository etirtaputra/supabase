import type { Metadata } from "next";

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: {
    template: '%s | ICAPROC',
    default: 'ICAPROC',
  },
  description: "ICAPROC Supply Chain Management",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <script src="https://cdn.tailwindcss.com"></script>
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}
