"use client";

import { useEffect, useState } from "react";
import { yardLabel, type YardSelection } from "@/lib/yards";

type User={role:"viewer"|"mechanic"|"manager"|"admin";yard?:YardSelection;yardAssigned?:boolean};

export default function YardScopeBanner(){
  const[user,setUser]=useState<User|null>(null);
  useEffect(()=>{
    void fetch('/api/shop',{cache:'no-store'})
      .then(async response=>response.ok?(await response.json() as{user:User}).user:null)
      .then(setUser)
      .catch(()=>setUser(null));
  },[]);

  if(!user||(user.role!=="mechanic"&&user.role!=="manager"))return null;
  const yard=user.yard||"";
  if(!yard)return <section style={{margin:"18px 34px 0",padding:14,border:"2px solid #c94738",borderRadius:12,background:"#fff4f2",color:"#4d1d17"}}>
    <strong style={{display:"block"}}>No work yard is assigned to your user.</strong>
    <span style={{display:"block",marginTop:4,fontSize:13}}>An administrator needs to assign a work yard in Users &amp; Access. Your already assigned jobs can still be shown, but unassigned yard work cannot be picked up until a yard is set.</span>
  </section>;

  const label=yardLabel(yard);
  return <section style={{margin:"18px 34px 0",padding:14,border:"1px solid #cfd8df",borderRadius:12,background:"#f7f9fa",color:"#182331"}}>
    <strong style={{display:"block"}}>WORK YARD · {label.toUpperCase()}</strong>
    <span style={{display:"block",marginTop:4,fontSize:13,color:"#667482"}}>Available Units and All Open Units are scoped to repairs currently in the {label} yard. Repairs assigned to another tech are visible but stay assigned. Unassigned repairs can be opened and claimed.</span>
  </section>;
}
