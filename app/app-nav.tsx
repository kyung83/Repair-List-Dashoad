"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

type User = { id:number; username:string; email:string; displayName:string; role:"viewer"|"mechanic"|"manager"|"admin" };
type Link = { href:string; label:string; exact?:boolean };

const managerPrimary: Link[] = [
  { href:"/", label:"Today", exact:true },
  { href:"/repair-board", label:"Shop" },
  { href:"/unit", label:"Units" },
  { href:"/next-pm-repairs", label:"Future Repairs" },
  { href:"/reports/history", label:"History" },
];

const mechanicPrimary: Link[] = [
  { href:"/shop", label:"My Jobs" },
  { href:"/unit", label:"Find Unit" },
  { href:"/annual-inspections", label:"Forms" },
];

function isActive(pathname:string, link:Link){
  return link.exact ? pathname === link.href : pathname === link.href || pathname.startsWith(`${link.href}/`);
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
  const canManage=user?.role==='manager'||user?.role==='admin';
  const primary=user?.role==='mechanic'?mechanicPrimary:managerPrimary;
  const more:Link[] = canManage ? [
    { href:"/work-orders", label:"Completed Work / WO Review" },
    { href:"/equipment", label:"Equipment List & Details" },
    { href:"/pm-schedules", label:"Maintenance Setup" },
    { href:"/annual-inspections", label:"Annual Forms" },
    { href:"/inventory", label:"Parts Inventory" },
    { href:"/invoices", label:"Invoices" },
    { href:"/reports", label:"Reports" },
    { href:"/pm-kits", label:"PM Kits" },
  ] : user?.role==='viewer' ? [
    { href:"/work-orders", label:"Completed Work" },
    { href:"/equipment", label:"Equipment List" },
    { href:"/annual-inspections", label:"Annual Forms" },
    { href:"/reports", label:"Reports" },
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
          {more.map((link,index)=><span key={link.href} style={{display:"contents"}}>{index===4&&canManage?<span className="easy-more-divider"/>:null}<a href={link.href}>{link.label}</a></span>)}
          {user?.role==='admin'&&<><span className="easy-more-divider"/><a href="/admin/users">Users & Access</a></>}
        </div>
      </details>}
    </nav>
    {user&&<div className="app-user-area">
      <span className="app-user-name" title={user.username||user.email}>{user.displayName}<small className="easy-role">{user.role}</small></span>
      <button type="button" onClick={()=>void signOut()}>Sign out</button>
    </div>}
  </header>;
}
