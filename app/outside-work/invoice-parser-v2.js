import {
  parseOutsideWorkInvoice as parseBase,
  parseDateToken,
  suspiciousInvoiceNumber,
  suspiciousServiceSummary,
  suspiciousVendor,
} from "./invoice-parser.js";

export { suspiciousInvoiceNumber, suspiciousServiceSummary, suspiciousVendor };

const CUSTOMER=/\b(?:NORTHERN\s+LOGISTICS(?:\s+INC)?|NORLOWORLD)\b/i;
const CUSTOMER_HEAD=/^(?:BILL\s+TO|DELIVER\s+TO|SHIP\s+TO|SOLD\s+TO|CUSTOMER)\b/i;
const REMIT=/\b(?:PLEASE\s+REMIT\s+PAYMENT\s+TO|REMIT\s+PAYMENT\s+TO|REMIT\s+TO|PAY\s+TO|PAYEE)\b/i;
const BUSINESS=/\b(?:TRUCK|TRUCKS|TRACTOR|TRACTORS|TIRE|TIRES|DIESEL|SERVICE|SERVICES|REPAIR|REPAIRS|TOWING|TOW|MOTOR|MOTORS|AUTO|AUTOMOTIVE|GARAGE|SHOP|FLEET|CENTER|CENTRE|COLLISION|INC\.?|LLC|LTD|CORP|CORPORATION|COMPANY|CO\.)\b/i;
const ADDRESS=/^\d{1,6}\s+\S+|\b(?:ST|STREET|RD|ROAD|AVE|AVENUE|BLVD|BOULEVARD|DRIVE|DR|HWY|HIGHWAY|LANE|LN|WAY|ROUTE|RT|PKWY|PARKWAY|PO\s+BOX|P\.\s*O\.\s+BOX)\b|\b[A-Z .'-]+,?\s+[A-Z]{2},?\s+\d{5}(?:-\d{4})?\b/i;
const CONTACT=/\b(?:PHONE|TEL|FAX|HOME|BUSINESS)\b|\(\d{3}\)\s*\d{3}[- ]\d{4}|\b\d{3}[./-]\d{3}[./-]\d{4}\b|www\.|@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const LEGAL=/\b(?:WARRANTY|WARRANTIES|HEREBY|UNDERSIGNED|MERCHANTABILITY|PARTICULAR PURPOSE|YOU ARE ENTITLED|NO REFUNDS|RETURNS|MOTOR VEHICLE SERVICE AND REPAIR ACT)\b/i;
const FINANCIAL=/\b(?:MERCHANDISE|LABOR|LABOUR|TAX|SUBTOTAL|TOTAL|AMOUNT|CONVENIENCE FEE|FUEL SURCHARGE|ON ACCOUNT|TENDERED)\b/i;
const out=(value="",confidence=0,source="")=>({value,confidence,source});
const clean=value=>String(value||"").replace(/[|]+/g," ").replace(/\s+/g," ").trim();
const lines=text=>String(text||"").split(/\r?\n/).map(clean).filter(Boolean);
const normalizeName=value=>clean(value).replace(/\s+PAGE\s*:?\s*\d+$/i,"").replace(/[,:;.-]+$/," ").trim();

function companyCandidate(value){
  const line=normalizeName(value);
  if(line.length<3||line.length>90||CUSTOMER.test(line)||CUSTOMER_HEAD.test(line)||REMIT.test(line)||LEGAL.test(line)||FINANCIAL.test(line)||ADDRESS.test(line)||CONTACT.test(line)||/^PAGE\b|^INVOICE\b/i.test(line))return"";
  const words=line.match(/[A-Za-z][A-Za-z'&.-]*/g)||[];
  if(words.length<2||words.length>10||!BUSINESS.test(line))return"";
  return line;
}

function detectServiceProvider(text){
  const ls=lines(text);
  const customerAt=ls.findIndex(line=>CUSTOMER_HEAD.test(line)||CUSTOMER.test(line));
  const remitAt=ls.findIndex(line=>REMIT.test(line));
  const limit=Math.min(customerAt>=0?customerAt:35,35);
  let best="";
  let bestScore=-1;
  for(let i=0;i<limit;i++){
    if(remitAt>=0&&i>=remitAt&&i<=remitAt+6)continue;
    const candidate=companyCandidate(ls[i]);
    if(!candidate)continue;
    const nearby=ls.slice(i+1,i+7).join(" ");
    let score=5;
    if(ADDRESS.test(nearby))score+=3;
    if(CONTACT.test(nearby))score+=3;
    if(i<=5)score+=1;
    if(candidate===candidate.toUpperCase())score+=1;
    if(score>bestScore){best=candidate;bestScore=score;}
  }
  return bestScore>=9?out(best,.98,"service-provider letterhead"):out();
}

function cleanRef(value){
  const token=clean(value).replace(/^[#:=.-]+|[#:=.-]+$/g,"");
  if(!token||token.length<4||token.length>32||/\$/.test(token)||/^\d+[.,]\d{2}$/.test(token)||/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(token)||!/^[A-Z0-9][A-Z0-9./:_-]*$/i.test(token))return"";
  if(/^\d+$/.test(token)&&(token.length<5||token.length>12))return"";
  return token;
}

function detectAdditionalInvoiceNumber(text){
  const ls=lines(text);
  for(let i=0;i<ls.length;i++){
    let match=ls[i].match(/\bEXTERNAL\s+INVOICE\s+(?:NUMBER|NO\.?|#)\b\s*[:#=.-]*\s*([A-Z0-9][A-Z0-9./:_-]{3,31})?/i);
    if(match){
      const same=cleanRef(match[1]||"");
      if(same)return out(same,.995,"external invoice number");
      for(let n=1;n<=2;n++){const next=cleanRef(ls[i+n]||"");if(next)return out(next,.99,"external invoice number next line");}
    }
    match=ls[i].match(/^(?:INVOICE\s*)?(?:NO\.?|NUMBER|#)\s*[:#=.-]*\s*([A-Z0-9][A-Z0-9./:_-]{3,31})$/i);
    if(match){const token=cleanRef(match[1]);if(token)return out(token,.97,"printed invoice number");}
  }
  if(ls.some(line=>/^INVOICE\s*#?\s*$/i.test(line)||/\bINVOICE\s*#\s*$/i.test(line))){
    const counts=new Map();
    for(const line of ls){
      const token=cleanRef(line);
      if(!token||!/^\d{5,12}$/.test(token))continue;
      counts.set(token,(counts.get(token)||0)+1);
    }
    const ranked=[...counts.entries()].sort((a,b)=>b[1]-a[1]||b[0].length-a[0].length);
    if(ranked[0]?.[1]>=2)return out(ranked[0][0],.96,"repeated invoice page reference");
  }
  return out();
}

function parseHumanDate(value){
  const line=clean(value).toUpperCase();
  const candidates=line.match(/\b(?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{1,2}[- ]?(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[- ]?\d{2,4}|(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[ -]\d{1,2},?[ -]\d{2,4})\b/g)||[];
  for(const candidate of candidates){const parsed=parseDateToken(candidate);if(parsed)return parsed;}
  return"";
}

function detectGeneratedDate(text){
  for(const line of lines(text)){
    if(!/^GENERATED\b/i.test(line))continue;
    const value=parseHumanDate(line);
    if(value)return out(value,.94,"generated receipt date");
  }
  return out();
}

function detectSpeedometer(text){
  for(const line of lines(text)){
    const match=line.match(/\bSPEEDOMETER\s+READING\b\s*[:#=.-]*\s*(\d[\d,]{2,8})\b/i);
    if(match)return out(String(Number(match[1].replace(/,/g,""))),.9,"speedometer reading");
  }
  return out();
}

function quantityLabel(value){
  const n=Number(value);
  return Number.isFinite(n)&&Number.isInteger(n)?String(n):String(value);
}

function serviceLine(description,quantity){
  const d=clean(description).replace(/\([^)]*$/," ").trim();
  const qty=quantityLabel(quantity);
  if(/FUEL\s+SURCHARGE|SERVICE\s+CALL/i.test(d))return"";
  if(/TIRE\s+CHANGE/i.test(d))return `Changed ${qty} medium-truck tire${Number(quantity)===1?"":"s"}`;
  if(/VALVE\s+STEM/i.test(d))return `Replaced ${qty} valve stem${Number(quantity)===1?"":"s"}`;
  if(/SPOT\s+REPAIR/i.test(d))return"Performed tire spot repair";
  if(/PUNCTURE\s+REPAIR/i.test(d))return"Repaired tire puncture";
  if(/SECTION\s+REPAIR/i.test(d))return"Performed tire section repair";
  if(/NAIL\s+REPAIR/i.test(d))return"Repaired tire nail puncture";
  if(/ALIGNMENT/i.test(d))return"Performed alignment";
  if(/\bBALANC/i.test(d))return`Balanced ${qty} tire${Number(quantity)===1?"":"s"}`;
  if(/\bMOUNT/i.test(d))return`Mounted ${qty} tire${Number(quantity)===1?"":"s"}`;
  if(/\bTOW(?:ING)?\b/i.test(d))return"Performed towing service";
  if(/\bREPAIR\b/i.test(d)&&d.length<=80)return `Performed ${d.toLowerCase()}`;
  return"";
}

function detectItemizedRepairs(text){
  const found=[];
  for(const line of lines(text)){
    const match=line.match(/^([A-Z0-9][A-Z0-9./_-]{1,24})\s+(.+?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:,\d{3})*\.\d{2})\s+(\d+(?:,\d{3})*\.\d{2})$/i);
    if(!match)continue;
    const summary=serviceLine(match[2],Number(match[3]));
    if(summary&&!found.some(item=>item.toLowerCase()===summary.toLowerCase()))found.push(summary);
  }
  return found.length>=2?out(found.slice(0,12).join("\n"),.95,"itemized service lines"):out();
}

function isPaymentWrapper(text){
  return /\bPOWERED\s+BY\b[\s\S]{0,80}\bROADSYNC\b|\bROADSYNC\s+ID\b|\bPAYMENT\s+METHOD\s+SELF-CHECKOUT\b/i.test(String(text||""));
}

export function parseOutsideWorkInvoice(text){
  const base=parseBase(text);
  const serviceProvider=detectServiceProvider(text);
  const extraInvoice=detectAdditionalInvoiceNumber(text);
  const generatedDate=detectGeneratedDate(text);
  const speedometer=detectSpeedometer(text);
  const itemized=detectItemizedRepairs(text);
  const paymentReceipt=isPaymentWrapper(text);

  const vendor=serviceProvider.confidence>=.98?serviceProvider:base.vendor;
  const payee=serviceProvider.value&&base.vendor.value&&serviceProvider.value.toUpperCase()!==base.vendor.value.toUpperCase()?base.vendor:out();
  const invoiceNumber=extraInvoice.confidence>base.invoiceNumber.confidence?extraInvoice:base.invoiceNumber;
  const invoiceDate=generatedDate.confidence>base.invoiceDate.confidence?generatedDate:base.invoiceDate;
  const mileage=speedometer.confidence>base.mileage.confidence?speedometer:base.mileage;
  const serviceSummary=paymentReceipt?out("",0,"payment receipt only"):itemized.confidence>base.serviceSummary.confidence?itemized:base.serviceSummary;

  return {
    ...base,
    vendor,
    payee,
    invoiceNumber,
    invoiceDate,
    mileage,
    serviceSummary,
    documentKind:paymentReceipt?"payment_receipt":"repair_invoice",
  };
}
