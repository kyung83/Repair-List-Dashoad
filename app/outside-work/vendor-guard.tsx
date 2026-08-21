"use client";

import { useEffect } from "react";
import OutsideWorkIntake from "./file-intake";

function cleanLine(value:string){return value.replace(/[|]+/g," ").replace(/\s+/g," ").trim();}

const customerHeading=/^(?:BILL\s+TO|DELIVER\s+TO|SHIP\s+TO)\b/i;
const excludedHeading=/^(?:AUTHORIZATION\s+FOR\s+REPAIRS|EXCLUSION\s+OF\s+WARRANTIES|WARRANTY|WARRANTIES|TERMS|CONDITIONS|SIGNATURE\s+OF\s+PERSON(?:\s+RESPONSIBLE)?|COMPLAINT|CAUSE|CORRECTION|WORK\s+PERFORMED|SERVICE\s+DESCRIPTION|DESCRIPTION\s+OF\s+WORK|REPAIR\s+DESCRIPTION|LABOR\s+DETAIL|LABOUR\s+DETAIL|JOB\s+DESCRIPTION|TECHNICIAN\s+COMMENTS|RECOMMENDATIONS)\b/i;
const remitAnchor=/\b(?:PLEASE\s+REMIT\s+PAYMENT\s+TO|REMIT\s+PAYMENT\s+TO|REMIT\s+TO|PAY\s+TO)\b\s*[:#=.-]*/i;
const customer=/\b(?:NORTHERN\s+LOGISTICS|NORLOWORLD)\b/i;
const financial=/^(?:SHOP\s+SUPPLIES|MISC(?:ELLANEOUS)?\s+SUPPLIES|LABOR|LABOUR|PARTS|SUBLET|PREPAY|SUB\s*TOTAL|SUBTOTAL|TAX|TOTAL|BALANCE|AMOUNT\s+DUE|ESTIMATED(?:\s+BILLED)?|BILLED|NET\s+SALE)(?:\s*[:$]|\s+\$?\d|$)/i;
const legal=/\b(?:HEREBY|UNDERSIGNED|PURCHASER|WARRANTY|WARRANTIES|MERCHANTABILITY|PARTICULAR\s+PURPOSE|CONSEQUENTIAL\s+DAMAGES|COMMERCIAL\s+LOSSES|MECHANIC'?S\s+LIEN|RESPONSIBLE\s+FOR\s+PAYMENT|PARTS\s+AND\/OR\s+ACCESSORIES|PARTS\s+OR\s+ACCESSORIES|ACCESSORIES\s+PURCHASED|PERMISSION\s+TO\s+OPERATE|UNAVAILABILITY\s+OF\s+PARTS|PARTS\s+SHIPMENTS|DEALER\s+MAKES?\s+NO\s+WARRANTIES|SUPPLIER\s+OR\s+TRANSPORTER)\b/i;
const metadata=/\b(?:INVOICE|REPAIR\s+ORDER|WORK\s+ORDER|CUSTOMER|ACCOUNT|ACCT|UNIT|ODOMETER|MILEAGE|DATE|PAGE\s+\d|PURCHASE\s+ORDER|PO\s*#|SALESPERSON|TRANSACTION|REFERENCE)\b/i;
const contact=/\b(?:PHONE|TEL|FAX)\b|\(\d{3}\)\s*\d{3}[- ]\d{4}|\b\d{3}[-.]\d{3}[-.]\d{4}\b|https?:|www\.|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const address=/^\d{1,6}\s+\S+|\b(?:ST|STREET|RD|ROAD|AVE|AVENUE|BLVD|BOULEVARD|DRIVE|DR|HWY|HIGHWAY|LANE|LN|WAY|ROUTE|RT|PKWY|PARKWAY|PO\s+BOX)\b|\b[A-Z .'-]+,?\s+[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/i;
const business=/\b(?:TRUCK|TRUCKS|TRACTOR|TRACTORS|DIESEL|TIRE|TIRES|SERVICE|SERVICES|REPAIR|REPAIRS|MOTOR|MOTORS|AUTO|AUTOMOTIVE|CENTER|CENTRE|DEALER|GARAGE|SHOP|TRUCKING|FLEET|BODY\s+SHOP|COLLISION|TOWING|SPRING|TRANSMISSION|RADIATOR|ALIGNMENT|INC\.?|LLC|LTD|CORP|CORPORATION|COMPANY|CO\.)\b/i;
const knownBrand=/\b(?:KENWORTH|PETERBILT|FREIGHTLINER|WESTERN\s+STAR|VOLVO|MACK|INTERNATIONAL|CUMMINS|DETROIT|GOODYEAR|BRIDGESTONE|MICHELIN|LOVE'?S|TA\s+PETRO|IDEALEASE)\b/i;
const narrativeAction=/\b(?:PULLED|CHECKED|FOUND|REPLACED|PERFORMED|RAN|ROAD\s+TESTED|REMOVED|INSTALLED|DIAGNOSED|INSPECTED|REPAIRED|SERVICED|ADJUSTED|REBUILT|CHANGED|MOUNTED|BALANCED|ALIGNED|RESET|REGEN|FAILED|BAD|FAULT|CODES?)\b/gi;

function looksLikeNarrative(value:string){
  const line=cleanLine(value);
  if(!line)return false;
  if(excludedHeading.test(line))return true;
  const actions=line.match(narrativeAction)?.length||0;
  return actions>=2||(line.length>=70&&actions>=1)||(/[.!?]/.test(line)&&line.length>=85);
}

function companyCandidate(value:string,anchored=false){
  const line=cleanLine(value).replace(/^[\s:#=.-]+/,"").replace(/[,:;.-]+$/," ").trim();
  if(line.length<2||line.length>90||!/[A-Za-z]{2}/.test(line))return"";
  if(customerHeading.test(line)||excludedHeading.test(line)||customer.test(line)||financial.test(line)||legal.test(line)||metadata.test(line)||contact.test(line)||address.test(line)||looksLikeNarrative(line))return"";
  if(/\$\s*\d|^[0-9]/.test(line)||/[Xx*#]{2,}\s*\d{2,8}\b/.test(line))return"";
  const words=line.match(/[A-Za-z][A-Za-z'&.-]*/g)||[];
  if(words.length>10)return"";
  if(!anchored&&!business.test(line)&&!knownBrand.test(line))return"";
  return line;
}

function detectRemitVendor(lines:string[]){
  for(let i=0;i<lines.length;i++){
    const match=lines[i].match(remitAnchor);
    if(!match||match.index===undefined)continue;
    const same=companyCandidate(lines[i].slice(match.index+match[0].length),true);
    if(same)return same;
    for(let offset=1;offset<=8;offset++){
      const raw=lines[i+offset]||"";
      if(!raw)continue;
      if(customerHeading.test(raw)||excludedHeading.test(raw)||financial.test(raw)||legal.test(raw))break;
      const candidate=companyCandidate(raw,true);
      if(candidate)return candidate;
    }
  }
  return"";
}

function detectLetterheadVendor(lines:string[]){
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
    if(candidate===candidate.toUpperCase()&&candidate.length>=5)score+=1;
    if(score>bestScore){bestScore=score;best=candidate;}
  }
  return bestScore>=5?best:"";
}

function detectReliableVendor(text:string){
  const lines=text.split(/\r?\n/).map(cleanLine).filter(Boolean);
  return detectRemitVendor(lines)||detectLetterheadVendor(lines)||"";
}

function suspiciousVendor(value:string){
  const line=cleanLine(value);
  if(!line)return false;
  if(customerHeading.test(line)||excludedHeading.test(line)||customer.test(line)||financial.test(line)||legal.test(line)||metadata.test(line)||looksLikeNarrative(line))return true;
  if(line.length>90||(line.match(/[A-Za-z][A-Za-z'&.-]*/g)||[]).length>10)return true;
  if(/^(?:SOLD\s+OPERATIONS|JOB\s*#|QTY\b|ITEM\b|DESCRIPTION\b)/i.test(line))return true;
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
