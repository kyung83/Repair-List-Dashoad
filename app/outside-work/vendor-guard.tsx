"use client";

import { useEffect } from "react";
import OutsideWorkIntake from "./file-intake";

function cleanLine(value:string){return value.replace(/[|]+/g," ").replace(/\s+/g," ").trim();}

function detectReliableVendor(text:string){
  const lines=text.split(/\r?\n/).map(cleanLine).filter(Boolean).slice(0,36);
  const metadata=/NORTHERN\s+LOGISTICS|NORLOWORLD|\bINVOICE\b|REPAIR\s+ORDER|WORK\s+ORDER|BILL\s+TO|SHIP\s+TO|\bCUSTOMER\b|\bACCOUNT\b|\bACCT\b|FLEET\s+CHARGE|FLEET\s+CARD|CARD\s*(?:NO|NUMBER|#)|\bAUTH(?:ORIZATION)?\b|\bAPPROVAL\b|\bTRANSACTION\b|\bREFERENCE\b|\bPAYMENT\b|AMOUNT\s+DUE|BALANCE\s+DUE|GRAND\s+TOTAL|\bTERMS\b|SALESPERSON|PURCHASE\s+ORDER|\bPO\s*#|PAGE\s+\d|\bDATE\b/i;
  const equipmentField=/^(?:UNIT|TRUCK|TRACTOR|TRAILER|VEHICLE|EQUIPMENT|ASSET|STOCK)(?:\s*(?:NO|NUMBER|#|UNIT))?\s*[:#=.-]*\s*[A-Z0-9-]{1,20}\s*$/i;
  const business=/\b(?:TRUCK|TRUCKS|DIESEL|TIRE|TIRES|SERVICE|SERVICES|REPAIR|REPAIRS|MOTOR|MOTORS|AUTO|AUTOMOTIVE|CENTER|CENTRE|DEALER|GARAGE|SHOP|TRUCKING|FLEET|BODY\s+SHOP|COLLISION|TOWING|SPRING|TRANSMISSION|RADIATOR|ALIGNMENT|INC\.?|LLC|LTD|CORP|CORPORATION|COMPANY|CO\.)\b/i;
  const knownBrand=/\b(?:KENWORTH|PETERBILT|FREIGHTLINER|WESTERN\s+STAR|VOLVO|MACK|INTERNATIONAL|CUMMINS|DETROIT|GOODYEAR|BRIDGESTONE|MICHELIN|LOVE'?S|TA\s+PETRO)\b/i;
  const contact=/\b(?:PHONE|TEL|FAX)\b|\(\d{3}\)\s*\d{3}[- ]\d{4}|\b\d{3}[-.]\d{3}[-.]\d{4}\b|www\.|https?:|@[A-Z0-9.-]+\.[A-Z]{2,}/i;
  const address=/^\d{1,6}\s+\S+|\b(?:ST|STREET|RD|ROAD|AVE|AVENUE|BLVD|BOULEVARD|DRIVE|DR|HWY|HIGHWAY|LANE|LN|WAY|ROUTE|RT)\b/i;
  let best="";
  let bestScore=-999;

  for(let i=0;i<lines.length;i++){
    const line=lines[i];
    if(line.length<3||line.length>90||!/[A-Za-z]{3}/.test(line))continue;
    if(metadata.test(line)||equipmentField.test(line)||contact.test(line)||address.test(line))continue;
    if(/[Xx*#]{2,}\s*\d{2,8}\b/.test(line))continue;
    if(/^\$?\s*\d[\d,. ]*$/.test(line))continue;

    const letters=(line.match(/[A-Za-z]/g)||[]).length;
    const digits=(line.match(/\d/g)||[]).length;
    if(letters<3||digits>Math.max(3,Math.floor(letters/2)))continue;

    let score=20-Math.min(i,20);
    const hasBusiness=business.test(line);
    const hasBrand=knownBrand.test(line);
    if(hasBusiness)score+=48;
    if(hasBrand)score+=58;
    if(line===line.toUpperCase()&&letters>=5)score+=8;
    if(line.length>=5&&line.length<=52)score+=7;
    if(/^[A-Z][A-Za-z0-9&'. -]+$/.test(line))score+=4;
    if(/:/.test(line))score-=20;
    score-=Math.min(18,digits*4);

    const nearby=[lines[i-2]||"",lines[i-1]||"",lines[i+1]||"",lines[i+2]||""].join(" ");
    if(contact.test(nearby))score+=24;
    if(address.test(lines[i+1]||"")||address.test(lines[i+2]||""))score+=22;
    if(!hasBusiness&&!hasBrand&&!contact.test(nearby)&&!address.test(lines[i+1]||"")&&!address.test(lines[i+2]||""))score-=28;

    if(score>bestScore){bestScore=score;best=line;}
  }
  return bestScore>=60?best:"";
}

function suspiciousVendor(value:string){
  const line=cleanLine(value);
  if(!line)return false;
  return /\b(?:PAYMENT|AMOUNT|BALANCE|ACCOUNT|ACCT|CARD|CHARGE|AUTH|APPROVAL|TRANSACTION|REFERENCE|CUSTOMER|INVOICE|DATE|TERMS)\b/i.test(line)
    || /^(?:UNIT|TRUCK|TRACTOR|TRAILER|VEHICLE|EQUIPMENT|ASSET|STOCK)(?:\s*(?:NO|NUMBER|#|UNIT))?\s*[:#=.-]*\s*[A-Z0-9-]{1,20}\s*$/i.test(line);
}

function setReactInputValue(input:HTMLInputElement,value:string){
  const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")?.set;
  if(setter)setter.call(input,value);else input.value=value;
  input.dispatchEvent(new Event("input",{bubbles:true}));
}

function VendorGuard(){
  useEffect(()=>{
    let lastText="";
    const timer=window.setInterval(()=>{
      const textarea=Array.from(document.querySelectorAll<HTMLTextAreaElement>("textarea")).find(item=>item.placeholder.includes("OCR or extracted PDF text"));
      const vendorLabel=Array.from(document.querySelectorAll<HTMLLabelElement>("label")).find(label=>(label.textContent||"").trim().startsWith("Outside vendor"));
      const vendorInput=vendorLabel?.querySelector<HTMLInputElement>("input")||null;
      if(!textarea||!vendorInput)return;
      const text=textarea.value.trim();
      if(!text||text===lastText)return;
      lastText=text;
      const candidate=detectReliableVendor(text);
      const current=vendorInput.value.trim();
      if(candidate&&candidate!==current){setReactInputValue(vendorInput,candidate);return;}
      if(!candidate&&suspiciousVendor(current))setReactInputValue(vendorInput,"");
    },350);
    return()=>window.clearInterval(timer);
  },[]);
  return null;
}

export default function OutsideWorkVendorSafe(){
  return <><OutsideWorkIntake/><VendorGuard/></>;
}
