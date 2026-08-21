"use client";

import { useEffect } from "react";
import OutsideWorkIntake from "./file-intake";

function cleanLine(value:string){return value.replace(/[|]+/g," ").replace(/\s+/g," ").trim();}

const metadata=/NORTHERN\s+LOGISTICS|NORLOWORLD|\bINVOICE\b|REPAIR\s+ORDER|WORK\s+ORDER|BILL\s+TO|SHIP\s+TO|\bCUSTOMER\b|\bACCOUNT\b|\bACCT\b|FLEET\s+CHARGE|FLEET\s+CARD|CARD\s*(?:NO|NUMBER|#)|\bAUTH(?:ORIZATION)?\b|\bAPPROVAL\b|\bTRANSACTION\b|\bREFERENCE\b|\bPAYMENT\b|AMOUNT\s+DUE|BALANCE\s+DUE|GRAND\s+TOTAL|\bTERMS\b|SALESPERSON|PURCHASE\s+ORDER|\bPO\s*#|PAGE\s+\d|\bDATE\b|TAG\s+NUMBER|LICENSE\s+PLATE|YEAR\s+MAKE\s+MODEL|ENGINE\s+HOURS|ODOMETER|CUSTOMER\s+UNIT/i;
const equipmentField=/^(?:UNIT|TRUCK|TRACTOR|TRAILER|VEHICLE|EQUIPMENT|ASSET|STOCK)(?:\s*(?:NO|NUMBER|#|UNIT))?\s*[:#=.-]*\s*[A-Z0-9-]{1,20}\s*$/i;
const business=/\b(?:TRUCK|TRUCKS|TRACTOR|TRACTORS|DIESEL|TIRE|TIRES|SERVICE|SERVICES|REPAIR|REPAIRS|MOTOR|MOTORS|AUTO|AUTOMOTIVE|CENTER|CENTRE|DEALER|GARAGE|SHOP|TRUCKING|FLEET|BODY\s+SHOP|COLLISION|TOWING|SPRING|TRANSMISSION|RADIATOR|ALIGNMENT|INC\.?|LLC|LTD|CORP|CORPORATION|COMPANY|CO\.)\b/i;
const knownBrand=/\b(?:KENWORTH|PETERBILT|FREIGHTLINER|WESTERN\s+STAR|VOLVO|MACK|INTERNATIONAL|CUMMINS|DETROIT|GOODYEAR|BRIDGESTONE|MICHELIN|LOVE'?S|TA\s+PETRO)\b/i;
const contact=/\b(?:PHONE|TEL|FAX)\b|\(\d{3}\)\s*\d{3}[- ]\d{4}|\b\d{3}[-.]\d{3}[-.]\d{4}\b|www\.|https?:|@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const address=/^\d{1,6}\s+\S+|\b(?:ST|STREET|RD|ROAD|AVE|AVENUE|BLVD|BOULEVARD|DRIVE|DR|HWY|HIGHWAY|LANE|LN|WAY|ROUTE|RT|PKWY|PARKWAY|PO\s+BOX)\b/i;
const vendorLabel=/(?:^|\b)(?:VENDOR|SUPPLIER|MERCHANT|DEALER|SERVICE\s+PROVIDER|REMIT\s+TO|PAY\s+TO|PLEASE\s+REMIT\s+PAYMENT\s+TO)\b\s*[:#=.-]*\s*(.*)$/i;
const financialLine=/^(?:ESTIMATED(?:\s+BILLED)?|BILLED|PREPAY|SHOP\s+SUPPLIES|MISC(?:ELLANEOUS)?\s+SUPPLIES|MISC|LABOR|LABOUR|PARTS|SUBLET|SUB\s*TOTAL|SUBTOTAL|TAX|TOTAL|BALANCE|AMOUNT\s+DUE)(?:\b|\s*[:$])/i;
const financialAmount=/\b(?:SHOP\s+SUPPLIES|MISC(?:ELLANEOUS)?\s+SUPPLIES|LABOR|LABOUR|PARTS|SUBLET|PREPAY|SUB\s*TOTAL|SUBTOTAL|TAX|TOTAL)\b[^\n]{0,40}\$?\s*\d[\d,.]*/i;
const narrativeHeading=/^(?:COMPLAINT|CAUSE|CORRECTION|WORK\s+PERFORMED|SERVICE\s+DESCRIPTION|DESCRIPTION\s+OF\s+WORK|REPAIR\s+DESCRIPTION|LABOR\s+DETAIL|LABOUR\s+DETAIL|JOB\s+DESCRIPTION|TECHNICIAN\s+COMMENTS|RECOMMENDATIONS)\b/i;
const narrativeEnd=/^(?:QTY\b|ITEM\b|PART\s+NUMBER|PART\s*#|DESCRIPTION\b|UNIT\s+PRICE|EXTD\s+PRICE|EXTENDED\b|PREPAY\b|SOLD\s+OPERATIONS\s+TOTALS|SUB\s*TOTAL|SUBTOTAL|AMOUNT\s+DUE|BALANCE\s+DUE|GRAND\s+TOTAL|TOTAL\b)/i;
const narrativeAction=/\b(?:PULLED|CHECKED|FOUND|REPLACED|PERFORMED|RAN|ROAD\s+TESTED|REMOVED|INSTALLED|DIAGNOSED|INSPECTED|REPAIRED|SERVICED|ADJUSTED|REBUILT|CHANGED|MOUNTED|BALANCED|ALIGNED|RESET|REGEN|FAILED|BAD|FAULT|CODES?)\b/gi;
const vehicleLine=/\b[A-HJ-NPR-Z0-9]{17}\b|^\s*(?:19|20)\d{2}\s+[A-Z][A-Z0-9&'. -]+\s+[A-Z0-9-]{1,20}\b/i;
const legalHeading=/^(?:AUTHORIZATION\s+FOR\s+REPAIRS|EXCLUSION\s+OF\s+WARRANTIES|WARRANTY|WARRANTIES|SIGNATURE\s+OF\s+PERSON)/i;
const legalBoilerplate=/\b(?:HEREBY\s+AUTHORIZE|HEREBY\s+GRANT|UNDERSIGNED\s+PURCHASER|MECHANIC'?S\s+LIEN|RESPONSIBLE\s+FOR\s+PAYMENT|NO\s+WARRANTIES|DISCLAIMS?\s+ALL\s+WARRANTIES|MERCHANTABILITY|FITNESS\s+FOR\s+A\s+PARTICULAR\s+PURPOSE|INCIDENTAL\s+OR\s+CONSEQUENTIAL\s+DAMAGES|COMMERCIAL\s+LOSSES|PARTS\s+AND\/OR\s+ACCESSORIES|PARTS\s+OR\s+ACCESSORIES|ACCESSORIES\s+PURCHASED|DEALER\s+MAKES?\s+NO\s+WARRANTIES|MANUFACTURER|PERMISSION\s+TO\s+OPERATE|LOSS\s+OR\s+DAMAGE\s+TO\s+VEHICLE|UNAVAILABILITY\s+OF\s+PARTS|PARTS\s+SHIPMENTS|SUPPLIER\s+OR\s+TRANSPORTER)\b/i;
const commonProse=/\b(?:THE|AND|OR|TO|FOR|OF|THAT|WITH|ARE|IS|BE|BEEN|THIS|SUCH|ANY|FROM|BY|ON|IN|AS|THESE|THOSE|WILL|SHALL|UNDERSTANDS?|AGREES?|PURCHASED|SOLD|MADE|MAKES?)\b/gi;

function looksLikeNarrative(value:string){
  const line=cleanLine(value);
  if(!line)return false;
  if(narrativeHeading.test(line))return true;
  const actions=line.match(narrativeAction)?.length||0;
  return actions>=2||(line.length>=70&&actions>=1)||(/[.!?]/.test(line)&&line.length>=85);
}

function looksLikeLegalOrProse(value:string){
  const line=cleanLine(value);
  if(!line)return false;
  if(legalHeading.test(line)||legalBoilerplate.test(line))return true;
  const words=line.match(/[A-Za-z][A-Za-z'/-]*/g)||[];
  const proseWords=line.match(commonProse)?.length||0;
  if(words.length>=7&&proseWords>=3)return true;
  if(words.length>=10&&!business.test(line)&&!knownBrand.test(line))return true;
  return false;
}

function cleanVendorCandidate(value:string){
  const line=cleanLine(value).replace(/^[\s:#=.-]+/,"").replace(/[,:;.-]+$/," ").trim();
  if(line.length<2||line.length>90||!/[A-Za-z]{2}/.test(line))return"";
  if(metadata.test(line)||financialLine.test(line)||financialAmount.test(line)||equipmentField.test(line)||contact.test(line)||address.test(line)||vehicleLine.test(line)||looksLikeNarrative(line)||looksLikeLegalOrProse(line))return"";
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

function explicitLabelValue(line:string){
  const match=line.match(vendorLabel);
  if(!match)return"";
  return cleanVendorCandidate(match[1]||"");
}

function detectExplicitVendor(lines:string[]){
  for(let i=0;i<lines.length;i++){
    if(!vendorLabel.test(lines[i]))continue;
    const same=explicitLabelValue(lines[i]);
    if(same)return same;
    for(let offset=1;offset<=6;offset++){
      const raw=lines[i+offset]||"";
      if(!raw)continue;
      if(financialLine.test(raw)||legalHeading.test(raw)||legalBoilerplate.test(raw))continue;
      const next=cleanVendorCandidate(raw);
      if(next&&(business.test(next)||knownBrand.test(next)||/\b(?:INC\.?|LLC|LTD|CORP|CORPORATION|COMPANY|CO\.)\b/i.test(next)))return next;
    }
  }
  return"";
}

function detectVendorNearContact(lines:string[]){
  for(let i=0;i<lines.length;i++){
    if(!contact.test(lines[i]))continue;
    for(let offset=1;offset<=4;offset++){
      const candidate=cleanVendorCandidate(lines[i-offset]||"");
      if(candidate&&(business.test(candidate)||knownBrand.test(candidate)))return candidate;
    }
  }
  return"";
}

function detectReliableVendor(text:string){
  const lines=text.split(/\r?\n/).map(cleanLine).filter(Boolean);
  const explicit=detectExplicitVendor(lines);
  if(explicit)return explicit;

  const nearContact=detectVendorNearContact(lines);
  const blocked=narrativeMask(lines);
  let best=nearContact;
  let bestScore=nearContact?84:-999;
  const limit=Math.min(lines.length,220);

  for(let i=0;i<limit;i++){
    const line=cleanVendorCandidate(lines[i]);
    if(!line||blocked[i])continue;

    const letters=(line.match(/[A-Za-z]/g)||[]).length;
    const digits=(line.match(/\d/g)||[]).length;
    const hasBusiness=business.test(line);
    const hasBrand=knownBrand.test(line);
    const nearby=[lines[i-2]||"",lines[i-1]||"",lines[i+1]||"",lines[i+2]||"",lines[i+3]||""].join(" ");
    const hasContact=contact.test(nearby);
    const hasAddress=[lines[i+1]||"",lines[i+2]||"",lines[i+3]||""].some(item=>address.test(item));

    if(!hasBusiness&&!hasBrand)continue;

    let score=24-Math.min(i,20);
    if(hasBusiness)score+=54;
    if(hasBrand)score+=18;
    if(hasContact)score+=22;
    if(hasAddress)score+=22;
    if(line===line.toUpperCase()&&letters>=5)score+=8;
    if(line.length>=4&&line.length<=58)score+=7;
    if(/^[A-Z][A-Za-z0-9&'. -]+$/.test(line))score+=4;
    if(/:/.test(line))score-=18;
    score-=Math.min(18,digits*4);

    if(hasBrand&&!hasBusiness&&!hasContact&&!hasAddress)score-=50;
    if(score>bestScore){bestScore=score;best=line;}
  }
  return bestScore>=72?best:"";
}

function suspiciousVendor(value:string){
  const line=cleanLine(value);
  if(!line)return false;
  if(metadata.test(line)||financialLine.test(line)||financialAmount.test(line)||equipmentField.test(line)||vehicleLine.test(line)||looksLikeNarrative(line)||looksLikeLegalOrProse(line))return true;
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
