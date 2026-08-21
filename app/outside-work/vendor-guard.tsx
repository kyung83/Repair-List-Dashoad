"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import OutsideWorkIntake from "./file-intake";

type Vendor={id:number;name:string;phone:string;email:string;address:string;lookupKey:string};
type VendorListPayload={vendors?:Vendor[];error?:string};
type VendorSavePayload={ok?:boolean;created?:boolean;vendor?:Vendor;error?:string};
type ExtractedVendor={name:string;source:"remit"|"letterhead"|"";email:string;address:string};

function cleanLine(value:string){return value.replace(/[|]+/g," ").replace(/\s+/g," ").trim();}
function linesFrom(text:string){return text.split(/\r?\n/).map(cleanLine).filter(Boolean);}
function normalizeVendor(value:string){
  let normalized=value.toUpperCase().replace(/&/g," AND ").replace(/[^A-Z0-9]+/g," ").replace(/\s+/g," ").trim();
  normalized=normalized
    .replace(/\s+(?:INCORPORATED|INC|LLC|LTD|CORPORATION|CORP|COMPANY|CO)$/i,"")
    .replace(/\s+(?:TRUCKS|TRUCK|TRACTORS|TRACTOR)$/i,"")
    .trim();
  return normalized;
}

const remitAnchor=/\b(?:PLEASE\s+REMIT\s+PAYMENT\s+TO|REMIT\s+PAYMENT\s+TO|REMIT\s+TO|PAY\s+TO)\b\s*[:#=.-]*/i;
const customerHeading=/^(?:BILL\s+TO|DELIVER\s+TO|SHIP\s+TO)\b/i;
const excludedHeading=/^(?:AUTHORIZATION\s+FOR\s+REPAIRS|EXCLUSION\s+OF\s+WARRANTIES|WARRANTY|WARRANTIES|TERMS|CONDITIONS|SIGNATURE\s+OF\s+PERSON\s+RESPONSIBLE|COMPLAINT|CAUSE|CORRECTION|WORK\s+PERFORMED|SERVICE\s+DESCRIPTION|DESCRIPTION\s+OF\s+WORK|REPAIR\s+DESCRIPTION|LABOR\s+DETAIL|LABOUR\s+DETAIL|TECHNICIAN\s+COMMENTS|RECOMMENDATIONS)\b/i;
const financial=/\b(?:SHOP\s+SUPPLIES|MISC(?:ELLANEOUS)?\s+SUPPLIES|LABOR|LABOUR|PARTS|SUBLET|PREPAY|SUB\s*TOTAL|SUBTOTAL|TAX|TOTAL|BALANCE|AMOUNT\s+DUE|ESTIMATED|BILLED|NET\s+SALE)\b/i;
const legal=/\b(?:HEREBY|UNDERSIGNED|PURCHASER|WARRANTY|WARRANTIES|MERCHANTABILITY|PARTICULAR\s+PURPOSE|CONSEQUENTIAL\s+DAMAGES|COMMERCIAL\s+LOSSES|MECHANIC'?S\s+LIEN|RESPONSIBLE\s+FOR\s+PAYMENT|PARTS\s+AND\/OR\s+ACCESSORIES|PARTS\s+OR\s+ACCESSORIES|ACCESSORIES\s+PURCHASED|PERMISSION\s+TO\s+OPERATE|UNAVAILABILITY\s+OF\s+PARTS|PARTS\s+SHIPMENTS|DEALER\s+MAKES?\s+NO\s+WARRANTIES)\b/i;
const customer=/\b(?:NORTHERN\s+LOGISTICS|NORLOWORLD)\b/i;
const metadata=/\b(?:INVOICE|REPAIR\s+ORDER|WORK\s+ORDER|CUSTOMER|ACCOUNT|ACCT|UNIT|TRUCK\s*(?:NO|NUMBER|#)|TRACTOR\s*(?:NO|NUMBER|#)|TRAILER\s*(?:NO|NUMBER|#)|VEHICLE\s*(?:NO|NUMBER|#)|EQUIPMENT\s*(?:NO|NUMBER|#)|ODOMETER|MILEAGE|DATE|PAGE\s+\d|PURCHASE\s+ORDER|PO\s*#)\b/i;
const contact=/\b(?:PHONE|TEL|FAX)\b|\(\d{3}\)\s*\d{3}[- ]\d{4}|\b\d{3}[-.]\d{3}[-.]\d{4}\b|https?:|www\.|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const address=/^\d{1,6}\s+\S+|\b(?:ST|STREET|RD|ROAD|AVE|AVENUE|BLVD|BOULEVARD|DRIVE|DR|HWY|HIGHWAY|LANE|LN|WAY|ROUTE|RT|PKWY|PARKWAY|PO\s+BOX)\b|\b[A-Z .'-]+,?\s+[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/i;
const business=/\b(?:TRUCK|TRUCKS|TRACTOR|TRACTORS|DIESEL|TIRE|TIRES|SERVICE|SERVICES|REPAIR|REPAIRS|MOTOR|MOTORS|AUTO|AUTOMOTIVE|CENTER|CENTRE|DEALER|GARAGE|SHOP|TRUCKING|FLEET|BODY\s+SHOP|COLLISION|TOWING|SPRING|TRANSMISSION|RADIATOR|ALIGNMENT|INC\.?|LLC|LTD|CORP|CORPORATION|COMPANY|CO\.)\b/i;
const knownBrand=/\b(?:KENWORTH|PETERBILT|FREIGHTLINER|WESTERN\s+STAR|VOLVO|MACK|INTERNATIONAL|CUMMINS|DETROIT|GOODYEAR|BRIDGESTONE|MICHELIN|LOVE'?S|TA\s+PETRO|IDEALEASE)\b/i;

function companyCandidate(value:string,anchored=false){
  const line=cleanLine(value).replace(/^[\s:#=.-]+/,"").replace(/[,:;.-]+$/," ").trim();
  if(line.length<2||line.length>90||!/[A-Za-z]{2}/.test(line))return"";
  if(customerHeading.test(line)||excludedHeading.test(line)||financial.test(line)||legal.test(line)||customer.test(line)||metadata.test(line)||contact.test(line)||address.test(line))return"";
  if(/\$\s*\d|^[0-9]/.test(line))return"";
  const words=line.match(/[A-Za-z][A-Za-z'&.-]*/g)||[];
  if(words.length>10)return"";
  if(!anchored&&!business.test(line)&&!knownBrand.test(line))return"";
  return line;
}

function findEmail(text:string){
  const emails=text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)||[];
  return emails.find(value=>/^(?:ar|accounts?|billing|service|parts)@/i.test(value))||emails[0]||"";
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
      if(customerHeading.test(raw)||excludedHeading.test(raw)||financial.test(raw)||legal.test(raw))break;
      const candidate=companyCandidate(raw,true);
      if(candidate)return{name:candidate,index:i+offset};
    }
  }
  return null;
}

function letterheadVendor(lines:string[]){
  const customerIndex=lines.findIndex(line=>customerHeading.test(line));
  const limit=Math.min(customerIndex>=0?customerIndex:35,35);
  let best="";let bestScore=-1;
  for(let i=0;i<limit;i++){
    const candidate=companyCandidate(lines[i]);
    if(!candidate)continue;
    let score=0;
    if(business.test(candidate))score+=4;
    if(knownBrand.test(candidate))score+=3;
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
    if(!line||customerHeading.test(line)||excludedHeading.test(line)||financial.test(line)||legal.test(line))break;
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
  let common=0;
  for(const token of left)if(right.has(token))common++;
  return (2*common)/(left.size+right.size);
}

function setReactInputValue(input:HTMLInputElement,value:string){
  const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")?.set;
  if(setter)setter.call(input,value);else input.value=value;
  input.dispatchEvent(new Event("input",{bubbles:true}));
  input.dispatchEvent(new Event("change",{bubbles:true}));
}

function VendorMasterResolver(){
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
      .then(async response=>{
        const payload=await response.json() as VendorListPayload;
        if(!response.ok)throw new Error(payload.error||"Vendors could not be loaded.");
        return payload;
      })
      .then(payload=>{if(!cancelled)setVendors(payload.vendors||[]);})
      .catch(error=>{if(!cancelled)setLoadError(error instanceof Error?error.message:"Vendors could not be loaded.");});
    return()=>{cancelled=true;};
  },[]);

  const extracted=useMemo(()=>extractVendor(ocrText),[ocrText]);
  const exact=useMemo(()=>{
    const key=normalizeVendor(extracted.name);
    if(!key)return null;
    const matches=vendors.filter(vendor=>(vendor.lookupKey||normalizeVendor(vendor.name))===key);
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
    const timer=window.setInterval(()=>{
      const textarea=Array.from(document.querySelectorAll<HTMLTextAreaElement>("textarea")).find(item=>item.placeholder.includes("OCR or extracted PDF text"));
      const label=Array.from(document.querySelectorAll<HTMLLabelElement>("label")).find(item=>(item.textContent||"").trim().startsWith("Outside vendor"));
      const input=label?.querySelector<HTMLInputElement>("input")||null;
      if(input){
        vendorInputRef.current=input;
        input.readOnly=true;
        input.placeholder="Resolved from vendor master below";
        input.setAttribute("aria-readonly","true");
      }
      const text=textarea?.value.trim()||"";
      if(text!==lastTextRef.current){
        if(!text&&lastTextRef.current){
          setSelectedId(0);
          setNewName("");
          setActionError("");
          if(input?.value)setReactInputValue(input,"");
        }
        lastTextRef.current=text;
        setOcrText(text);
      }
    },250);
    return()=>window.clearInterval(timer);
  },[]);

  useEffect(()=>{
    const input=vendorInputRef.current;
    if(!input)return;
    if(exact&&selectedId===0){
      setSelectedId(exact.id);
      setNewName("");
      if(input.value!==exact.name)setReactInputValue(input,exact.name);
      return;
    }
    if(selectedId===0){
      if(input.value)setReactInputValue(input,"");
      if(extracted.name)setNewName(current=>current||extracted.name);
    }
  },[exact,extracted.name,selectedId]);

  useEffect(()=>{
    if(!selectedId)return;
    const selected=vendors.find(vendor=>vendor.id===selectedId);
    const input=vendorInputRef.current;
    if(selected&&input&&input.value!==selected.name)setReactInputValue(input,selected.name);
  },[selectedId,vendors,ocrText]);

  function useVendor(vendor:Vendor){
    const input=vendorInputRef.current;
    if(input)setReactInputValue(input,vendor.name);
    setSelectedId(vendor.id);
    setNewName("");
    setActionError("");
  }

  function clearVendor(){
    const input=vendorInputRef.current;
    if(input)setReactInputValue(input,"");
    setSelectedId(0);
    setActionError("");
    if(extracted.name)setNewName(extracted.name);
  }

  async function createVendor(){
    const name=cleanLine(newName||extracted.name);
    if(!name){setActionError("Enter the vendor company name.");return;}
    setBusy(true);setActionError("");
    try{
      const response=await fetch("/api/outside-work/vendors",{
        method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({name,email:extracted.email,address:extracted.address}),
      });
      const payload=await response.json() as VendorSavePayload;
      if(!response.ok||!payload.vendor)throw new Error(payload.error||"Vendor could not be created.");
      const vendor=payload.vendor;
      setVendors(current=>[...current.filter(item=>item.id!==vendor.id),vendor].sort((a,b)=>a.name.localeCompare(b.name)));
      useVendor(vendor);
    }catch(error){
      setActionError(error instanceof Error?error.message:"Vendor could not be created.");
    }finally{
      setBusy(false);
    }
  }

  const selected=vendors.find(vendor=>vendor.id===selectedId)||null;
  const panelVisible=Boolean(ocrText||vendorInputRef.current||loadError);
  if(!panelVisible)return null;

  return <div style={{position:"fixed",right:16,bottom:16,zIndex:50,width:"min(430px, calc(100vw - 32px))",maxHeight:"70vh",overflowY:"auto",background:"white",border:"1px solid #cbd5e1",borderRadius:12,boxShadow:"0 18px 45px rgba(15,23,42,.18)",padding:14,display:"grid",gap:10}}>
    <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"flex-start"}}>
      <div>
        <div style={{fontSize:13,fontWeight:800,color:"#0f172a"}}>Outside Work Vendor</div>
        <div style={{fontSize:12,color:selected?"#166534":"#475569",marginTop:3}}>
          {selected
            ?`Resolved to vendor master #${selected.id}: ${selected.name}`
            :extracted.name
              ?`${extracted.source==="remit"?"Remit-to":"Letterhead"} vendor detected: ${extracted.name}`
              :"No confident vendor detected. Select an existing vendor or create the road-repair vendor."}
        </div>
      </div>
      {selected&&<button type="button" onClick={clearVendor} style={{border:"1px solid #cbd5e1",borderRadius:6,background:"white",padding:"5px 8px",cursor:"pointer"}}>Change</button>}
    </div>

    {loadError&&<div style={{fontSize:12,color:"#b91c1c"}}>{loadError}</div>}

    {!selected&&<>
      <select
        value=""
        onChange={event=>{const id=Number(event.target.value||0);const vendor=vendors.find(item=>item.id===id);if(vendor)useVendor(vendor);}}
        style={{width:"100%",minHeight:38,border:"1px solid #cbd5e1",borderRadius:7,padding:"6px 8px",background:"white"}}
      >
        <option value="">Select existing vendor…</option>
        {vendors.map(vendor=><option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}
      </select>

      {suggestions.length>0&&<div style={{display:"grid",gap:6}}>
        <div style={{fontSize:11,fontWeight:700,color:"#64748b"}}>Possible existing matches — choose only if correct</div>
        {suggestions.map(item=><button key={item.vendor.id} type="button" onClick={()=>useVendor(item.vendor)} style={{textAlign:"left",border:"1px solid #cbd5e1",borderRadius:7,background:"#f8fafc",padding:"7px 9px",cursor:"pointer"}}>
          {item.vendor.name} <span style={{color:"#64748b",fontSize:11}}>#{item.vendor.id}</span>
        </button>)}
      </div>}

      <div style={{display:"grid",gap:6}}>
        <label style={{fontSize:11,fontWeight:700,color:"#64748b"}}>New / one-off road vendor</label>
        <input
          value={newName}
          onChange={event=>setNewName(event.target.value)}
          placeholder="Company name from invoice"
          style={{width:"100%",minHeight:38,border:"1px solid #cbd5e1",borderRadius:7,padding:"6px 8px"}}
        />
        <button type="button" onClick={createVendor} disabled={busy||!(newName||extracted.name).trim()} style={{minHeight:38,border:0,borderRadius:7,background:"#0f172a",color:"white",fontWeight:700,padding:"7px 10px",cursor:busy?"wait":"pointer",opacity:busy?0.7:1}}>
          {busy?"Creating vendor…":"Create & use this vendor"}
        </button>
      </div>
    </>}

    {actionError&&<div style={{fontSize:12,color:"#b91c1c"}}>{actionError}</div>}
    <div style={{fontSize:11,color:"#64748b"}}>Outside Work cannot be saved until this resolves to one active vendor-master record. One-off road vendors are allowed.</div>
  </div>;
}

export default function OutsideWorkVendorSafe(){
  return <><OutsideWorkIntake/><VendorMasterResolver/></>;
}
