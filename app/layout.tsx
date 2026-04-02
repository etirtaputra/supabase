import type { Metadata } from "next";

export const metadata: Metadata = {
  title: {
    template: '%s | ICA',
    default: 'ICA Supply Chain',
  },
  description: "ICA Supply Chain Management System",
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
