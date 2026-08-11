import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import AppNav from "./app-nav";
import "./globals.css";
import "./professional-shell.css";
import "./northern-brand.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Northern Logistics Fleet Operations",
  description: "Northern Logistics fleet repair, DVIR, PM, work orders, inventory, reporting, labor, and equipment operations.",
  other: { "codex-preview": "development" },
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <AppNav />
        <script dangerouslySetInnerHTML={{ __html: `document.addEventListener('click',function(event){var target=event.target;if(!(target instanceof Element))return;var link=target.closest('a[href^="geotab-media:"]');if(!link)return;event.preventDefault();var raw=link.getAttribute('href')||'';var ids=raw.slice('geotab-media:'.length);if(ids){window.open('/photos?ids='+encodeURIComponent(ids),'_blank','noopener,noreferrer');}});` }} />
        {children}
      </body>
    </html>
  );
}
