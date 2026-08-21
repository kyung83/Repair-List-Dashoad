"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import OutsideWorkIntake from "./file-intake";

type Vendor={id:number;name:string;phone:string;email:string;address:string;lookupKey:string};
type VendorPayload={vendors?:Vendor[];error?:string};
type VendorSavePayload={ok?:boolean;created?:boolean;vendor?:Vendor;error?:string};
type ExtractedVendor={name:string;source:"remit"|"letterhead"|"";email:string;address:string};

function cleanLine(value:string){return value.replace(/[|]+/g," ").replace(/\s+/g," ").trim();}
function linesFrom(text:string){return text.split(/\r?\n/).map(cleanLine).filter(Boolean);}
function normalizeVendor(value:string){
  let normalized=value.toUpperCase().replace(/&/g," AND ").replace(/[^A-Z0-9]+/g," ").replace(/\s+/g," ").trim();
  normalized=normalized
    .replace(/\s+(?:INCORPORATED|INC|LLC|LTD|CORPORATION|CORP|COMPANY|CO)$/,"" )
    .replace(/\s+(?:TRUCKS|TRUCK|TRACTORS|TRACTOR)$/,"" )
    .trim();
  return normalized;
}

const remitAnchor=/\b(?:PLEASE\s+REMIT\s+PAYMENT\s+TO|REMIT\s+PAYMENT\s+TO|REMIT\s+TO|PAY\s+TO)\b\s*[:#=.-]*/i;
const hardHeading=/^(?:BILL\s+TO|DELIVER\s+TO|SHIP\s+TO|AUTHORIZATION\s+FOR\s+REPAIRS|EXCLUSION\s+OF\s+WARRANTIES|TERMS|CONDITIONS|SIGNATURE\s+OF\s+PERSON\s+RESPONSIBLE|COMPLAINT|CAUSE|CORRECTION|WORK\s+PERFORMED|SERVICE\s+DESCRIPTION|DESCRIPTION\s+OF\s+WORK|REPAIR\s+DESCRIPTION|TECHNICIAN\s+COMMENTS|RECOMMENDATIONS)\b/i;
const financial=/\b(?:SHOP\s+SUPPLIES|MISC(?:ELLANEOUS)?\s+SUPPLIES|LABOR|LABOUR|PARTS|SUBLET|PREPAY|SUB\s*TOTAL|SUBTOTAL|TAX|TOTAL|BALANCE|AMOUNT\s+DUE|ESTIMATED|BILLED)\b/i;
const legal=/\b(?:WARRANTY|WARRANTIES|HEREBY|UNDERSIGNED|PURCHASER|MERCHANTABILITY|PARTICULAR\s+PURPOSE|CONSEQUENTIAL\s+DAMAGES|COMMERCIAL\s+LOSSES|MECHANIC'?S\s+LIEN|RESPONSIBLE\s+FOR\s+PAYMENT|PARTS\s+AND\/OR\s+ACCESSORIES|ACCESSORIES\s+PURCHASED|PERMISSION\s+TO\s+OPERATE|UNAVAILABILITY\s+OF\s+PARTS|PARTS\s+SHIPMENTS)\b/i;
const customer=/\b(?:NORTHERN\s+LOGISTICS|NORLOWORLD)\b/i;
const metadata=/\b(?:INVOICE|REPAIR\s+ORDER|WORK\s+ORDER|CUSTOMER|ACCOUNT|ACCT|UNIT|TRUCK\s*(?:NO|NUMBER|#)|TRACTOR\s*(?:NO|NUMBER|#)|TRAILER\s*(?:NO|NUMBER|#)|VEHICLE\s*(?:NO|NUMBER|#)|EQUIPMENT\s*(?:NO|NUMBER|#)|ODOMETER|MILEAGE|DATE|PAGE\s+\d)\b/i;
const contact=/\b(?:PHONE|TEL|FAX)\b|\(\d{3}\)\s*\d{3}[- ]\d{4}|\b\d{3}[-.]\d{3}[-.]\d{4}\b|https?:|www\.|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const address=/^\d{1,6}\s+\S+|\b(?:ST|STREET|RD|ROAD|AVE|AVENUE|BLVD|BOULEVARD|DRIVE|DR|HWY|HIGHWAY|LANE|LN|WAY|ROUTE|RT|PKWY|PARKWAY|PO\s+BOX)\b|\b[A-Z .'-]+,?\s+[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/i;
const business=/\b(?:TRUCK|TRUCKS|TRACTOR|TRACTORS|DIESEL|TIRE|TIRES|SERVICE|SERVICES|REPAIR|REPAIRS|MOTOR|MOTORS|AUTO|AUTOMOTIVE|CENTER|CENTRE|DEALER|GARAGE|SHOP|TRUCKING|FLEET|BODY\s+SHOP|COLLISION|TOWING|SPRING|TRANSMISSION|RADIATOR|ALIGNMENT|INC\.?|LLC|LTD|CORP|CORPORATION|COMPANY|CO\.)\b/i;
const knownBrand=/\b(?:KENWORTH|PETERBILT|FREIGHTLINER|WESTERN\s+STAR|VOLVO|MACK|INTERNATIONAL|CUMMINS|DETROIT|GOODYEAR|BRIDGESTONE|MICHELIN|LOVE'?S|TA\s+PETRO|IDEALEASE)\b/i;

function companyCandidate(value:string,anchored=false){
  const line=cleanLine(value).replace(/^[\s:#=.-]+/,"").replace(/[,:;.-]+$/," ").trim();
  if(line.length<2||line.length>90||!/[A-Za-z]{2}/.test(line))return"";
  if(hardHeading.test(line)||financial.test(line)||legal.test(line)||customer.test(line)||metadata.test(line)||contact.test(line)||address.test(line))return"";
  if(/\$\s*\d|^[0-9]/.test(line))return"";
  const words=line.match(/[A-Za-z][A-Za-z'&.-]*/g)||[];
  if(words.length>10)return"";
  if(!anchored&&!business.test(line)&&!knownBrand.test(line))return"";
  return line;
}

function findEmail(text:string){
  const emails=text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)||[];
  const preferred=emails.find(value=>/^(?:ar|accounts?|billing|service|parts)@/i.test(value));
  return preferred||emails[0]||"";
}

function remitVendor(lines:string[]){
  for(let i=0;i<lines.length;i++){
    const match=lines[i].match(remitAnchor);
    if(!match||match.index===undefined)continue;
    const same=companyCandidate(lines[i].slice(match.index+match[0].length),true);
    if(same)return{name:same,index:i};
    for(let offset=1;offset<=8;offset++){
      const raw=lines[i+offset]||"";
      if(!raw)continue;
      if(hardHeading.test(raw)||financial.test(raw)||legal.test(raw))break;
      const candidate=companyCandidate(raw,true);
      if(candidate)return{name:candidate,index:i+offset};
    }
  }
  return null;
}

function letterheadVendor(lines:string[]){
  const billIndex=lines.findIndex(line=>/^(?:BILL\s+TO|DELIVER\s+TO|SHIP\s+TO)\b/i.test(line));
  const limit=Math.min(billIndex>=0?billIndex:35,35);
  let best="";let bestScore=-1;
  for(let i=0;i<limit;i++){
    const candidate=companyCandidate(lines[i]);
    if(!candidate)continue;
    let score=0;
    if(business.test(candidate))score+=4;
    if(knownBrand.test(candidate))score+=2;
    const nearby=[lines[i+1]||"",lines[i+2]||"",lines[i+3]||""].join(" ");
    if(address.test(nearby))score+=3;
    if(contact.test(nearby))score+=3;
    if(score>bestScore){bestScore=score;best=candidate;}
  }
  return bestScore>=5?best:"";
}

function nearbyAddress(lines:string[],index:number){
  const found:string[]=[];
  for(let offset=1;offset<=5;offset++){
    const line=lines[index+offset]||"";
    if(!line||hardHeading.test(line)||financial.test(line)||legal.test(line))break;
    if(contact.test(line))continue;
    if(address.test(line)||(/^\d/.test(line)&&line.length<100))found.push(line);
  }
  return found.join(", ").slice(0,300);
}

function extractVendor(text:string):ExtractedVendor{
  const lines=linesFrom(text);
  const email=findEmail(text);
  const remit=remitVendor(lines);
  if(remit)return{name:remit.name,source:"remit",email,address:nearbyAddress(lines,remit.index)};
  const letterhead=letterheadVendor(lines);
  if(letterhead)return{name:letterhead,source:"letterhead",email,address:""};
  return{name:"",source:"",email,address:""};
}

function tokenSimilarity(a:string,b:string){
  const left=new Set(normalizeVendor(a).split(" ").filter(Boolean));
  const right=new Set(normalizeVendor(b).split(" ").filter(Boolean));
  if(!left.size||!right.size)return 0;
  let common=0;for(const token of left)if(right.has(token))common++;
  return (2*common)/(left.size+right.size);
}

function setReactInputValue(input:HTMLInputElement,value:string){
  const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")?.set;
  if(setter)setter.call(input,value);else input.value=value;
  input.dispatchEvent(new Event("input",{bubbles:true}));
  input.dispatchEvent(new Event("change",{bubbles:true}));
}

function VendorMasterResolver(){
  const[vendorLabel,setVendorLabel]=useState<HTMLLabelElement|null>(null);
  const[vendors,setVendors]=useState<Vendor[]>([]);
  const[loadError,setLoadError]=useState("");
  const[ocrText,setOcrText]=useState("");
  const[selectedId,setSelectedId]=useState(0);
  const[newName,setNewName]=useState("");
  const[busy,setBusy]=useState(false);
  const[actionError,setActionError]=useState("");
  const vendorInputRef=useRef<HTMLInputElement|null>(null);
  const lastTextRef=useRef("");

  useEffect(()=>{
    let cancelled=false;
    fetch("/api/outside-work/vendors",{cache:"no-store"})
      .then(async response=>{const payload=await response.json() as VendorPayload;if(!response.ok)throw new Error(payload.error||"Vendors could not be loaded.");return payload;})
      .then(payload=>{if(!cancelled)setVendors(payload.vendors||[]);})
      .catch(error=>{if(!cancelled)setLoadError(error instanceof Error?error.message:"Vendors could not be loaded.");});
    return()=>{cancelled=true;};
  },[]);

  useEffect(()=>{
    const timer=window.setInterval(()=>{
      const textarea=Array.from(document.querySelectorAll<HTMLTextAreaElement>("textarea")).find(item=>item.placeholder.includes("OCR or extracted PDF text"));
      const label=Array.from(document.querySelectorAll<HTMLLabelElement>("label")).find(item=>(item.textContent||"").trim().startsWith("Outside vendor"))||null;
      const input=label?.querySelector<HTMLInputElement>("input")||null;
      if(label&&label!==vendorLabel)setVendorLabel(label);
      if(input){
        vendorInputRef.current=input;
        input.readOnly=true;
        input.placeholder="Choose or create a vendor below";
        input.setAttribute("aria-readonly","true");
      }
      const text=textarea?.value.trim()||"";
      if(text!==lastTextRef.current){
        lastTextRef.current=text;
        setOcrText(text);
        setSelectedId(0);
        setActionError("");
      }
    },250);
    return()=>window.clearInterval(timer);
  },[vendorLabel]);

  const extracted=useMemo(()=>extractVendor(ocrText),[ocrText]);
  const exact=useMemo(()=>{
    const key=normalizeVendor(extracted.name);
    if(!key)return null;
    const matches=vendors.filter(vendor=>vendor.lookupKey===key||normalizeVendor(vendor.name)===key);
    return matches.length===1?matches[0]:null;
  },[extracted.name,vendors]);
  const suggestions=useMemo(()=>{
    if(!extracted.name||exact)return[];
    return vendors
      .map(vendor=>({vendor,score:tokenSimilarity(extracted.name,vendor.name)}))
      .filter(item=>item.score>=0.72)
      .sort((a,b)=>b.score-a.score)
      .slice(0,3);
  },[extracted.name,exact,vendors]);

  useEffect(()=>{
    const input=vendorInputRef.current;
    if(!input)return;
    if(exact){
      setReactInputValue(input,exact.name);
      setSelectedId(exact.id);
      setNewName("");
      return;
    }
    if(selectedId>0)return;
    if(input.value)setReactInputValue(input,"");
    if(extracted.name)setNewName(extracted.name);
  },[exact,extracted.name,selectedId]);

  function useVendor(vendor:Vendor){
    const input=vendorInputRef.current;if(!input)return;
    setReactInputValue(input,vendor.name);
    setSelectedId(vendor.id);
    setNewName("");
    setActionError("");
  }

  async function createVendor(name:string){
    const clean=cleanLine(name);
    if(!clean){setActionError("Enter the vendor company name.");return;}
    setBusy(true);setActionError("");
    try{
      const response=await fetch("/api/outside-work/vendors",{
        method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({name:clean,email:extracted.email,address:extracted.address}),
      });
      const payload=await response.json() as VendorSavePayload;
      if(!response.ok||!payload.vendor)throw new Error(payload.error||"Vendor could not be created.");
      const vendor=payload.vendor;
      setVendors(current=>[...current.filter(item=>item.id!==vendor.id),vendor].sort((a,b)=>a.name.localeCompare(b.name)));
      useVendor(vendor);
    }catch(error){setActionError(error instanceof Error?error.message:"Vendor could not be created.");}
    finally{setBusy(false);}
  }

  if(!vendorLabel)return null;
  const status=selectedId
    ?`Resolved to vendor master #${selectedId}.`
    :extracted.name
      ?`${extracted.source==="remit"?"Remit-to vendor detected":"Invoice letterhead vendor detected"}: ${extracted.name}`
      :"No confident vendor was detected. Choose an existing vendor or create the road-repair vendor.";

  return createPortal(
    <div data-vendor-master-resolver="true" style={{display:"grid",gap:8,marginTop:8,padding:10,border:"1px solid #d1d5db",borderRadius:8,background:"#f9fafb"}}>
      <div style={{fontSize:12,fontWeight:700,color:selectedId?"#166534":"#374151"}}>{status}</div>
      <select
        value={selectedId||""}
        onChange={event=>{const id=Number(event.target.value||0);const vendor=vendors.find(item=>item.id===id);if(vendor)useVendor(vendor);else{setSelectedId(0);const input=vendorInputRef.current;if(input)setReactInputValue(input,"");}}}
        style={{width:"100%",minHeight:38,border:"1px solid #cbd5e1",borderRadius:6,padding:"6px 8px",background:"white"}}
      >
        <option value="">Select existing vendor…</option>
        {vendors.map(vendor=><option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}
      </select>

      {!selectedId&&suggestions.length>0&&<div style={{display:"grid",gap:6}}>
        <div style={{fontSize:12,color:"#475569"}}>Possible existing match — confirm one:</div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          {suggestions.map(item=><button key={item.vendor.id} type="button" onClick={()=>useVendor(item.vendor)} style={{border:"1px solid #94a3b8",borderRadius:6,padding:"6px 9px",background:"white",cursor:"pointer"}}>Use {item.vendor.name}</button>)}
        </div>
      </div>}

      {!selectedId&&<div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) auto",gap:6}}>
        <input value={newName} onChange={event=>setNewName(event.target.value)} placeholder="New one-off / road-repair vendor name" style={{minHeight:38,border:"1px solid #cbd5e1",borderRadius:6,padding:"6px 8px"}}/>
        <button type="button" disabled={busy||!newName.trim()} onClick={()=>void createVendor(newName)} style={{border:"1px solid #0f172a",borderRadius:6,padding:"6px 10px",background:"#0f172a",color:"white",fontWeight:700,cursor:busy?"wait":"pointer",opacity:busy?0.6:1}}>{busy?"Creating…":"Create & use"}</button>
      </div>}

      {extracted.email&&<div style={{fontSize:11,color:"#64748b"}}>Invoice contact signal: {extracted.email}</div>}
      {loadError&&<div style={{fontSize:12,color:"#b91c1c"}}>{loadError}</div>}
      {actionError&&<div style={{fontSize:12,color:"#b91c1c"}}>{actionError}</div>}
    </div>,
    vendorLabel,
  );
}

export default function OutsideWorkVendorSafe(){
  return <><OutsideWorkIntake/><VendorMasterResolver/></>;
}
