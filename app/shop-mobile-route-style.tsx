"use client";

import { usePathname } from "next/navigation";

export default function ShopMobileRouteStyle(){
  const pathname=usePathname();
  const shopRoute=pathname==="/shop"||pathname.startsWith("/shop/");
  if(!shopRoute)return null;

  return <style>{`
    @media (max-width: 900px) {
      .app-sidebar { display: none !important; }
      .app-shell-content {
        margin-left: 0 !important;
        padding-bottom: calc(84px + env(safe-area-inset-bottom)) !important;
      }
      html, body { min-width: 0; width: 100%; overflow-x: hidden; }
    }
  `}</style>;
}
