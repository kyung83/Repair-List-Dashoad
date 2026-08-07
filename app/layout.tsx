import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Norlow Fleet Operations",
  description: "Fleet repair, direct Geotab DVIR, PM, equipment, work orders, and inventory operations for Norloworld.",
  other: { "codex-preview": "development" },
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <div style={{ position: "fixed", right: 18, bottom: 18, zIndex: 40, display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <a href="/" style={{ padding: "10px 14px", borderRadius: 999, background: "#0d1b2b", color: "white", textDecoration: "none", fontWeight: 800, boxShadow: "0 6px 20px #0003" }}>Repair board</a>
          <a href="/work-orders" style={{ padding: "10px 14px", borderRadius: 999, background: "#29465f", color: "white", textDecoration: "none", fontWeight: 800, boxShadow: "0 6px 20px #0003" }}>Work orders</a>
          <a href="/inventory" style={{ padding: "10px 14px", borderRadius: 999, background: "#f47b20", color: "white", textDecoration: "none", fontWeight: 800, boxShadow: "0 6px 20px #0003" }}>Inventory</a>
        </div>
        {children}
      </body>
    </html>
  );
}
