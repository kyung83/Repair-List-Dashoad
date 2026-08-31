'use client';

import { useEffect, useState, type CSSProperties } from 'react';

export default function ExistingRepairInvoiceBridge(){
  const[repairId,setRepairId]=useState('');
  const[unit,setUnit]=useState('');

  useEffect(()=>{
    const params=new URLSearchParams(window.location.search);
    const requested=params.get('repairId')||'';
    if(!/^repair-\d+$/.test(requested))return;
    setRepairId(requested);setUnit(params.get('unit')||'');
    const originalFetch=window.fetch.bind(window);
    window.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=typeof input==='string'?input:input instanceof URL?input.toString():input.url;
      if(url==='/api/outside-work'&&String(init?.method||'GET').toUpperCase()==='POST'&&init?.body instanceof FormData){
        const body=init.body;
        body.set('repairId',requested);
        return originalFetch('/api/outside-repairs/invoice',{...init,body});
      }
      return originalFetch(input as RequestInfo,init);
    }) as typeof window.fetch;
    return()=>{window.fetch=originalFetch as typeof window.fetch;};
  },[]);

  if(!repairId)return null;
  return <div style={banner}><strong>ATTACHING TO EXISTING OUTSIDE REPAIR {repairId.replace('repair-','#')}</strong><span>{unit?`Unit ${unit}. `:''}This invoice will close the same repair that came from the Repair Board. It will not create a duplicate repair.</span></div>;
}

const banner:CSSProperties={maxWidth:1440,margin:'14px auto 0',padding:'11px clamp(16px,4vw,46px)',boxSizing:'border-box',display:'grid',gap:3,borderTop:'1px solid #a9ccb4',borderBottom:'1px solid #a9ccb4',background:'#f2faf4',color:'#234f31',fontSize:13};
