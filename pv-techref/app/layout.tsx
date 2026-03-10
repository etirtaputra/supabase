import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ICA Solar — PV Component Technical Reference",
  description:
    "Internal engineering reference for PV solar components: modules, inverters, batteries, charge controllers.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-[#0f172a] min-h-screen font-sans">
        {children}
      </body>
    </html>
  );
}
