import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import SessionNav from "./session-nav";
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
        <div style={{ position: "fixed", right: 18, bottom: 18, zIndex: 40, display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end", maxWidth: "calc(100vw - 36px)" }}>
          <a href="/" style={{ padding: "10px 14px", borderRadius: 999, background: "#0d1b2b", color: "white", textDecoration: "none", fontWeight: 800, boxShadow: "0 6px 20px #0003" }}>Repair board</a>
          <a href="/work-orders" style={{ padding: "10px 14px", borderRadius: 999, background: "#29465f", color: "white", textDecoration: "none", fontWeight: 800, boxShadow: "0 6px 20px #0003" }}>Work orders</a>
          <a href="/pm-schedules" style={{ padding: "10px 14px", borderRadius: 999, background: "#3d5a40", color: "white", textDecoration: "none", fontWeight: 800, boxShadow: "0 6px 20px #0003" }}>PM schedules</a>
          <a href="/inventory" style={{ padding: "10px 14px", borderRadius: 999, background: "#f47b20", color: "white", textDecoration: "none", fontWeight: 800, boxShadow: "0 6px 20px #0003" }}>Inventory</a>
          <SessionNav />
        </div>
        <script
          dangerouslySetInnerHTML={{
            __html: `document.addEventListener('click',function(event){var target=event.target;if(!(target instanceof Element))return;var link=target.closest('a[href^="geotab-media:"]');if(!link)return;event.preventDefault();var raw=link.getAttribute('href')||'';var ids=raw.slice('geotab-media:'.length);if(ids){window.open('/photos?ids='+encodeURIComponent(ids),'_blank','noopener,noreferrer');}});`,
          }}
        />
        {children}
      </body>
    </html>
  );
}
