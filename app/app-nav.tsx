"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { sidebarGroupsForRole, type NavLink, type Role, type SidebarGroup } from "./navigation-config";

type User = { id:number; username:string; email:string; displayName:string; role:Role };
type GeotabHealth = {
  status:"healthy"|"attention"|string;
  mode:string;
  summary:{ expected:number; structured:number; live:number; recent:number; stale:number; noData:number; offline:number; identityErrors:number; regression:number };
};

type IconName = SidebarGroup["key"];

function pathOnly(href:string){return href.split("?")[0].split("#")[0];}
function linkActive(pathname:string,currentView:string,link:NavLink){
  const href=pathOnly(link.href);
  if(link.view)return pathname===href&&currentView===link.view;
  if(link.exact)return pathname===href;
  return pathname===href||pathname.startsWith(`${href}/`);
}
function groupActive(pathname:string,currentView:string,group:SidebarGroup){
  // Breakdown reporting belongs to the Breakdown workflow even though its URL lives under /reports.
  if(pathname.startsWith("/reports/breakdowns"))return group.key==="breakdowns";
  const rootLink=group.links.find(link=>link.href===group.href);
  const rootActive=rootLink?linkActive(pathname,currentView,rootLink):pathname===pathOnly(group.href);
  return rootActive||group.links.some(link=>linkActive(pathname,currentView,link));
}
function initials(name:string){
  const parts=name.trim().split(/\s+/).filter(Boolean);
  return (parts.length>1?`${parts[0][0]}${parts[parts.length-1][0]}`:parts[0]?.slice(0,2)||"NL").toUpperCase();
}

function SidebarIcon({name}:{name:IconName}){
  const common={width:22,height:22,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:2,strokeLinecap:"round" as const,strokeLinejoin:"round" as const,"aria-hidden":true};
  if(name==="repairs")return <svg {...common}><path d="M14.7 6.3a4 4 0 0 0-5-5L7.4 3.6l3 3-3.8 3.8-3-3L1.3 9.7a4 4 0 0 0 5 5l6.4 6.4a2 2 0 0 0 2.8-2.8l-6.4-6.4"/><path d="m16 16 2 2"/></svg>;
  if(name==="breakdowns")return <svg {...common}><path d="M10.3 2.9 1.8 17a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 2.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>;
  if(name==="maintenance")return <svg {...common}><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/><path d="m9 16 2 2 4-4"/></svg>;
  if(name==="units")return <svg {...common}><path d="M3 6h11v10H3zM14 9h4l3 3v4h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/></svg>;
  if(name==="parts")return <svg {...common}><path d="m12 2 8 4-8 4-8-4 8-4Z"/><path d="m4 10 8 4 8-4M4 14l8 4 8-4"/></svg>;
  if(name==="reports")return <svg {...common}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>;
  return <svg {...common}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></svg>;
}

export default function AppNav(){
  const pathname=usePathname();
  const [user,setUser]=useState<User|null>(null);
  const [health,setHealth]=useState<GeotabHealth|null>(null);
  const [collapsed,setCollapsed]=useState(()=>pathname.startsWith("/repair-board"));
  const [openGroups,setOpenGroups]=useState<Set<string>>(()=>new Set());
  const [currentView,setCurrentView]=useState("");
  const hidden=pathname==="/login"||pathname==="/setup"||pathname.startsWith("/report-breakdown")||pathname.startsWith("/photos")||pathname.startsWith("/annual-inspections/print")||pathname.startsWith("/work-orders/print")||pathname.startsWith("/invoices/print");

  useEffect(()=>{
    if(hidden)return;
    void fetch('/api/auth/me',{cache:'no-store'})
      .then(async response=>response.ok?(await response.json() as{user:User}).user:null)
      .then(setUser).catch(()=>setUser(null));
  },[hidden,pathname]);

  useEffect(()=>{
    if(hidden)return;
    try{
      const saved=window.localStorage.getItem("northern-sidebar-collapsed");
      if(saved==="1"||saved==="0")setCollapsed(saved==="1");
      else setCollapsed(pathname.startsWith("/repair-board"));
    }catch{
      setCollapsed(pathname.startsWith("/repair-board"));
    }
  },[hidden]);

  useEffect(()=>{
    if(hidden){setCurrentView("");return;}
    if(pathname!=="/invoices"){setCurrentView("");return;}
    const value=new URLSearchParams(window.location.search).get("view");
    setCurrentView(value==="ready"||value==="settings"?value:"invoices");
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

  const groups=useMemo(()=>sidebarGroupsForRole(user?.role??null),[user?.role]);
  useEffect(()=>{
    const active=groups.find(group=>groupActive(pathname,currentView,group));
    if(!active)return;
    setOpenGroups(current=>{
      if(current.has(active.key))return current;
      const next=new Set(current);next.add(active.key);return next;
    });
  },[groups,pathname,currentView]);

  async function signOut(){
    await fetch('/api/auth/logout',{method:'POST'}).catch(()=>undefined);
    window.location.assign('/login');
  }
  function toggleCollapsed(){
    setCollapsed(current=>{
      const next=!current;
      try{window.localStorage.setItem("northern-sidebar-collapsed",next?"1":"0");}catch{}
      return next;
    });
  }
  function toggleGroup(key:string){
    setOpenGroups(current=>{
      const next=new Set(current);next.has(key)?next.delete(key):next.add(key);return next;
    });
  }

  if(hidden)return null;

  const home=user?.role==='mechanic'?'/shop':'/repair-board';
  const healthTitle=health
    ? `Geotab ${health.status}. Structured results ${health.summary.structured}/${health.summary.expected}. Live ${health.summary.live}, recent ${health.summary.recent}, stale ${health.summary.stale}, no data ${health.summary.noData}, offline ${health.summary.offline}, identity issues ${health.summary.identityErrors}.`
    : '';

  return <aside className={`app-sidebar ${collapsed?'collapsed':'expanded'}`} aria-label="Northern Logistics navigation">
    <div className="app-sidebar-head">
      <a className="app-sidebar-brand" href={home} title="Northern Logistics Fleet Operations">
        <span className="app-sidebar-mark">N</span>
        {!collapsed&&<span className="app-sidebar-brand-copy"><strong>Northern Logistics</strong><small>Fleet Operations</small></span>}
      </a>
      <button className="app-sidebar-collapse" type="button" onClick={toggleCollapsed} aria-label={collapsed?'Expand navigation':'Collapse navigation'} title={collapsed?'Expand navigation':'Collapse navigation'}>{collapsed?'›':'‹'}</button>
    </div>

    <nav className="app-sidebar-nav">
      {groups.map(group=>{
        const active=groupActive(pathname,currentView,group);
        const open=!collapsed&&openGroups.has(group.key);
        return <div className={`app-sidebar-group ${active?'active':''}`} key={group.key}>
          <div className="app-sidebar-main-row">
            <a className={`app-sidebar-main-link ${active?'active':''}`} href={group.href} title={collapsed?group.label:undefined} aria-current={active?'page':undefined}>
              <span className="app-sidebar-icon"><SidebarIcon name={group.key}/></span>
              {!collapsed&&<span className="app-sidebar-label">{group.label}</span>}
            </a>
            {!collapsed&&group.links.length>1&&<button className="app-sidebar-chevron" type="button" onClick={()=>toggleGroup(group.key)} aria-label={`${open?'Collapse':'Expand'} ${group.label}`}>{open?'⌄':'›'}</button>}
          </div>
          {open&&<div className="app-sidebar-subnav">
            {group.links.map(link=><a key={link.href} href={link.href} className={linkActive(pathname,currentView,link)?'active':''}>{link.label}</a>)}
          </div>}
        </div>;
      })}
    </nav>

    <div className="app-sidebar-footer">
      {health&&!collapsed&&<a className={`app-sidebar-health ${health.status==='healthy'?'healthy':'attention'}`} href={user?.role==='admin'?'/admin/geotab-review/health':'/repair-board'} title={healthTitle}>
        <span>GEOTAB {health.status==='healthy'?'✓':'⚠'}</span>
        {health.summary.expected>0&&<small>{health.summary.structured}/{health.summary.expected} structured</small>}
      </a>}
      {user&&<div className="app-sidebar-user" title={`${user.displayName} · ${user.role}`}>
        <span className="app-sidebar-avatar">{initials(user.displayName)}</span>
        {!collapsed&&<span className="app-sidebar-user-copy"><strong>{user.displayName}</strong><small>{user.role}</small></span>}
      </div>}
      {user&&<button className="app-sidebar-signout" type="button" onClick={()=>void signOut()} title="Sign out"><span aria-hidden="true">↪</span>{!collapsed&&<span>Sign out</span>}</button>}
    </div>
  </aside>;
}
