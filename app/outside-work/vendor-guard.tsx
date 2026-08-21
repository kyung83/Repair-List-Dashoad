"use client";

import { useEffect } from "react";
import OutsideWorkIntake from "./file-intake";

function cleanLine(value:string){return value.replace(/[|]+/g," ").replace(/\s+/g," ").trim();}

const metadata=/NORTHERN\s+LOGISTICS|NORLOWORLD|\bINVOICE\b|REPAIR\s+ORDER|WORK\s+ORDER|BILL\s+TO|SHIP\s+TO|\bCUSTOMER\b|\bACCOUNT\b|\bACCT\b|FLEET\s+CHARGE|FLEET\s+CARD|CARD\s*(?:NO|NUMBER|#)|\bAUTH(?:ORIZATION)?\b|\bAPPROVAL\b|\bTRANSACTION\b|\bREFERENCE\b|\bPAYMENT\b|AMOUNT\s+DUE|BALANCE\s+DUE|GRAND\s+TOTAL|\bTERMS\b|SALESPERSON|PURCHASE\s+ORDER|\bPO\s*#|PAGE\s+\d|\bDATE\b|TAG\s+NUMBER|LICENSE\s+PLATE|YEAR\s+MAKE\s+MODEL|ENGINE\s+HOURS|ODOMETER|CUSTOMER\s+UNIT/i;
const equipmentField=/^(?:UNIT|TRUCK|TRACTOR|TRAILER|VEHICLE|EQUIPMENT|ASSET|STOCK)(?:\s*(?:NO|NUMBER|#|UNIT))?\s*[:#=.-]*\s*[A-Z0-9-]{1,20}\s*$/i;
const business=/\b(?:TRUCK|TRUCKS|TRACTOR|TRACTORS|DIESEL|TIRE|TIRES|SERVICE|SERVICES|REPAIR|REPAIRS|MOTOR|MOTORS|AUTO|AUTOMOTIVE|CENTER|CENTRE|DEALER|GARAGE|SHOP|TRUCKING|FLEET|BODY\s+SHOP|COLLISION|TOWING|SPRING|TRANSMISSION|RADIATOR|ALIGNMENT|INC\.?|LLC|LTD|CORP|CORPORATION|COMPANY|CO\.)\b/i;
const knownBrand=/\b(?:KENWORTH|PETERBILT|FREIGHTLINER|WESTERN\s+STAR|VOLVO|MACK|INTERNATIONAL|CUMMINS|DETROIT|GOODYEAR|BRIDGESTONE|MICHELIN|LOVE'?S|TA\s+PETRO)\b/i;
const contact=/\b(?:PHONE|TEL|FAX)\b|\(\d{3}\)\s*\d{3}[- ]\d{4}|\b\d{3}[-.]\d{3}[-.]\d{4}\b|www\.|https?:|@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const address=/^\d{1,6}\s+\S+|\b(?:ST|STREET|RD|ROAD|AVE|AVENUE|BLVD|BOULEVARD|DRIVE|DR|HWY|HIGHWAY|LANE|LN|WAY|ROUTE|RT|PKWY|PARKWAY)\b/i;
const vendorLabel=/^(?:VENDOR|SUPPLIER|MERCHANT|DEALER|SERVICE\s+PROVIDER|REMIT\s+TO|PAY\s+TO|PLEASE\s+REMIT\s+PAYMENT\s+TO)\b\s*[:#=.-]*\s*(.*)$/i;
const narrativeHeading=/^(?:COMPLAINT|CAUSE|CORRECTION|WORK\s+PERFORMED|SERVICE\s+DESCRIPTION|DESCRIPTION\s+OF\s+WORK|REPAIR\s+DESCRIPTION|LABOR\s+DETAIL|LABOUR\s+DETAIL|JOB\s+DESCRIPTION|TECHNICIAN\s+COMMENTS|RECOMMENDATIONS)\b/i;
const narrativeEnd=/^(?:QTY\b|ITEM\b|PART\s+NUMBER|PART\s*#|DESCRIPTION\b|UNIT\s+PRICE|EXTD\s+PRICE|EXTENDED\b|PREPAY\b|SOLD\s+OPERATIONS\s+TOTALS|SUB\s*TOTAL|SUBTOTAL|AMOUNT\s+DUE|BALANCE\s+DUE|GRAND\s+TOTAL|TOTAL\b)/i;
const narrativeAction=/\b(?:PULLED|CHECKED|FOUND|REPLACED|PERFORMED|RAN|ROAD\s+TESTED|REMOVED|INSTALLED|DIAGNOSED|INSPECTED|REPAIRED|SERVICED|ADJUSTED|REBUILT|CHANGED|MOUNTED|BALANCED|ALIGNED|RESET|REGEN|FAILED|BAD|FAULT|CODES?)\b/gi;
const vehicleLine=/\b[A-HJ-NPR-Z0-9]{17}\b|^\s*(?:19|20)\d{2}\s+[A-Z][A-Z0-9&'. -]+\s+[A-Z0-9-]{1,20}\b/i;

function looksLikeNarrative(value:string){
  const line=cleanLine(value);
  if(!line)return false;
  if(narrativeHeading.test(line))return true;
  const actions=line.match(narrativeAction)?.length||0;
  return actions>=2||(line.length>=70&&actions>=1)||(/[.!?]/.test(line)&&line.length>=85);
}

function cleanVendorCandidate(value:string){
  const line=cleanLine(value).replace(/^[\s:#=.-]+/,"").replace(/[,:;.-]+$/," ").trim();
  if(line.length<2||line.length>90||!/[A-Za-z]{2}/.test(line))return"";
  if(metadata.test(line)||equipmentField.test(line)||contact.test(line)||address.test(line)||vehicleLine.test(line)||looksLikeNarrative(line))return"";
  if(/[Xx*#]{2,}\s*\d{2,8}\b/.test(line)||/^\$?\s*\d[\d,. ]*$/.test(line))return"";
  const letters=(line.match(/[A-Za-z]/g)||[]).length;
  const digits=(line.match(/\d/g)||[]).length;
  if(letters<2||digits>Math.max(3,Math.floor(letters/2)))return"";
  return line;
}

function narrativeMask(lines:string[]){
  const blocked=new Array<boolean>(lines.length).fill(false);
  let inside=false;
  for(let i=0;i<lines.length;i++){
    const line=lines[i];
    if(narrativeHeading.test(line)){inside=true;blocked[i]=true;continue;}
    if(inside&&narrativeEnd.test(line)){inside=false;continue;}
    if(inside)blocked[i]=true;
  }
  return blocked;
}

function detectExplicitVendor(lines:string[]){
  for(let i=0;i<lines.length;i++){
    const match=lines[i].match(vendorLabel);
    if(!match)continue;
    const same=cleanVendorCandidate(match[1]||"");
    if(same)return same;
    for(let offset=1;offset<=3;offset++){
      const next=cleanVendorCandidate(lines[i+offset]||"");
      if(next)return next;
    }
  }
  return"";
}

function detectReliableVendor(text:string){
  const lines=text.split(/\r?\n/).map(cleanLine).filter(Boolean);
  const explicit=detectExplicitVendor(lines);
  if(explicit)return explicit;

  const blocked=narrativeMask(lines);
  let best="";
  let bestScore=-999;
  const limit=Math.min(lines.length,60);

  for(let i=0;i<limit;i++){
    const line=cleanVendorCandidate(lines[i]);
    if(!line||blocked[i])continue;

    const letters=(line.match(/[A-Za-z]/g)||[]).length;
    const digits=(line.match(/\d/g)||[]).length;
    const hasBusiness=business.test(line);
    const hasBrand=knownBrand.test(line);
    const nearby=[lines[i-2]||"",lines[i-1]||"",lines[i+1]||"",lines[i+2]||"",lines[i+3]||""].join(" ");
    const hasContact=contextHasContact(nearby);
    const hasAddress=[lines[i+1]||"",lines[i+2]||"",lines[i+3]||""].some(item=>address.test(item));

    if(!hasBusiness&&!hasBrand&&!hasContact&&!hasAddress)continue;

    let score=28-Math.min(i,24);
    if(hasBusiness)score+=50;
    if(hasBrand)score+=24;
    if(hasContact)score+=24;
    if(hasAddress)score+=24;
    if(line===line.toUpperCase()&&letters>=5)score+=7;
    if(line.length>=4&&line.length<=58)score+=7;
    if(/^[A-Z][A-Za-z0-9&'. -]+$/.test(line))score+=4;
    if(/:/.test(line))score-=18;
    score-=Math.min(18,digits*4);

    if(hasBrand&&!hasBusiness&&!hasContact&&!hasAddress)score-=45;
    if(score>bestScore){bestScore=score;best=line;}
  }
  return bestScore>=68?best:"";
}

function contextHasContact(value:string){return contact.test(value);}

function suspiciousVendor(value:string){
  const line=cleanLine(value);
  if(!line)return false;
  if(metadata.test(line)||equipmentField.test(line)||vehicleLine.test(line)||looksLikeNarrative(line))return true;
  if(/^(?:SOLD\s+OPERATIONS|JOB\s*#|COMPLAINT|CAUSE|CORRECTION|QTY\b|ITEM\b|DESCRIPTION\b)/i.test(line))return true;
  if(/^(?:INTERNATIONAL|KENWORTH|PETERBILT|FREIGHTLINER|VOLVO|MACK|CUMMINS|DETROIT)$/i.test(line))return true;
  return false;
}

function setReactInputValue(input:HTMLInputElement,value:string){
  const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")?.set;
  if(setter)setter.call(input,value);else input.value=value;
  input.dispatchEvent(new Event("input",{bubbles:true}));
}

function VendorGuard(){
  useEffect(()=>{
    let activeText="";
    let seededForText=false;
    const timer=window.setInterval(()=>{
      const textarea=Array.from(document.querySelectorAll<HTMLTextAreaElement>("textarea")).find(item=>item.placeholder.includes("OCR or extracted PDF text"));
      const vendorLabelElement=Array.from(document.querySelectorAll<HTMLLabelElement>("label")).find(label=>(label.textContent||"").trim().startsWith("Outside vendor"));
      const vendorInput=vendorLabelElement?.querySelector<HTMLInputElement>("input")||null;
      if(!textarea||!vendorInput)return;

      const text=textarea.value.trim();
      if(!text)return;
      if(text!==activeText){activeText=text;seededForText=false;}

      const candidate=detectReliableVendor(text);
      const current=vendorInput.value.trim();
      const suspicious=suspiciousVendor(current);

      if(candidate&&(!seededForText||!current||suspicious)){
        if(candidate!==current)setReactInputValue(vendorInput,candidate);
        seededForText=true;
        return;
      }
      if(!candidate&&suspicious){setReactInputValue(vendorInput,"");seededForText=true;}
    },250);
    return()=>window.clearInterval(timer);
  },[]);
  return null;
}

export default function OutsideWorkVendorSafe(){
  return <><OutsideWorkIntake/><VendorGuard/></>;
}
