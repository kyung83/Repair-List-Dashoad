"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

type User = { id:number; username:string; email:string; displayName:string; role:"viewer"|"mechanic"|"manager"|"admin" };
type Link = { href:string; label:string; exact?:boolean; activeFor?:string[] };

const managerPrimary: Link[] = [
  { href:"/shop", label:"My Jobs" },
  { href:"/repair-board", label:"Shop Board", activeFor:["/work-orders"] },
  { href:"/unit", label:"Units", activeFor:["/equipment"] },
  { href:"/pm-schedules", label:"Maintenance", activeFor:["/pm-kits","/annual-schedules","/annual-inspections","/next-pm-repairs"] },
  { href:"/parts-desk", label:"Parts", activeFor:["/inventory","/invoices"] },
  { href:"/reports", label:"Reports" },
];

const mechanicPrimary: Link[] = [
  { href:"/shop", label:"My Jobs" },
  { href:"/repair-board", label:"Repair Board" },
  { href:"/unit", label:"Find Unit" },
  { href:"/annual-inspections", label:"Forms" },
];

const viewerPrimary: Link[] = [
  { href:"/unit", label:"Units", activeFor:["/equipment"] },
  { href:"/work-orders", label:"Completed Work" },
  { href:"/annual-inspections", label:"Annual Forms" },
  { href:"/reports", label:"Reports" },
];

function isActive(pathname:string, link:Link){
  if(link.exact)return pathname===link.href;
  return [link.href,...(link.activeFor??[])].some(path=>pathname===path||pathname.startsWith(`${path}/`));
}

export default function AppNav(){
  const pathname=usePathname();
  const [user,setUser]=useState<User|null>(null);
  const hidden=pathname==="/login"||pathname==="/setup"||pathname.startsWith("/photos")||pathname.startsWith("/annual-inspections/print");

  useEffect(()=>{
    if(hidden)return;
    void fetch('/api/auth/me',{cache:'no-store'})
      .then(async response=>response.ok?(await response.json() as{user:User}).user:null)
      .then(setUser).catch(()=>setUser(null));
  },[hidden,pathname]);

  async function signOut(){
    await fetch('/api/auth/logout',{method:'POST'}).catch(()=>undefined);
    window.location.assign('/login');
  }

  if(hidden)return null;
  const primary=user?.role==='mechanic'?mechanicPrimary:user?.role==='viewer'?viewerPrimary:managerPrimary;
  const more:Link[] = user?.role==='admin' ? [
    { href:"/admin/users", label:"Users & Access" },
    { href:"/admin/geotab-review", label:"Geotab Review" },
    { href:"/admin/equipment-merge", label:"Equipment Fork Merge" },
    { href:"/admin/history-import", label:"History Import" },
  ] : [];

  return <header className="easy-nav">
    <a className="app-brand" href={user?.role==='mechanic'?'/shop':'/'} aria-label="Northern Logistics fleet operations home">
      <img className="app-brand-logo" src="/northern-logistics-logo-exact.svg?v=1" alt="Northern Logistics Worldwide" />
    </a>
    <nav className="easy-nav-main" aria-label="Main navigation">
      {primary.map(link=><a key={link.href} href={link.href} className={`easy-nav-link ${isActive(pathname,link)?'active':''}`}>{link.label}</a>)}
      {more.length>0&&<details className="easy-more">
        <summary className="easy-nav-link">More ▾</summary>
        <div className="easy-more-menu">
          {more.map(link=><a key={link.href} href={link.href}>{link.label}</a>)}
        </div>
      </details>}
    </nav>
    {user&&<div className="app-user-area">
      <span className="app-user-name" title={user.username||user.email}>{user.displayName}<small className="easy-role">{user.role}</small></span>
      <button type="button" onClick={()=>void signOut()}>Sign out</button>
    </div>}
  </header>;
}