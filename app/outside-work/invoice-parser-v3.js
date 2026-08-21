import {
  parseOutsideWorkInvoice as parseV2,
  suspiciousInvoiceNumber,
  suspiciousServiceSummary as suspiciousServiceSummaryV2,
  suspiciousVendor as suspiciousVendorV2,
} from "./invoice-parser-v2.js";
import { parseDateToken } from "./invoice-parser.js";

export { suspiciousInvoiceNumber };

const out=(value="",confidence=0,source="")=>({value,confidence,source});
const clean=value=>String(value||"").replace(/[|]+/g," ").replace(/\s+/g," ").trim();
const lines=text=>String(text||"").split(/\r?\n/).map(clean).filter(Boolean);
const LETTERHEAD_MARKETING=/\b(?:24\s+HOUR\s+SERVICE|SINCE\s+19\d\d|THE\s+ORIGINAL\b.*\bSERVICE|REPAIR\s+SERVICE,?\s+INC|SERVICE,?\s+INC\.?\s*$)\b/i;

export function suspiciousVendor(value){
  const text=clean(value);
  return suspiciousVendorV2(value)||LETTERHEAD_MARKETING.test(text);
}

export function suspiciousServiceSummary(value){
  const text=clean(value);
  return suspiciousServiceSummaryV2(value)||LETTERHEAD_MARKETING.test(text);
}

function parseFirstDate(value){
  const candidates=clean(value).toUpperCase().match(/\b(?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{1,2}[- ]?(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[- ]?\d{2,4}|(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[ -]\d{1,2},?[ -]\d{2,4})\b/g)||[];
  for(const candidate of candidates){const parsed=parseDateToken(candidate);if(parsed)return parsed;}
  return"";
}

function detectExplicitInvoiceDate(text){
  const label=/\b(?:INVOICE\s*DATE|INV\.?\s*DATE|SERVICE\s*DATE|REPAIR\s*DATE|CLOSED\s*DATE|COMPLETED\s*DATE)\b\s*[:#=.-]*/i;
  for(const line of lines(text)){
    const match=line.match(label);
    if(!match||match.index===undefined)continue;
    const value=parseFirstDate(line.slice(match.index+match[0].length));
    if(value)return out(value,.999,"explicit invoice/service date");
  }
  return out();
}

function detectPrintedFormNumber(text){
  const ls=lines(text).slice(0,45);
  const label=/^(?:NO|NE|N0|N[°º])\.?\s*[:#=-]?\s*(\d{4,10})\b/i;
  for(const line of ls){
    if(/\b(?:PHONE|FAX|ZIP|DATE|LICENSE|LICENCE|PARTS|LABOR|LABOUR|TOTAL)\b/i.test(line))continue;
    const match=line.match(label);
    if(match?.[1])return out(match[1],.94,"printed service-form number");
  }
  return out();
}

function detectVisionWork(text){
  const source=String(text||"");
  if(!/\bVISION-VERIFIED\s+SCANNED\s+INVOICE\b/i.test(source))return out();
  const ls=lines(source);
  const start=ls.findIndex(line=>/^WORK\s+PERFORMED\s*:?\s*$/i.test(line));
  if(start<0)return out();
  const structured=/^(?:SERVICE\s+VENDOR|INVOICE\s+NUMBER|SERVICE\s+DATE|UNIT|ODOMETER|INVOICE\s+TOTAL)\s*:/i;
  const work=[];
  for(let i=start+1;i<ls.length;i++){
    if(structured.test(ls[i])||/^VISION-VERIFIED\b/i.test(ls[i]))break;
    const line=clean(ls[i]).replace(/^[-*•]\s*/,"").trim();
    if(line&&line.length<=300&&!work.some(item=>item.toLowerCase()===line.toLowerCase()))work.push(line);
  }
  return work.length?out(work.slice(0,16).join("\n"),.999,"vision-verified work block"):out();
}

export function parseOutsideWorkInvoice(text){
  const parsed=parseV2(text);
  const explicitDate=detectExplicitInvoiceDate(text);
  const printedFormNumber=detectPrintedFormNumber(text);
  const visionWork=detectVisionWork(text);
  return {
    ...parsed,
    invoiceNumber:printedFormNumber.confidence>parsed.invoiceNumber.confidence?printedFormNumber:parsed.invoiceNumber,
    invoiceDate:explicitDate.confidence>parsed.invoiceDate.confidence?explicitDate:parsed.invoiceDate,
    serviceSummary:visionWork.confidence>parsed.serviceSummary.confidence?visionWork:parsed.serviceSummary,
  };
}
