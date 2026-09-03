"use client";

import { useEffect, useState } from "react";

type Role="viewer"|"mechanic"|"dispatch"|"manager"|"admin";

export default function DispatchBreakdownAccessStyle(){
  const[role,setRole]=useState<Role|null>(null);
  useEffect(()=>{
    let cancelled=false;
    void fetch('/api/auth/me',{cache:'no-store'})
      .then(async response=>response.ok?(await response.json() as{user:{role:Role}}).user.role:null)
      .then(value=>{if(!cancelled)setRole(value);})
      .catch(()=>undefined);
    return()=>{cancelled=true;};
  },[]);
  if(role!=='dispatch')return null;
  return <style>{`a[href="/breakdowns/setup"]{display:none!important}`}</style>;
}
