import {
  parseOutsideWorkInvoice as parseV2,
  suspiciousInvoiceNumber,
  suspiciousServiceSummary,
  suspiciousVendor,
} from "./invoice-parser-v2.js";
import { parseDateToken } from "./invoice-parser.js";

export { suspiciousInvoiceNumber, suspiciousServiceSummary, suspiciousVendor };

const out=(value="",confidence=0,source="")=>({value,confidence,source});
const clean=value=>String(value||"").replace(/[|]+/g," ").replace(/\s+/g," ").trim();
const lines=text=>String(text||"").split(/\r?\n/).map(clean).filter(Boolean);

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
  const visionWork=detectVisionWork(text);
  return {
    ...parsed,
    invoiceDate:explicitDate.confidence>parsed.invoiceDate.confidence?explicitDate:parsed.invoiceDate,
    serviceSummary:visionWork.confidence>parsed.serviceSummary.confidence?visionWork:parsed.serviceSummary,
  };
}
