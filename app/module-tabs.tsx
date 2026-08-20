"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { moduleConfig, type ModuleName, type ModuleTab, type Role } from "./navigation-config";

function tabPath(tab:ModuleTab){return tab.href.split("?")[0].split("#")[0];}
function isActive(pathname:string,currentView:string,tab:ModuleTab){
  const path=tabPath(tab);
  if(tab.view)return pathname===path&&currentView===tab.view;
  return tab.exact?pathname===path:pathname===path||pathname.startsWith(`${path}/`);
}

export default function ModuleTabs({ module }: { module: ModuleName }) {
  const pathname=usePathname();
  const [role,setRole]=useState<Role|null>(null);
  const [currentView,setCurrentView]=useState("invoices");
  const resolvedModule:ModuleName=module==="parts"&&pathname.startsWith("/invoices")?"billing":module;

  useEffect(()=>{
    let cancelled=false;
    void fetch("/api/auth/me",{cache:"no-store"})
      .then(async response=>response.ok?await response.json() as{user?:{role:Role}}:{})
      .then(payload=>{if(!cancelled)setRole(payload.user?.role??null);})
      .catch(()=>{if(!cancelled)setRole(null);});
    return()=>{cancelled=true;};
  },[]);

  useEffect(()=>{
    if(resolvedModule!=="billing"){setCurrentView("");return;}
    const value=new URLSearchParams(window.location.search).get("view");
    setCurrentView(value==="ready"||value==="settings"?value:"invoices");
  },[pathname,resolvedModule]);

  if(pathname.startsWith("/work-orders/print")||pathname.startsWith("/invoices/print")||pathname.startsWith("/annual-inspections/print"))return null;

  const config=moduleConfig[resolvedModule];
  const tabs=role?config.tabs.filter(tab=>tab.roles.includes(role)):[];
  if(tabs.length<2)return null;

  return <nav className="module-tabs-shell" aria-label={config.label}>
    {tabs.map(tab=>{
      const active=isActive(pathname,currentView,tab);
      return <a key={tab.href} href={tab.href} className={active?"active":""} aria-current={active?"page":undefined}>{tab.label}</a>;
    })}
  </nav>;
}
