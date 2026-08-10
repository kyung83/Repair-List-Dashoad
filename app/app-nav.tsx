"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

type User = { id:number; username:string; email:string; displayName:string; role:"viewer"|"mechanic"|"manager"|"admin" };
const links=[{href:"/shop",label:"Shop Jobs"},{href:"/repair-board",label:"Repair Board",exact:true},{href:"/work-orders",label:"Work Orders"},{href:"/equipment",label:"Equipment"},{href:"/pm-schedules",label:"PM Schedules"},{href:"/inventory",label:"Inventory"},{href:"/invoices",label:"Invoices"},{href:"/reports",label:"Reports",exact:true},{href:"/reports/history",label:"RO History"}] as const;

export default function AppNav(){
 const pathname=usePathname();const[user,setUser]=useState<User|null>(null);const hidden=pathname==="/login"||pathname==="/setup"||pathname.startsWith("/photos");
 useEffect(()=>{if(hidden)return;void fetch('/api/auth/me',{cache:'no-store'}).then(async response=>response.ok?(await response.json() as{user:User}).user:null).then(setUser).catch(()=>setUser(null));},[hidden]);
 async function signOut(){await fetch('/api/auth/logout',{method:'POST'}).catch(()=>undefined);window.location.assign('/login');}
 if(hidden)return null;
 return <header className="app-topnav"><a className="app-brand" href="/repair-board" aria-label="Norlow Fleet Operations repair board"><span className="app-brand-mark">N</span><span><strong>NORLOW</strong><small>Fleet Operations</small></span></a><nav className="app-primary-links" aria-label="Main navigation">{links.map(link=>{const active=link.exact?pathname===link.href:pathname.startsWith(link.href);return <a key={link.href} href={link.href} className={active?'active':undefined}>{link.label}</a>;})}{user?.role==='admin'&&<a href="/admin/users" className={pathname.startsWith('/admin/users')?'active':undefined}>Users</a>}</nav>{user&&<div className="app-user-area"><span className="app-user-name" title={user.username||user.email}>{user.displayName}<small>{user.username?`@${user.username}`:user.role}</small></span><button type="button" onClick={()=>void signOut()}>Sign out</button></div>}</header>;
}
