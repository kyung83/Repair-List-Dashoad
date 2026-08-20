"use client";

import { useEffect } from "react";
import GeotabHealthPanel from "../health-panel";

export default function GeotabHealthPage(){
  useEffect(()=>{
    let stopped=false;
    function repairLinks(){
      if(stopped)return;
      document.querySelectorAll<HTMLAnchorElement>('#gps-yard-health a[href="#geotab-review-detail"]').forEach(link=>{
        link.href='/admin/geotab-review';
        link.textContent='Review identity';
      });
    }
    repairLinks();
    const observer=new MutationObserver(repairLinks);
    observer.observe(document.body,{childList:true,subtree:true});
    return()=>{stopped=true;observer.disconnect();};
  },[]);

  return <GeotabHealthPanel/>;
}
