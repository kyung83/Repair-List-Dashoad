"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";

type Role="viewer"|"mechanic"|"manager"|"admin";
type ShopUser={role:Role;technicianId:number|null;displayName?:string};
type ActiveTimer={repairId:string;startedAt:string;title:string;unit:string};
type ShopPayload={user?:ShopUser;activeTimer?:ActiveTimer|null};

function timerStartMs(value:string){
  const normalized=value.includes("T")?value:value.replace(" ","T")+"Z";
  return Date.parse(normalized);
}
function elapsed(startedAt:string,now:number){
  const ms=Math.max(0,now-timerStartMs(startedAt));
  const total=Math.floor(ms/1000),hours=Math.floor(total/3600),minutes=Math.floor((total%3600)/60),seconds=total%60;
  return `${String(hours).padStart(2,"0")}:${String(minutes).padStart(2,"0")}:${String(seconds).padStart(2,"0")}`;
}
function hiddenRoute(pathname:string){
  return pathname==="/login"||pathname==="/setup"||pathname.startsWith("/report-breakdown")||pathname.startsWith("/photos")||pathname.startsWith("/annual-inspections/print")||pathname.startsWith("/work-orders/print")||pathname.startsWith("/invoices/print");
}
function Icon({name}:{name:"board"|"work"|"unit"|"more"}){
  const common={width:21,height:21,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:2,strokeLinecap:"round" as const,strokeLinejoin:"round" as const,"aria-hidden":true};
  if(name==="board")return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 2v4M16 2v4M3 9h18M7 13h4M7 17h7"/></svg>;
  if(name==="work")return <svg {...common}><path d="M14.7 6.3a4 4 0 0 0-5-5L7.4 3.6l3 3-3.8 3.8-3-3L1.3 9.7a4 4 0 0 0 5 5l6.4 6.4a2 2 0 0 0 2.8-2.8l-6.4-6.4"/></svg>;
  if(name==="unit")return <svg {...common}><path d="M3 6h11v10H3zM14 9h4l3 3v4h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/></svg>;
  return <svg {...common}><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>;
}

export default function TechnicianMobileDock(){
  const pathname=usePathname();
  const[user,setUser]=useState<ShopUser|null>(null);
  const[timer,setTimer]=useState<ActiveTimer|null>(null);
  const[now,setNow]=useState(Date.now());
  const[moreOpen,setMoreOpen]=useState(false);
  const hidden=hiddenRoute(pathname);
  const shopRoute=pathname==="/shop"||pathname.startsWith("/shop/");

  useEffect(()=>{
    if(hidden){setUser(null);setTimer(null);return;}
    let cancelled=false;
    async function load(){
      try{
        const response=await fetch("/api/shop",{cache:"no-store"});
        if(!response.ok)throw new Error("Shop unavailable");
        const payload=await response.json() as ShopPayload;
        if(cancelled)return;
        setUser(payload.user??null);
        setTimer(payload.activeTimer??null);
      }catch{
        if(!cancelled){setUser(null);setTimer(null);}
      }
    }
    void load();
    const refresh=window.setInterval(()=>void load(),60000);
    return()=>{cancelled=true;window.clearInterval(refresh);};
  },[hidden,pathname]);

  useEffect(()=>{const id=window.setInterval(()=>setNow(Date.now()),1000);return()=>window.clearInterval(id);},[]);

  const enabled=Boolean(shopRoute||user&&(user.role==="mechanic"||user.technicianId));
  useEffect(()=>{
    if(enabled&&!hidden)document.body.classList.add("technician-mobile-enabled");
    else document.body.classList.remove("technician-mobile-enabled");
    return()=>document.body.classList.remove("technician-mobile-enabled");
  },[enabled,hidden]);

  useEffect(()=>{setMoreOpen(false);},[pathname]);
  const manager=user?.role==="manager"||user?.role==="admin";
  const moreLinks=useMemo(()=>manager?[
    ["Breakdowns","/breakdowns"],
    ["Parts Desk","/parts-desk"],
    ["Completed Work","/work-orders"],
    ["Annual Forms","/annual-inspections"],
  ]:[
    ["Annual Forms","/annual-inspections"],
  ],[manager]);

  if(hidden||!enabled)return null;
  const boardActive=pathname.startsWith("/repair-board");
  const workActive=shopRoute;
  const unitActive=pathname==="/unit"||pathname.startsWith("/unit/");

  return <>
    {timer&&!workActive&&<a className="tech-active-work-ribbon" href="/shop" aria-label={`Return to working unit ${timer.unit}`}>
      <span><strong>WORKING NOW</strong><b>Unit {timer.unit||"—"} · {timer.title}</b></span>
      <time>{elapsed(timer.startedAt,now)}</time>
    </a>}
    {moreOpen&&<div className="tech-mobile-more" role="dialog" aria-label="More technician navigation">
      <button type="button" className="tech-mobile-more-backdrop" aria-label="Close menu" onClick={()=>setMoreOpen(false)}/>
      <div className="tech-mobile-more-sheet">
        <div className="tech-mobile-more-head"><strong>More</strong><button type="button" onClick={()=>setMoreOpen(false)}>Close</button></div>
        {moreLinks.map(([label,href])=><a key={href} href={href}>{label}<span>›</span></a>)}
      </div>
    </div>}
    <nav className="tech-mobile-dock" aria-label="Technician quick navigation">
      <a href="/repair-board" className={boardActive?"active":""}><Icon name="board"/><span>Repair Board</span></a>
      <a href="/shop" className={workActive?"active":""}><Icon name="work"/><span>My Work</span>{timer?<i aria-label="Labor timer running"/>:null}</a>
      <a href="/unit" className={unitActive?"active":""}><Icon name="unit"/><span>Unit</span></a>
      <button type="button" className={moreOpen||(!boardActive&&!workActive&&!unitActive)?"active":""} onClick={()=>setMoreOpen(open=>!open)}><Icon name="more"/><span>More</span></button>
    </nav>
  </>;
}
