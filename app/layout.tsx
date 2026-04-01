import type { Metadata } from "next";

export const metadata: Metadata = {
  title: {
    template: '%s | Family Tree',
    default: 'Family Tree Tracker',
  },
  description: "Track your family tree, relationships, and locations",
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
