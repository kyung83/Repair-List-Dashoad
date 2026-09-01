import type { ReactNode } from "react";
import YardScopeBanner from "./yard-scope-banner";

export default function ShopLayout({children}:{children:ReactNode}){
  return <>
    <YardScopeBanner />
    {children}
  </>;
}
