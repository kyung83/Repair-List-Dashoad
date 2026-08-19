"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

type User = { id:number; username:string; email:string; displayName:string; role:"viewer"|"mechanic"|"manager"|"admin" };
type Link = { href:string; label:string; exact?:boolean; activeFor?:string[] };
type GeotabHealth = {
  status:"healthy"|"attention"|string;
  mode:string;
  summary:{ expected:number; structured:number; live:number; recent:number; stale:number; noData:number; offline:number; identityErrors:number; regression:number };
};

const managerPrimary: Link[] = [
  { href:"/shop", label:"My Jobs" },
  { href:"/repair-board", label:"Shop Board", activeFor:["/work-orders"] },
  { href:"/repair-corrections", label:"Repair Corrections" },
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
  const [health,setHealth]=useState<GeotabHealth|null>(null);
  const hidden=pathname==="/login"||pathname==="/setup"||pathname.startsWith("/photos")||pathname.startsWith("/annual-inspections/print");

  useEffect(()=>{
    if(hidden)return;
    void fetch('/api/auth/me',{cache:'no-store'})
      .then(async response=>response.ok?(await response.json() as{user:User}).user:null)
      .then(setUser).catch(()=>setUser(null));
  },[hidden,pathname]);

  useEffect(()=>{
    if(!user||(user.role!=="manager"&&user.role!=="admin")){setHealth(null);return;}
    let cancelled=false;
    async function loadHealth(){
      try{
        const response=await fetch('/api/geotab-health',{cache:'no-store'});
        if(!response.ok)throw new Error('Health check unavailable');
        const result=await response.json() as GeotabHealth;
        if(!cancelled)setHealth(result);
      }catch{
        if(!cancelled)setHealth({status:'attention',mode:'shadow',summary:{expected:0,structured:0,live:0,recent:0,stale:0,noData:0,offline:0,identityErrors:0,regression:0}});
      }
    }
    void loadHealth();
    const timer=window.setInterval(()=>void loadHealth(),120000);
    return()=>{cancelled=true;window.clearInterval(timer);};
  },[user]);

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
  const healthTitle=health
    ? `Geotab ${health.status}. Structured results ${health.summary.structured}/${health.summary.expected}. Live ${health.summary.live}, recent ${health.summary.recent}, stale ${health.summary.stale}, no data ${health.summary.noData}, offline ${health.summary.offline}, identity issues ${health.summary.identityErrors}. GPS reliability pilot is in shadow mode.`
    : '';
  const healthPill=health?<span style={{display:'inline-flex',alignItems:'center',gap:5,padding:'5px 8px',borderRadius:999,fontSize:11,fontWeight:800,letterSpacing:'.03em',whiteSpace:'nowrap',background:health.status==='healthy'?'#eaf7ef':'#fff4dd',border:`1px solid ${health.status==='healthy'?'#9fd2b0':'#e6bd69'}`,color:health.status==='healthy'?'#215c38':'#79540c'}} title={healthTitle}>GEOTAB {health.status==='healthy'?'✓':'⚠'}{health.summary.expected>0?<small style={{fontSize:10,fontWeight:700}}>{health.summary.structured}/{health.summary.expected}</small>:null}</span>:null;

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
      {healthPill&&(user.role==='admin'?<a href="/admin/geotab-review" style={{textDecoration:'none'}} aria-label="Open Geotab reliability review">{healthPill}</a>:healthPill)}
      <span className="app-user-name" title={user.username||user.email}>{user.displayName}<small className="easy-role">{user.role}</small></span>
      <button type="button" onClick={()=>void signOut()}>Sign out</button>
    </div>}
  </header>;
}
