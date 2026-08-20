import type { ReactNode } from "react";
import ModuleTabs from "../module-tabs";
import YardScopeBanner from "./yard-scope-banner";

export default function ShopLayout({children}:{children:ReactNode}){
  return <>
    <div style={{background:'#f3f5f7',padding:'26px clamp(16px,4vw,46px) 0'}}><ModuleTabs module="shop"/></div>
    <YardScopeBanner />
    {children}
  </>;
}
