import type { ReactNode } from "react";
import YardScopeBanner from "./yard-scope-banner";
import "./tech-workflow.css";

export default function ShopLayout({children}:{children:ReactNode}){
  return <div className="tech-shop-shell">
    <YardScopeBanner />
    {children}
  </div>;
}
