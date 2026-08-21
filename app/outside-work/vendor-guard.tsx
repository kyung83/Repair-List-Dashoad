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
const companySuffixWord=/^(?:INC|INCORPORATED|CORP|CORPORATION|LTD|LLC|COMPANY)$/i;
const narrativeAction=/\b(?:PULLED|CHECKED|FOUND|REPLACED|PERFORMED|RAN|ROAD\s+TESTED|REMOVED|INSTALLED|DIAGNOSED|INSPECTED|REPAIRED|SERVICED|ADJUSTED|REBUILT|CHANGED|MOUNTED|BALANCED|ALIGNED|RESET|REGEN|FAILED|BAD|FAULT|CODES?)\b/gi;
const repairSectionStart=/^(?:CAUSE|CORRECTION|WORK\s+PERFORMED|SERVICE\s+DESCRIPTION|DESCRIPTION\s+OF\s+WORK|REPAIR\s+DESCRIPTION|LABOR\s+DETAIL|LABOUR\s+DETAIL|JOB\s+DESCRIPTION|TECHNICIAN\s+COMMENTS)\b/i;
const repairSectionStop=/^(?:QTY\b|ITEM\b|PART\s+NUMBER|PART\s*#|DESCRIPTION\b|UNIT\s+PRICE|EXTD\s+PRICE|EXTENDED\b|PREPAY\b|SOLD\s+OPERATIONS\s+TOTALS|SUB\s*TOTAL|SUBTOTAL|AMOUNT\s+DUE|BALANCE\s+DUE|GRAND\s+TOTAL|TOTAL\b|SHOP\s+SUPPLIES|AUTHORIZATION\s+FOR\s+REPAIRS|EXCLUSION\s+OF\s+WARRANTIES|SIGNATURE\b|PAGE\s+\d|JOB\s*#\d+)\b/i;
const repairChargeRow=/^\s*\d+(?:\.\d+)?\s+[A-Z0-9][A-Z0-9./_-]*\s+.+\s+\d+(?:,\d{3})*\.\d{2}(?:\s+\d+(?:,\d{3})*\.\d{2})?\s*$/i;
const repairVerb=/\b(?:FOUND|REPLACED?|PERFORMED|RAN|ROAD\s+TESTED|REMOVED|INSTALLED|INSTALL|REPROGRAM|PROGRAM(?:MED)?|REASSEMBLE(?:D)?|VERIFY|VERIFIED|TEST(?:ED)?|REPAIRED?|SERVICED?|ADJUSTED?|REBUILT?|CHANGED?|MOUNTED?|BALANCED?|ALIGNED?|WELDED?|TOWED?|DIAGNOSED?|INSPECTED?)\b/i;
const operationHeader=/^(?:[A-Z]|\d{1,2})\s+(?:INSTALL|REPLACE|REPAIR|REPROGRAM|PROGRAM|REMOVE|R&R|SERVICE|DIAGNOS|INSPECT|ADJUST|REBUILD|CHANGE|MOUNT|BALANCE|ALIGN|WELD|TOW)\b/i;
const operationStop=/^(?:CUSTOMER\s+PAY\b|CUSTOMER\s+COPY\b|PARTS\s+AMOUNT\b|LABOR\s+AMOUNT\b|GAS,?\s*OIL,?\s*LUBE\b|SUBLET\s+AMOUNT\b|MISC\.?\s+CHARGES?\b|TOTAL\s+CHARGES?\b|INSURANCE\/ADJUST\b|SALES\s+TAX\b|PLEASE\s+PAY\b|DESCRIPTION\s+TOTALS\b|AUTHORIZATION\s+FOR\s+REPAIRS|EXCLUSION\s+OF\s+WARRANTIES|REMIT\s+TO\b|COPYRIGHT\b|PAGE\s+\d)\b/i;
const operationNoise=/^(?:LINE\s+OPCODE|TECH\s+TYPE|SERVICE\s+ADVISOR|BUS:|CELL:|\d{1,3}\s+(?:ENGINE|TRANSMISSION|CHASSIS|BODY|ELECTRICAL)\s+(?:REPAIR|DIAGNOSIS)|\d{2,6}\s+[A-Z ,.'-]+\s+LIC#?:|CR\s+\$?\d|PARTS:\s*\$?\d|LABOR:\s*\$?\d|OTHER:\s*\$?\d|\*{3,})/i;
const repairLegal=/\b(?:YOU\s+ARE\s+ENTITLED|RETURN\s+OF\s+ALL\s+PARTS|FACTORY\s+WARRANTY|SELLER\s+HEREBY|SELLER\s+NEITHER|MANUFACTURER\s+OR\s+DISTRIBUTOR|ACKNOWLEDGE\s+NOTICE|ORAL\s+APPROVAL|IMPLIED\s+WARRANTY|PARTS\s+REPLACED,?\s+EXCEPT|EXCHANGE\s+AGREEMENT|INSURANCE\/ADJUST)\b/i;

function looksLikeNarrative(value:string){
  const line=cleanLine(value);
  if(!line)return false;
  if(excludedHeading.test(line))return true;
  const actions=line.match(narrativeAction)?.length||0;
  return actions>=2||(line.length>=70&&actions>=1)||(/[.!?]/.test(line)&&line.length>=85);
}

function hasCompanyEvidence(value:string){
  return business.test(value)||knownBrand.test(value)||/\b(?:INC\.?|LLC|LTD|CORP|CORPORATION|COMPANY|CO\.)\b/i.test(value);
}

function proseBoundaries(value:string){
  const boundary=/\b([A-Za-z]{3,})[.!?;]\s+/g;
  return Array.from(value.matchAll(boundary)).filter(match=>!companySuffixWord.test(match[1]||""));
}

function trimMergedProsePrefix(value:string){
  const line=cleanLine(value).replace(/^[\s:#=.-]+/,"").replace(/[,:;.-]+$/," ").trim();
  if(!line)return"";

  const matches=proseBoundaries(line);
  for(let i=matches.length-1;i>=0;i--){
    const start=(matches[i].index??0)+matches[i][0].length;
    const tail=line.slice(start).replace(/^[\s:#=.-]+/,"").replace(/[,:;.-]+$/," ").trim();
    if(tail&&tail.length<=90&&hasCompanyEvidence(tail))return tail;
  }

  const uppercaseTail=line.match(/([A-Z][A-Z0-9&'./-]*(?:\s+[A-Z][A-Z0-9&'./-]*){1,7})$/);
  if(uppercaseTail?.[1]&&hasCompanyEvidence(uppercaseTail[1]))return uppercaseTail[1].trim();
  return line;
}

function companyCandidate(value:string,anchored=false){
  const line=trimMergedProsePrefix(value);
  if(line.length<2||line.length>90||!/[A-Za-z]{2}/.test(line))return"";
  if(customerHeading.test(line)||excludedHeading.test(line)||customer.test(line)||financial.test(line)||legal.test(line)||metadata.test(line)||contact.test(line)||address.test(line)||looksLikeNarrative(line))return"";
  if(/\$\s*\d|^[0-9]/.test(line)||/[Xx*#]{2,}\s*\d{2,8}\b/.test(line))return"";
  const words=line.match(/[A-Za-z][A-Za-z'&.-]*/g)||[];
  if(words.length>10)return"";
  const capitalizedWords=words.length>0&&words.every(word=>/^[A-Z]/.test(word));
  const conciseAnchoredName=anchored&&words.length<=5&&!/[;!?]/.test(line)&&proseBoundaries(line).length===0&&(line===line.toUpperCase()||capitalizedWords);
  if(!hasCompanyEvidence(line)&&!conciseAnchoredName)return"";
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
  const normalized=line.replace(/^[\s:#=.-]+/,"").replace(/[,:;.-]+$/," ").trim();
  if(trimMergedProsePrefix(line)!==normalized)return true;
  if(/^(?:SOLD\s+OPERATIONS|JOB\s*#|QTY\b|ITEM\b|DESCRIPTION\b)/i.test(line))return true;
  return false;
}

function normalizeRepairComponent(value:string){
  let component=cleanLine(value)
    .replace(/^(?:THE|A|AN)\s+/i,"")
    .replace(/\bDPF\s*DP\b/ig,"DPF differential pressure")
    .replace(/\bDPFDP\b/ig,"DPF differential pressure")
    .replace(/\bDIFF(?:ERENTIAL)?\s+PRESS(?:URE)?\b/ig,"differential pressure")
    .replace(/\bAMBIENT\s+AIR\s+TEMP(?:ERATURE)?\b/ig,"ambient air temperature")
    .replace(/\bTEMP\b/ig,"temperature")
    .replace(/\s+/g," ")
    .replace(/[,:;.-]+$/," ")
    .trim();
  if(component&&component===component.toUpperCase())component=component.toLowerCase();
  component=component
    .replace(/\bdpf\b/ig,"DPF")
    .replace(/\bdef\b/ig,"DEF")
    .replace(/\babs\b/ig,"ABS")
    .replace(/\becm\b/ig,"ECM")
    .replace(/\begr\b/ig,"EGR")
    .replace(/\bscr\b/ig,"SCR")
    .replace(/\bcel\b/ig,"CEL")
    .replace(/\bbcm\b/ig,"BCM");
  const acronyms=new Set(["DPF","DEF","ABS","ECM","EGR","SCR","CEL","BCM"]);
  component=component.replace(/\b[A-Z]{2,}\b/g,word=>acronyms.has(word)?word:word.toLowerCase());
  return component;
}

function stripOperationCodes(value:string){
  return cleanLine(value)
    .replace(/^(?:[A-Z]|\d{1,2})\s+(?=(?:INSTALL|REPLACE|REPAIR|REPROGRAM|PROGRAM|REMOVE|R&R|SERVICE|DIAGNOS|INSPECT|ADJUST|REBUILD|CHANGE|MOUNT|BALANCE|ALIGN|WELD|TOW)\b)/i,"")
    .replace(/^\d{3,9}\s+[A-Z0-9./-]{2,20}\s+/i,"")
    .trim();
}

function operationNarrative(lines:string[]){
  for(let i=0;i<lines.length;i++){
    if(!operationHeader.test(lines[i]))continue;
    const chunks:string[]=[];
    const header=stripOperationCodes(lines[i]);
    if(header)chunks.push(header);
    for(let j=i+1;j<Math.min(lines.length,i+18);j++){
      const raw=lines[j];
      if(operationStop.test(raw))break;
      if(operationNoise.test(raw)||financial.test(raw)||legal.test(raw)||repairLegal.test(raw)||customerHeading.test(raw)||repairChargeRow.test(raw))continue;
      const line=stripOperationCodes(raw);
      if(!line||line.length>260)continue;
      if(repairVerb.test(line)||/\b(?:DONE|BODY\s+CONTROLLER)\b/i.test(line))chunks.push(line);
    }
    if(chunks.length){const [first,...rest]=chunks;return [first,rest.join(" ")].filter(Boolean).join(". ");}
  }
  return"";
}

function repairNarrative(text:string){
  const lines=text.split(/\r?\n/).map(cleanLine).filter(Boolean);
  const chunks:string[]=[];
  let active=false;
  for(const line of lines){
    const start=line.match(repairSectionStart);
    if(start){
      active=true;
      const remainder=cleanLine(line.slice(start[0].length).replace(/^[\s:#=.-]+/,""));
      if(remainder&&!repairSectionStop.test(remainder)&&!repairChargeRow.test(remainder)&&!repairLegal.test(remainder))chunks.push(remainder);
      continue;
    }
    if(repairSectionStop.test(line)){active=false;continue;}
    if(active){
      if(financial.test(line)||legal.test(line)||repairLegal.test(line)||customerHeading.test(line)||repairChargeRow.test(line))continue;
      chunks.push(line);
    }
  }
  if(chunks.length)return chunks.join(" ");
  const operation=operationNarrative(lines);
  if(operation)return operation;
  return lines.filter(line=>repairVerb.test(line)&&!financial.test(line)&&!legal.test(line)&&!repairLegal.test(line)&&!repairChargeRow.test(line)&&!metadata.test(line)&&!contact.test(line)).join(" ");
}

function pushRepairLine(lines:string[],value:string){
  const line=cleanLine(value).replace(/[.]+$/," ").trim();
  if(!line)return;
  if(!lines.some(existing=>existing.toLowerCase()===line.toLowerCase()))lines.push(line);
}

function detectRepairSummary(text:string){
  const narrative=repairNarrative(text);
  if(!narrative)return"";
  const sentences=(narrative.match(/[^.!?]+[.!?]?/g)||[]).map(cleanLine).filter(Boolean);
  const repairs:string[]=[];
  let pendingComponent="";

  for(const sentence of sentences){
    if(repairLegal.test(sentence)||operationNoise.test(sentence))continue;
    if(/^PULLED\s+(?:THE\s+)?(?:TRUCK|TRACTOR|TRAILER|UNIT|VEHICLE)\s+INTO\s+(?:THE\s+)?SHOP\b/i.test(sentence))continue;
    if(/^CHECKED\s+CODES?\b/i.test(sentence)&&sentence.split(/\s+/).length<=5)continue;
    if(/^DONE\b/i.test(sentence))continue;

    const installReprogram=sentence.match(/\bINSTALL(?:ED)?\s+AND\s+REPROGRAM(?:MED)?\s+(?:THE\s+)?(.+?)(?:\.|$)/i);
    if(installReprogram){
      const component=normalizeRepairComponent(installReprogram[1]);
      if(component)pushRepairLine(repairs,`Installed and reprogrammed ${component}`);
      continue;
    }

    const failed=sentence.match(/\bFOUND\s+(?:THE\s+)?(.+?)\s+(?:BAD|FAILED|FAULTY)\b/i);
    if(failed){
      const component=normalizeRepairComponent(failed[1]);
      if(component&&(/\bREPLACED\b/i.test(sentence)||(/\bREMOVED\b/i.test(sentence)&&/\bINSTALLED\b/i.test(sentence)))){
        pushRepairLine(repairs,`Replaced ${component}`);
        pendingComponent="";
        continue;
      }
      if(component)pendingComponent=component;
      continue;
    }

    if(/\bREMOVED\b/i.test(sentence)&&/\bINSTALLED\b/i.test(sentence)){
      if(pendingComponent){
        pushRepairLine(repairs,`Replaced ${pendingComponent}`);
        pendingComponent="";
        continue;
      }
      const installed=sentence.match(/\bINSTALLED\s+(?:(?:A|THE)\s+)?(?:NEW\s+)?(.+?)(?:\.|$)/i);
      const component=normalizeRepairComponent(installed?.[1]||"");
      if(component&&!/^(?:NEW\s+)?(?:PART|COMPONENT|ITEM)$/i.test(component))pushRepairLine(repairs,`Installed ${component}`);
      continue;
    }

    if(/\bDPF\b/i.test(sentence)&&/\bRESET\b/i.test(sentence)&&/\bREGEN(?:ERATION)?\b/i.test(sentence)){
      pushRepairLine(repairs,"Performed DPF reset and regeneration");
      continue;
    }
    if(/\bRAN\s+(?:A\s+)?REGEN(?:ERATION)?\b/i.test(sentence)){
      pushRepairLine(repairs,"Performed regeneration");
      continue;
    }

    if(/\bROAD\s+TESTED\b/i.test(sentence)){
      if(/\bNO\s+(?:ACTIVE\s+)?CODES?\b|\bNO\s+CODES?\s+COMING\s+BACK\b|\bCODES?\s+(?:DID\s+NOT|DIDN'T|NOT)\s+(?:COME\s+BACK|RETURN)\b/i.test(sentence))pushRepairLine(repairs,"Road tested - no codes returned");
      else pushRepairLine(repairs,"Road tested unit");
      continue;
    }

    const reassembled=sentence.match(/\bREASSEMBLE(?:D)?\s+(?:THE\s+)?(.+?)(?:\.|$)/i);
    if(reassembled){
      const component=normalizeRepairComponent(reassembled[1]);
      if(component)pushRepairLine(repairs,`Reassembled ${component}`);
      continue;
    }

    const programmed=sentence.match(/\bPROGRAM(?:MED)?\s+(?:THE\s+)?(.+?)(?:\.|$)/i);
    if(programmed){
      const component=normalizeRepairComponent(programmed[1]);
      if(component)pushRepairLine(repairs,`Programmed ${component}`);
      continue;
    }

    if(/\bVERIF(?:Y|IED)\s+MILEAGE\b/i.test(sentence)&&/\bTEST(?:ED)?\s+OPERATION\b/i.test(sentence)){
      pushRepairLine(repairs,"Verified mileage and tested operation");
      continue;
    }

    const replaced=sentence.match(/\bREPLACED\s+(?:THE\s+)?(.+?)(?:\.|$)/i);
    if(replaced){
      const component=normalizeRepairComponent(replaced[1]);
      if(component)pushRepairLine(repairs,`Replaced ${component}`);
      continue;
    }

    const installed=sentence.match(/\bINSTALL(?:ED)?\s+(?:THE\s+)?(.+?)(?:\.|$)/i);
    if(installed){
      const component=normalizeRepairComponent(installed[1]);
      if(component)pushRepairLine(repairs,`Installed ${component}`);
      continue;
    }

    const performed=sentence.match(/\bPERFORMED\s+(?:A\s+)?(.+?)(?:\.|$)/i);
    if(performed){
      const task=normalizeRepairComponent(performed[1]).replace(/\bregen\b/ig,"regeneration");
      if(task)pushRepairLine(repairs,`Performed ${task}`);
      continue;
    }

    const generic=sentence.match(/\b(REPAIRED|SERVICED|ADJUSTED|REBUILT|CHANGED|MOUNTED|BALANCED|ALIGNED|WELDED|TOWED)\s+(?:THE\s+)?(.+?)(?:\.|$)/i);
    if(generic){
      const action=generic[1].charAt(0).toUpperCase()+generic[1].slice(1).toLowerCase();
      const component=normalizeRepairComponent(generic[2]);
      if(component)pushRepairLine(repairs,`${action} ${component}`);
    }
  }

  if(pendingComponent)pushRepairLine(repairs,`Diagnosed failed ${pendingComponent}`);
  return repairs.slice(0,12).join("\n");
}

function setReactInputValue(input:HTMLInputElement,value:string){
  const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")?.set;
  if(setter)setter.call(input,value);else input.value=value;
  input.dispatchEvent(new Event("input",{bubbles:true}));
}

function setReactTextAreaValue(textarea:HTMLTextAreaElement,value:string){
  const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")?.set;
  if(setter)setter.call(textarea,value);else textarea.value=value;
  textarea.dispatchEvent(new Event("input",{bubbles:true}));
}

function VendorGuard(){
  useEffect(()=>{
    let activeText="";
    let vendorSeededForText=false;
    let repairSeededForText=false;
    let vendorCandidate="";
    let repairCandidate="";
    const timer=window.setInterval(()=>{
      const ocrTextarea=Array.from(document.querySelectorAll<HTMLTextAreaElement>("textarea")).find(item=>item.placeholder.includes("OCR or extracted PDF text"));
      const vendorLabelElement=Array.from(document.querySelectorAll<HTMLLabelElement>("label")).find(label=>(label.textContent||"").trim().startsWith("Outside vendor"));
      const workLabelElement=Array.from(document.querySelectorAll<HTMLLabelElement>("label")).find(label=>(label.textContent||"").trim().startsWith("Work performed"));
      const vendorInput=vendorLabelElement?.querySelector<HTMLInputElement>("input")||null;
      const workTextarea=workLabelElement?.querySelector<HTMLTextAreaElement>("textarea")||null;
      if(!ocrTextarea)return;

      const text=ocrTextarea.value.trim();
      if(!text)return;
      if(text!==activeText){
        activeText=text;
        vendorSeededForText=false;
        repairSeededForText=false;
        vendorCandidate=detectReliableVendor(text);
        repairCandidate=detectRepairSummary(text);
      }

      if(vendorInput){
        const current=vendorInput.value.trim();
        const suspicious=suspiciousVendor(current);
        if(vendorCandidate&&(!vendorSeededForText||!current||suspicious)){
          if(vendorCandidate!==current)setReactInputValue(vendorInput,vendorCandidate);
          vendorSeededForText=true;
        }else if(!vendorCandidate&&suspicious){
          setReactInputValue(vendorInput,"");
          vendorSeededForText=true;
        }
      }

      if(workTextarea&&repairCandidate&&!repairSeededForText){
        if(workTextarea.value.trim()!==repairCandidate)setReactTextAreaValue(workTextarea,repairCandidate);
        repairSeededForText=true;
      }
    },250);
    return()=>window.clearInterval(timer);
  },[]);
  return null;
}

export default function OutsideWorkVendorSafe(){
  return <><OutsideWorkIntake/><VendorGuard/></>;
}
